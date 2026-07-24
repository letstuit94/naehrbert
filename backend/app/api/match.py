"""Product match search (Epic 4.2), decoupled from a specific receipt item.

The same OFF + BLS candidate search that powers the review screen's "fix
match" is also needed *before* an item exists -- when manually adding a food
to the basket (Vorrat.md), the user searches by name and picks a match, so
the pick has to be reachable without a receipt_id/item_id yet. The core
search lives here as a plain function and is reused by the receipt-scoped
endpoint in receipts.py."""

from fastapi import APIRouter, Depends

from backend.app.core.auth import require_profile_id
from backend.app.services import bls_matcher, off_api

router = APIRouter(prefix="/match", tags=["match"])

_CANDIDATE_POOL_SIZE = 15  # over-fetch so filtering out incomplete macros still leaves _CANDIDATE_RESULT_SIZE
_CANDIDATE_RESULT_SIZE = 5
_MACRO_FIELDS = ("calories_kcal", "protein_g", "fat_g", "carbs_g")


def _has_macros(nutrition: dict) -> bool:
    return all(nutrition.get(f) is not None for f in _MACRO_FIELDS)


def search_candidates(q: str) -> list[dict]:
    """Search OFF + BLS and return the top candidates per source that carry a
    complete macro profile -- a match missing calories/protein/fat/carbs isn't
    a usable pick. Pure query -> candidates, no receipt/item coupling."""

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

    return off_candidates + bls_candidates


@router.get("/candidates")
def match_candidates(q: str, profile_id: int = Depends(require_profile_id)):
    """Receipt-independent product search, for manually adding a basket item
    (the receipt-scoped twin is GET /receipts/{id}/items/{id}/candidates)."""

    return {"candidates": search_candidates(q)}
