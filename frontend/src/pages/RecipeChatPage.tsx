import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Skeleton } from '../components/Skeleton'
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
import { allergenOptions, dietaryStyleOptions } from '../lib/recipePrefsSteps'
import { ChipListInput } from '../components/ChipListInput'
import { useI18n, type TranslateFn } from '../lib/i18n'

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

function styleNoun(t: TranslateFn, style: DietaryStyle): string {
  const found = dietaryStyleOptions(t).find((o) => o.value === style)
  return found ? found.label.replace(/^\S+\s/, '').toLowerCase() : style
}

type StyleSource = 'saved' | 'inferred' | null

function askFor(
  t: TranslateFn,
  phase: PhaseKey,
  name: string | null,
  inferredStyle: DietaryStyle | null,
  styleSource: StyleSource,
): SeqItem[] {
  if (phase === 'nps') {
    return [
      typedItem(
        name ? t(`Hey ${name}! 🎉`, `Hey ${name}! 🎉`) : t('Hey there! 🎉', 'Hallo! 🎉'),
      ),
      typedItem(
        t(
          "Congrats on the progress so far -- you've uploaded enough matched food items to unlock recipe recommendations.",
          'Glückwunsch zu deinem bisherigen Fortschritt – du hast genug erkannte Lebensmittel hochgeladen, um Rezeptempfehlungen freizuschalten.',
        ),
      ),
      typedItem(
        t(
          'I would love to hear how you like the app so far. How likely is it that you would recommend it to friends and family on a scale of 1 to 10?',
          'Ich würde gern wissen, wie dir die App bisher gefällt. Wie wahrscheinlich ist es, dass du sie Freunden und Familie weiterempfiehlst – auf einer Skala von 1 bis 10?',
        ),
      ),
    ]
  }
  if (phase === 'diet') {
    if (styleSource === 'saved' && inferredStyle) {
      return [
        typedItem(
          t(
            `Last time you told me you eat mostly ${styleNoun(t, inferredStyle)}. Still right, or would you like to change it?`,
            `Letztes Mal hast du mir gesagt, dass du dich überwiegend ${styleNoun(t, inferredStyle)} ernährst. Passt das noch, oder möchtest du es ändern?`,
          ),
        ),
      ]
    }
    if (styleSource === 'inferred' && inferredStyle) {
      return [
        typedItem(
          t(
            `Based on your purchases so far, it looks like you eat mostly ${styleNoun(t, inferredStyle)}. Does that sound right, or should I correct it?`,
            `Nach deinen bisherigen Einkäufen sieht es so aus, als würdest du dich überwiegend ${styleNoun(t, inferredStyle)} ernähren. Klingt das richtig, oder soll ich es korrigieren?`,
          ),
        ),
      ]
    }
    return [typedItem(t('How would you describe how you eat?', 'Wie würdest du deine Ernährung beschreiben?'))]
  }
  if (phase === 'allergies') {
    return [
      typedItem(
        t(
          'Do you have any allergies or intolerances I should know about?',
          'Hast du Allergien oder Unverträglichkeiten, von denen ich wissen sollte?',
        ),
      ),
    ]
  }
  return [
    typedItem(
      t(
        "And finally -- are there any foods you just don't like?",
        'Und zum Schluss – gibt es Lebensmittel, die du einfach nicht magst?',
      ),
    ),
  ]
}

function replyFor(t: TranslateFn, phase: PhaseKey, answers: Answers): SeqItem[] {
  if (phase === 'nps') {
    return [
      typedItem(t('Thank you for sharing that!', 'Danke, dass du das geteilt hast!')),
      typedItem(
        t(
          'Before I can start recommending you healthy recipes to close your nutrient gaps, I have a few more questions.',
          'Bevor ich dir gesunde Rezepte empfehlen kann, um deine Nährstofflücken zu schließen, habe ich noch ein paar Fragen.',
        ),
      ),
    ]
  }
  if (phase === 'diet') return [typedItem(t('Got it, noted.', 'Alles klar, notiert.'))]
  if (phase === 'allergies') {
    return [
      typedItem(
        answers.allergies.length > 0
          ? t("Thanks, I'll steer clear of those.", 'Danke, die lasse ich weg.')
          : t('Good to know, thanks!', 'Gut zu wissen, danke!'),
      ),
    ]
  }
  return []
}

function answerLabel(t: TranslateFn, phase: PhaseKey, answers: Answers): ReactNode {
  if (phase === 'nps') return String(answers.npsScore)
  if (phase === 'diet') {
    const opt = dietaryStyleOptions(t).find((o) => o.value === answers.dietaryStyle)
    return opt ? opt.label : '—'
  }
  if (phase === 'allergies')
    return answers.allergies.length ? answers.allergies.join(', ') : t('None', 'Keine')
  return answers.dislikes.length ? answers.dislikes.join(', ') : t('None', 'Keine')
}

export function RecipeChatPage() {
  const navigate = useNavigate()
  const { t } = useI18n()
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
        setLiveQueue(askFor(t, 'nps', profile.name ?? null, inferred, source))
        setLiveRevealed(0)
        setStage('chat')
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof ApiError
            ? err.message
            : t('Could not load your profile.', 'Dein Profil konnte nicht geladen werden.'),
        )
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
      // Straight to the Recipes tab -- this chat's whole purpose is
      // gathering the dietary prefs recipe generation needs, so the next
      // step is generating one, not detouring through Upload/Results.
      navigate('/tips')
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : t(
              'Could not save your preferences.',
              'Deine Einstellungen konnten nicht gespeichert werden.',
            ),
      )
      setStage('error')
    }
  }

  // Skip the chat for users who'd rather set things directly -- send them to
  // the Diet & preferences section of their profile (same fields this chat
  // collects), which is editable there via the #diet-preferences anchor.
  function skipChat() {
    navigate('/profile#diet-preferences')
  }

  function goToNextPhase(next: Answers) {
    setFinished((f) => [
      ...f,
      {
        phase: currentPhase,
        ask: askFor(t, currentPhase, profileName, inferredStyle, styleSource),
        answer: answerLabel(t, currentPhase, next),
      },
    ])

    if (phaseIndex >= PHASE_ORDER.length - 1) {
      void finishPrefs(next)
      return
    }

    const nextPhase = PHASE_ORDER[phaseIndex + 1]
    const reply = replyFor(t, currentPhase, next)
    const ask = askFor(t, nextPhase, profileName, inferredStyle, styleSource)
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
      <section aria-busy="true">
        <h1>{t('Recipe recommendations', 'Rezeptempfehlungen')}</h1>
        <div className="chat-card skeleton-card">
          <Skeleton w="40%" h={12} />
          <Skeleton h={40} />
          <Skeleton w="70%" h={40} />
        </div>
      </section>
    )
  }

  if (stage === 'error') {
    return (
      <section>
        <h1>{t('Recipe recommendations', 'Rezeptempfehlungen')}</h1>
        <p className="form-error" role="alert">
          {error}
        </p>
      </section>
    )
  }

  if (stage === 'saving') {
    return (
      <section>
        <h1>{t('Recipe recommendations', 'Rezeptempfehlungen')}</h1>
        <div className="chat-card">
          <div className="chat-history">
            <ChatBubble from="bot">
              <TypewriterText
                text={t('Saving your preferences...', 'Deine Einstellungen werden gespeichert …')}
              />
            </ChatBubble>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="summary-line">
        <h1>{t('Recipe recommendations', 'Rezeptempfehlungen')}</h1>
        {stage === 'chat' && (
          <button type="button" className="btn-link" onClick={skipChat}>
            {t('Skip', 'Überspringen')}
          </button>
        )}
      </div>
      <p className="page-lead">
        {t(
          "Tell me what you're after and I'll build recipes around what's in your pantry.",
          'Sag mir, worauf du Lust hast, und ich baue Rezepte rund um deinen Vorrat.',
        )}
      </p>
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
                {dietaryStyleOptions(t).map((opt) => (
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
                  {allergenOptions(t).map((opt) => (
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
                    placeholder={t('Other (type and add)', 'Sonstiges (eingeben und hinzufügen)')}
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
                    aria-label={t('Add', 'Hinzufügen')}
                    onClick={addCustomAllergy}
                  >
                    +
                  </button>
                </div>
                {answers.allergies.length > 0 && (
                  <p className="muted">
                    {t('Selected:', 'Ausgewählt:')} {answers.allergies.join(', ')}
                  </p>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={submitAllergies}
                >
                  {answers.allergies.length > 0
                    ? t('Continue', 'Weiter')
                    : t(
                        'No allergies or intolerances -- continue',
                        'Keine Allergien oder Unverträglichkeiten – weiter',
                      )}
                </button>
              </div>
            )}

            {currentPhase === 'dislikes' && (
              <div className="chat-choices-block">
                <ChipListInput
                  value={answers.dislikes}
                  onChange={(next) => setAnswers((prev) => ({ ...prev, dislikes: next }))}
                  placeholder={t('e.g. mushrooms', 'z. B. Pilze')}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={submitDislikes}
                >
                  {answers.dislikes.length > 0
                    ? t('Continue', 'Weiter')
                    : t('No dislikes -- continue', 'Keine Abneigungen – weiter')}
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
