import { useState } from 'react'
import { searchCandidates, type ItemCorrection, type MatchCandidate } from '../lib/api'

// Search OFF/BLS for a manual pick and record it as a correction (Epic 4.2).
// Shared between the Upload review screen (ReviewRow, pre-confirm) and the
// Purchases page (post-confirm editing) -- only `id`/`name` are needed to
// drive the search, so this takes the narrowest shape that fits both
// ReceiptItem and PurchaseItem rather than requiring either full type.
function formatMacro(value: number | null): string {
  return value === null ? '?' : String(Math.round(value))
}

export function MatchSearchPanel({
  item,
  receiptId,
  onCorrect,
  onClose,
}: {
  item: { id: string; name: string }
  receiptId: string
  onCorrect: (correction: ItemCorrection) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState(item.name)
  const [candidates, setCandidates] = useState<MatchCandidate[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runSearch() {
    if (!query.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await searchCandidates(receiptId, item.id, query.trim())
      setCandidates(result.candidates)
    } catch {
      setError('Search failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function pick(candidate: MatchCandidate) {
    onCorrect({
      matched_name: candidate.matched_name,
      off_id: candidate.source === 'off' ? candidate.off_id : null,
      bls_code: candidate.source === 'bls' ? (candidate.bls_code ?? null) : null,
      nutrition: candidate.nutrition,
    })
    onClose()
  }

  return (
    <div className="match-search">
      <div className="chat-input-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          aria-label="Search OFF/BLS"
          autoFocus
        />
        <button
          type="button"
          className="btn btn-primary"
          onClick={runSearch}
          disabled={busy || !query.trim()}
        >
          {busy ? 'Searching…' : 'Search'}
        </button>
        <button type="button" className="btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
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
                {formatMacro(c.nutrition.protein_g)}g · F {formatMacro(c.nutrition.fat_g)}
                g · C {formatMacro(c.nutrition.carbs_g)}g
              </span>
              <button type="button" className="btn-link" onClick={() => pick(c)}>
                Use this
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
