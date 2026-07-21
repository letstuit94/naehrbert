from backend.app.services.recipe_unlock import UNLOCK_THRESHOLD, count_matched_items


def test_counts_real_matches_and_fallback_categories():
    items = [
        {"is_non_food": False, "matched_name": "Vollmilch 3,5%", "fallback_category": None},
        {"is_non_food": False, "matched_name": None, "fallback_category": "lean_poultry"},
    ]
    assert count_matched_items(items) == 2


def test_excludes_non_food_items():
    items = [{"is_non_food": True, "matched_name": "Pfand", "fallback_category": None}]
    assert count_matched_items(items) == 0


def test_excludes_no_match_found_items():
    """A genuine miss (match_type == 'none', both fields null) taught the
    app nothing about this purchase -- it must not count toward unlocking
    recipes, mirroring frontend/src/lib/matchInfo.ts's `matchInfo()`."""

    items = [{"is_non_food": False, "matched_name": None, "fallback_category": None}]
    assert count_matched_items(items) == 0


def test_threshold_is_fifty():
    assert UNLOCK_THRESHOLD == 50
