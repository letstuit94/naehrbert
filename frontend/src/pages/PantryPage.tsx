import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  addPantryRemoval,
  ApiError,
  correctReceiptItem,
  deletePantryRemoval,
  getPantry,
  updateReceiptItem,
  type ItemCorrection,
  type ItemUpdate,
  type PantryItem,
  type PantryRemovalReason,
} from '../lib/api'
import { AddItemPanel } from '../components/AddItemPanel'
import { PageSkeleton } from '../components/Skeleton'
import { PantryControls } from '../components/PantryControls'
import { MatchSearchPanel } from '../components/MatchSearchPanel'
// ShelfLifePanel (per-category shelf-life editor) is intentionally NOT
// surfaced to end users yet: the estimate stays a conservative default and
// the pantry shows only the fuzzy urgency, never a number. The config is
// still editable server-side (GET/PUT /pantry/shelf-life) so a later
// best-before-date (MHD) feature can turn the panel back on.
import { UrgencyBadge } from '../components/UrgencyBadge'
import { categoryEmoji, emojiGroupLabel } from '../lib/categoryEmoji'
import { formatFallbackCategory, matchInfo } from '../lib/matchInfo'
import { useI18n, type TranslateFn } from '../lib/i18n'
import { useAuth } from '../lib/authContext'
import {
  quantityBasis,
  quantityBasisLabel,
  type QuantityBasis,
} from '../lib/quantityBasis'
import {
  applyFilters,
  groupByCategory,
  NO_FILTERS,
  type PantryFilters,
  type PantryView,
} from '../lib/shelfLife'

// Persist the "by category" expand/collapse state across reloads, scoped per
// profile so different users don't clobber each other. The stored value is
// just the list of expanded food-group keys (a small, stable enum).
function expandedGroupsKey(profileId: number | null): string {
  return `nutriwise.pantry.expandedGroups.${profileId ?? 'anon'}`
}

function loadExpandedGroups(profileId: number | null): Set<PantryItem['food_group']> {
  try {
    const raw = localStorage.getItem(expandedGroupsKey(profileId))
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed)
      ? new Set(parsed as PantryItem['food_group'][])
      : new Set()
  } catch {
    return new Set()
  }
}

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

function reasonVerb(t: TranslateFn): Record<PantryRemovalReason, string> {
  return {
    eaten: t('eaten', 'gegessen'),
    removed: t('removed', 'entfernt'),
  }
}

function reasonConfirm(t: TranslateFn): Record<PantryRemovalReason, string> {
  return {
    eaten: t('Eaten', 'Gegessen'),
    removed: t('Remove', 'Entfernen'),
  }
}

// Units where a withdrawal is a continuous amount (0.5 l, 250 g) -> number
// field; anything else is a discrete count -> a quarter-step slider (½ an
// apple, whole eggs), since you also eat *part* of one piece.
const MEASURED_UNITS = new Set(['g', 'kg', 'ml', 'l'])

// Units offered when editing a lot's amount (same set as the manual-add form
// in AddItemPanel): the mass/volume amounts plus a discrete piece count. The
// lot's current unit is prepended at render time if it isn't one of these, so
// an unusual scanned unit is never silently dropped from the dropdown.
const UNIT_OPTIONS = ['g', 'kg', 'ml', 'l', 'piece'] as const

// Step the piece slider snaps to: quarters cover the realistic partials
// (¼ ½ ¾) and whole counts land exactly on integers.
const PIECE_STEP = 0.25

// Step the measured slider (g/kg/ml/l) snaps to. Fine-grained volumes (kg/l)
// slide in small decimal steps; bulk units (g/ml) slide in whole steps sized
// to the amount left, so the whole range stays reachable with one drag.
function measuredStep(remaining: number, unit: string | null): number {
  const u = (unit ?? '').toLowerCase()
  if (u === 'kg' || u === 'l') return 0.01
  if (remaining <= 50) return 1
  if (remaining <= 500) return 5
  return 10
}

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

// How long a lot has sat in the pantry (today − purchase date), the thing
// that matters here -- old stock is what you want to use up or clear. The
// exact purchase date lives on the Purchases page instead.
function daysInPantry(t: TranslateFn, iso: string | null): string {
  if (!iso) return t('unknown age', 'Alter unbekannt')
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return t('unknown age', 'Alter unbekannt')
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000)
  if (days <= 0) return t('today', 'heute')
  return t(
    `${days} day${days === 1 ? '' : 's'} in`,
    `seit ${days} Tag${days === 1 ? '' : 'en'}`,
  )
}

// The verified identity to show, never the raw parsed receipt text: the
// matched product ("Tomate roh"), else the fallback category, else -- only
// when nothing matched at all -- the parsed name as a last resort.
function displayName(item: PantryItem): string {
  if (item.matched_name) return item.matched_name
  if (item.fallback_category) return formatFallbackCategory(item.fallback_category)
  return item.name
}

export function PantryPage() {
  const { t } = useI18n()
  const verbs = reasonVerb(t)
  const { profileId } = useAuth()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [actionError, setActionError] = useState<string | null>(null)
  const [lastAction, setLastAction] = useState<LastAction | null>(null)
  const [adding, setAdding] = useState(false)
  // View toggle (A/B) and filters are separate controls (see PantryControls).
  const [view, setView] = useState<PantryView>('urgency')
  const [filters, setFilters] = useState<PantryFilters>(NO_FILTERS)
  // Which category groups are EXPANDED in the "by category" view. Default
  // (absent) = collapsed, so the view opens as a compact table-of-contents
  // (category + count) you scan and drill into, rather than one long scroll.
  // Persisted per profile (see loadExpandedGroups) so the view stays the way
  // the user last left it across reloads.
  const [expandedGroups, setExpandedGroups] = useState<Set<PantryItem['food_group']>>(() =>
    loadExpandedGroups(profileId),
  )

  useEffect(() => {
    try {
      localStorage.setItem(expandedGroupsKey(profileId), JSON.stringify([...expandedGroups]))
    } catch {
      // Storage unavailable/full -- fall back to in-memory only (no persist).
    }
  }, [expandedGroups])

  function toggleGroupExpanded(group: PantryItem['food_group']) {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

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
          message:
            err instanceof ApiError
              ? err.message
              : t(
                  'Could not load your pantry.',
                  'Deine Vorratskammer konnte nicht geladen werden.',
                ),
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
          : t(
              `Could not mark "${displayName(item)}" as ${verbs[reason]}.`,
              `„${displayName(item)}“ konnte nicht als ${verbs[reason]} markiert werden.`,
            ),
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
      setActionError(
        err instanceof ApiError
          ? err.message
          : t('Could not save that change.', 'Diese Änderung konnte nicht gespeichert werden.'),
      )
    }
  }

  // Fixing the product name = re-matching the item against OFF/BLS (same flow
  // as the Purchases page), so the picked candidate's name AND its verified
  // nutrition replace the old ones -- not a free-text rename.
  async function handleCorrect(item: PantryItem, correction: ItemCorrection) {
    setActionError(null)
    try {
      await correctReceiptItem(item.receipt_id, item.id, correction)
      await load()
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : t('Could not save that match.', 'Diese Zuordnung konnte nicht gespeichert werden.'),
      )
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

  // The AddItemPanel already created the lot server-side; just close and
  // reload so it appears (an empty pantry flips to 'ready').
  function handleAdded() {
    setAdding(false)
    setActionError(null)
    void load()
  }

  if (state.status === 'loading') {
    return (
      <section aria-busy="true">
        <h1>{t('Pantry', 'Vorrat')}</h1>
        <PageSkeleton cards={3} lines={2} />
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section>
        <h1>{t('Pantry', 'Vorrat')}</h1>
        <p className="form-error" role="alert">
          {state.message}
        </p>
      </section>
    )
  }

  const undoBanner = lastAction && (
    <p className="callout callout--muted" role="status">
      {t('Marked', 'Markiert')}{' '}
      {formatAmount(lastAction.appliedQuantity, lastAction.unit)} {t('of', 'von')} „
      {lastAction.itemName}“ {t('as', 'als')} {verbs[lastAction.reason]}
      {lastAction.clamped
        ? t(' (capped at what was left)', ' (auf den Rest begrenzt)')
        : ''}
      .{' '}
      <button type="button" className="btn-link" onClick={() => void handleUndo()}>
        {t('Undo', 'Rückgängig')}
      </button>
    </p>
  )

  // Manually add a lot (Vorrat.md): a toggle button, or the open panel. Shown
  // in both the empty and populated states so an empty pantry can be filled by
  // hand, not only from a receipt.
  const addControls = adding ? (
    <AddItemPanel onAdded={handleAdded} onClose={() => setAdding(false)} />
  ) : (
    <div className="pantry-add">
      <p className="pantry-add__hint">
        Got food at home that didn't come from an uploaded receipt? Add it here by hand so
        your pantry stays complete.
      </p>
      <button
        type="button"
        className="btn btn-secondary btn-accent pantry-add-btn"
        onClick={() => setAdding(true)}
      >
        ＋ Add item manually
      </button>
    </div>
  )

  if (state.status === 'empty') {
    return (
      <section>
        <h1>{t('Pantry', 'Vorrat')}</h1>
        {undoBanner}
        <p>
          Your pantry is empty. It fills up as you{' '}
          <Link to="/upload">upload receipts</Link> or add items by hand, and empties as
          you mark things eaten or removed.
        </p>
        {addControls}
      </section>
    )
  }

  // Server already returns view-A order (ascending estimated expiry, most
  // urgent first). Filters never reorder; grouping (view B) preserves order.
  // The category filter is a view-A concept only -- in "by category" the
  // groups are the headers, so we drop hiddenGroups there (the control is
  // hidden too, see PantryControls) while keeping search + next-3-days.
  const effectiveFilters =
    view === 'category'
      ? { ...filters, hiddenGroups: new Set<PantryItem['food_group']>() }
      : filters
  const visible = applyFilters(state.items, effectiveFilters, displayName)

  // Distinct food groups present in the FULL pantry (not the filtered set),
  // in first-seen (urgency) order, so hiding a category doesn't remove its
  // own toggle chip.
  const availableGroups: {
    group: (typeof state.items)[number]['food_group']
    label: string
  }[] = []
  const seenGroups = new Set<string>()
  for (const item of state.items) {
    if (!seenGroups.has(item.food_group)) {
      seenGroups.add(item.food_group)
      availableGroups.push({ group: item.food_group, label: item.food_group_label })
    }
  }

  const renderRow = (item: PantryItem) => (
    <PantryRow
      key={item.id}
      item={item}
      onWithdraw={(reason, quantity) => void handleWithdraw(item, reason, quantity)}
      onEdit={(fields) => void handleEdit(item, fields)}
      onCorrect={(correction) => void handleCorrect(item, correction)}
    />
  )

  return (
    <section>
      <h1>{t('Pantry', 'Vorrat')}</h1>
      <p className="page-lead">
        All the products in your home pantry. Update what you have eaten or thrown away.
      </p>

      {undoBanner}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}

      {addControls}

      <PantryControls
        view={view}
        onViewChange={setView}
        filters={filters}
        onFiltersChange={setFilters}
        availableGroups={availableGroups}
      />

      {visible.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__emoji" aria-hidden="true">
            🔍
          </span>
          <p>No items match the current filters.</p>
          <button
            type="button"
            className="btn btn-soft"
            onClick={() => setFilters(NO_FILTERS)}
          >
            Clear filters
          </button>
        </div>
      ) : view === 'category' ? (
        (() => {
          const cats = groupByCategory(visible)
          const allExpanded = cats.every((cat) => expandedGroups.has(cat.group))
          return (
            <>
              <div className="pantry-group-tools">
                <button
                  type="button"
                  className="btn btn-secondary pantry-expand-toggle"
                  aria-expanded={allExpanded}
                  onClick={() =>
                    setExpandedGroups(
                      allExpanded ? new Set() : new Set(cats.map((cat) => cat.group)),
                    )
                  }
                >
                  <span className="pantry-expand-toggle__caret" aria-hidden="true">
                    {allExpanded ? '▾' : '▸'}
                  </span>
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              </div>
              {cats.map((cat) => {
                const expanded = expandedGroups.has(cat.group)
                const listId = `pantry-group-${cat.group}`
                return (
                  <div
                    key={cat.group}
                    className={
                      expanded ? 'pantry-group pantry-group--open' : 'pantry-group'
                    }
                  >
                    <h2 className="pantry-group__head">
                      <button
                        type="button"
                        className="pantry-group__toggle"
                        aria-expanded={expanded}
                        aria-controls={listId}
                        onClick={() => toggleGroupExpanded(cat.group)}
                      >
                        <span className="pantry-group__emoji" aria-hidden="true">
                          {categoryEmoji(cat.items[0])}
                        </span>
                        <span className="pantry-group__label">{cat.label}</span>
                        <span className="pantry-group__count">{cat.items.length}</span>
                        <span className="pantry-group__caret" aria-hidden="true">
                          {expanded ? '▾' : '▸'}
                        </span>
                      </button>
                    </h2>
                    {expanded && (
                      <ul id={listId} className="purchase-list">
                        {cat.items.map(renderRow)}
                      </ul>
                    )}
                  </div>
                )
              })}
            </>
          )
        })()
      ) : (
        <ul className="purchase-list">{visible.map(renderRow)}</ul>
      )}
    </section>
  )
}

function formatGrams(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}g`
}

function PantryRow({
  item,
  onWithdraw,
  onEdit,
  onCorrect,
}: {
  item: PantryItem
  onWithdraw: (reason: PantryRemovalReason, quantity: number) => void
  onEdit: (fields: ItemUpdate) => void
  onCorrect: (correction: ItemCorrection) => void
}) {
  const { t } = useI18n()
  const verbs = reasonVerb(t)
  const confirms = reasonConfirm(t)
  const match = matchInfo(t, item)
  const basis = quantityBasis(item)
  const measured = MEASURED_UNITS.has((item.unit ?? '').toLowerCase())
  const remaining = item.quantity ?? 1

  // Which withdrawal panel is open (eaten/removed), and the amount it will
  // withdraw -- pre-filled with the whole remaining so one open+confirm
  // clears the lot; adjust down for a partial (Vorrat.md §6.4).
  const [panel, setPanel] = useState<PantryRemovalReason | null>(null)
  const [amount, setAmount] = useState<number>(remaining)

  // The name pencil opens a match-search panel (fix match, like the Purchases
  // page); the quantity pencil is a plain inline edit.
  const [searchingMatch, setSearchingMatch] = useState(false)
  const [editingQty, setEditingQty] = useState(false)
  const [qtyDraft, setQtyDraft] = useState('')
  const [unitDraft, setUnitDraft] = useState('')

  function openPanel(reason: PantryRemovalReason) {
    setAmount(remaining)
    setSearchingMatch(false)
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

  function saveQty() {
    const n = Number(qtyDraft)
    const fields: ItemUpdate = {}
    if (!Number.isNaN(n) && n > 0 && n !== remaining) fields.quantity = n
    if (unitDraft && unitDraft !== (item.unit ?? '')) fields.unit = unitDraft
    if (Object.keys(fields).length > 0) onEdit(fields)
    setEditingQty(false)
  }

  const partial = amount < remaining
  const amountLabel = measured
    ? formatAmount(amount, item.unit)
    : `${quarterLabel(amount)}${item.unit ? ` ${item.unit}` : ''}`

  const macrosLine = (
    <span className="pantry-row__macros-sub">
      {item.calories_kcal !== null ? `${Math.round(item.calories_kcal)} kcal` : '—'} · P{' '}
      {formatGrams(item.protein_g)} · F {formatGrams(item.fat_g)} · C{' '}
      {formatGrams(item.carbs_g)}
    </span>
  )

  return (
    <li className="purchase-row pantry-row">
      <div className="purchase-row__name-cell">
        <span className="pantry-row__name-line">
          <span
            className="pantry-row__cat-emoji"
            title={emojiGroupLabel(t, categoryEmoji(item))}
            aria-label={emojiGroupLabel(t, categoryEmoji(item))}
            role="img"
          >
            {categoryEmoji(item)}
          </span>
          <span
            className={
              match?.lowConfidence
                ? 'purchase-row__name review-row__match--warn'
                : 'purchase-row__name'
            }
            title={
              match?.lowConfidence ? 'Category estimate, not a verified match' : undefined
            }
          >
            {match?.lowConfidence ? '~ ' : ''}
            {displayName(item)}
          </span>
          <button
            type="button"
            className={
              searchingMatch
                ? 'pantry-row__icon-btn pantry-row__icon-btn--active'
                : 'pantry-row__icon-btn'
            }
            onClick={() => {
              setPanel(null)
              setSearchingMatch((s) => !s)
            }}
            aria-label={t('Fix match', 'Zuordnung korrigieren')}
            aria-pressed={searchingMatch}
            title={t('Fix match (search product)', 'Zuordnung korrigieren (Produkt suchen)')}
          >
            ✎
          </button>
        </span>
        {macrosLine}
      </div>
      <span className="purchase-row__qty">
        {editingQty ? (
          <span className="pantry-row__edit">
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
              aria-label={t('Quantity', 'Menge')}
              autoFocus
            />
            <select
              className="pantry-row__unit-select"
              value={unitDraft}
              onChange={(e) => setUnitDraft(e.target.value)}
              aria-label={t('Unit', 'Einheit')}
            >
              {(UNIT_OPTIONS.includes(unitDraft as (typeof UNIT_OPTIONS)[number])
                ? UNIT_OPTIONS
                : [unitDraft, ...UNIT_OPTIONS]
              ).map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="pantry-row__icon-btn"
              onClick={saveQty}
              aria-label={t('Save quantity', 'Menge speichern')}
            >
              ✓
            </button>
            <button
              type="button"
              className="pantry-row__icon-btn"
              onClick={() => setEditingQty(false)}
              aria-label={t('Cancel', 'Abbrechen')}
            >
              ✕
            </button>
          </span>
        ) : (
          <>
            {formatAmount(remaining, item.unit)}
            <span
              className={`qty-basis qty-basis--${basis}`}
              title={quantityBasisLabel(t, basis)}
              aria-label={quantityBasisLabel(t, basis)}
            >
              {QUANTITY_BASIS_ICON[basis]}
            </span>
            <button
              type="button"
              className="pantry-row__icon-btn"
              onClick={() => {
                setQtyDraft(String(remaining))
                setUnitDraft(item.unit ?? 'piece')
                setEditingQty(true)
              }}
              aria-label={t('Edit amount', 'Menge bearbeiten')}
              title={t('Edit amount', 'Menge bearbeiten')}
            >
              ✎
            </button>
          </>
        )}
      </span>
      <span className="pantry-row__freshness">
        <UrgencyBadge urgency={item.urgency} />
        <span className="pantry-row__age muted">{daysInPantry(t, item.purchased_at)}</span>
      </span>
      <div className="pantry-row__actions">
        <button
          type="button"
          className={
            panel === 'eaten'
              ? 'pantry-row__action pantry-row__action--active'
              : 'pantry-row__action'
          }
          onClick={() => openPanel('eaten')}
          aria-label={t('Eaten', 'Gegessen')}
          aria-pressed={panel === 'eaten'}
          title={t('Eaten', 'Gegessen')}
        >
          🍴
        </button>
        <button
          type="button"
          className={
            panel === 'removed'
              ? 'pantry-row__action pantry-row__action--active'
              : 'pantry-row__action'
          }
          onClick={() => openPanel('removed')}
          aria-label={t('Remove', 'Entfernen')}
          aria-pressed={panel === 'removed'}
          title={t(
            'Remove (not eaten — spoiled, given away, scan error)',
            'Entfernen (nicht gegessen – verdorben, verschenkt, Scan-Fehler)',
          )}
        >
          🗑️
        </button>
      </div>

      {panel && (
        <div className="pantry-row__panel">
          <span className="pantry-row__panel-label">
            {t('How much', 'Wie viel')} {verbs[panel]}?
          </span>
          {measured ? (
            <div className="pantry-row__slider">
              <input
                type="range"
                min={0}
                max={remaining}
                step={measuredStep(remaining, item.unit)}
                value={amount}
                onChange={(e) => setAmount(clampAmount(Number(e.target.value)))}
                aria-label={`${t('Amount', 'Menge')} ${verbs[panel]} (${item.unit ?? ''})`}
              />
              <span className="pantry-row__slider-value">{amountLabel}</span>
            </div>
          ) : (
            <div className="pantry-row__slider">
              <input
                type="range"
                min={0}
                max={remaining}
                step={PIECE_STEP}
                value={amount}
                onChange={(e) => setAmount(clampAmount(Number(e.target.value)))}
                aria-label={`${t('Amount', 'Menge')} ${verbs[panel]}`}
              />
              <span className="pantry-row__slider-value">{amountLabel}</span>
            </div>
          )}
          <div className="pantry-row__panel-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={confirm}
              disabled={amount <= 0}
            >
              {confirms[panel]}
              {partial ? ` ${amountLabel}` : t(' all', ' alles')}
            </button>
            <button type="button" className="btn-link" onClick={() => setPanel(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {searchingMatch && (
        <div className="pantry-row__panel">
          <MatchSearchPanel
            item={item}
            receiptId={item.receipt_id}
            onCorrect={onCorrect}
            onClose={() => setSearchingMatch(false)}
          />
        </div>
      )}
    </li>
  )
}
