import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  addPantryRemoval,
  ApiError,
  deletePantryRemoval,
  getPantry,
  type PantryItem,
  type PantryRemoval,
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

// What the last action removed, so it can be undone (deletes the ledger row
// -> the lot reappears). Only the most recent action is undoable; anything
// older is a fresh page reload away.
type LastAction = { removal: PantryRemoval; item: PantryItem; reason: PantryRemovalReason }

const REASON_VERB: Record<PantryRemovalReason, string> = {
  eaten: 'eaten',
  removed: 'removed',
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

function byNewest(a: PantryItem, b: PantryItem): number {
  return (b.purchased_at ?? '').localeCompare(a.purchased_at ?? '')
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

  // Optimistic: drop the lot from the list immediately, then record the
  // ledger row for undo. On failure, put it back and surface the error.
  async function handleRemoval(item: PantryItem, reason: PantryRemovalReason) {
    setActionError(null)
    setState((prev) =>
      prev.status === 'ready'
        ? { status: 'ready', items: prev.items.filter((i) => i.id !== item.id) }
        : prev,
    )
    try {
      const removal = await addPantryRemoval(item.id, reason)
      setLastAction({ removal, item, reason })
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : `Could not mark "${item.name}" as ${reason}.`,
      )
      setLastAction(null)
      await load()
    }
  }

  async function handleUndo() {
    if (!lastAction) return
    const { removal, item } = lastAction
    setActionError(null)
    setLastAction(null)
    try {
      await deletePantryRemoval(removal.id)
      setState((prev) =>
        prev.status === 'ready'
          ? { status: 'ready', items: [...prev.items, item].sort(byNewest) }
          : { status: 'ready', items: [item] },
      )
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not undo that.')
      await load()
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
      Marked “{lastAction.item.name}” as {REASON_VERB[lastAction.reason]}.{' '}
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
            onEaten={() => void handleRemoval(item, 'eaten')}
            onRemoved={() => void handleRemoval(item, 'removed')}
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
  onEaten,
  onRemoved,
}: {
  item: PantryItem
  onEaten: () => void
  onRemoved: () => void
}) {
  const match = matchInfo(item)
  const basis = quantityBasis(item)

  return (
    <li className="purchase-row basket-row">
      <div className="purchase-row__name-cell">
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
      </div>
      <span className="purchase-row__qty">
        {item.quantity ?? '—'} {item.unit ?? ''}
        <span
          className={`qty-basis qty-basis--${basis}`}
          title={QUANTITY_BASIS_LABEL[basis]}
          aria-label={QUANTITY_BASIS_LABEL[basis]}
        >
          {QUANTITY_BASIS_ICON[basis]}
        </span>
        <span className="muted"> · {daysInBasket(item.purchased_at)}</span>
      </span>
      <span className="purchase-row__macros">
        {item.calories_kcal !== null ? `${Math.round(item.calories_kcal)} kcal` : '—'} · P{' '}
        {formatGrams(item.protein_g)} · F {formatGrams(item.fat_g)} · C{' '}
        {formatGrams(item.carbs_g)}
      </span>
      <div className="basket-row__actions">
        <button type="button" className="btn-secondary" onClick={onEaten}>
          Eaten
        </button>
        <button
          type="button"
          className="btn-link basket-row__remove"
          onClick={onRemoved}
          aria-label="Remove"
          title="Remove (not eaten — spoiled, given away, miscan)"
        >
          ✕
        </button>
      </div>
    </li>
  )
}
