import { useEffect, useState } from 'react'
import { PageSkeleton } from '../components/Skeleton'
import { Link } from 'react-router-dom'
import {
  ApiError,
  correctReceiptItem,
  getPurchases,
  updateReceiptItem,
  type ItemCorrection,
  type PurchaseItem,
} from '../lib/api'
import { matchInfo } from '../lib/matchInfo'
import {
  quantityBasis,
  quantityBasisLabel,
  type QuantityBasis,
} from '../lib/quantityBasis'
import { MatchSearchPanel } from '../components/MatchSearchPanel'
import { useI18n, type TranslateFn } from '../lib/i18n'

type LoadState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: PurchaseItem[] }

type ReceiptGroup = {
  receiptId: string
  store: string | null
  purchasedAt: string | null
  items: PurchaseItem[]
}

const UNIT_OPTIONS = ['g', 'kg', 'ml', 'l', 'piece'] as const

const QUANTITY_BASIS_ICON: Record<QuantityBasis, string> = {
  weighed: '⚖',
  piece: '≈',
  unknown: '?',
}

/** Same "unknown" sentinel handling as the review screen (services/
 * receipt_text_parser.py never returns a real null for store, only this
 * string) -- the one place that mapping happens, used both for the group
 * header and as the filter chips' grouping key so they can't disagree. */
function storeLabel(t: TranslateFn, store: string | null): string {
  return store && store !== 'unknown' ? store : t('Unknown store', 'Unbekannter Laden')
}

function formatDate(t: TranslateFn, iso: string | null): string {
  if (!iso) return t('Unknown date', 'Unbekanntes Datum')
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatGrams(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}g`
}

function formatPrice(value: number): string {
  return `€${value.toFixed(2)}`
}

// Items already arrive sorted by purchased_at desc (GET /analysis/purchases);
// grouping preserves that order since each receipt's items are contiguous.
function groupByReceipt(items: PurchaseItem[]): ReceiptGroup[] {
  const groups: ReceiptGroup[] = []
  const indexByReceipt = new Map<string, number>()
  for (const item of items) {
    let idx = indexByReceipt.get(item.receipt_id)
    if (idx === undefined) {
      idx = groups.length
      indexByReceipt.set(item.receipt_id, idx)
      groups.push({
        receiptId: item.receipt_id,
        store: item.store,
        purchasedAt: item.purchased_at,
        items: [],
      })
    }
    groups[idx].items.push(item)
  }
  return groups
}

function groupTotal(group: ReceiptGroup): number {
  return group.items.reduce((sum, item) => sum + (item.price ?? 0), 0)
}

/** Per-store totals across every loaded item (not just the currently
 * visible ones) -- the chip row is meant to stay stable and complete as a
 * menu of what CAN be shown, while toggling only affects what IS shown. */
function storeTotals(
  t: TranslateFn,
  items: PurchaseItem[],
): { label: string; total: number }[] {
  const totals = new Map<string, number>()
  for (const item of items) {
    const label = storeLabel(t, item.store)
    totals.set(label, (totals.get(label) ?? 0) + (item.price ?? 0))
  }
  return [...totals.entries()]
    .map(([label, total]) => ({ label, total }))
    .sort((a, b) => b.total - a.total)
}

export function PurchasesPage() {
  const { t } = useI18n()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  // Which store labels are currently shown -- starts as "everything" on the
  // first load, then left alone on later reloads (e.g. after an edit) so an
  // in-progress filter choice doesn't get silently reset out from under the
  // user.
  const [activeStores, setActiveStores] = useState<Set<string>>(new Set())

  function load() {
    return getPurchases()
      .then((result) => {
        setState(
          result.items.length === 0
            ? { status: 'empty' }
            : { status: 'ready', items: result.items },
        )
        setActiveStores((prev) =>
          prev.size === 0
            ? new Set(result.items.map((i) => storeLabel(t, i.store)))
            : prev,
        )
      })
      .catch((err) => {
        setState({
          status: 'error',
          message:
            err instanceof ApiError
              ? err.message
              : t('Could not load your purchases.', 'Deine Einkäufe konnten nicht geladen werden.'),
        })
      })
  }

  useEffect(() => {
    void load()
  }, [])

  // Quantity/unit/match corrections are written against the *stored*
  // receipt_items row (per-100g values), but this page shows *actual*
  // kcal/macros already scaled for the purchased quantity -- refetching
  // after every change is simpler and more robust than duplicating the
  // backend's grams_for() scaling logic here just to patch state locally.
  async function handleQuantityUnitSave(
    item: PurchaseItem,
    fields: { quantity?: number; unit?: string },
  ) {
    setActionError(null)
    try {
      await updateReceiptItem(item.receipt_id, item.id, fields)
      await load()
    } catch {
      setActionError(t('Could not save that change.', 'Diese Änderung konnte nicht gespeichert werden.'))
    }
  }

  async function handleCorrect(item: PurchaseItem, correction: ItemCorrection) {
    setActionError(null)
    try {
      await correctReceiptItem(item.receipt_id, item.id, correction)
      await load()
    } catch {
      setActionError(t('Could not save that match.', 'Diese Zuordnung konnte nicht gespeichert werden.'))
    }
  }

  if (state.status === 'loading') {
    return (
      <section aria-busy="true">
        <h1>{t('Purchases', 'Einkäufe')}</h1>
        <PageSkeleton cards={3} lines={1} />
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section>
        <h1>{t('Purchases', 'Einkäufe')}</h1>
        <p className="form-error" role="alert">
          {state.message}
        </p>
      </section>
    )
  }

  if (state.status === 'empty') {
    return (
      <section>
        <h1>{t('Purchases', 'Einkäufe')}</h1>
        <p>
          {t('No confirmed receipts yet. ', 'Noch keine bestätigten Belege. ')}
          <Link to="/upload">{t('Upload one', 'Lade einen hoch')}</Link>
          {t(' to see your purchases here.', ', um deine Einkäufe hier zu sehen.')}
        </p>
      </section>
    )
  }

  const groups = groupByReceipt(state.items).filter((group) =>
    activeStores.has(storeLabel(t, group.store)),
  )
  const totals = storeTotals(t, state.items)

  function toggleStore(label: string) {
    setActiveStores((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  return (
    <section>
      <h1>{t('Purchases', 'Einkäufe')}</h1>
      <p className="page-lead">
        {t(
          "Everything you've uploaded and confirmed, grouped by receipt.",
          'Alles, was du hochgeladen und bestätigt hast, nach Beleg gruppiert.',
        )}
      </p>

      {totals.length > 1 && (
        <div
          className="filter-bar"
          role="group"
          aria-label={t('Filter by store', 'Nach Laden filtern')}
        >
          {totals.map(({ label, total }) => {
            const active = activeStores.has(label)
            return (
              <button
                key={label}
                type="button"
                className={active ? 'filter-chip filter-chip--active' : 'filter-chip'}
                aria-pressed={active}
                onClick={() => toggleStore(label)}
              >
                {active && (
                  <span className="filter-chip__check" aria-hidden="true">
                    ✓
                  </span>
                )}
                {label}
                <span className="filter-chip__count">{formatPrice(total)}</span>
              </button>
            )
          })}
        </div>
      )}

      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {groups.map((group) => (
        <div key={group.receiptId} className="purchase-group">
          <h2 className="purchase-group__header">
            <span>
              {storeLabel(t, group.store)}{' '}
              <span className="muted">· {formatDate(t, group.purchasedAt)}</span>
            </span>
            <span className="purchase-group__total">{formatPrice(groupTotal(group))}</span>
          </h2>
          <ul className="purchase-list">
            {group.items.map((item) => (
              <PurchaseRow
                key={item.id}
                item={item}
                onQuantityUnitSave={(fields) => handleQuantityUnitSave(item, fields)}
                onCorrect={(correction) => handleCorrect(item, correction)}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function PurchaseRow({
  item,
  onQuantityUnitSave,
  onCorrect,
}: {
  item: PurchaseItem
  onQuantityUnitSave: (fields: { quantity?: number; unit?: string }) => void
  onCorrect: (correction: ItemCorrection) => void
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const [searching, setSearching] = useState(false)
  const [quantity, setQuantity] = useState(
    item.quantity !== null ? String(item.quantity) : '',
  )
  const [unit, setUnit] = useState(item.unit ?? 'piece')
  const match = matchInfo(t, item)
  const basis = quantityBasis(item)

  return (
    <li
      className={
        item.is_non_food ? 'purchase-row purchase-row--non-food' : 'purchase-row'
      }
    >
      <div className="purchase-row__name-cell">
        <span className="purchase-row__name">{item.name}</span>
        {match && (
          <span
            className={
              match.lowConfidence
                ? 'review-row__match review-row__match--warn'
                : 'review-row__match'
            }
          >
            {match.lowConfidence ? '~ ' : '✓ '}
            {match.label}
          </span>
        )}
        <button
          type="button"
          className="btn-link purchase-row__edit-toggle"
          onClick={() => setEditing((e) => !e)}
        >
          {editing ? t('Close', 'Schließen') : t('Edit', 'Bearbeiten')}
        </button>
      </div>
      <span className="purchase-row__qty">
        {item.quantity ?? '—'} {item.unit ?? ''}
        <span
          className={`qty-basis qty-basis--${basis}`}
          title={quantityBasisLabel(t, basis)}
          aria-label={quantityBasisLabel(t, basis)}
        >
          {QUANTITY_BASIS_ICON[basis]}
        </span>
      </span>
      {item.is_non_food ? (
        <span className="purchase-row__nonfood muted">{t('Not food', 'Kein Lebensmittel')}</span>
      ) : (
        <span className="purchase-row__macros">
          {item.calories_kcal !== null ? `${Math.round(item.calories_kcal)} kcal` : '—'} ·
          P {formatGrams(item.protein_g)} · F {formatGrams(item.fat_g)} · C{' '}
          {formatGrams(item.carbs_g)}
        </span>
      )}

      {editing && (
        <div className="purchase-row__edit-panel">
          <div className="chat-input-row">
            <input
              type="number"
              min={0}
              step="any"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              onBlur={() => {
                const n = Number(quantity)
                if (quantity.trim() && !Number.isNaN(n) && n !== item.quantity) {
                  onQuantityUnitSave({ quantity: n })
                }
              }}
              aria-label={t('Quantity', 'Menge')}
            />
            <select
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value)
                onQuantityUnitSave({ unit: e.target.value })
              }}
              aria-label={t('Unit', 'Einheit')}
            >
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            {!item.is_non_food && (
              <button
                type="button"
                className="btn-link"
                onClick={() => setSearching((s) => !s)}
              >
                {searching ? t('Cancel search', 'Suche abbrechen') : t('Fix match', 'Zuordnung korrigieren')}
              </button>
            )}
          </div>
          {searching && (
            <MatchSearchPanel
              item={item}
              receiptId={item.receipt_id}
              onCorrect={onCorrect}
              onClose={() => setSearching(false)}
            />
          )}
        </div>
      )}
    </li>
  )
}
