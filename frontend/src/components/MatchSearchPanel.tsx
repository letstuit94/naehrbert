import { useEffect, useState } from 'react'
import {
  rejectCandidate,
  searchCandidates,
  type CandidatesResponse,
  type ItemCorrection,
  type MatchCandidate,
} from '../lib/api'

// Search OFF/BLS for a manual pick and record it as a correction (Epic 4.2).
// Shared between the Upload review screen (ReviewRow, pre-confirm) and the
// Purchases page (post-confirm editing) -- only `id`/`name` are needed to
// drive the search, so this takes the narrowest shape that fits both
// ReceiptItem and PurchaseItem rather than requiring either full type.
function formatMacro(value: number | null): string {
  return value === null ? '?' : String(Math.round(value))
}

const SOURCE_LABEL: Record<MatchCandidate['source'], string> = {
  off: 'Packaged products (Open Food Facts)',
  bls: 'Generic foods (BLS)',
}

const SOURCE_EMPTY: Record<MatchCandidate['source'], string> = {
  off: 'No good Open Food Facts match found for this text.',
  bls: 'No good BLS match found for this text.',
}

const OFF_RATE_LIMITED_NOTE =
  "Open Food Facts search has hit its rate limit right now, so this may not be the full picture — try again in a moment."

/** One source's top-3 list, each row offering "Use this" or "X" (not a
 * match -- dismiss and let the next-ranked candidate backfill it). Shared
 * by MatchSearchPanel and AddItemPanel so both get identical treatment.
 * `offRateLimited` (only meaningful for source="off") shows a distinct
 * "couldn't ask OFF right now" note instead of implying there's no match. */
export function CandidateSection({
  source,
  candidates,
  onPick,
  onReject,
  rejecting,
  offRateLimited = false,
}: {
  source: MatchCandidate['source']
  candidates: MatchCandidate[]
  onPick: (candidate: MatchCandidate) => void
  onReject: (candidate: MatchCandidate) => void
  rejecting: string | null
  offRateLimited?: boolean
}) {
  const showRateLimitNote = source === 'off' && offRateLimited && candidates.length === 0

  return (
    <div className="candidate-section">
      <h4 className="candidate-section__title">{SOURCE_LABEL[source]}</h4>
      {showRateLimitNote && <p className="callout callout--warning">{OFF_RATE_LIMITED_NOTE}</p>}
      {candidates.length === 0 && !showRateLimitNote ? (
        <p className="muted">{SOURCE_EMPTY[source]}</p>
      ) : candidates.length > 0 ? (
        <ul className="candidate-list">
          {candidates.map((c, i) => {
            const key = c.off_id ?? c.bls_code ?? String(i)
            return (
              <li key={key} className="candidate-row">
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
                <button type="button" className="btn-link" onClick={() => onPick(c)}>
                  Use this
                </button>
                <button
                  type="button"
                  className="candidate-row__reject"
                  onClick={() => onReject(c)}
                  disabled={rejecting === key}
                  aria-label={`Not a match: ${c.matched_name}`}
                  title="Not a match"
                >
                  ×
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
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
  const [candidates, setCandidates] = useState<CandidatesResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function runSearch() {
    if (!query.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await searchCandidates(receiptId, item.id, query.trim())
      setCandidates(result)
    } catch {
      setError('Search failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // Always show top matches as soon as the panel opens, not gated behind
  // an extra click -- the query box + Search button below remain for
  // re-querying with different text.
  useEffect(() => {
    void runSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function pick(candidate: MatchCandidate) {
    onCorrect({
      matched_name: candidate.matched_name,
      off_id: candidate.source === 'off' ? candidate.off_id : null,
      bls_code: candidate.source === 'bls' ? (candidate.bls_code ?? null) : null,
      nutrition: candidate.nutrition,
    })
    onClose()
  }

  async function reject(candidate: MatchCandidate) {
    const key = candidate.off_id ?? candidate.bls_code ?? ''
    setRejecting(key)
    setError(null)
    try {
      await rejectCandidate(receiptId, item.id, query.trim(), candidate)
      await runSearch()
    } catch {
      setError('Could not dismiss that candidate. Please try again.')
    } finally {
      setRejecting(null)
    }
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
      {candidates && (
        <>
          <CandidateSection
            source="off"
            candidates={candidates.off}
            onPick={pick}
            onReject={reject}
            rejecting={rejecting}
            offRateLimited={candidates.off_rate_limited}
          />
          <CandidateSection
            source="bls"
            candidates={candidates.bls}
            onPick={pick}
            onReject={reject}
            rejecting={rejecting}
          />
        </>
      )}
    </div>
  )
}
