"""Epic 3 (upload/OCR/parse + review) & Epic 4 (nutrition matching) endpoints."""

from typing import Optional

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

from backend.app.analytics.match_quality import compute_match_quality
from backend.app.db import repo
from backend.app.services import (
    bls_matcher,
    local_extractor,
    non_food_terms,
    off_api,
    receipt_text_parser,
    verified_matches,
)
from backend.app.services.nutrition_mapping import matched_product_to_row
from backend.app.services.resolver import resolve_item

router = APIRouter(prefix="/receipts", tags=["receipts"])


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


def _persist_parsed(parsed: dict, source: str, raw_text: Optional[str]) -> dict:
    if parsed.get("error"):
        raise HTTPException(status_code=422, detail=parsed["error"])

    parsed = non_food_terms.filter_learned_non_food(parsed)
    receipt = repo.create_receipt(
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
    #
    # receipt_items has no `store` column (it lives on the parent receipt),
    # so resolve_item's Tier-0 lookup (resolver._learned -> item.get("store"))
    # was always seeing None here -- every verified-match lookup silently
    # degraded to the store-agnostic scope only, missing every row recorded
    # under a real store (i.e. nearly all of them). `store` must be merged
    # onto the transient dict passed to resolve_item (not persisted onto
    # the row itself -- matched_product_to_row never includes it).
    resolved_items = [
        repo.update_receipt_item(
            item["id"],
            matched_product_to_row(resolve_item({**item, "store": receipt.get("store")})),
        )
        for item in saved_items
    ]
    return {"receipt": receipt, "items": resolved_items}


@router.post("")
async def upload_receipt_file(file: UploadFile = File(...)):
    """Epic 3.1 — upload a receipt photo or PDF; OCR/text-layer extraction
    and parsing happen synchronously, no manual OCR step from the user."""

    file_bytes = await file.read()
    try:
        raw_text = local_extractor.extract_text(file_bytes, file.filename)
    except local_extractor.UnreadableReceipt as e:
        raise HTTPException(status_code=422, detail=str(e)) from e

    parsed = receipt_text_parser.parse_receipt_text_offline(raw_text)
    source = "pdf" if (file.filename or "").lower().endswith(".pdf") else "image"
    return _persist_parsed(parsed, source, raw_text)


@router.post("/text")
def upload_receipt_text(payload: PasteTextPayload):
    """Epic 3.2 — pasted text bypasses OCR entirely."""

    parsed = receipt_text_parser.parse_receipt_text_offline(payload.text)
    return _persist_parsed(parsed, "pasted_text", payload.text)


@router.get("/{receipt_id}")
def get_receipt(receipt_id: str):
    receipt = repo.get_receipt(receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return {"receipt": receipt, "items": repo.get_receipt_items(receipt_id)}


@router.patch("/{receipt_id}/items/{item_id}")
def update_item(receipt_id: str, item_id: str, payload: ItemUpdate):
    """Epic 3.4 — inline edit or mark-as-non-food before confirming."""

    fields = payload.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    return repo.update_receipt_item(item_id, fields)


@router.delete("/{receipt_id}/items/{item_id}", status_code=204)
def delete_item(receipt_id: str, item_id: str):
    repo.delete_receipt_item(item_id)


@router.post("/{receipt_id}/confirm")
def confirm_receipt(receipt_id: str):
    """Epic 3.4 / Epic 4.1 — finalize: run the tiered matcher on every
    remaining (non-non-food) item and persist the matched nutrition data."""

    receipt = repo.get_receipt(receipt_id)
    if not receipt:
        raise HTTPException(status_code=404, detail="Receipt not found")

    updated = []
    matched_products = []
    for item in repo.get_receipt_items(receipt_id):
        if item.get("is_non_food"):
            continue
        matched = resolve_item({**item, "store": receipt.get("store")})
        matched_products.append(matched)
        updated.append(repo.update_receipt_item(item["id"], matched_product_to_row(matched)))

    repo.set_receipt_status(receipt_id, "confirmed")
    return {
        "receipt_id": receipt_id,
        "status": "confirmed",
        "items": updated,
        "match_quality": compute_match_quality(matched_products) if matched_products else None,
    }


_CANDIDATE_POOL_SIZE = 15  # over-fetch so filtering out incomplete macros still leaves _CANDIDATE_RESULT_SIZE
_CANDIDATE_RESULT_SIZE = 5
_MACRO_FIELDS = ("calories_kcal", "protein_g", "fat_g", "carbs_g")


def _has_macros(nutrition: dict) -> bool:
    return all(nutrition.get(f) is not None for f in _MACRO_FIELDS)


@router.get("/{receipt_id}/items/{item_id}/candidates")
def search_candidates(receipt_id: str, item_id: str, q: str):
    """Epic 4.2 — search OFF + BLS for a manual pick, for items flagged
    below the confidence threshold in review. Restricted to the top 5
    candidates per source that carry a complete macro profile — a match
    missing calories/protein/fat/carbs isn't a usable pick."""

    off_candidates = []
    for p in off_api.search_products(q, page_size=_CANDIDATE_POOL_SIZE):
        nutrition = off_api.extract_nutrition(p).model_dump()
        if not _has_macros(nutrition):
            continue
        off_candidates.append(
            {
                "source": "off",
                "off_id": str(p.get("code")) if p.get("code") else None,
                "matched_name": off_api.product_display_name(p),
                "nutrition": nutrition,
            }
        )
        if len(off_candidates) >= _CANDIDATE_RESULT_SIZE:
            break

    bls_candidates = []
    for rec in bls_matcher.search_bls(q, page_size=_CANDIDATE_POOL_SIZE):
        nutrition = bls_matcher.record_nutrition(rec)
        if not _has_macros(nutrition):
            continue
        bls_candidates.append(
            {
                "source": "bls",
                "bls_code": rec["code"],
                "matched_name": rec["name_de"],
                "nutrition": nutrition,
            }
        )
        if len(bls_candidates) >= _CANDIDATE_RESULT_SIZE:
            break

    return {"candidates": off_candidates + bls_candidates}


@router.post("/{receipt_id}/items/{item_id}/correct")
def correct_item(receipt_id: str, item_id: str, payload: ItemCorrection):
    """Epic 4.2 — persist a manual correction on this item, and remember it
    as a verified match (services/verified_matches.py) so the same product
    never needs re-correcting on a future receipt."""

    receipt = repo.get_receipt(receipt_id)
    items = repo.get_receipt_items(receipt_id)
    item = next((i for i in items if i["id"] == item_id), None)
    if not receipt or not item:
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
