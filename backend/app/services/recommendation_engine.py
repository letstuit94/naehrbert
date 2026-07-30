"""
Gap-closing recommendation orchestration (Insights page).

Builds the prompt from the user's dietary profile and current macro gap
(backend/app/api/analysis.py's get_target_comparison) + micronutrient gap
(get_micronutrients), calls services/groq_client.py, and applies a
lightweight allergy safety-net before returning.

Deliberately lighter-weight than recipe_engine.py's compliance checking:
a recommendation is advisory text the user reads, not a set of
ingredients that get bought and cooked exactly as specified, so this only
retries once on an allergy-term hit and then proceeds regardless (never
raises) -- a safety net, not a hard gate. Dislikes aren't checked at all
here (preference, not safety) beyond the prompt instruction itself.
"""

from typing import Dict, Optional

from backend.app.models.profile import Profile
from backend.app.models.recommendation import GapRecommendations
from backend.app.services.dietary_constraints import restriction_lines
from backend.app.services.gap_lines import macro_gap_lines, micronutrient_gap_lines
from backend.app.services.groq_client import generate_gap_recommendations

# A synthesis/advice task, not a creative-writing one -- low but not 0,
# same rationale as recipe_engine.py's _TEMPERATURE.
_TEMPERATURE = 0.4


def build_prompt(
    profile: Profile,
    macro_gap: dict,
    micro_totals: Dict[str, float],
    micro_targets: Optional[Dict[str, float]],
    days_of_data: int,
) -> str:
    macro_lines = macro_gap_lines(macro_gap)
    micro_lines = micronutrient_gap_lines(micro_totals, micro_targets, days_of_data)

    if not macro_lines and not micro_lines:
        gap_block = "No gap data available yet -- give general, balanced dietary guidance instead."
    else:
        gap_block = "\n".join(macro_lines + micro_lines) or "Everything is close to target -- nothing urgent to flag."

    return f"""You are Nährbert, a nutrition assistant. The user wants to know how to
close the gaps below through ordinary food choices -- not medical advice,
not supplements, just concrete, everyday foods and swaps a home cook could
actually act on.

Dietary constraints (must all be respected):
{chr(10).join(restriction_lines(profile))}

The user's current macro and micronutrient gaps, from their actual grocery
purchases over the last {days_of_data} day(s):
{gap_block}

Write a short one-sentence summary of the overall picture, then 3 to 6
"Quick Wins" -- one per gap that actually matters (skip anything already
close to target). Each Quick Win is a single, concrete action, using
specific, ordinary foods (not brand names), phrased as ONE of these two
templates depending on whether the gap is a shortfall or an excess:
- To close a shortfall: "Add <food(s)> to your diet to achieve <what it
  fixes>." (e.g. "Add lentils and Greek yogurt to your diet to achieve a
  higher protein intake.")
- To cut back on something over target: "Consider dropping <food/
  ingredient> from your diet as it is responsible for <the excess>." (e.g.
  "Consider dropping processed meats from your diet as they are
  responsible for your excess sodium intake.")
Keep each one to a single sentence in one of those two forms -- these are
quick, scannable wins, not paragraphs. Do not suggest supplements or
fortified products as the primary fix -- food first. For each
recommendation, set `focus` to a short label naming which gap it
addresses (e.g. "protein", "iron", "sodium")."""


def generate_recommendations(
    profile: Profile,
    macro_gap: dict,
    micro_totals: Dict[str, float],
    micro_targets: Optional[Dict[str, float]],
    days_of_data: int,
) -> GapRecommendations:
    prompt = build_prompt(profile, macro_gap, micro_totals, micro_targets, days_of_data)
    result = generate_gap_recommendations(prompt, temperature=_TEMPERATURE)

    if profile.allergies:
        allergy_terms = [a.strip().lower() for a in profile.allergies if a.strip()]
        hit = next(
            (
                term
                for item in result.items
                for term in allergy_terms
                if term in item.suggestion.lower()
            ),
            None,
        )
        if hit is not None:
            # One reinforced retry -- then proceed with whatever comes
            # back either way. Unlike recipe_engine.py, this never raises:
            # the worst case is a slightly-off suggestion the user reads
            # and can just ignore, not something eaten unquestioningly.
            reinforced_prompt = (
                f"{prompt}\n\nIMPORTANT: your previous suggestions mentioned \"{hit}\", "
                "which the user is allergic to. Do not mention it, even as something to avoid."
            )
            result = generate_gap_recommendations(reinforced_prompt, temperature=_TEMPERATURE)

    return result
