"""Epic 3 (upload/OCR/parse + review) & Epic 4 (nutrition matching) endpoints."""

from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend.app.analytics.match_quality import compute_match_quality
from backend.app.api import match
from backend.app.core.auth import require_profile_id
from backend.app.db import repo
from backend.app.models.nutrition import MatchedProduct
from backend.app.services import (
    local_extractor,
    non_food_terms,
    receipt_text_parser,
    verified_matches,
)
from backend.app.services.nutrition_mapping import matched_product_to_row
from backend.app.services.resolver import resolve_item

router = APIRouter(prefix="/receipts", tags=["receipts"])

# resolve_item()'s slow path is a live OpenFoodFacts network round-trip on
# a cache miss (up to two search attempts, each with its own retry/backoff
# -- see services/off_api.py), and that cost is paid per item regardless
# of whether the item ends up matched, fallback-estimated, or unmatched
# (all three try OFF first). Items are independent, so resolving them
# concurrently cuts a many-new-product receipt's wall-clock time roughly
# by the pool size instead of paying every item's network latency back to
# back -- measured on a real 25-item receipt with almost no prior verified
# matches: ~58s sequential. Kept modest (not "one thread per item") to
# stay a polite citizen of a free public API rather than hammering it.
_MAX_CONCURRENT_RESOLUTIONS = 6


def _resolve_concurrently(items: List[dict]) -> List[MatchedProduct]:
    """resolve_item() for every item in `items`, run concurrently.
    Result order matches input order regardless of completion order
    (ThreadPoolExecutor.map guarantees this) -- callers zip results back
    against the same `items` list."""

    if len(items) <= 1:
        return [resolve_item(item) for item in items]
    with ThreadPoolExecutor(max_workers=_MAX_CONCURRENT_RESOLUTIONS) as executor:
        return list(executor.map(resolve_item, items))


class PasteTextPayload(BaseModel):
    text: str


class ItemUpdate(BaseModel):
    name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    price: Optional[float] = None
    is_non_food: Optional[bool] = None


class ItemCorrection(BaseModel):
    matched_name: Optional[str] = None
    off_id: Optional[str] = None
    bls_code: Optional[str] = None
    nutrition: dict = {}


class ReceiptUpdate(BaseModel):
    store: Optional[str] = None
    purchased_at: Optional[str] = None


def _persist_parsed(parsed: dict, source: str, raw_text: Optional[str], profile_id: int) -> dict:
    if parsed.get("error"):
        raise HTTPException(status_code=422, detail=parsed["error"])

    parsed = non_food_terms.filter_learned_non_food(parsed)
    receipt = repo.create_receipt(
        profile_id=profile_id,
        source=source,
        raw_text=raw_text,
        store=parsed.get("store"),
        purchased_at=parsed.get("date"),
    )
    items = [
        {
            "name": item["name"],
            "original_text": item["original_text"],
            "quantity": item["quantity"],
            "unit": item["unit"],
            "price": item["price"],
            "category": item["category"],
            "uncertain": item.get("uncertain", False),
        }
        for item in parsed["items"]
    ]
    saved_items = repo.insert_receipt_items(receipt["id"], items)

    # US 4.2 needs match confidence visible in the review screen (US 3.4)
    # before the user ever reaches Confirm, so resolve immediately on
    # insert rather than waiting for confirm_receipt's pass below. Editing
    # an item during review leaves its match stale until Confirm, which
    # unconditionally re-resolves every remaining item regardless.
    matched_products = _resolve_concurrently(saved_items)
    resolved_items = [
        repo.update_receipt_item(item["id"], matched_product_to_row(matched))
        for item, matched in zip(saved_items, matched_products, strict=False)
    ]
    return {"receipt": receipt, "items": resolved_items}


def _owned_receipt_or_404(receipt_id: str, profile_id: int) -> dict:
    """Every by-id endpoint below fetches the receipt anyway (to build its
    response or check status) -- this just adds the one extra condition so
    receipt A's owner can't act on receipt B by guessing its uuid."""

    receipt = repo.get_receipt(receipt_id)
    if not receipt or receipt.get("profile_id") != profile_id:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return receipt


@router.post("")
async def upload_receipt_file(
    file: UploadFile = File(...), profile_id: int = Depends(require_profile_id)
):
    """Epic 3.1 — upload a receipt photo or PDF; OCR/text-layer extraction
    and parsing happen synchronously, no manual OCR step from the user."""

    file_bytes = await file.read()
    try:
        raw_text = local_extractor.extract_text(file_bytes, file.filename)
    except local_extractor.UnreadableReceipt as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    parsed = receipt_text_parser.parse_receipt_text_offline(raw_text)
    source = "pdf" if (file.filename or "").lower().endswith(".pdf") else "image"
    return _persist_parsed(parsed, source, raw_text, profile_id)


@router.post("/text")
def upload_receipt_text(
    payload: PasteTextPayload, profile_id: int = Depends(require_profile_id)
):
    """Epic 3.2 — pasted text bypasses OCR entirely.

    allow_plain_names=True here (never for the file-upload path above): a
    manually typed list like "Paprika, Apfel, Huhn" carries no prices at
    all, which is fine for a human typing it in but would otherwise fail
    every price-anchored heuristic in the parser."""

    parsed = receipt_text_parser.parse_receipt_text_offline(
        payload.text, allow_plain_names=True
    )
    return _persist_parsed(parsed, "pasted_text", payload.text, profile_id)


@router.get("/stores")
def list_stores(profile_id: int = Depends(require_profile_id)):
    """Distinct store names this profile has used before -- backs the
    upload review screen's "pick an existing store" option when a
    receipt's store couldn't be detected. Registered before the
    /{receipt_id} route below so "stores" is never matched as an id."""

    return {"stores": repo.get_distinct_stores(profile_id)}


@router.get("/{receipt_id}")
def get_receipt(receipt_id: str, profile_id: int = Depends(require_profile_id)):
    receipt = _owned_receipt_or_404(receipt_id, profile_id)
    return {"receipt": receipt, "items": repo.get_receipt_items(receipt_id)}


@router.patch("/{receipt_id}")
def update_receipt(
    receipt_id: str, payload: ReceiptUpdate, profile_id: int = Depends(require_profile_id)
):
    """Fills in a receipt's store/purchase date when the scan couldn't
    detect them (services/receipt_text_parser.py's _detect_store/_detect_date).
    The review screen requires this before Confirm whenever either is
    missing, so purchase-history sorting/display (which keys on
    purchased_at) reflects when the shopping actually happened rather than
    silently falling back to the upload timestamp."""

    _owned_receipt_or_404(receipt_id, profile_id)
    fields = payload.model_dump(exclude_unset=True, exclude_none=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    return repo.update_receipt(receipt_id, fields)


@router.patch("/{receipt_id}/items/{item_id}")
def update_item(
    receipt_id: str,
    item_id: str,
    payload: ItemUpdate,
    profile_id: int = Depends(require_profile_id),
):
    """Epic 3.4 — inline edit or mark-as-non-food before confirming.

    Marking an item non-food also teaches non_food_terms.py (the opposite-
    direction sibling of Epic 4.2's verified-match learning): the same line
    is then auto-recognized and stripped out on every future upload, before
    it's even inserted as a receipt_item -- see that module's docstring."""

    _owned_receipt_or_404(receipt_id, profile_id)
    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = repo.update_receipt_item(item_id, fields)
    if fields.get("is_non_food") is True:
        name = updated.get("name") or updated.get("original_text")
        if name:
            non_food_terms.record_non_food_term(name)
    return updated


@router.delete("/{receipt_id}/items/{item_id}", status_code=204)
def delete_item(receipt_id: str, item_id: str, profile_id: int = Depends(require_profile_id)):
    _owned_receipt_or_404(receipt_id, profile_id)
    repo.delete_receipt_item(item_id)


@router.post("/{receipt_id}/confirm")
def confirm_receipt(receipt_id: str, profile_id: int = Depends(require_profile_id)):
    """Epic 3.4 / Epic 4.1 — finalize: run the tiered matcher on every
    remaining (non-non-food) item and persist the matched nutrition data."""

    _owned_receipt_or_404(receipt_id, profile_id)

    food_items = [
        item for item in repo.get_receipt_items(receipt_id) if not item.get("is_non_food")
    ]
    matched_products = _resolve_concurrently(food_items)
    updated = [
        repo.update_receipt_item(item["id"], matched_product_to_row(matched))
        for item, matched in zip(food_items, matched_products, strict=False)
    ]

    repo.set_receipt_status(receipt_id, "confirmed")
    return {
        "receipt_id": receipt_id,
        "status": "confirmed",
        "items": updated,
        "match_quality": compute_match_quality(matched_products) if matched_products else None,
    }


@router.get("/{receipt_id}/items/{item_id}/candidates")
def search_candidates(
    receipt_id: str, item_id: str, q: str, profile_id: int = Depends(require_profile_id)
):
    """Epic 4.2 — search OFF + BLS for a manual pick, for items flagged
    below the confidence threshold in review. The receipt-scoped twin of
    GET /match/candidates: same search, plus an ownership check on the item
    being corrected."""

    _owned_receipt_or_404(receipt_id, profile_id)
    return {"candidates": match.search_candidates(q)}


@router.post("/{receipt_id}/items/{item_id}/correct")
def correct_item(
    receipt_id: str,
    item_id: str,
    payload: ItemCorrection,
    profile_id: int = Depends(require_profile_id),
):
    """Epic 4.2 — persist a manual correction on this item, and remember it
    as a verified match (services/verified_matches.py) so the same product
    never needs re-correcting on a future receipt."""

    receipt = _owned_receipt_or_404(receipt_id, profile_id)
    items = repo.get_receipt_items(receipt_id)
    item = next((i for i in items if i["id"] == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    row = {
        "match_type": "learned",
        "confidence": 1.0,
        "identity_conf": 1.0,
        "nutrition_conf": 1.0,
        "unknown": False,
        "data_source": "manual correction",
        "matched_name": payload.matched_name,
        "off_id": payload.off_id,
        "bls_code": payload.bls_code,
        **payload.nutrition,
    }
    updated = repo.update_receipt_item(item_id, row)

    # Keyed on the already-cleaned `name`, not `original_text` -- the Tier-0
    # read path (resolver._learned) only ever looks up by `name` (see its
    # comment), so keying the write side on the untouched receipt line
    # instead meant a correction could carry OCR/price/tax-letter cruft
    # (e.g. "Bio Paprika Mix 400g 2,29 B") that normalize_match_key doesn't
    # strip the same way it strips an already-cleaned name, silently
    # writing a key the read path would never look up again.
    verified_matches.record_verified_match(
        raw_text=item["name"],
        store=receipt.get("store"),
        off_id=payload.off_id,
        bls_code=payload.bls_code,
        matched_name=payload.matched_name,
        nutrition=payload.nutrition,
    )
    return updated
