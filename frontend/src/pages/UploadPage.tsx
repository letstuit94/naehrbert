import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  confirmReceipt,
  correctReceiptItem,
  deleteReceiptItem,
  updateReceiptItem,
  uploadReceiptFile,
  uploadReceiptText,
  type ConfirmResponse,
  type ItemCorrection,
  type Receipt,
  type ReceiptItem,
} from '../lib/api'
import { matchInfo } from '../lib/matchInfo'
import { MatchSearchPanel } from '../components/MatchSearchPanel'

const UNIT_OPTIONS = ['g', 'kg', 'ml', 'l', 'piece'] as const

type Screen = 'upload' | 'review' | 'confirmed'

// Upload+match happens in one synchronous backend call, so there's no real
// per-step signal to show -- these are timed to roughly track the actual
// phases (OCR/text-layer read, parsing, then matching, which is the long
// and variable tail: every not-yet-known product costs a live
// OpenFoodFacts lookup, see backend/app/api/receipts.py's
// _resolve_concurrently) so the user sees *something* happening rather
// than a single frozen "Reading your receipt..." line for up to a minute.
// Pasted text skips OCR entirely, so it gets its own shorter step list
// rather than awkwardly skipping into the middle of the file-mode one.
const FILE_PROGRESS_STEPS = [
  'Reading your receipt…',
  'Extracting the text…',
  'Parsing the items…',
  'Matching your items against our food database…',
] as const
const FILE_PROGRESS_DELAYS_MS = [1200, 3000, 5000]

const TEXT_PROGRESS_STEPS = [
  'Parsing the items…',
  'Matching your items against our food database…',
] as const
const TEXT_PROGRESS_DELAYS_MS = [1000]

const LONGER_NOTE_DELAY_MS = 15000
const LONGER_NOTE = 'New or unusual products can take a little longer to match…'

export function UploadPage() {
  const [screen, setScreen] = useState<Screen>('upload')
  const [uploadMode, setUploadMode] = useState<'file' | 'text'>('file')
  const [pastedText, setPastedText] = useState('')
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const [items, setItems] = useState<ReceiptItem[]>([])
  const [confirmResult, setConfirmResult] = useState<ConfirmResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progressSteps, setProgressSteps] =
    useState<readonly string[]>(FILE_PROGRESS_STEPS)
  const [progressStep, setProgressStep] = useState(0)
  const [showLongerNote, setShowLongerNote] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const progressTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  function startProgress(steps: readonly string[], delaysMs: number[]) {
    setProgressSteps(steps)
    setProgressStep(0)
    setShowLongerNote(false)
    progressTimersRef.current.forEach(clearTimeout)
    progressTimersRef.current = [
      ...delaysMs.map((delay, i) => setTimeout(() => setProgressStep(i + 1), delay)),
      setTimeout(() => setShowLongerNote(true), LONGER_NOTE_DELAY_MS),
    ]
  }

  function stopProgress() {
    progressTimersRef.current.forEach(clearTimeout)
    progressTimersRef.current = []
  }

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
    startProgress(FILE_PROGRESS_STEPS, FILE_PROGRESS_DELAYS_MS)
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
      stopProgress()
    }
  }

  async function handlePasteSubmit() {
    if (!pastedText.trim()) return
    setBusy(true)
    setError(null)
    startProgress(TEXT_PROGRESS_STEPS, TEXT_PROGRESS_DELAYS_MS)
    try {
      const result = await uploadReceiptText(pastedText)
      setReceipt(result.receipt)
      setItems(result.items)
      setScreen('review')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not parse that text.')
    } finally {
      setBusy(false)
      stopProgress()
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

      {busy && (
        <div className="upload-progress">
          <ul className="upload-progress__steps">
            {progressSteps.map((label, i) => (
              <li
                key={label}
                className={
                  i < progressStep
                    ? 'upload-progress__step upload-progress__step--done'
                    : i === progressStep
                      ? 'upload-progress__step upload-progress__step--active'
                      : 'upload-progress__step upload-progress__step--pending'
                }
              >
                <span className="upload-progress__marker" aria-hidden>
                  {i < progressStep ? '✓' : i === progressStep ? '…' : '·'}
                </span>
                {label}
              </li>
            ))}
          </ul>
          {showLongerNote && <p className="muted upload-progress__note">{LONGER_NOTE}</p>}
        </div>
      )}
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
