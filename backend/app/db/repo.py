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

_PROFILE_ID = 1


# ── profiles ────────────────────────────────────────────────────────────

def get_profile() -> Optional[dict]:
    res = get_client().table("profiles").select("*").eq("id", _PROFILE_ID).execute()
    rows = res.data or []
    return rows[0] if rows else None


def upsert_profile(profile: dict) -> dict:
    """Create-or-replace the single profile row (Epic 1.1)."""

    row = {**profile, "id": _PROFILE_ID, "updated_at": datetime.now(timezone.utc).isoformat()}
    res = get_client().table("profiles").upsert(row, on_conflict="id").execute()
    return res.data[0]


# ── receipts ────────────────────────────────────────────────────────────

def create_receipt(source: str, raw_text: Optional[str], store: Optional[str] = None,
                    purchased_at: Optional[str] = None) -> dict:
    row = {"source": source, "raw_text": raw_text, "store": store, "purchased_at": purchased_at}
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


def get_all_confirmed_receipt_items() -> List[dict]:
    """Every non-non-food receipt_item belonging to a confirmed receipt
    (Epic 5.1: the composition/comparison analysis runs across every
    finalized receipt to date, not just the most recent upload). Excludes
    is_non_food items here, once, rather than in every consumer of this
    list — they were deliberately skipped at confirm time (Epic 3.4) and
    never got matched nutrition to aggregate."""

    res = (
        get_client()
        .table("receipt_items")
        .select("*, receipts!inner(status)")
        .eq("receipts.status", "confirmed")
        .eq("is_non_food", False)
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

def get_verified_match(match_key: str, store: str) -> Optional[dict]:
    res = (
        get_client()
        .table("verified_matches")
        .select("*")
        .eq("match_key", match_key)
        .eq("store", store)
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
