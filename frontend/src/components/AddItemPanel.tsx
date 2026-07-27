import { useState } from 'react'
import {
  ApiError,
  createPantryItem,
  searchMatchCandidates,
  type ManualItemMatch,
  type MatchCandidate,
} from '../lib/api'

// Units offered for a manual add: the mass/volume amounts (g/kg/ml/l) plus a
// discrete piece count -- same list the Purchases edit form uses.
const UNIT_OPTIONS = ['g', 'kg', 'ml', 'l', 'piece'] as const

function formatMacro(value: number | null): string {
  return value === null ? '?' : String(Math.round(value))
}

// Manually add a food to the basket (Vorrat.md): a name (optionally pinned to
// an OFF/BLS product via the same fix-match search used elsewhere) plus an
// amount + unit. On success the parent reloads the pantry, so the new lot
// shows up in the basket (and the Purchases view) right away.
export function AddItemPanel({
  onAdded,
  onClose,
}: {
  onAdded: () => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState<string>('piece')

  // A picked fix-match (verified name + nutrition). null = free-text name,
  // the server resolves nutrition from it on save.
  const [picked, setPicked] = useState<ManualItemMatch | null>(null)

  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runSearch() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await searchMatchCandidates(name.trim())
      setCandidates(result.candidates)
    } catch {
      setError('Search failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function pick(candidate: MatchCandidate) {
    setName(candidate.matched_name)
    setPicked({
      matched_name: candidate.matched_name,
      off_id: candidate.source === 'off' ? candidate.off_id : null,
      bls_code: candidate.source === 'bls' ? (candidate.bls_code ?? null) : null,
      nutrition: candidate.nutrition,
    })
    setSearching(false)
    setCandidates(null)
  }

  // Editing the name after a pick means it no longer describes that product,
  // so drop the pinned match and fall back to name-resolution.
  function editName(value: string) {
    setName(value)
    if (picked) setPicked(null)
  }

  async function submit() {
    // A picked search result is required -- a manual add must be a verified
    // product, not free text (so its nutrition is trustworthy). The button
    // stays enabled so the click surfaces this as a message rather than a
    // silently dead button.
    if (!picked) {
      setError('Please search for the product first.')
      return
    }
    const qty = Number(quantity)
    if (Number.isNaN(qty) || qty <= 0) {
      setError('Please enter a valid quantity.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createPantryItem({
        name: name.trim() || picked.matched_name,
        quantity: qty,
        unit,
        match: picked,
      })
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add that item.')
      setBusy(false)
    }
  }

  return (
    <div className="add-item-panel match-search">
      {/* Product name + amount + unit on one line, like a receipt line item. */}
      <div className="add-item-panel__line">
        <div className="add-item-panel__group add-item-panel__group--name">
          <label className="add-item-panel__label" htmlFor="add-item-name">
            Product name
          </label>
          <input
            id="add-item-name"
            value={name}
            placeholder="e.g. Banane"
            onChange={(e) => editName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch()}
            autoFocus
          />
        </div>
        <div className="add-item-panel__group">
          <label className="add-item-panel__label" htmlFor="add-item-qty">
            Quantity
          </label>
          <input
            id="add-item-qty"
            type="number"
            min={0}
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="add-item-panel__qty"
          />
        </div>
        <div className="add-item-panel__group">
          <label className="add-item-panel__label" htmlFor="add-item-unit">
            Unit
          </label>
          <select
            id="add-item-unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          >
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setSearching(true)
            void runSearch()
          }}
          disabled={!name.trim() || busy}
          title="Search OpenFoodFacts / BLS for this product"
        >
          🔍 Search product
        </button>
        {/* Before a product is selected there's no "Add to basket" yet, so
            Cancel lives next to the search button. */}
        {!picked && (
          <button type="button" className="btn-link" onClick={onClose}>
            Cancel
          </button>
        )}
      </div>

      {picked && (
        <p className="add-item-panel__picked" role="status">
          ✓ Selected <strong>{picked.matched_name}</strong> (
          {formatMacro(picked.nutrition.calories_kcal)} kcal / 100g).{' '}
          <button type="button" className="btn-link" onClick={() => setPicked(null)}>
            Change
          </button>
        </p>
      )}

      {searching && !picked && (
        <>
          {busy && <p className="muted">Searching…</p>}
          {candidates && candidates.length === 0 && (
            <p className="muted">No candidates with complete macro data found.</p>
          )}
          {candidates && candidates.length > 0 && (
            <ul className="candidate-list">
              {candidates.map((c, i) => (
                <li
                  key={`${c.source}-${c.off_id ?? c.bls_code ?? i}`}
                  className="candidate-row"
                >
                  <div className="candidate-row__main">
                    <span className="candidate-row__source">
                      {c.source === 'off' ? 'OFF' : 'BLS'}
                    </span>
                    <span className="candidate-row__name">{c.matched_name}</span>
                  </div>
                  <span className="candidate-row__macros">
                    {formatMacro(c.nutrition.calories_kcal)} kcal · P{' '}
                    {formatMacro(c.nutrition.protein_g)}g · F{' '}
                    {formatMacro(c.nutrition.fat_g)}g · C{' '}
                    {formatMacro(c.nutrition.carbs_g)}g
                  </span>
                  <button type="button" className="btn-link" onClick={() => pick(c)}>
                    Select
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {/* "Add to basket" only appears once a search result is selected. */}
      {picked && (
        <div className="add-item-panel__actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            Add to basket
          </button>
          <button type="button" className="btn-link" onClick={onClose}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
