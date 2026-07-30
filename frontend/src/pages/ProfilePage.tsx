import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/authContext'
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
  type LifeStage,
  type Profile,
  type Sex,
} from '../lib/api'
import {
  exerciseOptions,
  goalOptions,
  movementOptions,
  sexOptions,
} from '../lib/chatSteps'
import { allergenOptions, dietaryStyleOptions } from '../lib/recipePrefsSteps'
import { ChipListInput, type ChipListInputHandle } from '../components/ChipListInput'
import { getStoredTheme, setTheme, type ThemePreference } from '../lib/theme'
import { useI18n, type Lang, type TranslateFn } from '../lib/i18n'

/** Profile-page-only (not part of onboarding or the recipe-prefs chat) --
 * the DGE reference table's pregnancy/nursing life stages. */
const lifeStageOptions = (t: TranslateFn): { value: LifeStage; label: string }[] => [
  { value: 'none', label: t('None', 'Keine') },
  { value: 'pregnant_t1', label: t('Pregnant — 1st trimester', 'Schwanger – 1. Trimester') },
  { value: 'pregnant_t2', label: t('Pregnant — 2nd trimester', 'Schwanger – 2. Trimester') },
  { value: 'pregnant_t3', label: t('Pregnant — 3rd trimester', 'Schwanger – 3. Trimester') },
  { value: 'nursing', label: t('Nursing', 'Stillend') },
]

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
  life_stage: LifeStage | ''
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
  life_stage: '',
}

/** Fields saved via the dietary-preferences endpoint rather than the core
 * profile payload. */
const PREFS_FIELDS = new Set(['dietary_style', 'allergies', 'dislikes'])

/** Color-theme choices for the Appearance row (Preferences card). */
const themeOptions = (t: TranslateFn): { value: ThemePreference; label: string }[] => [
  { value: 'system', label: t('🖥️ System', '🖥️ System') },
  { value: 'light', label: t('☀️ Light', '☀️ Hell') },
  { value: 'dark', label: t('🌙 Dark', '🌙 Dunkel') },
]

/** UI-language choices for the Language row (Preferences card). Labels are shown
 * in their own language (endonyms), so they read the same regardless of the
 * active one. */
const LANGUAGE_OPTIONS: { value: Lang; label: string }[] = [
  { value: 'de', label: '🇩🇪 Deutsch' },
  { value: 'en', label: '🇬🇧 English' },
]

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
function allergenLabel(options: LabeledOption[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value
}

/** ISO date → "12 Jul 1994" (product locale). Falls back to the raw string.
 * A date-only ISO string parses as UTC midnight, so we format in Europe/Berlin
 * (the product timezone) to avoid it rolling back a day for viewers west of
 * UTC. */
function formatDob(t: TranslateFn, iso: string): string {
  if (!iso) return t('Not set', 'Nicht angegeben')
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
    life_stage: profile.life_stage ?? 'none',
  }
}

export function ProfilePage() {
  const navigate = useNavigate()
  const { signOut } = useAuth()
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

  // Appearance / dark-mode preference (persisted in localStorage, applied to
  // <html> via the theme helper — independent of the loaded profile).
  const [theme, setThemeState] = useState<ThemePreference>(getStoredTheme)
  const changeTheme = useCallback((pref: ThemePreference) => {
    setTheme(pref)
    setThemeState(pref)
  }, [])

  // Appearance/language are edited as regular profile-field rows, but they
  // apply live (so the choice previews immediately) and persist to
  // localStorage / the i18n context rather than the profile API. This holds the
  // value at the moment editing began, so Cancel can revert the live preview.
  const [prefBeforeEdit, setPrefBeforeEdit] = useState<string | null>(null)

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
            message: t(
              "Couldn't load your profile. Check your connection and try again.",
              'Dein Profil konnte nicht geladen werden. Prüfe deine Verbindung und versuche es erneut.',
            ),
          })
        }
      })
  }, [resetForm, t])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  // Scroll to a #hash target once the profile is loaded -- lets other pages
  // (e.g. the recipe chat's Skip) deep-link straight to a section such as
  // #diet-preferences. Same pattern as ResultsPage/TipsPage.
  useEffect(() => {
    if (state.status === 'ready' && window.location.hash) {
      document.getElementById(window.location.hash.slice(1))?.scrollIntoView()
    }
  }, [state.status])

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
    if (key === 'theme') setPrefBeforeEdit(theme)
    else if (key === 'language') setPrefBeforeEdit(lang)
    setEditingField(key)
  }

  function cancelField() {
    // Revert the live preview for appearance/language back to where it started.
    if (editingField === 'theme' && prefBeforeEdit) {
      changeTheme(prefBeforeEdit as ThemePreference)
    } else if (editingField === 'language' && prefBeforeEdit) {
      setLang(prefBeforeEdit as Lang)
    }
    setPrefBeforeEdit(null)
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
        return form.date_of_birth
          ? null
          : t('Please enter your date of birth.', 'Bitte gib dein Geburtsdatum an.')
      case 'height_cm': {
        const n = num(form.height_cm)
        return n !== null && n >= 100 && n <= 250
          ? null
          : t(
              'Enter a height between 100 and 250 cm.',
              'Gib eine Größe zwischen 100 und 250 cm ein.',
            )
      }
      case 'weight_kg': {
        const n = num(form.weight_kg)
        return n !== null && n >= 30 && n <= 300
          ? null
          : t(
              'Enter a weight between 30 and 300 kg.',
              'Gib ein Gewicht zwischen 30 und 300 kg ein.',
            )
      }
      case 'household_size': {
        const n = num(form.household_size)
        return n === null || (n >= 1 && n <= 20)
          ? null
          : t('Enter a number between 1 and 20.', 'Gib eine Zahl zwischen 1 und 20 ein.')
      }
      case 'consumption_share_pct': {
        const n = num(form.consumption_share_pct)
        return n === null || (n >= 1 && n <= 100)
          ? null
          : t(
              'Enter a percentage between 1 and 100.',
              'Gib einen Prozentwert zwischen 1 und 100 ein.',
            )
      }
      default:
        return null
    }
  }

  async function saveField(key: string) {
    // Appearance/language already applied live on change — just close the row.
    if (key === 'theme' || key === 'language') {
      setPrefBeforeEdit(null)
      setEditingField(null)
      return
    }
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
          life_stage: (form.life_stage || 'none') as LifeStage,
        })
        setProfile(updated)
        resetForm(updated)
      }
      setEditingField(null)
      setAllergyDraft('')
    } catch (err) {
      setFieldError(
        err instanceof ApiError
          ? err.message
          : t('Could not save. Please try again.', 'Speichern fehlgeschlagen. Bitte versuche es erneut.'),
      )
    } finally {
      setSavingField(false)
    }
  }

  async function logOut() {
    await signOut()
    navigate('/')
  }

  async function handleDeleteAccount() {
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteProfile()
      // The profiles row is gone, but the Supabase login itself still
      // exists -- sign out too, rather than leaving them authenticated
      // with no profile (which would just bounce straight into a fresh
      // onboarding). Verified matches stay in the DB by design.
      await signOut()
      navigate('/')
    } catch (err) {
      setDeleteError(
        err instanceof ApiError
          ? err.message
          : t('Could not delete your account.', 'Dein Konto konnte nicht gelöscht werden.'),
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
                {savingField ? t('Saving…', 'Speichern…') : t('Save', 'Speichern')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={cancelField}
                disabled={savingField}
              >
                {t('Cancel', 'Abbrechen')}
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
        aria-label={t(`Edit ${label.toLowerCase()}`, `${label} bearbeiten`)}
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
        <h1>{t('Profile', 'Profil')}</h1>
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
        <p className="muted">{t('Loading your profile…', 'Dein Profil wird geladen…')}</p>
      </section>
    )
  }

  if (state.status === 'no-profile') {
    return (
      <section className="profile-page">
        <h1>{t('Profile', 'Profil')}</h1>
        <div className="card">
          <p>
            {t(
              "🌱 You haven't set up your profile yet. Let's find out what your body needs — it takes under a minute.",
              '🌱 Du hast dein Profil noch nicht eingerichtet. Lass uns herausfinden, was dein Körper braucht – es dauert weniger als eine Minute.',
            )}
          </p>
          <div className="profile-actions">
            <Link to="/onboarding" className="btn btn-primary">
              {t('Start onboarding', 'Einrichtung starten')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  if (state.status === 'error') {
    return (
      <section className="profile-page">
        <h1>{t('Profile', 'Profil')}</h1>
        <div className="card">
          <p className="form-error" role="alert">
            {state.message}
          </p>
          <div className="profile-actions">
            <button type="button" className="btn btn-primary" onClick={retryLoad}>
              {t('Try again', 'Erneut versuchen')}
            </button>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="profile-page">
      <h1>{t('Profile', 'Profil')}</h1>

      {profile && (
        <>
          <div className="card">
            <h2>{t('Your details', 'Deine Angaben')}</h2>
            <div className="profile-fields">
              {renderRow(
                'name',
                t('Name', 'Name'),
                profile.name?.trim() || t('Not set', 'Nicht angegeben'),
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  aria-label={t('Name', 'Name')}
                  autoFocus
                />,
              )}
              {renderRow(
                'sex',
                t('Sex', 'Geschlecht'),
                readableLabel(sexOpts, profile.sex),
                selectEditor('sex', sexOpts),
              )}
              {renderRow(
                'date_of_birth',
                t('Date of birth', 'Geburtsdatum'),
                formatDob(t, profile.date_of_birth),
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) => update('date_of_birth', e.target.value)}
                  aria-label={t('Date of birth', 'Geburtsdatum')}
                  autoFocus
                />,
              )}
              {renderRow(
                'height_cm',
                t('Height', 'Größe'),
                `${profile.height_cm} cm`,
                <input
                  type="number"
                  min={100}
                  max={250}
                  value={form.height_cm}
                  onChange={(e) => update('height_cm', e.target.value)}
                  aria-label={t('Height in cm', 'Größe in cm')}
                  autoFocus
                />,
              )}
              {renderRow(
                'weight_kg',
                t('Weight', 'Gewicht'),
                `${profile.weight_kg} kg`,
                <input
                  type="number"
                  min={30}
                  max={300}
                  value={form.weight_kg}
                  onChange={(e) => update('weight_kg', e.target.value)}
                  aria-label={t('Weight in kg', 'Gewicht in kg')}
                  autoFocus
                />,
              )}
              {profile.sex !== 'male' &&
                renderRow(
                  'life_stage',
                  t('Pregnancy / nursing', 'Schwangerschaft / Stillzeit'),
                  readableLabel(lifeStageOpts, profile.life_stage ?? 'none'),
                  selectEditor('life_stage', lifeStageOpts),
                )}
            </div>
          </div>

          <div className="card">
            <h2>{t('Activity & goal', 'Aktivität & Ziel')}</h2>
            <div className="profile-fields">
              {renderRow(
                'goal',
                t('Goal', 'Ziel'),
                readableLabel(goalOpts, profile.goal),
                selectEditor('goal', goalOpts),
              )}
              {renderRow(
                'exercise_frequency',
                t('Exercise', 'Sport'),
                readableLabel(exerciseOpts, profile.exercise_frequency),
                selectEditor('exercise_frequency', exerciseOpts),
              )}
              {renderRow(
                'daily_movement',
                t('Daily movement', 'Alltagsbewegung'),
                readableLabel(movementOpts, profile.daily_movement),
                selectEditor('daily_movement', movementOpts),
              )}
            </div>
          </div>

          <div className="card">
            <h2>{t('Household', 'Haushalt')}</h2>
            <p className="profile-lead muted">
              {t(
                "How much of what's bought is actually for you — used to scale your results.",
                'Wie viel von den Einkäufen tatsächlich für dich ist – dient dazu, deine Ergebnisse anzupassen.',
              )}
            </p>
            <div className="profile-fields">
              {renderRow(
                'household_size',
                t('People you shop for', 'Personen, für die du einkaufst'),
                profile.household_size != null
                  ? String(profile.household_size)
                  : t('Not set', 'Nicht angegeben'),
                <input
                  type="number"
                  min={1}
                  max={20}
                  placeholder={t('e.g. 2', 'z. B. 2')}
                  value={form.household_size}
                  onChange={(e) => update('household_size', e.target.value)}
                  aria-label={t('People you shop for', 'Personen, für die du einkaufst')}
                  autoFocus
                />,
              )}
              {renderRow(
                'consumption_share_pct',
                t('Your grocery share', 'Dein Anteil am Einkauf'),
                profile.consumption_share_pct != null
                  ? `${profile.consumption_share_pct}%`
                  : t('Not set', 'Nicht angegeben'),
                <input
                  type="number"
                  min={1}
                  max={100}
                  placeholder={t('e.g. 50', 'z. B. 50')}
                  value={form.consumption_share_pct}
                  onChange={(e) => update('consumption_share_pct', e.target.value)}
                  aria-label={t('Your grocery share in percent', 'Dein Anteil am Einkauf in Prozent')}
                  autoFocus
                />,
              )}
            </div>
          </div>

          <div className="card" id="diet-preferences">
            <h2>{t('Diet & preferences', 'Ernährung & Vorlieben')}</h2>
            <p className="profile-lead muted">
              {t('Used to tailor your', 'Dient dazu, deine')}{' '}
              <Link to="/results#recipes">
                {t('recipe recommendations', 'Rezeptempfehlungen')}
              </Link>{' '}
              {t(
                '— never your calorie/macro targets.',
                'anzupassen – nie deine Kalorien-/Makro-Ziele.',
              )}
            </p>
            <div className="profile-fields">
              {renderRow(
                'dietary_style',
                t('Diet', 'Ernährungsweise'),
                readableLabel(dietaryOpts, profile.dietary_style ?? 'omnivore'),
                <select
                  value={dietaryStyle}
                  onChange={(e) => setDietaryStyle(e.target.value as DietaryStyle)}
                >
                  {dietaryOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>,
              )}
              {renderRow(
                'allergies',
                t('Exclusions', 'Ausschlüsse'),
                profile.allergies && profile.allergies.length > 0
                  ? profile.allergies.map((v) => allergenLabel(allergenOpts, v)).join(', ')
                  : t('None', 'Keine'),
                <div className="profile-allergens">
                  <div className="chat-choices">
                    {allergenOpts.map((opt) => (
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
                      placeholder={t('Other (type and add)', 'Andere (eingeben und hinzufügen)')}
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
                      aria-label={t('Add allergy', 'Allergie hinzufügen')}
                      onClick={addCustomAllergy}
                    >
                      +
                    </button>
                  </div>
                </div>,
              )}
              {renderRow(
                'dislikes',
                t('Dislikes', 'Abneigungen'),
                profile.dislikes && profile.dislikes.length > 0
                  ? profile.dislikes.join(', ')
                  : t('None', 'Keine'),
                <ChipListInput
                  ref={dislikesRef}
                  value={dislikes}
                  onChange={setDislikes}
                  placeholder={t('e.g. mushrooms', 'z. B. Pilze')}
                />,
              )}
            </div>
          </div>

          <div className="card">
            <h2>{t('Preferences', 'Einstellungen')}</h2>
            <div className="profile-fields">
              {renderRow(
                'theme',
                t('Appearance', 'Darstellung'),
                readableLabel(themeOpts, theme),
                <select
                  value={theme}
                  onChange={(e) => changeTheme(e.target.value as ThemePreference)}
                >
                  {themeOpts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>,
              )}
              {renderRow(
                'language',
                t('Language', 'Sprache'),
                readableLabel(LANGUAGE_OPTIONS, lang),
                <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                  {LANGUAGE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>,
              )}
            </div>
          </div>
        </>
      )}

      <div className="card profile-action-card">
        <Link to="/purchases" className="btn btn-secondary">
          {t('Receipt history', 'Bon-Verlauf')}
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
          {t('Log out', 'Abmelden')}
        </button>
      </div>

      <div className="card">
        <h2>{t('Delete account', 'Konto löschen')}</h2>
        <p className="profile-lead muted">
          {t(
            "Permanently deletes your profile and everything tied to it — receipts, recipes and pantry data. This can't be undone.",
            'Löscht dein Profil und alles Dazugehörige dauerhaft – Belege, Rezepte und Vorratsdaten. Das lässt sich nicht rückgängig machen.',
          )}
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
              {deleting
                ? t('Deleting…', 'Wird gelöscht…')
                : t('Yes, delete my account', 'Ja, mein Konto löschen')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
            >
              {t('Cancel', 'Abbrechen')}
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
            {t('Delete my account', 'Mein Konto löschen')}
          </button>
        )}
      </div>
    </section>
  )
}
