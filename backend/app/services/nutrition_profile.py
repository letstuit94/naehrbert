"""
Nutrition profile builder (Task 4.2).

Aggregates a list of matched products (from Epic 2) into one density-based
NutritionProfile. Each item is weighted by its purchased weight in grams,
so 2 kg of potatoes counts more than a 100 g bag of herbs.

Density ratios are computed with *paired* sums: e.g. fiber-per-1000-kcal
uses only the calories of items that actually reported fiber, so items
missing a value don't silently drag that dimension down.
"""

from typing import List

from backend.app.models.nutrition import MatchedProduct, MatchType
from backend.app.models.snapshot import NutritionProfile
from backend.app.services.units import piece_weight_grams

# Units we can convert to grams (volume treated as ~1 g/ml).
_MASS_UNITS = {
    "g": 1.0, "gr": 1.0, "gram": 1.0, "gramm": 1.0,
    "kg": 1000.0,
    "ml": 1.0,
    "l": 1000.0, "ltr": 1000.0, "liter": 1000.0, "litre": 1000.0,
}

def grams_for(quantity, unit, category=None, name=None) -> float:
    """Best-effort conversion of a receipt quantity+unit to grams.

    Mass/volume units convert directly; a "piece" (or any unknown unit)
    uses the category-keyed piece-weight table from services/units.py
    (E3-S3) instead of a single flat fallback, so counted goods like eggs
    vs. loaves of bread get sensible per-piece weights."""

    q = quantity if isinstance(quantity, (int, float)) and quantity > 0 else 1.0
    u = (unit or "").strip().lower()
    if u in _MASS_UNITS:
        return q * _MASS_UNITS[u]
    return q * piece_weight_grams(category, name)


def build_profile(
    items: List[dict],
    matched: List[MatchedProduct],
) -> NutritionProfile:
    """
    Build an aggregated profile. `items` (receipt rows / parser items) and
    `matched` (Epic 2 output) must be aligned by index.
    """

    total_cal = 0.0
    total_grams = 0.0

    prot_sum = prot_cal = 0.0
    fib_sum = fib_cal = 0.0
    sug_sum = sug_cal = 0.0
    proc_weighted = proc_grams = 0.0

    items_with_nutrition = 0
    items_matched = 0
    items_fallback = 0

    for item, mp in zip(items, matched, strict=True):
        grams = grams_for(
            item.get("quantity"), item.get("unit"), item.get("category"), item.get("name")
        )
        factor = grams / 100.0
        total_grams += grams

        if mp.match_type in (MatchType.EXACT, MatchType.FUZZY):
            items_matched += 1
        elif mp.match_type == MatchType.FALLBACK:
            items_fallback += 1

        n = mp.nutrition
        if n is None:
            continue

        if any(v is not None for v in (n.protein_g, n.fiber_g, n.sugar_g, n.calories_kcal)):
            items_with_nutrition += 1

        cal = n.calories_kcal
        cal_contrib = cal * factor if cal is not None else None
        if cal_contrib is not None:
            total_cal += cal_contrib

        # Paired sums: a nutrient only counts (with its calories) when both
        # the nutrient and calories are known for that item.
        if n.protein_g is not None and cal_contrib is not None:
            prot_sum += n.protein_g * factor
            prot_cal += cal_contrib
        if n.fiber_g is not None and cal_contrib is not None:
            fib_sum += n.fiber_g * factor
            fib_cal += cal_contrib
        if n.sugar_g is not None and cal_contrib is not None:
            sug_sum += n.sugar_g * factor
            sug_cal += cal_contrib

        if n.processed_score is not None:
            proc_weighted += n.processed_score * grams
            proc_grams += grams

    fiber_density = round(fib_sum / fib_cal * 1000, 1) if fib_cal > 0 else None
    protein_density = round(prot_sum / prot_cal * 1000, 1) if prot_cal > 0 else None
    # Sugar energy = 4 kcal/g; expressed as a % of the paired calories.
    sugar_pct = round(sug_sum * 4.0 / sug_cal * 100, 1) if sug_cal > 0 else None
    processed_avg = round(proc_weighted / proc_grams, 2) if proc_grams > 0 else None

    return NutritionProfile(
        total_calories_kcal=round(total_cal, 1),
        total_grams=round(total_grams, 1),
        fiber_per_1000kcal=fiber_density,
        protein_per_1000kcal=protein_density,
        sugar_pct_energy=sugar_pct,
        processed_avg=processed_avg,
        items_total=len(items),
        items_with_nutrition=items_with_nutrition,
        items_matched=items_matched,
        items_fallback=items_fallback,
    )
