/**
 * Pantry urgency: display + view/filter helpers.
 *
 * The backend estimates each lot's urgency from category + purchase date and
 * sends ONLY a fuzzy bucket (`urgency`) -- never an estimated date or a day
 * count. This module turns that bucket into the traffic-light + soft label
 * (architecture: sort-value and display-value are strictly separated; a guess
 * is never shown as a number), and holds the pure view/filter logic the
 * PantryPage composes. It intentionally knows nothing about days.
 */

import type { FoodGroup, PantryItem, Urgency } from './api'
import type { TranslateFn } from './i18n'

/** Traffic-light colour per bucket. 'expired' and 'soon' both read red (both
 * are "use very soon"); the finer expired/soon split exists only for the
 * "next 3 days" filter. */
export type Light = 'red' | 'yellow' | 'green' | 'grey'

const URGENCY_LIGHT: Record<Urgency, Light> = {
  expired: 'red',
  soon: 'red',
  week: 'yellow',
  long: 'green',
  unknown: 'grey',
}

export function urgencyLight(urgency: Urgency): Light {
  return URGENCY_LIGHT[urgency]
}

// Soft, non-numeric labels ("use soon" / "this week" / "lasting").
// 'unknown' has no label -- no estimate, nothing to say.
export function urgencyLabel(t: TranslateFn, urgency: Urgency): string | null {
  switch (urgency) {
    case 'expired':
    case 'soon':
      return t('use soon', 'bald verbrauchen')
    case 'week':
      return t('this week', 'diese Woche')
    case 'long':
      return t('lasting', 'haltbar')
    case 'unknown':
      return null
  }
}

// Full-sentence description for the badge's tooltip / aria-label, so the
// colour is never the only carrier of meaning (accessibility).
export function urgencyDescription(t: TranslateFn, urgency: Urgency): string {
  switch (urgency) {
    case 'expired':
    case 'soon':
      return t('Use very soon (estimated)', 'Sehr bald verbrauchen (geschätzt)')
    case 'week':
      return t('Best used this week (estimated)', 'Am besten diese Woche verbrauchen (geschätzt)')
    case 'long':
      return t('Keeps for a while (estimated)', 'Hält noch eine Weile (geschätzt)')
    case 'unknown':
      return t('No shelf-life estimate', 'Keine Haltbarkeitsschätzung')
  }
}

/** The "only the next 3 days" filter set: expired + soon (see shelf_life.py,
 * where SOON_DAYS = 3). Kept as data so the meaning lives in one place. */
const NEXT_3_DAYS: ReadonlySet<Urgency> = new Set<Urgency>(['expired', 'soon'])

export function isWithinNext3Days(item: PantryItem): boolean {
  return NEXT_3_DAYS.has(item.urgency)
}

/** The two pantry views. A = flat, urgency-first (default); B = grouped by
 * food category. This is the SORT/layout toggle -- separate from the filters
 * below. */
export type PantryView = 'urgency' | 'category'

export interface PantryFilters {
  /** Food groups hidden by the user (empty = show all). */
  hiddenGroups: Set<FoodGroup>
  /** Only show lots within the next 3 days (see isWithinNext3Days). */
  onlyNext3Days: boolean
  /** Free-text search over the displayed name (case-insensitive). */
  search: string
}

export const NO_FILTERS: PantryFilters = {
  hiddenGroups: new Set(),
  onlyNext3Days: false,
  search: '',
}

/** Apply the (view-independent) filters to already-ordered items. `nameOf`
 * lets the caller pass the same display name the row renders, so search hits
 * what the user actually sees. Order is preserved -- the server already sorted
 * ascending by estimated expiry, and filtering never reorders. */
export function applyFilters(
  items: PantryItem[],
  filters: PantryFilters,
  nameOf: (item: PantryItem) => string,
): PantryItem[] {
  const needle = filters.search.trim().toLowerCase()
  return items.filter((item) => {
    if (filters.hiddenGroups.has(item.food_group)) return false
    if (filters.onlyNext3Days && !isWithinNext3Days(item)) return false
    if (needle && !nameOf(item).toLowerCase().includes(needle)) return false
    return true
  })
}

export interface CategoryGroup {
  group: FoodGroup
  label: string
  items: PantryItem[]
}

/** Group items by food group for view B, preserving the incoming (ascending
 * estimated-expiry) order both across groups and within each group. Groups
 * appear in first-seen order, which -- because the list arrives urgency-first
 * -- puts the group holding the single most-urgent lot on top. "Other" is
 * forced last so a no-estimate bucket never leads. */
export function groupByCategory(items: PantryItem[]): CategoryGroup[] {
  const order: FoodGroup[] = []
  const byGroup = new Map<FoodGroup, CategoryGroup>()
  for (const item of items) {
    let entry = byGroup.get(item.food_group)
    if (!entry) {
      entry = { group: item.food_group, label: item.food_group_label, items: [] }
      byGroup.set(item.food_group, entry)
      order.push(item.food_group)
    }
    entry.items.push(item)
  }
  return order
    .map((g) => byGroup.get(g)!)
    .sort((a, b) => Number(a.group === 'other') - Number(b.group === 'other'))
}
