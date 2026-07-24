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


class DietaryStyle(str, Enum):
    """How the user eats, for the recipe-recommendation feature — either
    auto-inferred from purchase history (services/dietary_inference.py) or
    corrected by the user in the recipe-preferences chat / Profile page."""

    OMNIVORE = "omnivore"
    PESCATARIAN = "pescatarian"
    VEGETARIAN = "vegetarian"
    VEGAN = "vegan"


# Sane biometric bounds (Epic 1.1 "plausible numeric ranges").
_HEIGHT_CM = Field(ge=100.0, le=250.0)
_WEIGHT_KG = Field(ge=30.0, le=300.0)


class ProfileCreate(BaseModel):
    """The core onboarding form (Epic 1.1) plus `name`. Submitting this
    creates or replaces the single profile row.

    `name` is the one field never used in any BMR/TDEE/macro calculation --
    purely cosmetic, so the chat can address the user and the Profile page
    can show it -- hence optional with no format constraint, unlike the 7
    biometric/goal fields the Ideal Profile Engine actually depends on."""

    name: Optional[str] = None
    sex: Sex
    date_of_birth: date
    height_cm: float = _HEIGHT_CM
    weight_kg: float = _WEIGHT_KG
    exercise_frequency: ExerciseFrequency
    daily_movement: DailyMovement
    goal: Goal

    # Konsum.md Stufe 4 -- collected at the end of onboarding, optional (not
    # yet wired into any calculation -- see Konsum.md for the intended use:
    # scaling absolute purchase-based estimates down to this profile's own
    # share when groceries are shared with a household). Both None for
    # profiles created before these fields existed, same convention as the
    # other optional fields on Profile below.
    household_size: Optional[int] = Field(default=None, ge=1, le=20)
    consumption_share_pct: Optional[float] = Field(default=None, ge=1, le=100)


class Profile(ProfileCreate):
    """Stored profile, as returned by the API.

    `id` is the multi-user feature's login identity: the frontend stores it
    client-side after signup/login and sends it back as X-Profile-Id on
    every request (see backend/app/core/auth.py). Not on `ProfileCreate`
    since it's server-assigned, never client-supplied.

    `dietary_style`/`allergies`/`dislikes` are collected later, in the
    recipe-preferences chat (or edited directly on the Profile page) —
    never during onboarding — so they live only here, not on
    `ProfileCreate`. `recipe_prefs_completed_at` gates whether that chat's
    preference-gathering questions run again (None) or are skipped in
    favor of generating straight from the saved profile (set)."""

    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    dietary_style: Optional[DietaryStyle] = None
    allergies: List[str] = Field(default_factory=list)
    dislikes: List[str] = Field(default_factory=list)
    recipe_prefs_completed_at: Optional[datetime] = None


class ProfileSummary(BaseModel):
    """GET /profiles -- the login screen's "pick a user" directory. Just
    enough to render a button per existing profile; no biometric data."""

    id: int
    name: Optional[str] = None


class DietaryPreferencesUpdate(BaseModel):
    """PATCH /profile/preferences payload — the recipe-preferences chat's
    dietary-style confirmation + allergies + dislikes, saved as a group
    (Profile page edits reuse the same endpoint)."""

    dietary_style: DietaryStyle
    allergies: List[str] = Field(default_factory=list)
    dislikes: List[str] = Field(default_factory=list)


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
