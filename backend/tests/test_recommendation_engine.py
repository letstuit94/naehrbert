"""
No real Groq/network calls here -- services.groq_client.generate_gap_recommendations
is monkeypatched throughout, matching test_recipe_engine.py's approach.
"""

from backend.app.models.profile import DietaryStyle, Profile
from backend.app.models.recommendation import GapRecommendationItem, GapRecommendations
from backend.app.services import recommendation_engine

_PROFILE = Profile(
    id=1,
    sex="female",
    date_of_birth="1994-03-15",
    height_cm=168,
    weight_kg=64,
    exercise_frequency="three_four",
    daily_movement="mixed",
    goal="maintain",
    dietary_style=DietaryStyle.VEGETARIAN,
    allergies=["peanuts"],
    dislikes=["mushrooms"],
)

_MACRO_GAP = {
    "actual_pct": {"protein": 12.0, "fat": 40.0, "carb": 48.0},
    "target_pct": {"protein_pct": 25.0, "fat_pct": 30.0, "carb_pct": 45.0},
    "delta_pct": {"protein": -13.0, "fat": 10.0, "carb": 3.0},
}
_MICRO_TOTALS = {"iron_mg": 2.0}
_MICRO_TARGETS = {"iron_mg": 20.0}


def _result(*suggestions):
    return GapRecommendations(
        summary="Test summary.",
        items=[GapRecommendationItem(focus="protein", suggestion=s) for s in suggestions],
    )


def test_build_prompt_includes_diet_style_and_gaps():
    prompt = recommendation_engine.build_prompt(_PROFILE, _MACRO_GAP, _MICRO_TOTALS, _MICRO_TARGETS, 28)
    assert "Vegetarian" in prompt
    assert "peanuts" in prompt
    assert "UNDER target" in prompt  # protein delta is -13
    assert "Iron" in prompt


def test_build_prompt_includes_the_quick_wins_templates():
    prompt = recommendation_engine.build_prompt(_PROFILE, _MACRO_GAP, _MICRO_TOTALS, _MICRO_TARGETS, 28)
    assert "Quick Wins" in prompt
    assert "Add <food(s)> to your diet to achieve" in prompt
    assert "Consider dropping <food/" in prompt


def test_build_prompt_never_surfaces_excluded_micronutrients_even_with_severe_shortfalls():
    totals = {"vitamin_d_ug": 0.0, "iodine_ug": 0.0, "fluoride_mg": 0.0, "sodium_mg": 0.0}
    targets = {"vitamin_d_ug": 20.0, "iodine_ug": 200.0, "fluoride_mg": 3.5, "sodium_mg": 1500.0}
    prompt = recommendation_engine.build_prompt(_PROFILE, {}, totals, targets, 28)
    assert "Vitamin D" not in prompt
    assert "Iodine" not in prompt
    assert "Fluoride" not in prompt
    assert "Sodium" not in prompt  # 0% coverage -- low sodium is never flagged either


def test_build_prompt_falls_back_to_general_guidance_with_no_gap_data():
    prompt = recommendation_engine.build_prompt(_PROFILE, {}, {}, None, 28)
    assert "general, balanced dietary guidance" in prompt


def test_generate_recommendations_returns_clean_result(monkeypatch):
    monkeypatch.setattr(
        recommendation_engine,
        "generate_gap_recommendations",
        lambda prompt, temperature=0.4: _result("Eat more lentils."),
    )
    result = recommendation_engine.generate_recommendations(
        _PROFILE, _MACRO_GAP, _MICRO_TOTALS, _MICRO_TARGETS, 28
    )
    assert result.summary == "Test summary."
    assert result.items[0].suggestion == "Eat more lentils."


def test_generate_recommendations_retries_once_on_allergy_mention(monkeypatch):
    calls = []

    def fake_generate(prompt, temperature=0.4):
        calls.append(prompt)
        if len(calls) == 1:
            return _result("Add peanuts for protein.")
        return _result("Add lentils for protein.")

    monkeypatch.setattr(recommendation_engine, "generate_gap_recommendations", fake_generate)
    result = recommendation_engine.generate_recommendations(
        _PROFILE, _MACRO_GAP, _MICRO_TOTALS, _MICRO_TARGETS, 28
    )
    assert len(calls) == 2
    assert "peanuts" in calls[1]  # reinforced prompt names the violation
    assert result.items[0].suggestion == "Add lentils for protein."


def test_generate_recommendations_never_raises_if_allergy_mention_persists(monkeypatch):
    """Unlike recipe_engine, this is advisory text, not something cooked
    and eaten -- a persistent violation degrades to "proceed anyway", not
    a hard failure."""

    monkeypatch.setattr(
        recommendation_engine,
        "generate_gap_recommendations",
        lambda prompt, temperature=0.4: _result("Add peanuts for protein."),
    )
    result = recommendation_engine.generate_recommendations(
        _PROFILE, _MACRO_GAP, _MICRO_TOTALS, _MICRO_TARGETS, 28
    )
    assert result.items[0].suggestion == "Add peanuts for protein."


def test_generate_recommendations_skips_allergy_check_when_none_set(monkeypatch):
    profile = _PROFILE.model_copy(update={"allergies": []})
    calls = []
    monkeypatch.setattr(
        recommendation_engine,
        "generate_gap_recommendations",
        lambda prompt, temperature=0.4: calls.append(1) or _result("Add peanuts for protein."),
    )
    recommendation_engine.generate_recommendations(profile, _MACRO_GAP, _MICRO_TOTALS, _MICRO_TARGETS, 28)
    assert len(calls) == 1  # no retry triggered
