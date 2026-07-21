"""
Bucketing operates on the already-persisted receipt_item shape (flat
protein_g/fat_g/.../micros columns) — no resolver/network involved, so
these tests just build that dict shape directly.
"""

from backend.app.services import bucketing

_NEUTRAL_PCT = {"protein_pct": 20, "fat_pct": 30, "carb_pct": 50}


def _item(name, **nut_kwargs):
    return {"name": name, "quantity": 100, "unit": "g", **nut_kwargs}


def test_high_fiber_low_sugar_low_satfat_buckets_as_consume_more():
    item = _item("Lentils", protein_g=9, fat_g=0.4, carbs_g=20, saturated_fat_g=0.1,
                 fiber_g=8, sugar_g=1, calories_kcal=116, micros={"sodium_mg": 2})

    result = bucketing.compute_buckets([item], _NEUTRAL_PCT, _NEUTRAL_PCT)
    assert result[0]["bucket"] == "consume_more"


def test_high_sugar_high_satfat_low_fiber_buckets_as_consume_less():
    item = _item("Candy bar", protein_g=4, fat_g=25, carbs_g=55, saturated_fat_g=15,
                 fiber_g=1, sugar_g=50, calories_kcal=500, micros={"sodium_mg": 200})

    result = bucketing.compute_buckets([item], _NEUTRAL_PCT, _NEUTRAL_PCT)
    assert result[0]["bucket"] == "consume_less"


def test_missing_nutrition_is_insufficient_data():
    item = {"name": "Unknown thing", "quantity": 1, "unit": "piece"}
    result = bucketing.compute_buckets([item], _NEUTRAL_PCT, _NEUTRAL_PCT)
    assert result[0]["bucket"] == "insufficient_data"


def test_protein_deficit_tips_an_otherwise_borderline_item_to_consume_more():
    """Quality signals alone net to -1 (low fiber, everything else medium)
    -> would be consume_less on quality alone. But this item is
    protein-dense (63% of its calories) and the user is 20pp under their
    protein target, so the macro-gap boost (+1) tips the final score to 0
    -> consume_more. Isolates the macro-gap mechanism from quality scoring."""

    item = {"name": "Chicken breast", "quantity": 150, "unit": "g", "category": "protein",
            "protein_g": 31, "fat_g": 8, "carbs_g": 0, "saturated_fat_g": 1.5,
            "fiber_g": 0, "sugar_g": 3.0, "calories_kcal": 200, "micros": {"sodium_mg": 150}}

    result = bucketing.compute_buckets(
        [item],
        actual_pct={"protein_pct": 10, "fat_pct": 30, "carb_pct": 60},
        target_pct={"protein_pct": 30, "fat_pct": 30, "carb_pct": 40},
    )
    assert result[0]["bucket"] == "consume_more"


def test_tie_defaults_to_consume_more():
    """All four quality signals land in the "medium" band on purpose (net
    score 0), and _NEUTRAL_PCT vs _NEUTRAL_PCT gives a zero macro gap (no
    boost either) -> a deterministic tie, which defaults to consume_more
    since there's no health reason to flag a neutral item for reduction."""

    item = _item("Middling item", protein_g=5, fat_g=8, carbs_g=25, saturated_fat_g=1.556,
                 fiber_g=4, sugar_g=3.5, calories_kcal=200, micros={"sodium_mg": 200})

    result = bucketing.compute_buckets([item], _NEUTRAL_PCT, _NEUTRAL_PCT)
    assert result[0]["bucket"] == "consume_more"
    assert "no strong signal" in result[0]["reason"].lower()
