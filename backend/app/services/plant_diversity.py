"""
Plant diversity read-out — a "30 plants" style count of how many distinct
fruits, vegetables, whole grains, legumes, nuts/seeds, and herbs/spices were
purchased in a rolling 28-day window (Konsum.md's Stufe 1 window, reused
here rather than a lifetime sum -- diversity is about *current* habits).

Distinct-plant identity follows the same convention as diversity.py's
per-macro source count (`matched_name` if we have one, else the raw parsed
`name`) -- normalized to casing/whitespace so the same product parsed
slightly differently across receipts still collapses to one entry, since
under- or over-counting here is exactly the number a user will scrutinize.

Which of the 87 leaf categories (fallback_categories.py) count as one of
the six plant groups is a judgment call the source data doesn't make for
us -- documented at each group below. Left out entirely:
  - "Plant-Based Protein Products" (tofu/tempeh/seitan/meat alternatives)
    and "Plant-Based Dairy Alternatives" (oat/soy milk, etc.) -- processed
    foods derived from a plant this count already credits elsewhere
    (soy -> soybeans, wheat -> grains), so counting them too would inflate
    the score without representing genuinely new plant diversity.
  - "Oils & Fats" (incl. vegetable_oils) -- not one of the six groups asked
    for.
  - Ambiguous mixed-refinement leaf categories under grains (dry_pasta,
    white_rice, refined_grains, both breakfast-cereal categories, both
    bread categories besides whole_grain_bread, couscous_and_bulgur -- a
    single leaf spanning couscous (refined) and bulgur (whole grain)) --
    left out of "whole grains" rather than over-crediting a refined product.
"""

from datetime import date
from typing import List

from backend.app.services.basket_composition import _item_purchase_date

PLANT_DIVERSITY_TARGET = 30
PLANT_DIVERSITY_WINDOW_DAYS = 28

_FRUIT_CATEGORIES = {
    "berries", "citrus_fruits", "pome_fruits", "stone_fruits",
    "tropical_fruits", "high_fat_fruits",
}
# Includes "mushrooms" (fungi, not botanically a plant) and "fresh_legumes"
# (fresh peas/edamame) -- both already grouped under fallback_categories.py's
# own "Vegetables" section header, so treated the same way here.
_VEGETABLE_CATEGORIES = {
    "leafy_greens", "cruciferous_vegetables", "fruiting_vegetables",
    "root_vegetables_nonstarchy", "starchy_vegetables", "mushrooms",
    "alliums", "fresh_legumes",
}
# Genuinely whole-grain leaves only -- see the module docstring for why
# dry_pasta/white_rice/refined_grains/both cereal categories/couscous_and_
# bulgur/white_bread/crispbread_and_crackers/sweet_baked_goods are excluded.
_WHOLE_GRAIN_CATEGORIES = {"whole_grains", "whole_grain_bread", "brown_rice"}
_LEGUME_CATEGORIES = {"beans", "lentils", "chickpeas", "soybeans"}
_NUT_AND_SEED_CATEGORIES = {"tree_nuts", "peanuts", "seeds"}
_HERB_AND_SPICE_CATEGORIES = {"fresh_herbs", "dried_herbs", "spices"}

PLANT_DIVERSITY_CATEGORIES = (
    _FRUIT_CATEGORIES
    | _VEGETABLE_CATEGORIES
    | _WHOLE_GRAIN_CATEGORIES
    | _LEGUME_CATEGORIES
    | _NUT_AND_SEED_CATEGORIES
    | _HERB_AND_SPICE_CATEGORIES
)

# Display label per group, and the fixed order the "what counted" dropdown
# lists them in -- same grouping used for PLANT_DIVERSITY_CATEGORIES above,
# just inverted (category -> label) for the response the frontend renders.
_GROUP_ORDER = ("Fruits", "Vegetables", "Whole grains", "Legumes", "Nuts & seeds", "Herbs & spices")
_GROUP_BY_CATEGORY = {
    **{c: "Fruits" for c in _FRUIT_CATEGORIES},
    **{c: "Vegetables" for c in _VEGETABLE_CATEGORIES},
    **{c: "Whole grains" for c in _WHOLE_GRAIN_CATEGORIES},
    **{c: "Legumes" for c in _LEGUME_CATEGORIES},
    **{c: "Nuts & seeds" for c in _NUT_AND_SEED_CATEGORIES},
    **{c: "Herbs & spices" for c in _HERB_AND_SPICE_CATEGORIES},
}


def _identity_key(item: dict) -> str:
    return _display_name(item).lower()


def _display_name(item: dict) -> str:
    return (item.get("matched_name") or item.get("name") or "unknown item").strip()


def compute_plant_diversity(
    receipt_items: List[dict],
    reference_date: date,
    window_days: int = PLANT_DIVERSITY_WINDOW_DAYS,
) -> dict:
    """Count of distinct fruits/vegetables/whole grains/legumes/nuts&seeds/
    herbs&spices purchased within `window_days` of `reference_date`, plus the
    grouped item list behind that count (the Results page's "what counted"
    dropdown) -- same identity/window rules as the count, so the list always
    matches it exactly.

    An item with no resolvable purchase date is excluded -- unlike
    basket_composition's window_days (which only filters items it CAN date,
    leaving undated ones in), this count exists specifically to answer "how
    many different plants in the last 28 days", so an item we can't place
    in that window can't be credited toward it either."""

    distinct: dict = {}  # identity key -> {"name": display name, "group": label}
    for item in receipt_items:
        category = (item.get("category") or "").strip().lower()
        group = _GROUP_BY_CATEGORY.get(category)
        if group is None:
            continue

        item_date = _item_purchase_date(item)
        if item_date is None or (reference_date - item_date).days > window_days:
            continue
        if (reference_date - item_date).days < 0:
            continue  # a future-dated item (bad data) isn't "in the last N days"

        key = _identity_key(item)
        if key not in distinct:
            distinct[key] = {"name": _display_name(item), "group": group}

    items = sorted(
        distinct.values(),
        key=lambda entry: (_GROUP_ORDER.index(entry["group"]), entry["name"].lower()),
    )

    return {
        "count": len(distinct),
        "target": PLANT_DIVERSITY_TARGET,
        "window_days": window_days,
        "items": items,
    }
