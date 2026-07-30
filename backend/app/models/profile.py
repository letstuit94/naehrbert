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

from pydantic import BaseModel, Field, field_validator


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


class LifeStage(str, Enum):
    """Pregnancy/nursing status — the DGE's daily micronutrient reference
    values (services/dge_matcher.py) differ materially by this on top of
    age/sex (e.g. Folat 550µg vs 300µg, Eisen 27mg vs 16mg while pregnant).
    Edited on the Profile page, defaults to NONE so existing profiles that
    predate this field keep getting the plain age/sex reference values."""

    NONE = "none"
    PREGNANT_T1 = "pregnant_t1"
    PREGNANT_T2 = "pregnant_t2"
    PREGNANT_T3 = "pregnant_t3"
    NURSING = "nursing"


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

    # Defaults to NONE (not Optional[None]) since "not pregnant/nursing" is
    # itself a meaningful, always-correct default -- unlike household_size/
    # consumption_share_pct above, this is never genuinely "unanswered".
    life_stage: LifeStage = LifeStage.NONE

    @field_validator("life_stage", mode="before")
    @classmethod
    def _null_life_stage_means_none(cls, value):
        # migration 0013 added this column nullable with no backfill, so
        # every profile row that predates it comes back as an *explicit*
        # life_stage=None from the DB -- Pydantic only applies a field's
        # default when the key is missing, not when it's present-but-None,
        # so without this the field default above never actually fires for
        # any pre-existing profile and validation fails outright.
        return LifeStage.NONE if value is None else value


class Profile(ProfileCreate):
    """Stored profile, as returned by the API.

    `id` is this app's own internal identity, resolved server-side from the
    caller's verified Supabase session via `profiles.auth_user_id` (see
    backend/app/core/auth.py) -- never sent by the client. Not on
    `ProfileCreate` since it's server-assigned, never client-supplied.

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
