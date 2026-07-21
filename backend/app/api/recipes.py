"""
Recipe recommendations -- unlock progress, dietary-style inference, and
Gemini-backed recipe generation.

Reuses analysis.py's get_target_comparison/get_diversity directly (they're
plain functions FastAPI happens to also expose as routes) rather than
re-deriving the same macro-gap computation here -- one source of truth for
"what's the current gap", same as every other consumer of that data.
"""

from fastapi import APIRouter, HTTPException

from backend.app.api.analysis import get_diversity, get_target_comparison
from backend.app.db import repo
from backend.app.models.profile import Profile
from backend.app.models.recipe import Recipe, RecipeGenerateRequest
from backend.app.services.dietary_inference import infer_dietary_style
from backend.app.services.gemini_client import GeminiNotConfigured
from backend.app.services.recipe_engine import generate_and_assemble_recipe
from backend.app.services.recipe_unlock import UNLOCK_THRESHOLD, count_matched_items

router = APIRouter(prefix="/recipes", tags=["recipes"])


@router.get("/unlock-status")
def get_unlock_status():
    """Results page's "Unlock recipes" progress bar / button."""

    items = repo.get_all_confirmed_receipt_items()
    matched = count_matched_items(items)
    stored = repo.get_profile()
    return {
        "matched_items_count": matched,
        "threshold": UNLOCK_THRESHOLD,
        "unlocked": matched >= UNLOCK_THRESHOLD,
        "prefs_completed": bool(stored and stored.get("recipe_prefs_completed_at")),
    }


@router.get("/inferred-dietary-style")
def get_inferred_dietary_style():
    """First guess shown in the recipe-preferences chat, for the user to
    confirm or correct -- never saved without that confirmation."""

    items = repo.get_all_confirmed_receipt_items()
    return {"dietary_style": infer_dietary_style(items)}


@router.post("/generate")
def generate_recipe(payload: RecipeGenerateRequest = RecipeGenerateRequest()):
    """Triggered from the Recipes page only -- the recipe-preferences chat
    (recipes/new) just collects NPS feedback + dietary style/allergies/
    dislikes and never generates anything itself. `cuisine`/
    `max_time_minutes`/`servings` are the only per-generation inputs the
    user gives; everything else (dietary style, allergies, dislikes, the
    nutrient gap) comes from the saved profile/analysis data by design."""

    stored = repo.get_profile()
    if not stored:
        raise HTTPException(status_code=404, detail="No profile yet")
    profile = Profile(**stored)

    # get_target_comparison() raises its own 404/422 if there's no profile
    # or the targets are incomplete -- propagates unchanged.
    gap = get_target_comparison()
    diversity = get_diversity()

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

    row = repo.insert_recipe(suggestion.model_dump(mode="json"))
    return Recipe(**row)


@router.get("")
def list_recipes():
    return [Recipe(**row) for row in repo.get_all_recipes()]
