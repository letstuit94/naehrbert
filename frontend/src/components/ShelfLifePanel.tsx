import { useEffect, useState } from 'react'
import {
  ApiError,
  getShelfLife,
  updateShelfLife,
  type FoodGroup,
  type ShelfLifeGroup,
} from '../lib/api'

/**
 * Editor for the per-profile shelf-life config that drives pantry urgency.
 * The estimated shelf life is deliberately CONFIG, not a per-item field: here
 * a user tunes the days per food group (e.g. "my bread lasts 3 days"). This
 * is the one place a number is shown/edited -- the config input itself -- as
 * opposed to the pantry list, which never shows an estimated date.
 *
 * A blank field means "no estimate" (the group opts out of urgency and its
 * lots sort to the end), which is exactly how "Other" ships.
 */
export function ShelfLifePanel({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [groups, setGroups] = useState<ShelfLifeGroup[] | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getShelfLife()
      .then((config) => {
        setGroups(config.groups)
        setDrafts(
          Object.fromEntries(
            config.groups.map((g) => [g.food_group, g.shelf_life_days?.toString() ?? '']),
          ),
        )
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Could not load shelf-life settings.'),
      )
  }, [])

  // Only send groups whose value actually changed, as {group: days|null}.
  // An empty draft = null (no estimate); a non-empty one must be a positive
  // integer number of days.
  function changedDays(): Partial<Record<FoodGroup, number | null>> | string {
    if (!groups) return {}
    const out: Partial<Record<FoodGroup, number | null>> = {}
    for (const g of groups) {
      const raw = (drafts[g.food_group] ?? '').trim()
      const next = raw === '' ? null : Number(raw)
      if (next !== null && (!Number.isInteger(next) || next <= 0)) {
        return `"${g.label}" needs a whole number of days, or leave it blank for no estimate.`
      }
      if (next !== g.shelf_life_days) out[g.food_group] = next
    }
    return out
  }

  async function save() {
    const result = changedDays()
    if (typeof result === 'string') {
      setError(result)
      return
    }
    setError(null)
    if (Object.keys(result).length === 0) {
      onClose()
      return
    }
    setSaving(true)
    try {
      const config = await updateShelfLife(result)
      setGroups(config.groups)
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save shelf-life settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="shelf-life-panel">
      <div className="shelf-life-panel__head">
        <strong>Shelf-life estimates</strong>
        <p className="muted">
          Roughly how many days each category stays good after purchase. Drives the
          traffic-light order only — never shown as a date. Leave blank for “no estimate”.
        </p>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {groups === null ? (
        <p>Loading…</p>
      ) : (
        <ul className="shelf-life-list">
          {groups.map((g) => (
            <li key={g.food_group} className="shelf-life-row">
              <span className="shelf-life-row__label">{g.label}</span>
              <span className="shelf-life-row__input">
                <input
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  placeholder="—"
                  value={drafts[g.food_group] ?? ''}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [g.food_group]: e.target.value }))
                  }
                  aria-label={`Shelf life for ${g.label} in days`}
                />
                <span className="muted">days</span>
                {g.is_override && <span className="shelf-life-row__tag">custom</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="shelf-life-panel__actions">
        <button type="button" className="btn-secondary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn-link" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
