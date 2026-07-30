"""
28-day micronutrient totals + a trust metric.

Only BLS-tier matches and the OFF->BLS bridge (services/resolver.py's
`_apply_bridge`/`_bls_whole_food`) ever populate an item's `micros` dict --
plain OFF matches are sparse and category-fallback matches never carry
micros at all (see fallback_categories.py's module docstring). So summing
`micros` across the basket, on its own, would silently understate intake
for anyone whose purchases lean on OFF/fallback matches without saying so.
`micro_coverage_pct` -- the share of (weighted) calories from an item that
actually carries a `micros` dict -- is reported alongside the totals for
exactly that reason: it's the same "don't fake precision" policy
basket_composition.py already applies to macros, extended to micros.

No micronutrient targets are computed by this app's own formulas (IdealProfile
is explicitly macro-only, see models/profile.py) -- daily targets for these
come from the DGE's external reference table instead (services/dge_matcher.py).
"""

from datetime import date
from typing import List, Optional

from backend.app.services.basket_composition import _item_purchase_date
from backend.app.services.nutrition_profile import grams_for

# Same keys as bls_matcher._MICRO_COLS / NutritionValues.micros. Selenium
# is the one nutrient micronutrients.md covers that BLS 4.0 has no column
# for at all; Sulfur, Chromium, and Molybdenum have real BLS columns but
# are deliberately not tracked here (dropped per product decision).
_MICRO_KEYS = (
    "vitamin_a_ug",
    "vitamin_d_ug",
    "vitamin_e_mg",
    "vitamin_k_ug",
    "vitamin_b1_mg",
    "vitamin_b2_mg",
    "niacin_mg",
    "pantothenic_acid_mg",
    "vitamin_b6_mg",
    "biotin_ug",
    "folate_ug",
    "vitamin_b12_ug",
    "vitamin_c_mg",
    "sodium_mg",
    "chloride_mg",
    "potassium_mg",
    "calcium_mg",
    "phosphorus_mg",
    "magnesium_mg",
    "iron_mg",
    "zinc_mg",
    "copper_mg",
    "manganese_mg",
    "iodine_ug",
    "fluoride_mg",
)


def compute_micronutrient_totals(
    receipt_items: List[dict],
    reference_date: Optional[date] = None,
    window_days: Optional[int] = None,
) -> dict:
    totals = {k: 0.0 for k in _MICRO_KEYS}
    # Per-100g density by name, for top_drivers -- first value wins (same
    # product should report the same density on every purchase), same
    # convention as diversity.py's density-ranked macro drivers.
    density = {k: {} for k in _MICRO_KEYS}
    kcal_total = kcal_with_micros = 0.0
    items_considered = items_with_micros = 0

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
        factor = grams / 100.0
        kcal_contrib = cal * factor
        name = item.get("matched_name") or item.get("name") or "unknown item"

        micros = item.get("micros") or {}
        for key, value in micros.items():
            if key in totals and value is not None:
                totals[key] += value * factor
                # A real reported 0 still counts toward the total (it's a
                # measured amount), but isn't a "driver" of anything -- left
                # in, top_drivers would pad out to 5 entries with items
                # that contribute nothing, rather than honestly showing
                # fewer when fewer than 5 items actually have any.
                if value > 0:
                    density[key].setdefault(name, value)

        kcal_total += kcal_contrib
        items_considered += 1
        if micros:
            kcal_with_micros += kcal_contrib
            items_with_micros += 1

    coverage = round(kcal_with_micros / kcal_total * 100, 1) if kcal_total > 0 else None
    top_drivers = {
        key: [
            {"name": name, "value_per_100g": round(value, 2)}
            for name, value in sorted(density[key].items(), key=lambda kv: kv[1], reverse=True)[:5]
        ]
        for key in _MICRO_KEYS
    }

    return {
        "window_days": window_days,
        "totals": {k: round(v, 2) for k, v in totals.items()},
        "micro_coverage_pct": coverage,
        # Plain item counts behind micro_coverage_pct (not calorie-weighted)
        # -- the UI shows "X/Y purchased items" rather than a %.
        "items_with_micros_count": items_with_micros,
        "items_considered": items_considered,
        "top_drivers": top_drivers,
    }
