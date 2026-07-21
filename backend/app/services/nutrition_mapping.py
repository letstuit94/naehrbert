"""
Persists the tiered resolver's (Epic 4) output onto a receipt_item row.

Originally also carried a `map_items`/`compute_receipt_totals` orchestrator
(ported close to the old repo's shape), but nothing called it once Epic 5/6
were wired to read each item's *already-persisted* matched nutrition
instead of re-resolving on every analysis request — see
basket_composition.py's docstring. Trimmed to what's actually used:
flattening one resolved item for storage (api/receipts.py's confirm/correct
endpoints, and the dev seed script).
"""

from backend.app.models.nutrition import MatchedProduct


def matched_product_to_row(mp: MatchedProduct) -> dict:
    """Flatten a MatchedProduct (+ its nested NutritionValues) into the
    column shape receipt_items stores (Epic 4.1)."""

    row = {
        "match_type": mp.match_type.value,
        "confidence": mp.confidence,
        "identity_conf": mp.identity_conf,
        "nutrition_conf": mp.nutrition_conf,
        "unknown": mp.unknown,
        "data_source": mp.data_source,
        "matched_name": mp.matched_name,
        "brand": mp.brand,
        "off_id": mp.off_id,
        "bls_code": mp.bls_code,
        "fallback_category": mp.fallback_category,
    }
    nut = mp.nutrition
    if nut is not None:
        row.update({
            "protein_g": nut.protein_g,
            "fat_g": nut.fat_g,
            "carbs_g": nut.carbs_g,
            "saturated_fat_g": nut.saturated_fat_g,
            "fiber_g": nut.fiber_g,
            "sugar_g": nut.sugar_g,
            "calories_kcal": nut.calories_kcal,
            "processed_score": nut.processed_score,
            "iron_mg": nut.iron_mg,
            "calcium_mg": nut.calcium_mg,
            "micros": nut.micros,
            "sources": nut.sources,
        })
    return row
