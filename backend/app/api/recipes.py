"""
Recipe recommendations -- unlock progress, dietary-style inference, and
Gemini-backed recipe generation.

Reuses analysis.py's get_target_comparison/get_diversity directly (they're
plain functions FastAPI happens to also expose as routes) rather than
re-deriving the same macro-gap computation here -- one source of truth for
"what's the current gap", same as every other consumer of that data.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from backend.app.api.analysis import get_diversity, get_target_comparison
from backend.app.core.auth import require_profile_id
from backend.app.db import repo
from backend.app.models.profile import Profile
from backend.app.models.recipe import Recipe, RecipeFeedbackUpdate, RecipeGenerateRequest
from backend.app.services.dietary_inference import infer_dietary_style
from backend.app.services.gemini_client import GeminiNotConfigured
from backend.app.services.recipe_engine import generate_and_assemble_recipe
from backend.app.services.recipe_unlock import UNLOCK_THRESHOLD, count_matched_items

router = APIRouter(prefix="/recipes", tags=["recipes"])


def _owned_recipe_or_404(recipe_id: str, profile_id: int) -> dict:
    """Every by-id endpoint below fetches the recipe anyway (to check
    ownership) -- mirrors receipts.py's _owned_receipt_or_404 so recipe A's
    owner can't act on recipe B by guessing its uuid."""

    recipe = repo.get_recipe(recipe_id)
    if not recipe or recipe.get("profile_id") != profile_id:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return recipe


@router.get("/unlock-status")
def get_unlock_status(profile_id: int = Depends(require_profile_id)):
    """Results page's "Unlock recipes" progress bar / button."""

    items = repo.get_all_confirmed_receipt_items(profile_id)
    matched = count_matched_items(items)
    stored = repo.get_profile(profile_id)
    return {
        "matched_items_count": matched,
        "threshold": UNLOCK_THRESHOLD,
        "unlocked": matched >= UNLOCK_THRESHOLD,
        "prefs_completed": bool(stored and stored.get("recipe_prefs_completed_at")),
    }


@router.get("/inferred-dietary-style")
def get_inferred_dietary_style(profile_id: int = Depends(require_profile_id)):
    """First guess shown in the recipe-preferences chat, for the user to
    confirm or correct -- never saved without that confirmation."""

    items = repo.get_all_confirmed_receipt_items(profile_id)
    return {"dietary_style": infer_dietary_style(items)}


@router.post("/generate")
def generate_recipe(
    payload: RecipeGenerateRequest = RecipeGenerateRequest(),
    profile_id: int = Depends(require_profile_id),
):
    """Triggered from the Recipes page only -- the recipe-preferences chat
    (recipes/new) just collects NPS feedback + dietary style/allergies/
    dislikes and never generates anything itself. `cuisine`/
    `max_time_minutes`/`servings` are the only per-generation inputs the
    user gives; everything else (dietary style, allergies, dislikes, the
    nutrient gap) comes from the saved profile/analysis data by design."""

    stored = repo.get_profile(profile_id)
    if not stored:
        raise HTTPException(status_code=404, detail="No profile yet")
    profile = Profile(**stored)

    # get_target_comparison() raises its own 404/422 if there's no profile
    # or the targets are incomplete -- propagates unchanged.
    gap = get_target_comparison(profile_id)
    diversity = get_diversity(profile_id)

    try:
        suggestion = generate_and_assemble_recipe(
            profile,
            gap,
            diversity.get("recommendations", []),
            cuisine=payload.cuisine,
            max_time_minutes=payload.max_time_minutes,
            servings=payload.servings,
        )
    except GeminiNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    row = repo.insert_recipe(profile_id, suggestion.model_dump(mode="json"))
    return Recipe(**row)


@router.get("")
def list_recipes(profile_id: int = Depends(require_profile_id)):
    return [Recipe(**row) for row in repo.get_all_recipes(profile_id)]


@router.patch("/{recipe_id}/feedback")
def set_recipe_feedback(
    recipe_id: str,
    payload: RecipeFeedbackUpdate,
    profile_id: int = Depends(require_profile_id),
):
    """Recipes page's thumbs up/down -- separate from user_feedback's NPS
    score (see models/recipe.py's docstring): this is a per-recipe rating,
    not a general app-satisfaction one. Tapping the already-active thumb
    again sends feedback=None to clear it."""

    _owned_recipe_or_404(recipe_id, profile_id)
    updated = repo.update_recipe(recipe_id, {"feedback": payload.feedback})
    return Recipe(**updated)


@router.delete("/{recipe_id}", status_code=204)
def archive_recipe(recipe_id: str, profile_id: int = Depends(require_profile_id)):
    """Recipes page's "X" button -- soft-delete (archived_at), not a hard
    row delete, so a rated/generated recipe isn't lost outright. Excluded
    from get_all_recipes from then on."""

    _owned_recipe_or_404(recipe_id, profile_id)
    repo.update_recipe(recipe_id, {"archived_at": datetime.now(timezone.utc).isoformat()})
