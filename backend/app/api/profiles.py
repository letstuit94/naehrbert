"""Login screen directory (multi-user feature). Deliberately unauthenticated
-- listing who exists is exactly what a "pick a user" screen needs before
anyone is logged in. Separate router (plural, no trailing paths) from
profile.py (singular, the logged-in caller's own profile, X-Profile-Id
required) so the two never get confused."""

from fastapi import APIRouter

from backend.app.db import repo
from backend.app.models.profile import ProfileSummary

router = APIRouter(prefix="/profiles", tags=["profiles"])


@router.get("")
def list_profiles():
    return [ProfileSummary(**row) for row in repo.list_profiles()]
