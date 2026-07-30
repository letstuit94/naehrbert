import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ApiError,
  createProfile,
  type ExerciseFrequency,
  type DailyMovement,
  type Goal,
  type IdealProfile,
  type ProfileInput,
  type Sex,
} from '../lib/api'
import {
  onboardingSteps,
  INITIAL_ANSWERS,
  editLaterNote,
  continueLabel,
  answerLabel,
  nameProfilesIntro,
  nameProfileBullets,
  nameBmrIntro,
  sexFormulaIntro,
  sexFormulaLine,
  sexFormulaNext,
  previewBmr,
  previewTdeeBreakdown,
  previewGoalAdjustmentKcal,
  EAT_KCAL,
  rangeError,
  type Answers,
  type StepDef,
} from '../lib/chatSteps'
import { useI18n, type TranslateFn } from '../lib/i18n'
import { ChatBubble, SequenceView, TypewriterText } from '../lib/chatEngine'
import {
  bulletList,
  nodeItem,
  renderStaticSequence,
  typedItem,
  type SeqItem,
} from '../lib/chatSequence'
import { setCurrentProfileId } from '../lib/session'

// Chat-style onboarding (Epic 1.1) -- a warmer alternative to a plain form,
// adapted from an earlier version of this app (see repo-root
// ChatOnboardingStep.tsx for the original, bilingual, resumable version).
// Everything the bot "says" is one continuous, strictly-ordered sequence of
// typed chat bubbles: the previous step's reply finishes typing before the
// next step's question starts, and that question's input controls only
// appear once the question itself has finished typing.
//
// The typewriter/bubble/sequencing machinery itself lives in
// ../lib/chatEngine.tsx, shared with the recipe-preferences chat
// (RecipeChatPage.tsx) -- everything below is onboarding-specific content
// built on top of that shared engine.

function bmrPreviewNode(t: TranslateFn, bmr: number): ReactNode {
  return (
    <>
      {t('Your BMR is:', 'Dein Grundumsatz beträgt:')} <strong>{bmr} kcal</strong>.
    </>
  )
}

function eatImpactNode(t: TranslateFn, kcal: number): ReactNode {
  if (kcal === 0) {
    return t(
      "No regular workouts right now, so we won't add anything extra for activity.",
      'Aktuell kein regelmäßiger Sport, also rechnen wir nichts Zusätzliches für Aktivität dazu.',
    )
  }
  return (
    <>
      {t('Great, that will add', 'Super, das ergänzt')}{' '}
      <strong>{kcal} kcal</strong> {t('to your daily target.', 'zu deinem Tagesziel.')}
    </>
  )
}

function neatImpactNode(t: TranslateFn, kcal: number): ReactNode {
  if (kcal === 0) {
    return t(
      "A mostly-sitting day doesn't add anything on top of your BMR.",
      'Ein überwiegend sitzender Tag rechnet nichts zu deinem Grundumsatz dazu.',
    )
  }
  return (
    <>
      {t('Got it, that adds another', 'Alles klar, das ergänzt weitere')}{' '}
      <strong>{kcal} kcal</strong> {t('to your daily target.', 'zu deinem Tagesziel.')}
    </>
  )
}

function goalImpactNode(t: TranslateFn, deltaKcal: number): ReactNode {
  if (deltaKcal < 0) {
    return (
      <>
        {t("Alright, then we'll reduce your calorie target by", 'Alles klar, dann senken wir dein Kalorienziel um')}{' '}
        <strong>{Math.abs(deltaKcal)} kcal</strong>.
      </>
    )
  }
  if (deltaKcal > 0) {
    return (
      <>
        {t("Great, then we'll increase your calorie target by", 'Super, dann erhöhen wir dein Kalorienziel um')}{' '}
        <strong>{deltaKcal} kcal</strong>.
      </>
    )
  }
  return t(
    "Got it, we'll keep your calorie target right where it is.",
    'Alles klar, dann lassen wir dein Kalorienziel genau so, wie es ist.',
  )
}

function calorieResultNode(t: TranslateFn, ideal: IdealProfile): ReactNode {
  return (
    <>
      {t('Your daily calorie target is about', 'Dein tägliches Kalorienziel liegt bei etwa')}{' '}
      <strong>{ideal.calories_kcal} kcal</strong>.
    </>
  )
}

function macroListNode(t: TranslateFn, ideal: IdealProfile): ReactNode {
  return (
    <>
      <p className="chat-bullets-intro">
        {t('Your macros should ideally be split like this:', 'Deine Makros sollten idealerweise so aufgeteilt sein:')}
      </p>
      <ul className="chat-bullets">
        <li>
          <strong>{ideal.carbs_g}g</strong> {t('carbs', 'Kohlenhydrate')}
        </li>
        <li>
          <strong>{ideal.protein_g}g</strong> {t('protein', 'Protein')}
        </li>
        <li>
          <strong>{ideal.fat_g}g</strong> {t('fat', 'Fett')}
        </li>
      </ul>
    </>
  )
}

// ── Per-step sequence builders ────────────────────────────────────────────

function askSequenceFor(step: StepDef): SeqItem[] {
  const items: SeqItem[] = []
  if (step.promptIntro) items.push(...step.promptIntro.map(typedItem))
  items.push(typedItem(step.prompt))
  if (step.hint) items.push(typedItem(step.hint))
  return items
}

function replySequenceFor(t: TranslateFn, step: StepDef, ans: Answers): SeqItem[] {
  if (step.key === 'name') {
    return [
      typedItem(step.feedback!),
      typedItem(nameProfilesIntro(t)),
      nodeItem(bulletList(nameProfileBullets(t))),
      typedItem(nameBmrIntro(t)),
    ]
  }
  if (step.key === 'sex') {
    return [
      typedItem(sexFormulaIntro(t)),
      typedItem(sexFormulaLine(t, ans.sex)),
      typedItem(sexFormulaNext(t)),
    ]
  }
  if (
    step.key === 'weight_kg' &&
    ans.sex &&
    ans.date_of_birth &&
    ans.height_cm &&
    ans.weight_kg
  ) {
    const bmr = previewBmr(
      ans.sex as Sex,
      Number(ans.height_cm),
      Number(ans.weight_kg),
      ans.date_of_birth,
    )
    if (bmr !== null) return [nodeItem(bmrPreviewNode(t, bmr))]
  }
  if (step.key === 'exercise_frequency' && ans.exercise_frequency) {
    const kcal = EAT_KCAL[ans.exercise_frequency as ExerciseFrequency]
    return [nodeItem(eatImpactNode(t, kcal))]
  }
  if (step.key === 'daily_movement' && ans.daily_movement) {
    const breakdown = previewTdeeBreakdown(ans)
    if (breakdown) return [nodeItem(neatImpactNode(t, breakdown.neat))]
  }
  if (step.key === 'goal' && ans.goal) {
    const breakdown = previewTdeeBreakdown(ans)
    if (breakdown) {
      const delta = previewGoalAdjustmentKcal(ans.goal as Goal, breakdown.tdee)
      return [nodeItem(goalImpactNode(t, delta))]
    }
  }
  return step.feedback ? [typedItem(step.feedback)] : []
}

function revealSequence(t: TranslateFn, ideal: IdealProfile | null): SeqItem[] {
  if (!ideal) return []
  return [
    nodeItem(calorieResultNode(t, ideal)),
    nodeItem(macroListNode(t, ideal)),
    typedItem(editLaterNote(t)),
  ]
}

function dobValidationError(t: TranslateFn, value: string): string | null {
  const dob = new Date(value)
  const now = new Date()
  const age = (now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  if (Number.isNaN(dob.getTime()) || dob > now || age > 120) {
    return t('Please enter a valid date of birth.', 'Bitte gib ein gültiges Geburtsdatum ein.')
  }
  return null
}

// ── Main component ────────────────────────────────────────────────────────

export function OnboardingPage() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const steps = onboardingSteps(t)
  const [answers, setAnswers] = useState<Answers>(INITIAL_ANSWERS)
  const [draftText, setDraftText] = useState('')
  const [phase, setPhase] = useState<'chat' | 'saving' | 'reveal'>('chat')
  const [error, setError] = useState<string | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [turnQueue, setTurnQueue] = useState<SeqItem[]>(() =>
    askSequenceFor(onboardingSteps(t)[0]),
  )
  const [turnReplyCount, setTurnReplyCount] = useState(0)
  const [turnRevealed, setTurnRevealed] = useState(0)
  const historyRef = useRef<HTMLDivElement>(null)

  const busy = phase !== 'chat'
  const done = phase !== 'chat'
  const current = steps[Math.min(stepIndex, steps.length - 1)]
  const askDone = turnRevealed >= turnQueue.length
  const answeredSteps = phase === 'chat' ? steps.slice(0, stepIndex) : steps

  function advanceTurn() {
    setTurnRevealed((r) => r + 1)
  }

  useEffect(() => {
    if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight
  }, [stepIndex, phase, turnRevealed])

  // Reaching this page always means "create a brand-new user" -- never
  // "edit my own profile" (that's the Profile page's job) -- so drop any
  // stale login first. Otherwise a leftover X-Profile-Id from a previous
  // session would make submit() below silently overwrite that user's
  // profile instead of creating a new one (multi-user feature).
  useEffect(() => {
    setCurrentProfileId(null)
  }, [])

  function saveEdit(key: string, value: string) {
    setAnswers((prev) => ({ ...prev, [key]: value }))
    setEditingKey(null)
  }

  // Placeholder profile for users who'd rather fill in their details on the
  // Profile page than through the chat -- ProfileCreate requires all 7
  // biometric fields (no defaults), so a genuinely empty profile isn't
  // possible; every value here is immediately editable on /profile via the
  // same createProfile() call ProfilePage's saveField() already reuses.
  async function skipOnboarding() {
    setPhase('saving')
    setError(null)
    try {
      const result = await createProfile({
        name: null,
        sex: 'prefer_not_to_say',
        date_of_birth: '2000-01-01',
        height_cm: 170,
        weight_kg: 70,
        exercise_frequency: 'none',
        daily_movement: 'mostly_sitting',
        goal: 'maintain',
        household_size: null,
        consumption_share_pct: null,
      })
      setCurrentProfileId(result.profile.id)
      navigate('/profile')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t(
              'Could not skip onboarding. Please try again.',
              'Onboarding konnte nicht übersprungen werden. Bitte versuche es erneut.',
            ),
      )
      setPhase('chat')
    }
  }

  async function submit(finalAnswers: Answers) {
    setPhase('saving')
    setError(null)
    try {
      const payload: ProfileInput = {
        name: finalAnswers.name.trim() || null,
        sex: finalAnswers.sex as Sex,
        date_of_birth: finalAnswers.date_of_birth,
        height_cm: Number(finalAnswers.height_cm),
        weight_kg: Number(finalAnswers.weight_kg),
        exercise_frequency: finalAnswers.exercise_frequency as ExerciseFrequency,
        daily_movement: finalAnswers.daily_movement as DailyMovement,
        goal: finalAnswers.goal as Goal,
        household_size: finalAnswers.household_size
          ? Number(finalAnswers.household_size)
          : null,
        consumption_share_pct: finalAnswers.consumption_share_pct
          ? Number(finalAnswers.consumption_share_pct)
          : null,
      }
      const result = await createProfile(payload)
      setCurrentProfileId(result.profile.id)
      setTurnQueue(revealSequence(t, result.targets))
      setTurnReplyCount(0)
      setTurnRevealed(0)
      setPhase('reveal')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t(
              'Could not save your profile. Please try again.',
              'Dein Profil konnte nicht gespeichert werden. Bitte versuche es erneut.',
            ),
      )
      setPhase('chat')
    }
  }

  function advance(next: Answers) {
    setDraftText('')
    setInputError(null)
    setEditingKey(null)
    const nextStep = steps[stepIndex + 1]
    const reply = replySequenceFor(t, current, next)
    const ask = askSequenceFor(nextStep)
    setTurnQueue([...reply, ...ask])
    setTurnReplyCount(reply.length)
    setTurnRevealed(0)
    setStepIndex((i) => i + 1)
  }

  function goNext(next: Answers) {
    if (stepIndex >= steps.length - 1) {
      submit(next)
    } else {
      advance(next)
    }
  }

  function handleChoice(value: string) {
    const next = { ...answers, [current.key]: value }
    setAnswers(next)
    goNext(next)
  }

  function handleTextSubmit() {
    const trimmed = draftText.trim()
    if (!trimmed) return
    const err =
      current.key === 'date_of_birth'
        ? dobValidationError(t, trimmed)
        : rangeError(t, current.key, trimmed)
    if (err) {
      setInputError(err)
      return
    }
    const next = { ...answers, [current.key]: trimmed }
    setAnswers(next)
    goNext(next)
  }

  return (
    <section>
      <div className="summary-line">
        <h1>{t('Onboarding', 'Onboarding')}</h1>
        {!busy && (
          <button type="button" className="btn-link" onClick={skipOnboarding}>
            {t('Skip onboarding', 'Onboarding überspringen')}
          </button>
        )}
      </div>
      <div className="chat-card">
        <div ref={historyRef} className="chat-history">
          {answeredSteps.map((step, stepPos) => {
            const isLastAnswered = stepPos === answeredSteps.length - 1
            const liveReply = phase === 'chat' && isLastAnswered
            const replyItems = liveReply
              ? turnQueue.slice(0, turnReplyCount)
              : replySequenceFor(t, step, answers)
            return (
              <div key={step.key} className="chat-turn">
                {renderStaticSequence(askSequenceFor(step))}
                {editingKey === step.key ? (
                  <InlineAnswerEditor
                    step={step}
                    value={answers[step.key as keyof Answers]}
                    onSave={(value) => saveEdit(step.key, value)}
                    onCancel={() => setEditingKey(null)}
                  />
                ) : (
                  <>
                    <ChatBubble from="user">{answerLabel(step, answers)}</ChatBubble>
                    {!done && (
                      <div className="chat-edit-row">
                        <button
                          type="button"
                          className="btn-link"
                          onClick={() => setEditingKey(step.key)}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                    {liveReply ? (
                      <SequenceView
                        items={replyItems}
                        globalOffset={0}
                        turnRevealed={turnRevealed}
                        onAdvance={advanceTurn}
                      />
                    ) : (
                      renderStaticSequence(replyItems)
                    )}
                  </>
                )}
              </div>
            )
          })}

          <div
            className={
              answeredSteps.length > 0 ? 'chat-turn chat-turn--current' : 'chat-turn'
            }
          >
            {phase === 'chat' ? (
              <SequenceView
                items={turnQueue.slice(turnReplyCount)}
                globalOffset={turnReplyCount}
                turnRevealed={turnRevealed}
                onAdvance={advanceTurn}
              />
            ) : phase === 'saving' ? (
              <ChatBubble from="bot">
                <TypewriterText
                  text={t('All set — saving your profile…', 'Alles bereit – dein Profil wird gespeichert…')}
                />

              </ChatBubble>
            ) : (
              <SequenceView
                items={turnQueue}
                globalOffset={0}
                turnRevealed={turnRevealed}
                onAdvance={advanceTurn}
              />
            )}
          </div>
        </div>

        {phase === 'reveal' && askDone && (
          <div className="chat-footer">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/upload')}
            >
              {continueLabel(t)}
            </button>
          </div>
        )}

        {phase === 'chat' && askDone && (
          <div className="chat-footer">
            {current.kind === 'choice' && (
              <div className="chat-choices">
                {current.options!.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={busy}
                    className="chat-choice"
                    onClick={() => handleChoice(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
            {(current.kind === 'text' ||
              current.kind === 'number' ||
              current.kind === 'date') && (
              <div className="form-field">
                <div className="chat-input-row">
                  <input
                    type={
                      current.kind === 'number'
                        ? 'number'
                        : current.kind === 'date'
                          ? 'date'
                          : 'text'
                    }
                    placeholder={current.placeholder}
                    value={draftText}
                    onChange={(e) => {
                      setDraftText(e.target.value)
                      setInputError(null)
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && handleTextSubmit()}
                    autoFocus
                  />
                  <button
                    type="button"
                    disabled={busy}
                    className="btn btn-primary"
                    onClick={handleTextSubmit}
                  >
                    Send
                  </button>
                </div>
                {inputError && (
                  <p className="form-error" role="alert">
                    {inputError}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

function InlineAnswerEditor({
  step,
  value,
  onSave,
  onCancel,
}: {
  step: StepDef
  value: unknown
  onSave: (value: string) => void
  onCancel: () => void
}) {
  const [textDraft, setTextDraft] = useState(String(value ?? ''))

  if (step.kind === 'choice') {
    return (
      <div className="chat-choices">
        {step.options!.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={
              opt.value === value ? 'chat-choice chat-choice--selected' : 'chat-choice'
            }
            onClick={() => onSave(opt.value)}
          >
            {opt.label}
          </button>
        ))}
        <button type="button" className="btn-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <div className="chat-input-row">
      <input
        type={step.kind === 'number' ? 'number' : step.kind === 'date' ? 'date' : 'text'}
        value={textDraft}
        onChange={(e) => setTextDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onSave(textDraft.trim())}
        autoFocus
      />
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => onSave(textDraft.trim())}
      >
        Save
      </button>
      <button type="button" className="btn-link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
