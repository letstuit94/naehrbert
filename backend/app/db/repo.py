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


def delete_profile(profile_id: int) -> None:
    """Erase a user and everything they own (account-deletion flow).

    The FKs pointing at profiles(id) are RESTRICT (receipts, recipes,
    user_feedback -- migrations 0007/0005/0004), so a bare
    `delete().eq("id", profile_id)` on profiles would be blocked by those
    children. We delete them explicitly, parents-before-children only where
    a FK forces it:

      * receipts    -> receipt_items (ON DELETE CASCADE, 0001) ->
                       pantry_removals (ON DELETE CASCADE, 0008)
        so deleting the receipts alone clears the whole receipt subtree.
      * recipes, user_feedback   -- direct RESTRICT children, deleted here.
      * pantry_shelf_life        -- already ON DELETE CASCADE (0010), so the
        final profiles delete would clear it; we drop it up front anyway so
        this function stays correct even if that FK is ever changed.

    DELIBERATELY LEFT UNTOUCHED: `verified_matches` and `non_food_terms`.
    They have no profile_id FK -- they're a global, shared correction cache
    (see 0007_multi_user.sql). A user's verified matches must survive their
    account deletion so the app doesn't have to re-learn the same
    corrections, so we never touch those tables here.
    """

    client = get_client()

    # Child subtrees first (RESTRICT FKs would otherwise block the profile).
    receipts = (
        client.table("receipts").select("id").eq("profile_id", profile_id).execute().data
    ) or []
    for receipt in receipts:
        # cascades to receipt_items -> pantry_removals
        client.table("receipts").delete().eq("id", receipt["id"]).execute()

    client.table("recipes").delete().eq("profile_id", profile_id).execute()
    client.table("user_feedback").delete().eq("profile_id", profile_id).execute()
    client.table("pantry_shelf_life").delete().eq("profile_id", profile_id).execute()

    # Finally the profile itself.
    client.table("profiles").delete().eq("id", profile_id).execute()


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


def update_receipt(receipt_id: str, fields: dict) -> dict:
    res = get_client().table("receipts").update(fields).eq("id", receipt_id).execute()
    return res.data[0]


def get_distinct_stores(profile_id: int) -> List[str]:
    """Every store name this profile has used before, for the upload
    review screen's "pick an existing store" option when a receipt's own
    store couldn't be detected. Excludes the parser's "unknown" sentinel
    (services/receipt_text_parser.py's _detect_store) -- that's a
    not-found marker, never a real store name."""

    res = get_client().table("receipts").select("store").eq("profile_id", profile_id).execute()
    stores = {
        row["store"] for row in (res.data or []) if row.get("store") and row["store"] != "unknown"
    }
    return sorted(stores)


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
        # purchased_at/created_at come along so the analysis can weight the
        # macro split toward recent purchases (basket_composition EWMA).
        .select("*, receipts!inner(status, profile_id, purchased_at, created_at)")
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
    """Every non-archived recipe for `profile_id` -- an archived (soft-
    deleted, migration 0010) recipe is excluded here, once, rather than in
    every consumer of this list, same convention as
    get_all_confirmed_receipt_items excluding is_non_food."""

    res = (
        get_client()
        .table("recipes")
        .select("*")
        .eq("profile_id", profile_id)
        .is_("archived_at", "null")
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


def get_recipe(recipe_id: str) -> Optional[dict]:
    res = get_client().table("recipes").select("*").eq("id", recipe_id).execute()
    rows = res.data or []
    return rows[0] if rows else None


def update_recipe(recipe_id: str, fields: dict) -> dict:
    res = get_client().table("recipes").update(fields).eq("id", recipe_id).execute()
    return res.data[0]


# ── pantry / basket (Vorrat.md) ──────────────────────────────────────────

def get_pantry(profile_id: int) -> List[dict]:
    """Current stock for `profile_id`: confirmed, food receipt_items with no
    withdrawal yet (Vorrat.md §4). Reads the v_pantry view (migration 0008),
    which already applies the confirmed/food/not-removed filter and lifts
    profile_id/store/purchased_at off the parent receipt -- so here it's a
    plain owner filter, never a stored pantry to keep in sync."""

    res = get_client().table("v_pantry").select("*").eq("profile_id", profile_id).execute()
    return res.data or []


def get_receipt_item_owner(receipt_item_id: str) -> Optional[int]:
    """The profile_id that owns a receipt_item, via its parent receipt --
    the one seam the pantry endpoints check before letting a caller withdraw
    an item, so a stray request can't touch someone else's stock. None if the
    item doesn't exist."""

    res = (
        get_client()
        .table("receipt_items")
        .select("id, receipts!inner(profile_id)")
        .eq("id", receipt_item_id)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return None
    return (rows[0].get("receipts") or {}).get("profile_id")


def get_lot_remaining(receipt_item_id: str) -> Optional[float]:
    """How much of a lot is still in stock: its purchased quantity minus the
    sum of prior withdrawals (Vorrat.md §6.4). Mirrors v_pantry's arithmetic
    so the write path can clamp a new withdrawal to what's actually left.
    A NULL receipt_items.quantity counts as one unit and a NULL removal
    quantity as the whole lot -- same COALESCE rules as migration 0009.
    Returns None only when the item doesn't exist."""

    item = (
        get_client()
        .table("receipt_items")
        .select("quantity")
        .eq("id", receipt_item_id)
        .execute()
        .data
    )
    if not item:
        return None
    base = item[0].get("quantity")
    base = 1.0 if base is None else float(base)
    removals = (
        get_client()
        .table("pantry_removals")
        .select("quantity")
        .eq("receipt_item_id", receipt_item_id)
        .execute()
        .data
    ) or []
    used = sum(base if r.get("quantity") is None else float(r["quantity"]) for r in removals)
    return base - used


def add_pantry_removal(
    receipt_item_id: str, reason: str, quantity: Optional[float] = None
) -> dict:
    """Append a withdrawal to the ledger (Vorrat.md §3). `quantity=None` (the
    MVP default) means the whole lot is gone; a value records a partial
    withdrawal for later use."""

    row = {"receipt_item_id": receipt_item_id, "reason": reason}
    if quantity is not None:
        row["quantity"] = quantity
    res = get_client().table("pantry_removals").insert(row).execute()
    return res.data[0]


def get_pantry_removal(removal_id: str) -> Optional[dict]:
    res = get_client().table("pantry_removals").select("*").eq("id", removal_id).execute()
    rows = res.data or []
    return rows[0] if rows else None


def remove_pantry_removal(removal_id: str) -> None:
    """Undo a withdrawal -- the item reappears in v_pantry once its only
    ledger row is gone."""

    get_client().table("pantry_removals").delete().eq("id", removal_id).execute()


def get_shelf_life_overrides(profile_id: int) -> dict:
    """This profile's per-group shelf-life overrides as {food_group: days}
    (days may be None = group opted out of urgency). Empty when the user has
    never tuned anything -- the caller merges these onto the code defaults
    (services/shelf_life.effective_shelf_life)."""

    res = (
        get_client()
        .table("pantry_shelf_life")
        .select("food_group, shelf_life_days")
        .eq("profile_id", profile_id)
        .execute()
    )
    return {row["food_group"]: row["shelf_life_days"] for row in (res.data or [])}


def upsert_shelf_life(profile_id: int, food_group: str, shelf_life_days: Optional[int]) -> None:
    """Store one group's override for a profile (primary key is
    (profile_id, food_group), so this overwrites any prior value)."""

    get_client().table("pantry_shelf_life").upsert(
        {
            "profile_id": profile_id,
            "food_group": food_group,
            "shelf_life_days": shelf_life_days,
        },
        on_conflict="profile_id,food_group",
    ).execute()
