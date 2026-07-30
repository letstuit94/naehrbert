"""
Real auth (Google + email via Supabase Auth), replacing the old "pick a
profile from a list, no password" scheme. The frontend holds a Supabase
session (supabase-js) and sends its access token as `Authorization: Bearer
<token>` on every request. Verification reuses the already-configured
service-role Supabase client (db/supabase.py) and asks Supabase's own
GoTrue service to validate the token (`auth.get_user`) rather than
decoding the JWT locally -- Supabase projects sign with either a legacy
shared secret (HS256) or newer per-project asymmetric keys, and asking
Supabase itself sidesteps needing to know (or store) either.

A verified token with no linked `profiles` row is a real, valid state (a
brand-new signup, or an existing account that hasn't claimed/created a
profile yet) -- `require_profile_id` 404s in that case rather than 401, so
the frontend can tell "not logged in" apart from "logged in, needs to
claim/create a profile" and route accordingly (see frontend/src/lib/
authContext.tsx).
"""

from typing import Optional

from fastapi import Header, HTTPException

from backend.app.db import repo
from backend.app.db.supabase import get_client


def _verify_token(authorization: Optional[str]) -> str:
    """Bearer token -> Supabase auth_user_id (a uuid string). 401 on any
    missing/invalid/expired token -- this is authentication, not
    authorization, so it never soft-fails."""

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not logged in")
    token = authorization[len("bearer ") :].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Not logged in")

    try:
        result = get_client().auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    if not result or not result.user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return result.user.id


def require_profile_id(authorization: Optional[str] = Header(default=None)) -> int:
    """Every endpoint that reads or writes profile-scoped data depends on
    this. 401 if there's no valid session at all; 404 if the session is
    valid but this account hasn't claimed/created a profile yet -- the
    frontend routes to the claim screen, not the login screen, on a 404
    here."""

    auth_user_id = _verify_token(authorization)
    profile = repo.get_profile_by_auth_user_id(auth_user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="No profile linked to this account yet")
    return profile["id"]


def authenticated_user_id(authorization: Optional[str] = Header(default=None)) -> str:
    """Just proves a real Supabase session exists -- used by the claim/
    create-profile endpoints (api/auth.py, api/profile.py's create_profile),
    which are exactly the ones that must work BEFORE a profiles row
    exists, so they can't depend on require_profile_id."""

    return _verify_token(authorization)
