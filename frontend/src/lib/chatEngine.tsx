import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SeqItem } from './chatSequence'

// Shared chat-style UI engine, extracted from OnboardingPage.tsx (Epic 1.1)
// so the recipe-preferences chat (recipe recommendations feature) can
// reuse the exact same typewriter/bubble/sequencing behavior instead of
// duplicating it. Pure move, no logic change -- everything here is
// generic (no coupling to onboarding's StepDef/Answers shape).
//
// Only actual components live here (react-refresh/only-export-components
// requires a .tsx file to export either all components or none) -- the
// plain helper functions/types that go with these (SeqItem, typedItem,
// nodeItem, bulletList, renderStaticSequence) live in ./chatSequence.tsx.

export const TYPEWRITER_MS_PER_CHAR = 19
export const NODE_PAUSE_MS = 700

// Mounted exactly once per bubble (SequenceView swaps a "live" typing
// bubble for plain static text once it's done), so `text` never changes
// across this component's lifetime -- the effect below is correctly
// mount-once, not a reset-on-prop-change.
export function TypewriterText({ text, onDone }: { text: string; onDone?: () => void }) {
  const [shown, setShown] = useState(0)
  const onDoneRef = useRef(onDone)
  const doneRef = useRef(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  useEffect(() => {
    if (!text) {
      doneRef.current = true
      onDoneRef.current?.()
      return
    }
    let i = 0
    intervalRef.current = setInterval(() => {
      i += 1
      setShown(i)
      if (i >= text.length) {
        if (intervalRef.current) clearInterval(intervalRef.current)
        doneRef.current = true
        onDoneRef.current?.()
      }
    }, TYPEWRITER_MS_PER_CHAR)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function skip() {
    if (doneRef.current) return
    if (intervalRef.current) clearInterval(intervalRef.current)
    setShown(text.length)
    doneRef.current = true
    onDoneRef.current?.()
  }

  return (
    <span onClick={skip} className="chat-typing">
      {text.slice(0, shown)}
    </span>
  )
}

export function ChatBubble({
  from,
  children,
}: {
  from: 'bot' | 'user'
  children: ReactNode
}) {
  return (
    <div
      className={from === 'user' ? 'chat-row chat-row--user' : 'chat-row chat-row--bot'}
    >
      {from === 'bot' && (
        <span className="chat-avatar" aria-hidden>
          🌱
        </span>
      )}
      <div
        className={
          from === 'user'
            ? 'chat-bubble chat-bubble--user'
            : 'chat-bubble chat-bubble--bot'
        }
      >
        {children}
      </div>
    </div>
  )
}

export function SequenceView({
  items,
  globalOffset,
  turnRevealed,
  onAdvance,
}: {
  items: SeqItem[]
  globalOffset: number
  turnRevealed: number
  onAdvance: () => void
}) {
  const liveLocalIndex = turnRevealed - globalOffset
  const liveItem =
    liveLocalIndex >= 0 && liveLocalIndex < items.length
      ? items[liveLocalIndex]
      : undefined

  useEffect(() => {
    if (liveItem?.kind !== 'node') return
    const t = setTimeout(onAdvance, NODE_PAUSE_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalOffset, turnRevealed])

  return (
    <>
      {items.map((item, localI) => {
        const globalI = globalOffset + localI
        if (globalI > turnRevealed) return null
        const isLive = globalI === turnRevealed
        return (
          <ChatBubble key={globalI} from="bot">
            {item.kind === 'node' ? (
              item.node
            ) : isLive ? (
              <TypewriterText text={item.text} onDone={onAdvance} />
            ) : (
              item.text
            )}
          </ChatBubble>
        )
      })}
    </>
  )
}
