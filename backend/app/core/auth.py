"""
"Log in" is just picking a profile by name -- no passwords yet (multi-user
feature). The frontend remembers the chosen profiles.id client-side and
sends it back as an X-Profile-Id header on every request; these two
dependencies are the one seam every endpoint reads that header through, so
swapping the header for a real session/JWT later only touches this file.
"""

from typing import Optional

from fastapi import Header, HTTPException


def require_profile_id(x_profile_id: Optional[int] = Header(default=None)) -> int:
    """Every endpoint that reads or writes profile-scoped data depends on
    this -- 401 if the frontend never logged in (or the session was
    cleared), so a stray request can't silently fall back to someone
    else's data."""

    if x_profile_id is None:
        raise HTTPException(status_code=401, detail="Not logged in")
    return x_profile_id


def optional_profile_id(x_profile_id: Optional[int] = Header(default=None)) -> Optional[int]:
    """POST /profile is the one exception: a brand-new signup has no
    profile_id yet (that's the point), while an existing user editing
    their own biometrics sends one -- see repo.upsert_profile."""

    return x_profile_id
