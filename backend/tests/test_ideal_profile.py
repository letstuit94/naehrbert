from datetime import date

import pytest

from backend.app.models.profile import DailyMovement, ExerciseFrequency, Goal, ProfileCreate, Sex
from backend.app.services.ideal_profile import compute_ideal_profile, macro_percentages


def _profile(**overrides) -> ProfileCreate:
    defaults = dict(
        sex=Sex.FEMALE,
        date_of_birth=date(1994, 3, 15),
        height_cm=168,
        weight_kg=64,
        exercise_frequency=ExerciseFrequency.THREE_FOUR,
        daily_movement=DailyMovement.MIXED,
        goal=Goal.MAINTAIN,
    )
    defaults.update(overrides)
    return ProfileCreate(**defaults)


@pytest.mark.parametrize("sex", [Sex.FEMALE, Sex.MALE, Sex.PREFER_NOT_TO_SAY])
@pytest.mark.parametrize("goal", [Goal.LOSE_WEIGHT_GRADUALLY, Goal.MAINTAIN, Goal.BUILD_MUSCLE])
@pytest.mark.parametrize("movement", list(DailyMovement))
@pytest.mark.parametrize("exercise", list(ExerciseFrequency))
def test_matrix_always_produces_a_sane_profile(sex, goal, movement, exercise):
    targets = compute_ideal_profile(
        _profile(sex=sex, goal=goal, daily_movement=movement, exercise_frequency=exercise)
    )
    assert targets is not None
    assert targets.calories_kcal > 0
    assert targets.protein_g > 0
    assert targets.fiber_g > 0
    assert targets.fat_g >= 0
    assert targets.carbs_g >= 0
    # BR-Gen: TDEE is the additive sum of its components.
    assert targets.tdee_kcal == targets.bmr_kcal + targets.neat_kcal + targets.eat_kcal + targets.tef_kcal


def test_prefer_not_to_say_bmr_is_the_mean_of_male_and_female():
    female = compute_ideal_profile(_profile(sex=Sex.FEMALE, daily_movement=DailyMovement.MOSTLY_SITTING,
                                             exercise_frequency=ExerciseFrequency.NONE))
    male = compute_ideal_profile(_profile(sex=Sex.MALE, daily_movement=DailyMovement.MOSTLY_SITTING,
                                           exercise_frequency=ExerciseFrequency.NONE))
    neutral = compute_ideal_profile(_profile(sex=Sex.PREFER_NOT_TO_SAY, daily_movement=DailyMovement.MOSTLY_SITTING,
                                              exercise_frequency=ExerciseFrequency.NONE))
    assert neutral.bmr_kcal == round((female.bmr_kcal + male.bmr_kcal) / 2)


def test_lose_weight_reduces_calories_vs_maintain():
    maintain = compute_ideal_profile(_profile(goal=Goal.MAINTAIN))
    lose = compute_ideal_profile(_profile(goal=Goal.LOSE_WEIGHT_GRADUALLY))
    build = compute_ideal_profile(_profile(goal=Goal.BUILD_MUSCLE))
    assert lose.calories_kcal < maintain.calories_kcal < build.calories_kcal


def test_worked_example_tdee_matches_an_independent_hand_computation():
    """Rounding each energy component to whole kcal before summing (rather
    than carrying float precision through) must reproduce an exact
    additive relationship. Verified against an independent hand-computation
    of the same inputs (not just re-deriving the module's own formula) so
    this catches a real regression rather than only testing itself.

    Age is computed from `date.today()` (matching _age_from_dob's own
    real-clock behavior) rather than hardcoded, since BMR is age-dependent
    and a fixed literal would silently go stale."""

    dob = date(1990, 1, 1)
    targets = compute_ideal_profile(
        ProfileCreate(
            sex=Sex.MALE, date_of_birth=dob, height_cm=180, weight_kg=80,
            exercise_frequency=ExerciseFrequency.ONE_TWO, daily_movement=DailyMovement.MIXED,
            goal=Goal.MAINTAIN,
        )
    )
    today = date.today()
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    expected_bmr = round(10 * 80 + 6.25 * 180 - 5 * age + 5)
    expected_neat = round(expected_bmr * 0.10)  # MIXED movement
    expected_eat = 100  # ONE_TWO exercise
    expected_tef = round(0.10 * (expected_bmr + expected_neat + expected_eat))
    expected_tdee = expected_bmr + expected_neat + expected_eat + expected_tef

    assert targets.bmr_kcal == expected_bmr
    assert targets.tdee_kcal == expected_tdee


def test_constrained_flag_set_instead_of_negative_carbs():
    """A deliberately extreme synthetic profile (not a realistic user) that
    forces protein + the 0.8 g/kg fat floor to exceed the calorie budget,
    to exercise BR-M3's constrained branch."""

    targets = compute_ideal_profile(
        ProfileCreate(
            sex=Sex.MALE, date_of_birth=date(1900, 1, 1), height_cm=100, weight_kg=30,
            exercise_frequency=ExerciseFrequency.NONE, daily_movement=DailyMovement.MOSTLY_SITTING,
            goal=Goal.BUILD_MUSCLE,
        )
    )
    assert targets.constrained is True
    assert targets.carbs_g == 0
    assert targets.notes  # explains the constraint


def test_missing_biometrics_returns_none():
    # sex/DOB/height/weight are all required by ProfileCreate itself, so
    # "incomplete" can only be simulated post-construction here.
    profile = _profile()
    profile.weight_kg = 0
    assert compute_ideal_profile(profile) is None


def test_macro_percentages_sum_close_to_100():
    targets = compute_ideal_profile(_profile())
    pct = macro_percentages(targets)
    assert abs(sum(pct.values()) - 100) < 1.0
