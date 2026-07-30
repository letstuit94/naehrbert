"""
Recipe generation orchestration (recipe-recommendations feature).

Builds the prompt from the user's dietary profile and current macro gap
(the same actual/target/delta shape backend/app/api/analysis.py's
get_target_comparison already computes), calls services/groq_client.py,
and enforces the hard rules the model's own instructions can't be trusted
alone to honor: never suggest an ingredient the user is allergic to or
dislikes, and never return a recipe less restrictive than the requested
dietary style (checked via the model's own self-classified `dietary_label`
-- see _DIET_RANK below). Nutrition numbers are the model's own estimate,
not backend-recomputed -- see models/recipe.py's docstring for why.
"""

from typing import List, Optional

from backend.app.models.profile import DietaryStyle, Profile
from backend.app.models.recipe import RecipeSuggestion
from backend.app.services.dietary_constraints import restriction_lines as diet_restriction_lines
from backend.app.services.gap_lines import macro_gap_lines
from backend.app.services.groq_client import generate_recipe_suggestion

# Restrictiveness order (most animal products excluded -> least): a recipe
# is compatible with the requested diet_style iff its own self-classified
# rank is >= the requested one -- e.g. a vegetarian request accepts a
# vegan OR vegetarian result (both have no meat/fish), but not pescatarian
# (has fish) or omnivore (has meat). This is the one diet_style check that
# didn't exist before dietary_label: the allergy/dislike check below never
# covered the diet_style restriction itself, only the two things layered
# on top of it.
_DIET_RANK = {
    DietaryStyle.OMNIVORE: 0,
    DietaryStyle.PESCATARIAN: 1,
    DietaryStyle.VEGETARIAN: 2,
    DietaryStyle.VEGAN: 3,
}

# Deliberately low-ish: this is a factual/estimation task (a recipe that
# has to actually respect hard constraints), not a creative-writing one --
# still needs some variety across repeated calls, so not 0.
_TEMPERATURE = 0.6


def build_prompt(
    profile: Profile,
    gap: dict,
    cuisine: Optional[str] = None,
    max_time_minutes: Optional[int] = None,
    servings: Optional[int] = None,
) -> str:
    restriction_lines = diet_restriction_lines(profile)
    gap_lines = macro_gap_lines(gap) or ["No macro-gap data available yet -- suggest a balanced recipe."]

    request_lines = []
    if cuisine:
        request_lines.append(f"- Cuisine style: {cuisine}. The recipe should authentically fit this cuisine.")
    if max_time_minutes is not None:
        request_lines.append(
            f"- Time budget: prep time + cook time COMBINED must not exceed {max_time_minutes} minutes."
        )
    if servings is not None:
        request_lines.append(
            f"- Servings: scale ingredient quantities (and the total calorie/macro estimate) "
            f"for exactly {servings} servings/portions."
        )
    request_block = ("\n\nThe user also asked for this recipe specifically:\n" + "\n".join(request_lines)) if request_lines else ""

    return f"""You are Nährbert, a nutrition assistant. Suggest ONE realistic, cookable
recipe for a home cook, using ordinary, commonly available ingredients --
do not invent unusual ingredients or implausible nutrition figures.

Use metric measurements only (grams, kilograms, milliliters, liters, degrees
Celsius) -- never American/imperial units (cups, ounces, pounds, degrees
Fahrenheit).

Dietary constraints (must all be respected):
{chr(10).join(restriction_lines)}

The user's current macro balance, from their actual grocery purchases so far:
{chr(10).join(gap_lines)}

Important framing: this recipe is ONE meal, not the user's entire
remaining day of eating. It does not need to single-handedly close the
whole gap above -- just favor ingredients that move things in the right
direction (more of what's under target, less emphasis on what's over).
Do not sacrifice a realistic, tasty recipe just to hit an exact number.
{request_block}

Estimate calories and macros (protein/fat/carbs/fiber) for the WHOLE
recipe as prepared (not per serving), using standard nutrition knowledge
for the ingredients and quantities you choose -- be realistic, not
approximate to the point of being wrong.

Return the recipe title, the full ingredient list (each with a name and
a natural quantity like "200 g" or "1 tbsp" or "2 cloves"), numbered
preparation steps, prep time and cook time in minutes, how many servings/
portions it makes, and the total calorie/macro estimate.

Also classify dietary_label based on what the ingredient list you actually
chose contains -- NOT simply the dietary constraint above (a vegetarian
request can still yield a recipe that happens to be vegan if you didn't
use any dairy/eggs; always report the most specific/restrictive label
that's still true for these exact ingredients):
- "vegan": zero animal-derived ingredients (no meat, poultry, fish,
  seafood, dairy, eggs, or honey/gelatin/etc.).
- "vegetarian": no meat, poultry, fish, or seafood, but dairy and/or eggs
  are present.
- "pescatarian": contains fish or seafood, but no meat or poultry.
- "omnivore": contains meat or poultry.
"""


def _find_violation(
    suggestion: RecipeSuggestion,
    restricted_terms: List[str],
    max_time_minutes: Optional[int],
    diet_style: DietaryStyle,
) -> Optional[str]:
    """Case-insensitive substring check of every restricted term against
    every ingredient name, the requested time budget if one was given, and
    now that the model self-classifies dietary_label, whether that label is
    actually at least as restrictive as the diet_style that was requested.
    Returns a description of the first violation found, if any."""

    names = [ing.name.lower() for ing in suggestion.ingredients]
    for term in restricted_terms:
        term_lower = term.strip().lower()
        if not term_lower:
            continue
        if any(term_lower in name for name in names):
            return f'ingredient "{term}"'

    if max_time_minutes is not None:
        total = suggestion.prep_minutes + suggestion.cook_minutes
        if total > max_time_minutes:
            return f"total time {total} min exceeds the {max_time_minutes} min budget"

    if _DIET_RANK[suggestion.dietary_label] < _DIET_RANK[diet_style]:
        return (
            f"dietary_label '{suggestion.dietary_label.value}' is less restrictive than "
            f"the requested '{diet_style.value}' diet"
        )

    return None


def generate_and_assemble_recipe(
    profile: Profile,
    gap: dict,
    cuisine: Optional[str] = None,
    max_time_minutes: Optional[int] = None,
    servings: Optional[int] = None,
) -> RecipeSuggestion:
    restricted_terms = [*profile.allergies, *profile.dislikes]
    diet_style = profile.dietary_style or DietaryStyle.OMNIVORE
    prompt = build_prompt(profile, gap, cuisine, max_time_minutes, servings)

    suggestion = generate_recipe_suggestion(prompt, temperature=_TEMPERATURE)
    violation = _find_violation(suggestion, restricted_terms, max_time_minutes, diet_style)
    if violation is not None:
        # One retry with a sharper, violation-specific instruction before
        # giving up -- a single miss shouldn't silently persist an unsafe
        # or out-of-budget recipe, but it also shouldn't be a hard-fail on
        # the first try.
        reinforced_prompt = (
            f"{prompt}\n\nIMPORTANT: your previous suggestion violated a hard constraint "
            f"({violation}). Fix this in your next suggestion."
        )
        suggestion = generate_recipe_suggestion(reinforced_prompt, temperature=_TEMPERATURE)
        violation = _find_violation(suggestion, restricted_terms, max_time_minutes, diet_style)
        if violation is not None:
            raise ValueError(
                f"Groq kept violating a hard constraint ({violation}) despite explicit "
                "instructions -- refusing to save this recipe."
            )

    return suggestion
