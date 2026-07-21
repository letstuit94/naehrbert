"""
Aggregated nutrition profile shape, ported from the old repo's
models/snapshot.py. Only `NutritionProfile` is used transitively (by
services/nutrition_profile.py) — the old file's Gap/DimensionSnapshot/
NutritionSnapshot classes belonged to a snapshot/gap-dashboard feature
that isn't part of this rebuild's scope, so they're dropped here.
"""

from typing import Optional

from pydantic import BaseModel


class NutritionProfile(BaseModel):
    """
    Aggregated, density-based nutrition picture across all analysed items.
    Values are day-agnostic ratios so they can be compared to standard
    references without knowing how many days the basket covers.
    """

    total_calories_kcal: float
    total_grams: float
    fiber_per_1000kcal: Optional[float] = None
    protein_per_1000kcal: Optional[float] = None
    sugar_pct_energy: Optional[float] = None
    processed_avg: Optional[float] = None

    items_total: int
    items_with_nutrition: int
    items_matched: int   # exact or fuzzy OFF match
    items_fallback: int  # category estimate
