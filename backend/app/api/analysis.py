"""Epic 5 (macro composition & target comparison) and Epic 6
(bucketing & diversity) endpoints."""

from fastapi import APIRouter, HTTPException

from backend.app.db import repo
from backend.app.models.profile import Profile
from backend.app.services.basket_composition import compute_basket_composition
from backend.app.services.bucketing import compute_buckets
from backend.app.services.diversity import compute_diversity
from backend.app.services.ideal_profile import compute_ideal_profile, macro_percentages

router = APIRouter(prefix="/analysis", tags=["analysis"])

_EMPTY_COMPOSITION = {
    "protein_pct": None,
    "fat_pct": None,
    "carb_pct": None,
    "unaccounted_pct": None,
    "kcal_total": None,
    "items_considered": 0,
}


def _targets_or_404() -> dict:
    stored = repo.get_profile()
    if not stored:
        raise HTTPException(status_code=404, detail="No profile yet")
    targets = compute_ideal_profile(Profile(**stored))
    if targets is None:
        raise HTTPException(status_code=422, detail="Profile is incomplete")
    return macro_percentages(targets)


@router.get("/summary")
def get_summary():
    """How much data the analysis below is actually based on — the number
    of confirmed receipts and (food, i.e. non-non-food) items across them."""

    items = repo.get_all_confirmed_receipt_items()
    return {
        "receipts_count": len({item["receipt_id"] for item in items}),
        "items_count": len(items),
    }


@router.get("/composition")
def get_composition():
    """Epic 5.1 — calorie-weighted macro split across every finalized
    (confirmed) receipt to date."""

    items = repo.get_all_confirmed_receipt_items()
    composition = compute_basket_composition(items)
    return composition or _EMPTY_COMPOSITION


@router.get("/target-comparison")
def get_target_comparison():
    """Epic 5.2 — actual vs. target macro %, a per-macro delta, and one
    overall closeness score (0-100; 100 = exact match)."""

    target_pct = _targets_or_404()
    items = repo.get_all_confirmed_receipt_items()
    composition = compute_basket_composition(items) or _EMPTY_COMPOSITION

    deltas = {}
    diffs = []
    for macro in ("protein", "fat", "carb"):
        actual = composition.get(f"{macro}_pct")
        target = target_pct.get(f"{macro}_pct")
        if actual is None or target is None:
            deltas[macro] = None
            continue
        diff = round(actual - target, 1)
        deltas[macro] = diff
        diffs.append(abs(diff))

    closeness = round(max(0.0, 100.0 - sum(diffs) / len(diffs)), 1) if diffs else None

    return {
        "actual_pct": {k: composition.get(f"{k}_pct") for k in ("protein", "fat", "carb")},
        "target_pct": target_pct,
        "delta_pct": deltas,
        "closeness_score": closeness,
        "items_considered": composition.get("items_considered", 0),
    }


@router.get("/buckets")
def get_buckets():
    """Epic 6.1 — consume-more/consume-less per item, combining nutrient
    quality with the current macro gap (see services/bucketing.py for the
    threshold sources)."""

    target_pct = _targets_or_404()
    items = repo.get_all_confirmed_receipt_items()
    composition = compute_basket_composition(items) or _EMPTY_COMPOSITION
    actual_pct = {k: composition.get(k) for k in ("protein_pct", "fat_pct", "carb_pct")}
    return {"buckets": compute_buckets(items, actual_pct, target_pct)}


@router.get("/diversity")
def get_diversity():
    """Epic 6.2 — per-macro source diversity + plain-language callouts."""

    items = repo.get_all_confirmed_receipt_items()
    return compute_diversity(items)
