"""Pantry / basket (Vorrat.md) -- the user's current stock and the
withdrawal ledger behind it.

What the Basket page shows (an item list with "eaten"/"removed" buttons) is
NOT how it's stored: there is no pantry table to mutate. Stock is derived at
read time as purchases MINUS an append-only ledger of withdrawals
(pantry_removals), so the immutable purchase history stays untouched and the
consumption analytics that read the same receipt_items are never
double-counted (Vorrat.md §2)."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.app.core.auth import require_profile_id
from backend.app.db import repo
from backend.app.services.fallback_categories import _canonical_category
from backend.app.services.nutrition_profile import grams_for

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
        # Canonical leaf category driving the Basket's food-group emoji, on
        # EVERY lot (not just fallbacks). Derived from the best identity we
        # have -- the verified matched_name first ("Tomate roh" ->
        # fruiting_vegetables), else the raw parsed name. The stored `category`
        # column is NOT used: it's computed at parse time from the raw receipt
        # line, which is often an abbreviation the keyword table misses (so a
        # verified tomato would fall back to "other"/📦).
        "category": _canonical_category(
            None, row.get("matched_name") or row.get("name") or ""
        ),
        "fallback_category": row.get("fallback_category"),
        "confidence": row.get("confidence"),
        **macros,
    }


@router.get("")
def get_pantry(profile_id: int = Depends(require_profile_id)):
    """Current stock: confirmed, food purchases with no withdrawal yet
    (Vorrat.md §5, per-lot MVP). Newest purchase first."""

    items = [_pantry_item(row) for row in repo.get_pantry(profile_id)]
    items.sort(key=lambda i: i["purchased_at"] or "", reverse=True)
    return {"items": items}


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
