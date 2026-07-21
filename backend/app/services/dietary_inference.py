"""
Dietary-style inference (recipe-recommendations feature) — a first guess at
omnivore/pescatarian/vegetarian/vegan from what the user has actually
purchased, shown to them in the recipe-preferences chat for confirmation
or correction (never saved without that confirmation).

Reads each confirmed, food (non-non-food) receipt_item's `category` field
-- populated at PARSE time by receipt_text_parser.py calling
fallback_categories._canonical_category(None, name) unconditionally, so
it's present for every item regardless of match outcome, not just ones
that fell through to a category-level nutrition estimate (that's
`fallback_category`, a different field, only set on a match miss).

Category keys below are copied from fallback_categories.CATEGORY_NUTRITION's
leaf names (its "Meat" / "Fish & Seafood" / "Eggs" / "Dairy" sections) --
deliberately not imported, since importing the nutrition table just to read
its keys would be a strange coupling for a classification list that needs
to stay in sync by eye anyway (this reads like a taxonomy decision, not
shared logic).
"""

from typing import List

from backend.app.models.profile import DietaryStyle

MEAT_CATEGORIES = {
    "lean_poultry",
    "medium_fat_poultry",
    "lean_red_meat",
    "medium_fat_red_meat",
    "fatty_red_meat",
    "processed_meat",
}

FISH_CATEGORIES = {
    "white_fish",
    "fatty_fish",
    "shellfish",
}

DAIRY_EGG_CATEGORIES = {
    "eggs",
    "skim_dairy",
    "low_fat_dairy",
    "full_fat_dairy",
    "soft_cheese",
    "hard_and_semi_hard_cheese",
    "cream_based_dairy",
    "butter_and_milk_fat",
}


def infer_dietary_style(items: List[dict]) -> DietaryStyle:
    """meat present -> omnivore; else fish present -> pescatarian; else
    dairy/eggs present -> vegetarian; else (no animal products seen at
    all) -> vegan. Priority order matters: a basket with both meat and
    dairy is omnivore, not vegetarian."""

    categories = {item.get("category") for item in items if not item.get("is_non_food")}
    if categories & MEAT_CATEGORIES:
        return DietaryStyle.OMNIVORE
    if categories & FISH_CATEGORIES:
        return DietaryStyle.PESCATARIAN
    if categories & DAIRY_EGG_CATEGORIES:
        return DietaryStyle.VEGETARIAN
    return DietaryStyle.VEGAN
