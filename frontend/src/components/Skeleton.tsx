/**
 * Loading skeletons (CI §12) — a stable layout scaffold that mirrors the real
 * content shape, so the page never jumps when data arrives. Built on the
 * `.skeleton` block in App.css (soft pulse, auto-disabled under
 * `prefers-reduced-motion`). Prefer these over a bare "Loading…" text: they
 * keep the H1/lead in place and reserve the data area, so a route load reads as
 * one calm, uninterrupted step instead of a text flash followed by a reflow.
 */

type SkeletonProps = {
  /** Width — a number (px) or any CSS length/percentage string. */
  w?: number | string
  /** Height in px. */
  h?: number
  className?: string
}

/** A single shimmering placeholder block. */
export function Skeleton({ w = '100%', h = 12, className }: SkeletonProps) {
  return (
    <div
      className={className ? `skeleton ${className}` : 'skeleton'}
      style={{ width: typeof w === 'number' ? `${w}px` : w, height: h }}
    />
  )
}

/** A card-shaped placeholder: a short label line plus `lines` body lines. */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="card skeleton-card">
      <Skeleton w="30%" h={12} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} w={i === lines - 1 ? '60%' : '100%'} h={40} />
      ))}
    </div>
  )
}

/**
 * The default page-loading scaffold: an optional lead line under the (real) H1
 * plus `cards` stacked card placeholders. Decorative — the surrounding
 * `<section>` should carry `aria-busy="true"` for assistive tech.
 */
export function PageSkeleton({
  lead = true,
  cards = 2,
  lines = 2,
}: {
  lead?: boolean
  cards?: number
  lines?: number
}) {
  return (
    <div className="page-skeleton" aria-hidden="true">
      {lead && <Skeleton w="70%" h={15} className="skeleton-lead" />}
      {Array.from({ length: cards }).map((_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </div>
  )
}
