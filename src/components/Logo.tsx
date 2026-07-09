// REVS brand logo — Piste 2: a bold italic "R" cut by red speed lines, with
// the "REVS" wordmark (S in signature red #E8203A). Single source of truth for
// the splash, header, app icon and any brand surface. Pure SVG, crisp at any
// size. `mono` renders the R in one colour (for dark or light backgrounds).

const RED = '#E8203A'

// The symbol only — the dynamic R + trailing speed lines. viewBox 0 0 120 120.
export function RevsMark({
  size = 40,
  color = '#F5F5F7',
  lines = RED,
}: {
  size?: number
  color?: string
  lines?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="REVS"
    >
      {/* trailing speed lines */}
      <rect x="6" y="45" width="34" height="5" rx="2.5" fill={lines} />
      <rect x="12" y="60" width="28" height="5" rx="2.5" fill={lines} opacity="0.6" />
      <rect x="18" y="75" width="22" height="5" rx="2.5" fill={lines} opacity="0.32" />
      {/* bold italic R */}
      <g transform="skewX(-9) translate(14 0)" fill={color} fillRule="evenodd">
        <path
          d="M 40 26 L 70 26 C 86 26 95 36 95 50 C 95 62 88 70 76 72 L 98 96 L 76 96 L 56 74 L 56 96 L 40 96 Z
             M 56 40 L 68 40 C 76 40 80 44 80 50 C 80 56 76 60 68 60 L 56 60 Z"
        />
      </g>
    </svg>
  )
}

// The "REVS" wordmark — bold italic, S in red. Uses the app display font.
export function RevsWordmark({
  height = 32,
  color = '#F5F5F7',
}: {
  height?: number
  color?: string
}) {
  return (
    <span
      aria-label="REVS"
      style={{
        fontFamily: 'var(--font-display, "Arial Black", Arial, sans-serif)',
        fontWeight: 900,
        fontStyle: 'italic',
        fontSize: height,
        lineHeight: 1,
        letterSpacing: '-0.05em',
        color,
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      REV<span style={{ color: RED }}>S</span>
    </span>
  )
}

// Horizontal lockup — symbol + wordmark.
export function RevsLogo({
  height = 34,
  color = '#F5F5F7',
}: {
  height?: number
  color?: string
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: height * 0.28,
      }}
    >
      <RevsMark size={height * 1.15} color={color} />
      <RevsWordmark height={height} color={color} />
    </span>
  )
}
