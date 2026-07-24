"""Estimated shelf life and urgency for the basket (Bestandsliste).

Items carry a real purchase date and a coarse food group, but NO expiry
date. Urgency is therefore ESTIMATED: purchased_at + shelf_life_days(group).
That estimate is deliberately kept inside the backend -- callers only ever
receive a fuzzy `urgency` bucket, never the derived date or a day count,
because it is a guess and must not read as a fact (architecture decision:
sort-value and display-value are strictly separated).

The estimate is config, not a per-item field: DEFAULT_SHELF_LIFE below is
the conservative starting point, and pantry_shelf_life (migration 0010) lets
each profile override a group's days. FOOD_GROUP_FOR maps the 87-leaf
canonical taxonomy (services/fallback_categories.py) onto the 13 coarse
groups the user reasons about -- the same grouping the frontend's
categoryEmoji already shows, so the buckets line up end to end.
"""

from datetime import date, timedelta
from typing import Optional

# ── The coarse food groups (stable keys used in the config table + API) ──
# Fruits and Vegetables are separate leaves/emoji in the app but share one
# starting shelf life; both default to 7. "other" is the catch-all and has
# NO estimate (None) -> it sorts to the end and never colours the light.
FOOD_GROUP_LABELS: dict[str, str] = {
    "fruits": "Fruits",
    "vegetables": "Vegetables",
    "dairy_eggs": "Dairy Products & Eggs",
    "meat": "Meat & Sausages",
    "fish_seafood": "Fish & Seafood",
    "bread_bakery": "Bread & Bakery",
    "grains_starches": "Grains & Pasta",
    "legumes_pantry": "Canned Goods & Pantry Staples",
    "oils_condiments": "Oils & Fats; Herbs, Spices & Sauces",
    "sweets_snacks": "Sweets & Snacks",
    "beverages": "Beverages",
    "nuts_seeds": "Nuts & Seeds",
    "frozen": "Frozen Foods",
    "other": "Other / Miscellaneous",
}

# Conservative days-from-purchase per group. None = no estimate (Other):
# such lots sort to the very end and get the neutral 'unknown' bucket.
# nuts_seeds (180) and frozen (90) are sensible defaults for groups the
# task did not pin; every value here is overridable per profile.
DEFAULT_SHELF_LIFE: dict[str, Optional[int]] = {
    "fish_seafood": 3,
    "meat": 5,
    "bread_bakery": 5,
    "dairy_eggs": 10,
    "fruits": 7,
    "vegetables": 7,
    "nuts_seeds": 180,
    "sweets_snacks": 120,
    "frozen": 90,
    "beverages": 180,
    "grains_starches": 365,
    "legumes_pantry": 365,
    "oils_condiments": 365,
    "other": None,
}

# Canonical leaf category -> coarse food group. Mirrors the grouping in the
# frontend's categoryEmoji.ts (single source of the leaf->group boundaries),
# so the emoji a row shows and the shelf life it uses always agree.
_LEAF_TO_GROUP: dict[str, str] = {
    # Vegetables
    **{leaf: "vegetables" for leaf in (
        "leafy_greens", "cruciferous_vegetables", "fruiting_vegetables",
        "root_vegetables_nonstarchy", "starchy_vegetables", "mushrooms",
        "alliums", "fresh_legumes",
    )},
    # Fruits
    **{leaf: "fruits" for leaf in (
        "berries", "citrus_fruits", "pome_fruits", "stone_fruits",
        "tropical_fruits", "high_fat_fruits",
    )},
    # Dairy, Eggs & plant-based dairy alternatives
    **{leaf: "dairy_eggs" for leaf in (
        "skim_dairy", "low_fat_dairy", "full_fat_dairy", "soft_cheese",
        "hard_and_semi_hard_cheese", "cream_based_dairy",
        "butter_and_milk_fat", "eggs", "unsweetened_plant_milk",
        "sweetened_plant_milk", "plant_yogurt", "vegan_cheese",
    )},
    # Meat & plant-based protein
    **{leaf: "meat" for leaf in (
        "lean_poultry", "medium_fat_poultry", "lean_red_meat",
        "medium_fat_red_meat", "fatty_red_meat", "processed_meat",
        "tofu", "tempeh", "seitan", "plant_based_meat_alternatives",
    )},
    # Fish & seafood
    **{leaf: "fish_seafood" for leaf in ("white_fish", "fatty_fish", "shellfish")},
    # Bread & bakery
    **{leaf: "bread_bakery" for leaf in (
        "white_bread", "whole_grain_bread", "crispbread_and_crackers",
        "sweet_baked_goods",
    )},
    # Pasta, rice, grains & starches
    **{leaf: "grains_starches" for leaf in (
        "dry_pasta", "white_rice", "brown_rice", "couscous_and_bulgur",
        "cooked_starches", "whole_grains", "refined_grains",
        "unsweetened_breakfast_cereals", "sweetened_breakfast_cereals",
    )},
    # Dried legumes (grouped with canned & pantry goods)
    **{leaf: "legumes_pantry" for leaf in ("beans", "lentils", "chickpeas", "soybeans")},
    # Oils & fats + herbs/spices + condiments & sauces
    **{leaf: "oils_condiments" for leaf in (
        "vegetable_oils", "animal_fats", "margarine", "fresh_herbs",
        "dried_herbs", "spices", "tomato_based_sauces", "mustard", "ketchup",
        "mayonnaise", "cream_sauces", "soy_sauce_and_vinegar",
    )},
    # Sweets, desserts & snacks
    **{leaf: "sweets_snacks" for leaf in (
        "chocolate", "sugar_candy", "cookies_and_biscuits", "ice_cream",
        "potato_chips", "corn_snacks", "pretzels", "popcorn", "rice_cakes",
    )},
    # Beverages
    **{leaf: "beverages" for leaf in (
        "water", "coffee_and_tea", "zero_calorie_beverages", "fruit_juice",
        "energy_drinks", "sports_drinks", "alcoholic_beverages",
    )},
    # Nuts & seeds
    **{leaf: "nuts_seeds" for leaf in ("tree_nuts", "peanuts", "seeds")},
    # (frozen has no leaf in the current taxonomy -- kept as a config group
    #  for when one is added.)
}


def food_group_for(leaf_category: Optional[str]) -> str:
    """Coarse food group for a canonical leaf category. Anything unknown,
    the explicit "other" leaf, or None collapses to "other" -> sorted last,
    neutral urgency."""
    if not leaf_category:
        return "other"
    return _LEAF_TO_GROUP.get(leaf_category, "other")


def effective_shelf_life(overrides: dict[str, Optional[int]]) -> dict[str, Optional[int]]:
    """Defaults merged with a profile's overrides. An override may set a
    group to None (opt it out of urgency). Unknown override keys are ignored
    so a stale row can't inject a phantom group."""
    merged = dict(DEFAULT_SHELF_LIFE)
    for group, days in overrides.items():
        if group in merged:
            merged[group] = days
    return merged


# Bucket boundaries (days from today, inclusive upper). Kept here so the API
# and any test read the same thresholds. "soon" (<=3) exists so the UI's
# "only next 3 days" filter needs no day count crossing the wire.
SOON_DAYS = 3
WEEK_DAYS = 7


def urgency_for(
    purchased_at: Optional[str],
    shelf_life_days: Optional[int],
    today: date,
) -> str:
    """Fuzzy urgency bucket for a lot -- the ONLY urgency signal that leaves
    the backend. Never returns a date or a day count.

      expired  -> estimated use-by is today or already past   (light: red)
      soon     -> within the next 3 days                      (light: red)
      week     -> 4..7 days out                               (light: yellow)
      long     -> more than a week out                        (light: green)
      unknown  -> no estimate (Other, or unparseable date)    (light: grey)

    'expired' and 'soon' together are exactly the "next 3 days" filter set.
    """
    if shelf_life_days is None or not purchased_at:
        return "unknown"
    try:
        bought = date.fromisoformat(purchased_at[:10])
    except ValueError:
        return "unknown"
    days_left = (bought + timedelta(days=shelf_life_days) - today).days
    if days_left <= 0:
        return "expired"
    if days_left <= SOON_DAYS:
        return "soon"
    if days_left <= WEEK_DAYS:
        return "week"
    return "long"


# Ascending sort rank for view A (most urgent first). Lots with no estimate
# (unknown) always sort last regardless of purchase date, so they never
# distort the urgency ordering.
def sort_key(purchased_at: Optional[str], shelf_life_days: Optional[int]) -> tuple:
    """(has_estimate, estimated_expiry_iso) -- ascending. The estimated date
    is used ONLY here as an opaque ordering key; it is never returned to the
    caller. 'unknown' lots get (1, '') so they trail all estimated lots."""
    if shelf_life_days is None or not purchased_at:
        return (1, "")
    try:
        bought = date.fromisoformat(purchased_at[:10])
    except ValueError:
        return (1, "")
    return (0, (bought + timedelta(days=shelf_life_days)).isoformat())
