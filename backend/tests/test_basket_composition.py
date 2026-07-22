from datetime import date

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


def test_compute_basket_composition_reports_fiber_as_a_density_not_a_pct():
    """Fiber isn't part of the %-of-calories split (see ideal_profile.py's
    FIBER_G_PER_1000KCAL) -- it's reported in the same g-per-1000kcal unit
    as its target so the two are directly comparable."""

    items = [
        {"name": "Haferflocken", "quantity": 500, "unit": "g",
         "protein_g": 13.0, "fat_g": 7.0, "carbs_g": 60.0, "fiber_g": 10.0, "calories_kcal": 370},
    ]
    composition = compute_basket_composition(items)
    assert composition is not None
    # 10g fiber per 100g -> 50g fiber for the 500g purchased; 370kcal/100g -> 1850kcal total
    assert composition["fiber_per_1000kcal"] == round(50 / 1850 * 1000, 1)


def test_unknown_macro_is_not_counted_as_zero():
    """A None macro means 'unknown', not 0 g. Its calories still count
    (kcal_total reflects the purchase) but they must NOT be attributed to a
    macro -- so they surface as unaccounted / lowered macro coverage instead
    of silently dragging the split down as a measured zero."""

    # 100 kcal item, protein known (10 g), fat/carbs unknown.
    items = [
        {"name": "Mystery", "quantity": 100, "unit": "g",
         "protein_g": 10.0, "fat_g": None, "carbs_g": None, "calories_kcal": 100,
         "match_type": "exact"},
    ]
    comp = compute_basket_composition(items)
    assert comp is not None
    # 10 g protein * 4 kcal = 40 of 100 kcal -> 40% protein, fat/carb 0,
    # and the remaining 60% shows as unaccounted rather than fake fat/carb.
    assert comp["protein_pct"] == 40.0
    assert comp["fat_pct"] == 0.0
    assert comp["carb_pct"] == 0.0
    assert comp["unaccounted_pct"] == 60.0
    # Macros incomplete -> this item's calories are not fully macro-covered.
    assert comp["macro_coverage_pct"] == 0.0


def test_coverage_labels_reflect_match_confidence():
    items = [
        {"name": "Solid", "quantity": 100, "unit": "g",
         "protein_g": 5.0, "fat_g": 5.0, "carbs_g": 5.0, "calories_kcal": 100,
         "match_type": "exact"},
        {"name": "Guess", "quantity": 100, "unit": "g",
         "protein_g": 5.0, "fat_g": 5.0, "carbs_g": 5.0, "calories_kcal": 100,
         "match_type": "fallback"},
    ]
    comp = compute_basket_composition(items)
    assert comp is not None
    # Both fully macro-covered; only one is a confident match.
    assert comp["macro_coverage_pct"] == 100.0
    assert comp["match_coverage_pct"] == 50.0


def test_no_reference_date_leaves_split_unweighted():
    """Without a reference_date every item's recency weight is 1.0, so the
    result equals the old lifetime split -- callers that don't opt in are
    unchanged even when items carry dates."""

    items = [
        {"name": "Old", "quantity": 100, "unit": "g", "receipt_id": "r1",
         "protein_g": 25.0, "fat_g": 0.0, "carbs_g": 0.0, "calories_kcal": 100,
         "receipts": {"purchased_at": "2020-01-01"}},
        {"name": "New", "quantity": 100, "unit": "g", "receipt_id": "r2",
         "protein_g": 0.0, "fat_g": 0.0, "carbs_g": 25.0, "calories_kcal": 100,
         "receipts": {"purchased_at": "2026-01-01"}},
    ]
    comp = compute_basket_composition(items)
    assert comp is not None
    # Symmetric items (25g protein vs 25g carb, equal kcal), equal weight ->
    # protein and carb contribute equally despite the 6-year age gap.
    assert comp["protein_pct"] == comp["carb_pct"]


def test_ewma_weights_recent_purchases_more_heavily():
    """With a reference_date, a recent purchase dominates an old one of the
    same calories -- 'alles je gekauft' becomes 'aktuelle Rate'."""

    ref = date(2026, 2, 1)
    items = [
        # Bought ~13 months ago: heavily decayed at a 30-day half-life.
        {"name": "OldProtein", "quantity": 100, "unit": "g", "receipt_id": "r1",
         "protein_g": 25.0, "fat_g": 0.0, "carbs_g": 0.0, "calories_kcal": 100,
         "receipts": {"purchased_at": "2025-01-01"}},
        # Bought on the reference date: full weight.
        {"name": "NewCarb", "quantity": 100, "unit": "g", "receipt_id": "r2",
         "protein_g": 0.0, "fat_g": 0.0, "carbs_g": 25.0, "calories_kcal": 100,
         "receipts": {"purchased_at": "2026-02-01"}},
    ]
    comp = compute_basket_composition(items, reference_date=ref, half_life_days=30.0)
    assert comp is not None
    # The recent carb purchase should dominate the decayed old protein one.
    assert comp["carb_pct"] > comp["protein_pct"]


def test_window_days_drops_purchases_older_than_the_window():
    ref = date(2026, 2, 1)
    items = [
        {"name": "TooOld", "quantity": 100, "unit": "g", "receipt_id": "r1",
         "protein_g": 25.0, "fat_g": 0.0, "carbs_g": 0.0, "calories_kcal": 100,
         "receipts": {"purchased_at": "2025-12-01"}},  # ~62 days -> outside 28d window
        {"name": "Recent", "quantity": 100, "unit": "g", "receipt_id": "r2",
         "protein_g": 0.0, "fat_g": 0.0, "carbs_g": 25.0, "calories_kcal": 100,
         "receipts": {"purchased_at": "2026-01-20"}},  # 12 days -> inside
    ]
    comp = compute_basket_composition(items, reference_date=ref, window_days=28)
    assert comp is not None
    assert comp["items_considered"] == 1  # the old one was dropped
    assert comp["protein_pct"] == 0.0


def test_quantity_coverage_flags_piece_guesses():
    """A 'piece'/missing quantity goes through grams_for's coarse guess; a
    g/ml quantity is a real measurement. quantity_coverage_pct reports the
    measured share so the UI can flag rough weighting."""

    items = [
        {"name": "Measured", "quantity": 200, "unit": "g", "receipt_id": "r1",
         "protein_g": 5.0, "fat_g": 5.0, "carbs_g": 5.0, "calories_kcal": 100,
         "match_type": "exact"},
        {"name": "GuessedPiece", "quantity": 1, "unit": "piece", "receipt_id": "r1",
         "protein_g": 5.0, "fat_g": 5.0, "carbs_g": 5.0, "calories_kcal": 100,
         "match_type": "exact"},
    ]
    comp = compute_basket_composition(items)
    assert comp is not None
    # Measured item = 200g -> 2.0 factor -> 200 kcal; piece = 100g -> 100 kcal.
    # Measured share of kcal = 200 / 300 = 66.7%.
    assert comp["quantity_coverage_pct"] == 66.7


def test_low_confidence_flag_for_few_receipts_or_estimates():
    # One receipt, confident match -> too few receipts => shaky.
    thin = [
        {"name": "Solid", "quantity": 100, "unit": "g", "receipt_id": "r1",
         "protein_g": 5.0, "fat_g": 5.0, "carbs_g": 5.0, "calories_kcal": 100,
         "match_type": "exact"},
    ]
    assert compute_basket_composition(thin)["low_confidence"] is True

    # Three receipts, all confident matches -> solid.
    solid = [
        {"name": f"Item{i}", "quantity": 100, "unit": "g", "receipt_id": f"r{i}",
         "protein_g": 5.0, "fat_g": 5.0, "carbs_g": 5.0, "calories_kcal": 100,
         "match_type": "exact"}
        for i in range(3)
    ]
    comp = compute_basket_composition(solid)
    assert comp["receipts_considered"] == 3
    assert comp["low_confidence"] is False

    # Enough receipts but mostly category estimates -> still shaky.
    estimated = [
        {"name": f"Guess{i}", "quantity": 100, "unit": "g", "receipt_id": f"r{i}",
         "protein_g": 5.0, "fat_g": 5.0, "carbs_g": 5.0, "calories_kcal": 100,
         "match_type": "fallback"}
        for i in range(4)
    ]
    assert compute_basket_composition(estimated)["low_confidence"] is True
