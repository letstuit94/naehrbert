"""
Match quality logger (Task 2.5 / Story 2.3).

Turns a list of MatchedProduct results into the counts and rates we need
to judge whether the pipeline is good enough for user testing:
total / matched / fallback / failed items, plus match and coverage rates.
"""

from typing import List

from backend.app.models.nutrition import MatchedProduct, MatchQuality, MatchType


def compute_match_quality(products: List[MatchedProduct]) -> MatchQuality:
    total = len(products)

    # LEARNED (Tier-0) and BLS (whole-food identity) are real identity
    # matches too, alongside OFF EXACT/FUZZY — only the category estimate
    # is a "fallback" and NONE is a true miss.
    matched = sum(
        1 for p in products
        if p.match_type in (MatchType.LEARNED, MatchType.EXACT, MatchType.FUZZY, MatchType.BLS)
    )
    fallback = sum(1 for p in products if p.match_type == MatchType.FALLBACK)
    failed = sum(1 for p in products if p.match_type == MatchType.NONE)

    match_rate = round(matched / total, 3) if total else 0.0
    coverage_rate = round((matched + fallback) / total, 3) if total else 0.0

    return MatchQuality(
        total_items=total,
        matched_items=matched,
        fallback_items=fallback,
        failed_items=failed,
        match_rate=match_rate,
        coverage_rate=coverage_rate,
    )
