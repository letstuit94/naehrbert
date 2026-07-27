import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { setCurrentProfileId } from '../lib/session'
import {
  ApiError,
  createProfile,
  deleteProfile,
  getProfile,
  updateDietaryPreferences,
  type DailyMovement,
  type DietaryStyle,
  type ExerciseFrequency,
  type Goal,
  type Profile,
  type Sex,
} from '../lib/api'
import {
  EXERCISE_OPTIONS,
  GOAL_OPTIONS,
  MOVEMENT_OPTIONS,
  SEX_OPTIONS,
} from '../lib/chatSteps'
import { ALLERGEN_OPTIONS, DIETARY_STYLE_OPTIONS } from '../lib/recipePrefsSteps'
import { ChipListInput, type ChipListInputHandle } from '../components/ChipListInput'

type LoadState =
  | { status: 'loading' }
  | { status: 'no-profile' }
  | { status: 'error'; message: string }
  | { status: 'ready' }

type FormState = {
  name: string
  sex: Sex | ''
  date_of_birth: string
  height_cm: string
  weight_kg: string
  exercise_frequency: ExerciseFrequency | ''
  daily_movement: DailyMovement | ''
  goal: Goal | ''
  household_size: string
  consumption_share_pct: string
}

const EMPTY_FORM: FormState = {
  name: '',
  sex: '',
  date_of_birth: '',
  height_cm: '',
  weight_kg: '',
  exercise_frequency: '',
  daily_movement: '',
  goal: '',
  household_size: '',
  consumption_share_pct: '',
}

/** Fields saved via the dietary-preferences endpoint rather than the core
 * profile payload. */
const PREFS_FIELDS = new Set(['dietary_style', 'allergies', 'dislikes'])

type LabeledOption = { value: string; label: string }

/** An option label with a leading emoji token stripped, for the read view.
 * Only strips when the first token has no letters/digits (a real emoji), so
 * plain multi-word labels like "Prefer not to say" stay intact. */
function readableLabel(options: LabeledOption[], value: string): string {
  const label = options.find((o) => o.value === value)?.label
  if (!label) return '—'
  const m = label.match(/^(\S+)\s+([\s\S]+)$/)
  if (m && !/[\p{L}\p{N}]/u.test(m[1])) return m[2]
  return label
}

/** Display name for a stored allergen value: known EU-14 value → its label,
 * free-text "other" → itself. */
function allergenLabel(value: string): string {
  return ALLERGEN_OPTIONS.find((o) => o.value === value)?.label ?? value
}

/** ISO date → "12 Jul 1994" (product locale). Falls back to the raw string.
 * A date-only ISO string parses as UTC midnight, so we format in Europe/Berlin
 * (the product timezone) to avoid it rolling back a day for viewers west of
 * UTC. */
function formatDob(iso: string): string {
  if (!iso) return 'Not set'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Berlin',
  })
}

function toForm(profile: Profile): FormState {
  return {
    name: profile.name ?? '',
    sex: profile.sex,
    date_of_birth: profile.date_of_birth,
    height_cm: String(profile.height_cm),
    weight_kg: String(profile.weight_kg),
    exercise_frequency: profile.exercise_frequency,
    daily_movement: profile.daily_movement,
    goal: profile.goal,
    household_size: profile.household_size != null ? String(profile.household_size) : '',
    consumption_share_pct:
      profile.consumption_share_pct != null ? String(profile.consumption_share_pct) : '',
  }
}

export function ProfilePage() {
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [profile, setProfile] = useState<Profile | null>(null)

  // Working copy for whichever single field is being edited.
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [dietaryStyle, setDietaryStyle] = useState<DietaryStyle>('omnivore')
  const [allergies, setAllergies] = useState<string[]>([])
  const [allergyDraft, setAllergyDraft] = useState('')
  const [dislikes, setDislikes] = useState<string[]>([])
  const dislikesRef = useRef<ChipListInputHandle>(null)

  // One field edits at a time (inline). Save/Cancel are explicit, so nothing
  // is ever persisted or discarded silently.
  const [editingField, setEditingField] = useState<string | null>(null)
  const [savingField, setSavingField] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Load a profile's values into the editable working copy.
  const resetForm = useCallback((p: Profile) => {
    setForm(toForm(p))
    setDietaryStyle(p.dietary_style ?? 'omnivore')
    setAllergies(p.allergies ?? [])
    setDislikes(p.dislikes ?? [])
  }, [])

  // Async fetch only — no synchronous setState, so it's safe to run straight
  // from the effect. The initial `state` is already 'loading'; the retry path
  // (an event handler) resets it before re-fetching.
  const fetchProfile = useCallback(() => {
    getProfile()
      .then((loaded) => {
        setProfile(loaded)
        resetForm(loaded)
        setState({ status: 'ready' })
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: 'no-profile' })
        } else {
          setState({
            status: 'error',
            message: "Couldn't load your profile. Check your connection and try again.",
          })
        }
      })
  }, [resetForm])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  function retryLoad() {
    setState({ status: 'loading' })
    fetchProfile()
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function toggleAllergy(value: string) {
    setAllergies((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }

  function addCustomAllergy() {
    const trimmed = allergyDraft.trim()
    if (!trimmed) return
    setAllergies((prev) =>
      prev.some((v) => v.toLowerCase() === trimmed.toLowerCase())
        ? prev
        : [...prev, trimmed],
    )
    setAllergyDraft('')
  }

  function beginEditField(key: string) {
    if (profile) resetForm(profile)
    setAllergyDraft('')
    setFieldError(null)
    setEditingField(key)
  }

  function cancelField() {
    if (profile) resetForm(profile)
    setAllergyDraft('')
    setFieldError(null)
    setEditingField(null)
  }

  /** Client-side guard for the one field being edited (other fields come from
   * the already-valid saved profile). Returns an error message or null. */
  function fieldValidationError(key: string): string | null {
    const num = (v: string) => (v.trim() === '' ? null : Number(v))
    switch (key) {
      case 'date_of_birth':
        return form.date_of_birth ? null : 'Please enter your date of birth.'
      case 'height_cm': {
        const n = num(form.height_cm)
        return n !== null && n >= 100 && n <= 250
          ? null
          : 'Enter a height between 100 and 250 cm.'
      }
      case 'weight_kg': {
        const n = num(form.weight_kg)
        return n !== null && n >= 30 && n <= 300
          ? null
          : 'Enter a weight between 30 and 300 kg.'
      }
      case 'household_size': {
        const n = num(form.household_size)
        return n === null || (n >= 1 && n <= 20)
          ? null
          : 'Enter a number between 1 and 20.'
      }
      case 'consumption_share_pct': {
        const n = num(form.consumption_share_pct)
        return n === null || (n >= 1 && n <= 100)
          ? null
          : 'Enter a percentage between 1 and 100.'
      }
      default:
        return null
    }
  }

  async function saveField(key: string) {
    const invalid = fieldValidationError(key)
    if (invalid) {
      setFieldError(invalid)
      return
    }
    setSavingField(true)
    setFieldError(null)
    try {
      if (PREFS_FIELDS.has(key)) {
        // Commit any unconfirmed draft text (typed but not added via +/Enter)
        // so it isn't silently dropped on Save. The dislikes draft lives inside
        // ChipListInput, reached through its imperative `flush`; the allergy
        // "Other" draft lives here.
        const finalDislikes = dislikesRef.current?.flush() ?? dislikes
        const draftAllergy = allergyDraft.trim()
        const finalAllergies =
          draftAllergy &&
          !allergies.some((v) => v.toLowerCase() === draftAllergy.toLowerCase())
            ? [...allergies, draftAllergy]
            : allergies
        setAllergies(finalAllergies)
        setAllergyDraft('')
        const updated = await updateDietaryPreferences({
          dietary_style: dietaryStyle,
          allergies: finalAllergies,
          dislikes: finalDislikes,
        })
        setProfile(updated)
        resetForm(updated)
      } else {
        const { profile: updated } = await createProfile({
          name: form.name.trim() || null,
          sex: form.sex as Sex,
          date_of_birth: form.date_of_birth,
          height_cm: Number(form.height_cm),
          weight_kg: Number(form.weight_kg),
          exercise_frequency: form.exercise_frequency as ExerciseFrequency,
          daily_movement: form.daily_movement as DailyMovement,
          goal: form.goal as Goal,
          household_size: form.household_size ? Number(form.household_size) : null,
          consumption_share_pct: form.consumption_share_pct
            ? Number(form.consumption_share_pct)
            : null,
        })
        setProfile(updated)
        resetForm(updated)
      }
      setEditingField(null)
      setAllergyDraft('')
    } catch (err) {
      setFieldError(
        err instanceof ApiError ? err.message : 'Could not save. Please try again.',
      )
    } finally {
      setSavingField(false)
    }
  }

  function logOut() {
    setCurrentProfileId(null)
    navigate('/')
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteProfile()
      // Account is gone -- clear the stored profile id and return to the
      // login screen. (Verified matches stay in the DB by design.)
      setCurrentProfileId(null)
      navigate('/')
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : 'Could not delete your account.',
      )
      setDeleting(false)
    }
  }

  /** A read row (label · value · pencil) that expands into an inline editor
   * for that single field. Editing is per row — no page-wide edit mode. */
  function renderRow(key: string, label: string, value: string, editor: ReactNode) {
    if (editingField === key) {
      return (
        <div key={label} className="profile-field profile-field--editing">
          <span className="profile-field__label">{label}</span>
          <div className="profile-field__editor">
            {editor}
            {fieldError && (
              <p className="form-error" role="alert">
                {fieldError}
              </p>
            )}
            <div className="profile-field__actions">
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => saveField(key)}
                disabled={savingField}
              >
                {savingField ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={cancelField}
                disabled={savingField}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )
    }
    // While another field is being edited, lock the remaining rows so a stray
    // click can't silently discard the in-progress edit -- Save/Cancel first.
    const locked = editingField !== null && editingField !== key
    return (
      <button
        key={label}
        type="button"
        className={locked ? 'profile-field profile-field--locked' : 'profile-field'}
        onClick={() => beginEditField(key)}
        disabled={locked}
        aria-label={`Edit ${label.toLowerCase()}`}
      >
        <span className="profile-field__label">{label}</span>
        <span className="profile-field__value">{value || '—'}</span>
        <svg className="profile-field__edit" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 20h9" strokeLinecap="round" />
          <path
            d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    )
  }

  const selectEditor = <K extends keyof FormState>(
    field: K,
    options: LabeledOption[],
  ) => (
    <select
      value={form[field]}
      onChange={(e) => update(field, e.target.value as FormState[K])}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )

  if (state.status === 'loading') {
    return (
      <section className="profile-page" aria-busy="true">
        <h1>Profile</h1>
        <div className="card">
          <div className="skeleton" style={{ height: 12, width: '30%' }} />
          <div
            className="skeleton"
            style={{ height: 40, width: '100%', marginTop: 12 }}
          />
          <div
            className="skeleton"
            style={{ height: 40, width: '100%', marginTop: 10 }}
          />
        </div>
        <div className="card">
          <div className="skeleton" style={{ height: 12, width: '30%' }} />
          <div
            className="skeleton"
            style={{ height: 40, width: '100%', marginTop: 12 }}
          />
        </div>
        <p className="muted">Loading your profile…</p>
      </section>
    )
  }

  if (state.status === 'no-profile') {
    return (
      <section className="profile-page">
        <h1>Profile</h1>
        <div className="card">
          <p>
            🌱 You haven't set up your profile yet. Let's find out what your body needs —
            it takes under a minute.
          </p>
          <div className="profile-actions">
            <Link to="/onboarding" className="btn btn-primary">
              Start onboarding
            </Link>
          </div>
        </div>
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section className="profile-page">
        <h1>Profile</h1>
        <div className="card">
          <p className="form-error" role="alert">
            {state.message}
          </p>
          <div className="profile-actions">
            <button type="button" className="btn btn-primary" onClick={retryLoad}>
              Try again
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="profile-page">
      <h1>Profile</h1>

      {profile && (
        <>
          <div className="card">
            <h2>Your details</h2>
            <div className="profile-fields">
              {renderRow(
                'name',
                'Name',
                profile.name?.trim() || 'Not set',
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  aria-label="Name"
                  autoFocus
                />,
              )}
              {renderRow(
                'sex',
                'Sex',
                readableLabel(SEX_OPTIONS, profile.sex),
                selectEditor('sex', SEX_OPTIONS),
              )}
              {renderRow(
                'date_of_birth',
                'Date of birth',
                formatDob(profile.date_of_birth),
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) => update('date_of_birth', e.target.value)}
                  aria-label="Date of birth"
                  autoFocus
                />,
              )}
              {renderRow(
                'height_cm',
                'Height',
                `${profile.height_cm} cm`,
                <input
                  type="number"
                  min={100}
                  max={250}
                  value={form.height_cm}
                  onChange={(e) => update('height_cm', e.target.value)}
                  aria-label="Height in cm"
                  autoFocus
                />,
              )}
              {renderRow(
                'weight_kg',
                'Weight',
                `${profile.weight_kg} kg`,
                <input
                  type="number"
                  min={30}
                  max={300}
                  value={form.weight_kg}
                  onChange={(e) => update('weight_kg', e.target.value)}
                  aria-label="Weight in kg"
                  autoFocus
                />,
              )}
            </div>
          </div>

          <div className="card">
            <h2>Activity &amp; goal</h2>
            <div className="profile-fields">
              {renderRow(
                'goal',
                'Goal',
                readableLabel(GOAL_OPTIONS, profile.goal),
                selectEditor('goal', GOAL_OPTIONS),
              )}
              {renderRow(
                'exercise_frequency',
                'Exercise',
                readableLabel(EXERCISE_OPTIONS, profile.exercise_frequency),
                selectEditor('exercise_frequency', EXERCISE_OPTIONS),
              )}
              {renderRow(
                'daily_movement',
                'Daily movement',
                readableLabel(MOVEMENT_OPTIONS, profile.daily_movement),
                selectEditor('daily_movement', MOVEMENT_OPTIONS),
              )}
            </div>
          </div>

          <div className="card">
            <h2>Household</h2>
            <p className="profile-lead muted">
              How much of what's bought is actually for you — used to scale your results.
            </p>
            <div className="profile-fields">
              {renderRow(
                'household_size',
                'People you shop for',
                profile.household_size != null
                  ? String(profile.household_size)
                  : 'Not set',
                <input
                  type="number"
                  min={1}
                  max={20}
                  placeholder="e.g. 2"
                  value={form.household_size}
                  onChange={(e) => update('household_size', e.target.value)}
                  aria-label="People you shop for"
                  autoFocus
                />,
              )}
              {renderRow(
                'consumption_share_pct',
                'Your grocery share',
                profile.consumption_share_pct != null
                  ? `${profile.consumption_share_pct}%`
                  : 'Not set',
                <input
                  type="number"
                  min={1}
                  max={100}
                  placeholder="e.g. 50"
                  value={form.consumption_share_pct}
                  onChange={(e) => update('consumption_share_pct', e.target.value)}
                  aria-label="Your grocery share in percent"
                  autoFocus
                />,
              )}
            </div>
          </div>

          <div className="card">
            <h2>Diet &amp; preferences</h2>
            <p className="profile-lead muted">
              Used to tailor your{' '}
              <Link to="/results#recipes">recipe recommendations</Link> — never your
              calorie/macro targets.
            </p>
            <div className="profile-fields">
              {renderRow(
                'dietary_style',
                'Diet',
                readableLabel(DIETARY_STYLE_OPTIONS, profile.dietary_style ?? 'omnivore'),
                <select
                  value={dietaryStyle}
                  onChange={(e) => setDietaryStyle(e.target.value as DietaryStyle)}
                >
                  {DIETARY_STYLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>,
              )}
              {renderRow(
                'allergies',
                'Exclusions',
                profile.allergies && profile.allergies.length > 0
                  ? profile.allergies.map(allergenLabel).join(', ')
                  : 'None',
                <div className="profile-allergens">
                  <div className="chat-choices">
                    {ALLERGEN_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={
                          allergies.includes(opt.value)
                            ? 'chat-choice chat-choice--selected'
                            : 'chat-choice'
                        }
                        onClick={() => toggleAllergy(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <div className="chip-input-row">
                    <input
                      type="text"
                      placeholder="Other (type and add)"
                      value={allergyDraft}
                      onChange={(e) => setAllergyDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addCustomAllergy()
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="chip-add-btn"
                      aria-label="Add allergy"
                      onClick={addCustomAllergy}
                    >
                      +
                    </button>
                  </div>
                </div>,
              )}
              {renderRow(
                'dislikes',
                'Dislikes',
                profile.dislikes && profile.dislikes.length > 0
                  ? profile.dislikes.join(', ')
                  : 'None',
                <ChipListInput
                  ref={dislikesRef}
                  value={dislikes}
                  onChange={setDislikes}
                  placeholder="e.g. mushrooms"
                />,
              )}
            </div>
          </div>
        </>
      )}

      <div className="card profile-action-card">
        <Link to="/purchases" className="btn btn-secondary">
          Receipt history
        </Link>
      </div>

      <div className="card profile-action-card">
        <button type="button" className="btn btn-soft profile-logout" onClick={logOut}>
          <svg className="profile-logout__icon" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path d="M16 17l5-5-5-5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M21 12H9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Log out
        </button>
      </div>

      <div className="card">
        <h2>Delete account</h2>
        <p className="profile-lead muted">
          Permanently deletes your profile and everything tied to it — receipts, recipes
          and pantry data. This can't be undone.
        </p>

        {deleteError && (
          <p className="form-error" role="alert">
            {deleteError}
          </p>
        )}

        {confirmingDelete ? (
          <div className="profile-actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleDeleteAccount}
              disabled={deleting}
            >
              {deleting ? 'Deleting…' : 'Yes, delete my account'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              setDeleteError(null)
              setConfirmingDelete(true)
            }}
          >
            Delete my account
          </button>
        )}
      </div>
    </section>
  )
}
