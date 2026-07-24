"""Pantry / basket (Vorrat.md) -- the user's current stock and the
withdrawal ledger behind it.

What the Basket page shows (an item list with "eaten"/"removed" buttons) is
NOT how it's stored: there is no pantry table to mutate. Stock is derived at
read time as purchases MINUS an append-only ledger of withdrawals
(pantry_removals), so the immutable purchase history stays untouched and the
consumption analytics that read the same receipt_items are never
double-counted (Vorrat.md §2)."""

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.app.core.auth import require_profile_id
from backend.app.db import repo
from backend.app.services import shelf_life, verified_matches
from backend.app.services.fallback_categories import _canonical_category
from backend.app.services.nutrition_mapping import matched_product_to_row
from backend.app.services.nutrition_profile import grams_for
from backend.app.services.resolver import resolve_item

router = APIRouter(prefix="/pantry", tags=["pantry"])


class RemovalCreate(BaseModel):
    receipt_item_id: str
    # 'eaten' (gegessen) vs 'removed' (entfernt: spoiled/given away/miscan).
    # Both leave the pantry; only the later consumption-gap analysis tells
    # them apart (GapUndEmpfehlung.md §4).
    reason: Literal["eaten", "removed"]
    # Partial withdrawal, in the lot's own unit (0.5 l of 1 l, 250 g of 500 g,
    # 1 of 3 pieces). Omitted = the whole remaining amount. Over-shooting the
    # remaining is clamped, not rejected (see create_removal).
    quantity: Optional[float] = None


class ManualItemMatch(BaseModel):
    """A candidate the user picked in the fix-match search (GET
    /match/candidates), attached to the new item so its verified name +
    nutrition are used instead of the automatic resolver. Mirrors the
    receipt ItemCorrection shape."""

    matched_name: Optional[str] = None
    off_id: Optional[str] = None
    bls_code: Optional[str] = None
    nutrition: dict = {}


class ManualItemCreate(BaseModel):
    name: str
    # In the item's own unit; treated as both purchased and remaining amount.
    quantity: float
    unit: Optional[str] = None
    # Optional -- a picked fix-match. Omitted = let the resolver match by name.
    match: Optional[ManualItemMatch] = None


def _scaled(value, factor):
    """A missing macro is *unknown*, not 0 g -- keep it None so the UI shows
    '—' instead of a fake measured zero (same policy as /analysis/purchases)."""
    return None if value is None else round(value * factor, 1)


def _pantry_item(row: dict) -> dict:
    """One v_pantry row -> the shape the Basket page renders: identity, where/
    when bought, and kcal/macros scaled for the amount STILL in stock
    (remaining_quantity, not the purchased quantity -- a half-eaten lot shows
    half its macros). `quantity` is the remaining amount the UI displays and
    pre-fills the withdrawal control with; `original_quantity` is what was
    bought, for a "0.5 l of 1 l" hint."""

    remaining = row.get("remaining_quantity")
    if remaining is None:  # NULL-quantity lot treated as one unit (see migration 0009)
        remaining = 1.0
    cal_per_100g = row.get("calories_kcal")
    macros = {"calories_kcal": None, "protein_g": None, "fat_g": None, "carbs_g": None, "fiber_g": None}
    if cal_per_100g is not None:
        factor = grams_for(remaining, row.get("unit"), row.get("category"), row.get("name")) / 100.0
        macros = {
            "calories_kcal": round(cal_per_100g * factor, 1),
            "protein_g": _scaled(row.get("protein_g"), factor),
            "fat_g": _scaled(row.get("fat_g"), factor),
            "carbs_g": _scaled(row.get("carbs_g"), factor),
            "fiber_g": _scaled(row.get("fiber_g"), factor),
        }
    # Canonical leaf category driving the Basket's food-group emoji, on EVERY
    # lot (not just fallbacks). Derived from the best identity we have -- the
    # verified matched_name first ("Tomate roh" -> fruiting_vegetables), else
    # the raw parsed name. The stored `category` column is NOT used: it's
    # computed at parse time from the raw receipt line, which is often an
    # abbreviation the keyword table misses (so a verified tomato would fall
    # back to "other"/📦).
    category = _canonical_category(None, row.get("matched_name") or row.get("name") or "")
    food_group = shelf_life.food_group_for(category)
    return {
        "id": row["id"],
        "receipt_id": row["receipt_id"],
        "name": row["name"],
        "store": row.get("store"),
        "purchased_at": row.get("purchased_at") or row.get("created_at"),
        "quantity": round(remaining, 3),
        "original_quantity": row.get("quantity"),
        "unit": row.get("unit"),
        # v_pantry is food-only (is_non_food = false); sent so the frontend's
        # shared match helpers accept a PantryItem like a PurchaseItem.
        "is_non_food": False,
        "match_type": row.get("match_type"),
        "matched_name": row.get("matched_name"),
        "category": category,
        # Coarse food group (services/shelf_life.py) driving the "by category"
        # view, the category filter, and which shelf-life estimate applies.
        "food_group": food_group,
        "food_group_label": shelf_life.FOOD_GROUP_LABELS[food_group],
        "fallback_category": row.get("fallback_category"),
        "confidence": row.get("confidence"),
        **macros,
    }


@router.get("")
def get_pantry(profile_id: int = Depends(require_profile_id)):
    """Current stock: confirmed, food purchases with no withdrawal yet
    (Vorrat.md §5, per-lot MVP).

    Default order is view A ("short use-by date"): ascending by ESTIMATED
    expiry (purchased_at + shelf_life_days[food_group]), most urgent first,
    with no-estimate lots (Other / unparseable date) trailing. That estimated
    date is used only as an opaque sort key and to derive each lot's fuzzy
    `urgency` bucket -- neither the date nor a day count is ever returned, so
    the UI cannot present a guess as a fact."""

    config = shelf_life.effective_shelf_life(repo.get_shelf_life_overrides(profile_id))
    today = date.today()
    items = [_pantry_item(row) for row in repo.get_pantry(profile_id)]
    for item in items:
        days = config.get(item["food_group"])
        item["urgency"] = shelf_life.urgency_for(item["purchased_at"], days, today)
        item["_sort"] = shelf_life.sort_key(item["purchased_at"], days)
    items.sort(key=lambda i: i.pop("_sort"))
    return {"items": items}


class ShelfLifeUpdate(BaseModel):
    """One or more group overrides, {food_group: days_or_null}. A null value
    opts a group out of urgency; an omitted group keeps the code default."""

    days: dict[str, Optional[int]]


@router.get("/shelf-life")
def get_shelf_life(profile_id: int = Depends(require_profile_id)):
    """The effective shelf-life config the urgency sort uses: every food
    group with its days (code default merged with this profile's overrides),
    plus a human label and whether the value is a user override. The Basket's
    config panel renders and edits this."""

    overrides = repo.get_shelf_life_overrides(profile_id)
    effective = shelf_life.effective_shelf_life(overrides)
    return {
        "groups": [
            {
                "food_group": group,
                "label": shelf_life.FOOD_GROUP_LABELS[group],
                "shelf_life_days": effective[group],
                "is_override": group in overrides,
            }
            for group in shelf_life.FOOD_GROUP_LABELS
        ]
    }


@router.put("/shelf-life")
def put_shelf_life(payload: ShelfLifeUpdate, profile_id: int = Depends(require_profile_id)):
    """Save per-group overrides for this profile, then return the recomputed
    effective config. Unknown groups are rejected (422) so a typo can't
    create a phantom bucket; days must be a positive integer or null."""

    for group, days in payload.days.items():
        if group not in shelf_life.FOOD_GROUP_LABELS:
            raise HTTPException(status_code=422, detail=f"Unknown food group: {group}")
        if days is not None and (not isinstance(days, int) or days <= 0):
            raise HTTPException(status_code=422, detail=f"Days for {group} must be a positive integer or null")
        repo.upsert_shelf_life(profile_id, group, days)
    return get_shelf_life(profile_id)


@router.post("/items", status_code=201)
def create_manual_item(payload: ManualItemCreate, profile_id: int = Depends(require_profile_id)):
    """Manually add a food to the basket (Vorrat.md) without scanning a
    receipt. Since every pantry/purchase row is a receipt_item on a confirmed
    receipt, a manual add is a one-item, already-confirmed "Manuell" receipt
    dated today -- so it shows up in the basket AND the purchases view with no
    special-casing. Nutrition comes from the picked fix-match if any, else the
    same tiered resolver used for scanned items."""

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Name must not be empty")
    if payload.quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be positive")

    unit = (payload.unit or "").strip() or None
    receipt = repo.create_receipt(
        profile_id=profile_id,
        source="pasted_text",
        raw_text=None,
        store="Manuell",
        purchased_at=date.today().isoformat(),
    )
    repo.set_receipt_status(receipt["id"], "confirmed")
    [item] = repo.insert_receipt_items(
        receipt["id"],
        [
            {
                "name": name,
                "original_text": name,
                "quantity": payload.quantity,
                "unit": unit,
                "is_non_food": False,
            }
        ],
    )

    match = payload.match
    if match and match.matched_name:
        # A picked fix-match: persist it exactly like the receipt correct
        # endpoint (learned, conf 1.0) and remember it for future receipts.
        row = {
            "match_type": "learned",
            "confidence": 1.0,
            "identity_conf": 1.0,
            "nutrition_conf": 1.0,
            "unknown": False,
            "data_source": "manual entry",
            "matched_name": match.matched_name,
            "off_id": match.off_id,
            "bls_code": match.bls_code,
            **match.nutrition,
        }
        item = repo.update_receipt_item(item["id"], row)
        verified_matches.record_verified_match(
            raw_text=name,
            store="Manuell",
            off_id=match.off_id,
            bls_code=match.bls_code,
            matched_name=match.matched_name,
            nutrition=match.nutrition,
        )
    else:
        # No pick -> resolve by name, same tiered matcher as a scanned item.
        item = repo.update_receipt_item(item["id"], matched_product_to_row(resolve_item(item)))

    return item


@router.post("/removals", status_code=201)
def create_removal(payload: RemovalCreate, profile_id: int = Depends(require_profile_id)):
    """Withdraw all or part of a lot (eaten/removed).

    404 (not 403) if the item isn't the caller's -- an owned-or-invisible
    item shouldn't reveal its existence. 409 if nothing is left to withdraw.
    A requested quantity above the remaining amount is CLAMPED to it (not
    rejected) -- the honest outcome for a stale UI or a concurrent request --
    and the response reports the actually-applied amount, the remaining after,
    and whether it was clamped, so the UI can say so."""

    owner = repo.get_receipt_item_owner(payload.receipt_item_id)
    if owner != profile_id:
        raise HTTPException(status_code=404, detail="Item not found")

    remaining = repo.get_lot_remaining(payload.receipt_item_id)
    if remaining is None or remaining <= 0:
        raise HTTPException(status_code=409, detail="Nothing left to withdraw")

    requested = payload.quantity if payload.quantity is not None else remaining
    if requested <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be positive")

    clamped = requested > remaining
    applied = round(min(requested, remaining), 3)

    removal = repo.add_pantry_removal(payload.receipt_item_id, payload.reason, applied)
    return {
        **removal,
        "applied_quantity": applied,
        # `+ 0.0` normalizes a float -0.0 (from subtracting equal values) to 0.0.
        "remaining_after": round(remaining - applied, 3) + 0.0,
        "clamped": clamped,
    }


@router.delete("/removals/{removal_id}", status_code=204)
def delete_removal(removal_id: str, profile_id: int = Depends(require_profile_id)):
    """Undo a withdrawal -- the lot reappears in the pantry."""

    removal = repo.get_pantry_removal(removal_id)
    if removal is None or repo.get_receipt_item_owner(removal["receipt_item_id"]) != profile_id:
        raise HTTPException(status_code=404, detail="Removal not found")
    repo.remove_pantry_removal(removal_id)
