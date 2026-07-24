"""
Recipe recommendation schema — the "Unlock recipes" feature.

`GeminiRecipeSuggestion` is used directly as the Gemini structured-output
response_schema (services/gemini_client.py), so its shape IS the contract
the model is forced to return. Deliberately no separate "resolved
ingredient" / "verified nutrition" type: the calorie/macro numbers here are
Gemini's own estimate, not re-derived from the app's OFF/BLS matcher —
this is a suggestion the user hasn't shopped for yet, and once they do,
those purchases go through the normal receipt upload -> matching -> review
flow and get logged precisely there, same as any other purchase.
"""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from backend.app.models.profile import DietaryStyle


class RecipeIngredient(BaseModel):
    """A single ingredient line. `quantity` is a free-form amount (e.g.
    "200 g", "1 tbsp", "2 cloves") rather than a forced grams-only field —
    natural for cooking instructions and for a future shopping list, and
    lets Gemini reason in whatever unit actually fits the ingredient."""

    name: str
    quantity: str


class GeminiRecipeSuggestion(BaseModel):
    """The exact shape Gemini is forced to return (response_schema) --
    `servings` is required here so Gemini always states it, even when the
    user didn't ask for a specific count."""

    title: str
    ingredients: List[RecipeIngredient]
    steps: List[str]
    prep_minutes: int = Field(ge=0)
    cook_minutes: int = Field(ge=0)
    servings: int = Field(ge=1)

    # Gemini's own estimate for the whole recipe (not per-serving) — see
    # module docstring for why this isn't backend-recomputed.
    calories_kcal: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fiber_g: float = Field(ge=0)

    # Gemini classifies this itself from the ingredients it actually chose
    # (not simply echoed back from the requested dietary style -- see
    # services/recipe_engine.py's prompt) -- reuses profile.py's DietaryStyle
    # since a recipe and a person are classified the same way here (recipe
    # list filter/labels, TipsPage.tsx).
    dietary_label: DietaryStyle


class Recipe(GeminiRecipeSuggestion):
    """Stored/returned recipe, as persisted to the `recipes` table.
    `servings`/`dietary_label` are overridden as optional here (unlike the
    required fields on GeminiRecipeSuggestion above) only because those
    columns were added after some real rows already existed -- those read
    back with no value rather than needing a backfill."""

    id: str
    created_at: Optional[datetime] = None
    servings: Optional[int] = Field(default=None, ge=1)
    dietary_label: Optional[DietaryStyle] = None

    # Thumbs up/down (recipe recommendations feature) -- set via
    # PATCH /recipes/{id}/feedback, None until the user rates it.
    feedback: Optional[Literal["up", "down"]] = None
    archived_at: Optional[datetime] = None


class RecipeGenerateRequest(BaseModel):
    """POST /recipes/generate body — the user-facing inputs on the Recipes
    page. Everything else the prompt needs (dietary style, allergies,
    dislikes, nutrient gap) comes from the saved profile/analysis data, not
    from the user typing it in each time."""

    cuisine: Optional[str] = None
    max_time_minutes: Optional[int] = Field(default=None, ge=1)
    servings: Optional[int] = Field(default=None, ge=1)


class RecipeFeedbackUpdate(BaseModel):
    """PATCH /recipes/{id}/feedback body -- thumbs up/down on this specific
    recipe. `None` clears it (tapping the already-active thumb again)."""

    feedback: Optional[Literal["up", "down"]] = None


class DietaryLabelClassification(BaseModel):
    """Gemini structured-output shape for classifying a recipe's dietary
    label from its ingredient list alone (services/gemini_client.py's
    classify_dietary_label) -- used by the one-off backfill script
    (scripts/backfill_recipe_dietary_labels.py) for recipes generated
    before GeminiRecipeSuggestion.dietary_label existed. New recipes get
    their label directly from generation instead of this second call."""

    dietary_label: DietaryStyle
