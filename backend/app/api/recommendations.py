"""
Insights page gap-closing recommendations -- Groq-generated advice for
closing the current macro gap (analysis.py's get_target_comparison) and
micronutrient gap (get_micronutrients), respecting the profile's dietary
style/allergies/dislikes.

Kept in its own file (like recipes.py) rather than folded into
analysis.py, which stays pure-analysis -- this is generation, the same
separation of concerns recipes.py already established.

One current recommendation per profile, replaced on regenerate (a brief
"up to 2 per day, paged" model was tried and dropped -- regenerating on
the same data just gave more of the same, not more value). Regeneration
is gated instead: at most once per (UTC) calendar day, and only once a
new receipt has been confirmed since the last recommendation -- there is
no automatic/background generation either way, every recommendation is
created by an explicit POST .../generate.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from backend.app.api.analysis import get_micronutrients, get_target_comparison
from backend.app.core.auth import require_profile_id
from backend.app.db import repo
from backend.app.models.profile import Profile
from backend.app.services.groq_client import GroqNotConfigured
from backend.app.services.recommendation_engine import generate_recommendations

router = APIRouter(prefix="/analysis/recommendations", tags=["recommendations"])


def _can_generate(profile_id: int, existing: dict | None) -> bool:
    """No existing recommendation -> always allowed (the first one is
    purely a manual action, no gate needed). Otherwise both must hold: a
    new UTC calendar day has started since the last one, and at least one
    receipt has been confirmed since then."""

    if existing is None:
        return True
    last_created_at = datetime.fromisoformat(existing["created_at"])
    now = datetime.now(timezone.utc)
    new_day = now.date() > last_created_at.date()
    return new_day and repo.has_receipt_confirmed_after(profile_id, last_created_at)


@router.get("")
def read_recommendation(profile_id: int = Depends(require_profile_id)):
    """The current recommendation for this profile, or None if nothing's
    been generated yet -- a cheap DB read, always safe to fetch on page
    load (unlike POST .../generate, which is the one action that actually
    calls Groq). `can_generate` tells the frontend upfront whether
    regenerating is currently allowed, so it can show the button (or not)
    without a failed POST round-trip."""

    existing = repo.get_gap_recommendation(profile_id)
    return {"recommendation": existing, "can_generate": _can_generate(profile_id, existing)}


@router.post("/generate")
def generate_recommendation(profile_id: int = Depends(require_profile_id)):
    existing = repo.get_gap_recommendation(profile_id)
    if not _can_generate(profile_id, existing):
        raise HTTPException(
            status_code=429,
            detail="You can generate a new one once you've uploaded a new receipt, at most once a day.",
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

    row = repo.upsert_gap_recommendation(
        profile_id, result.summary, [item.model_dump(mode="json") for item in result.items]
    )
    return {"recommendation": row}
