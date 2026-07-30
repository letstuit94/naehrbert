import { forwardRef, useCallback, useImperativeHandle, useState } from 'react'
import { useI18n } from '../lib/i18n'

/** Imperative handle: lets a parent commit an unconfirmed draft before it
 * reads `value` (e.g. on a "Save" click), so typed-but-not-added text isn't
 * silently dropped. `flush` returns the resulting list synchronously. */
export type ChipListInputHandle = { flush: () => string[] }

// Reusable free-text add/remove-chip control -- used for "dislikes" (an
// unbounded list, unlike allergies' small enumerable set) both in the
// recipe-preferences chat and on the Profile page.
export const ChipListInput = forwardRef<
  ChipListInputHandle,
  {
    value: string[]
    onChange: (next: string[]) => void
    placeholder?: string
  }
>(function ChipListInput({ value, onChange, placeholder }, ref) {
  const { t } = useI18n()
  const [draft, setDraft] = useState('')
  const resolvedPlaceholder = placeholder ?? t('Add a food...', 'Lebensmittel hinzufügen...')

  // Commit the current draft (if any) into the list; returns the resulting
  // list so callers can use it without waiting for the onChange state update.
  const commit = useCallback((): string[] => {
    const trimmed = draft.trim()
    if (!trimmed || value.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
      setDraft('')
      return value
    }
    const next = [...value, trimmed]
    onChange(next)
    setDraft('')
    return next
  }, [draft, value, onChange])

  useImperativeHandle(ref, () => ({ flush: commit }), [commit])

  function add() {
    commit()
  }

  function remove(item: string) {
    onChange(value.filter((v) => v !== item))
  }

  return (
    <div className="chip-list-input">
      {value.length > 0 && (
        <ul className="chip-list">
          {value.map((item) => (
            <li key={item} className="chip">
              {item}
              <button
                type="button"
                className="chip__remove"
                aria-label={t(`Remove ${item}`, `${item} entfernen`)}
                onClick={() => remove(item)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chip-input-row">
        <input
          type="text"
          value={draft}
          placeholder={resolvedPlaceholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="chip-add-btn" aria-label={t('Add', 'Hinzufügen')} onClick={add}>
          +
        </button>
      </div>
    </div>
  )
})
