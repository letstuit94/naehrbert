"""
Insights page gap-closing recommendations -- Groq-generated advice for
closing the current macro gap (analysis.py's get_target_comparison) and
micronutrient gap (get_micronutrients), respecting the profile's dietary
style/allergies/dislikes.

Kept in its own file (like recipes.py) rather than folded into
analysis.py, which stays pure-analysis -- this is generation, the same
separation of concerns recipes.py already established.

Capped at DAILY_GENERATION_LIMIT per profile per (UTC) day; both of a
day's recommendations are kept and returned so the frontend can page
between them. Each one is only ever created by an explicit POST
.../generate -- there is no automatic/background generation.
"""

from fastapi import APIRouter, Depends, HTTPException

from backend.app.api.analysis import get_micronutrients, get_target_comparison
from backend.app.core.auth import require_profile_id
from backend.app.db import repo
from backend.app.models.profile import Profile
from backend.app.services.groq_client import GroqNotConfigured
from backend.app.services.recommendation_engine import generate_recommendations

router = APIRouter(prefix="/analysis/recommendations", tags=["recommendations"])

DAILY_GENERATION_LIMIT = 2


@router.get("")
def read_recommendations(profile_id: int = Depends(require_profile_id)):
    """Today's recommendations for this profile (0 to DAILY_GENERATION_LIMIT),
    oldest first -- a cheap DB read, always safe to fetch on page load
    (unlike POST .../generate, which is the one action that actually calls
    Groq)."""

    return {"recommendations": repo.list_gap_recommendations_today(profile_id)}


@router.post("/generate")
def generate_recommendation(profile_id: int = Depends(require_profile_id)):
    today = repo.list_gap_recommendations_today(profile_id)
    if len(today) >= DAILY_GENERATION_LIMIT:
        raise HTTPException(
            status_code=429,
            detail=f"You've reached today's limit of {DAILY_GENERATION_LIMIT} Quick Wins. Come back tomorrow.",
        )

    stored = repo.get_profile(profile_id)
    if not stored:
        raise HTTPException(status_code=404, detail="No profile yet")
    profile = Profile(**stored)

    # Reused directly, same pattern recipes.py already established for
    # get_target_comparison/get_diversity -- one source of truth for "what's
    # the current gap", not re-derived here.
    macro_gap = get_target_comparison(profile_id)
    micro = get_micronutrients(profile_id)

    try:
        result = generate_recommendations(
            profile,
            macro_gap,
            micro["totals"],
            micro["targets"],
            micro["days_of_data"],
        )
    except GroqNotConfigured as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    row = repo.insert_gap_recommendation(
        profile_id, result.summary, [item.model_dump(mode="json") for item in result.items]
    )
    return {"recommendation": row}
