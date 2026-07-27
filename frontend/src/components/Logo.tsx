type LogoProps = {
  className?: string
  size?: number
}

// Brand leaf mark (CI-Guideline §1). A single stroked SVG path, no fill, drawn
// with `stroke="currentColor"` so it inherits the surrounding text colour --
// on a coloured badge just set `color`, never a second hex value. It mirrors
// the 🌱 coach avatar (Onboarding/Chat) so product and coach read as one
// family. Decorative by default (`aria-hidden`): the accompanying "NutriWise"
// wordmark carries the accessible name.
export function Logo({ className, size = 16 }: LogoProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z M2 21c0-3 1.85-5.36 5.08-6" />
    </svg>
  )
}
