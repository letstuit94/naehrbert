import type { DailyMovement, ExerciseFrequency, Goal, Sex } from './api'
import type { TranslateFn } from './i18n'

/**
 * Content for the chat-style onboarding (Epic 1.1).
 *
 * All user-facing strings are language-dependent, so the option lists and the
 * step list are factory functions taking the `t(en, de)` translate fn from
 * useI18n() rather than plain constants. The `value`s (stored / sent to the
 * backend) are language-independent and never change.
 *
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

export function sexOptions(t: TranslateFn): Option[] {
  return [
    { value: 'female', label: t('Female', 'Weiblich') },
    { value: 'male', label: t('Male', 'Männlich') },
    { value: 'prefer_not_to_say', label: t('Prefer not to say', 'Keine Angabe') },
  ]
}

export function exerciseOptions(t: TranslateFn): Option[] {
  return [
    { value: 'none', label: t('🛋️ Rarely / never', '🛋️ Selten / nie') },
    { value: 'one_two', label: t('🚶 1-2× per week', '🚶 1–2× pro Woche') },
    { value: 'three_four', label: t('🏃 3-4× per week', '🏃 3–4× pro Woche') },
    { value: 'five_six', label: t('💪 5-6× per week', '💪 5–6× pro Woche') },
    { value: 'daily_athlete', label: t('🏅 Daily / athlete', '🏅 Täglich / sportlich') },
  ]
}

export function movementOptions(t: TranslateFn): Option[] {
  return [
    { value: 'mostly_sitting', label: t('🪑 Mostly sitting', '🪑 Überwiegend sitzend') },
    {
      value: 'mixed',
      label: t('🔀 A mix of sitting & moving', '🔀 Mischung aus Sitzen & Bewegung'),
    },
    {
      value: 'mostly_standing',
      label: t('🧍 Mostly on my feet', '🧍 Überwiegend auf den Beinen'),
    },
    { value: 'physical_labor', label: t('🏗️ Physical labor', '🏗️ Körperliche Arbeit') },
  ]
}

export function goalOptions(t: TranslateFn): Option[] {
  return [
    { value: 'lose_weight_gradually', label: t('⚖️ Lose fat', '⚖️ Fett verlieren') },
    { value: 'maintain', label: t('🧭 Maintain weight', '🧭 Gewicht halten') },
    { value: 'build_muscle', label: t('🏋️ Build muscle', '🏋️ Muskeln aufbauen') },
  ]
}

/** The goal label without its leading emoji token, keyed by value. */
export function goalLabel(t: TranslateFn, value: Goal): string {
  const label = goalOptions(t).find((o) => o.value === value)?.label ?? value
  return label.replace(/^\S+\s/, '')
}

export function onboardingSteps(t: TranslateFn): StepDef[] {
  return [
    {
      key: 'name',
      promptIntro: [
        t(
          "Hi, I'm Nährbert — your companion for healthy eating and smart grocery shopping.",
          'Hi, ich bin Nährbert – dein Begleiter für gesunde Ernährung und cleveres Einkaufen.',
        ),
      ],
      prompt: t(
        'So I can address you properly from now on: what should I call you?',
        'Damit ich dich ab jetzt richtig ansprechen kann: Wie soll ich dich nennen?',
      ),
      kind: 'text',
      placeholder: t('Your name', 'Dein Name'),
      feedback: t(
        "Quick heads-up: I can't replace medical advice, and I'm not a dietitian in the traditional sense.",
        'Kurzer Hinweis: Ich kann keine ärztliche Beratung ersetzen und bin auch keine Ernährungsberatung im klassischen Sinne.',
      ),
    },
    {
      key: 'sex',
      prompt: t(
        'What sex were you assigned at birth?',
        'Welches Geschlecht wurde dir bei der Geburt zugewiesen?',
      ),
      hint: t(
        "Sorry if that sounds a little odd — being biologically male or female meaningfully affects your energy needs. If you'd rather not say, that's fine too: I'll just use the midpoint of both.",
        'Entschuldige, falls das etwas seltsam klingt – biologisch männlich oder weiblich zu sein beeinflusst deinen Energiebedarf spürbar. Wenn du es lieber nicht angeben möchtest, ist das auch okay: Dann nehme ich einfach den Mittelwert aus beiden.',
      ),
      kind: 'choice',
      options: sexOptions(t),
    },
    {
      key: 'date_of_birth',
      prompt: t('When were you born?', 'Wann bist du geboren?'),
      kind: 'date',
    },
    {
      key: 'height_cm',
      prompt: t('How tall are you, in cm?', 'Wie groß bist du (in cm)?'),
      placeholder: t('e.g. 170', 'z. B. 170'),
      kind: 'number',
    },
    {
      key: 'weight_kg',
      prompt: t('And how much do you weigh, in kg?', 'Und wie viel wiegst du (in kg)?'),
      placeholder: t('e.g. 68', 'z. B. 68'),
      kind: 'number',
    },
    {
      key: 'exercise_frequency',
      prompt: t(
        "That's not all — depending on your goal and activity, we'll now adjust your Basal Metabolic Rate (BMR) into your Total Daily Energy Expenditure (TDEE). How often do you currently exercise per week?",
        'Das ist noch nicht alles – je nach Ziel und Aktivität passen wir nun deinen Grundumsatz (BMR) zu deinem Gesamtumsatz (TDEE) an. Wie oft treibst du aktuell pro Woche Sport?',
      ),
      hint: t(
        'Depending on your activity level, we add up to 600 kcal per day to your needs.',
        'Je nach Aktivitätslevel rechnen wir bis zu 600 kcal pro Tag zu deinem Bedarf hinzu.',
      ),
      kind: 'choice',
      options: exerciseOptions(t),
    },
    {
      key: 'daily_movement',
      prompt: t('And what does your day-to-day look like?', 'Und wie sieht dein Alltag aus?'),
      hint: t(
        'Depending on your daily routine, we add up to 35% of your BMR on top.',
        'Je nach Alltag rechnen wir bis zu 35 % deines Grundumsatzes obendrauf.',
      ),
      kind: 'choice',
      options: movementOptions(t),
    },
    {
      key: 'goal',
      prompt: t(
        'Which of these goals fits you best?',
        'Welches dieser Ziele passt am besten zu dir?',
      ),
      hint: t(
        "Depending on your choice, we'll lower your daily target, keep it the same, or raise it.",
        'Je nach Auswahl senken wir dein Tagesziel, lassen es gleich oder erhöhen es.',
      ),
      kind: 'choice',
      options: goalOptions(t),
    },
    {
      key: 'household_size',
      prompt: t(
        'Almost done — how many people do you typically shop for when you go grocery shopping?',
        'Fast geschafft – für wie viele Personen kaufst du beim Einkaufen typischerweise ein?',
      ),
      hint: t(
        "This helps us judge how much of what's bought is actually just for you.",
        'Das hilft uns einzuschätzen, wie viel vom Eingekauften tatsächlich nur für dich ist.',
      ),
      placeholder: t('e.g. 2', 'z. B. 2'),
      kind: 'number',
      feedback: t('Got it, thanks!', 'Alles klar, danke!'),
    },
    {
      key: 'consumption_share_pct',
      prompt: t(
        'And roughly what share of those groceries would you say you personally eat?',
        'Und welchen Anteil dieser Lebensmittel isst du ungefähr selbst?',
      ),
      hint: t(
        "A rough % estimate is fine — this helps us scale your results accurately if you're not the only one eating from what's bought.",
        'Eine grobe %-Schätzung reicht – so können wir deine Ergebnisse korrekt skalieren, falls noch andere vom Eingekauften mitessen.',
      ),
      placeholder: t('e.g. 50', 'z. B. 50'),
      kind: 'number',
      feedback: t(
        "Perfect — that's everything I need!",
        'Perfekt – das ist alles, was ich brauche!',
      ),
    },
  ]
}

// ── Dynamic content (formulas, computed reveals) ─────────────────────────

export function nameProfileBullets(t: TranslateFn): string[] {
  return [
    t(
      '🔥 Calories — your energy balance and body weight',
      '🔥 Kalorien – deine Energiebilanz und dein Körpergewicht',
    ),
    t(
      '💪 Macros — to fuel performance, muscle, and metabolism',
      '💪 Makros – für Leistung, Muskeln und Stoffwechsel',
    ),
  ]
}

export function nameProfilesIntro(t: TranslateFn): string {
  return t(
    "But I'll help you eat in a more balanced way so you stay healthy and reach your goals — by working out 2 targets for you:",
    'Aber ich helfe dir, ausgewogener zu essen, damit du gesund bleibst und deine Ziele erreichst – indem ich 2 Zielwerte für dich ermittle:',
  )
}

export function nameBmrIntro(t: TranslateFn): string {
  return t(
    'To do that, I need a bit of information about you. Let’s start with the baseline: your Basal Metabolic Rate (BMR).',
    'Dafür brauche ich ein paar Infos über dich. Fangen wir mit der Grundlage an: deinem Grundumsatz (BMR).',
  )
}

export function sexFormulaIntro(t: TranslateFn): string {
  return t('Thanks. Here’s the actual formula:', 'Danke. Hier ist die eigentliche Formel:')
}

export function sexFormulaNext(t: TranslateFn): string {
  return t(
    "So next up, I'll need your date of birth, your height, and your weight.",
    'Als Nächstes brauche ich dein Geburtsdatum, deine Größe und dein Gewicht.',
  )
}

export function sexFormulaLine(t: TranslateFn, sex: string): string {
  if (sex === 'male') {
    return t(
      'BMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) + 5.',
      'BMR = 10 × Gewicht (kg) + 6,25 × Größe (cm) − 5 × Alter (Jahre) + 5.',
    )
  }
  if (sex === 'female') {
    return t(
      'BMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) − 161.',
      'BMR = 10 × Gewicht (kg) + 6,25 × Größe (cm) − 5 × Alter (Jahre) − 161.',
    )
  }
  return t(
    'BMR = 10 × weight (kg) + 6.25 × height (cm) − 5 × age (years) − 78 (the midpoint between both, since you didn’t specify).',
    'BMR = 10 × Gewicht (kg) + 6,25 × Größe (cm) − 5 × Alter (Jahre) − 78 (der Mittelwert aus beiden, da du keine Angabe gemacht hast).',
  )
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

export function editLaterNote(t: TranslateFn): string {
  return t(
    'If anything about you changes, you can always adjust these later from the Onboarding page.',
    'Falls sich bei dir etwas ändert, kannst du das jederzeit später auf der Onboarding-Seite anpassen.',
  )
}

export function continueLabel(t: TranslateFn): string {
  return t('Upload your first receipt', 'Lade deinen ersten Kassenbon hoch')
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
  household_size: string
  consumption_share_pct: string
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
  household_size: '',
  consumption_share_pct: '',
}

const NUMERIC_RANGES: Record<string, { min: number; max: number }> = {
  height_cm: { min: 100, max: 250 },
  weight_kg: { min: 30, max: 300 },
  household_size: { min: 1, max: 20 },
  consumption_share_pct: { min: 1, max: 100 },
}

export function rangeError(t: TranslateFn, key: string, value: string): string | null {
  const range = NUMERIC_RANGES[key]
  if (!range || !value) return null
  const n = Number(value)
  const invalid = t('Please enter a realistic value.', 'Bitte gib einen realistischen Wert ein.')
  if (Number.isNaN(n)) return invalid
  if (n < range.min || n > range.max) return invalid
  return null
}

// The <input type="date"> control always yields/expects ISO "YYYY-MM-DD"
// (native browser behavior, locale-independent) -- that's what's stored in
// Answers and sent to the backend unchanged. This is purely a display
// concern: the chat bubble showing "what you answered" should read back in
// the DD.MM.YYYY shape people actually typed, not the raw ISO string.
function formatDateForDisplay(iso: string): string {
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day) return iso
  return `${day}.${month}.${year}`
}

export function answerLabel(step: StepDef, answers: Answers): string {
  const value = answers[step.key as keyof Answers]
  if (step.kind === 'choice') {
    return step.options?.find((o) => o.value === value)?.label ?? String(value || '—')
  }
  if (step.kind === 'date' && value) {
    return formatDateForDisplay(value as string)
  }
  return (value as string) || '—'
}
