"""
Consume-more / consume-less bucketing (Epic 6.1) — net-new logic, no
old-repo equivalent to port.

Combines two signals per item:

1. Nutrient quality — fiber/sugar/saturated-fat/sodium density, scored
   against per-100kcal thresholds rather than the more common per-100g
   ones, to match this app's existing calorie-weighted conventions
   (Epic 2's fiber target is 14g/1000kcal; Epic 5's macro split is
   calorie-weighted). Threshold provenance, so these are auditable/
   tunable rather than asserted as fact:
     - Sugar / saturated fat: WHO's dietary guideline of keeping free
       sugars and saturated fat each under 10% of total energy (<5% is
       the "low" band WHO cites as the tighter, ideal target).
     - Fiber: the EU nutrition-claim thresholds for "source of fibre"
       (>1.5g/100kcal) and "high fibre" (>3g/100kcal) — these are the
       per-100kcal alternates to the more commonly quoted per-100g
       figures (3g/100g, 6g/100g) in EU Regulation 1924/2006.
     - Sodium: no standard per-100kcal claim threshold exists, so this
       one is derived rather than quoted: WHO's <2000mg sodium/day
       guideline, spread over a 2000kcal reference day, gives ~100mg
       sodium/100kcal as the "average" line; low/high bands are set at
       half/1.5x that reference.

2. Macro-gap weighting — an item dense in whichever macro the user is
   currently furthest *under* their target on gets nudged toward
   "consume more"; dense in whichever macro they're furthest *over* on
   gets nudged toward "consume less" (Epic 6.1's own example: "if
   protein is under target, up-weight protein-dense items").

The two signals are summed into one score; ties resolve to "consume_more"
(there's no health reason to flag a neutral item for reduction) so the
decision is always deterministic. Items with missing/low-confidence
nutrition are excluded and flagged `insufficient_data` rather than
guessed at.

Reads each item's already-persisted matched nutrition (the flat
protein_g/fat_g/.../micros columns Epic 4.1 writes onto receipt_items at
confirm time) rather than re-running the resolver — see
basket_composition.py's docstring for why that distinction matters.
"""

from typing import List, Optional

from backend.app.services.nutrition_profile import grams_for

# WHO %-of-energy guideline: <10% "moderate" ceiling, <5% "low"/ideal band.
_SUGAR_LOW_PCT_ENERGY = 5.0
_SUGAR_HIGH_PCT_ENERGY = 10.0
_SATFAT_LOW_PCT_ENERGY = 5.0
_SATFAT_HIGH_PCT_ENERGY = 10.0

# EU claim thresholds, per-100kcal alternate form.
_FIBER_HIGH_PER_100KCAL = 3.0
_FIBER_LOW_PER_100KCAL = 1.5

# Derived from WHO's 2000mg/day over a 2000kcal reference day (see module
# docstring) — not an official per-kcal claim threshold.
_SODIUM_LOW_MG_PER_100KCAL = 50.0
_SODIUM_HIGH_MG_PER_100KCAL = 150.0

# A macro is only considered "under" or "over" target once the gap clears
# this many percentage points — avoids nudging items around for noise-level
# deltas.
_MACRO_GAP_THRESHOLD_PCT = 3.0

_MACRO_KCAL_PER_G = {"protein": 4.0, "fat": 9.0, "carb": 4.0}


def _quality_signals(item: dict) -> Optional[dict]:
    cal = item.get("calories_kcal")
    if not cal or cal <= 0:
        return None

    sodium_mg = (item.get("micros") or {}).get("sodium_mg")

    signals = {}
    sugar_g = item.get("sugar_g")
    if sugar_g is not None:
        pct = sugar_g * 4.0 / cal * 100
        signals["sugar"] = "low" if pct <= _SUGAR_LOW_PCT_ENERGY else ("high" if pct >= _SUGAR_HIGH_PCT_ENERGY else "medium")
    satfat_g = item.get("saturated_fat_g")
    if satfat_g is not None:
        pct = satfat_g * 9.0 / cal * 100
        signals["saturated_fat"] = "low" if pct <= _SATFAT_LOW_PCT_ENERGY else ("high" if pct >= _SATFAT_HIGH_PCT_ENERGY else "medium")
    fiber_g = item.get("fiber_g")
    if fiber_g is not None:
        per_100kcal = fiber_g / cal * 100
        signals["fiber"] = "high" if per_100kcal >= _FIBER_HIGH_PER_100KCAL else ("low" if per_100kcal < _FIBER_LOW_PER_100KCAL else "medium")
    if sodium_mg is not None:
        per_100kcal = sodium_mg / cal * 100
        signals["sodium"] = "low" if per_100kcal <= _SODIUM_LOW_MG_PER_100KCAL else ("high" if per_100kcal >= _SODIUM_HIGH_MG_PER_100KCAL else "medium")

    if not signals:
        return None
    return signals


_GOOD_BAND = {"sugar": "low", "saturated_fat": "low", "fiber": "high", "sodium": "low"}
_BAD_BAND = {"sugar": "high", "saturated_fat": "high", "fiber": "low", "sodium": "high"}
_LABEL = {
    "sugar": "sugar", "saturated_fat": "saturated fat", "fiber": "fiber", "sodium": "sodium",
}


def _quality_score_and_reasons(signals: dict) -> tuple:
    score = 0
    good, bad = [], []
    for nutrient, band in signals.items():
        if band == _GOOD_BAND[nutrient]:
            score += 1
            good.append(f"{'high' if nutrient == 'fiber' else 'low'} {_LABEL[nutrient]}")
        elif band == _BAD_BAND[nutrient]:
            score -= 1
            bad.append(f"{'low' if nutrient == 'fiber' else 'high'} {_LABEL[nutrient]}")
    return score, good, bad


def _macro_gaps(actual_pct: dict, target_pct: dict) -> dict:
    """{macro: target - actual}; positive = under target, negative = over."""

    gaps = {}
    for macro in ("protein", "fat", "carb"):
        a, t = actual_pct.get(f"{macro}_pct"), target_pct.get(f"{macro}_pct")
        gaps[macro] = (t - a) if (a is not None and t is not None) else None
    return gaps


def _item_macro_density_kcal(item: dict, grams: float) -> dict:
    factor = grams / 100.0
    return {
        "protein": (item.get("protein_g") or 0.0) * _MACRO_KCAL_PER_G["protein"] * factor,
        "fat": (item.get("fat_g") or 0.0) * _MACRO_KCAL_PER_G["fat"] * factor,
        "carb": (item.get("carbs_g") or 0.0) * _MACRO_KCAL_PER_G["carb"] * factor,
    }


def compute_buckets(receipt_items: List[dict], actual_pct: dict, target_pct: dict) -> List[dict]:
    """One bucket decision per item: `consume_more` | `consume_less` |
    `insufficient_data`, each with a short plain-language rationale."""

    gaps = _macro_gaps(actual_pct, target_pct)
    # Whichever macro is most under target gets a "consume more" boost for
    # items dense in it; whichever is most over target gets a "consume
    # less" boost — only if the gap clears the noise threshold.
    under_macro = max(gaps, key=lambda m: (gaps[m] if gaps[m] is not None else -999))
    over_macro = min(gaps, key=lambda m: (gaps[m] if gaps[m] is not None else 999))
    if gaps.get(under_macro) is None or gaps[under_macro] < _MACRO_GAP_THRESHOLD_PCT:
        under_macro = None
    if gaps.get(over_macro) is None or gaps[over_macro] > -_MACRO_GAP_THRESHOLD_PCT:
        over_macro = None

    results = []
    for item in receipt_items:
        signals = _quality_signals(item)
        if signals is None:
            results.append({
                "name": item.get("name"), "bucket": "insufficient_data",
                "reason": "Not enough nutrition data to score this item.",
            })
            continue

        score, good_reasons, bad_reasons = _quality_score_and_reasons(signals)

        grams = grams_for(item.get("quantity"), item.get("unit"), item.get("category"), item.get("name"))
        density = _item_macro_density_kcal(item, grams)
        total_kcal = sum(density.values()) or 1.0
        macro_boost = 0
        more_reason = less_reason = None
        if under_macro and density.get(under_macro, 0) / total_kcal >= 0.4:
            macro_boost += 1
            more_reason = f"good source of {under_macro}, which you're under target on"
        if over_macro and density.get(over_macro, 0) / total_kcal >= 0.4:
            macro_boost -= 1
            less_reason = f"dense in {over_macro}, which you're over target on"

        final_score = score + macro_boost
        bucket = "consume_more" if final_score >= 0 else "consume_less"
        # Reasons are picked to match the direction of the final bucket —
        # a consume_more item is explained by what's good about it (plus
        # any macro-gap boost), a consume_less item by what's bad.
        if bucket == "consume_more":
            reasons = good_reasons + ([more_reason] if more_reason else [])
        else:
            reasons = bad_reasons + ([less_reason] if less_reason else [])

        results.append({
            "name": item.get("name"),
            "matched_name": item.get("matched_name"),
            "bucket": bucket,
            "reason": (", ".join(reasons[:2]) or "no strong signal either way").capitalize() + ".",
        })

    return results
