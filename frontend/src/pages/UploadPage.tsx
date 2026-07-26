import { useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
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

type Screen = 'upload' | 'uploading' | 'review' | 'confirmed'

interface ReceiptData {
  receipt: Receipt
  items: ReceiptItem[]
}

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

/** "Purchase from {date} at {store}" (or just the date if the store
 * couldn't be identified) above the review list -- omitted entirely when
 * even the date wasn't found, since "at {store}" alone with no date reads
 * like a fragment rather than a useful fact. */
function purchaseInfoLine(receipt: Receipt): string | null {
  if (!receipt.purchased_at) return null
  const date = new Date(`${receipt.purchased_at}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const store = receipt.store && receipt.store !== 'unknown' ? receipt.store : null
  return store ? `Purchase from ${date} at ${store}` : `Purchase from ${date}`
}

function UploadArrowIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </svg>
  )
}

export function UploadPage() {
  const [screen, setScreen] = useState<Screen>('upload')
  const [uploadMode, setUploadMode] = useState<'file' | 'text'>('file')
  const [pastedText, setPastedText] = useState('')
  const [receiptsData, setReceiptsData] = useState<ReceiptData[]>([])
  const [reviewIndex, setReviewIndex] = useState(0)
  const [confirmResults, setConfirmResults] = useState<ConfirmResponse[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [currentFileName, setCurrentFileName] = useState('')
  const [fileProgress, setFileProgress] = useState({ index: 0, total: 0 })
  const [progressSteps, setProgressSteps] =
    useState<readonly string[]>(FILE_PROGRESS_STEPS)
  const [progressStep, setProgressStep] = useState(0)
  const [showLongerNote, setShowLongerNote] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const progressTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const current = receiptsData[reviewIndex] as ReceiptData | undefined

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
    setReceiptsData([])
    setReviewIndex(0)
    setConfirmResults([])
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
  // Bails out of the whole batch, not just the current receipt -- a
  // multi-file upload with one bad scan is rare enough that re-uploading
  // the good ones again is a fair trade for keeping this simple.
  function switchToManualEntry() {
    setScreen('upload')
    setUploadMode('text')
    setPastedText(current?.receipt.raw_text ?? '')
    setReceiptsData([])
    setReviewIndex(0)
    setConfirmResults([])
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function processFiles(files: File[]) {
    if (!files.length) return
    setBusy(true)
    setError(null)
    setScreen('uploading')

    const results: ReceiptData[] = []
    const failures: string[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setCurrentFileName(file.name)
      setFileProgress({ index: i, total: files.length })
      startProgress(FILE_PROGRESS_STEPS, FILE_PROGRESS_DELAYS_MS)
      try {
        const result = await uploadReceiptFile(file)
        results.push({ receipt: result.receipt, items: result.items })
      } catch (err) {
        failures.push(
          `${file.name} (${err instanceof ApiError ? err.message : 'could not be read'})`,
        )
      } finally {
        stopProgress()
      }
    }

    setBusy(false)
    if (results.length) {
      setReceiptsData(results)
      setReviewIndex(0)
      setScreen('review')
      setError(failures.length ? `Could not read: ${failures.join(', ')}.` : null)
    } else {
      setScreen('upload')
      setError('Could not read any of those files. Please try another.')
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    await processFiles(Array.from(event.target.files ?? []))
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragOver(false)
    void processFiles(Array.from(event.dataTransfer.files ?? []))
  }

  async function handlePasteSubmit() {
    if (!pastedText.trim()) return
    setBusy(true)
    setError(null)
    startProgress(TEXT_PROGRESS_STEPS, TEXT_PROGRESS_DELAYS_MS)
    try {
      const result = await uploadReceiptText(pastedText)
      setReceiptsData([{ receipt: result.receipt, items: result.items }])
      setReviewIndex(0)
      setScreen('review')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not parse that text.')
    } finally {
      setBusy(false)
      stopProgress()
    }
  }

  function updateCurrentItems(updater: (items: ReceiptItem[]) => ReceiptItem[]) {
    setReceiptsData((prev) =>
      prev.map((rd, i) => (i === reviewIndex ? { ...rd, items: updater(rd.items) } : rd)),
    )
  }

  async function handleFieldSave(itemId: string, fields: Partial<ReceiptItem>) {
    if (!current) return
    try {
      const updated = await updateReceiptItem(current.receipt.id, itemId, fields)
      updateCurrentItems((items) => items.map((it) => (it.id === itemId ? updated : it)))
    } catch {
      setError('Could not save that change.')
    }
  }

  async function handleCorrect(itemId: string, correction: ItemCorrection) {
    if (!current) return
    try {
      const updated = await correctReceiptItem(current.receipt.id, itemId, correction)
      updateCurrentItems((items) => items.map((it) => (it.id === itemId ? updated : it)))
    } catch {
      setError('Could not save that match.')
    }
  }

  async function handleDelete(itemId: string) {
    if (!current) return
    try {
      await deleteReceiptItem(current.receipt.id, itemId)
      updateCurrentItems((items) => items.filter((it) => it.id !== itemId))
    } catch {
      setError('Could not delete that item.')
    }
  }

  async function handleConfirm() {
    if (!current) return
    setBusy(true)
    setError(null)
    try {
      const result = await confirmReceipt(current.receipt.id)
      setConfirmResults((prev) => [...prev, result])
      if (reviewIndex + 1 < receiptsData.length) {
        setReviewIndex((i) => i + 1)
      } else {
        setScreen('confirmed')
      }
    } catch {
      setError('Could not finalize this receipt. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (screen === 'confirmed' && confirmResults.length) {
    const multi = confirmResults.length > 1
    const totalItems = confirmResults.reduce((sum, r) => sum + r.items.length, 0)
    return (
      <section>
        <h1>{multi ? 'Receipts confirmed' : 'Receipt confirmed'}</h1>
        <p className="callout callout--success">
          Saved {totalItems} item{totalItems === 1 ? '' : 's'}
          {multi && ` across ${confirmResults.length} receipts`}.
        </p>
        {confirmResults.map((result, i) => {
          const q = result.match_quality
          if (!q) return null
          return (
            <p key={result.receipt_id}>
              {multi && `Receipt ${i + 1}: `}
              {q.matched_items} of {q.total_items} items matched confidently
              {q.fallback_items > 0 && `, ${q.fallback_items} estimated from category`}
              {q.failed_items > 0 && `, ${q.failed_items} could not be matched`}.
            </p>
          )
        })}
        <div className="upload-confirmed-actions">
          <Link to="/results" className="btn btn-primary">
            See your results →
          </Link>
          <button className="btn btn-secondary" onClick={reset}>
            Upload another receipt
          </button>
        </div>
      </section>
    )
  }

  if (screen === 'uploading') {
    return (
      <section>
        <h1>Uploading your receipts</h1>
        {fileProgress.total > 1 && (
          <p className="muted">
            File {fileProgress.index + 1} of {fileProgress.total}
          </p>
        )}
        <div className="upload-progress">
          <p className="upload-progress__filename">{currentFileName}…</p>
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
      </section>
    )
  }

  if (screen === 'review' && current) {
    const { receipt, items } = current
    const scanLooksIncomplete = items.length <= 1
    const multi = receiptsData.length > 1
    const isLastReceipt = reviewIndex + 1 >= receiptsData.length
    const purchaseInfo = purchaseInfoLine(receipt)

    return (
      <section>
        <h1>Review your receipt</h1>
        {multi && (
          <p className="muted">
            Receipt {reviewIndex + 1} of {receiptsData.length}
          </p>
        )}
        <p>Fix anything the scan got wrong, mark non-food items, then confirm.</p>
        {purchaseInfo && <p className="review-purchase-info">{purchaseInfo}</p>}

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
          {busy ? 'Confirming…' : isLastReceipt ? 'Confirm & save' : 'Confirm & continue'}
        </button>
      </section>
    )
  }

  return (
    <section>
      <h1>Upload a receipt</h1>
      <p className="muted">
        A photo only needs to clearly show the store name, the purchase date, and the
        purchased items with their prices (quantities help too) — everything else on the
        receipt is irrelevant and can be blurry or cut off. Even better: if your store has
        a loyalty app, download the digital receipt from there instead of a photo — it
        scans far more reliably.
      </p>
      <div className="upload-card">
        <p className="upload-card__label">Add a new receipt</p>
        <div className="tab-row">
          <button
            className={uploadMode === 'file' ? 'tab tab--active' : 'tab'}
            onClick={() => setUploadMode('file')}
          >
            Upload photo
          </button>
          <button
            className={uploadMode === 'text' ? 'tab tab--active' : 'tab'}
            onClick={() => setUploadMode('text')}
          >
            Paste text
          </button>
        </div>

        {uploadMode === 'file' ? (
          <div
            className={
              dragOver ? 'upload-dropzone upload-dropzone--active' : 'upload-dropzone'
            }
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
          >
            <input
              id="receipt-file"
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              capture="environment"
              multiple
              onChange={handleFileChange}
              disabled={busy}
              className="upload-dropzone__input"
              aria-label="Receipt photo or PDF"
            />
            <span className="upload-dropzone__icon">
              <UploadArrowIcon />
            </span>
            <p className="upload-dropzone__title">
              Drop a receipt photo here or click to upload
            </p>
            <p className="upload-dropzone__subtitle">JPG, PNG, WEBP or PDF · several at once</p>
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
      </div>

      {busy && uploadMode === 'text' && (
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
      <button
        type="button"
        className="review-row__delete"
        onClick={onDelete}
        aria-label={`Delete ${item.name}`}
      >
        ×
      </button>

      <div className="review-row__fields">
        <div className="review-row__field review-row__field--name">
          <span className="review-row__field-label">Extracted item text</span>
          <input
            className="review-row__name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== item.name && onSave({ name })}
            aria-label="Item name"
          />
        </div>
        <div className="review-row__field review-row__field--qty">
          <span className="review-row__field-label">Quantity</span>
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
        </div>
        <div className="review-row__field review-row__field--unit">
          <span className="review-row__field-label">Unit</span>
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
        </div>
      </div>

      <div className="review-row__meta">
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
        <label className="review-row__nonfood">
          <input
            type="checkbox"
            checked={item.is_non_food}
            onChange={(e) => onSave({ is_non_food: e.target.checked })}
          />
          Not food
        </label>
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

      {searching && (
        <div className="review-row__search-panel">
          {/* Pre-fill with the live (possibly not-yet-saved) name field so a
              spelling fix made just before "Fix match" doesn't have to be
              retyped into the search box. */}
          <MatchSearchPanel
            item={{ id: item.id, name }}
            receiptId={receiptId}
            onCorrect={onCorrect}
            onClose={() => setSearching(false)}
          />
        </div>
      )}
    </li>
  )
}
