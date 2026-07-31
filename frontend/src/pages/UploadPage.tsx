import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  ApiError,
  confirmReceipt,
  correctReceiptItem,
  deleteReceiptItem,
  getReceiptStores,
  updateReceipt,
  updateReceiptItem,
  uploadReceiptFile,
  uploadReceiptText,
  type ConfirmResponse,
  type ItemCorrection,
  type Receipt,
  type ReceiptItem,
  type ReceiptUpdate,
} from '../lib/api'
import { matchInfo } from '../lib/matchInfo'
import { MatchSearchPanel } from '../components/MatchSearchPanel'
import { useI18n } from '../lib/i18n'

type TFn = (en: string, de: string) => string

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
function fileProgressSteps(t: TFn): string[] {
  return [
    t('Reading your receipt…', 'Beleg wird gelesen…'),
    t('Extracting the text…', 'Text wird extrahiert…'),
    t('Parsing the items…', 'Artikel werden erkannt…'),
    t(
      'Matching your items against our food database…',
      'Deine Artikel werden mit unserer Lebensmitteldatenbank abgeglichen…',
    ),
  ]
}
const FILE_PROGRESS_DELAYS_MS = [1200, 3000, 5000]

function textProgressSteps(t: TFn): string[] {
  return [
    t('Parsing the items…', 'Artikel werden erkannt…'),
    t(
      'Matching your items against our food database…',
      'Deine Artikel werden mit unserer Lebensmitteldatenbank abgeglichen…',
    ),
  ]
}
const TEXT_PROGRESS_DELAYS_MS = [1000]

const LONGER_NOTE_DELAY_MS = 15000
function longerNote(t: TFn): string {
  return t(
    'New or unusual products can take a little longer to match…',
    'Neue oder ungewöhnliche Produkte brauchen manchmal etwas länger…',
  )
}

/** "Purchase from {date} at {store}" (or just the date if the store
 * couldn't be identified) above the review list -- omitted entirely when
 * even the date wasn't found, since "at {store}" alone with no date reads
 * like a fragment rather than a useful fact. */
function purchaseInfoLine(t: TFn, receipt: Receipt): string | null {
  if (!receipt.purchased_at) return null
  const date = new Date(`${receipt.purchased_at}T00:00:00`).toLocaleDateString(
    t('en-US', 'de-DE'),
    {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    },
  )
  const store = receipt.store && receipt.store !== 'unknown' ? receipt.store : null
  return store
    ? t(`Purchase from ${date} at ${store}`, `Kauf vom ${date} bei ${store}`)
    : t(`Purchase from ${date}`, `Kauf vom ${date}`)
}

// Matches backend/app/api/analysis.py's _RESULTS_WINDOW_DAYS and
// services/plant_diversity.py's PLANT_DIVERSITY_WINDOW_DAYS -- Results'
// macro split/closeness score and the plant-diversity count both only look
// at confirmed receipts from the last this-many days (Konsum.md Stufe 1),
// so an older receipt is real pantry stock but invisible to either.
const RESULTS_WINDOW_DAYS = 28

function isOlderThanResultsWindow(purchasedAt: string | null): boolean {
  if (!purchasedAt) return false
  const purchaseDate = new Date(`${purchasedAt}T00:00:00`)
  if (Number.isNaN(purchaseDate.getTime())) return false
  const ageDays = (Date.now() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24)
  return ageDays > RESULTS_WINDOW_DAYS
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
  const { t } = useI18n()
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
    useState<readonly string[]>(() => fileProgressSteps(t))
  const [progressStep, setProgressStep] = useState(0)
  const [showLongerNote, setShowLongerNote] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const progressTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  // Store/purchase-date follow-up (Epic 3.4 gap-fill): a scan whose store
  // or date couldn't be detected must have both filled in here before
  // Confirm, so purchase-history sorting/display (keyed on purchased_at)
  // never has to silently stand in the upload timestamp for a real one.
  const [existingStores, setExistingStores] = useState<string[]>([])
  const [metaDate, setMetaDate] = useState('')
  const [metaStore, setMetaStore] = useState('')
  const [metaIsNewStore, setMetaIsNewStore] = useState(false)
  const [metaNewStoreName, setMetaNewStoreName] = useState('')
  const [metaError, setMetaError] = useState<string | null>(null)

  const current = receiptsData[reviewIndex] as ReceiptData | undefined
  const currentReceiptId = current?.receipt.id

  useEffect(() => {
    getReceiptStores().then(setExistingStores).catch(() => {})
  }, [])

  // Reset the follow-up form whenever review moves to a different receipt
  // (a fresh upload, or advancing through a multi-file batch) -- each
  // receipt's missing-field state is independent of the last one's.
  useEffect(() => {
    setMetaDate('')
    setMetaStore('')
    setMetaIsNewStore(false)
    setMetaNewStoreName('')
    setMetaError(null)
  }, [currentReceiptId])

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
      startProgress(fileProgressSteps(t), FILE_PROGRESS_DELAYS_MS)
      try {
        const result = await uploadReceiptFile(file)
        results.push({ receipt: result.receipt, items: result.items })
      } catch (err) {
        failures.push(
          `${file.name} (${err instanceof ApiError ? err.message : t('could not be read', 'konnte nicht gelesen werden')})`,
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
      setError(
        failures.length
          ? t(`Could not read: ${failures.join(', ')}.`, `Konnte nicht gelesen werden: ${failures.join(', ')}.`)
          : null,
      )
    } else {
      setScreen('upload')
      setError(
        t(
          'Could not read any of those files. Please try another.',
          'Keine dieser Dateien konnte gelesen werden. Bitte versuch eine andere.',
        ),
      )
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
    startProgress(textProgressSteps(t), TEXT_PROGRESS_DELAYS_MS)
    try {
      const result = await uploadReceiptText(pastedText)
      setReceiptsData([{ receipt: result.receipt, items: result.items }])
      setReviewIndex(0)
      setScreen('review')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t('Could not parse that text.', 'Dieser Text konnte nicht verarbeitet werden.'),
      )
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
      setError(t('Could not save that change.', 'Diese Änderung konnte nicht gespeichert werden.'))
    }
  }

  async function handleCorrect(itemId: string, correction: ItemCorrection) {
    if (!current) return
    try {
      const updated = await correctReceiptItem(current.receipt.id, itemId, correction)
      updateCurrentItems((items) => items.map((it) => (it.id === itemId ? updated : it)))
    } catch {
      setError(t('Could not save that match.', 'Diese Zuordnung konnte nicht gespeichert werden.'))
    }
  }

  async function handleDelete(itemId: string) {
    if (!current) return
    try {
      await deleteReceiptItem(current.receipt.id, itemId)
      updateCurrentItems((items) => items.filter((it) => it.id !== itemId))
    } catch {
      setError(t('Could not delete that item.', 'Dieser Artikel konnte nicht gelöscht werden.'))
    }
  }

  async function handleConfirm() {
    if (!current) return
    const { receipt } = current
    const needsDate = !receipt.purchased_at
    const needsStore = receipt.store === 'unknown'

    if (needsDate || needsStore) {
      const finalStore = metaIsNewStore ? metaNewStoreName.trim() : metaStore
      if (needsDate && !metaDate) {
        setMetaError(t('Please enter the purchase date.', 'Bitte gib das Kaufdatum ein.'))
        return
      }
      if (needsStore && !finalStore) {
        setMetaError(
          t('Please select or enter a store.', 'Bitte wähle einen Laden aus oder gib einen ein.'),
        )
        return
      }
      setMetaError(null)
      setBusy(true)
      setError(null)
      try {
        const patch: ReceiptUpdate = {}
        if (needsDate) patch.purchased_at = metaDate
        if (needsStore) patch.store = finalStore
        const updatedReceipt = await updateReceipt(receipt.id, patch)
        setReceiptsData((prev) =>
          prev.map((rd, i) => (i === reviewIndex ? { ...rd, receipt: updatedReceipt } : rd)),
        )
        if (needsStore && !existingStores.includes(finalStore)) {
          setExistingStores((prev) => [...prev, finalStore].sort())
        }
      } catch {
        setBusy(false)
        setMetaError(
          t(
            'Could not save those details. Please try again.',
            'Diese Angaben konnten nicht gespeichert werden. Bitte versuch es erneut.',
          ),
        )
        return
      }
    }

    setBusy(true)
    setError(null)
    try {
      const result = await confirmReceipt(receipt.id)
      setConfirmResults((prev) => [...prev, result])
      if (reviewIndex + 1 < receiptsData.length) {
        setReviewIndex((i) => i + 1)
      } else {
        setScreen('confirmed')
      }
    } catch {
      setError(
        t(
          'Could not finalize this receipt. Please try again.',
          'Dieser Beleg konnte nicht abgeschlossen werden. Bitte versuch es erneut.',
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  if (screen === 'confirmed' && confirmResults.length) {
    const multi = confirmResults.length > 1
    const totalItems = confirmResults.reduce((sum, r) => sum + r.items.length, 0)
    return (
      <section>
        <h1>
          {multi ? t('Receipts confirmed', 'Belege bestätigt') : t('Receipt confirmed', 'Beleg bestätigt')}
        </h1>
        <p className="callout callout--success">
          {t(
            `Saved ${totalItems} item${totalItems === 1 ? '' : 's'}${multi ? ` across ${confirmResults.length} receipts` : ''}.`,
            `${totalItems} Artikel gespeichert${multi ? ` über ${confirmResults.length} Belege hinweg` : ''}.`,
          )}
        </p>
        {confirmResults.map((result, i) => {
          const q = result.match_quality
          if (!q) return null
          return (
            <p key={result.receipt_id}>
              {multi && t(`Receipt ${i + 1}: `, `Beleg ${i + 1}: `)}
              {t(
                `${q.matched_items} of ${q.total_items} items matched confidently`,
                `${q.matched_items} von ${q.total_items} Artikeln sicher zugeordnet`,
              )}
              {q.fallback_items > 0 &&
                t(
                  `, ${q.fallback_items} estimated from category`,
                  `, ${q.fallback_items} anhand der Kategorie geschätzt`,
                )}
              {q.failed_items > 0 &&
                t(
                  `, ${q.failed_items} could not be matched`,
                  `, ${q.failed_items} konnten nicht zugeordnet werden`,
                )}
              .
            </p>
          )
        })}
        <div className="upload-confirmed-actions">
          <Link to="/results" className="btn btn-primary">
            {t('See your insights →', 'Zu deinen Einblicken →')}
          </Link>
          <button className="btn btn-secondary" onClick={reset}>
            {t('Upload another receipt', 'Weiteren Beleg hochladen')}
          </button>
        </div>
      </section>
    )
  }

  if (screen === 'uploading') {
    return (
      <section>
        <h1>{t('Uploading your receipts', 'Deine Belege werden hochgeladen')}</h1>
        {fileProgress.total > 1 && (
          <p className="muted">
            {t(
              `File ${fileProgress.index + 1} of ${fileProgress.total}`,
              `Datei ${fileProgress.index + 1} von ${fileProgress.total}`,
            )}
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
          {showLongerNote && <p className="muted upload-progress__note">{longerNote(t)}</p>}
        </div>
      </section>
    )
  }

  if (screen === 'review' && current) {
    const { receipt, items } = current
    // "Switch to typing it in manually" is a non-sequitur for a receipt
    // that was already typed in manually -- a pasted-text receipt with
    // few items just genuinely has few items, not a bad OCR scan.
    const scanLooksIncomplete = items.length <= 1 && receipt.source !== 'pasted_text'
    const multi = receiptsData.length > 1
    const isLastReceipt = reviewIndex + 1 >= receiptsData.length
    const purchaseInfo = purchaseInfoLine(t, receipt)
    const needsDate = !receipt.purchased_at
    const needsStore = receipt.store === 'unknown'

    return (
      <section>
        <h1>{t('Review your receipt', 'Beleg überprüfen')}</h1>
        {multi && (
          <p className="muted">
            {t(
              `Receipt ${reviewIndex + 1} of ${receiptsData.length}`,
              `Beleg ${reviewIndex + 1} von ${receiptsData.length}`,
            )}
          </p>
        )}
        <p>
          {t(
            'Fix anything the scan got wrong, mark non-food items, then confirm.',
            'Korrigiere alles, was der Scan falsch erkannt hat, markiere Nicht-Lebensmittel und bestätige dann.',
          )}
        </p>
        {purchaseInfo && <p className="review-purchase-info">{purchaseInfo}</p>}

        {(needsDate || needsStore) && (
          <div className="callout callout--muted receipt-meta-form">
            <p>
              {t(
                `We couldn't detect ${
                  needsDate && needsStore
                    ? 'a purchase date or store'
                    : needsDate
                      ? 'a purchase date'
                      : 'a store'
                } for this receipt — please fill it in before confirming.`,
                `Wir konnten ${
                  needsDate && needsStore
                    ? 'kein Kaufdatum und keinen Händler'
                    : needsDate
                      ? 'kein Kaufdatum'
                      : 'keinen Händler'
                } für diesen Beleg erkennen — bitte trage es vor dem Bestätigen ein.`,
              )}
            </p>
            {needsDate && (
              <div className="form-field">
                <label htmlFor="meta-date">{t('Purchase date', 'Kaufdatum')}</label>
                <input
                  id="meta-date"
                  type="date"
                  value={metaDate}
                  onChange={(e) => setMetaDate(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </div>
            )}
            {needsStore && (
              <div className="form-field">
                <label htmlFor="meta-store">{t('Store', 'Händler')}</label>
                <select
                  id="meta-store"
                  value={metaIsNewStore ? '__new__' : metaStore}
                  onChange={(e) => {
                    if (e.target.value === '__new__') {
                      setMetaIsNewStore(true)
                      setMetaStore('')
                    } else {
                      setMetaIsNewStore(false)
                      setMetaStore(e.target.value)
                    }
                  }}
                >
                  <option value="" disabled>
                    {t('Select a store', 'Händler auswählen')}
                  </option>
                  {existingStores.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value="__new__">{t('+ Add a new store', '+ Neuen Händler hinzufügen')}</option>
                </select>
                {metaIsNewStore && (
                  <input
                    type="text"
                    placeholder={t('Store name', 'Händlername')}
                    value={metaNewStoreName}
                    onChange={(e) => setMetaNewStoreName(e.target.value)}
                    aria-label={t('New store name', 'Name des neuen Händlers')}
                    autoFocus
                  />
                )}
              </div>
            )}
            {metaError && (
              <p className="form-error" role="alert">
                {metaError}
              </p>
            )}
          </div>
        )}

        {isOlderThanResultsWindow(receipt.purchased_at) && (
          <p className="callout callout--warning">
            {t(
              `This receipt is more than ${RESULTS_WINDOW_DAYS} days old. Once confirmed, it'll still stock your pantry, but it won't count toward your health score or gap analysis on the Insights page — those only look at the last ${RESULTS_WINDOW_DAYS} days.`,
              `Dieser Beleg ist älter als ${RESULTS_WINDOW_DAYS} Tage. Nach dem Bestätigen füllt er trotzdem deinen Vorrat, zählt aber nicht zu deinem Gesundheitswert oder zur Lückenanalyse auf der Insights-Seite — die betrachten nur die letzten ${RESULTS_WINDOW_DAYS} Tage.`,
            )}
          </p>
        )}

        {scanLooksIncomplete ? (
          <p className="callout callout--warning">
            {items.length === 0
              ? t("We couldn't find any items on this scan.", 'Wir konnten auf diesem Scan keine Artikel finden.')
              : t(`We only found ${items.length} item on this scan.`, `Wir haben auf diesem Scan nur ${items.length} Artikel gefunden.`)}{' '}
            {t("If that doesn't look right, you can", 'Wenn das nicht richtig aussieht, kannst du')}{' '}
            <button type="button" className="btn-link" onClick={switchToManualEntry}>
              {t('switch to typing it in manually', 'stattdessen manuell eintippen')}
            </button>
            .
          </p>
        ) : (
          <p className="muted">
            {t("Scan doesn't look right?", 'Sieht der Scan nicht richtig aus?')}{' '}
            <button type="button" className="btn-link" onClick={switchToManualEntry}>
              {t('Switch to manual entry', 'Zur manuellen Eingabe wechseln')}
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
        {items.length === 0 && (
          <p className="callout callout--muted">
            {t(
              'No items left on this receipt — add one back to confirm, or upload a different one.',
              'Keine Artikel mehr auf diesem Beleg — füge einen zurück hinzu, um zu bestätigen, oder lade einen anderen Beleg hoch.',
            )}
          </p>
        )}

        <button
          className="btn btn-primary"
          onClick={handleConfirm}
          disabled={busy || items.length === 0}
        >
          {busy
            ? t('Confirming…', 'Bestätige…')
            : isLastReceipt
              ? t('Confirm & save', 'Bestätigen & speichern')
              : t('Confirm & continue', 'Bestätigen & weiter')}
        </button>
      </section>
    )
  }

  return (
    <section>
      <h1>{t('Upload a receipt', 'Beleg hochladen')}</h1>
      <p className="page-lead">
        {t(
          "Add a receipt and I'll turn it into pantry items and nutrition insights.",
          'Füge einen Beleg hinzu und ich verwandle ihn in Vorratsartikel und Ernährungs-Insights.',
        )}
      </p>
      <ul className="upload-tips">
        <li>
          <span className="upload-tips__icon" aria-hidden="true">
            -
          </span>
          <span>
            {t(
              'Keep the store name, date, and priced item lines readable — the rest can be blurry or cut off.',
              'Achte darauf, dass Händlername, Datum und die Artikelzeilen mit Preisen lesbar sind — der Rest darf unscharf oder abgeschnitten sein.',
            )}
          </span>
        </li>
        <li>
          <span className="upload-tips__icon" aria-hidden="true">
            -
          </span>
          <span>
            {t(
              'Got a store loyalty app? A digital receipt from there scans even more reliably than a photo.',
              'Hast du eine Kundenkarten-App deines Händlers? Ein digitaler Beleg von dort wird noch zuverlässiger erkannt als ein Foto.',
            )}
          </span>
        </li>
      </ul>
      <div className="upload-card">
        <p className="upload-card__label">{t('Add a new receipt', 'Neuen Beleg hinzufügen')}</p>
        <div className="tab-row">
          <button
            className={uploadMode === 'file' ? 'tab tab--active' : 'tab'}
            onClick={() => setUploadMode('file')}
          >
            {t('Upload photo', 'Foto hochladen')}
          </button>
          <button
            className={uploadMode === 'text' ? 'tab tab--active' : 'tab'}
            onClick={() => setUploadMode('text')}
          >
            {t('Paste text', 'Text einfügen')}
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
              aria-label={t('Receipt photo or PDF', 'Beleg-Foto oder PDF')}
            />
            <span className="upload-dropzone__icon">
              <UploadArrowIcon />
            </span>
            <p className="upload-dropzone__title">
              {t('Drop a receipt photo here or click to upload', 'Beleg-Foto hier ablegen oder zum Hochladen klicken')}
            </p>
            <p className="upload-dropzone__subtitle">
              {t('JPG, PNG, WEBP or PDF · several at once', 'JPG, PNG, WEBP oder PDF · mehrere auf einmal')}
            </p>
          </div>
        ) : (
          <div className="form-field">
            <label htmlFor="receipt-text">{t('Pasted receipt text', 'Eingefügter Belegtext')}</label>
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
              {busy ? t('Parsing…', 'Verarbeite…') : t('Parse text', 'Text verarbeiten')}
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
          {showLongerNote && <p className="muted upload-progress__note">{longerNote(t)}</p>}
        </div>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="card profile-action-card">
        <Link to="/purchases" className="btn btn-secondary">
          {t('Receipt history', 'Belegverlauf')}
        </Link>
      </div>
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
  const { t } = useI18n()
  const [name, setName] = useState(item.name)
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [unit, setUnit] = useState(item.unit)
  const [searching, setSearching] = useState(false)
  const match = matchInfo(t, item)

  return (
    <li className={item.is_non_food ? 'review-row review-row--non-food' : 'review-row'}>
      <button
        type="button"
        className="review-row__delete"
        onClick={onDelete}
        aria-label={t(`Delete ${item.name}`, `${item.name} löschen`)}
      >
        ×
      </button>

      <div className="review-row__fields">
        <div className="review-row__field review-row__field--name">
          <span className="review-row__field-label">{t('Extracted item text', 'Erkannter Artikeltext')}</span>
          <input
            className="review-row__name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== item.name && onSave({ name })}
            aria-label={t('Item name', 'Artikelname')}
          />
        </div>
        <div className="review-row__field review-row__field--qty">
          <span className="review-row__field-label">{t('Quantity', 'Menge')}</span>
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
            aria-label={t('Quantity', 'Menge')}
          />
        </div>
        <div className="review-row__field review-row__field--unit">
          <span className="review-row__field-label">{t('Unit', 'Einheit')}</span>
          <select
            className="review-row__unit"
            value={unit}
            onChange={(e) => {
              setUnit(e.target.value)
              onSave({ unit: e.target.value })
            }}
            aria-label={t('Unit', 'Einheit')}
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
          {t('Not food', 'Kein Lebensmittel')}
        </label>
        {!item.is_non_food && (
          <button
            type="button"
            className="btn-link review-row__fix-match"
            onClick={() => setSearching((s) => !s)}
          >
            {searching ? t('Cancel search', 'Suche abbrechen') : t('Fix match', 'Treffer korrigieren')}
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
