import { useEffect, useRef, useState } from 'react'
import type { FoodGroup } from '../lib/api'
import type { PantryFilters, PantryView } from '../lib/shelfLife'
import { useI18n } from '../lib/i18n'

/**
 * Pantry toolbar, laid out as two clearly separate rows so the user can tell
 * ordering apart from filtering (the two must not be conflated):
 *
 *  - Row 1 (order): the A/B view toggle on the left, text search on the right.
 *    "Use first" (A, urgency-first flat list) vs "By category" (B,
 *    grouped). Changes ORDER/LAYOUT only.
 *  - Row 2 (filter): a "Categories (n/total)" popover of checkboxes (checked =
 *    shown), a "Next 3 days" pill, and a "Clear" that appears only when a
 *    filter is active. Changes WHICH items show, in either view.
 *
 * The category filter is a checkbox popover rather than a row of toggle chips:
 * a checkbox reads as "included when ticked", which matches how people expect
 * a filter to work, and the "n/total" count makes an active filter obvious.
 */
export function PantryControls({
  view,
  onViewChange,
  filters,
  onFiltersChange,
  availableGroups,
}: {
  view: PantryView
  onViewChange: (view: PantryView) => void
  filters: PantryFilters
  onFiltersChange: (filters: PantryFilters) => void
  availableGroups: { group: FoodGroup; label: string }[]
}) {
  const { t } = useI18n()
  const [catsOpen, setCatsOpen] = useState(false)
  const catsRef = useRef<HTMLDivElement>(null)

  // The category filter belongs to the flat "use-by" view only: in the
  // "by category" view the groups are already the section headers, so the
  // filter would be redundant -- and applying it there could hide a whole
  // section with no visible control to bring it back. So it is hidden and
  // NOT applied in view B (PantryPage drops hiddenGroups there); the user's
  // selection stays in state and takes effect again on the way back to A.
  const showCategoryFilter = view === 'urgency'

  // Switching view is the only way the category filter can disappear, so
  // close its popover here rather than reacting to the view in an effect.
  function changeView(next: PantryView) {
    setCatsOpen(false)
    onViewChange(next)
  }

  // Close the category popover on an outside click or Escape.
  useEffect(() => {
    if (!catsOpen) return
    function onPointer(e: MouseEvent) {
      if (catsRef.current && !catsRef.current.contains(e.target as Node))
        setCatsOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setCatsOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [catsOpen])

  function toggleGroup(group: FoodGroup) {
    const hiddenGroups = new Set(filters.hiddenGroups)
    if (hiddenGroups.has(group)) hiddenGroups.delete(group)
    else hiddenGroups.add(group)
    onFiltersChange({ ...filters, hiddenGroups })
  }

  function setAllGroups(shown: boolean) {
    const hiddenGroups = shown
      ? new Set<FoodGroup>()
      : new Set(availableGroups.map((g) => g.group))
    onFiltersChange({ ...filters, hiddenGroups })
  }

  function clearFilters() {
    onFiltersChange({ hiddenGroups: new Set(), onlyNext3Days: false, search: '' })
  }

  const totalCount = availableGroups.length
  const shownCount = availableGroups.filter(
    (g) => !filters.hiddenGroups.has(g.group),
  ).length
  const categoriesFiltered = filters.hiddenGroups.size > 0
  // Only count the category filter as "active" where it actually applies (A),
  // so "Clear" doesn't appear in B for an inert selection.
  const hasActiveFilters =
    (showCategoryFilter && categoriesFiltered) ||
    filters.onlyNext3Days ||
    filters.search.trim() !== ''

  return (
    <div className="pantry-controls">
      {/* ── Row 1: order (view toggle) + search ─────────────────── */}
      <div className="pantry-toolbar">
        <div className="pantry-controls__views" role="radiogroup" aria-label={t('Sort order', 'Sortierung')}>
          <button
            type="button"
            role="radio"
            aria-checked={view === 'urgency'}
            className={
              view === 'urgency' ? 'pantry-toggle pantry-toggle--active' : 'pantry-toggle'
            }
            onClick={() => changeView('urgency')}
          >
            {t('Use first', 'Zuerst verbrauchen')}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={view === 'category'}
            className={
              view === 'category'
                ? 'pantry-toggle pantry-toggle--active'
                : 'pantry-toggle'
            }
            onClick={() => changeView('category')}
          >
            {t('By category', 'Nach Kategorie')}
          </button>
        </div>

        <input
          type="search"
          className="pantry-search"
          placeholder={t('Search items…', 'Artikel suchen…')}
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          aria-label={t('Search items', 'Artikel suchen')}
        />
      </div>

      {/* ── Row 2: filters (independent of the view) ────────────── */}
      <div className="pantry-filterbar">
        {showCategoryFilter && totalCount > 1 && (
          <div className="cat-filter" ref={catsRef}>
            <button
              type="button"
              className={
                categoriesFiltered ? 'filter-btn filter-btn--active' : 'filter-btn'
              }
              aria-haspopup="true"
              aria-expanded={catsOpen}
              onClick={() => setCatsOpen((o) => !o)}
            >
              {t('Categories', 'Kategorien')}
              <span className="filter-btn__count">
                {shownCount}/{totalCount}
              </span>
              <span className="filter-btn__caret" aria-hidden="true">
                ▾
              </span>
            </button>

            {catsOpen && (
              <div
                className="cat-popover"
                role="group"
                aria-label={t('Show categories', 'Kategorien anzeigen')}
              >
                <div className="cat-popover__head">
                  <span className="cat-popover__title">
                    {t('Show categories', 'Kategorien anzeigen')}
                  </span>
                  <span className="cat-popover__actions">
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setAllGroups(true)}
                    >
                      {t('All', 'Alle')}
                    </button>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setAllGroups(false)}
                    >
                      {t('None', 'Keine')}
                    </button>
                  </span>
                </div>
                <ul className="cat-popover__list">
                  {availableGroups.map(({ group, label }) => (
                    <li key={group}>
                      <label className="cat-popover__item">
                        <input
                          type="checkbox"
                          checked={!filters.hiddenGroups.has(group)}
                          onChange={() => toggleGroup(group)}
                        />
                        {label}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          className={
            filters.onlyNext3Days ? 'filter-pill filter-pill--on' : 'filter-pill'
          }
          aria-pressed={filters.onlyNext3Days}
          onClick={() =>
            onFiltersChange({ ...filters, onlyNext3Days: !filters.onlyNext3Days })
          }
        >
          {t('Next 3 days', 'Nächste 3 Tage')}
        </button>

        {hasActiveFilters && (
          <button type="button" className="btn-link pantry-clear" onClick={clearFilters}>
            ✕ {t('Clear filters', 'Filter zurücksetzen')}
          </button>
        )}
      </div>
    </div>
  )
}
