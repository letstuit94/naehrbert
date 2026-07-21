import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  confirmReceipt,
  correctReceiptItem,
  deleteReceiptItem,
  searchCandidates,
  updateReceiptItem,
  uploadReceiptFile,
  uploadReceiptText,
  type ConfirmResponse,
  type ItemCorrection,
  type MatchCandidate,
  type Receipt,
  type ReceiptItem,
} from '../lib/api'
import { matchInfo } from '../lib/matchInfo'

const UNIT_OPTIONS = ['g', 'kg', 'ml', 'l', 'piece'] as const

type Screen = 'upload' | 'review' | 'confirmed'

export function UploadPage() {
  const [screen, setScreen] = useState<Screen>('upload')
  const [uploadMode, setUploadMode] = useState<'file' | 'text'>('file')
  const [pastedText, setPastedText] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [items, setItems] = useState<ReceiptItem[]>([])
  const [confirmResult, setConfirmResult] = useState<ConfirmResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setScreen('upload')
    setReceipt(null)
    setItems([])
    setConfirmResult(null)
    setPastedText('')
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Escape hatch for a bad scan (US 3.4 follow-up): drops back to the paste-
  // text tab, pre-filled with whatever raw text OCR did manage to read --
  // even a badly garbled extraction usually has a few readable fragments,
  // so starting from that beats a blank textarea. The abandoned receipt
  // row is left unconfirmed in the DB (harmless: unconfirmed receipts are
  // excluded from every analysis query) rather than added ceremony to delete it.
  function switchToManualEntry() {
    setScreen('upload')
    setUploadMode('text')
    setPastedText(receipt?.raw_text ?? '')
    setReceipt(null)
    setItems([])
    setConfirmResult(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const result = await uploadReceiptFile(file)
      setReceipt(result.receipt)
      setItems(result.items)
      setScreen('review')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not read that receipt. Please try another file.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handlePasteSubmit() {
    if (!pastedText.trim()) return
    setBusy(true)
    setError(null)
    try {
      const result = await uploadReceiptText(pastedText)
      setReceipt(result.receipt)
      setItems(result.items)
      setScreen('review')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not parse that text.')
    } finally {
      setBusy(false)
    }
  }

  async function handleFieldSave(itemId: string, fields: Partial<ReceiptItem>) {
    if (!receipt) return
    try {
      const updated = await updateReceiptItem(receipt.id, itemId, fields)
      setItems((prev) => prev.map((it) => (it.id === itemId ? updated : it)))
    } catch {
      setError('Could not save that change.')
    }
  }

  async function handleCorrect(itemId: string, correction: ItemCorrection) {
    if (!receipt) return
    try {
      const updated = await correctReceiptItem(receipt.id, itemId, correction)
      setItems((prev) => prev.map((it) => (it.id === itemId ? updated : it)))
    } catch {
      setError('Could not save that match.')
    }
  }

  async function handleDelete(itemId: string) {
    if (!receipt) return
    try {
      await deleteReceiptItem(receipt.id, itemId)
      setItems((prev) => prev.filter((it) => it.id !== itemId))
    } catch {
      setError('Could not delete that item.')
    }
  }

  async function handleConfirm() {
    if (!receipt) return
    setBusy(true)
    setError(null)
    try {
      const result = await confirmReceipt(receipt.id)
      setConfirmResult(result)
      setScreen('confirmed')
    } catch {
      setError('Could not finalize this receipt. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (screen === 'confirmed' && confirmResult) {
    const q = confirmResult.match_quality
    return (
      <section>
        <h1>Receipt confirmed</h1>
        <p className="callout callout--success">
          Saved {confirmResult.items.length} item
          {confirmResult.items.length === 1 ? '' : 's'}.
        </p>
        {q && (
          <p>
            {q.matched_items} of {q.total_items} items matched confidently
            {q.fallback_items > 0 && `, ${q.fallback_items} estimated from category`}
            {q.failed_items > 0 && `, ${q.failed_items} could not be matched`}.
          </p>
        )}
        <p>
          <Link to="/results">See your results →</Link> ·{' '}
          <button className="btn-link" onClick={reset}>
            Upload another receipt
          </button>
        </p>
      </section>
    )
  }

  if (screen === 'review' && receipt) {
    const scanLooksIncomplete = items.length <= 1
    return (
      <section>
        <h1>Review your receipt</h1>
        <p>Fix anything the scan got wrong, mark non-food items, then confirm.</p>

        {scanLooksIncomplete ? (
          <p className="callout callout--warning">
            {items.length === 0
              ? "We couldn't find any items on this scan."
              : `We only found ${items.length} item on this scan.`}{' '}
            If that doesn't look right, you can{' '}
            <button type="button" className="btn-link" onClick={switchToManualEntry}>
              switch to typing it in manually
            </button>
            .
          </p>
        ) : (
          <p className="muted">
            Scan doesn't look right?{' '}
            <button type="button" className="btn-link" onClick={switchToManualEntry}>
              Switch to manual entry
            </button>
          </p>
        )}

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <ul className="review-list">
          {items.map((item) => (
            <ReviewRow
              key={item.id}
              receiptId={receipt.id}
              item={item}
              onSave={(fields) => handleFieldSave(item.id, fields)}
              onDelete={() => handleDelete(item.id)}
              onCorrect={(correction) => handleCorrect(item.id, correction)}
            />
          ))}
        </ul>
        {items.length === 0 && <p>No items left -- delete was maybe too enthusiastic?</p>}

        <button
          className="btn btn-primary"
          onClick={handleConfirm}
          disabled={busy || items.length === 0}
        >
          {busy ? 'Confirming…' : 'Confirm & save'}
        </button>
      </section>
    )
  }

  return (
    <section>
      <h1>Upload a receipt</h1>
      <div className="tab-row">
        <button
          className={uploadMode === 'file' ? 'tab tab--active' : 'tab'}
          onClick={() => setUploadMode('file')}
        >
          Photo / PDF
        </button>
        <button
          className={uploadMode === 'text' ? 'tab tab--active' : 'tab'}
          onClick={() => setUploadMode('text')}
        >
          Paste text
        </button>
      </div>

      {uploadMode === 'file' ? (
        <div className="form-field">
          <label htmlFor="receipt-file">Receipt photo or PDF</label>
          <input
            id="receipt-file"
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            capture="environment"
            onChange={handleFileChange}
            disabled={busy}
          />
        </div>
      ) : (
        <div className="form-field">
          <label htmlFor="receipt-text">Pasted receipt text</label>
          <textarea
            id="receipt-text"
            rows={8}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            disabled={busy}
          />
          <button
            className="btn btn-primary"
            onClick={handlePasteSubmit}
            disabled={busy || !pastedText.trim()}
          >
            {busy ? 'Parsing…' : 'Parse text'}
          </button>
        </div>
      )}

      {busy && uploadMode === 'file' && <p>Reading your receipt…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function ReviewRow({
  item,
  receiptId,
  onSave,
  onDelete,
  onCorrect,
}: {
  item: ReceiptItem
  receiptId: string
  onSave: (fields: Partial<ReceiptItem>) => void
  onDelete: () => void
  onCorrect: (correction: ItemCorrection) => void
}) {
  const [name, setName] = useState(item.name)
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [unit, setUnit] = useState(item.unit)
  const [searching, setSearching] = useState(false)
  const match = matchInfo(item)

  return (
    <li className={item.is_non_food ? 'review-row review-row--non-food' : 'review-row'}>
      <div className="review-row__name-cell">
        <input
          className="review-row__name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== item.name && onSave({ name })}
          aria-label="Item name"
        />
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
        {!item.is_non_food && (
          <button
            type="button"
            className="btn-link review-row__fix-match"
            onClick={() => setSearching((s) => !s)}
          >
            {searching ? 'Cancel search' : 'Fix match'}
          </button>
        )}
      </div>
      <input
        className="review-row__qty"
        type="number"
        min={0}
        step="any"
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        onBlur={() =>
          Number(quantity) !== item.quantity && onSave({ quantity: Number(quantity) })
        }
        aria-label="Quantity"
      />
      <select
        className="review-row__unit"
        value={unit}
        onChange={(e) => {
          setUnit(e.target.value)
          onSave({ unit: e.target.value })
        }}
        aria-label="Unit"
      >
        {UNIT_OPTIONS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <label className="review-row__nonfood">
        <input
          type="checkbox"
          checked={item.is_non_food}
          onChange={(e) => onSave({ is_non_food: e.target.checked })}
        />
        Not food
      </label>
      <button className="btn-icon" onClick={onDelete} aria-label={`Delete ${item.name}`}>
        Delete
      </button>
      {searching && (
        <div className="review-row__search-panel">
          <MatchSearchPanel
            item={item}
            receiptId={receiptId}
            onCorrect={onCorrect}
            onClose={() => setSearching(false)}
          />
        </div>
      )}
    </li>
  )
}

function formatMacro(value: number | null): string {
  return value === null ? '?' : String(Math.round(value))
}

function MatchSearchPanel({
  item,
  receiptId,
  onCorrect,
  onClose,
}: {
  item: ReceiptItem
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
