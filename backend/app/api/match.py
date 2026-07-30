"""Product match search (Epic 4.2), decoupled from a specific receipt item.

The same OFF + BLS candidate search that powers the review screen's "fix
match" is also needed *before* an item exists -- when manually adding a food
to the basket (Vorrat.md), the user searches by name and picks a match, so
the pick has to be reachable without a receipt_id/item_id yet. The core
search lives here as a plain function and is reused by the receipt-scoped
endpoint in receipts.py."""

from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.app.core.auth import require_profile_id
from backend.app.services import bls_matcher, off_api, rejected_matches
from backend.app.services.text_similarity import token_similarity

router = APIRouter(prefix="/match", tags=["match"])

_CANDIDATE_POOL_SIZE = 15  # over-fetch so filtering out incomplete macros/rejections still leaves _CANDIDATE_RESULT_SIZE
_CANDIDATE_RESULT_SIZE = 3
_MACRO_FIELDS = ("calories_kcal", "protein_g", "fat_g", "carbs_g")


def _has_macros(nutrition: dict) -> bool:
    return all(nutrition.get(f) is not None for f in _MACRO_FIELDS)


def search_candidates(q: str, store: Optional[str] = None) -> dict:
    """Search OFF + BLS and return the top candidates per source that carry a
    complete macro profile -- a match missing calories/protein/fat/carbs isn't
    a usable pick. Returns the two sources separately (rather than one
    concatenated list) so "OFF found nothing usable for this text" is an
    honest, visible state instead of silently absent rows, and so each
    source can independently show its own top 3 (see api/receipts.py and
    frontend MatchSearchPanel).

    Candidates the user has already dismissed via the reject endpoint
    (services/rejected_matches.py) are filtered out before truncating to
    _CANDIDATE_RESULT_SIZE, so a rejection is transparently backfilled by
    the next-ranked candidate on the very next search.

    `store`, when given, is passed to off_api.search_products as a soft
    ranking boost (api/receipts.py's receipt-scoped candidate search has a
    receipt to read a store from; this function's receipt-independent
    caller does not).

    The response's `off_rate_limited` flag distinguishes "OFF's rate limit
    (or a temporary outage) was hit, so this may be incomplete" from a
    confirmed empty OFF result -- the frontend shows a different note for
    each rather than implying "no match" when the real story is "couldn't
    ask"."""

    rejected = rejected_matches.get_rejected_ids(q)

    off_products, off_rate_limited = off_api.search_products_with_status(
        q, page_size=_CANDIDATE_POOL_SIZE, store=store
    )
    off_candidates = []
    for p in off_products:
        off_id = str(p.get("code")) if p.get("code") else None
        if off_id is not None and off_id in rejected["off"]:
            continue
        nutrition = off_api.extract_nutrition(p).model_dump()
        if not _has_macros(nutrition):
            continue
        score = max(
            (token_similarity(q, text) for text in off_api.product_match_text(p)),
            default=0.0,
        )
        off_candidates.append(
            (
                score,
                {
                    "source": "off",
                    "off_id": off_id,
                    "matched_name": off_api.product_display_name(p),
                    "nutrition": nutrition,
                },
            )
        )
    off_candidates.sort(key=lambda t: -t[0])
    off_candidates = [c for _, c in off_candidates[:_CANDIDATE_RESULT_SIZE]]

    bls_candidates = []
    for rec in bls_matcher.search_bls(q, page_size=_CANDIDATE_POOL_SIZE):
        if rec["code"] in rejected["bls"]:
            continue
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

    return {"off": off_candidates, "bls": bls_candidates, "off_rate_limited": off_rate_limited}


def reject_candidate(q: str, source: str, external_id: str) -> None:
    """Record a dismissed candidate (the search panel's X button) so it's
    excluded from every future search for this normalized text."""

    rejected_matches.record_rejected_match(q, source, external_id)


class RejectPayload(BaseModel):
    query: str
    source: str
    external_id: str


@router.get("/candidates")
def match_candidates(q: str, profile_id: int = Depends(require_profile_id)):
    """Receipt-independent product search, for manually adding a basket item
    (the receipt-scoped twin is GET /receipts/{id}/items/{id}/candidates)."""

    return search_candidates(q)


@router.post("/candidates/reject")
def match_candidates_reject(payload: RejectPayload, profile_id: int = Depends(require_profile_id)):
    """Receipt-independent twin of POST /receipts/{id}/items/{id}/candidates/reject."""

    reject_candidate(payload.query, payload.source, payload.external_id)
    return {"status": "ok"}
