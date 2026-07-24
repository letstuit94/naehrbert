import type { DietaryStyle } from './api'

/**
 * Shared option lists for the recipe-preferences chat (RecipeChatPage.tsx)
 * and the Profile page's dietary-preferences editor -- kept in one place
 * so both stay in sync without duplicating the lists.
 */

export interface Option {
  value: string
  label: string
}

export const DIETARY_STYLE_OPTIONS: { value: DietaryStyle; label: string }[] = [
  { value: 'omnivore', label: '🍖 Omnivore' },
  { value: 'pescatarian', label: '🐟 Pescatarian' },
  { value: 'vegetarian', label: '🥚 Vegetarian' },
  { value: 'vegan', label: '🌱 Vegan' },
]

export const DIETARY_STYLE_LABEL: Record<DietaryStyle, string> = Object.fromEntries(
  DIETARY_STYLE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<DietaryStyle, string>

/** The EU-14 common allergens/intolerances -- a reasonable common-ground
 * list; anything else is captured via free-text "other". */
export const ALLERGEN_OPTIONS: Option[] = [
  { value: 'gluten', label: 'Gluten' },
  { value: 'crustaceans', label: 'Crustaceans' },
  { value: 'eggs', label: 'Eggs' },
  { value: 'fish', label: 'Fish' },
  { value: 'peanuts', label: 'Peanuts' },
  { value: 'soybeans', label: 'Soybeans' },
  { value: 'milk_lactose', label: 'Milk / lactose' },
  { value: 'tree_nuts', label: 'Tree nuts' },
  { value: 'celery', label: 'Celery' },
  { value: 'mustard', label: 'Mustard' },
  { value: 'sesame', label: 'Sesame' },
  { value: 'sulphites', label: 'Sulphites' },
  { value: 'lupin', label: 'Lupin' },
  { value: 'molluscs', label: 'Molluscs' },
]
