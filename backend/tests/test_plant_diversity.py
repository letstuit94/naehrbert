from datetime import date, timedelta

from backend.app.services.plant_diversity import (
    PLANT_DIVERSITY_TARGET,
    compute_plant_diversity,
)

REF = date(2026, 7, 24)


def _item(name, category, days_ago, matched_name=None):
    purchased = (REF - timedelta(days=days_ago)).isoformat()
    return {
        "name": name,
        "matched_name": matched_name,
        "category": category,
        "receipts": {"purchased_at": purchased},
    }


def test_counts_distinct_plants_across_qualifying_groups():
    items = [
        _item("Apfel", "pome_fruits", 1),
        _item("Banane", "tropical_fruits", 2),
        _item("Karotte", "root_vegetables_nonstarchy", 3),
        _item("Quinoa", "whole_grains", 4),
        _item("Linsen", "lentils", 5),
        _item("Walnuss", "tree_nuts", 6),
        _item("Basilikum", "fresh_herbs", 7),
    ]
    result = compute_plant_diversity(items, reference_date=REF)
    assert result["count"] == 7
    assert result["target"] == PLANT_DIVERSITY_TARGET
    assert result["window_days"] == 28


def test_non_plant_categories_are_excluded():
    items = [
        _item("Apfel", "pome_fruits", 1),
        _item("Gouda", "hard_and_semi_hard_cheese", 1),
        _item("Hähnchenbrust", "lean_poultry", 1),
        _item("Olivenöl", "vegetable_oils", 1),
        _item("Tofu", "tofu", 1),  # plant-derived, but deliberately excluded -- see module docstring
    ]
    assert compute_plant_diversity(items, reference_date=REF)["count"] == 1


def test_items_older_than_the_window_are_excluded():
    items = [
        _item("Apfel", "pome_fruits", 27),   # inside 28 days
        _item("Banane", "tropical_fruits", 29),  # outside
    ]
    assert compute_plant_diversity(items, reference_date=REF)["count"] == 1


def test_undated_items_are_excluded():
    """Unlike basket_composition's window_days (which leaves undated items
    in), this count exists specifically to answer 'how many in the last 28
    days' -- an item we can't date can't be credited to that window."""

    items = [{"name": "Mystery fruit", "category": "berries", "receipts": {}}]
    assert compute_plant_diversity(items, reference_date=REF)["count"] == 0


def test_same_plant_bought_repeatedly_counts_once():
    items = [
        _item("Apfel", "pome_fruits", 1),
        _item("apfel", "pome_fruits", 5),  # different casing, different receipt
        _item(" Apfel ", "pome_fruits", 10),  # stray whitespace
    ]
    assert compute_plant_diversity(items, reference_date=REF)["count"] == 1


def test_different_plants_in_the_same_category_both_count():
    """pome_fruits lumps apples and pears into one leaf category -- a real
    limitation of category-level data -- but matched_name/name still tells
    them apart, so both should count as distinct plants."""

    items = [
        _item("Apfel", "pome_fruits", 1, matched_name="Apfel roh"),
        _item("Birne", "pome_fruits", 1, matched_name="Birne roh"),
    ]
    assert compute_plant_diversity(items, reference_date=REF)["count"] == 2


def test_matched_name_preferred_over_raw_name_for_identity():
    items = [
        _item("ROTE APFEL BIO 6ST", "pome_fruits", 1, matched_name="Apfel roh"),
        _item("Apfel", "pome_fruits", 5, matched_name="Apfel roh"),
    ]
    assert compute_plant_diversity(items, reference_date=REF)["count"] == 1


def test_empty_list_returns_zero_count():
    result = compute_plant_diversity([], reference_date=REF)
    assert result["count"] == 0
    assert result["target"] == PLANT_DIVERSITY_TARGET


def test_custom_window_days_is_respected():
    items = [
        _item("Apfel", "pome_fruits", 5),
        _item("Banane", "tropical_fruits", 10),
    ]
    result = compute_plant_diversity(items, reference_date=REF, window_days=7)
    assert result["count"] == 1
    assert result["window_days"] == 7


def test_items_list_matches_count_and_carries_group_labels():
    items = [
        _item("Apfel", "pome_fruits", 1, matched_name="Apfel roh"),
        _item("Karotte", "root_vegetables_nonstarchy", 2),
        _item("Quinoa", "whole_grains", 3),
        _item("Linsen", "lentils", 4),
        _item("Walnuss", "tree_nuts", 5),
        _item("Basilikum", "fresh_herbs", 6),
    ]
    result = compute_plant_diversity(items, reference_date=REF)
    assert len(result["items"]) == result["count"] == 6
    by_name = {entry["name"]: entry["group"] for entry in result["items"]}
    assert by_name == {
        "Apfel roh": "Fruits",
        "Karotte": "Vegetables",
        "Quinoa": "Whole grains",
        "Linsen": "Legumes",
        "Walnuss": "Nuts & seeds",
        "Basilikum": "Herbs & spices",
    }


def test_items_list_is_sorted_by_group_then_name():
    items = [
        _item("Zucchini", "fruiting_vegetables", 1),
        _item("Banane", "tropical_fruits", 1),
        _item("Apfel", "pome_fruits", 1),
        _item("Karotte", "root_vegetables_nonstarchy", 1),
    ]
    result = compute_plant_diversity(items, reference_date=REF)
    ordered = [(entry["group"], entry["name"]) for entry in result["items"]]
    assert ordered == [
        ("Fruits", "Apfel"),
        ("Fruits", "Banane"),
        ("Vegetables", "Karotte"),
        ("Vegetables", "Zucchini"),
    ]


def test_items_list_deduplicates_same_plant():
    items = [
        _item("Apfel", "pome_fruits", 1),
        _item("apfel", "pome_fruits", 5),
        _item(" Apfel ", "pome_fruits", 10),
    ]
    result = compute_plant_diversity(items, reference_date=REF)
    assert result["items"] == [{"name": "Apfel", "group": "Fruits"}]
