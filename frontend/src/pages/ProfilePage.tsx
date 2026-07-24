import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
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
import { ChipListInput } from '../components/ChipListInput'

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

/** Whole years from an ISO date of birth, or null if unset/unparseable.
 * Mirrors the age logic in lib/chatSteps previewBmr(). */
function ageFromDob(dob: string): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const hadBirthday =
    now.getMonth() > d.getMonth() ||
    (now.getMonth() === d.getMonth() && now.getDate() >= d.getDate())
  if (!hadBirthday) age -= 1
  return age
}

type LabeledOption = { value: string; label: string }

/** An option label with its leading emoji token stripped, for the read view
 * (every option label in chatSteps/recipePrefsSteps starts with "<emoji> "). */
function readableLabel(options: LabeledOption[], value: string): string {
  const label = options.find((o) => o.value === value)?.label
  return label ? label.replace(/^\S+\s+/, '') : '—'
}

/** Display name for a stored allergen value: known EU-14 value → its label,
 * free-text "other" → itself. */
function allergenLabel(value: string): string {
  return ALLERGEN_OPTIONS.find((o) => o.value === value)?.label ?? value
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
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [dietaryStyle, setDietaryStyle] = useState<DietaryStyle>('omnivore')
  const [allergies, setAllergies] = useState<string[]>([])
  const [allergyDraft, setAllergyDraft] = useState('')
  const [dislikes, setDislikes] = useState<string[]>([])
  const [prefsSaving, setPrefsSaving] = useState(false)
  const [prefsSaved, setPrefsSaved] = useState(false)
  const [prefsError, setPrefsError] = useState<string | null>(null)

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // The last-saved profile drives the read view; the forms edit a working copy
  // (`form`/prefs state) that's reset from here whenever editing starts or ends,
  // so the read view never shows unsaved changes.
  const [profile, setProfile] = useState<Profile | null>(null)
  const [editing, setEditing] = useState(false)

  // Load a profile's values into the editable working copy and clear any
  // stale save/error flags.
  const resetForm = useCallback((p: Profile) => {
    setForm(toForm(p))
    setDietaryStyle(p.dietary_style ?? 'omnivore')
    setAllergies(p.allergies ?? [])
    setDislikes(p.dislikes ?? [])
    setSaved(false)
    setPrefsSaved(false)
    setError(null)
    setPrefsError(null)
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

  function startEdit() {
    if (profile) resetForm(profile)
    setEditing(true)
  }

  function stopEdit() {
    if (profile) resetForm(profile)
    setEditing(false)
  }

  function toggleAllergy(value: string) {
    setAllergies((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
    setPrefsSaved(false)
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
    setPrefsSaved(false)
  }

  async function handlePrefsSubmit(e: FormEvent) {
    e.preventDefault()
    setPrefsSaving(true)
    setPrefsError(null)
    setPrefsSaved(false)
    try {
      const updated = await updateDietaryPreferences({
        dietary_style: dietaryStyle,
        allergies,
        dislikes,
      })
      setProfile(updated)
      setPrefsSaved(true)
    } catch (err) {
      setPrefsError(
        err instanceof ApiError ? err.message : 'Could not save your preferences.',
      )
    } finally {
      setPrefsSaving(false)
    }
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
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
      setSaved(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.')
    } finally {
      setSaving(false)
    }
  }

  if (state.status === 'loading') {
    return (
      <section className="profile-page" aria-busy="true">
        <h1>Profile</h1>
        <div className="card profile-header">
          <span
            className="skeleton"
            style={{ width: 54, height: 54, borderRadius: 999 }}
          />
          <div className="profile-header__info">
            <div className="skeleton" style={{ height: 16, width: '45%' }} />
            <div
              className="skeleton"
              style={{ height: 12, width: '65%', marginTop: 10 }}
            />
          </div>
        </div>
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
            🌱 You haven't set up your profile yet. Let's find out what your body
            needs — it takes under a minute.
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

  const age = ageFromDob(form.date_of_birth)
  const headerMeta = [
    age !== null ? `${age} y` : null,
    form.height_cm ? `${form.height_cm} cm` : null,
    form.weight_kg ? `${form.weight_kg} kg` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="profile-page">
      <h1>Profile</h1>

      <div className="card profile-header">
        <span className="profile-avatar" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-3.31 3.58-6 8-6s8 2.69 8 6" strokeLinecap="round" />
          </svg>
        </span>
        <div className="profile-header__info">
          <div className="profile-header__name">{form.name.trim() || 'Your profile'}</div>
          <div className="profile-header__meta">
            {headerMeta || 'Add your details below to set your targets'}
          </div>
        </div>
      </div>

      <p className="profile-lead muted">
        Adjust your details any time — your targets recalculate the next time you view
        them.
      </p>

      <div className="card">
        <h2 className="eyebrow">Your details</h2>
        <form className="form" onSubmit={handleSubmit}>
          <div className="form-field">
            <label htmlFor="profile-name">Name</label>
          <input
            id="profile-name"
            type="text"
            value={form.name}
            onChange={(e) => update('name', e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="profile-sex">Sex</label>
          <select
            id="profile-sex"
            value={form.sex}
            onChange={(e) => update('sex', e.target.value as Sex)}
          >
            {SEX_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="profile-dob">Date of birth</label>
          <input
            id="profile-dob"
            type="date"
            value={form.date_of_birth}
            onChange={(e) => update('date_of_birth', e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="profile-height">Height (cm)</label>
          <input
            id="profile-height"
            type="number"
            min={100}
            max={250}
            value={form.height_cm}
            onChange={(e) => update('height_cm', e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="profile-weight">Weight (kg)</label>
          <input
            id="profile-weight"
            type="number"
            min={30}
            max={300}
            value={form.weight_kg}
            onChange={(e) => update('weight_kg', e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="profile-exercise">Exercise frequency</label>
          <select
            id="profile-exercise"
            value={form.exercise_frequency}
            onChange={(e) =>
              update('exercise_frequency', e.target.value as ExerciseFrequency)
            }
          >
            {EXERCISE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="profile-movement">Daily movement</label>
          <select
            id="profile-movement"
            value={form.daily_movement}
            onChange={(e) => update('daily_movement', e.target.value as DailyMovement)}
          >
            {MOVEMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="profile-goal">Goal</label>
          <select
            id="profile-goal"
            value={form.goal}
            onChange={(e) => update('goal', e.target.value as Goal)}
          >
            {GOAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label htmlFor="profile-household-size">
            People you typically shop for
          </label>
          <input
            id="profile-household-size"
            type="number"
            min={1}
            max={20}
            placeholder="e.g. 2"
            value={form.household_size}
            onChange={(e) => update('household_size', e.target.value)}
          />
        </div>

        <div className="form-field">
          <label htmlFor="profile-consumption-share">
            Your share of those groceries (%)
          </label>
          <input
            id="profile-consumption-share"
            type="number"
            min={1}
            max={100}
            placeholder="e.g. 50"
            value={form.consumption_share_pct}
            onChange={(e) => update('consumption_share_pct', e.target.value)}
          />
        </div>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {saved && (
          <p className="callout callout--success">
            Saved. <Link to="/results">See your updated targets →</Link>
          </p>
        )}

        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        </form>
      </div>

      <div className="card">
        <h2 className="eyebrow">Dietary preferences</h2>
        <p className="profile-lead muted">
          Used to generate your{' '}
          <Link to="/results#recipes">recipe recommendations</Link> — never included in
          your calorie/macro targets above.
        </p>

        <form className="form" onSubmit={handlePrefsSubmit}>
        <div className="form-field">
          <label htmlFor="profile-dietary-style">How do you eat?</label>
          <select
            id="profile-dietary-style"
            value={dietaryStyle}
            onChange={(e) => {
              setDietaryStyle(e.target.value as DietaryStyle)
              setPrefsSaved(false)
            }}
          >
            {DIETARY_STYLE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label>Allergies / intolerances</label>
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
            <button type="button" className="btn-link" onClick={addCustomAllergy}>
              Add
            </button>
          </div>
          {allergies.length > 0 && (
            <p className="muted">Selected: {allergies.join(', ')}</p>
          )}
        </div>

        <div className="form-field">
          <label>Foods you dislike</label>
          <ChipListInput
            value={dislikes}
            onChange={(next) => {
              setDislikes(next)
              setPrefsSaved(false)
            }}
            placeholder="e.g. mushrooms"
          />
        </div>

        {prefsError && (
          <p className="form-error" role="alert">
            {prefsError}
          </p>
        )}
        {prefsSaved && <p className="callout callout--success">Saved.</p>}

        <button className="btn btn-primary" type="submit" disabled={prefsSaving}>
          {prefsSaving ? 'Saving…' : 'Save preferences'}
        </button>
        </form>
      </div>

      <div className="profile-actions">
        <Link to="/purchases" className="btn btn-secondary">
          Receipt history
        </Link>
        <button type="button" className="btn btn-secondary" onClick={logOut}>
          Log out
        </button>
      </div>

      <div className="card">
        <h2 className="eyebrow">Delete account</h2>
        <p className="profile-lead muted">
          Permanently deletes your profile and everything tied to it — receipts,
          recipes and pantry data. This can't be undone.
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
