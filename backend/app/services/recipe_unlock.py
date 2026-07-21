"""
Recipe-unlock progress (recipe-recommendations feature) — the Results
page's "Unlock recipes" section counts toward this threshold.

A "matched" item mirrors frontend/src/lib/matchInfo.ts exactly: food
(non-non-food) items with either a real database match (`matched_name`)
or a category-level fallback estimate (`fallback_category`) count: only
a genuine "no match found at all" (match_type == 'none', both fields
null) is excluded, since that's not something the user's grocery habits
actually taught the app anything about.
"""

from typing import List

UNLOCK_THRESHOLD = 50


def count_matched_items(items: List[dict]) -> int:
    return sum(
        1
        for item in items
        if not item.get("is_non_food")
        and (item.get("matched_name") is not None or item.get("fallback_category") is not None)
    )
