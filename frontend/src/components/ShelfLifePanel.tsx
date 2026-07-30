import { useEffect, useState } from 'react'
import { Skeleton } from './Skeleton'
import { useI18n } from '../lib/i18n'
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
export function ShelfLifePanel({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
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
        setError(
          err instanceof ApiError
            ? err.message
            : t(
                'Could not load shelf-life settings.',
                'Haltbarkeitseinstellungen konnten nicht geladen werden.',
              ),
        ),
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
        return t(
          `"${g.label}" needs a whole number of days, or leave it blank for no estimate.`,
          `„${g.label}“ braucht eine ganze Anzahl von Tagen – oder lass das Feld leer für keine Schätzung.`,
        )
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
      setError(
        err instanceof ApiError
          ? err.message
          : t(
              'Could not save shelf-life settings.',
              'Haltbarkeitseinstellungen konnten nicht gespeichert werden.',
            ),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="shelf-life-panel">
      <div className="shelf-life-panel__head">
        <strong>{t('Shelf-life estimates', 'Haltbarkeitsschätzungen')}</strong>
        <p className="muted">
          {t(
            'Roughly how many days each category stays good after purchase. Drives the traffic-light order only — never shown as a date. Leave blank for “no estimate”.',
            'Ungefähr wie viele Tage jede Kategorie nach dem Kauf haltbar bleibt. Steuert nur die Ampel-Reihenfolge – wird nie als Datum angezeigt. Leer lassen für „keine Schätzung“.',
          )}
        </p>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {groups === null ? (
        <div className="skeleton-rows" aria-hidden="true">
          <Skeleton h={32} />
          <Skeleton h={32} />
          <Skeleton h={32} />
        </div>
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
                  aria-label={t(
                    `Shelf life for ${g.label} in days`,
                    `Haltbarkeit für ${g.label} in Tagen`,
                  )}
                />
                <span className="muted">{t('days', 'Tage')}</span>
                {g.is_override && (
                  <span className="shelf-life-row__tag">{t('custom', 'angepasst')}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="shelf-life-panel__actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? t('Saving…', 'Speichern…') : t('Save', 'Speichern')}
        </button>
        <button type="button" className="btn-link" onClick={onClose}>
          {t('Cancel', 'Abbrechen')}
        </button>
      </div>
    </div>
  )
}
