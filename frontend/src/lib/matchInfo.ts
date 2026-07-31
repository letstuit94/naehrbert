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
