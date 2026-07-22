"""
Slim CRUD module (Epic 0.1) — only what the API layer and the ported
services actually need, unlike the old repo's ~30-function db/supabase.py.

No `_insert_tolerant`/`_update_tolerant` "strip missing columns and retry"
safety net either: that existed because the old repo's schema evolved
through 14+ incremental ALTER migrations with no baseline. This repo has
one clean init migration (supabase/migrations/0001_init_schema.sql), so
schema/code can't drift the same way — plain inserts/updates are enough.
"""

from datetime import datetime, timezone
from typing import List, Optional

from backend.app.db.supabase import get_client

# ── profiles ────────────────────────────────────────────────────────────

def list_profiles() -> List[dict]:
    """Login screen's "pick a user" directory (multi-user feature)."""

    res = get_client().table("profiles").select("id, name").order("id").execute()
    return res.data or []


def get_profile(profile_id: int) -> Optional[dict]:
    res = get_client().table("profiles").select("*").eq("id", profile_id).execute()
    rows = res.data or []
    return rows[0] if rows else None


def upsert_profile(profile: dict, profile_id: Optional[int] = None) -> dict:
    """Create a brand-new profile (signup -- `profile_id` is None, so
    `id` is left for the DB's identity column to assign) or replace an
    existing one in place (an already-logged-in user editing their own
    biometrics on the Profile page -- `profile_id` is their own id, never
    someone else's, since it comes from the X-Profile-Id header)."""

    row = {**profile, "updated_at": datetime.now(timezone.utc).isoformat()}
    if profile_id is not None:
        row["id"] = profile_id
        res = get_client().table("profiles").upsert(row, on_conflict="id").execute()
    else:
        res = get_client().table("profiles").insert(row).execute()
    return res.data[0]


def update_dietary_preferences(profile_id: int, fields: dict) -> dict:
    """Partial update for the recipe-preferences chat / Profile page's
    dietary_style/allergies/dislikes fields — a plain `.update()`, not an
    upsert, so it doesn't require the full ProfileCreate shape the way
    upsert_profile does."""

    row = {**fields, "updated_at": datetime.now(timezone.utc).isoformat()}
    res = get_client().table("profiles").update(row).eq("id", profile_id).execute()
    return res.data[0]


# ── receipts ────────────────────────────────────────────────────────────

def create_receipt(profile_id: int, source: str, raw_text: Optional[str],
                    store: Optional[str] = None, purchased_at: Optional[str] = None) -> dict:
    row = {
        "profile_id": profile_id,
        "source": source,
        "raw_text": raw_text,
        "store": store,
        "purchased_at": purchased_at,
    }
    res = get_client().table("receipts").insert(row).execute()
    return res.data[0]


def set_receipt_status(receipt_id: str, status: str) -> None:
    get_client().table("receipts").update({"status": status}).eq("id", receipt_id).execute()


# ── receipt_items ───────────────────────────────────────────────────────

def insert_receipt_items(receipt_id: str, items: List[dict]) -> List[dict]:
    if not items:
        return []
    rows = [{**item, "receipt_id": receipt_id} for item in items]
    res = get_client().table("receipt_items").insert(rows).execute()
    return res.data


def get_receipt_items(receipt_id: str) -> List[dict]:
    res = get_client().table("receipt_items").select("*").eq("receipt_id", receipt_id).execute()
    return res.data or []


def update_receipt_item(item_id: str, fields: dict) -> dict:
    res = get_client().table("receipt_items").update(fields).eq("id", item_id).execute()
    return res.data[0]


def delete_receipt_item(item_id: str) -> None:
    get_client().table("receipt_items").delete().eq("id", item_id).execute()


def get_receipt(receipt_id: str) -> Optional[dict]:
    res = get_client().table("receipts").select("*").eq("id", receipt_id).execute()
    rows = res.data or []
    return rows[0] if rows else None


def get_all_confirmed_receipt_items(profile_id: int) -> List[dict]:
    """Every non-non-food receipt_item belonging to a confirmed receipt
    owned by `profile_id` (Epic 5.1: the composition/comparison analysis
    runs across every finalized receipt to date, not just the most recent
    upload). Excludes is_non_food items here, once, rather than in every
    consumer of this list — they were deliberately skipped at confirm time
    (Epic 3.4) and never got matched nutrition to aggregate."""

    res = (
        get_client()
        .table("receipt_items")
        .select("*, receipts!inner(status, profile_id)")
        .eq("receipts.status", "confirmed")
        .eq("receipts.profile_id", profile_id)
        .eq("is_non_food", False)
        .execute()
    )
    return res.data or []


def get_all_confirmed_receipt_items_with_receipt_info(profile_id: int) -> List[dict]:
    """Every receipt_item (food AND non-food) belonging to a confirmed
    receipt owned by `profile_id`, with its parent receipt's store/date
    embedded -- the Purchases page's "everything you've uploaded" browser,
    as opposed to get_all_confirmed_receipt_items()'s analysis-only
    (food-only) view."""

    res = (
        get_client()
        .table("receipt_items")
        .select("*, receipts!inner(status, store, purchased_at, created_at, profile_id)")
        .eq("receipts.status", "confirmed")
        .eq("receipts.profile_id", profile_id)
        .execute()
    )
    return res.data or []


# ── non_food_terms (services/non_food_terms.py) ──────────────────────────

def get_all_non_food_keys() -> List[str]:
    res = get_client().table("non_food_terms").select("term_key").execute()
    return [row["term_key"] for row in (res.data or [])]


def upsert_non_food_term(term_key: str, raw_text: str) -> None:
    get_client().table("non_food_terms").upsert(
        {"term_key": term_key, "raw_text": raw_text}, on_conflict="term_key"
    ).execute()


# ── verified_matches (services/verified_matches.py) ──────────────────────

def get_verified_match(match_key: str) -> Optional[dict]:
    """Matches on `match_key` alone, any store -- see verified_matches.py's
    lookup_verified_match for why store is deliberately not part of the
    read path. A key can have rows under more than one store (each store's
    correction upserts its own (match_key, store) row), so ties break on
    recency, same as the single-user "last correction wins" rule already
    applied within one store."""

    res = (
        get_client()
        .table("verified_matches")
        .select("*")
        .eq("match_key", match_key)
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def upsert_verified_match(match_key: str, store: str, matched_name: Optional[str],
                           off_id: Optional[str], bls_code: Optional[str], nutrition: dict) -> None:
    row = {
        "match_key": match_key,
        "store": store,
        "matched_name": matched_name,
        "off_id": off_id,
        "bls_code": bls_code,
        "nutrition": nutrition,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    get_client().table("verified_matches").upsert(row, on_conflict="match_key,store").execute()


# ── user_feedback (NPS, recipe-recommendations feature) ──────────────────

def insert_feedback(profile_id: int, nps_score: int) -> dict:
    res = get_client().table("user_feedback").insert(
        {"profile_id": profile_id, "nps_score": nps_score}
    ).execute()
    return res.data[0]


# ── recipes (recipe-recommendations feature) ─────────────────────────────

def insert_recipe(profile_id: int, row: dict) -> dict:
    res = get_client().table("recipes").insert({**row, "profile_id": profile_id}).execute()
    return res.data[0]


def get_all_recipes(profile_id: int) -> List[dict]:
    res = (
        get_client()
        .table("recipes")
        .select("*")
        .eq("profile_id", profile_id)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []
