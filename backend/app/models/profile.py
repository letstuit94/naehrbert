"""
Profile schema (Epic 1 & 2) — single-user, macro-only.

Written fresh for the clean rebuild rather than porting the old repo's
~420-line models/profile.py, which carried Level-2/next-cart/status-quo
fields out of scope for v1. Enum values and names are kept identical to
the old repo (Sex, Goal, ExerciseFrequency, DailyMovement) so
services/ideal_profile.py's ported formulas work unchanged.
"""

from datetime import date, datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field


class Sex(str, Enum):
    """Sex at birth — the Mifflin-St Jeor BMR term (BR-E1).
    `PREFER_NOT_TO_SAY` uses the mean of the male & female offset."""

    FEMALE = "female"
    MALE = "male"
    PREFER_NOT_TO_SAY = "prefer_not_to_say"


class ExerciseFrequency(str, Enum):
    """Structured exercise per week → EAT added kcal/day (BR-E4)."""

    NONE = "none"
    ONE_TWO = "one_two"
    THREE_FOUR = "three_four"
    FIVE_SIX = "five_six"
    DAILY_ATHLETE = "daily_athlete"


class DailyMovement(str, Enum):
    """Non-exercise daily movement → NEAT as a % of BMR (BR-E3)."""

    MOSTLY_SITTING = "mostly_sitting"
    MIXED = "mixed"
    MOSTLY_STANDING = "mostly_standing"
    PHYSICAL_LABOR = "physical_labor"


class Goal(str, Enum):
    """Primary health goal — drives the calorie adjustment (BR-E6) and the
    protein target (BR-M1). Exactly 3 options per Epic 1."""

    LOSE_WEIGHT_GRADUALLY = "lose_weight_gradually"
    MAINTAIN = "maintain"
    BUILD_MUSCLE = "build_muscle"


# Sane biometric bounds (Epic 1.1 "plausible numeric ranges").
_HEIGHT_CM = Field(ge=100.0, le=250.0)
_WEIGHT_KG = Field(ge=30.0, le=300.0)


class ProfileCreate(BaseModel):
    """The exactly-7-field onboarding form (Epic 1.1). Submitting this
    creates or replaces the single profile row."""

    sex: Sex
    date_of_birth: date
    height_cm: float = _HEIGHT_CM
    weight_kg: float = _WEIGHT_KG
    exercise_frequency: ExerciseFrequency
    daily_movement: DailyMovement
    goal: Goal


class Profile(ProfileCreate):
    """Stored profile, as returned by the API."""

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class IdealProfile(BaseModel):
    """Personalized daily targets produced by the Ideal Profile Engine
    (Epic 2, services/ideal_profile.py). Macro-only — no micronutrients."""

    calories_kcal: int
    protein_g: int
    fat_g: int
    carbs_g: int
    fiber_g: int

    # Energy breakdown (BR-E1..E6), surfaced for transparency/debugging.
    bmr_kcal: int
    neat_kcal: int
    eat_kcal: int
    tef_kcal: int
    tdee_kcal: int

    # BR-M3: True when protein alone (with fat already dropped to its
    # 0.8 g/kg floor and carbs at 0) still meets/exceeds the calorie goal,
    # so the macro split can't be satisfied and the conflict is surfaced
    # rather than showing negative carbs.
    constrained: bool = False

    notes: List[str] = Field(default_factory=list)
