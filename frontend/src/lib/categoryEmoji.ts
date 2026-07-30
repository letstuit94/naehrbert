/**
 * Food-group emoji per pantry lot.
 *
 * The backend stores an 87-leaf canonical category on every lot (`category`,
 * set at parse time by `_canonical_category`; see fallback_categories.py),
 * plus a `fallback_category` on lots that only got a category-level estimate.
 * The Pantry collapses those leaves into the 13 coarse food groups the user
 * reasons about and shows one emoji per lot as a quick visual cue.
 *
 * The map is keyed by LEAF category (what's stored), grouped here under the
 * emoji of its food group. `other` (not assignable) and any missing/unmapped
 * category -> 🍽️. "Frozen Foods" (🧊) has no leaf in
 * the current taxonomy, so it's never assigned automatically -- it's kept in
 * GROUP_EMOJI/emoji labels for when the taxonomy gains a frozen leaf.
 */

import type { Matchable } from './matchInfo'
import type { TranslateFn } from './i18n'

/** A lot carries a canonical `category` for every item; `fallback_category`
 * is only populated for category-estimate lots. Both use the same leaf keys. */
export interface Categorizable extends Matchable {
  category: string | null
}

// Leaf canonical category -> food-group emoji.
export const CATEGORY_EMOJI: Record<string, string> = {
  // 🥒 Vegetables
  leafy_greens: '🥒',
  cruciferous_vegetables: '🥒',
  fruiting_vegetables: '🥒',
  root_vegetables_nonstarchy: '🥒',
  starchy_vegetables: '🥒',
  mushrooms: '🥒',
  alliums: '🥒',
  fresh_legumes: '🥒',

  // 🍏 Fruits
  berries: '🍏',
  citrus_fruits: '🍏',
  pome_fruits: '🍏',
  stone_fruits: '🍏',
  tropical_fruits: '🍏',
  high_fat_fruits: '🍏',

  // 🥛 Dairy, Eggs & Plant-Based Dairy Alternatives
  skim_dairy: '🥛',
  low_fat_dairy: '🥛',
  full_fat_dairy: '🥛',
  soft_cheese: '🥛',
  hard_and_semi_hard_cheese: '🥛',
  cream_based_dairy: '🥛',
  butter_and_milk_fat: '🥛',
  unsweetened_plant_milk: '🥛',
  sweetened_plant_milk: '🥛',
  plant_yogurt: '🥛',
  vegan_cheese: '🥛',

  // 🥚 Eggs
  eggs: '🥚',

  // 🥩 Meat & Plant-Based Protein Products
  lean_poultry: '🥩',
  medium_fat_poultry: '🥩',
  lean_red_meat: '🥩',
  medium_fat_red_meat: '🥩',
  fatty_red_meat: '🥩',
  processed_meat: '🥩',
  tofu: '🥩',
  tempeh: '🥩',
  seitan: '🥩',
  plant_based_meat_alternatives: '🥩',

  // 🐟 Fish & Seafood
  white_fish: '🐟',
  fatty_fish: '🐟',
  shellfish: '🐟',

  // 🍞 Bread & Bakery
  white_bread: '🍞',
  whole_grain_bread: '🍞',
  crispbread_and_crackers: '🍞',
  sweet_baked_goods: '🍞',

  // 🌾 Pasta, Rice & Other Starches + Grains & Cereals
  dry_pasta: '🌾',
  white_rice: '🌾',
  brown_rice: '🌾',
  couscous_and_bulgur: '🌾',
  cooked_starches: '🌾',
  whole_grains: '🌾',
  refined_grains: '🌾',
  unsweetened_breakfast_cereals: '🌾',
  sweetened_breakfast_cereals: '🌾',

  // 🥫 Dried Legumes
  beans: '🥫',
  lentils: '🥫',
  chickpeas: '🥫',
  soybeans: '🥫',

  // 🫒 Oils & Fats + Herbs, Spices & Flavorings + Condiments & Sauces
  vegetable_oils: '🫒',
  animal_fats: '🫒',
  margarine: '🫒',
  fresh_herbs: '🫒',
  dried_herbs: '🫒',
  spices: '🫒',
  tomato_based_sauces: '🫒',
  mustard: '🫒',
  ketchup: '🫒',
  mayonnaise: '🫒',
  cream_sauces: '🫒',
  soy_sauce_and_vinegar: '🫒',

  // 🍫 Sweets & Desserts + Snacks
  chocolate: '🍫',
  sugar_candy: '🍫',
  cookies_and_biscuits: '🍫',
  ice_cream: '🍫',
  potato_chips: '🍫',
  corn_snacks: '🍫',
  pretzels: '🍫',
  popcorn: '🍫',
  rice_cakes: '🍫',

  // 🥤 Beverages
  water: '🥤',
  coffee_and_tea: '🥤',
  zero_calorie_beverages: '🥤',
  fruit_juice: '🥤',
  energy_drinks: '🥤',
  sports_drinks: '🥤',
  alcoholic_beverages: '🥤',

  // 🥜 Nuts & Seeds
  tree_nuts: '🥜',
  peanuts: '🥜',
  seeds: '🥜',

  // 🍽️ Others / not assignable
  other: '🍽️',
}

// Human-readable food group per emoji, for the badge's title / aria-label.
export function emojiGroupLabel(t: TranslateFn, emoji: string): string {
  switch (emoji) {
    case '🥒':
      return t('Vegetables', 'Gemüse')
    case '🍏':
      return t('Fruits', 'Obst')
    case '🥛':
      return t('Dairy & Plant-Based Alternatives', 'Milchprodukte & pflanzliche Alternativen')
    case '🥚':
      return t('Eggs', 'Eier')
    case '🥩':
      return t('Meat & Plant-Based Protein', 'Fleisch & pflanzliches Protein')
    case '🐟':
      return t('Fish & Seafood', 'Fisch & Meeresfrüchte')
    case '🍞':
      return t('Bread & Bakery', 'Brot & Backwaren')
    case '🌾':
      return t('Grains, Pasta, Rice & Starches', 'Getreide, Nudeln, Reis & Stärke')
    case '🥫':
      return t('Dried Legumes', 'Getrocknete Hülsenfrüchte')
    case '🫒':
      return t('Oils, Fats, Herbs, Spices & Sauces', 'Öle, Fette, Kräuter, Gewürze & Saucen')
    case '🍫':
      return t('Sweets, Desserts & Snacks', 'Süßigkeiten, Desserts & Snacks')
    case '🥤':
      return t('Beverages', 'Getränke')
    case '🧊':
      return t('Frozen Foods', 'Tiefkühlkost')
    case '🥜':
      return t('Nuts & Seeds', 'Nüsse & Samen')
    case '🍽️':
      return t('Uncategorized', 'Nicht kategorisiert')
    default:
      return t('Uncategorized', 'Nicht kategorisiert')
  }
}

const FALLBACK_EMOJI = '🍽️'

/** The food-group emoji for a lot: prefer the always-present canonical
 * `category`, fall back to `fallback_category`, and default to 📦 (Others)
 * for anything unmapped or missing. Never returns null so every lot renders
 * a consistent badge. */
export function categoryEmoji(item: Categorizable): string {
  const key = item.category ?? item.fallback_category
  if (key && key in CATEGORY_EMOJI) return CATEGORY_EMOJI[key]
  return FALLBACK_EMOJI
}
