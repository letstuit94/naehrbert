"""Epic 1 (onboarding) & Epic 2 (target calculation) endpoints."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from backend.app.core.auth import authenticated_user_id, require_profile_id
from backend.app.db import repo
from backend.app.models.profile import DietaryPreferencesUpdate, Profile, ProfileCreate
from backend.app.services.ideal_profile import compute_ideal_profile, macro_percentages

router = APIRouter(prefix="/profile", tags=["profile"])


def _targets_payload(profile: Profile) -> dict:
    targets = compute_ideal_profile(profile)
    if targets is None:
        return {"targets": None, "targets_pct": None}
    return {"targets": targets, "targets_pct": macro_percentages(targets)}


@router.post("")
def create_profile(
    payload: ProfileCreate, auth_user_id: str = Depends(authenticated_user_id)
):
    """Create a brand-new profile (onboarding signup -- this account has
    no linked profile yet) or replace the caller's own profile in place
    (the Profile page's biometric edit form -- this account already has
    one). Which branch runs is resolved from the verified session, not a
    client-supplied id, so an authenticated user can never create/edit
    someone else's profile. Computes targets synchronously either way
    (Epic 1.1, Epic 1.2) so the frontend can render the targets screen
    from this one response."""

    existing = repo.get_profile_by_auth_user_id(auth_user_id)
    profile_id = existing["id"] if existing else None
    stored = repo.upsert_profile(payload.model_dump(mode="json"), profile_id, auth_user_id)
    profile = Profile(**stored)
    return {"profile": profile, **_targets_payload(profile)}


@router.get("")
def read_profile(profile_id: int = Depends(require_profile_id)):
    """Current profile, for the "edit profile" entry point (Epic 1.2)."""

    stored = repo.get_profile(profile_id)
    if not stored:
        raise HTTPException(status_code=404, detail="No profile yet")
    return Profile(**stored)


@router.delete("", status_code=204)
def delete_profile(profile_id: int = Depends(require_profile_id)):
    """Account deletion: erase the caller's profile and everything they own
    (receipts + items, recipes, feedback, pantry data). `require_profile_id`
    means a user can only ever delete their own account -- profile_id is
    resolved from the caller's verified Supabase session, never a
    path/body param.

    Verified matches are preserved by design: the verified_matches (and
    non_food_terms) table is a global correction cache with no profile_id
    FK, so repo.delete_profile never touches it -- see its docstring."""

    if not repo.get_profile(profile_id):
        raise HTTPException(status_code=404, detail="No profile yet")
    repo.delete_profile(profile_id)


@router.get("/targets")
def read_targets(profile_id: int = Depends(require_profile_id)):
    stored = repo.get_profile(profile_id)
    if not stored:
        raise HTTPException(status_code=404, detail="No profile yet")
    return _targets_payload(Profile(**stored))


@router.patch("/preferences")
def update_dietary_preferences(
    payload: DietaryPreferencesUpdate, profile_id: int = Depends(require_profile_id)
):
    """Recipe-preferences chat (or the Profile page) saves dietary style/
    allergies/dislikes here -- separate from the biometric ProfileCreate
    fields, so editing them never requires re-submitting height/weight/etc.
    Stamps `recipe_prefs_completed_at` so the recipe chat skips straight to
    generation on future visits (recipe-recommendations feature)."""

    stored = repo.get_profile(profile_id)
    if not stored:
        raise HTTPException(status_code=404, detail="No profile yet")

    fields = {
        **payload.model_dump(mode="json"),
        "recipe_prefs_completed_at": datetime.now(timezone.utc).isoformat(),
    }
    updated = repo.update_dietary_preferences(profile_id, fields)
    return Profile(**updated)
