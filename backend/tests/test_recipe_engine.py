"""
No real Gemini/network calls here -- services.gemini_client.generate_recipe_suggestion
is monkeypatched throughout, matching test_api_smoke.py's approach of
patching out the one boundary that would otherwise reach a live service.
"""

import pytest

from backend.app.models.profile import DietaryStyle, Profile
from backend.app.models.recipe import GeminiRecipeSuggestion, RecipeIngredient
from backend.app.services import recipe_engine

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

_GAP = {
    "actual_pct": {"protein": 12.0, "fat": 40.0, "carb": 48.0},
    "target_pct": {"protein_pct": 25.0, "fat_pct": 30.0, "carb_pct": 45.0},
    "delta_pct": {"protein": -13.0, "fat": 10.0, "carb": 3.0},
}


def _suggestion(
    *ingredient_names, prep_minutes=10, cook_minutes=15, servings=2, dietary_label="vegan"
):
    # dietary_label defaults to "vegan" (the most restrictive label) so
    # existing tests -- none of which are testing the diet-compliance check
    # itself -- never accidentally trip it against _PROFILE's "vegetarian".
    return GeminiRecipeSuggestion(
        title="Test recipe",
        ingredients=[RecipeIngredient(name=n, quantity="100 g") for n in ingredient_names],
        steps=["Do the thing."],
        prep_minutes=prep_minutes,
        cook_minutes=cook_minutes,
        servings=servings,
        calories_kcal=500,
        protein_g=30,
        fat_g=20,
        carbs_g=40,
        fiber_g=6,
        dietary_label=dietary_label,
    )


def test_build_prompt_includes_diet_style_allergies_dislikes_and_gap():
    prompt = recipe_engine.build_prompt(_PROFILE, _GAP, ["Your protein comes mostly from one source."])
    assert "Vegetarian" in prompt
    assert "peanuts" in prompt
    assert "mushrooms" in prompt
    assert "UNDER target" in prompt  # protein delta is -13
    assert "protein comes mostly from one source" in prompt


def test_generate_and_assemble_recipe_returns_clean_suggestion(monkeypatch):
    monkeypatch.setattr(
        recipe_engine, "generate_recipe_suggestion", lambda prompt, temperature=0.6: _suggestion("lentils", "spinach")
    )
    result = recipe_engine.generate_and_assemble_recipe(_PROFILE, _GAP, [])
    assert result.title == "Test recipe"
    assert [i.name for i in result.ingredients] == ["lentils", "spinach"]


def test_retries_once_when_first_suggestion_violates_allergy(monkeypatch):
    calls = []

    def fake_generate(prompt, temperature=0.6):
        calls.append(prompt)
        if len(calls) == 1:
            return _suggestion("peanuts", "rice")  # violates the allergy
        return _suggestion("chickpeas", "rice")  # clean retry

    monkeypatch.setattr(recipe_engine, "generate_recipe_suggestion", fake_generate)
    result = recipe_engine.generate_and_assemble_recipe(_PROFILE, _GAP, [])

    assert len(calls) == 2
    assert "peanuts" in calls[1]  # reinforced prompt names the violation
    assert [i.name for i in result.ingredients] == ["chickpeas", "rice"]


def test_raises_when_violation_persists_after_retry(monkeypatch):
    monkeypatch.setattr(
        recipe_engine, "generate_recipe_suggestion", lambda prompt, temperature=0.6: _suggestion("peanuts", "rice")
    )
    with pytest.raises(ValueError):
        recipe_engine.generate_and_assemble_recipe(_PROFILE, _GAP, [])


def test_dislike_is_also_enforced_not_just_allergies(monkeypatch):
    monkeypatch.setattr(
        recipe_engine, "generate_recipe_suggestion", lambda prompt, temperature=0.6: _suggestion("mushrooms", "rice")
    )
    with pytest.raises(ValueError):
        recipe_engine.generate_and_assemble_recipe(_PROFILE, _GAP, [])


def test_build_prompt_includes_cuisine_and_time_budget_when_given():
    prompt = recipe_engine.build_prompt(_PROFILE, _GAP, [], cuisine="Thai", max_time_minutes=30)
    assert "Thai" in prompt
    assert "30 minutes" in prompt


def test_build_prompt_omits_cuisine_and_time_section_when_not_given():
    prompt = recipe_engine.build_prompt(_PROFILE, _GAP, [])
    assert "Cuisine style" not in prompt
    assert "Time budget" not in prompt
    assert "Servings:" not in prompt


def test_build_prompt_includes_servings_when_given():
    prompt = recipe_engine.build_prompt(_PROFILE, _GAP, [], servings=4)
    assert "Servings:" in prompt
    assert "4 servings" in prompt


def test_retries_once_when_suggestion_exceeds_time_budget(monkeypatch):
    calls = []

    def fake_generate(prompt, temperature=0.6):
        calls.append(prompt)
        if len(calls) == 1:
            return _suggestion("lentils", prep_minutes=20, cook_minutes=30)  # 50 min, over budget
        return _suggestion("lentils", prep_minutes=10, cook_minutes=15)  # 25 min, within budget

    monkeypatch.setattr(recipe_engine, "generate_recipe_suggestion", fake_generate)
    result = recipe_engine.generate_and_assemble_recipe(_PROFILE, _GAP, [], max_time_minutes=30)

    assert len(calls) == 2
    assert "exceeds the 30 min budget" in calls[1]
    assert result.prep_minutes + result.cook_minutes == 25


def test_raises_when_time_budget_still_violated_after_retry(monkeypatch):
    monkeypatch.setattr(
        recipe_engine,
        "generate_recipe_suggestion",
        lambda prompt, temperature=0.6: _suggestion("lentils", prep_minutes=20, cook_minutes=30),
    )
    with pytest.raises(ValueError):
        recipe_engine.generate_and_assemble_recipe(_PROFILE, _GAP, [], max_time_minutes=30)


# ── dietary_label compliance (Recipes page labels/filter feature) ─────────
# _PROFILE requests "vegetarian" -- a returned dietary_label less
# restrictive than that (pescatarian/omnivore) is a hard violation, same
# retry-then-raise treatment as allergies/dislikes/time budget. This is the
# one diet_style check that didn't exist before dietary_label: the
# ingredient-keyword check above never covered the diet_style restriction
# itself, only allergies/dislikes layered on top of it.

def test_vegetarian_or_vegan_label_is_compatible_with_a_vegetarian_request(monkeypatch):
    monkeypatch.setattr(
        recipe_engine,
        "generate_recipe_suggestion",
        lambda prompt, temperature=0.6: _suggestion("lentils", dietary_label="vegetarian"),
    )
    result = recipe_engine.generate_and_assemble_recipe(_PROFILE, _GAP, [])
    assert result.dietary_label == "vegetarian"


def test_retries_once_when_label_is_less_restrictive_than_requested_diet(monkeypatch):
    calls = []

    def fake_generate(prompt, temperature=0.6):
        calls.append(prompt)
        if len(calls) == 1:
            return _suggestion("chicken", "rice", dietary_label="omnivore")  # violates vegetarian
        return _suggestion("lentils", "rice", dietary_label="vegetarian")  # clean retry

    monkeypatch.setattr(recipe_engine, "generate_recipe_suggestion", fake_generate)
    result = recipe_engine.generate_and_assemble_recipe(_PROFILE, _GAP, [])

    assert len(calls) == 2
    assert "less restrictive" in calls[1]  # reinforced prompt names the violation
    assert result.dietary_label == "vegetarian"


def test_raises_when_diet_violation_persists_after_retry(monkeypatch):
    monkeypatch.setattr(
        recipe_engine,
        "generate_recipe_suggestion",
        lambda prompt, temperature=0.6: _suggestion("chicken", "rice", dietary_label="omnivore"),
    )
    with pytest.raises(ValueError):
        recipe_engine.generate_and_assemble_recipe(_PROFILE, _GAP, [])


def test_pescatarian_label_is_not_compatible_with_a_vegan_request(monkeypatch):
    vegan_profile = _PROFILE.model_copy(update={"dietary_style": DietaryStyle.VEGAN})
    monkeypatch.setattr(
        recipe_engine,
        "generate_recipe_suggestion",
        lambda prompt, temperature=0.6: _suggestion("salmon", "rice", dietary_label="pescatarian"),
    )
    with pytest.raises(ValueError):
        recipe_engine.generate_and_assemble_recipe(vegan_profile, _GAP, [])
