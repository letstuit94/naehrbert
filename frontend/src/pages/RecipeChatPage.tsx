import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ApiError,
  getInferredDietaryStyle,
  getProfile,
  submitFeedback,
  updateDietaryPreferences,
  type DietaryStyle,
} from '../lib/api'
import { ChatBubble, SequenceView, TypewriterText } from '../lib/chatEngine'
import { renderStaticSequence, typedItem, type SeqItem } from '../lib/chatSequence'
import { ALLERGEN_OPTIONS, DIETARY_STYLE_OPTIONS } from '../lib/recipePrefsSteps'
import { ChipListInput } from '../components/ChipListInput'

// The recipe-preferences chat (recipe recommendations feature): built on
// the same chat engine as OnboardingPage.tsx. Runs every time the button
// is tapped (pre-filled from whatever was saved last time, so revisiting
// feels like a review rather than starting over) -- this chat only ever
// collects NPS feedback + dietary style/allergies/dislikes, it never
// generates a recipe itself. Recipe generation is a separate, repeatable
// action on the Results page (ResultsPage.tsx), which also takes
// cuisine/time/servings inputs.

type PhaseKey = 'nps' | 'diet' | 'allergies' | 'dislikes'
const PHASE_ORDER: PhaseKey[] = ['nps', 'diet', 'allergies', 'dislikes']

type Stage = 'loading' | 'chat' | 'saving' | 'error'

interface Answers {
  npsScore: number | null
  dietaryStyle: DietaryStyle | null
  allergies: string[]
  dislikes: string[]
}

function styleNoun(style: DietaryStyle): string {
  const found = DIETARY_STYLE_OPTIONS.find((o) => o.value === style)
  return found ? found.label.replace(/^\S+\s/, '').toLowerCase() : style
}

type StyleSource = 'saved' | 'inferred' | null

function askFor(
  phase: PhaseKey,
  name: string | null,
  inferredStyle: DietaryStyle | null,
  styleSource: StyleSource,
): SeqItem[] {
  if (phase === 'nps') {
    return [
      typedItem(name ? `Hey ${name}! 🎉` : 'Hey there! 🎉'),
      typedItem(
        "Congrats on the progress so far -- you've uploaded enough matched food items to unlock recipe recommendations.",
      ),
      typedItem(
        'I would love to hear how you like the app so far. How likely is it that you would recommend it to friends and family on a scale of 1 to 10?',
      ),
    ]
  }
  if (phase === 'diet') {
    if (styleSource === 'saved' && inferredStyle) {
      return [
        typedItem(
          `Last time you told me you eat mostly ${styleNoun(inferredStyle)}. Still right, or would you like to change it?`,
        ),
      ]
    }
    if (styleSource === 'inferred' && inferredStyle) {
      return [
        typedItem(
          `Based on your purchases so far, it looks like you eat mostly ${styleNoun(inferredStyle)}. Does that sound right, or should I correct it?`,
        ),
      ]
    }
    return [typedItem('How would you describe how you eat?')]
  }
  if (phase === 'allergies') {
    return [typedItem('Do you have any allergies or intolerances I should know about?')]
  }
  return [typedItem("And finally -- are there any foods you just don't like?")]
}

function replyFor(phase: PhaseKey, answers: Answers): SeqItem[] {
  if (phase === 'nps') {
    return [
      typedItem('Thank you for sharing that!'),
      typedItem(
        'Before I can start recommending you healthy recipes to close your nutrient gaps, I have a few more questions.',
      ),
    ]
  }
  if (phase === 'diet') return [typedItem('Got it, noted.')]
  if (phase === 'allergies') {
    return [
      typedItem(
        answers.allergies.length > 0
          ? "Thanks, I'll steer clear of those."
          : 'Good to know, thanks!',
      ),
    ]
  }
  return []
}

function answerLabel(phase: PhaseKey, answers: Answers): ReactNode {
  if (phase === 'nps') return String(answers.npsScore)
  if (phase === 'diet') {
    const opt = DIETARY_STYLE_OPTIONS.find((o) => o.value === answers.dietaryStyle)
    return opt ? opt.label : '—'
  }
  if (phase === 'allergies')
    return answers.allergies.length ? answers.allergies.join(', ') : 'None'
  return answers.dislikes.length ? answers.dislikes.join(', ') : 'None'
}

export function RecipeChatPage() {
  const navigate = useNavigate()
  const [stage, setStage] = useState<Stage>('loading')
  const [error, setError] = useState<string | null>(null)

  const [profileName, setProfileName] = useState<string | null>(null)
  const [inferredStyle, setInferredStyle] = useState<DietaryStyle | null>(null)
  const [styleSource, setStyleSource] = useState<StyleSource>(null)

  const [phaseIndex, setPhaseIndex] = useState(0)
  const [answers, setAnswers] = useState<Answers>({
    npsScore: null,
    dietaryStyle: null,
    allergies: [],
    dislikes: [],
  })
  const [allergyDraft, setAllergyDraft] = useState('')

  const [finished, setFinished] = useState<
    { phase: PhaseKey; ask: SeqItem[]; answer: ReactNode }[]
  >([])
  const [liveQueue, setLiveQueue] = useState<SeqItem[]>([])
  const [liveRevealed, setLiveRevealed] = useState(0)
  const historyRef = useRef<HTMLDivElement>(null)

  const currentPhase = PHASE_ORDER[Math.min(phaseIndex, PHASE_ORDER.length - 1)]
  const askDone = liveRevealed >= liveQueue.length

  function advanceLive() {
    setLiveRevealed((r) => r + 1)
  }

  useEffect(() => {
    if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight
  }, [stage, phaseIndex, liveRevealed])

  useEffect(() => {
    let cancelled = false

    async function init() {
      try {
        const profile = await getProfile()
        if (cancelled) return
        setProfileName(profile.name ?? null)

        // Runs every time the button is tapped -- this chat's only job is
        // collecting NPS feedback and confirming/updating dietary
        // preferences; recipe generation itself only happens on the
        // Recipes page. Pre-fill from whatever was saved last time (if
        // anything) so re-visiting feels like a review, not starting over.
        let inferred: DietaryStyle | null = profile.dietary_style ?? null
        let source: StyleSource = inferred ? 'saved' : null
        if (!inferred) {
          try {
            const res = await getInferredDietaryStyle()
            inferred = res.dietary_style
            source = 'inferred'
          } catch {
            // no confirmed items to infer from yet -- fall back to asking plainly
          }
        }
        if (cancelled) return
        setInferredStyle(inferred)
        setStyleSource(source)
        setAnswers((prev) => ({
          ...prev,
          dietaryStyle: inferred,
          allergies: profile.allergies ?? [],
          dislikes: profile.dislikes ?? [],
        }))
        setLiveQueue(askFor('nps', profile.name ?? null, inferred, source))
        setLiveRevealed(0)
        setStage('chat')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load your profile.')
        setStage('error')
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [])

  async function finishPrefs(finalAnswers: Answers) {
    setStage('saving')
    try {
      await updateDietaryPreferences({
        dietary_style: finalAnswers.dietaryStyle ?? 'omnivore',
        allergies: finalAnswers.allergies,
        dislikes: finalAnswers.dislikes,
      })
      navigate('/results')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your preferences.')
      setStage('error')
    }
  }

  function goToNextPhase(next: Answers) {
    setFinished((f) => [
      ...f,
      {
        phase: currentPhase,
        ask: askFor(currentPhase, profileName, inferredStyle, styleSource),
        answer: answerLabel(currentPhase, next),
      },
    ])

    if (phaseIndex >= PHASE_ORDER.length - 1) {
      void finishPrefs(next)
      return
    }

    const nextPhase = PHASE_ORDER[phaseIndex + 1]
    const reply = replyFor(currentPhase, next)
    const ask = askFor(nextPhase, profileName, inferredStyle, styleSource)
    setLiveQueue([...reply, ...ask])
    setLiveRevealed(0)
    setPhaseIndex((i) => i + 1)
  }

  function submitNps(score: number) {
    const next = { ...answers, npsScore: score }
    setAnswers(next)
    void submitFeedback(score).catch(() => {
      // best-effort -- a feedback-submission failure shouldn't block the chat
    })
    goToNextPhase(next)
  }

  function submitDiet(style: DietaryStyle) {
    const next = { ...answers, dietaryStyle: style }
    setAnswers(next)
    goToNextPhase(next)
  }

  function toggleAllergy(value: string) {
    setAnswers((prev) => {
      const has = prev.allergies.includes(value)
      return {
        ...prev,
        allergies: has
          ? prev.allergies.filter((v) => v !== value)
          : [...prev.allergies, value],
      }
    })
  }

  function addCustomAllergy() {
    const trimmed = allergyDraft.trim()
    if (!trimmed) return
    setAnswers((prev) =>
      prev.allergies.some((v) => v.toLowerCase() === trimmed.toLowerCase())
        ? prev
        : { ...prev, allergies: [...prev.allergies, trimmed] },
    )
    setAllergyDraft('')
  }

  function submitAllergies() {
    goToNextPhase(answers)
  }

  function submitDislikes() {
    goToNextPhase(answers)
  }

  // ── render ────────────────────────────────────────────────────────────

  if (stage === 'loading') {
    return (
      <section>
        <h1>Recipe recommendations</h1>
        <div className="chat-card">
          <p>Loading…</p>
        </div>
      </section>
    )
  }

  if (stage === 'error') {
    return (
      <section>
        <h1>Recipe recommendations</h1>
        <p className="form-error" role="alert">
          {error}
        </p>
      </section>
    )
  }

  if (stage === 'saving') {
    return (
      <section>
        <h1>Recipe recommendations</h1>
        <div className="chat-card">
          <div className="chat-history">
            <ChatBubble from="bot">
              <TypewriterText text="Saving your preferences..." />
            </ChatBubble>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section>
      <h1>Recipe recommendations</h1>
      <div className="chat-card">
        <div ref={historyRef} className="chat-history">
          {finished.map((turn, i) => (
            <div key={i} className="chat-turn">
              {renderStaticSequence(turn.ask)}
              <ChatBubble from="user">{turn.answer}</ChatBubble>
            </div>
          ))}

          <div
            className={finished.length > 0 ? 'chat-turn chat-turn--current' : 'chat-turn'}
          >
            <SequenceView
              items={liveQueue}
              globalOffset={0}
              turnRevealed={liveRevealed}
              onAdvance={advanceLive}
            />
          </div>
        </div>

        {askDone && (
          <div className="chat-footer">
            {currentPhase === 'nps' && (
              <div className="chat-choices">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="chat-choice"
                    onClick={() => submitNps(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            )}

            {currentPhase === 'diet' && (
              <div className="chat-choices">
                {DIETARY_STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={
                      opt.value === inferredStyle
                        ? 'chat-choice chat-choice--selected'
                        : 'chat-choice'
                    }
                    onClick={() => submitDiet(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {currentPhase === 'allergies' && (
              <div className="chat-choices-block">
                <div className="chat-choices">
                  {ALLERGEN_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={
                        answers.allergies.includes(opt.value)
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
                {answers.allergies.length > 0 && (
                  <p className="muted">Selected: {answers.allergies.join(', ')}</p>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={submitAllergies}
                >
                  {answers.allergies.length > 0
                    ? 'Continue'
                    : 'No allergies or intolerances -- continue'}
                </button>
              </div>
            )}

            {currentPhase === 'dislikes' && (
              <div className="chat-choices-block">
                <ChipListInput
                  value={answers.dislikes}
                  onChange={(next) => setAnswers((prev) => ({ ...prev, dislikes: next }))}
                  placeholder="e.g. mushrooms"
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={submitDislikes}
                >
                  {answers.dislikes.length > 0 ? 'Continue' : 'No dislikes -- continue'}
                </button>
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
