from backend.app.models.nutrition import MatchType
from backend.app.services.fallback_categories import (
    CATEGORY_NUTRITION,
    FALLBACK_CONFIDENCE,
    _canonical_category,
    fallback_nutrition,
)


def test_canonical_category_from_german_parser_category():
    assert _canonical_category("Milchprodukte", "irrelevant") == "full_fat_dairy"
    assert _canonical_category("Bio Milchprodukte", "irrelevant") == "full_fat_dairy"  # partial contains match


def test_canonical_category_falls_back_to_name_keywords():
    assert _canonical_category(None, "Vollmilch") == "full_fat_dairy"
    assert _canonical_category(None, "something with no food keyword") == "other"


def test_canonical_category_prefers_longest_keyword_match():
    """German compounding means a name can match multiple categories'
    keywords at once (e.g. "Erdnussöl" contains both "erdnuss" and
    "erdnussöl") — the longer, more specific keyword must win regardless
    of which category is checked first."""

    assert _canonical_category(None, "Erdnussöl") == "vegetable_oils"  # not "peanuts"
    assert _canonical_category(None, "Bio Maissnack") == "corn_snacks"  # not "starchy_vegetables"
    assert _canonical_category(None, "Vollkornreis") == "brown_rice"  # not "white_rice"
    assert _canonical_category(None, "Hähnchenbrust Filet") == "lean_poultry"  # not "medium_fat_poultry"
    assert _canonical_category(None, "Schweinefilet") == "medium_fat_red_meat"  # not "fatty_red_meat"


def test_canonical_category_routes_across_food_groups():
    assert _canonical_category(None, "Brokkoli") == "cruciferous_vegetables"
    assert _canonical_category(None, "Bananen") == "tropical_fruits"
    assert _canonical_category(None, "Lachsfilet") == "fatty_fish"
    assert _canonical_category(None, "Vollkornbrot") == "whole_grain_bread"
    assert _canonical_category(None, "Linsen rot") == "lentils"
    assert _canonical_category(None, "Tofu Natur") == "tofu"


def test_fallback_nutrition_is_low_confidence_and_tagged():
    mp = fallback_nutrition("Mystery Item", category=None)
    assert mp.match_type == MatchType.FALLBACK
    assert mp.confidence == FALLBACK_CONFIDENCE
    assert mp.nutrition is not None
    assert mp.fallback_category in CATEGORY_NUTRITION
