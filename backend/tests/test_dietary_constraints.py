"""
Tests for services/dietary_constraints.py -- the diet-style/allergy/
dislike prompt lines shared by recipe generation and gap recommendations.
"""

from backend.app.models.profile import DietaryStyle, Profile
from backend.app.services.dietary_constraints import restriction_lines

_BASE = dict(
    id=1,
    sex="female",
    date_of_birth="1994-03-15",
    height_cm=168,
    weight_kg=64,
    exercise_frequency="three_four",
    daily_movement="mixed",
    goal="maintain",
)


def test_restriction_lines_always_includes_diet_style():
    profile = Profile(**_BASE, dietary_style=DietaryStyle.VEGETARIAN)
    lines = restriction_lines(profile)
    assert "Vegetarian" in lines[0]


def test_restriction_lines_defaults_to_omnivore_when_unset():
    profile = Profile(**_BASE, dietary_style=None)
    lines = restriction_lines(profile)
    assert "No dietary restriction" in lines[0]


def test_restriction_lines_includes_allergies_and_dislikes_when_present():
    profile = Profile(**_BASE, allergies=["peanuts"], dislikes=["mushrooms"])
    lines = restriction_lines(profile)
    assert any("peanuts" in l for l in lines)
    assert any("mushrooms" in l for l in lines)


def test_restriction_lines_omits_allergy_and_dislike_lines_when_empty():
    profile = Profile(**_BASE)
    lines = restriction_lines(profile)
    assert len(lines) == 1
