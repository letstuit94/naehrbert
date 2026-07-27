import { useEffect, useRef, useState } from 'react'
import type { FoodGroup } from '../lib/api'
import type { BasketFilters, BasketView } from '../lib/shelfLife'

/**
 * Basket toolbar, laid out as two clearly separate rows so the user can tell
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
export function BasketControls({
  view,
  onViewChange,
  filters,
  onFiltersChange,
  availableGroups,
}: {
  view: BasketView
  onViewChange: (view: BasketView) => void
  filters: BasketFilters
  onFiltersChange: (filters: BasketFilters) => void
  availableGroups: { group: FoodGroup; label: string }[]
}) {
  const [catsOpen, setCatsOpen] = useState(false)
  const catsRef = useRef<HTMLDivElement>(null)

  // The category filter belongs to the flat "use-by" view only: in the
  // "by category" view the groups are already the section headers, so the
  // filter would be redundant -- and applying it there could hide a whole
  // section with no visible control to bring it back. So it is hidden and
  // NOT applied in view B (BasketPage drops hiddenGroups there); the user's
  // selection stays in state and takes effect again on the way back to A.
  const showCategoryFilter = view === 'urgency'

  // Switching view is the only way the category filter can disappear, so
  // close its popover here rather than reacting to the view in an effect.
  function changeView(next: BasketView) {
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
    <div className="basket-controls">
      {/* ── Row 1: order (view toggle) + search ─────────────────── */}
      <div className="basket-toolbar">
        <div className="basket-controls__views" role="radiogroup" aria-label="Sort order">
          <button
            type="button"
            role="radio"
            aria-checked={view === 'urgency'}
            className={
              view === 'urgency' ? 'basket-toggle basket-toggle--active' : 'basket-toggle'
            }
            onClick={() => changeView('urgency')}
          >
            Use first
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={view === 'category'}
            className={
              view === 'category'
                ? 'basket-toggle basket-toggle--active'
                : 'basket-toggle'
            }
            onClick={() => changeView('category')}
          >
            By category
          </button>
        </div>

        <input
          type="search"
          className="basket-search"
          placeholder="Search items…"
          value={filters.search}
          onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          aria-label="Search items"
        />
      </div>

      {/* ── Row 2: filters (independent of the view) ────────────── */}
      <div className="basket-filterbar">
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
              Categories
              <span className="filter-btn__count">
                {shownCount}/{totalCount}
              </span>
              <span className="filter-btn__caret" aria-hidden="true">
                ▾
              </span>
            </button>

            {catsOpen && (
              <div className="cat-popover" role="group" aria-label="Show categories">
                <div className="cat-popover__head">
                  <span className="cat-popover__title">Show categories</span>
                  <span className="cat-popover__actions">
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setAllGroups(true)}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setAllGroups(false)}
                    >
                      None
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
          Next 3 days
        </button>

        {hasActiveFilters && (
          <button type="button" className="btn-link basket-clear" onClick={clearFilters}>
            ✕ Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
