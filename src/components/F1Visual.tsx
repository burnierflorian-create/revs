// Stylised, rights-free F1 artwork tinted to the team livery colour.
// Replaces official driver photos / car shots (which we can't licence or
// keep up to date). Pure inline SVG — no assets, no network, auto-updates
// with the synced grid because the colour/number come from the data.

// Racing helmet, side profile, tinted to the team colour. Optional race
// number sits as a faint watermark behind it so the card reads
// "coloured helmet + number" even on its own.
export function DriverHelmet({
  color,
  number,
  className = '',
}: {
  color: string
  number?: number | null
  className?: string
}) {
  const gid = `hg-${color.replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      {number != null && (
        <span
          aria-hidden
          className="pointer-events-none absolute font-display font-black leading-none"
          style={{
            fontSize: '58%',
            color,
            opacity: 0.16,
            transform: 'translateY(2%)',
          }}
        >
          {number}
        </span>
      )}
      <svg
        viewBox="0 0 100 100"
        className="relative h-[70%] w-[70%]"
        role="img"
        aria-label="casque"
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
            <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Shell + chin bar */}
        <path
          d="M20 66 C20 40 36 24 58 24 C77 24 88 38 88 52 C88 57 85 60 80 60
             L52 60 C46 60 42 63 42 69 C42 74 39 77 33 77 L28 77
             C23 77 20 73 20 68 Z"
          fill={color}
        />
        {/* Top highlight */}
        <path
          d="M20 66 C20 40 36 24 58 24 C77 24 88 38 88 52 C88 57 85 60 80 60
             L52 60 C46 60 42 63 42 69 C42 74 39 77 33 77 L28 77
             C23 77 20 73 20 68 Z"
          fill={`url(#${gid})`}
        />
        {/* Visor */}
        <path
          d="M50 40 C50 35 53 32 58 32 L80 34 C84 34 86 37 85 41 L84 46
             C84 49 82 51 78 51 L56 50 C52 50 50 47 50 43 Z"
          fill="rgba(0,0,0,0.42)"
        />
        {/* Visor glint */}
        <path
          d="M56 36 L72 37 C74 37 74 39 72 39 L56 39 C54 39 54 36 56 36 Z"
          fill="rgba(255,255,255,0.28)"
        />
        {/* Bottom air intake line */}
        <path
          d="M52 58 L79 58 C81 58 81 60 79 60 L52 60 Z"
          fill="rgba(0,0,0,0.28)"
        />
      </svg>
    </div>
  )
}

// Formula 1 car, top-down, tinted to the team colour. Symmetric so it
// stays clean at any size; wheels + cockpit are neutral dark.
export function CarSilhouette({
  color,
  className = '',
}: {
  color: string
  className?: string
}) {
  const dark = 'rgba(10,10,12,0.92)'
  return (
    <svg
      viewBox="0 0 64 128"
      className={className}
      role="img"
      aria-label="monoplace"
    >
      {/* Wheels */}
      <rect x="4" y="24" width="11" height="19" rx="2.5" fill={dark} />
      <rect x="49" y="24" width="11" height="19" rx="2.5" fill={dark} />
      <rect x="4" y="88" width="11" height="19" rx="2.5" fill={dark} />
      <rect x="49" y="88" width="11" height="19" rx="2.5" fill={dark} />
      {/* Front wing */}
      <rect x="8" y="6" width="48" height="8" rx="3" fill={color} />
      {/* Rear wing */}
      <rect x="7" y="112" width="50" height="9" rx="3" fill={color} />
      {/* Nose cone */}
      <path d="M27 12 H37 L41 44 H23 Z" fill={color} />
      {/* Sidepods */}
      <rect x="12" y="54" width="14" height="34" rx="5" fill={color} opacity="0.9" />
      <rect x="38" y="54" width="14" height="34" rx="5" fill={color} opacity="0.9" />
      {/* Central spine */}
      <rect x="25" y="40" width="14" height="70" rx="6" fill={color} />
      {/* Halo + cockpit */}
      <rect x="28" y="46" width="8" height="15" rx="4" fill={dark} />
      <path
        d="M27 55 C27 49 31 46 32 46 C33 46 37 49 37 55"
        fill="none"
        stroke={dark}
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  )
}
