/**
 * Data-transparency classification of how much basis there actually is for
 * an item's purchased quantity -- mirrors the mass/volume unit set in
 * backend/app/services/units.py's `_UNIT_ALIASES` (kept in sync by hand;
 * that module is the source of truth for what grams_for() actually treats
 * as a real weight vs. a counted "piece").
 */

export type QuantityBasis = 'weighed' | 'piece' | 'unknown'

export const QUANTITY_BASIS_LABEL: Record<QuantityBasis, string> = {
  weighed: 'Weight/volume given',
  piece: 'Piece count only (estimated weight)',
  unknown: 'No quantity basis',
}

const _MASS_VOLUME_UNIT_ALIASES = new Set([
  'g',
  'gr',
  'gram',
  'gramm',
  'gramme',
  'grams',
  'kg',
  'kilo',
  'kilogramm',
  'kilogram',
  'ml',
  'milliliter',
  'millilitre',
  'cl',
  'l',
  'ltr',
  'liter',
  'litre',
])

/** `quantity === null` means the receipt/user never established even a
 * count -- distinct from a "piece" count, which at least says "how many",
 * just not how much each one weighs (that part is a category-keyed
 * estimate, same as backend/app/services/units.py's piece_weight_grams). */
export function quantityBasis(item: {
  quantity: number | null
  unit: string | null
}): QuantityBasis {
  if (item.quantity === null) return 'unknown'
  const normalized = (item.unit ?? '').trim().toLowerCase().replace(/\.$/, '')
  return _MASS_VOLUME_UNIT_ALIASES.has(normalized) ? 'weighed' : 'piece'
}
