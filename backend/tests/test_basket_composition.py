from backend.app.services.basket_composition import _pct_split, compute_basket_composition


def test_pct_split_normalizes_to_kcal_weighted_percentages():
    # 50g protein (200kcal) + 10g fat (90kcal) + 50g carbs (200kcal) = 490 kcal
    split = _pct_split(protein_g=50, fat_g=10, carbs_g=50, kcal_total=490)
    assert split["kcal_total"] == 490
    assert abs(split["protein_pct"] + split["fat_pct"] + split["carb_pct"] - 100) < 0.5


def test_pct_split_returns_none_for_zero_calories():
    assert _pct_split(0, 0, 0, 0) is None


def test_compute_basket_composition_empty_list_returns_none():
    assert compute_basket_composition([]) is None


def test_compute_basket_composition_reads_persisted_nutrition_not_resolver():
    """Uses hand-supplied matched nutrition (the shape persisted onto
    receipt_items at confirm time) rather than going through the resolver
    — composition/comparison/bucketing/diversity all read the *stored*
    match, they don't re-resolve on every analysis request."""

    items = [
        {"name": "Gurke", "quantity": 200, "unit": "g",
         "protein_g": 0.7, "fat_g": 0.2, "carbs_g": 2.0, "calories_kcal": 12},
        {"name": "Banane", "quantity": 1000, "unit": "g",
         "protein_g": 1.1, "fat_g": 0.3, "carbs_g": 23.0, "calories_kcal": 96},
    ]
    composition = compute_basket_composition(items)
    assert composition is not None
    assert composition["items_considered"] == 2
    assert composition["kcal_total"] == round(12 * 2 + 96 * 10, 1)


def test_compute_basket_composition_skips_items_without_calories():
    items = [
        {"name": "Unmatched thing", "quantity": 1, "unit": "piece", "calories_kcal": None},
    ]
    assert compute_basket_composition(items) is None
