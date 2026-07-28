"""
Fallback category mapper (Task 2.3 / Story 2.2).

When OpenFoodFacts has no confident match for an item, we still keep the
pipeline moving by approximating nutrition from a coarse food category.
These are deliberately rough per-100g estimates and are always tagged
with low confidence so downstream trust/confidence labels stay honest.
"""

import re
from typing import Optional

from backend.app.models.nutrition import MatchedProduct, MatchType, NutritionValues

# Confidence assigned to any category-based estimate.
FALLBACK_CONFIDENCE = 0.30

# Canonical categories -> per-100g calorie/macro profile, one entry per
# leaf category in ../../../food_categories.md (the authoritative taxonomy —
# 87 categories across 20 food groups, chosen so foods within one bucket
# actually share a macro profile: e.g. "lean poultry" and "fatty red meat"
# used to both be lumped into one "protein" bucket with one made-up
# average, hiding a >3x calorie difference).
#
# Every value below was checked against a real source rather than
# invented — each line's trailing comment says which. Sourcing method:
#   1. BLS 4.0 (services/bls_matcher.py, already loaded, no network) for
#      anything BLS covers as a generic/whole food — the large majority.
#      Looked up by direct substring filtering on BLS_RECORDS (NOT via
#      search_bls()/token_similarity — that scorer has a real bug where a
#      short common token like "roh" can force a false 1.0 similarity
#      score regardless of the rest of the name; direct filtering sidesteps
#      it entirely for this one-time lookup).
#   2. OpenFoodFacts (services/off_api.py) for modern packaged categories
#      BLS's dataset doesn't cover (tempeh, seitan, vegan cheese, energy/
#      sports drinks, corn snacks).
#   3. A handful have no clean BLS/OFF match for the plain/generic form
#      (only recipes/combinations turned up) — those say so explicitly and
#      use a standard, commonly-published figure for that food instead of
#      a fabricated blend.
# Every value is still a per-100g estimate for a whole category, not a
# substitute for a real product match — deliberately macro-only
# (calories_kcal/carbs_g/protein_g/fat_g/fiber_g); sugar_g/saturated_fat_g/
# processed_score/iron_mg/calcium_mg are left unset (None), matching the
# current calories-and-macros-first focus.
#
# `_canonical_category` / `_GERMAN_CATEGORY_MAP` / `_NAME_KEYWORDS` below
# resolve directly to these 87 leaf categories (see the tests in
# tests/test_fallback_categories.py, which assert e.g. Banane ->
# tropical_fruits, Gouda -> hard_and_semi_hard_cheese). "other" is only the
# genuine catch-all for items no keyword matches — not, as an earlier
# revision of this note warned, the place every lookup silently collapsed to.
CATEGORY_NUTRITION = {
    # ── Vegetables ────────────────────────────────────────────────────
    "leafy_greens": NutritionValues(calories_kcal=18, carbs_g=0.9, protein_g=2.1, fat_g=0.3, fiber_g=1.8),  # BLS: "Spinat roh"
    "cruciferous_vegetables": NutritionValues(calories_kcal=35, carbs_g=2.3, protein_g=3.6, fat_g=0.6, fiber_g=3.0),  # BLS: "Broccoli roh"
    "fruiting_vegetables": NutritionValues(calories_kcal=22, carbs_g=3.3, protein_g=1.0, fat_g=0.1, fiber_g=1.3),  # BLS: "Tomate roh"
    "root_vegetables_nonstarchy": NutritionValues(calories_kcal=40, carbs_g=6.5, protein_g=0.8, fat_g=0.4, fiber_g=2.9),  # BLS: "Karotte/Möhre, roh"
    "starchy_vegetables": NutritionValues(calories_kcal=83, carbs_g=17.9, protein_g=1.9, fat_g=0.1, fiber_g=1.4),  # BLS: "Kartoffel geschält, roh"
    "mushrooms": NutritionValues(calories_kcal=28, carbs_g=2.9, protein_g=3.7, fat_g=0.3, fiber_g=1.9),  # BLS: "Champignon roh"
    "alliums": NutritionValues(calories_kcal=34, carbs_g=6.0, protein_g=1.2, fat_g=0.2, fiber_g=1.4),  # BLS: "Speisezwiebel roh"
    "fresh_legumes": NutritionValues(calories_kcal=88, carbs_g=12.3, protein_g=5.9, fat_g=0.5, fiber_g=5.0),  # BLS: "Erbse grün, roh"

    # ── Fruits ────────────────────────────────────────────────────────
    "berries": NutritionValues(calories_kcal=38, carbs_g=5.9, protein_g=0.8, fat_g=0.4, fiber_g=2.0),  # BLS: "Erdbeere roh"
    "citrus_fruits": NutritionValues(calories_kcal=49, carbs_g=8.9, protein_g=1.0, fat_g=0.2, fiber_g=2.2),  # BLS: "Orange roh"
    "pome_fruits": NutritionValues(calories_kcal=58, carbs_g=11.7, protein_g=0.4, fat_g=0.5, fiber_g=2.3),  # BLS: "Apfel roh"
    "stone_fruits": NutritionValues(calories_kcal=39, carbs_g=8.0, protein_g=0.7, fat_g=0.1, fiber_g=1.7),  # BLS: "Pfirsich roh"
    "tropical_fruits": NutritionValues(calories_kcal=79, carbs_g=15.9, protein_g=1.3, fat_g=0.4, fiber_g=2.0),  # BLS: "Banane roh"
    "high_fat_fruits": NutritionValues(calories_kcal=132, carbs_g=1.4, protein_g=1.4, fat_g=12.5, fiber_g=4.1),  # BLS: "Avocado roh" (corrects the earlier version's overestimated carbs)

    # ── Meat ──────────────────────────────────────────────────────────
    "lean_poultry": NutritionValues(calories_kcal=105, carbs_g=0.0, protein_g=24.1, fat_g=1.0, fiber_g=0.0),  # BLS: "Pute Brust, ohne Haut, roh" (turkey breast, skinless)
    "medium_fat_poultry": NutritionValues(calories_kcal=257, carbs_g=0.0, protein_g=18.5, fat_g=20.3, fiber_g=0.0),  # BLS: "Suppenhuhn Schenkel, mit Haut, roh" (chicken thigh, skin-on)
    "lean_red_meat": NutritionValues(calories_kcal=121, carbs_g=0.0, protein_g=21.2, fat_g=4.0, fiber_g=0.0),  # BLS: "Rind Filetsteak roh" (beef filet)
    "medium_fat_red_meat": NutritionValues(calories_kcal=224, carbs_g=0.0, protein_g=19.1, fat_g=16.4, fiber_g=0.0),  # BLS: "Rind Hackfleisch, roh" (ground beef)
    "fatty_red_meat": NutritionValues(calories_kcal=324, carbs_g=0.0, protein_g=17.7, fat_g=28.1, fiber_g=0.0),  # BLS: "Schwein Ladenbauch, roh" (pork belly)
    "processed_meat": NutritionValues(calories_kcal=281, carbs_g=0.3, protein_g=12.3, fat_g=25.5, fiber_g=0.0),  # BLS: "Lyoner/Lyoner Wurst"

    # ── Fish & Seafood ────────────────────────────────────────────────
    "white_fish": NutritionValues(calories_kcal=79, carbs_g=0.0, protein_g=17.8, fat_g=0.8, fiber_g=0.0),  # BLS: "Dorsch/Kabeljau, roh"
    "fatty_fish": NutritionValues(calories_kcal=180, carbs_g=0.0, protein_g=19.9, fat_g=11.2, fiber_g=0.0),  # BLS: "Lachs roh" (corrects the earlier version's underestimated fat)
    "shellfish": NutritionValues(calories_kcal=87, carbs_g=0.0, protein_g=18.6, fat_g=1.4, fiber_g=0.0),  # BLS: "Garnele/Granat/Krabbe, roh"

    # ── Eggs ──────────────────────────────────────────────────────────
    "eggs": NutritionValues(calories_kcal=135, carbs_g=0.3, protein_g=13.2, fat_g=9.0, fiber_g=0.0),  # BLS: "Hühnerei roh"

    # ── Dairy ─────────────────────────────────────────────────────────
    "skim_dairy": NutritionValues(calories_kcal=35, carbs_g=5.0, protein_g=3.4, fat_g=0.1, fiber_g=0.0),  # no clean BLS/OFF plain-skim-milk entry found (only powdered/condensed); standard 0%-fat milk figure
    "low_fat_dairy": NutritionValues(calories_kcal=44, carbs_g=3.9, protein_g=3.5, fat_g=1.5, fiber_g=0.0),  # BLS: "Milch fettarm, frisch, 1,5 % Fett, pasteurisiert"
    "full_fat_dairy": NutritionValues(calories_kcal=62, carbs_g=4.0, protein_g=3.6, fat_g=3.5, fiber_g=0.0),  # BLS: "Vollmilch frisch, 3,5 % Fett, pasteurisiert"
    "soft_cheese": NutritionValues(calories_kcal=257, carbs_g=0.1, protein_g=19.6, fat_g=19.8, fiber_g=0.0),  # BLS: "Camembert mind. 45 % Fett i. Tr."
    "hard_and_semi_hard_cheese": NutritionValues(calories_kcal=379, carbs_g=0.0, protein_g=22.5, fat_g=31.6, fiber_g=0.0),  # BLS: "Gouda 48 % Fett i. Tr."
    "cream_based_dairy": NutritionValues(calories_kcal=308, carbs_g=3.3, protein_g=2.3, fat_g=31.7, fiber_g=0.0),  # BLS: "Schlagsahne mind. 30 % Fett"
    "butter_and_milk_fat": NutritionValues(calories_kcal=747, carbs_g=0.6, protein_g=0.6, fat_g=82.5, fiber_g=0.0),  # BLS: "Süßrahmbutter"

    # ── Grains & Cereals ──────────────────────────────────────────────
    "whole_grains": NutritionValues(calories_kcal=331, carbs_g=59.2, protein_g=12.8, fat_g=1.8, fiber_g=13.3),  # BLS: "Weizen ganzes Korn, roh"
    "refined_grains": NutritionValues(calories_kcal=348, carbs_g=71.8, protein_g=10.5, fat_g=0.9, fiber_g=5.3),  # BLS: "Weizen Mehl, Type 405"
    "unsweetened_breakfast_cereals": NutritionValues(calories_kcal=378, carbs_g=84.0, protein_g=7.0, fat_g=0.9, fiber_g=3.0),  # no clean BLS/OFF plain-dry-cereal entry found (only prepared combos); standard plain cornflakes figure
    "sweetened_breakfast_cereals": NutritionValues(calories_kcal=385, carbs_g=87.0, protein_g=6.0, fat_g=1.0, fiber_g=2.5),  # no clean BLS/OFF plain-dry-cereal entry found (only prepared combos); standard honey/sugar cornflakes figure

    # ── Bread & Bakery ────────────────────────────────────────────────
    "white_bread": NutritionValues(calories_kcal=272, carbs_g=50.5, protein_g=8.7, fat_g=3.0, fiber_g=4.0),  # BLS: "Weizenbrot/Weißbrot"
    "whole_grain_bread": NutritionValues(calories_kcal=210, carbs_g=38.0, protein_g=7.2, fat_g=1.0, fiber_g=10.0),  # BLS: "Vollkornbrot"
    "crispbread_and_crackers": NutritionValues(calories_kcal=334, carbs_g=62.0, protein_g=9.4, fat_g=1.3, fiber_g=18.2),  # BLS: "Roggenknäckebrot"
    "sweet_baked_goods": NutritionValues(calories_kcal=393, carbs_g=48.4, protein_g=7.4, fat_g=18.4, fiber_g=2.0),  # BLS: "Kuchen aus Rührmasse/Rührkuchen"

    # ── Pasta, Rice & Other Starches ──────────────────────────────────
    "dry_pasta": NutritionValues(calories_kcal=342, carbs_g=66.1, protein_g=13.2, fat_g=2.0, fiber_g=3.4),  # BLS: "Eierteigwaren roh" (egg pasta, dry)
    "white_rice": NutritionValues(calories_kcal=351, carbs_g=77.1, protein_g=7.9, fat_g=0.6, fiber_g=2.5),  # BLS: "Reis poliert, roh"
    "brown_rice": NutritionValues(calories_kcal=360, carbs_g=73.4, protein_g=8.4, fat_g=2.7, fiber_g=4.0),  # BLS: "Reis unpoliert, roh"
    "couscous_and_bulgur": NutritionValues(calories_kcal=350, carbs_g=68.9, protein_g=11.7, fat_g=1.7, fiber_g=6.2),  # BLS: "Couscous (Hartweizen) roh"
    "cooked_starches": NutritionValues(calories_kcal=75, carbs_g=16.1, protein_g=1.8, fat_g=0.1, fiber_g=1.3),  # BLS: "Salzkartoffeln (Kartoffeln mit Salz gekocht)"

    # ── Dried Legumes ─────────────────────────────────────────────────
    "beans": NutritionValues(calories_kcal=316, carbs_g=40.3, protein_g=22.8, fat_g=0.8, fiber_g=24.9),  # BLS: "Kidneybohne reif" (dried/mature)
    "lentils": NutritionValues(calories_kcal=353, carbs_g=60.1, protein_g=24.3, fat_g=1.1, fiber_g=10.7),  # no clean BLS dried-lentil entry found (only sprouts); standard dried lentil figure
    "chickpeas": NutritionValues(calories_kcal=317, carbs_g=39.6, protein_g=18.6, fat_g=5.9, fiber_g=15.5),  # BLS: "Kichererbse reif" (dried/mature)
    "soybeans": NutritionValues(calories_kcal=446, carbs_g=30.2, protein_g=36.5, fat_g=19.9, fiber_g=9.3),  # no clean BLS dried-mature-soybean entry found (only fresh edamame/sprouts); standard dried soybean figure

    # ── Nuts & Seeds ──────────────────────────────────────────────────
    "tree_nuts": NutritionValues(calories_kcal=721, carbs_g=3.0, protein_g=16.1, fat_g=70.6, fiber_g=4.6),  # BLS: "Walnuss"
    "peanuts": NutritionValues(calories_kcal=620, carbs_g=9.9, protein_g=29.0, fat_g=49.7, fiber_g=8.4),  # BLS: "Erdnuss geröstet"
    "seeds": NutritionValues(calories_kcal=564, carbs_g=4.8, protein_g=26.1, fat_g=47.6, fiber_g=5.8),  # BLS: "Sonnenblumenkern"

    # ── Oils & Fats ───────────────────────────────────────────────────
    "vegetable_oils": NutritionValues(calories_kcal=900, carbs_g=0.0, protein_g=0.0, fat_g=100.0, fiber_g=0.0),  # BLS: "Sonnenblumenöl"
    "animal_fats": NutritionValues(calories_kcal=900, carbs_g=0.0, protein_g=0.0, fat_g=100.0, fiber_g=0.0),  # BLS: "Schweinefett/Schweineschmalz"
    "margarine": NutritionValues(calories_kcal=718, carbs_g=0.0, protein_g=0.0, fat_g=79.8, fiber_g=0.0),  # BLS: "Ziehmargarine"

    # ── Plant-Based Protein Products ──────────────────────────────────
    "tofu": NutritionValues(calories_kcal=115, carbs_g=0.0, protein_g=15.5, fat_g=5.6, fiber_g=1.3),  # BLS: "Tofu"
    "tempeh": NutritionValues(calories_kcal=179, carbs_g=0.5, protein_g=19.0, fat_g=9.4, fiber_g=8.1),  # OFF: "Tempeh"
    "seitan": NutritionValues(calories_kcal=139, carbs_g=6.0, protein_g=26.6, fat_g=0.7, fiber_g=None),  # OFF: "Seitan Natur"
    "plant_based_meat_alternatives": NutritionValues(calories_kcal=170, carbs_g=6.4, protein_g=7.1, fat_g=12.0, fiber_g=4.0),  # OFF: "Vegane Mühlen Rostbratwürstchen"

    # ── Plant-Based Dairy Alternatives ────────────────────────────────
    "unsweetened_plant_milk": NutritionValues(calories_kcal=29, carbs_g=4.0, protein_g=0.7, fat_g=1.0, fiber_g=0.5),  # BLS: "Haferdrink ungesüßt"
    "sweetened_plant_milk": NutritionValues(calories_kcal=41, carbs_g=7.2, protein_g=0.7, fat_g=1.0, fiber_g=0.4),  # BLS: "Haferdrink gesüßt, aromatisiert"
    "plant_yogurt": NutritionValues(calories_kcal=44, carbs_g=0.3, protein_g=4.2, fat_g=2.7, fiber_g=0.0),  # BLS: "Soja-Joghurtalternative ungesüßt"
    "vegan_cheese": NutritionValues(calories_kcal=285, carbs_g=20.0, protein_g=0.0, fat_g=23.0, fiber_g=None),  # OFF: "Violife 100% vegan original flavour slices"

    # ── Snacks ────────────────────────────────────────────────────────
    "potato_chips": NutritionValues(calories_kcal=526, carbs_g=45.9, protein_g=5.5, fat_g=34.3, fiber_g=4.8),  # BLS: "Kartoffelchips/Stapelchips, diverse Sorten"
    "corn_snacks": NutritionValues(calories_kcal=383, carbs_g=85.0, protein_g=7.0, fat_g=1.3, fiber_g=None),  # OFF: "Maissnack Bio"
    "pretzels": NutritionValues(calories_kcal=389, carbs_g=73.7, protein_g=11.5, fat_g=4.3, fiber_g=4.2),  # BLS: "Salzbrezeln/Salzstangen (Laugendauergebäck)"
    "popcorn": NutritionValues(calories_kcal=395, carbs_g=54.7, protein_g=7.5, fat_g=14.7, fiber_g=6.7),  # BLS: "Popcorn gesalzen"
    "rice_cakes": NutritionValues(calories_kcal=372, carbs_g=76.5, protein_g=8.1, fat_g=2.9, fiber_g=3.7),  # BLS: "Reiswaffeln gesalzen"

    # ── Sweets & Desserts ─────────────────────────────────────────────
    "chocolate": NutritionValues(calories_kcal=555, carbs_g=52.0, protein_g=6.3, fat_g=35.1, fiber_g=2.5),  # BLS: "Vollmilchschokolade"
    "sugar_candy": NutritionValues(calories_kcal=312, carbs_g=70.7, protein_g=4.8, fat_g=0.3, fiber_g=1.0),  # BLS: "Fruchtgummi (Gummibonbon)"
    "cookies_and_biscuits": NutritionValues(calories_kcal=456, carbs_g=68.9, protein_g=7.5, fat_g=16.1, fiber_g=2.4),  # BLS: "Butterkekse/Butterplätzchen (Mürbeteig)"
    "ice_cream": NutritionValues(calories_kcal=194, carbs_g=22.6, protein_g=2.4, fat_g=10.2, fiber_g=0.3),  # BLS: "Vanilleeis"

    # ── Beverages ─────────────────────────────────────────────────────
    "water": NutritionValues(calories_kcal=0, carbs_g=0.0, protein_g=0.0, fat_g=0.0, fiber_g=0.0),  # BLS: "Trinkwasser"
    "coffee_and_tea": NutritionValues(calories_kcal=1, carbs_g=0.2, protein_g=0.1, fat_g=0.0, fiber_g=0.0),  # no BLS/OFF lookup needed — black coffee/tea calories are definitionally negligible
    "zero_calorie_beverages": NutritionValues(calories_kcal=0, carbs_g=0.0, protein_g=0.0, fat_g=0.0, fiber_g=0.0),  # OFF: "Cocacola zero sugar"
    "fruit_juice": NutritionValues(calories_kcal=41, carbs_g=8.5, protein_g=0.8, fat_g=None, fiber_g=0.3),  # BLS: "Orangensaft"
    "energy_drinks": NutritionValues(calories_kcal=46, carbs_g=11.0, protein_g=0.0, fat_g=0.0, fiber_g=0.0),  # OFF: "Red Bull"
    "sports_drinks": NutritionValues(calories_kcal=18, carbs_g=4.1, protein_g=0.0, fat_g=0.0, fiber_g=0.0),  # OFF: "Powerade Mountain Blast"
    "alcoholic_beverages": NutritionValues(calories_kcal=42, carbs_g=2.5, protein_g=0.6, fat_g=None, fiber_g=None),  # BLS: "Hefeweizen/Weizenbier, naturtrüb" (beer, as the most common grocery-receipt alcoholic drink)

    # ── Condiments & Sauces ───────────────────────────────────────────
    "tomato_based_sauces": NutritionValues(calories_kcal=107, carbs_g=2.3, protein_g=0.5, fat_g=10.4, fiber_g=0.8),  # BLS: "Tomatensauce aus Tomatenmark"
    "mustard": NutritionValues(calories_kcal=111, carbs_g=2.9, protein_g=5.5, fat_g=7.0, fiber_g=4.5),  # BLS: "Senf scharf"
    "ketchup": NutritionValues(calories_kcal=98, carbs_g=21.2, protein_g=1.4, fat_g=0.1, fiber_g=1.8),  # BLS: "Tomatenketchup"
    "mayonnaise": NutritionValues(calories_kcal=719, carbs_g=0.4, protein_g=2.0, fat_g=78.6, fiber_g=0.1),  # BLS: "Mayonnaise mit Essig"
    "cream_sauces": NutritionValues(calories_kcal=88, carbs_g=5.4, protein_g=2.5, fat_g=6.2, fiber_g=0.2),  # BLS: "Bechamelsauce"
    "soy_sauce_and_vinegar": NutritionValues(calories_kcal=66, carbs_g=5.5, protein_g=6.3, fat_g=0.9, fiber_g=1.1),  # BLS: "Sojasauce/Sojasoße"

    # ── Herbs, Spices & Flavorings ────────────────────────────────────
    "fresh_herbs": NutritionValues(calories_kcal=33, carbs_g=1.3, protein_g=4.1, fat_g=0.4, fiber_g=4.3),  # BLS: "Petersilienblatt roh"
    "dried_herbs": NutritionValues(calories_kcal=211, carbs_g=1.7, protein_g=23.0, fat_g=4.1, fiber_g=37.7),  # BLS: "Basilikum getrocknet" (no BLS entry found for dried oregano specifically)
    "spices": NutritionValues(calories_kcal=304, carbs_g=46.1, protein_g=10.9, fat_g=2.8, fiber_g=25.5),  # BLS: "Pfeffer schwarz, getrocknet"

    # ── Catch-all — kept as the ultimate fallback-of-fallback default
    # (`_canonical_category` itself returns "other" for anything
    # unrecognized, and `fallback_nutrition` falls back to this entry for
    # any canonical key not in this dict). A generic, roughly-balanced
    # estimate rather than any specific food group — not sourced from any
    # single food for that reason.
    "other": NutritionValues(calories_kcal=150, carbs_g=18.0, protein_g=5.0, fat_g=6.0, fiber_g=2.0),
}

# Coarse German department/category text (e.g. a store's own receipt
# category or an external category field) -> canonical category. Inherently
# coarser than the name-keyword table below — a department label like
# "Obst" can't distinguish citrus from stone fruit — so each entry picks
# the most common/representative member of that department rather than
# a precise match. In current call sites this branch is rarely exercised
# (receipt_text_parser.py always calls `_canonical_category(None, name)` at
# parse time, so `category` is only ever populated from *this same
# function's own* earlier output) — kept correct and populated anyway in
# case a real external category source (e.g. an OFF category field) is
# wired in later.
_GERMAN_CATEGORY_MAP = {
    "milchprodukte": "full_fat_dairy",
    "molkereiprodukte": "full_fat_dairy",
    "käse": "hard_and_semi_hard_cheese",
    "fleisch": "medium_fat_red_meat",
    "fleisch und wurst": "medium_fat_red_meat",
    "wurstwaren": "processed_meat",
    "geflügel": "medium_fat_poultry",
    "fisch": "white_fish",
    "fisch und meeresfrüchte": "white_fish",
    "obst": "pome_fruits",
    "obst und gemüse": "fruiting_vegetables",
    "gemüse": "fruiting_vegetables",
    "backwaren": "white_bread",
    "brot und backwaren": "white_bread",
    "getreide": "whole_grains",
    "nudeln": "dry_pasta",
    "reis": "white_rice",
    "hülsenfrüchte": "beans",
    "süßwaren": "chocolate",
    "snacks": "potato_chips",
    "knabberartikel": "potato_chips",
    "getränke": "water",
    "saft": "fruit_juice",
    # No dedicated "sugar-sweetened soda" leaf exists in food_categories.md
    # (only Energy/Sports drinks and Alcohol are listed under that header) —
    # energy_drinks is the closest macro match (plain sugar-carb, no
    # protein/fat) for a plain cola/lemonade until that gap is resolved.
    "limonade": "energy_drinks",
}

# Keyword hints applied to the (German) product name when no category
# string is available — the actual primary path, since parsed receipt
# items always start with `category=None` (see _GERMAN_CATEGORY_MAP's
# docstring above). Every keyword should belong to exactly one category;
# `_canonical_category` resolves any accidental overlap (inevitable with
# German compounding — "Erdnussöl" contains "Erdnuss", "Maissnack" contains
# "Mais") by preferring the LONGEST matching keyword, not by which category
# happens to be checked first.
_NAME_KEYWORDS = {
    # Vegetables
    "leafy_greens": ["spinat", "mangold", "feldsalat", "rucola", "kopfsalat", "eisbergsalat", "romanasalat", "blattspinat"],
    "cruciferous_vegetables": ["brokkoli", "blumenkohl", "rosenkohl", "weißkohl", "rotkohl", "wirsing", "kohlrabi", "chinakohl", "grünkohl", "spitzkohl"],
    "fruiting_vegetables": ["tomate", "tomaten", "gurke", "salatgurke", "paprika", "aubergine", "zucchini", "peperoni", "okra"],
    "root_vegetables_nonstarchy": ["karotte", "möhre", "möhren", "bete", "rettich", "radieschen", "sellerie", "pastinake", "schwarzwurzel", "knollensellerie"],
    "starchy_vegetables": ["kartoffel", "kartoffeln", "süßkartoffel", "kürbis", "hokkaido", "butternut", "mais"],
    "mushrooms": ["pilz", "pilze", "champignon", "champignons", "steinpilz", "pfifferling", "austernpilz", "shiitake"],
    "alliums": ["zwiebel", "zwiebeln", "knoblauch", "lauch", "porree", "schalotte", "frühlingszwiebel", "lauchzwiebel"],
    "fresh_legumes": ["erbse", "erbsen", "zuckerschote", "zuckererbse", "edamame", "brechbohne", "brechbohnen", "prinzessbohne", "prinzessbohnen"],

    # Fruits
    "berries": ["erdbeere", "erdbeeren", "himbeere", "himbeeren", "blaubeere", "blaubeeren", "heidelbeere", "heidelbeeren", "brombeere", "brombeeren", "johannisbeere", "stachelbeere", "cranberry", "preiselbeere"],
    "citrus_fruits": ["orange", "orangen", "mandarine", "mandarinen", "clementine", "zitrone", "zitronen", "limette", "grapefruit", "pomelo"],
    "pome_fruits": ["apfel", "äpfel", "birne", "birnen", "quitte"],
    "stone_fruits": ["pfirsich", "pfirsiche", "nektarine", "aprikose", "aprikosen", "pflaume", "pflaumen", "kirsche", "kirschen", "mirabelle", "zwetschge"],
    "tropical_fruits": ["banane", "bananen", "mango", "ananas", "kiwi", "papaya", "litschi", "passionsfrucht", "granatapfel", "wassermelone", "honigmelone", "melone", "weintraube", "trauben"],
    "high_fat_fruits": ["avocado", "avocados", "kokosnuss", "kokosnüsse"],

    # Meat
    "lean_poultry": ["hähnchenbrust", "putenbrust", "hühnerbrust", "geflügelbrust", "hähnchenfilet", "putenfilet", "hühnerfilet"],
    "medium_fat_poultry": ["hähnchenschenkel", "hähnchenkeule", "hähnchenflügel", "hähnchen", "hühnchen", "huhn", "pute", "poularde", "ente", "gans"],
    "lean_red_meat": ["rinderfilet", "filetsteak", "rumpsteak", "kalbfleisch", "kalb", "wildfleisch", "hirschfleisch", "rehfleisch"],
    "medium_fat_red_meat": ["rinderhack", "hackfleisch", "rindfleisch", "rind", "schweinefilet", "schweinemedaillon", "lammfleisch", "lamm"],
    "fatty_red_meat": ["schweinebauch", "bauchfleisch", "schweinenacken", "schweinshaxe", "speck", "schwein"],
    "processed_meat": ["würstchen", "wurst", "salami", "schinken", "bacon", "leberwurst", "bratwurst", "mortadella", "lyoner", "fleischwurst", "kochschinken", "wiener", "frankfurter", "kassler", "aufschnitt"],

    # Fish & Seafood
    "white_fish": ["kabeljau", "kabeljaufilet", "dorsch", "seelachs", "köhler", "schellfisch", "scholle", "victoriabarsch", "pangasius", "zander", "rotbarsch"],
    "fatty_fish": ["lachs", "hering", "makrele", "thunfisch", "sardine", "sardinen", "forelle", "aal"],
    "shellfish": ["garnele", "garnelen", "krabbe", "krabben", "muschel", "muscheln", "hummer", "languste", "jakobsmuschel", "scampi"],

    # Eggs
    "eggs": ["ei", "eier", "hühnereier"],

    # Dairy
    "skim_dairy": ["magermilch", "magerjoghurt", "magerquark"],
    "low_fat_dairy": ["fettarm", "buttermilch", "joghurt", "quark", "kefir"],
    "full_fat_dairy": ["vollmilch", "vollfett", "sahnejoghurt", "vollmilchjoghurt", "milch"],
    "soft_cheese": ["frischkäse", "mozzarella", "camembert", "brie", "feta", "ricotta", "mascarpone", "hüttenkäse"],
    "hard_and_semi_hard_cheese": ["gouda", "edamer", "emmentaler", "bergkäse", "parmesan", "cheddar", "tilsiter", "appenzeller", "gruyere", "räucherkäse", "käse"],
    "cream_based_dairy": ["schlagsahne", "sauerrahm", "schmand", "kaffeesahne", "sahne"],
    "butter_and_milk_fat": ["butterschmalz", "butter", "ghee"],

    # Grains & Cereals
    "whole_grains": ["dinkelkorn", "weizenkörner", "quinoa", "hirse", "buchweizen", "gerstenkörner", "getreidekörner"],
    "refined_grains": ["weizenmehl", "weißmehl", "speisestärke", "maisstärke", "grieß", "mehl"],
    "unsweetened_breakfast_cereals": ["haferflocken", "getreideflocken", "porridge", "müsli", "cornflakes"],
    "sweetened_breakfast_cereals": ["schokoflakes", "honigflakes", "frosties", "smacks", "knuspermüsli", "schokomüsli"],

    # Bread & Bakery
    "white_bread": ["weißbrot", "toastbrot", "baguette", "ciabatta", "weizenbrötchen", "brötchen", "semmel"],
    "whole_grain_bread": ["vollkornbrot", "mehrkornbrot", "roggenvollkornbrot", "dinkelvollkornbrot", "vollkornbrötchen", "schwarzbrot", "pumpernickel"],
    "crispbread_and_crackers": ["knäckebrot", "vollkorncracker", "salzcracker", "cracker", "kräcker"],
    "sweet_baked_goods": ["kuchen", "torte", "gebäck", "croissant", "donut", "muffin", "brownie", "streuselkuchen", "hefezopf"],

    # Pasta, Rice & Other Starches
    "dry_pasta": ["spaghetti", "nudeln", "penne", "fusilli", "makkaroni", "tagliatelle", "teigwaren", "spätzle", "lasagneplatten", "farfalle"],
    "white_rice": ["reis"],
    "brown_rice": ["vollkornreis", "naturreis", "wildreis"],
    "couscous_and_bulgur": ["couscous", "bulgur"],
    "cooked_starches": ["kartoffelpüree", "kartoffelbrei", "bratkartoffeln", "pommes"],

    # Dried Legumes
    "beans": ["kidneybohnen", "buschbohnen", "bohnen"],
    "lentils": ["linsen", "linse", "berglinsen", "tellerlinsen"],
    "chickpeas": ["kichererbsen", "kichererbse", "hummus"],
    "soybeans": ["sojabohnen", "sojabohne"],

    # Nuts & Seeds
    "tree_nuts": ["walnuss", "walnüsse", "mandel", "mandeln", "haselnuss", "haselnüsse", "cashew", "cashewkerne", "pistazie", "pistazien", "paranuss", "macadamia", "pekannuss"],
    "peanuts": ["erdnussbutter", "erdnussflips", "erdnuss", "erdnüsse"],
    "seeds": ["sonnenblumenkerne", "kürbiskerne", "chiasamen", "leinsamen", "sesam", "mohn", "hanfsamen"],

    # Oils & Fats
    "vegetable_oils": ["sonnenblumenöl", "olivenöl", "rapsöl", "distelöl", "sesamöl", "kokosöl", "pflanzenöl", "erdnussöl", "walnussöl"],
    "animal_fats": ["schweineschmalz", "gänseschmalz", "rindertalg", "schmalz", "talg"],
    "margarine": ["margarine"],

    # Plant-Based Protein Products
    "tofu": ["tofu"],
    "tempeh": ["tempeh"],
    "seitan": ["seitan"],
    "plant_based_meat_alternatives": ["veganebratwurst", "veganwurst", "veganschnitzel", "veggieburger", "sojaschnetzel", "sojageschnetzeltes", "veganhack"],

    # Plant-Based Dairy Alternatives
    "unsweetened_plant_milk": ["hafermilch", "haferdrink", "sojamilch", "sojadrink", "mandelmilch", "mandeldrink", "reismilch"],
    "plant_yogurt": ["sojajoghurt", "kokosjoghurt", "veganerjoghurt", "haferjoghurt"],
    "vegan_cheese": ["veganerscheiblettenkäse", "veganerkäse", "cashewkäse"],

    # Snacks
    "potato_chips": ["kartoffelchips", "chips"],
    "corn_snacks": ["tortillachips", "maissnack", "maischips", "nachos"],
    "pretzels": ["laugengebäck", "laugenstangen", "salzstangen", "brezel", "breze"],
    "popcorn": ["popcorn"],
    "rice_cakes": ["reiswaffel", "reiswaffeln"],

    # Sweets & Desserts
    "chocolate": ["schokolade", "tafelschokolade", "pralinen", "schoko"],
    "sugar_candy": ["gummibärchen", "fruchtgummi", "karamellbonbon", "weingummi", "lakritz", "bonbon", "bonbons"],
    "cookies_and_biscuits": ["butterkeks", "plätzchen", "keks", "kekse"],
    # "eis" alone is too short (3 chars) for the substring/compound match
    # rule below, so it would never fire inside "Vanilleeis"/"Schokoeis" —
    # listed as explicit compounds instead of relying on the bare word.
    "ice_cream": ["speiseeis", "eiscreme", "softeis", "vanilleeis", "schokoeis", "erdbeereis", "fruchteis", "eiswaffel"],

    # Beverages
    "water": ["mineralwasser", "tafelwasser", "quellwasser", "sprudel", "wasser"],
    "coffee_and_tea": ["kaffee", "espresso", "cappuccino", "kräutertee", "früchtetee", "tee"],
    "zero_calorie_beverages": ["diätlimonade", "zero", "light"],
    "fruit_juice": ["orangensaft", "apfelsaft", "fruchtsaft", "direktsaft", "traubensaft", "saft"],
    "energy_drinks": ["energydrink", "energiegetränk"],
    "sports_drinks": ["sportgetränk", "isotonisch"],
    "alcoholic_beverages": ["weißwein", "rotwein", "bier", "wein", "sekt", "likör", "schnaps", "whisky", "wodka", "rum", "gin"],

    # Condiments & Sauces
    "tomato_based_sauces": ["tomatensauce", "tomatensoße", "passata", "tomatenmark"],
    "mustard": ["senf"],
    "ketchup": ["ketchup"],
    "mayonnaise": ["mayonnaise", "mayo"],
    "cream_sauces": ["sahnesauce", "hollandaise", "rahmsauce", "bechamel"],
    "soy_sauce_and_vinegar": ["sojasauce", "sojasoße", "balsamico", "essig"],

    # Herbs, Spices & Flavorings
    "fresh_herbs": ["petersilie", "schnittlauch", "basilikum", "koriander", "minze", "dill"],
    "dried_herbs": ["kräutermischung", "italienischekräuter", "oregano", "thymian", "rosmarin", "majoran"],
    "spices": ["paprikapulver", "currypulver", "chilipulver", "kreuzkümmel", "kurkuma", "muskat", "gewürz", "pfeffer", "zimt", "salz"],
}


def _canonical_category(category: Optional[str], name: str) -> str:
    """Resolve a canonical category from the parser category, then the name.

    When multiple keywords match (inevitable with German compounding —
    "Erdnussöl" contains both "erdnuss" and "erdnussöl"), the LONGEST
    matching keyword wins, independent of dict iteration order — the more
    specific keyword is always the more specific category."""

    if category:
        cat = category.strip().lower()
        if cat in _GERMAN_CATEGORY_MAP:
            return _GERMAN_CATEGORY_MAP[cat]
        best_match, best_canonical = "", None
        for german, canonical in _GERMAN_CATEGORY_MAP.items():
            if german in cat and len(german) > len(best_match):
                best_match, best_canonical = german, canonical
        if best_canonical:
            return best_canonical

    name_l = (name or "").lower()
    tokens = set(re.findall(r"[a-zäöüß]+", name_l))
    best_match, best_canonical = "", None
    for canonical, keywords in _NAME_KEYWORDS.items():
        for kw in keywords:
            # Short keywords (e.g. "ei") only match a whole word, so they
            # don't fire inside unrelated words ("irgendein"). Longer
            # keywords may match as substrings to catch German compounds
            # ("milch" inside "vollmilch").
            if (kw in tokens or (len(kw) >= 4 and kw in name_l)) and len(kw) > len(best_match):
                best_match, best_canonical = kw, canonical

    return best_canonical or "other"


def fallback_nutrition(name: str, category: Optional[str] = None) -> MatchedProduct:
    """
    Build a low-confidence, category-based MatchedProduct for an item
    that OpenFoodFacts could not match.
    """

    canonical = _canonical_category(category, name)
    nutrition = CATEGORY_NUTRITION.get(canonical, CATEGORY_NUTRITION["other"])

    return MatchedProduct(
        parsed_item_name=name,
        matched_name=None,
        off_id=None,
        fallback_category=canonical,
        match_type=MatchType.FALLBACK,
        confidence=FALLBACK_CONFIDENCE,
        data_source=f"fallback_category:{canonical}",
        nutrition=nutrition,
    )
