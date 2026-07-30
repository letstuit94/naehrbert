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
  ONBOARDING_STEPS,
  INITIAL_ANSWERS,
  EDIT_LATER_NOTE,
  CONTINUE_LABEL,
  answerLabel,
  nameProfilesIntro,
  NAME_PROFILE_BULLETS,
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
import { ChatBubble, SequenceView, TypewriterText } from '../lib/chatEngine'
import {
  bulletList,
  nodeItem,
  renderStaticSequence,
  typedItem,
  type SeqItem,
} from '../lib/chatSequence'
import { useAuth } from '../lib/authContext'

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

function bmrPreviewNode(bmr: number): ReactNode {
  return (
    <>
      Your BMR is: <strong>{bmr} kcal</strong>.
    </>
  )
}

function eatImpactNode(kcal: number): ReactNode {
  if (kcal === 0) {
    return "No regular workouts right now, so we won't add anything extra for activity."
  }
  return (
    <>
      Great, that will add <strong>{kcal} kcal</strong> to your daily target.
    </>
  )
}

function neatImpactNode(kcal: number): ReactNode {
  if (kcal === 0) {
    return "A mostly-sitting day doesn't add anything on top of your BMR."
  }
  return (
    <>
      Got it, that adds another <strong>{kcal} kcal</strong> to your daily target.
    </>
  )
}

function goalImpactNode(deltaKcal: number): ReactNode {
  if (deltaKcal < 0) {
    return (
      <>
        Alright, then we'll reduce your calorie target by{' '}
        <strong>{Math.abs(deltaKcal)} kcal</strong>.
      </>
    )
  }
  if (deltaKcal > 0) {
    return (
      <>
        Great, then we'll increase your calorie target by{' '}
        <strong>{deltaKcal} kcal</strong>.
      </>
    )
  }
  return "Got it, we'll keep your calorie target right where it is."
}

function calorieResultNode(ideal: IdealProfile): ReactNode {
  return (
    <>
      Your daily calorie target is about <strong>{ideal.calories_kcal} kcal</strong>.
    </>
  )
}

function macroListNode(ideal: IdealProfile): ReactNode {
  return (
    <>
      <p className="chat-bullets-intro">Your macros should ideally be split like this:</p>
      <ul className="chat-bullets">
        <li>
          <strong>{ideal.carbs_g}g</strong> carbs
        </li>
        <li>
          <strong>{ideal.protein_g}g</strong> protein
        </li>
        <li>
          <strong>{ideal.fat_g}g</strong> fat
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

function replySequenceFor(step: StepDef, ans: Answers): SeqItem[] {
  if (step.key === 'name') {
    return [
      typedItem(step.feedback!),
      typedItem(nameProfilesIntro()),
      nodeItem(bulletList(NAME_PROFILE_BULLETS)),
      typedItem(nameBmrIntro()),
    ]
  }
  if (step.key === 'sex') {
    return [
      typedItem(sexFormulaIntro()),
      typedItem(sexFormulaLine(ans.sex)),
      typedItem(sexFormulaNext()),
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
    if (bmr !== null) return [nodeItem(bmrPreviewNode(bmr))]
  }
  if (step.key === 'exercise_frequency' && ans.exercise_frequency) {
    const kcal = EAT_KCAL[ans.exercise_frequency as ExerciseFrequency]
    return [nodeItem(eatImpactNode(kcal))]
  }
  if (step.key === 'daily_movement' && ans.daily_movement) {
    const breakdown = previewTdeeBreakdown(ans)
    if (breakdown) return [nodeItem(neatImpactNode(breakdown.neat))]
  }
  if (step.key === 'goal' && ans.goal) {
    const breakdown = previewTdeeBreakdown(ans)
    if (breakdown) {
      const delta = previewGoalAdjustmentKcal(ans.goal as Goal, breakdown.tdee)
      return [nodeItem(goalImpactNode(delta))]
    }
  }
  return step.feedback ? [typedItem(step.feedback)] : []
}

function revealSequence(ideal: IdealProfile | null): SeqItem[] {
  if (!ideal) return []
  return [
    nodeItem(calorieResultNode(ideal)),
    nodeItem(macroListNode(ideal)),
    typedItem(EDIT_LATER_NOTE),
  ]
}

function dobValidationError(value: string): string | null {
  const dob = new Date(value)
  const now = new Date()
  const age = (now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  if (Number.isNaN(dob.getTime()) || dob > now || age > 120) {
    return 'Please enter a valid date of birth.'
  }
  return null
}

// ── Main component ────────────────────────────────────────────────────────

export function OnboardingPage() {
  const navigate = useNavigate()
  const { refresh } = useAuth()
  const [answers, setAnswers] = useState<Answers>(INITIAL_ANSWERS)
  const [draftText, setDraftText] = useState('')
  const [phase, setPhase] = useState<'chat' | 'saving' | 'reveal'>('chat')
  const [error, setError] = useState<string | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [turnQueue, setTurnQueue] = useState<SeqItem[]>(() =>
    askSequenceFor(ONBOARDING_STEPS[0]),
  )
  const [turnReplyCount, setTurnReplyCount] = useState(0)
  const [turnRevealed, setTurnRevealed] = useState(0)
  const historyRef = useRef<HTMLDivElement>(null)

  const busy = phase !== 'chat'
  const done = phase !== 'chat'
  const current = ONBOARDING_STEPS[Math.min(stepIndex, ONBOARDING_STEPS.length - 1)]
  const askDone = turnRevealed >= turnQueue.length
  const answeredSteps =
    phase === 'chat' ? ONBOARDING_STEPS.slice(0, stepIndex) : ONBOARDING_STEPS

  function advanceTurn() {
    setTurnRevealed((r) => r + 1)
  }

  useEffect(() => {
    if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight
  }, [stepIndex, phase, turnRevealed])

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
      await createProfile({
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
      await refresh()
      navigate('/profile')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not skip onboarding. Please try again.',
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
      await refresh()
      setTurnQueue(revealSequence(result.targets))
      setTurnReplyCount(0)
      setTurnRevealed(0)
      setPhase('reveal')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not save your profile. Please try again.',
      )
      setPhase('chat')
    }
  }

  function advance(next: Answers) {
    setDraftText('')
    setInputError(null)
    setEditingKey(null)
    const nextStep = ONBOARDING_STEPS[stepIndex + 1]
    const reply = replySequenceFor(current, next)
    const ask = askSequenceFor(nextStep)
    setTurnQueue([...reply, ...ask])
    setTurnReplyCount(reply.length)
    setTurnRevealed(0)
    setStepIndex((i) => i + 1)
  }

  function goNext(next: Answers) {
    if (stepIndex >= ONBOARDING_STEPS.length - 1) {
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
        ? dobValidationError(trimmed)
        : rangeError(current.key, trimmed)
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
        <h1>Onboarding</h1>
        {!busy && (
          <button type="button" className="btn-link" onClick={skipOnboarding}>
            Skip onboarding
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
              : replySequenceFor(step, answers)
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
                <TypewriterText text="All set — saving your profile…" />
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
              {CONTINUE_LABEL}
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
