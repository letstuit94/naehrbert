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
from typing import List, Optional

from pydantic import BaseModel, Field


class RecipeIngredient(BaseModel):
    """A single ingredient line. `quantity` is a free-form amount (e.g.
    "200 g", "1 tbsp", "2 cloves") rather than a forced grams-only field —
    natural for cooking instructions and for a future shopping list, and
    lets Gemini reason in whatever unit actually fits the ingredient."""

    name: str
    quantity: str


class GeminiRecipeSuggestion(BaseModel):
    """The exact shape Gemini is forced to return (response_schema)."""

    title: str
    ingredients: List[RecipeIngredient]
    steps: List[str]
    prep_minutes: int = Field(ge=0)
    cook_minutes: int = Field(ge=0)

    # Gemini's own estimate for the whole recipe (not per-serving) — see
    # module docstring for why this isn't backend-recomputed.
    calories_kcal: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fiber_g: float = Field(ge=0)


class Recipe(GeminiRecipeSuggestion):
    """Stored/returned recipe, as persisted to the `recipes` table."""

    id: str
    created_at: Optional[datetime] = None


class RecipeGenerateRequest(BaseModel):
    """POST /recipes/generate body — the user-facing inputs on the Recipes
    page. Everything else the prompt needs (dietary style, allergies,
    dislikes, nutrient gap) comes from the saved profile/analysis data, not
    from the user typing it in each time."""

    cuisine: Optional[str] = None
    max_time_minutes: Optional[int] = Field(default=None, ge=1)
