import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  addPantryRemoval,
  ApiError,
  deletePantryRemoval,
  getPantry,
  updateReceiptItem,
  type ItemUpdate,
  type PantryItem,
  type PantryRemovalReason,
} from '../lib/api'
import { formatFallbackCategory, matchInfo } from '../lib/matchInfo'
import {
  quantityBasis,
  QUANTITY_BASIS_LABEL,
  type QuantityBasis,
} from '../lib/quantityBasis'

type LoadState =
  | { status: 'loading' }
  | { status: 'empty' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: PantryItem[] }

// What the last withdrawal did, so it can be undone (deletes the ledger row
// -> the amount comes back). Only the most recent action is undoable; older
// ones are a fresh page reload away.
type LastAction = {
  removalId: string
  itemName: string
  reason: PantryRemovalReason
  appliedQuantity: number
  unit: string | null
  clamped: boolean
}

const REASON_VERB: Record<PantryRemovalReason, string> = {
  eaten: 'eaten',
  removed: 'removed',
}

const REASON_CONFIRM: Record<PantryRemovalReason, string> = {
  eaten: 'Eaten',
  removed: 'Remove',
}

// Units where a withdrawal is a continuous amount (0.5 l, 250 g) -> number
// field; anything else is a discrete count -> a quarter-step slider (½ an
// apple, whole eggs), since you also eat *part* of one piece.
const MEASURED_UNITS = new Set(['g', 'kg', 'ml', 'l'])

// Step the piece slider snaps to: quarters cover the realistic partials
// (¼ ½ ¾) and whole counts land exactly on integers.
const PIECE_STEP = 0.25

const QUARTER_GLYPH: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' }

// Render a quarter-step piece amount with fraction glyphs: 0.5 -> "½",
// 1.5 -> "1½", 2 -> "2".
function quarterLabel(q: number): string {
  const whole = Math.floor(q + 1e-9)
  const glyph = QUARTER_GLYPH[String(Math.round((q - whole) * 100) / 100)]
  if (glyph) return whole > 0 ? `${whole}${glyph}` : glyph
  return String(whole)
}

function formatAmount(q: number, unit: string | null): string {
  const n = Number.isInteger(q) ? q : Math.round(q * 100) / 100
  return `${n}${unit ? ` ${unit}` : ''}`
}

const QUANTITY_BASIS_ICON: Record<QuantityBasis, string> = {
  weighed: '⚖',
  piece: '≈',
  unknown: '?',
}

// How long a lot has sat in the basket (today − purchase date), the thing
// that matters here -- old stock is what you want to use up or clear. The
// exact purchase date lives on the Purchases page instead.
function daysInBasket(iso: string | null): string {
  if (!iso) return 'unknown age'
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'unknown age'
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  return `${days} day${days === 1 ? '' : 's'} in basket`
}

// The verified identity to show, never the raw parsed receipt text: the
// matched product ("Tomate roh"), else the fallback category, else -- only
// when nothing matched at all -- the parsed name as a last resort.
function displayName(item: PantryItem): string {
  if (item.matched_name) return item.matched_name
  if (item.fallback_category) return formatFallbackCategory(item.fallback_category)
  return item.name
}

export function BasketPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<LastAction | null>(null)

  function load() {
    return getPantry()
      .then((result) => {
        setState(
          result.items.length === 0
            ? { status: 'empty' }
            : { status: 'ready', items: result.items },
        )
      })
      .catch((err) => {
        setState({
          status: 'error',
          message: err instanceof ApiError ? err.message : 'Could not load your basket.',
        })
      })
  }

  useEffect(() => {
    void load()
  }, [])

  // A partial withdrawal can leave the lot with some amount still in stock,
  // so we reload rather than optimistically dropping the row -- the server's
  // remaining (after any clamping) is the source of truth.
  async function handleWithdraw(
    item: PantryItem,
    reason: PantryRemovalReason,
    quantity: number,
  ) {
    setActionError(null)
    try {
      const removal = await addPantryRemoval(item.id, reason, quantity)
      await load()
      setLastAction({
        removalId: removal.id,
        itemName: displayName(item),
        reason,
        appliedQuantity: removal.applied_quantity,
        unit: item.unit,
        clamped: removal.clamped,
      })
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : `Could not mark "${displayName(item)}" as ${reason}.`,
      )
    }
  }

  // Inline correction of a lot's displayed name / purchased quantity, via the
  // same receipt-item edit endpoint the Purchases page uses. Reloads so the
  // recomputed remaining + macros are the source of truth.
  async function handleEdit(item: PantryItem, fields: ItemUpdate) {
    setActionError(null)
    try {
      await updateReceiptItem(item.receipt_id, item.id, fields)
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not save that change.')
    }
  }

  async function handleUndo() {
    if (!lastAction) return
    const { removalId } = lastAction
    setActionError(null)
    setLastAction(null)
    try {
      await deletePantryRemoval(removalId)
      await load()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not undo that.')
    }
  }

  if (state.status === 'loading') {
    return (
      <section>
        <h1>Basket</h1>
        <p>Loading…</p>
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section>
        <h1>Basket</h1>
        <p className="form-error" role="alert">
          {state.message}
        </p>
      </section>
    )
  }

  const undoBanner = lastAction && (
    <p className="callout callout--muted" role="status">
      Marked {formatAmount(lastAction.appliedQuantity, lastAction.unit)} of “
      {lastAction.itemName}” as {REASON_VERB[lastAction.reason]}
      {lastAction.clamped ? ' (capped at what was left)' : ''}.{' '}
      <button type="button" className="btn-link" onClick={() => void handleUndo()}>
        Undo
      </button>
    </p>
  )

  if (state.status === 'empty') {
    return (
      <section>
        <h1>Basket</h1>
        {undoBanner}
        <p>
          Your basket is empty. It fills up as you <Link to="/upload">upload receipts</Link>,
          and empties as you mark things eaten or removed.
        </p>
      </section>
    )
  }

  return (
    <section>
      <h1>Basket</h1>
      <p>What you've bought and not yet used up. Mark a lot eaten or removed to clear it.</p>

      {undoBanner}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      <ul className="purchase-list">
        {state.items.map((item) => (
          <BasketRow
            key={item.id}
            item={item}
            onWithdraw={(reason, quantity) => void handleWithdraw(item, reason, quantity)}
            onEdit={(fields) => void handleEdit(item, fields)}
          />
        ))}
      </ul>
    </section>
  )
}

function formatGrams(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}g`
}

function BasketRow({
  item,
  onWithdraw,
  onEdit,
}: {
  item: PantryItem
  onWithdraw: (reason: PantryRemovalReason, quantity: number) => void
  onEdit: (fields: ItemUpdate) => void
}) {
  const match = matchInfo(item)
  const basis = quantityBasis(item)
  const measured = MEASURED_UNITS.has((item.unit ?? '').toLowerCase())
  const remaining = item.quantity ?? 1

  // Which withdrawal panel is open (eaten/removed), and the amount it will
  // withdraw -- pre-filled with the whole remaining so one open+confirm
  // clears the lot; adjust down for a partial (Vorrat.md §6.4).
  const [panel, setPanel] = useState<PantryRemovalReason | null>(null)
  const [amount, setAmount] = useState<number>(remaining)

  // Inline edits of the displayed name and the quantity.
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [editingQty, setEditingQty] = useState(false)
  const [qtyDraft, setQtyDraft] = useState('')

  function openPanel(reason: PantryRemovalReason) {
    setAmount(remaining)
    setPanel((cur) => (cur === reason ? null : reason))
  }

  function clampAmount(next: number): number {
    if (Number.isNaN(next)) return 0
    return Math.min(Math.max(next, 0), remaining)
  }

  function confirm() {
    if (panel && amount > 0) {
      onWithdraw(panel, amount)
      setPanel(null)
    }
  }

  function saveName() {
    const v = nameDraft.trim()
    if (v && v !== displayName(item)) onEdit({ matched_name: v })
    setEditingName(false)
  }

  function saveQty() {
    const n = Number(qtyDraft)
    if (!Number.isNaN(n) && n > 0 && n !== remaining) onEdit({ quantity: n })
    setEditingQty(false)
  }

  const partial = amount < remaining
  const amountLabel = measured
    ? formatAmount(amount, item.unit)
    : `${quarterLabel(amount)}${item.unit ? ` ${item.unit}` : ''}`

  const macrosLine = (
    <span className="basket-row__macros-sub">
      {item.calories_kcal !== null ? `${Math.round(item.calories_kcal)} kcal` : '—'} · P{' '}
      {formatGrams(item.protein_g)} · F {formatGrams(item.fat_g)} · C {formatGrams(item.carbs_g)}
    </span>
  )

  return (
    <li className="purchase-row basket-row">
      <div className="purchase-row__name-cell">
        {editingName ? (
          <span className="basket-row__edit">
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName()
                if (e.key === 'Escape') setEditingName(false)
              }}
              aria-label="Product name"
              autoFocus
            />
            <button type="button" className="basket-row__icon-btn" onClick={saveName} aria-label="Save name">
              ✓
            </button>
            <button
              type="button"
              className="basket-row__icon-btn"
              onClick={() => setEditingName(false)}
              aria-label="Cancel"
            >
              ✕
            </button>
          </span>
        ) : (
          <span className="basket-row__name-line">
            <span
              className={
                match?.lowConfidence
                  ? 'purchase-row__name review-row__match--warn'
                  : 'purchase-row__name'
              }
              title={match?.lowConfidence ? 'Category estimate, not a verified match' : undefined}
            >
              {match?.lowConfidence ? '~ ' : ''}
              {displayName(item)}
            </span>
            <button
              type="button"
              className="basket-row__icon-btn"
              onClick={() => {
                setNameDraft(displayName(item))
                setEditingName(true)
              }}
              aria-label="Edit name"
              title="Edit name"
            >
              ✎
            </button>
          </span>
        )}
        {macrosLine}
      </div>
      <span className="purchase-row__qty">
        {editingQty ? (
          <span className="basket-row__edit">
            <input
              type="number"
              min={0}
              step="any"
              value={qtyDraft}
              onChange={(e) => setQtyDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveQty()
                if (e.key === 'Escape') setEditingQty(false)
              }}
              aria-label="Quantity"
              autoFocus
            />
            <span className="muted">{item.unit}</span>
            <button type="button" className="basket-row__icon-btn" onClick={saveQty} aria-label="Save quantity">
              ✓
            </button>
            <button
              type="button"
              className="basket-row__icon-btn"
              onClick={() => setEditingQty(false)}
              aria-label="Cancel"
            >
              ✕
            </button>
          </span>
        ) : (
          <>
            {formatAmount(remaining, item.unit)}
            <span
              className={`qty-basis qty-basis--${basis}`}
              title={QUANTITY_BASIS_LABEL[basis]}
              aria-label={QUANTITY_BASIS_LABEL[basis]}
            >
              {QUANTITY_BASIS_ICON[basis]}
            </span>
            <button
              type="button"
              className="basket-row__icon-btn"
              onClick={() => {
                setQtyDraft(String(remaining))
                setEditingQty(true)
              }}
              aria-label="Edit quantity"
              title="Edit quantity"
            >
              ✎
            </button>
            <span className="muted"> · {daysInBasket(item.purchased_at)}</span>
          </>
        )}
      </span>
      <div className="basket-row__actions">
        <button
          type="button"
          className={panel === 'eaten' ? 'btn-secondary btn-secondary--active' : 'btn-secondary'}
          onClick={() => openPanel('eaten')}
        >
          Eaten
        </button>
        <button
          type="button"
          className="btn-link basket-row__remove"
          onClick={() => openPanel('removed')}
          aria-label="Remove"
          title="Remove (not eaten — spoiled, given away, miscan)"
        >
          ✕
        </button>
      </div>

      {panel && (
        <div className="basket-row__panel">
          <span className="basket-row__panel-label">
            How much {REASON_VERB[panel]}?
          </span>
          {measured ? (
            <div className="basket-row__amount">
              <input
                type="number"
                min={0}
                max={remaining}
                step="any"
                value={amount}
                onChange={(e) => setAmount(clampAmount(Number(e.target.value)))}
                aria-label={`Amount ${REASON_VERB[panel]} (${item.unit ?? ''})`}
              />
              <span className="muted">{item.unit}</span>
              {partial && (
                <button type="button" className="btn-link" onClick={() => setAmount(remaining)}>
                  All ({formatAmount(remaining, item.unit)})
                </button>
              )}
            </div>
          ) : (
            <div className="basket-row__slider">
              <input
                type="range"
                min={0}
                max={remaining}
                step={PIECE_STEP}
                value={amount}
                onChange={(e) => setAmount(clampAmount(Number(e.target.value)))}
                aria-label={`Amount ${REASON_VERB[panel]}`}
              />
              <span className="basket-row__slider-value">{amountLabel}</span>
            </div>
          )}
          <div className="basket-row__panel-actions">
            <button type="button" className="btn-secondary" onClick={confirm} disabled={amount <= 0}>
              {REASON_CONFIRM[panel]}
              {partial ? ` ${amountLabel}` : ' all'}
            </button>
            <button type="button" className="btn-link" onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
