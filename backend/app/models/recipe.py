"""
Recipe recommendation schema — the "Unlock recipes" feature.

`RecipeSuggestion` is used directly as Groq's structured-output
response_format schema (services/groq_client.py), so its shape IS the
contract the model is forced to return. `model_config = extra="forbid"`
on it and `RecipeIngredient` isn't just validation strictness -- Groq's
strict json_schema mode requires every object in the schema to declare
`additionalProperties: false`, and that's exactly what pydantic emits into
`model_json_schema()` when a model forbids extra fields, so this one
setting does double duty (see services/groq_client.py). Deliberately no
separate "resolved ingredient" / "verified nutrition" type: the calorie/
macro numbers here are the model's own estimate, not re-derived from the
app's OFF/BLS matcher — this is a suggestion the user hasn't shopped for
yet, and once they do, those purchases go through the normal receipt
upload -> matching -> review flow and get logged precisely there, same as
any other purchase.
"""

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from backend.app.models.profile import DietaryStyle


class RecipeIngredient(BaseModel):
    """A single ingredient line. `quantity` is a free-form amount (e.g.
    "200 g", "1 tbsp", "2 cloves") rather than a forced grams-only field —
    natural for cooking instructions and for a future shopping list, and
    lets the model reason in whatever unit actually fits the ingredient."""

    model_config = ConfigDict(extra="forbid")

    name: str
    quantity: str


class RecipeSuggestion(BaseModel):
    """The exact shape the model is forced to return (response_format) --
    `servings` is required here so it's always stated, even when the user
    didn't ask for a specific count."""

    model_config = ConfigDict(extra="forbid")

    title: str
    ingredients: List[RecipeIngredient]
    steps: List[str]
    prep_minutes: int = Field(ge=0)
    cook_minutes: int = Field(ge=0)
    servings: int = Field(ge=1)

    # The model's own estimate for the whole recipe (not per-serving) —
    # see module docstring for why this isn't backend-recomputed.
    calories_kcal: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fiber_g: float = Field(ge=0)

    # The model classifies this itself from the ingredients it actually
    # chose (not simply echoed back from the requested dietary style --
    # see services/recipe_engine.py's prompt) -- reuses profile.py's
    # DietaryStyle since a recipe and a person are classified the same way
    # here (recipe list filter/labels, TipsPage.tsx).
    dietary_label: DietaryStyle


class Recipe(RecipeSuggestion):
    """Stored/returned recipe, as persisted to the `recipes` table.
    `servings`/`dietary_label` are overridden as optional here (unlike the
    required fields on RecipeSuggestion above) only because those columns
    were added after some real rows already existed -- those read back
    with no value rather than needing a backfill.

    Explicitly reverts to the default `extra="ignore"` (rather than
    inheriting RecipeSuggestion's `extra="forbid"`): this model is
    constructed straight from `select("*")` DB rows (e.g. `profile_id`),
    never from an LLM response, so it has no reason to reject columns it
    simply doesn't happen to declare a field for."""

    model_config = ConfigDict(extra="ignore")

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
    """Groq structured-output shape for classifying a recipe's dietary
    label from its ingredient list alone (services/groq_client.py's
    classify_dietary_label) -- used by the one-off backfill script
    (scripts/backfill_recipe_dietary_labels.py) for recipes generated
    before RecipeSuggestion.dietary_label existed. New recipes get their
    label directly from generation instead of this second call."""

    model_config = ConfigDict(extra="forbid")

    dietary_label: DietaryStyle
