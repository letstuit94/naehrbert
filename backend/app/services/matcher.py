"""
Fuzzy product matcher (Task 2.2).

Takes a (normalized) product string, searches OpenFoodFacts, and picks
the best candidate by name similarity. Returns a MatchedProduct with a
confidence score, or None when no candidate is similar enough — in which
case the caller falls back to category-based nutrition (Task 2.3).

Uses stdlib difflib for similarity, so there is no extra dependency.
"""

from typing import Optional

from backend.app.models.nutrition import MatchedProduct, MatchType, NutritionValues
from backend.app.services import off_api
from backend.app.services.text_similarity import full_ratio, token_similarity

# Similarity thresholds on a 0..1 scale.
EXACT_THRESHOLD = 0.90   # >= this -> treat as an exact match
FUZZY_THRESHOLD = 0.60   # >= this (and < exact) -> fuzzy match; below -> no match


def _has_usable_nutrition(nutrition: NutritionValues) -> bool:
    """True if at least one real macro/energy value is present."""

    return any(
        v is not None
        for v in (
            nutrition.protein_g,
            nutrition.fiber_g,
            nutrition.sugar_g,
            nutrition.calories_kcal,
        )
    )


def match_product(
    name: str,
    page_size: int = 5,
    prefer_low_processed: bool = False,
) -> Optional[MatchedProduct]:
    """
    Resolve one product name to an OpenFoodFacts match.

    Only candidates that clear FUZZY_THRESHOLD *and* carry usable
    nutrition data are considered — a name match with all-null nutrition
    is not useful downstream, so it is rejected (caller then generalises
    or falls back to a category estimate).

    With prefer_low_processed=True (used when retrying a generalised
    produce term), the freshest candidate (lowest NOVA/processed score)
    is preferred over the highest name similarity, so "pfirsich" resolves
    to a fresh peach rather than a peach-flavoured yoghurt.

    Returns None when no candidate qualifies.
    """

    candidates = off_api.search_products(name, page_size=page_size)
    if not candidates:
        return None

    scored = []
    for product in candidates:
        score = token_similarity(name, off_api.product_display_name(product))
        if score < FUZZY_THRESHOLD:
            continue
        nutrition = off_api.extract_nutrition(product)
        if not _has_usable_nutrition(nutrition):
            continue
        # When generalising a produce term, an ultra-processed hit (NOVA 4,
        # e.g. a cucumber spread for "Gurke") is a worse proxy than the
        # category estimate, so drop it and let the caller fall back.
        if (
            prefer_low_processed
            and nutrition.processed_score is not None
            and nutrition.processed_score >= 4
        ):
            continue
        scored.append((score, product, nutrition))

    if not scored:
        return None

    if prefer_low_processed:
        # Freshest first (missing processed score sorts last), then best name match.
        scored.sort(
            key=lambda t: (
                t[2].processed_score if t[2].processed_score is not None else 99,
                -t[0],
            )
        )
    else:
        scored.sort(key=lambda t: -t[0])

    best_score, best_product, best_nutrition = scored[0]
    best_name = off_api.product_display_name(best_product) or None

    # E4-S2 / BR-MT1: acceptance uses token similarity (≥ FUZZY_THRESHOLD),
    # but the "exact" LABEL is gated on the stricter whole-string ratio
    # (≥ 0.90) — a containment-driven token score of 0.9 is not "exact".
    is_exact = best_name is not None and full_ratio(name, best_name) >= EXACT_THRESHOLD
    match_type = MatchType.EXACT if is_exact else MatchType.FUZZY

    brand = (best_product.get("brands") or "").split(",")[0].strip() or None

    return MatchedProduct(
        parsed_item_name=name,
        matched_name=best_name,
        off_id=str(best_product.get("code")) if best_product.get("code") else None,
        fallback_category=None,
        brand=brand,
        match_type=match_type,
        confidence=round(best_score, 3),
        identity_conf=round(best_score, 3),
        nutrition_conf=1.0,  # OFF hit passed the usable-nutrition filter
        data_source="OpenFoodFacts",
        nutrition=best_nutrition,
    )
