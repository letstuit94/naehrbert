import type { ReactNode } from 'react'
import { ChatBubble } from './chatEngine'

// Plain helper functions/types for the chat engine (./chatEngine.tsx) --
// split into their own file because react-refresh/only-export-components
// requires a .tsx file to export either all components or none, and none
// of these (a type, two tiny constructors, two render helpers) are
// components themselves.

export type SeqItem = { kind: 'typed'; text: string } | { kind: 'node'; node: ReactNode }
export const typedItem = (text: string): SeqItem => ({ kind: 'typed', text })
export const nodeItem = (n: ReactNode): SeqItem => ({ kind: 'node', node: n })

export function bulletList(items: string[]): ReactNode {
  return (
    <ul className="chat-bullets">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  )
}

// A fully-resolved sequence (history that's already been fully typed) --
// every item just appears, no animation.
export function renderStaticSequence(items: SeqItem[]): ReactNode {
  return (
    <>
      {items.map((item, i) => (
        <ChatBubble key={i} from="bot">
          {item.kind === 'node' ? item.node : item.text}
        </ChatBubble>
      ))}
    </>
  )
}
