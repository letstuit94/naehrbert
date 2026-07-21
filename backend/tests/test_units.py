from backend.app.services.units import normalize_quantity, normalize_unit, piece_weight_grams


def test_normalize_unit_aliases_collapse_to_canonical_set():
    assert normalize_unit("Stk") == "piece"
    assert normalize_unit("Gramm") == "g"
    assert normalize_unit("Liter") == "l"
    assert normalize_unit("cl") == "ml"
    assert normalize_unit(None) == "piece"
    assert normalize_unit("totally-unknown-unit") == "piece"


def test_normalize_quantity_scales_cl_to_ml():
    assert normalize_quantity(5, "cl") == 50.0


def test_normalize_quantity_leaves_1to1_units_unchanged():
    assert normalize_quantity(500, "g") == 500


def test_piece_weight_grams_uses_category_keyword():
    assert piece_weight_grams(category="Eier") == 60.0
    assert piece_weight_grams(category=None, name="Brot") == 500.0
    assert piece_weight_grams(category=None, name="unrecognized thing") == 100.0
