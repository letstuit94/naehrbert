"""
Dietary-restriction prompt lines, shared by every LLM prompt that has to
respect the profile's diet style/allergies/dislikes -- recipe generation
(services/recipe_engine.py) and the Insights page's gap-closing
recommendations (services/recommendation_engine.py) both need the exact
same hard constraints stated the exact same way.
"""

from typing import List

from backend.app.models.profile import DietaryStyle, Profile

DIET_INSTRUCTIONS = {
    DietaryStyle.OMNIVORE: "No dietary restriction beyond the allergies/dislikes below.",
    DietaryStyle.PESCATARIAN: "Pescatarian: no meat or poultry. Fish and seafood are fine, as are dairy/eggs.",
    DietaryStyle.VEGETARIAN: "Vegetarian: no meat, poultry, fish, or seafood. Dairy and eggs are fine.",
    DietaryStyle.VEGAN: "Vegan: no meat, poultry, fish, seafood, dairy, eggs, or any other animal-derived ingredient.",
}


def restriction_lines(profile: Profile) -> List[str]:
    """Diet style + allergies + dislikes, as prompt lines. Always starts
    with the diet-style line (falls back to omnivore, i.e. no restriction,
    when unset)."""

    diet_style = profile.dietary_style or DietaryStyle.OMNIVORE
    lines = [DIET_INSTRUCTIONS[diet_style]]

    if profile.allergies:
        lines.append(
            "Allergies/intolerances -- NEVER include any of these ingredients or anything "
            f"derived from them, under any circumstances: {', '.join(profile.allergies)}."
        )
    if profile.dislikes:
        lines.append(f"Disliked foods -- avoid these too: {', '.join(profile.dislikes)}.")

    return lines
