/**
 * Shared "essentials" view of the resolver's match (Epic 3.2 / Epic 4.1):
 * what an item actually got matched to, not just its parsed/purchased name
 * -- used by the review screen (to catch a bad match before confirming)
 * and the Purchases page (to show how each past purchase was matched).
 * `fallback`/no-match are flagged as low-confidence since they're a
 * category-level estimate or nothing at all.
 */

import type { TranslateFn } from './i18n'

export interface Matchable {
  is_non_food: boolean
  matched_name: string | null
  fallback_category: string | null
}

export function formatFallbackCategory(category: string): string {
  return category
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function matchInfo(
  t: TranslateFn,
  item: Matchable,
): { label: string; lowConfidence: boolean } | null {
  if (item.is_non_food) return null
  if (item.matched_name) {
    return { label: item.matched_name, lowConfidence: false }
  }
  if (item.fallback_category) {
    return { label: formatFallbackCategory(item.fallback_category), lowConfidence: true }
  }
  return { label: t('No match found', 'Kein Treffer gefunden'), lowConfidence: true }
}

/** The Purchases page's data-transparency filter categories. Any
 * `matched_name` counts as "verified" regardless of which resolver tier
 * produced it (verified_matches / OpenFoodFacts / BLS) -- the app has
 * never distinguished those in the UI (matchInfo above treats them
 * identically), so the filter doesn't invent a distinction the rest of
 * the app doesn't make either. */
export type MatchCategory = 'verified' | 'fallback' | 'none' | 'non_food'

export function matchCategoryLabel(t: TranslateFn, category: MatchCategory): string {
  switch (category) {
    case 'verified':
      return t('Verified database matches', 'Bestätigte Datenbank-Treffer')
    case 'fallback':
      return t('Fallback category matches', 'Kategorie-Schätzungen')
    case 'none':
      return t('No matches', 'Keine Treffer')
    case 'non_food':
      return t('Non-food', 'Kein Lebensmittel')
  }
}

export function matchCategory(item: Matchable): MatchCategory {
  if (item.is_non_food) return 'non_food'
  if (item.matched_name) return 'verified'
  if (item.fallback_category) return 'fallback'
  return 'none'
}
