"""
Basket macro composition (Epic 5.1) — the calorie-weighted protein/fat/
carb split of every purchased, finalized receipt item.

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
(it should reflect what was actually purchased), but the lowest-confidence
match tier (services/fallback_categories.py's category estimate) only
models protein/fiber/sugar/calories, never fat/carbs — so an item resolved
there contributes calories without a matching fat/carb contribution, and
protein_pct + fat_pct + carb_pct can legitimately fall short of 100%. That
gap is surfaced explicitly as `unaccounted_pct` rather than hidden or
silently absorbed into one of the three macros.
"""

from typing import List, Optional

from backend.app.services.ideal_profile import KCAL_PER_G
from backend.app.services.nutrition_profile import grams_for

# Match tiers we treat as "confidently identified" for the coverage label
# (models/nutrition.py MatchType): a real product/BLS identity, as opposed
# to the category-only `fallback` estimate or an unmatched `none`. Coverage
# is reported so the UI can label low-confidence results honestly instead of
# presenting an estimate as if it were measured.
_CONFIDENT_MATCH_TYPES = {"learned", "exact", "fuzzy", "bls"}


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


def compute_basket_composition(receipt_items: List[dict]) -> Optional[dict]:
    """Macro % split of everything purchased so far. None if there are no
    receipt items yet, or none carry matched nutrition."""

    protein_total = fat_total = carb_total = fiber_total = kcal_total = 0.0
    kcal_macro_covered = kcal_confident = 0.0
    considered = 0

    for item in receipt_items:
        cal = item.get("calories_kcal")
        if cal is None:
            continue
        grams = grams_for(item.get("quantity"), item.get("unit"), item.get("category"), item.get("name"))
        factor = grams / 100.0
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
        if (item.get("match_type") or "").lower() in _CONFIDENT_MATCH_TYPES:
            kcal_confident += kcal_contrib
        considered += 1

    split = _pct_split(protein_total, fat_total, carb_total, kcal_total)
    if split is None:
        return None
    # Fiber isn't part of the %-of-calories split (see ideal_profile.py's
    # FIBER_G_PER_1000KCAL) -- it's reported as the same density unit as its
    # target so the two are directly comparable.
    fiber_per_1000kcal = round(fiber_total / kcal_total * 1000, 1)
    return {
        **split,
        "fiber_per_1000kcal": fiber_per_1000kcal,
        "items_considered": considered,
        # Honesty labels (never fake precision): the share of counted
        # calories that came from a full macro breakdown, and from a
        # confidently identified product (vs a category-only estimate / no
        # match). The UI uses these to say results are based on *purchases*
        # and how solid the underlying matching is.
        "macro_coverage_pct": round(kcal_macro_covered / kcal_total * 100, 1),
        "match_coverage_pct": round(kcal_confident / kcal_total * 100, 1),
    }
