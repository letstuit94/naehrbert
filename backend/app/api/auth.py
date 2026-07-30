"""Account linking (Supabase Auth -> this app's profiles table).

Before this file existed, "logging in" just meant picking a profiles row
from a fully public, unauthenticated list (the old api/profiles.py). Real
auth (Google + email via Supabase Auth) replaces that: a browser session
now proves *who* is asking (backend/app/core/auth.py), and every profile
this app currently has is already linked to an account -- a brand-new
signup with no linked profile just goes straight through the existing
POST /profile / onboarding flow to create one."""

from fastapi import APIRouter, Depends

from backend.app.core.auth import authenticated_user_id
from backend.app.db import repo

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/me")
def read_me(auth_user_id: str = Depends(authenticated_user_id)):
    """The frontend's one source of truth for routing: null routes to
    onboarding (create a profile), an int routes straight into the app."""

    profile = repo.get_profile_by_auth_user_id(auth_user_id)
    return {"profile_id": profile["id"] if profile else None}
