"""Epic 1 (onboarding) & Epic 2 (target calculation) endpoints."""

from fastapi import APIRouter, HTTPException

from backend.app.db import repo
from backend.app.models.profile import Profile, ProfileCreate
from backend.app.services.ideal_profile import compute_ideal_profile, macro_percentages

router = APIRouter(prefix="/profile", tags=["profile"])


def _targets_payload(profile: Profile) -> dict:
    targets = compute_ideal_profile(profile)
    if targets is None:
        return {"targets": None, "targets_pct": None}
    return {"targets": targets, "targets_pct": macro_percentages(targets)}


@router.post("")
def create_profile(payload: ProfileCreate):
    """Create-or-replace the single profile row and compute targets
    synchronously (Epic 1.1, Epic 1.2) so the frontend can render the
    targets screen from this one response."""

    stored = repo.upsert_profile(payload.model_dump(mode="json"))
    profile = Profile(**stored)
    return {"profile": profile, **_targets_payload(profile)}


@router.get("")
def read_profile():
    """Current profile, for the "edit profile" entry point (Epic 1.2)."""

    stored = repo.get_profile()
    if not stored:
        raise HTTPException(status_code=404, detail="No profile yet")
    return Profile(**stored)


@router.get("/targets")
def read_targets():
    stored = repo.get_profile()
    if not stored:
        raise HTTPException(status_code=404, detail="No profile yet")
    return _targets_payload(Profile(**stored))
