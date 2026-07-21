"""
Diversity operates on the already-persisted receipt_item shape (flat
protein_g/fat_g/carbs_g columns) — no resolver/network involved, so
these tests just build that dict shape directly.
"""

from backend.app.services import diversity


def test_single_protein_source_scores_zero_diversity():
    items = [{"name": "Chicken breast", "quantity": 300, "unit": "g",
              "protein_g": 31, "fat_g": 3.6, "carbs_g": 0, "calories_kcal": 165}]

    result = diversity.compute_diversity(items)
    assert result["protein"]["source_count"] == 1
    assert result["protein"]["top_share_pct"] == 100.0
    assert result["protein"]["diversity_score"] == 0.0
    assert result["recommendations"]  # a single dominant source should be called out


def test_two_protein_sources_score_nonzero_diversity():
    items = [
        {"name": "Chicken breast", "quantity": 150, "unit": "g",
         "protein_g": 31, "fat_g": 3.6, "carbs_g": 0, "calories_kcal": 165},
        {"name": "Lentils", "quantity": 150, "unit": "g",
         "protein_g": 9, "fat_g": 0.4, "carbs_g": 20, "calories_kcal": 116},
    ]

    result = diversity.compute_diversity(items)
    assert result["protein"]["source_count"] == 2
    assert result["protein"]["diversity_score"] > 0


def test_no_contributions_returns_none_metrics():
    items = [{"name": "Water", "quantity": 500, "unit": "ml",
              "protein_g": 0, "fat_g": 0, "carbs_g": 0, "calories_kcal": 0}]

    result = diversity.compute_diversity(items)
    assert result["protein"]["diversity_score"] is None
    assert result["protein"]["source_count"] == 0


def test_items_without_calories_are_skipped():
    items = [{"name": "Unmatched", "quantity": 100, "unit": "g", "calories_kcal": None}]
    result = diversity.compute_diversity(items)
    assert result["protein"]["source_count"] == 0
