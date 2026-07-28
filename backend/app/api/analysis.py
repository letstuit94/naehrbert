"""Epic 5 (macro composition & target comparison) and Epic 6
(bucketing & diversity) endpoints."""

from datetime import date, timezone
from datetime import datetime as _datetime

from fastapi import APIRouter, Depends, HTTPException

from backend.app.core.auth import require_profile_id
from backend.app.db import repo
from backend.app.models.profile import Profile
from backend.app.services.basket_composition import compute_basket_composition
from backend.app.services.bucketing import compute_buckets
from backend.app.services.dge_matcher import get_micronutrient_targets
from backend.app.services.diversity import compute_diversity
from backend.app.services.ideal_profile import (
    FIBER_G_PER_1000KCAL,
    _age_from_dob,
    compute_ideal_profile,
    macro_percentages,
)
from backend.app.services.micronutrients import compute_micronutrient_totals
from backend.app.services.nutrition_profile import grams_for
from backend.app.services.plant_diversity import compute_plant_diversity

router = APIRouter(prefix="/analysis", tags=["analysis"])

# Konsum.md Stufe 1: results reflect current buying habits (~4 weekly
# shops), not a lifetime sum. Same 28-day window plant_diversity.py already
# uses -- the Results page's "(over the last 28 days)" heading text now
# matches what's actually computed, rather than just describing it.
# EWMA weighting (half_life_days, default 30) still applies *within* this
# window on top of the hard cutoff -- see compute_basket_composition's
# docstring for how the two combine.
_RESULTS_WINDOW_DAYS = 28

_EMPTY_COMPOSITION = {
    "protein_pct": None,
    "fat_pct": None,
    "carb_pct": None,
    "unaccounted_pct": None,
    "kcal_total": None,
    "fiber_per_1000kcal": None,
    "items_considered": 0,
    "receipts_considered": 0,
    "macro_coverage_pct": None,
    "match_coverage_pct": None,
    "fallback_share_pct": None,
    "quantity_coverage_pct": None,
    "low_confidence": True,
}


def _today() -> date:
    """Reference date for the recency-weighted composition (UTC to match the
    stored timestamps)."""
    return _datetime.now(timezone.utc).date()


def _scaled_macro(value, factor):
    """Scale a per-100g macro to the purchased quantity, preserving None
    (unknown) instead of turning it into a measured 0 g."""
    return round(value * factor, 1) if value is not None else None


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
            # A missing macro is *unknown*, not 0 g -- scaling `or 0.0`
            # would show "0.0 g protein" for an item we never resolved,
            # which reads as a measured zero. Keep it None so the UI shows "—".
            actual = {
                "calories_kcal": round(cal_per_100g * factor, 1),
                "protein_g": _scaled_macro(row.get("protein_g"), factor),
                "fat_g": _scaled_macro(row.get("fat_g"), factor),
                "carbs_g": _scaled_macro(row.get("carbs_g"), factor),
                "fiber_g": _scaled_macro(row.get("fiber_g"), factor),
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
    """Epic 5.1 — calorie-weighted macro split over the last
    _RESULTS_WINDOW_DAYS (Konsum.md Stufe 1), not a lifetime sum."""

    items = repo.get_all_confirmed_receipt_items(profile_id)
    composition = compute_basket_composition(items, reference_date=_today(), window_days=_RESULTS_WINDOW_DAYS)
    return composition or _EMPTY_COMPOSITION


@router.get("/target-comparison")
def get_target_comparison(profile_id: int = Depends(require_profile_id)):
    """Epic 5.2 — actual vs. target macro %, a per-macro delta, and one
    overall closeness score (0-100; 100 = exact match).

    closeness_score = 100 - sum(|actual% - target%|) across protein/fat/carb,
    floored at 0. Summed rather than averaged: averaging let one macro that's
    badly off target (e.g. protein at half its goal) get diluted by two
    macros that happen to be close, producing a deceptively high score for
    a purchase pattern that's actually missing a target by a lot."""

    target_pct = _targets_or_404(profile_id)
    items = repo.get_all_confirmed_receipt_items(profile_id)
    composition = compute_basket_composition(items, reference_date=_today(), window_days=_RESULTS_WINDOW_DAYS) or _EMPTY_COMPOSITION

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

    closeness = round(max(0.0, 100.0 - sum(diffs)), 1) if diffs else None

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
    composition = compute_basket_composition(items, reference_date=_today(), window_days=_RESULTS_WINDOW_DAYS) or _EMPTY_COMPOSITION
    actual_pct = {k: composition.get(k) for k in ("protein_pct", "fat_pct", "carb_pct")}
    return {"buckets": compute_buckets(items, actual_pct, target_pct)}


@router.get("/diversity")
def get_diversity(profile_id: int = Depends(require_profile_id)):
    """Epic 6.2 — per-macro source diversity + plain-language callouts."""

    items = repo.get_all_confirmed_receipt_items(profile_id)
    return compute_diversity(items)


@router.get("/meal-coverage")
def get_meal_coverage(profile_id: int = Depends(require_profile_id)):
    """Konsum.md Stufe 5 — how much of the daily calorie target the last
    _RESULTS_WINDOW_DAYS of grocery purchases would cover if fully
    consumed, as a fraction of that target (shown inline on the Daily
    calories card, not as its own tile).

    Uses an (effectively) undecayed composition -- this answers "how much
    food do you physically have", not the EWMA-weighted current macro mix
    compute_basket_composition's default half_life_days models elsewhere."""

    stored = repo.get_profile(profile_id)
    if not stored:
        raise HTTPException(status_code=404, detail="No profile yet")
    targets = compute_ideal_profile(Profile(**stored))
    if targets is None:
        raise HTTPException(status_code=422, detail="Profile is incomplete")

    items = repo.get_all_confirmed_receipt_items(profile_id)
    raw = compute_basket_composition(
        items, reference_date=_today(), window_days=_RESULTS_WINDOW_DAYS, half_life_days=1e6,
    )
    kcal_purchased = (raw or {}).get("kcal_total") or 0.0
    share_pct = stored.get("consumption_share_pct") or 100.0
    effective_kcal = kcal_purchased * share_pct / 100.0

    return {
        "window_days": _RESULTS_WINDOW_DAYS,
        "kcal_purchased": round(kcal_purchased, 1),
        "consumption_share_pct": share_pct,
        "effective_kcal": round(effective_kcal, 1),
        "daily_target_kcal": targets.calories_kcal,
    }


@router.get("/micronutrients")
def get_micronutrients(profile_id: int = Depends(require_profile_id)):
    """28-day BLS-sourced micronutrient totals + a trust metric, alongside
    the DGE's daily reference values (services/dge_matcher.py) for this
    profile's age/sex/life_stage -- unlike IdealProfile's macro targets,
    these come from an external reference table, not this app's own
    formulas, so they're returned here rather than folded into IdealProfile."""

    items = repo.get_all_confirmed_receipt_items(profile_id)
    result = compute_micronutrient_totals(items, reference_date=_today(), window_days=_RESULTS_WINDOW_DAYS)

    stored = repo.get_profile(profile_id)
    targets = None
    if stored:
        age = _age_from_dob(stored["date_of_birth"])
        if age is not None:
            targets = get_micronutrient_targets(age, stored["sex"], stored.get("life_stage") or "none")
    result["targets"] = targets
    return result


@router.get("/plant-diversity")
def get_plant_diversity(profile_id: int = Depends(require_profile_id)):
    """Results page's plant-diversity progress bar — distinct fruits/
    vegetables/whole grains/legumes/nuts&seeds/herbs&spices bought in the
    last 28 days (see services/plant_diversity.py for the category scope
    and why the window is 28 days, not a lifetime sum)."""

    items = repo.get_all_confirmed_receipt_items(profile_id)
    return compute_plant_diversity(items, reference_date=_today())
