import type { Urgency } from '../lib/api'
import { urgencyDescription, urgencyLabel, urgencyLight } from '../lib/shelfLife'

/**
 * The basket's fuzzy urgency cue: a traffic-light dot plus an optional soft
 * label ("use soon" / "this week" / "lasting"). It shows NO
 * estimated date and NO day count -- urgency is a guess, communicated only
 * unsharply. Colour is never the sole signal: the label (when shown) and the
 * title/aria-label carry the meaning too.
 *
 * `showLabel` off = just the dot (compact, e.g. inside a dense grouped view);
 * on = dot + word.
 */
export function UrgencyBadge({
  urgency,
  showLabel = true,
}: {
  urgency: Urgency
  showLabel?: boolean
}) {
  const light = urgencyLight(urgency)
  const label = urgencyLabel(urgency)
  const description = urgencyDescription(urgency)

  return (
    <span className="urgency" title={description}>
      <span
        className={`urgency__dot urgency__dot--${light}`}
        role="img"
        aria-label={description}
      />
      {showLabel && label && <span className="urgency__label">{label}</span>}
    </span>
  )
}
