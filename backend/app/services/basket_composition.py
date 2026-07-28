"""
Basket macro composition (Epic 5.1) — the calorie-weighted protein/fat/
carb split of purchased, finalized receipt items, optionally weighted
toward recent purchases (EWMA, Konsum.md Stufe 1+2) so it reflects the
*current* buying rate rather than a lifetime sum.

Reads each item's *already-persisted* matched nutrition (the flat
protein_g/fat_g/carbs_g/calories_kcal columns Epic 4.1 writes onto
receipt_items at confirm time), rather than re-running the tiered
resolver here. An earlier version of this module (ported closer to the
old repo's Tier-1 function, which called `nutrition_mapping.map_items`)
re-resolved every item on every analysis request — that silently ignored
`is_non_food` and any manual correction (Epic 4.2) already stored on the
row, and re-hit the OFF/BLS matcher on every page load instead of reading
the confirmed result. Caught via real end-to-end testing against a sample
receipt with a badly-parsed item; see the fix commit for the repro.

Callers are expected to have already excluded non-food items (see
`db/repo.get_all_confirmed_receipt_items`) — this module only does macro
arithmetic, no filtering.

Epic 5.1 explicitly asks for a documented policy on unmatched/low-
confidence items. Policy: their calories still count toward `kcal_total`
(it should reflect what was actually purchased) and, per the current
fallback_categories.py data, the lowest-confidence match tier (category
estimate) carries a full protein/fat/carb/fiber breakdown for every
category — so fallback items are already included in the macro split, not
held out of it. `unaccounted_pct` still exists for the rare residual case
(e.g. a sparse OFF match missing a macro), surfaced explicitly rather than
hidden or silently absorbed into one of the three macros. Whether an item's
calories came from a category estimate at all — as opposed to whether that
estimate has full data — is reported separately as `fallback_share_pct`, a
confidence label rather than an exclusion.
"""

from datetime import date, datetime
from typing import List, Optional

from backend.app.services.ideal_profile import KCAL_PER_G
from backend.app.services.nutrition_profile import grams_for

# Match tiers we treat as "confidently identified" for the coverage label
# (models/nutrition.py MatchType): a real product/BLS identity, as opposed
# to the category-only `fallback` estimate or an unmatched `none`. Coverage
# is reported so the UI can label low-confidence results honestly instead of
# presenting an estimate as if it were measured.
_CONFIDENT_MATCH_TYPES = {"learned", "exact", "fuzzy", "bls"}

# Units where quantity -> grams is a real measurement. Anything else (a
# "piece", or a missing quantity) goes through nutrition_profile.grams_for's
# coarse piece-weight guess (Konsum.md:131's "1 g/ml, 100 g-Default"), which
# distorts the calorie weighting. We don't invent a better number here --
# that would fake precision -- but we DO measure how much of the basket
# leans on that guess and surface it as `quantity_coverage_pct`.
_MEASURED_UNITS = {"g", "kg", "ml", "l"}

# Half-life for the EWMA recency weighting (Konsum.md Stufe 2, ~30 days):
# a purchase's weight halves every this-many days of age, so the split
# tracks *current* buying habits instead of a lifetime sum. A one-off bulk
# buy decays rather than skewing the mix forever.
_DEFAULT_HALF_LIFE_DAYS = 30.0

# Below this many distinct receipts, or this confident-match coverage, the
# split is too thin to trust -- surfaced as `low_confidence` ("wackelig").
_MIN_RECEIPTS_FOR_CONFIDENCE = 3
_MIN_MATCH_COVERAGE_FOR_CONFIDENCE = 60.0


def _parse_date(value) -> Optional[date]:
    """Best-effort parse of a stored date/timestamp into a date. Returns
    None for missing/unparseable values (which then get a neutral weight)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value)
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
    except ValueError:
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None


def _item_purchase_date(item: dict) -> Optional[date]:
    """The receipt's purchase date (falling back to created_at). Works
    whether the receipt fields are flattened onto the item or nested under
    an embedded `receipts` object (the shape repo returns)."""
    receipts = item.get("receipts") or {}
    return _parse_date(
        item.get("purchased_at")
        or receipts.get("purchased_at")
        or item.get("created_at")
        or receipts.get("created_at")
    )


def _recency_weight(
    item_date: Optional[date], reference_date: Optional[date], half_life_days: float
) -> float:
    """EWMA weight for an item by age. 1.0 (neutral) when we can't date the
    item or no reference date is given -- so callers that pass undated items
    get the old un-weighted behaviour unchanged."""
    if reference_date is None or item_date is None or half_life_days <= 0:
        return 1.0
    age_days = (reference_date - item_date).days
    if age_days <= 0:
        return 1.0
    return 0.5 ** (age_days / half_life_days)


def _pct_split(protein_g: float, fat_g: float, carbs_g: float, kcal_total: float) -> Optional[dict]:
    if not kcal_total or kcal_total <= 0:
        return None
    protein_pct = round(protein_g * KCAL_PER_G["protein"] / kcal_total * 100, 1)
    fat_pct = round(fat_g * KCAL_PER_G["fat"] / kcal_total * 100, 1)
    carb_pct = round(carbs_g * KCAL_PER_G["carb"] / kcal_total * 100, 1)
    return {
        "protein_pct": protein_pct,
        "fat_pct": fat_pct,
        "carb_pct": carb_pct,
        "unaccounted_pct": round(max(0.0, 100.0 - protein_pct - fat_pct - carb_pct), 1),
        "kcal_total": round(kcal_total, 1),
    }


def compute_basket_composition(
    receipt_items: List[dict],
    reference_date: Optional[date] = None,
    half_life_days: float = _DEFAULT_HALF_LIFE_DAYS,
    window_days: Optional[int] = None,
) -> Optional[dict]:
    """Calorie-weighted macro % split of purchased items.

    With a `reference_date`, purchases are weighted by recency (EWMA,
    Konsum.md Stufe 1+2): a purchase's weight halves every `half_life_days`,
    so the split reflects the *current* buying rate rather than a lifetime
    sum, and a one-off bulk buy decays instead of skewing the mix forever.
    `window_days`, if set, drops purchases older than that outright. With no
    `reference_date` (or undated items) every weight is 1.0, i.e. the old
    un-weighted lifetime split -- so callers that don't opt in are unchanged.

    Returns None if there are no receipt items yet, or none carry matched
    nutrition.
    """

    protein_total = fat_total = carb_total = fiber_total = kcal_total = 0.0
    kcal_macro_covered = kcal_confident = kcal_fallback = kcal_measured_qty = 0.0
    considered = 0
    receipt_ids = set()

    for item in receipt_items:
        cal = item.get("calories_kcal")
        if cal is None:
            continue

        item_date = _item_purchase_date(item)
        if (
            window_days is not None
            and reference_date is not None
            and item_date is not None
            and (reference_date - item_date).days > window_days
        ):
            continue

        grams = grams_for(item.get("quantity"), item.get("unit"), item.get("category"), item.get("name"))
        weight = _recency_weight(item_date, reference_date, half_life_days)
        factor = grams / 100.0 * weight
        kcal_contrib = cal * factor

        # A macro that is None means *unknown*, not zero -- adding it as 0.0
        # (the old `or 0.0`) understates that macro's % and silently dilutes
        # the split. Sum only known values; the calories of an item whose
        # macros we don't know still count toward kcal_total, so the missing
        # share surfaces as `unaccounted_pct` / lower macro coverage rather
        # than being hidden inside a 0.
        protein_g = item.get("protein_g")
        fat_g = item.get("fat_g")
        carbs_g = item.get("carbs_g")
        fiber_g = item.get("fiber_g")
        if protein_g is not None:
            protein_total += protein_g * factor
        if fat_g is not None:
            fat_total += fat_g * factor
        if carbs_g is not None:
            carb_total += carbs_g * factor
        if fiber_g is not None:
            fiber_total += fiber_g * factor

        kcal_total += kcal_contrib
        if protein_g is not None and fat_g is not None and carbs_g is not None:
            kcal_macro_covered += kcal_contrib
        match_type = (item.get("match_type") or "").lower()
        if match_type in _CONFIDENT_MATCH_TYPES:
            kcal_confident += kcal_contrib
        if match_type == "fallback":
            kcal_fallback += kcal_contrib
        qty = item.get("quantity")
        if (item.get("unit") or "").strip().lower() in _MEASURED_UNITS and isinstance(
            qty, (int, float)
        ) and qty > 0:
            kcal_measured_qty += kcal_contrib
        if item.get("receipt_id") is not None:
            receipt_ids.add(item["receipt_id"])
        considered += 1

    split = _pct_split(protein_total, fat_total, carb_total, kcal_total)
    if split is None:
        return None
    # Fiber isn't part of the %-of-calories split (see ideal_profile.py's
    # FIBER_G_PER_1000KCAL) -- it's reported as the same density unit as its
    # target so the two are directly comparable.
    fiber_per_1000kcal = round(fiber_total / kcal_total * 1000, 1)

    # Honesty labels (never fake precision): what share of the (weighted)
    # calories came from a full macro breakdown, from a confidently
    # identified product (vs a category-only estimate / no match), and from
    # a real measured quantity (vs grams_for's coarse piece guess). The UI
    # uses these to say results are based on *purchases* and how solid they
    # are.
    macro_coverage_pct = round(kcal_macro_covered / kcal_total * 100, 1)
    match_coverage_pct = round(kcal_confident / kcal_total * 100, 1)
    fallback_share_pct = round(kcal_fallback / kcal_total * 100, 1)
    quantity_coverage_pct = round(kcal_measured_qty / kcal_total * 100, 1)
    receipts_considered = len(receipt_ids)

    # "Wackelig": too few receipts to be representative, or mostly category
    # estimates. Flagged so the UI can say the numbers are shaky rather than
    # pretending precision from thin data.
    low_confidence = (
        receipts_considered < _MIN_RECEIPTS_FOR_CONFIDENCE
        or match_coverage_pct < _MIN_MATCH_COVERAGE_FOR_CONFIDENCE
    )

    return {
        **split,
        "fiber_per_1000kcal": fiber_per_1000kcal,
        "items_considered": considered,
        "receipts_considered": receipts_considered,
        "macro_coverage_pct": macro_coverage_pct,
        "match_coverage_pct": match_coverage_pct,
        "fallback_share_pct": fallback_share_pct,
        "quantity_coverage_pct": quantity_coverage_pct,
        "low_confidence": low_confidence,
    }
