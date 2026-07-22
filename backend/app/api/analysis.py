"""Epic 5 (macro composition & target comparison) and Epic 6
(bucketing & diversity) endpoints."""

from fastapi import APIRouter, Depends, HTTPException

from backend.app.core.auth import require_profile_id
from backend.app.db import repo
from backend.app.models.profile import Profile
from backend.app.services.basket_composition import compute_basket_composition
from backend.app.services.bucketing import compute_buckets
from backend.app.services.diversity import compute_diversity
from backend.app.services.ideal_profile import (
    FIBER_G_PER_1000KCAL,
    compute_ideal_profile,
    macro_percentages,
)
from backend.app.services.nutrition_profile import grams_for

router = APIRouter(prefix="/analysis", tags=["analysis"])

_EMPTY_COMPOSITION = {
    "protein_pct": None,
    "fat_pct": None,
    "carb_pct": None,
    "unaccounted_pct": None,
    "kcal_total": None,
    "fiber_per_1000kcal": None,
    "items_considered": 0,
}


def _targets_or_404(profile_id: int) -> dict:
    stored = repo.get_profile(profile_id)
    if not stored:
        raise HTTPException(status_code=404, detail="No profile yet")
    targets = compute_ideal_profile(Profile(**stored))
    if targets is None:
        raise HTTPException(status_code=422, detail="Profile is incomplete")
    return macro_percentages(targets)


@router.get("/summary")
def get_summary(profile_id: int = Depends(require_profile_id)):
    """How much data the analysis below is actually based on — the number
    of confirmed receipts and (food, i.e. non-non-food) items across them."""

    items = repo.get_all_confirmed_receipt_items(profile_id)
    return {
        "receipts_count": len({item["receipt_id"] for item in items}),
        "items_count": len(items),
    }


@router.get("/purchases")
def get_purchases(profile_id: int = Depends(require_profile_id)):
    """Purchases page — every item across every confirmed receipt (food AND
    non-food, unlike the food-only aggregates below), with where it was
    bought, the actual kcal/macros for the purchased quantity (not the
    stored per-100g reference values -- see nutrition_profile.grams_for),
    and how it was matched."""

    rows = repo.get_all_confirmed_receipt_items_with_receipt_info(profile_id)
    items = []
    for row in rows:
        receipt = row.get("receipts") or {}
        cal_per_100g = row.get("calories_kcal")
        actual = {"calories_kcal": None, "protein_g": None, "fat_g": None, "carbs_g": None, "fiber_g": None}
        if cal_per_100g is not None:
            factor = (
                grams_for(row.get("quantity"), row.get("unit"), row.get("category"), row.get("name")) / 100.0
            )
            actual = {
                "calories_kcal": round(cal_per_100g * factor, 1),
                "protein_g": round((row.get("protein_g") or 0.0) * factor, 1),
                "fat_g": round((row.get("fat_g") or 0.0) * factor, 1),
                "carbs_g": round((row.get("carbs_g") or 0.0) * factor, 1),
                "fiber_g": round((row.get("fiber_g") or 0.0) * factor, 1),
            }
        items.append(
            {
                "id": row["id"],
                "receipt_id": row["receipt_id"],
                "name": row["name"],
                "store": receipt.get("store"),
                "purchased_at": receipt.get("purchased_at") or receipt.get("created_at"),
                "quantity": row.get("quantity"),
                "unit": row.get("unit"),
                "is_non_food": row.get("is_non_food", False),
                "match_type": row.get("match_type"),
                "matched_name": row.get("matched_name"),
                "fallback_category": row.get("fallback_category"),
                "confidence": row.get("confidence"),
                **actual,
            }
        )
    items.sort(key=lambda i: i["purchased_at"] or "", reverse=True)
    return {"items": items}


@router.get("/composition")
def get_composition(profile_id: int = Depends(require_profile_id)):
    """Epic 5.1 — calorie-weighted macro split across every finalized
    (confirmed) receipt to date."""

    items = repo.get_all_confirmed_receipt_items(profile_id)
    composition = compute_basket_composition(items)
    return composition or _EMPTY_COMPOSITION


@router.get("/target-comparison")
def get_target_comparison(profile_id: int = Depends(require_profile_id)):
    """Epic 5.2 — actual vs. target macro %, a per-macro delta, and one
    overall closeness score (0-100; 100 = exact match)."""

    target_pct = _targets_or_404(profile_id)
    items = repo.get_all_confirmed_receipt_items(profile_id)
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

    # Fiber isn't one of the 3 %-of-calories macros above (BR-M7: its target
    # is a fixed g/1000kcal density, see ideal_profile.FIBER_G_PER_1000KCAL),
    # so it gets its own actual/target/delta trio in the same density unit
    # rather than folding into actual_pct/target_pct/delta_pct or the
    # closeness score, which stays a 3-macro figure by definition.
    fiber_actual = composition.get("fiber_per_1000kcal")
    fiber_delta = round(fiber_actual - FIBER_G_PER_1000KCAL, 1) if fiber_actual is not None else None

    return {
        "actual_pct": {k: composition.get(f"{k}_pct") for k in ("protein", "fat", "carb")},
        "target_pct": target_pct,
        "delta_pct": deltas,
        "fiber_actual_per_1000kcal": fiber_actual,
        "fiber_target_per_1000kcal": FIBER_G_PER_1000KCAL,
        "fiber_delta_per_1000kcal": fiber_delta,
        "closeness_score": closeness,
        "items_considered": composition.get("items_considered", 0),
    }


@router.get("/buckets")
def get_buckets(profile_id: int = Depends(require_profile_id)):
    """Epic 6.1 — consume-more/consume-less per item, combining nutrient
    quality with the current macro gap (see services/bucketing.py for the
    threshold sources)."""

    target_pct = _targets_or_404(profile_id)
    items = repo.get_all_confirmed_receipt_items(profile_id)
    composition = compute_basket_composition(items) or _EMPTY_COMPOSITION
    actual_pct = {k: composition.get(k) for k in ("protein_pct", "fat_pct", "carb_pct")}
    return {"buckets": compute_buckets(items, actual_pct, target_pct)}


@router.get("/diversity")
def get_diversity(profile_id: int = Depends(require_profile_id)):
    """Epic 6.2 — per-macro source diversity + plain-language callouts."""

    items = repo.get_all_confirmed_receipt_items(profile_id)
    return compute_diversity(items)
