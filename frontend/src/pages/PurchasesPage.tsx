import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, getPurchases, type PurchaseItem } from '../lib/api'
import { matchInfo } from '../lib/matchInfo'

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

function formatDate(iso: string | null): string {
  if (!iso) return 'Unknown date'
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

export function PurchasesPage() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    getPurchases()
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
          message:
            err instanceof ApiError ? err.message : 'Could not load your purchases.',
        })
      })
  }, [])

  if (state.status === 'loading') {
    return (
      <section>
        <h1>Purchases</h1>
        <p>Loading…</p>
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section>
        <h1>Purchases</h1>
        <p className="form-error" role="alert">
          {state.message}
        </p>
      </section>
    )
  }

  if (state.status === 'empty') {
    return (
      <section>
        <h1>Purchases</h1>
        <p>
          No confirmed receipts yet. <Link to="/upload">Upload one</Link> to see your
          purchases here.
        </p>
      </section>
    )
  }

  const groups = groupByReceipt(state.items)

  return (
    <section>
      <h1>Purchases</h1>
      <p>Everything you've uploaded and confirmed, grouped by receipt.</p>

      {groups.map((group) => (
        <div key={group.receiptId} className="purchase-group">
          <h2 className="purchase-group__header">
            {group.store ?? 'Unknown store'}{' '}
            <span className="muted">· {formatDate(group.purchasedAt)}</span>
          </h2>
          <ul className="purchase-list">
            {group.items.map((item) => (
              <PurchaseRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function PurchaseRow({ item }: { item: PurchaseItem }) {
  const match = matchInfo(item)
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
      </div>
      <span className="purchase-row__qty">
        {item.quantity ?? '—'} {item.unit ?? ''}
      </span>
      {item.is_non_food ? (
        <span className="purchase-row__nonfood muted">Not food</span>
      ) : (
        <span className="purchase-row__macros">
          {item.calories_kcal !== null ? `${Math.round(item.calories_kcal)} kcal` : '—'} ·
          P {formatGrams(item.protein_g)} · F {formatGrams(item.fat_g)} · C{' '}
          {formatGrams(item.carbs_g)}
        </span>
      )}
    </li>
  )
}
