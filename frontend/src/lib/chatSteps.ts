import type { DailyMovement, ExerciseFrequency, Goal, Sex } from './api'

/**
 * Content for the chat-style onboarding (Epic 1.1), adapted from an earlier
 * version of this app. Trimmed down for this rebuild:
 *  - single language (English) -- the old version was bilingual EN/DE, but
 *    clean_rebuild_epics.md cuts i18n entirely for v1.
 *  - no incremental/partial backend saves or resumable-onboarding support --
 *    the old version persisted progress after every answer so a partial
 *    profile survived a reload; this backend's `POST /profile` only accepts
 *    a complete 7-field payload in one shot (Epic 1.1), so answers are kept
 *    in memory and sent once, after `goal`.
 *  - no micronutrients tease -- this app doesn't have a micros feature at
 *    all (macro-only per the epics doc), not even a "coming soon" bullet.
 *  - "name" is asked for warmth (so the chat can address the user, and to
 *    introduce the app); it's cosmetic (never used in any BMR/TDEE/macro
 *    calculation) but is persisted, so it also shows up pre-filled on the
 *    Profile page.
 */

export type StepKind = 'choice' | 'text' | 'number' | 'date'

export interface Option {
  value: string
  label: string
}

export interface StepDef {
  key: string
  /** Bot messages shown before `prompt`, each typed in its own turn. */
  promptIntro?: string[]
  prompt: string
  hint?: string
  /** Reassuring reply shown after the answer is given. */
  feedback?: string
  kind: StepKind
  options?: Option[]
  placeholder?: string
}

export const SEX_OPTIONS: Option[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]

export const EXERCISE_OPTIONS: Option[] = [
  { value: 'none', label: '🛋️ Rarely / never' },
  { value: 'one_two', label: '🚶 1-2× per week' },
  { value: 'three_four', label: '🏃 3-4× per week' },
  { value: 'five_six', label: '💪 5-6× per week' },
  { value: 'daily_athlete', label: '🏅 Daily / athlete' },
]

export const MOVEMENT_OPTIONS: Option[] = [
  { value: 'mostly_sitting', label: '🪑 Mostly sitting' },
  { value: 'mixed', label: '🔀 A mix of sitting & moving' },
  { value: 'mostly_standing', label: '🧍 Mostly on my feet' },
  { value: 'physical_labor', label: '🏗️ Physical labor' },
]

export const GOAL_OPTIONS: Option[] = [
  { value: 'lose_weight_gradually', label: '⚖️ Lose fat' },
  { value: 'maintain', label: '🧭 Maintain weight' },
  { value: 'build_muscle', label: '🏋️ Build muscle' },
]

export const GOAL_LABEL: Record<Goal, string> = Object.fromEntries(
  GOAL_OPTIONS.map((o) => [o.value, o.label.replace(/^\S+\s/, '')]),
) as Record<Goal, string>

export const ONBOARDING_STEPS: StepDef[] = [
  {
    key: 'name',
    promptIntro: [
      "Hi, I'm Nährbert — your companion for healthy eating and smart grocery shopping.",
    ],
    prompt: 'So I can address you properly from now on: what should I call you?',
    kind: 'text',
    placeholder: 'Your name',
    feedback:
      "Quick heads-up: I can't replace medical advice, and I'm not a dietitian in the traditional sense.",
  },
  {
    key: 'sex',
    prompt: 'What sex were you assigned at birth?',
    hint: "Sorry if that sounds a little odd — being biologically male or female meaningfully affects your energy needs. If you'd rather not say, that's fine too: I'll just use the midpoint of both.",
    kind: 'choice',
    options: SEX_OPTIONS,
  },
  {
    key: 'date_of_birth',
    prompt: 'When were you born?',
    kind: 'date',
  },
  {
    key: 'height_cm',
    prompt: 'How tall are you, in cm?',
    placeholder: 'e.g. 170',
    kind: 'number',
  },
  {
    key: 'weight_kg',
    prompt: 'And how much do you weigh, in kg?',
    placeholder: 'e.g. 68',
    kind: 'number',
  },
  {
    key: 'exercise_frequency',
    prompt:
      "That's not all — depending on your goal and activity, we'll now adjust your Basal Metabolic Rate (BMR) into your Total Daily Energy Expenditure (TDEE). How often do you currently exercise per week?",
    hint: 'Depending on your activity level, we add up to 600 kcal per day to your needs.',
    kind: 'choice',
    options: EXERCISE_OPTIONS,
  },
  {
    key: 'daily_movement',
    prompt: 'And what does your day-to-day look like?',
    hint: 'Depending on your daily routine, we add up to 35% of your BMR on top.',
    kind: 'choice',
    options: MOVEMENT_OPTIONS,
  },
  {
    key: 'goal',
    prompt: 'And one last thing: which of these goals fits you best?',
    hint: "Depending on your choice, we'll lower your daily target, keep it the same, or raise it.",
    kind: 'choice',
    options: GOAL_OPTIONS,
  },
]

// ── Dynamic content (formulas, computed reveals) ─────────────────────────

const NAME_PROFILES_INTRO =
  "But I'll help you eat in a more balanced way so you stay healthy and reach your goals — by working out 2 targets for you:"
export const NAME_PROFILE_BULLETS = [
  '🔥 Calories — your energy balance and body weight',
  '💪 Macros — to fuel performance, muscle, and metabolism',
]
const NAME_BMR_INTRO =
  'To do that, I need a bit of information about you. Let’s start with the baseline: your Basal Metabolic Rate (BMR).'

const SEX_FORMULA_INTRO = 'Thanks. Here’s the actual formula:'
const SEX_FORMULA_NEXT =
  "So next up, I'll need your date of birth, your height, and your weight."

export function sexFormulaLine(sex: string): string {
  if (sex === 'male') {
    return 'BMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) + 5.'
  }
  if (sex === 'female') {
    return 'BMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) − 161.'
  }
  return 'BMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) − 78 (the midpoint between both, since you didn’t specify).'
}

// Client-side preview only, mirroring backend/app/services/ideal_profile.py's
// _bmr() exactly -- shown right after weight_kg, before the full profile is
// ever sent to the backend. The authoritative numbers come from the real
// POST /profile call once `goal` is answered.
export function previewBmr(
  sex: Sex,
  heightCm: number,
  weightKg: number,
  dateOfBirth: string,
): number | null {
  const dob = new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const hadBirthdayThisYear =
    now.getMonth() > dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate())
  if (!hadBirthdayThisYear) age -= 1

  const base = 10 * weightKg + 6.25 * heightCm - 5 * age
  const male = base + 5
  const female = base - 161
  if (sex === 'male') return Math.round(male)
  if (sex === 'female') return Math.round(female)
  return Math.round((male + female) / 2)
}

// ── TDEE chain preview (post-BMR steps) ──────────────────────────────────
// Mirrors backend/app/services/ideal_profile.py's compute_ideal_profile
// energy chain exactly (BR-E3 NEAT, BR-E4 EAT, BR-E6 goal adjustment), so
// the calorie-impact line shown right after exercise/movement/goal matches
// what POST /profile will actually return once the chat submits.

const NEAT_PCT: Record<DailyMovement, number> = {
  mostly_sitting: 0.0,
  mixed: 0.1,
  mostly_standing: 0.2,
  physical_labor: 0.35,
}

export const EAT_KCAL: Record<ExerciseFrequency, number> = {
  none: 0,
  one_two: 100,
  three_four: 250,
  five_six: 400,
  daily_athlete: 600,
}

const GOAL_ADJ: Record<Goal, number> = {
  lose_weight_gradually: -0.15,
  maintain: 0,
  build_muscle: 0.1,
}

export interface TdeeBreakdown {
  bmr: number
  neat: number
  eat: number
  tef: number
  tdee: number
}

export function previewTdeeBreakdown(ans: Answers): TdeeBreakdown | null {
  if (!ans.sex || !ans.date_of_birth || !ans.height_cm || !ans.weight_kg) return null
  const bmr = previewBmr(
    ans.sex as Sex,
    Number(ans.height_cm),
    Number(ans.weight_kg),
    ans.date_of_birth,
  )
  if (bmr === null) return null
  const movement = (ans.daily_movement || 'mostly_sitting') as DailyMovement
  const exercise = (ans.exercise_frequency || 'none') as ExerciseFrequency
  const neat = Math.round(bmr * NEAT_PCT[movement])
  const eat = EAT_KCAL[exercise]
  const tef = Math.round(0.1 * (bmr + neat + eat))
  return { bmr, neat, eat, tef, tdee: bmr + neat + eat + tef }
}

export function previewGoalAdjustmentKcal(goal: Goal, tdee: number): number {
  return Math.round(tdee * (1 + GOAL_ADJ[goal])) - tdee
}

export const EDIT_LATER_NOTE =
  'If anything about you changes, you can always adjust these later from the Onboarding page.'
export const CONTINUE_LABEL = 'Upload your first receipt'

export function nameProfilesIntro(): string {
  return NAME_PROFILES_INTRO
}
export function nameBmrIntro(): string {
  return NAME_BMR_INTRO
}
export function sexFormulaIntro(): string {
  return SEX_FORMULA_INTRO
}
export function sexFormulaNext(): string {
  return SEX_FORMULA_NEXT
}

export type Answers = {
  name: string
  sex: Sex | ''
  date_of_birth: string
  height_cm: string
  weight_kg: string
  exercise_frequency: ExerciseFrequency | ''
  daily_movement: DailyMovement | ''
  goal: Goal | ''
}

export const INITIAL_ANSWERS: Answers = {
  name: '',
  sex: '',
  date_of_birth: '',
  height_cm: '',
  weight_kg: '',
  exercise_frequency: '',
  daily_movement: '',
  goal: '',
}

const NUMERIC_RANGES: Record<string, { min: number; max: number }> = {
  height_cm: { min: 100, max: 250 },
  weight_kg: { min: 30, max: 300 },
}

export function rangeError(key: string, value: string): string | null {
  const range = NUMERIC_RANGES[key]
  if (!range || !value) return null
  const n = Number(value)
  if (Number.isNaN(n)) return 'Please enter a realistic value.'
  if (n < range.min || n > range.max) return 'Please enter a realistic value.'
  return null
}

export function answerLabel(step: StepDef, answers: Answers): string {
  const value = answers[step.key as keyof Answers]
  if (step.kind === 'choice') {
    return step.options?.find((o) => o.value === value)?.label ?? String(value || '—')
  }
  return (value as string) || '—'
}
