import type { DietaryStyle } from './api'
import type { TranslateFn } from './i18n'

/**
 * Shared option lists for the recipe-preferences chat (RecipeChatPage.tsx)
 * and the Profile page's dietary-preferences editor -- kept in one place
 * so both stay in sync without duplicating the lists.
 *
 * The option *labels* are language-dependent, so these are factory functions
 * taking the `t(en, de)` translate fn from useI18n() rather than plain
 * constants; the `value`s (stored in the DB / sent to the backend) never
 * change with language.
 */

export interface Option {
  value: string
  label: string
}

export function dietaryStyleOptions(
  t: TranslateFn,
): { value: DietaryStyle; label: string }[] {
  return [
    { value: 'omnivore', label: t('🍖 Omnivore', '🍖 Allesesser') },
    { value: 'pescatarian', label: t('🐟 Pescatarian', '🐟 Pescetarier') },
    { value: 'vegetarian', label: t('🥚 Vegetarian', '🥚 Vegetarisch') },
    { value: 'vegan', label: t('🌱 Vegan', '🌱 Vegan') },
  ]
}

/** The EU-14 common allergens/intolerances -- a reasonable common-ground
 * list; anything else is captured via free-text "other". */
export function allergenOptions(t: TranslateFn): Option[] {
  return [
    { value: 'gluten', label: t('Gluten', 'Gluten') },
    { value: 'crustaceans', label: t('Crustaceans', 'Krebstiere') },
    { value: 'eggs', label: t('Eggs', 'Eier') },
    { value: 'fish', label: t('Fish', 'Fisch') },
    { value: 'peanuts', label: t('Peanuts', 'Erdnüsse') },
    { value: 'soybeans', label: t('Soybeans', 'Sojabohnen') },
    { value: 'milk_lactose', label: t('Milk / lactose', 'Milch / Laktose') },
    { value: 'tree_nuts', label: t('Tree nuts', 'Schalenfrüchte') },
    { value: 'celery', label: t('Celery', 'Sellerie') },
    { value: 'mustard', label: t('Mustard', 'Senf') },
    { value: 'sesame', label: t('Sesame', 'Sesam') },
    { value: 'sulphites', label: t('Sulphites', 'Sulfite') },
    { value: 'lupin', label: t('Lupin', 'Lupine') },
    { value: 'molluscs', label: t('Molluscs', 'Weichtiere') },
  ]
}
