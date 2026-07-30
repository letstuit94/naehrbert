"""
Plain-language gap descriptions, shared by every LLM prompt that needs to
tell the model "here's where the user's actual purchases differ from
their targets" -- recipe generation (services/recipe_engine.py) and the
Insights page's gap-closing recommendations (services/recommendation_engine.py)
both build a prompt around exactly this.
"""

from typing import Dict, List, Optional

from backend.app.services.micronutrient_info import _HEADING_TO_KEY

_MACRO_LABEL = {"protein": "protein", "fat": "fat", "carb": "carbs"}

# key -> the .md file's heading text (inverted from micronutrient_info.py's
# key -> heading, which the Insights page's educational content already
# keys on) -- reused here as a ready-made human-readable label rather than
# maintaining a second name table.
_MICRO_LABEL = {key: heading for heading, key in _HEADING_TO_KEY.items()}

# A micronutrient below this share of its daily target is a real,
# actionable shortfall worth a prompt line. Deliberately one-sided by
# default (only flags UNDER target, never over): an over-target
# micronutrient reads as medical caution this app isn't positioned to
# give, unlike macros where "don't lean further into X" is a harmless,
# purely dietary framing -- _ONLY_FLAG_WHEN_HIGH below is the one
# deliberate exception to that.
_MICRO_COVERAGE_FLOOR_PCT = 70.0

# Never surfaced as a recommendation, regardless of how low the gap is --
# product decision: vitamin D and iodine are routinely below the DGE
# target from diet alone even for people eating well (sun exposure/iodized
# salt do most of the work, not groceries), and fluoride is a dental-care
# nutrient this app has no business giving food advice about. Flagging
# any of the three would just be noise, not an actionable "quick win".
_NEVER_FLAG = {"vitamin_d_ug", "iodine_ug", "fluoride_mg"}

# The inverse of the usual rule: sodium is the one nutrient people are
# far more likely to be OVER target on than under, and "eat more salt"
# isn't useful advice -- so it's only ever flagged when in excess, never
# when low.
_ONLY_FLAG_WHEN_HIGH = {"sodium_mg"}
_HIGH_COVERAGE_CEILING_PCT = 150.0


def macro_gap_lines(gap: dict) -> List[str]:
    """Plain-language macro-gap lines from get_target_comparison's shape
    ({actual_pct, target_pct, delta_pct}). delta = actual - target, so a
    negative delta means the macro is currently UNDER target."""

    lines = []
    actual_pct = gap.get("actual_pct") or {}
    target_pct = gap.get("target_pct") or {}
    delta_pct = gap.get("delta_pct") or {}
    for macro, label in _MACRO_LABEL.items():
        delta = delta_pct.get(macro)
        actual = actual_pct.get(macro)
        target = target_pct.get(f"{macro}_pct")
        if delta is None or actual is None or target is None:
            continue
        if delta < -2:
            lines.append(
                f"- {label}: {actual}% of calories vs a {target}% target -- UNDER target, "
                f"so favor ingredients that raise {label}."
            )
        elif delta > 2:
            lines.append(
                f"- {label}: {actual}% of calories vs a {target}% target -- OVER target, "
                f"so don't lean further into {label}-heavy ingredients."
            )
        else:
            lines.append(f"- {label}: {actual}% of calories vs a {target}% target -- already close.")
    return lines


def micronutrient_gap_lines(
    totals: Dict[str, float], targets: Optional[Dict[str, float]], days_of_data: int
) -> List[str]:
    """Plain-language lines for micronutrients purchased at under
    _MICRO_COVERAGE_FLOOR_PCT of their daily DGE target -- get_micronutrients'
    `totals`/`targets` shape (backend/app/api/analysis.py), same
    purchased-per-day computation the Insights page's own micronutrient
    table already does client-side (ResultsPage.tsx's MicronutrientsSection).

    _NEVER_FLAG nutrients are skipped entirely; _ONLY_FLAG_WHEN_HIGH
    nutrients (currently just sodium) flip the usual rule -- checked
    against _HIGH_COVERAGE_CEILING_PCT instead of the floor, and never
    flagged for being low."""

    if not targets or not days_of_data:
        return []

    lines = []
    for key, target in targets.items():
        if key in _NEVER_FLAG:
            continue
        total = totals.get(key)
        if total is None or not target:
            continue
        purchased_per_day = total / days_of_data
        coverage_pct = purchased_per_day / target * 100
        label = _MICRO_LABEL.get(key, key)

        if key in _ONLY_FLAG_WHEN_HIGH:
            if coverage_pct > _HIGH_COVERAGE_CEILING_PCT:
                lines.append(
                    f"- {label}: purchased at {coverage_pct:.0f}% of the daily target "
                    f"({purchased_per_day:.2g} vs {target:.2g} per day) -- too high, "
                    f"suggest ways to cut back."
                )
            continue

        if coverage_pct < _MICRO_COVERAGE_FLOOR_PCT:
            lines.append(
                f"- {label}: purchased at {coverage_pct:.0f}% of the daily target "
                f"({purchased_per_day:.2g} vs {target:.2g} per day) -- a real shortfall, "
                f"suggest foods that would help close it."
            )
    return lines
