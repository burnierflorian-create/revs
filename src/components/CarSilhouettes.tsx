import { useId, type ReactElement } from 'react'

// ─────────────────────── Body type catalogue ───────────────────────
// 16 silhouettes total — 8 generic body types + 8 model-specific
// overrides for cars the user spots most. The dispatcher in
// `car-body-type.ts` returns the most specific key it can match.

export type BodyType =
  | 'suv-coupe'
  | 'suv'
  | 'sport-sedan'
  | 'supercar'
  | 'hypercar'
  | 'jdm-sport'
  | 'sedan'
  | 'mini-suv'
  // Model-specific (override the generic body type)
  | 'porsche-911'
  | 'porsche-cayenne-coupe'
  | 'ferrari-berlinetta'
  | 'lambo-wedge'
  | 'mclaren'
  | 'bugatti'
  | 'mercedes-gle-coupe'
  | 'mercedes-amg-gt-roadster'
  | 'bmw-3-series'
  | 'bmw-i4'
  | 'range-rover'
  | 'rolls-royce'
  | 'bentley'
  | 'audi-tt-rs'
  | 'toyota-gt86'
  | 'nissan-juke'

export const BODY_TYPE_LABEL: Record<BodyType, string> = {
  'suv-coupe': 'SUV Coupé',
  suv: 'SUV',
  'sport-sedan': 'Berline sportive',
  supercar: 'Supercar',
  hypercar: 'Hypercar',
  'jdm-sport': 'JDM Sport',
  sedan: 'Berline',
  'mini-suv': 'SUV compact',
  'porsche-911': 'Porsche 911',
  'porsche-cayenne-coupe': 'Porsche Cayenne Coupé',
  'ferrari-berlinetta': 'Ferrari',
  'lambo-wedge': 'Lamborghini',
  mclaren: 'McLaren',
  bugatti: 'Bugatti',
  'mercedes-gle-coupe': 'Mercedes GLE Coupé',
  'mercedes-amg-gt-roadster': 'Mercedes-AMG GT Roadster',
  'bmw-3-series': 'BMW Série 3',
  'bmw-i4': 'BMW i4 Gran Coupé',
  'range-rover': 'Range Rover',
  'rolls-royce': 'Rolls-Royce',
  bentley: 'Bentley',
  'audi-tt-rs': 'Audi TT RS',
  'toyota-gt86': 'Toyota GT86',
  'nissan-juke': 'Nissan Juke',
}

// ─────────────────────── Style constants ───────────────────────
// All silhouettes use white-ish strokes on transparent — the parent
// card supplies the dark backdrop + optional brand-colour tint.

const VB = '0 0 400 200'
const COMMON = 'h-full w-full'
const LINE = '#F5F5F5'      // primary outline
const LINE_2 = '#BDBDBD'    // secondary details (grilles, vents)
const HINT = 'rgba(255,255,255,0.35)' // highlights / reflections
const WHEEL_FILL = '#0a0a0a'
const RIM = '#5a5a5a'

function Defs({ id }: { id: string }) {
  return (
    <defs>
      <linearGradient id={`hl-${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
        <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
    </defs>
  )
}

function Shadow({ cx = 200, rx = 165, ry = 5 }: { cx?: number; rx?: number; ry?: number }) {
  return <ellipse cx={cx} cy={185} rx={rx} ry={ry} fill="#000" opacity="0.55" />
}

function Wheel({ cx, cy, r = 26 }: { cx: number; cy: number; r?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={WHEEL_FILL} stroke={LINE} strokeWidth="1.5" />
      <circle cx={cx} cy={cy} r={r - 4} fill="none" stroke={RIM} strokeWidth="0.8" />
      <circle cx={cx} cy={cy} r={r - 10} fill="none" stroke={RIM} strokeWidth="0.6" />
      <circle cx={cx} cy={cy} r={3.5} fill="none" stroke={LINE} strokeWidth="1" />
      {[0, 72, 144, 216, 288].map((deg) => {
        const a = (deg * Math.PI) / 180
        const x1 = cx + Math.cos(a) * 3.5
        const y1 = cy + Math.sin(a) * 3.5
        const x2 = cx + Math.cos(a) * (r - 11)
        const y2 = cy + Math.sin(a) * (r - 11)
        return (
          <line
            key={deg}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={RIM}
            strokeWidth="1.1"
            strokeLinecap="round"
          />
        )
      })}
    </g>
  )
}

function Headlight({ cx, cy, w = 12, h = 4 }: { cx: number; cy: number; w?: number; h?: number }) {
  return <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} fill="none" stroke={LINE} strokeWidth="1.4" />
}

function Taillight({ cx, cy, w = 12, h = 4 }: { cx: number; cy: number; w?: number; h?: number }) {
  return <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} fill="none" stroke={LINE_2} strokeWidth="1.2" />
}

type SvgProps = { id?: string }

// ═══════════════════════════════════════════════════════════════════
// GENERIC BODY TYPES (8) — fallbacks when no model-specific match
// ═══════════════════════════════════════════════════════════════════

// 1. SUV Coupé generic
export function SuvCoupe(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow />
      <path
        d="M 30 160 Q 28 138 42 130 L 90 124 Q 100 86 142 78 L 252 70 Q 296 70 326 90 L 366 116 Q 378 124 378 144 L 378 162 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 116 88 Q 138 50 184 48 L 252 52 Q 282 56 312 100 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="200" y1="52" x2="200" y2="88" stroke={LINE_2} strokeWidth="1" />
      <path d="M 60 138 L 360 138" stroke={HINT} strokeWidth="1.2" />
      <path d="M 80 122 Q 100 75 245 70" fill="none" stroke={HINT} strokeWidth="1.5" />
      <Headlight cx={42} cy={132} w={18} />
      <Taillight cx={372} cy={132} w={14} />
      <Wheel cx={102} cy={162} />
      <Wheel cx={310} cy={162} />
    </svg>
  )
}

// 2. Generic SUV
export function Suv(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow />
      <path
        d="M 28 162 Q 26 138 38 130 L 80 124 Q 90 96 130 88 L 280 88 Q 314 88 334 96 L 372 110 Q 384 116 384 142 L 384 165 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 108 92 Q 120 52 168 50 L 274 50 Q 304 52 322 96 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="180" y1="50" x2="180" y2="92" stroke={LINE_2} strokeWidth="1" />
      <line x1="244" y1="50" x2="244" y2="92" stroke={LINE_2} strokeWidth="1" />
      <line x1="125" y1="48" x2="318" y2="48" stroke={LINE_2} strokeWidth="2" />
      <path d="M 60 138 L 366 138" stroke={HINT} strokeWidth="1.2" />
      <Headlight cx={36} cy={132} w={18} />
      <Taillight cx={378} cy={132} w={14} />
      <Wheel cx={94} cy={164} />
      <Wheel cx={312} cy={164} />
    </svg>
  )
}

// 3. Sport sedan
export function SportSedan(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow />
      <path
        d="M 22 162 Q 18 142 32 134 L 76 128 Q 94 110 144 106 L 254 104 Q 304 106 338 120 L 376 134 Q 384 138 384 156 L 384 168 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 114 110 Q 136 70 188 68 L 256 70 Q 280 72 304 112 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="208" y1="69" x2="208" y2="110" stroke={LINE_2} strokeWidth="1" />
      <path d="M 70 128 L 360 130" stroke={HINT} strokeWidth="1.3" />
      <path d="M 60 148 L 362 148" stroke={HINT} strokeWidth="1" />
      <Headlight cx={32} cy={138} w={16} h={3} />
      <Taillight cx={378} cy={138} w={14} h={3} />
      <Wheel cx={96} cy={166} r={24} />
      <Wheel cx={310} cy={166} r={24} />
    </svg>
  )
}

// 4. Generic supercar
export function Supercar(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={155} />
      <path
        d="M 20 168 Q 14 150 38 146 L 88 142 Q 116 122 154 114 L 210 110 Q 254 112 282 124 L 320 138 Q 360 146 374 156 L 376 170 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 134 120 Q 158 82 206 82 L 250 84 Q 270 90 282 124 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <path d="M 256 122 L 308 122 L 302 134 L 262 134 Z" fill="none" stroke={LINE_2} strokeWidth="1.2" />
      <rect x="22" y="166" width="78" height="5" fill="#0a0a0a" stroke={LINE_2} strokeWidth="0.8" />
      <path d="M 90 130 Q 158 86 250 90" fill="none" stroke={HINT} strokeWidth="1.5" />
      <path d="M 60 146 Q 200 138 340 146" fill="none" stroke={HINT} strokeWidth="1.2" />
      <Headlight cx={32} cy={154} w={20} h={3} />
      <Taillight cx={368} cy={154} w={16} h={3} />
      <Wheel cx={92} cy={170} />
      <Wheel cx={308} cy={170} />
    </svg>
  )
}

// 5. Generic hypercar
export function Hypercar(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={165} ry={6} />
      {/* Wing */}
      <path d="M 244 52 L 338 50 L 338 58 L 244 60 Z" fill="none" stroke={LINE} strokeWidth="1.5" />
      <line x1="262" y1="60" x2="270" y2="88" stroke={LINE_2} strokeWidth="1.5" />
      <line x1="318" y1="60" x2="312" y2="88" stroke={LINE_2} strokeWidth="1.5" />
      <path
        d="M 14 172 Q 8 158 32 154 L 92 146 Q 128 116 184 110 L 246 108 Q 280 116 304 130 L 336 142 Q 370 150 374 162 L 376 176 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 142 122 Q 168 80 220 80 L 256 82 Q 274 88 282 130 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <path d="M 262 122 L 318 122 L 308 134 L 268 134 Z" fill="none" stroke={LINE_2} strokeWidth="1.2" />
      <rect x="20" y="170" width="86" height="6" fill="#0a0a0a" stroke={LINE_2} strokeWidth="0.8" />
      <path d="M 90 130 Q 168 78 256 86" fill="none" stroke={HINT} strokeWidth="1.5" />
      <Headlight cx={28} cy={158} w={20} h={3} />
      <Taillight cx={368} cy={158} w={16} h={3} />
      <Wheel cx={88} cy={172} />
      <Wheel cx={306} cy={172} />
    </svg>
  )
}

// 6. JDM sport (generic)
export function JdmSport(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={140} />
      {/* Tall rear wing */}
      <rect x="260" y="50" width="62" height="6" fill="none" stroke={LINE} strokeWidth="1.5" />
      <line x1="270" y1="56" x2="276" y2="84" stroke={LINE_2} strokeWidth="1.5" />
      <line x1="312" y1="56" x2="306" y2="84" stroke={LINE_2} strokeWidth="1.5" />
      <path
        d="M 32 166 Q 30 144 44 138 L 80 134 Q 96 104 134 96 L 246 92 Q 286 92 314 108 L 354 124 Q 372 132 372 156 L 372 170 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 114 100 Q 138 64 184 62 L 252 62 Q 278 68 296 108 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="206" y1="62" x2="206" y2="100" stroke={LINE_2} strokeWidth="1" />
      <path d="M 220 124 L 260 124 L 256 132 L 224 132 Z" fill="none" stroke={LINE_2} strokeWidth="1" />
      <path d="M 70 138 L 358 138" stroke={HINT} strokeWidth="1.3" />
      <Headlight cx={40} cy={142} w={16} />
      <Taillight cx={368} cy={142} w={14} />
      <Wheel cx={96} cy={170} r={24} />
      <Wheel cx={306} cy={170} r={24} />
    </svg>
  )
}

// 7. Classic sedan
export function Sedan(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow />
      <path
        d="M 24 162 Q 22 140 36 132 L 76 126 Q 94 108 140 102 L 282 102 Q 318 104 344 116 L 374 130 Q 384 134 384 156 L 384 168 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 112 106 Q 134 68 188 66 L 282 68 Q 308 72 320 108 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="174" y1="67" x2="174" y2="106" stroke={LINE_2} strokeWidth="1" />
      <line x1="232" y1="65" x2="232" y2="106" stroke={LINE_2} strokeWidth="1" />
      <line x1="276" y1="68" x2="276" y2="108" stroke={LINE_2} strokeWidth="1" />
      <path d="M 70 128 L 360 130" stroke={HINT} strokeWidth="1.2" />
      <Headlight cx={34} cy={138} />
      <Taillight cx={378} cy={138} />
      <Wheel cx={96} cy={166} r={22} />
      <Wheel cx={314} cy={166} r={22} />
    </svg>
  )
}

// 8. Mini SUV
export function MiniSuv(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={130} />
      <path
        d="M 70 162 Q 68 138 80 130 L 108 124 Q 120 92 154 86 L 252 86 Q 282 86 302 100 L 326 114 Q 338 120 338 144 L 338 165 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 124 92 Q 138 54 174 52 L 248 52 Q 274 54 290 96 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="184" y1="52" x2="184" y2="92" stroke={LINE_2} strokeWidth="1" />
      <line x1="240" y1="52" x2="240" y2="92" stroke={LINE_2} strokeWidth="1" />
      <path d="M 90 142 L 322 142" stroke={LINE_2} strokeWidth="1.5" />
      <Headlight cx={78} cy={134} w={14} />
      <Taillight cx={332} cy={134} w={12} />
      <Wheel cx={112} cy={164} />
      <Wheel cx={272} cy={164} />
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════════════
// MODEL-SPECIFIC SILHOUETTES (override generic by brand+model)
// ═══════════════════════════════════════════════════════════════════

// Porsche 911 — iconic rear-engine bubble roof, full-width rear wheels.
export function Porsche911(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={140} />
      <path
        d="M 30 166 Q 24 150 44 144 L 88 134 Q 100 98 138 92 L 232 86 Q 272 84 298 102 L 332 124 Q 360 134 370 150 L 370 168 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Iconic teardrop / arch roof */}
      <path
        d="M 116 96 Q 142 60 192 56 L 248 56 Q 274 64 298 106 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="208" y1="56" x2="208" y2="96" stroke={LINE_2} strokeWidth="1" />
      {/* Engine deck spoiler hint */}
      <path d="M 268 102 L 320 104 L 318 110 L 270 110 Z" fill="none" stroke={LINE_2} strokeWidth="1.2" />
      {/* Wide rear haunch */}
      <path d="M 290 130 Q 320 122 348 142" fill="none" stroke={HINT} strokeWidth="1.5" />
      <path d="M 70 138 L 354 138" stroke={HINT} strokeWidth="1.3" />
      <Headlight cx={42} cy={138} w={14} h={10} />
      <Taillight cx={364} cy={138} w={16} h={4} />
      <Wheel cx={102} cy={166} r={24} />
      <Wheel cx={306} cy={166} r={26} />
    </svg>
  )
}

// Porsche Cayenne Coupé — SUV coupé musclé, hood ridges.
export function PorscheCayenneCoupe(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow />
      <path
        d="M 28 162 Q 26 138 40 130 L 84 124 Q 96 88 140 80 L 248 70 Q 292 70 324 90 L 366 114 Q 378 122 378 146 L 378 166 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Fastback */}
      <path
        d="M 114 90 Q 136 50 182 48 L 248 50 Q 280 56 312 100 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="196" y1="50" x2="196" y2="90" stroke={LINE_2} strokeWidth="1" />
      {/* Hood ridges (Porsche signature) */}
      <line x1="42" y1="130" x2="98" y2="100" stroke={HINT} strokeWidth="1" />
      <line x1="50" y1="134" x2="106" y2="106" stroke={HINT} strokeWidth="1" />
      <path d="M 60 140 L 356 140" stroke={HINT} strokeWidth="1.3" />
      {/* Almond-shaped headlights */}
      <path d="M 28 134 Q 42 128 56 132 Q 50 138 38 138 Q 30 137 28 134 Z" fill="none" stroke={LINE} strokeWidth="1.4" />
      <Taillight cx={372} cy={132} w={16} h={4} />
      <Wheel cx={102} cy={164} r={26} />
      <Wheel cx={310} cy={164} r={26} />
    </svg>
  )
}

// Ferrari berlinetta — low mid-engine shape, side air intake.
export function FerrariBerlinetta(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={160} />
      <path
        d="M 22 170 Q 16 152 40 148 L 90 142 Q 122 118 158 110 L 218 106 Q 260 108 290 122 L 326 138 Q 362 148 374 158 L 376 172 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Low cabin glasshouse */}
      <path
        d="M 140 118 Q 168 76 218 76 L 256 78 Q 274 86 286 126 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      {/* Side intake — Ferrari signature */}
      <path d="M 248 124 L 304 124 L 298 138 L 254 138 Z" fill="none" stroke={LINE_2} strokeWidth="1.3" />
      {/* Front splitter */}
      <rect x="26" y="168" width="76" height="4" fill="#0a0a0a" stroke={LINE_2} strokeWidth="0.8" />
      <path d="M 88 132 Q 168 80 256 86" fill="none" stroke={HINT} strokeWidth="1.5" />
      {/* Slim headlight slit */}
      <line x1="28" y1="152" x2="56" y2="146" stroke={LINE} strokeWidth="1.6" strokeLinecap="round" />
      {/* Quad taillights */}
      <Taillight cx={358} cy={148} w={6} />
      <Taillight cx={370} cy={148} w={6} />
      <Wheel cx={96} cy={170} />
      <Wheel cx={306} cy={170} />
    </svg>
  )
}

// Lamborghini — sharp angles, scissor doors implied, hood vents.
export function LamboWedge(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={155} />
      {/* Hard-edged wedge body — straight segments, not curves */}
      <path
        d="M 18 172 L 36 152 L 96 142 L 142 116 L 218 108 L 268 116 L 312 138 L 360 152 L 376 172 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="miter"
      />
      {/* Angular greenhouse */}
      <path
        d="M 132 116 L 168 80 L 232 80 L 270 116 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
        strokeLinejoin="miter"
      />
      <line x1="200" y1="80" x2="200" y2="116" stroke={LINE_2} strokeWidth="1" />
      {/* Roof scoop */}
      <line x1="174" y1="74" x2="226" y2="74" stroke={LINE} strokeWidth="1.5" />
      {/* Hood Y-vent hint */}
      <path d="M 70 132 L 90 122 L 110 132" fill="none" stroke={HINT} strokeWidth="1" />
      {/* Side aggressive vent */}
      <path d="M 240 126 L 304 126 L 298 138 L 246 138 Z" fill="none" stroke={LINE_2} strokeWidth="1.2" />
      <rect x="22" y="170" width="80" height="4" fill="#0a0a0a" stroke={LINE_2} strokeWidth="0.8" />
      <line x1="28" y1="152" x2="56" y2="148" stroke={LINE} strokeWidth="1.6" strokeLinecap="round" />
      <Taillight cx={362} cy={152} w={20} h={4} />
      <Wheel cx={94} cy={170} />
      <Wheel cx={306} cy={170} />
    </svg>
  )
}

// McLaren — extremely low front, butterfly door hint, side scoops.
export function McLaren(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={160} />
      <path
        d="M 18 174 Q 12 158 36 154 L 90 146 Q 126 122 164 114 L 220 112 Q 260 114 290 130 L 328 144 Q 364 152 374 162 L 376 174 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Very low canopy */}
      <path
        d="M 138 122 Q 168 84 220 84 L 254 86 Q 270 92 280 130 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      {/* Butterfly door cut line on body */}
      <path d="M 158 130 Q 200 98 240 98" fill="none" stroke={HINT} strokeWidth="1" strokeDasharray="3 2" />
      {/* Massive side intake */}
      <path d="M 232 128 L 312 132 L 304 144 L 240 142 Z" fill="none" stroke={LINE_2} strokeWidth="1.3" />
      {/* Front splitter */}
      <rect x="22" y="172" width="80" height="4" fill="#0a0a0a" stroke={LINE_2} strokeWidth="0.8" />
      <line x1="28" y1="156" x2="60" y2="152" stroke={LINE} strokeWidth="1.6" strokeLinecap="round" />
      <Taillight cx={362} cy={156} w={18} h={3} />
      <Wheel cx={94} cy={172} />
      <Wheel cx={306} cy={172} />
    </svg>
  )
}

// Bugatti — front-end horseshoe grille, massive presence.
export function Bugatti(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={155} />
      <path
        d="M 22 172 Q 18 154 40 150 L 94 144 Q 128 120 168 110 L 220 108 Q 256 112 280 124 L 320 142 Q 358 150 372 162 L 374 174 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 144 124 Q 168 82 218 82 L 250 84 Q 268 92 280 130 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      {/* Iconic Bugatti horseshoe grille hint (front) */}
      <path
        d="M 30 148 Q 30 130 50 130 Q 70 130 70 148 L 70 158 Q 70 162 64 162 L 36 162 Q 30 162 30 158 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="50" y1="130" x2="50" y2="162" stroke={LINE_2} strokeWidth="0.8" />
      {/* Centerline crease (Bugatti signature) */}
      <path d="M 80 144 Q 150 110 220 108" fill="none" stroke={HINT} strokeWidth="1.3" />
      <Headlight cx={88} cy={140} w={10} h={4} />
      <Taillight cx={364} cy={150} w={20} h={4} />
      <Wheel cx={96} cy={172} />
      <Wheel cx={308} cy={172} />
    </svg>
  )
}

// Mercedes GLE Coupé — fastback SUV, wide chrome.
export function MercedesGleCoupe(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow />
      <path
        d="M 28 162 Q 26 138 40 130 L 84 124 Q 94 86 138 78 L 250 70 Q 294 70 326 88 L 366 112 Q 378 122 378 146 L 378 166 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 114 88 Q 136 48 184 46 L 252 50 Q 284 56 314 100 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="200" y1="48" x2="200" y2="88" stroke={LINE_2} strokeWidth="1" />
      {/* Mercedes chrome belt */}
      <path d="M 56 138 L 362 138" stroke={LINE_2} strokeWidth="2" />
      <path d="M 50 124 L 356 124" stroke={HINT} strokeWidth="1" />
      {/* Star headlight cluster */}
      <Headlight cx={42} cy={130} w={18} h={4} />
      <Taillight cx={370} cy={130} w={20} h={4} />
      {/* Quad exhausts hint */}
      <line x1="346" y1="166" x2="356" y2="166" stroke={LINE} strokeWidth="2" strokeLinecap="round" />
      <line x1="358" y1="166" x2="368" y2="166" stroke={LINE} strokeWidth="2" strokeLinecap="round" />
      <Wheel cx={102} cy={162} />
      <Wheel cx={310} cy={162} />
    </svg>
  )
}

// BMW Série 3 / 4 — classic sport sedan with kidney grille hint and Hofmeister kink.
export function Bmw3Series(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow />
      <path
        d="M 22 162 Q 20 142 34 134 L 76 128 Q 94 108 144 104 L 264 102 Q 304 104 332 118 L 372 132 Q 384 138 384 156 L 384 168 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 116 108 Q 138 68 186 66 L 264 68 Q 290 72 304 110 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="206" y1="67" x2="206" y2="108" stroke={LINE_2} strokeWidth="1" />
      {/* Hofmeister kink (signature BMW C-pillar) */}
      <path d="M 286 108 Q 296 90 304 110" fill="none" stroke={LINE} strokeWidth="1.4" />
      {/* Shoulder line */}
      <path d="M 70 130 L 360 132" stroke={HINT} strokeWidth="1.4" />
      {/* Twin kidney hint (front grille) */}
      <rect x="24" y="135" width="6" height="14" fill="none" stroke={LINE} strokeWidth="1.2" />
      <rect x="32" y="135" width="6" height="14" fill="none" stroke={LINE} strokeWidth="1.2" />
      <Headlight cx={48} cy={140} w={12} h={3} />
      <Taillight cx={376} cy={140} w={14} h={3} />
      <Wheel cx={96} cy={166} r={22} />
      <Wheel cx={314} cy={166} r={22} />
    </svg>
  )
}

// Range Rover — flat roof, vertical sides, classic stance.
export function RangeRover(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow />
      <path
        d="M 28 162 Q 26 134 40 128 L 78 122 Q 86 76 122 70 L 296 70 Q 322 72 338 80 L 374 96 Q 384 100 384 146 L 384 164 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Flat roof */}
      <line x1="92" y1="34" x2="336" y2="34" stroke={LINE} strokeWidth="2" />
      <path
        d="M 78 76 Q 86 34 120 34 L 304 34 Q 332 34 338 80 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      {/* Vertical D-pillar (Range Rover signature) */}
      <line x1="318" y1="34" x2="324" y2="76" stroke={LINE_2} strokeWidth="1.4" />
      <line x1="142" y1="36" x2="142" y2="80" stroke={LINE_2} strokeWidth="1" />
      <line x1="200" y1="36" x2="200" y2="80" stroke={LINE_2} strokeWidth="1" />
      <line x1="258" y1="36" x2="258" y2="80" stroke={LINE_2} strokeWidth="1" />
      <path d="M 60 124 L 366 124" stroke={LINE_2} strokeWidth="1.4" />
      {/* Body cladding bottom */}
      <path d="M 60 152 L 366 152" stroke={HINT} strokeWidth="1" />
      <Headlight cx={36} cy={120} w={20} h={6} />
      <Taillight cx={376} cy={120} w={14} h={20} />
      <Wheel cx={102} cy={164} r={26} />
      <Wheel cx={314} cy={164} r={26} />
    </svg>
  )
}

// Rolls-Royce — extreme front overhang, Pantheon grille upright.
export function RollsRoyce(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow />
      <path
        d="M 20 162 Q 18 134 32 124 L 80 116 Q 90 88 134 82 L 308 82 Q 332 84 348 92 L 378 108 Q 386 112 386 152 L 386 168 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* Long flat roof — Rolls signature */}
      <path
        d="M 96 88 Q 108 56 144 56 L 312 56 Q 330 56 342 92 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="160" y1="56" x2="160" y2="88" stroke={LINE_2} strokeWidth="1" />
      <line x1="232" y1="56" x2="232" y2="88" stroke={LINE_2} strokeWidth="1" />
      <line x1="306" y1="56" x2="306" y2="88" stroke={LINE_2} strokeWidth="1" />
      {/* Pantheon vertical grille (the unmistakable Rolls-Royce face) */}
      <rect x="26" y="118" width="22" height="32" fill="none" stroke={LINE} strokeWidth="1.5" />
      {[30, 34, 38, 42].map((x) => (
        <line key={x} x1={x} y1="120" x2={x} y2="148" stroke={LINE_2} strokeWidth="0.9" />
      ))}
      {/* Spirit of Ecstasy hint (small triangle on hood) */}
      <path d="M 36 116 L 38 112 L 40 116 Z" fill={LINE} />
      <Headlight cx={62} cy={128} w={14} h={6} />
      <Taillight cx={378} cy={128} w={14} h={20} />
      <Wheel cx={102} cy={166} r={22} />
      <Wheel cx={316} cy={166} r={22} />
    </svg>
  )
}

// Bentley — massive limousine, round headlights, broad shoulders.
export function Bentley(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow />
      <path
        d="M 22 162 Q 18 136 34 128 L 82 122 Q 96 88 138 82 L 296 82 Q 322 84 340 92 L 374 110 Q 384 116 384 152 L 384 168 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 102 90 Q 116 58 152 56 L 300 58 Q 326 60 340 96 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="174" y1="57" x2="174" y2="90" stroke={LINE_2} strokeWidth="1" />
      <line x1="244" y1="57" x2="244" y2="90" stroke={LINE_2} strokeWidth="1" />
      {/* Broad chrome belt */}
      <path d="M 60 126 L 366 126" stroke={LINE_2} strokeWidth="2" />
      <path d="M 56 142 L 368 142" stroke={HINT} strokeWidth="1" />
      {/* Round twin Bentley headlights */}
      <circle cx={42} cy={132} r="9" fill="none" stroke={LINE} strokeWidth="1.4" />
      <circle cx={62} cy={132} r="7" fill="none" stroke={LINE_2} strokeWidth="1.2" />
      <Taillight cx={374} cy={132} w={18} h={6} />
      <Wheel cx={104} cy={166} />
      <Wheel cx={314} cy={166} />
    </svg>
  )
}

// Toyota GT86 — small sport coupe, long hood, low cabin.
export function ToyotaGt86(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={140} />
      <path
        d="M 32 166 Q 28 142 44 134 L 78 128 Q 96 100 138 92 L 248 88 Q 286 92 312 110 L 350 126 Q 368 132 368 156 L 368 170 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 118 96 Q 142 62 188 60 L 250 60 Q 274 66 292 110 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="206" y1="60" x2="206" y2="96" stroke={LINE_2} strokeWidth="1" />
      {/* Long hood crease */}
      <path d="M 48 134 L 100 120" stroke={HINT} strokeWidth="1" />
      <path d="M 70 138 L 358 138" stroke={HINT} strokeWidth="1.3" />
      <Headlight cx={42} cy={140} w={16} h={5} />
      <Taillight cx={362} cy={140} w={14} h={4} />
      <Wheel cx={98} cy={168} r={22} />
      <Wheel cx={306} cy={168} r={22} />
    </svg>
  )
}

// Nissan Juke — quirky mini SUV with round upper headlights.
export function NissanJuke(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={130} />
      <path
        d="M 70 162 Q 68 138 80 130 L 108 124 Q 120 92 154 86 L 252 86 Q 282 86 302 100 L 326 114 Q 338 120 338 144 L 338 165 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <path
        d="M 124 92 Q 138 54 174 52 L 248 52 Q 274 54 290 96 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
      />
      <line x1="184" y1="52" x2="184" y2="92" stroke={LINE_2} strokeWidth="1" />
      <line x1="240" y1="52" x2="240" y2="92" stroke={LINE_2} strokeWidth="1" />
      {/* Round upper headlights — Juke signature */}
      <circle cx={88} cy={102} r="6" fill="none" stroke={LINE} strokeWidth="1.4" />
      {/* Lower running lights */}
      <ellipse cx={82} cy={132} rx="8" ry="3" fill="none" stroke={LINE_2} strokeWidth="1.2" />
      <path d="M 90 142 L 322 142" stroke={LINE_2} strokeWidth="1.5" />
      <Taillight cx={332} cy={134} w={12} />
      <Wheel cx={112} cy={164} />
      <Wheel cx={272} cy={164} />
    </svg>
  )
}

// Audi TT RS — small fastback coupé. Iconic single-arc roofline
// from windshield to short rear, generous wheel arches.
export function AudiTtRs(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={140} />
      <path
        d="M 38 162 Q 32 138 52 130 L 92 122 Q 112 96 156 90 L 248 88 Q 286 92 312 110 L 348 126 Q 364 132 364 158 L 364 170 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Continuous arched greenhouse — TT signature */}
      <path
        d="M 122 96 Q 158 52 206 50 Q 256 52 296 112"
        fill="none"
        stroke={LINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Door cut */}
      <line x1="208" y1="52" x2="208" y2="96" stroke={LINE_2} strokeWidth="1.2" />
      {/* Beltline */}
      <path d="M 68 138 L 354 138" stroke={LINE_2} strokeWidth="1.5" />
      {/* Single-frame Audi grille */}
      <rect x="38" y="140" width="20" height="18" rx="2.5" fill="none" stroke={LINE} strokeWidth="1.6" />
      <Headlight cx={70} cy={132} w={22} h={6} />
      <Taillight cx={354} cy={138} w={16} h={5} />
      <Wheel cx={108} cy={170} r={26} />
      <Wheel cx={300} cy={170} r={26} />
    </svg>
  )
}

// Mercedes-AMG GT Roadster — long hood, short cabin, open top.
// Big proportions, signature Panamericana vertical-slat grille.
export function MercedesAmgGtRoadster(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={160} />
      {/* Body — very long hood, short rear deck */}
      <path
        d="M 28 160 Q 22 132 44 124 L 92 116 Q 116 102 162 96 L 220 92 Q 258 96 284 116 L 324 126 Q 358 132 366 152 L 366 170 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Windshield only — open roadster, no roof line */}
      <path
        d="M 200 96 Q 220 78 246 78 Q 258 88 262 116"
        fill="none"
        stroke={LINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Hood crease lines */}
      <path d="M 60 132 L 200 116" stroke={LINE_2} strokeWidth="1.4" />
      {/* Panamericana grille — 4 vertical slats */}
      <rect x="22" y="128" width="22" height="24" rx="3" fill="none" stroke={LINE} strokeWidth="1.6" />
      {[28, 33, 38].map((x) => (
        <line
          key={x}
          x1={x}
          y1="132"
          x2={x}
          y2="148"
          stroke={LINE}
          strokeWidth="1.2"
        />
      ))}
      <Headlight cx={56} cy={128} w={22} h={6} />
      <Taillight cx={356} cy={140} w={18} h={5} />
      <Wheel cx={110} cy={170} r={26} />
      <Wheel cx={300} cy={170} r={26} />
    </svg>
  )
}

// BMW i4 Gran Coupé — 4-door fastback. Lower-slung than 3-Series,
// flowing roofline, twin vertical kidney grille.
export function BmwI4(_p: SvgProps) {
  const id = useId()
  return (
    <svg viewBox={VB} xmlns="http://www.w3.org/2000/svg" aria-hidden className={COMMON}>
      <Defs id={id} />
      <Shadow rx={160} />
      <path
        d="M 32 162 Q 26 138 46 130 L 84 124 Q 104 96 146 88 L 252 84 Q 296 88 322 110 L 354 124 Q 370 132 370 158 L 370 170 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Flowing Gran Coupé greenhouse */}
      <path
        d="M 116 92 Q 134 50 184 48 L 268 52 Q 296 62 312 110"
        fill="none"
        stroke={LINE}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* Two door cuts — front + rear doors */}
      <line x1="184" y1="50" x2="184" y2="92" stroke={LINE_2} strokeWidth="1.2" />
      <line x1="234" y1="51" x2="234" y2="92" stroke={LINE_2} strokeWidth="1.2" />
      {/* Beltline */}
      <path d="M 70 134 L 360 134" stroke={LINE_2} strokeWidth="1.5" />
      {/* BMW twin-kidney grille — vertical bars */}
      <rect x="32" y="128" width="12" height="28" rx="1.8" fill="none" stroke={LINE} strokeWidth="1.6" />
      <rect x="48" y="128" width="12" height="28" rx="1.8" fill="none" stroke={LINE} strokeWidth="1.6" />
      {/* L-shape angular headlight */}
      <path d="M 64 130 L 92 130 L 92 138" fill="none" stroke={LINE} strokeWidth="1.8" strokeLinejoin="round" />
      <Taillight cx={362} cy={140} w={22} h={5} />
      <Wheel cx={112} cy={170} r={26} />
      <Wheel cx={312} cy={170} r={26} />
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Dispatcher
// ═══════════════════════════════════════════════════════════════════

const COMPONENTS: Record<BodyType, (p: SvgProps) => ReactElement> = {
  'suv-coupe': SuvCoupe,
  suv: Suv,
  'sport-sedan': SportSedan,
  supercar: Supercar,
  hypercar: Hypercar,
  'jdm-sport': JdmSport,
  sedan: Sedan,
  'mini-suv': MiniSuv,
  'porsche-911': Porsche911,
  'porsche-cayenne-coupe': PorscheCayenneCoupe,
  'ferrari-berlinetta': FerrariBerlinetta,
  'lambo-wedge': LamboWedge,
  mclaren: McLaren,
  bugatti: Bugatti,
  'mercedes-gle-coupe': MercedesGleCoupe,
  'mercedes-amg-gt-roadster': MercedesAmgGtRoadster,
  'bmw-3-series': Bmw3Series,
  'bmw-i4': BmwI4,
  'range-rover': RangeRover,
  'rolls-royce': RollsRoyce,
  bentley: Bentley,
  'audi-tt-rs': AudiTtRs,
  'toyota-gt86': ToyotaGt86,
  'nissan-juke': NissanJuke,
}

/** Renders the silhouette for a given body type. Unknown types fall
 *  back to the generic sedan. The `color` prop is accepted for back-
 *  compat with the previous filled-gradient API but is now unused —
 *  every silhouette is monochrome, the brand tint lives on the parent
 *  garage card. */
export default function CarSilhouette({
  type,
}: {
  type: BodyType
  color?: string
}) {
  const Comp = COMPONENTS[type] ?? Sedan
  return <Comp />
}

// Re-export SvgProps so callers that need the type signature can use it
// without importing private internals.
export type { SvgProps as CarSilhouetteProps }
