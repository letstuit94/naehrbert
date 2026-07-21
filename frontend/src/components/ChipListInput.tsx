import { useState } from 'react'

// Reusable free-text add/remove-chip control -- used for "dislikes" (an
// unbounded list, unlike allergies' small enumerable set) both in the
// recipe-preferences chat and on the Profile page.
export function ChipListInput({
  value,
  onChange,
  placeholder = 'Add a food...',
}: {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  function add() {
    const trimmed = draft.trim()
    if (!trimmed || value.some((v) => v.toLowerCase() === trimmed.toLowerCase())) {
      setDraft('')
      return
    }
    onChange([...value, trimmed])
    setDraft('')
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
                aria-label={`Remove ${item}`}
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
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <button type="button" className="btn-link" onClick={add}>
          Add
        </button>
      </div>
    </div>
  )
}
