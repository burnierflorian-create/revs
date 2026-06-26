import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, MapPin, Share2, Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Spot, Rarity } from '../lib/spots'
import { xpForSpot } from '../lib/spots'
import { fetchCardSpecs, type CardSpecs } from '../lib/cardSpecs'
import { prefersReducedMotion } from '../lib/motion'
import { openShareCard } from './ShareCardSheet'

const RARITY_ORDER: Rarity[] = [
  'standard',
  'premium',
  'performance',
  'exclusif',
  'supercar',
  'hypercar',
]

export function rarityRank(r: Rarity | null | undefined): number {
  return RARITY_ORDER.indexOf((r ?? 'standard') as Rarity)
}

const RARITY_LABEL: Record<Rarity, string> = {
  standard: 'STANDARD',
  premium: 'PREMIUM',
  performance: 'PERFORMANCE',
  exclusif: 'EXCLUSIF',
  supercar: 'SUPERCAR',
  hypercar: 'HYPERCAR',
}

const RARITY_VISUAL: Record<
  Rarity,
  { frame: string; chipBg: string; chipFg: string; glow: string; animated?: boolean }
> = {
  standard: {
    frame: '#888888',
    chipBg: 'rgba(136, 136, 136, 0.22)',
    chipFg: '#E5E7EB',
    glow: '0 14px 32px rgba(0, 0, 0, 0.55)',
  },
  premium: {
    frame: '#4A9EFF',
    chipBg: 'rgba(74, 158, 255, 0.22)',
    chipFg: '#BFDBFE',
    glow: '0 14px 34px rgba(74, 158, 255, 0.35)',
  },
  performance: {
    frame: '#EF4444',
    chipBg: 'rgba(239, 68, 68, 0.22)',
    chipFg: '#FECACA',
    glow: '0 14px 36px rgba(239, 68, 68, 0.40)',
  },
  exclusif: {
    // Brushed bronze — warmer than premium blue, less flashy than gold
    frame: '#B87333',
    chipBg: 'rgba(184, 115, 51, 0.24)',
    chipFg: '#F3D7B0',
    glow: '0 16px 38px rgba(184, 115, 51, 0.42)',
  },
  supercar: {
    frame: '#9B59B6',
    chipBg: 'rgba(155, 89, 182, 0.30)',
    chipFg: '#E9D5FF',
    glow: '0 16px 38px rgba(155, 89, 182, 0.45)',
  },
  hypercar: {
    frame:
      'linear-gradient(120deg, #E0B341 0%, #FFD700 25%, #FFF6C8 45%, #FFD700 65%, #B8860B 100%)',
    chipBg:
      'linear-gradient(120deg, #E0B341 0%, #FFD700 45%, #B8860B 100%)',
    chipFg: '#1a1306',
    glow: '0 18px 44px rgba(255, 200, 50, 0.50)',
    animated: true,
  },
}

function dateLabel(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  }).format(new Date(iso))
}

/** Smart shortening rules applied before the model name lands in
 *  the card layout. Pre-2026-05-31 we also passed the result through
 *  a FitText hook that auto-shrank to 11px and wrapped to 2 lines
 *  rather than ellipsing — that's been swapped for a plain truncate
 *  per the launch polish spec. Long names now end in "…". */
const TRAILING_BODY_WORDS = new Set([
  'roadster',
  'cabriolet',
  'convertible',
  'spider',
  'spyder',
  'sedan',
  'berline',
  'saloon',
  'estate',
  'touring',
  'wagon',
  'avant',
  'sportback',
  'liftback',
  'fastback',
  'shooting',
  'gran',
  'gt',
  'suv',
  'crossover',
])

function shortModelName(model: string): string {
  let s = model.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
  // Only strip trailing body word when the cleaned name is still
  // visibly long (> 22 chars). Below that we keep "Coupé" / "Roadster"
  // because they carry useful info ("M4" vs "M4 Coupé").
  if (s.length > 22) {
    const parts = s.split(' ')
    const last = parts[parts.length - 1]?.toLowerCase() ?? ''
    if (last && TRAILING_BODY_WORDS.has(last)) {
      s = parts.slice(0, -1).join(' ').trim() || s
    }
  }
  return s
}

/** Collector card — 2:3 portrait, Pokemon/Panini layout. Tap flips
 *  in 3D to reveal community meta + Claude-sourced specs. Specs are
 *  lazy-loaded on first flip; spinner during fetch. */
export default function CollectorCard({
  spot,
  cardNumber,
  isFirstOnRevs,
  spotsCount,
  reveal = false,
  showShare = false,
}: {
  spot: Spot
  cardNumber: number
  isFirstOnRevs: boolean
  spotsCount: number
  /** Play the first-appearance reveal (face-down → shake → 3D flip →
   *  flash, plus gold dust for legendary/hypercar cards). */
  reveal?: boolean
  /** Show a "Partager" button under the card (collection grid). */
  showShare?: boolean
}) {
  const [flipped, setFlipped] = useState(false)
  // The reveal plays once on mount; afterwards the card renders plainly.
  // Skipped entirely under reduced motion.
  const [revealing, setRevealing] = useState(
    () => reveal && !prefersReducedMotion(),
  )
  useEffect(() => {
    if (!revealing) return
    const t = window.setTimeout(() => {
      setRevealing(false)
      // Wow moment: a freshly-revealed LEGENDARY card auto-opens the share
      // sheet so the user can post it straight to their story.
      if (reveal && spot.rarity === 'hypercar') {
        openShareCard({
          photoUrl: spot.photo_url,
          brand: spot.brand,
          model: spot.model,
          year: spot.year,
          rarity: 'hypercar',
          autoMessage: 'Ta carte est prête à être partagée ! 🔥',
        })
      }
    }, 2100)
    return () => window.clearTimeout(t)
  }, [revealing, reveal, spot])
  const [specs, setSpecs] = useState<CardSpecs | null>(null)
  const [specsLoading, setSpecsLoading] = useState(false)
  const [specsTried, setSpecsTried] = useState(false)

  // Touch-drag 3D tilt: the card follows the finger and pivots in 3D
  // (rotateY ≤25°, rotateX ≤10°), then springs back on release. A real
  // drag suppresses the tap-to-flip so the two gestures don't collide.
  const [tilt, setTilt] = useState<{ rx: number; ry: number } | null>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)
  const movedRef = useRef(false)
  function onTouchStart(e: React.TouchEvent) {
    if (prefersReducedMotion()) return
    const t = e.touches[0]
    dragRef.current = { x: t.clientX, y: t.clientY }
    movedRef.current = false
  }
  function onTouchMove(e: React.TouchEvent) {
    const d = dragRef.current
    if (!d) return
    const t = e.touches[0]
    const dx = t.clientX - d.x
    const dy = t.clientY - d.y
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) movedRef.current = true
    const ry = Math.max(-25, Math.min(25, (dx / window.innerWidth) * 25))
    const rx = Math.max(-10, Math.min(10, (dy / window.innerHeight) * 10))
    setTilt({ rx, ry })
  }
  function onTouchEnd() {
    dragRef.current = null
    setTilt(null) // spring back to rest
  }

  // Lazy fetch: only the first time the card is flipped to the back.
  // Server caches per (brand, model, year) so subsequent flips across
  // cards or users are free. Failure stays in `null` → renders "—".
  useEffect(() => {
    if (!flipped || specsTried || specsLoading) return
    setSpecsLoading(true)
    fetchCardSpecs(spot.brand, spot.model, spot.year).then((r) => {
      setSpecs(r)
      setSpecsLoading(false)
      setSpecsTried(true)
    })
  }, [flipped, specsTried, specsLoading, spot.brand, spot.model, spot.year])

  const rarity = (spot.rarity ?? 'standard') as Rarity
  const v = RARITY_VISUAL[rarity]
  const xp = xpForSpot(spot.estimated_price, spot.rarity)
  const holo = rarity === 'supercar' || rarity === 'hypercar'
  const shortName = shortModelName(spot.model)

  // Desktop hover tilt + shimmer sweep only on the two top tiers —
  // commun and rare stay still so the premium tiers stand out. Mobile
  // (no hover media) inherits the static class and the tap-flip
  // mechanic stays primary.
  const tiltable = rarity === 'supercar' || rarity === 'hypercar'

  const card = (
    <div
      className={`collector-frame ${tiltable ? 'tilt-hover' : ''}`}
      style={{
        background: v.frame,
        backgroundSize: v.animated ? '250% 100%' : undefined,
        animation: v.animated ? 'legendary-frame-shimmer 3.4s linear infinite' : undefined,
        boxShadow: v.glow,
        aspectRatio: '2 / 3',
        padding: '2px',
        borderRadius: '16px',
        width: '100%',
        position: 'relative',
      }}
    >
      {/* Diagonal white shimmer that sweeps across on hover; only
          rendered for tilt-eligible cards so the DOM stays minimal
          for commun / rare rows. */}
      {tiltable && (
        <span aria-hidden className="collector-tilt-shimmer" />
      )}

      <button
        type="button"
        onClick={() => {
          // A drag isn't a flip — swallow the synthetic click after a swipe.
          if (movedRef.current) {
            movedRef.current = false
            return
          }
          setFlipped((f) => !f)
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className="collector-flip tappable relative block h-full w-full text-left"
        style={{
          transformStyle: 'preserve-3d',
          transform: tilt
            ? `rotateY(${tilt.ry}deg) rotateX(${tilt.rx}deg)`
            : undefined,
          transition: tilt
            ? 'none'
            : 'transform 400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          filter: tilt
            ? `drop-shadow(${-tilt.ry * 0.5}px 8px 12px rgba(0,0,0,0.45))`
            : undefined,
        }}
        aria-pressed={flipped}
        aria-label={`Retourner la carte ${spot.brand} ${shortName}`}
      >
        <div className={`collector-flip-inner ${flipped ? 'is-flipped' : ''}`}>
          <div className="collector-face collector-face-front">
            <FrontFace
              spot={spot}
              rarity={rarity}
              chipBg={v.chipBg}
              chipFg={v.chipFg}
              holo={holo}
              animatedChip={!!v.animated}
              xp={xp}
              shortName={shortName}
            />
          </div>

          <div className="collector-face collector-face-back">
            <BackFace
              spot={spot}
              rarity={rarity}
              chipBg={v.chipBg}
              chipFg={v.chipFg}
              animatedChip={!!v.animated}
              shortName={shortName}
              cardNumber={cardNumber}
              isFirstOnRevs={isFirstOnRevs}
              spotsCount={spotsCount}
              specs={specs}
              specsLoading={specsLoading}
            />
          </div>
        </div>
      </button>
    </div>
  )

  if (!revealing) {
    if (!showShare) return card
    return (
      <div>
        {card}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            openShareCard({
              photoUrl: spot.photo_url,
              brand: spot.brand,
              model: spot.model,
              year: spot.year,
              rarity,
            })
          }}
          className="tappable mt-2 flex w-full items-center justify-center gap-2 text-sm font-semibold text-white"
          style={{ background: '#1a1a1a', borderRadius: 12, padding: '10px 16px' }}
          aria-label={`Partager la carte ${spot.brand} ${shortName}`}
        >
          <Share2 className="h-4 w-4" />
          Partager
        </button>
      </div>
    )
  }

  // First-appearance reveal: the real card sits inside an element that
  // shakes then flips in 3D; a dark "face-down" overlay covers it until
  // the mid-flip, a white flash marks the flip, and legendary (hypercar)
  // cards spit out 20 gold particles.
  const legendary = rarity === 'hypercar'
  return (
    <div className="fx-reveal" style={{ width: '100%' }}>
      <div className="fx-reveal-inner">{card}</div>
      <div className="fx-reveal-back">R</div>
      <div className="fx-reveal-flash" />
      {legendary &&
        Array.from({ length: 20 }).map((_, i) => {
          const a = (i / 20) * Math.PI * 2
          const d = 60 + (i % 5) * 14
          return (
            <span
              key={i}
              className="fx-gold-dust"
              style={
                {
                  '--dx': `${Math.cos(a) * d}px`,
                  '--dy': `${Math.sin(a) * d}px`,
                  '--rot': '360deg',
                } as React.CSSProperties
              }
            />
          )
        })}
    </div>
  )
}

function RevsWordmark() {
  return (
    <span
      className="font-display font-extrabold tracking-tighter text-accent"
      style={{ fontSize: '11px', letterSpacing: '-0.02em' }}
    >
      REVS
    </span>
  )
}

function RarityChip({
  rarity,
  bg,
  fg,
  animated,
}: {
  rarity: Rarity
  bg: string
  fg: string
  animated: boolean
}) {
  return (
    <span
      className="rounded-full font-extrabold uppercase"
      style={{
        background: bg,
        color: fg,
        padding: '3px 8px',
        fontSize: '8.5px',
        letterSpacing: '0.10em',
        backgroundSize: animated ? '200% 100%' : undefined,
        animation: animated ? 'holo-shimmer 3.2s linear infinite' : undefined,
        border:
          rarity === 'hypercar'
            ? '1px solid rgba(255, 215, 0, 0.55)'
            : '1px solid rgba(255, 255, 255, 0.12)',
      }}
    >
      {RARITY_LABEL[rarity]}
    </span>
  )
}

function FrontFace({
  spot,
  rarity,
  chipBg,
  chipFg,
  holo,
  animatedChip,
  xp,
  shortName,
}: {
  spot: Spot
  rarity: Rarity
  chipBg: string
  chipFg: string
  holo: boolean
  animatedChip: boolean
  xp: number
  shortName: string
}) {
  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-[14px]"
      style={{
        // Subtle vertical gradient per the polish spec — top neutral-900
        // to bottom neutral-950. Reads as a single tone but feels less
        // plastic than a flat #0d0d0d.
        background: 'linear-gradient(180deg, #1a1a1a 0%, #0a0a0a 100%)',
      }}
    >
      <div className="flex flex-none items-center justify-between px-2.5 py-1.5">
        <RevsWordmark />
        <RarityChip rarity={rarity} bg={chipBg} fg={chipFg} animated={animatedChip} />
      </div>

      <div
        className="relative mx-2 overflow-hidden rounded-[10px] bg-[#050505]"
        style={{ flex: '0 0 60%', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)' }}
      >
        {spot.photo_url ? (
          <img
            src={spot.photo_url}
            alt={`${spot.brand} ${shortName}`}
            loading="lazy"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-fg2">
            pas de photo
          </div>
        )}
        {holo && <div className="collector-holo-overlay absolute inset-0 pointer-events-none" />}
      </div>

      <div className="mt-2 flex-1 px-3 pb-3">
        <p
          className="uppercase text-fg/55"
          style={{ fontSize: '8.5px', letterSpacing: '0.18em' }}
        >
          {spot.brand}
        </p>
        <p
          className="truncate text-left font-display font-extrabold tracking-tight text-white"
          style={{ fontSize: '14px', marginTop: '2px', letterSpacing: '-0.01em' }}
        >
          {shortName + (spot.year ? ` · ${spot.year}` : '')}
        </p>
        <div className="mt-2 flex items-center justify-between">
          {/* +XP micro-pastille — semi-transparent accent-tinted pill so
              the gain pops against the neutral card body. Matches the
              2026-06-01 collection polish: micro-pastilles instead of
              bare red text. */}
          <span
            className="font-black tabular-nums text-accent"
            style={{
              background: 'rgba(232, 32, 58, 0.12)',
              border: '1px solid rgba(232, 32, 58, 0.28)',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '10px',
              letterSpacing: '0.01em',
            }}
          >
            +{xp} XP
          </span>
          <span className="text-fg/45" style={{ fontSize: '9px' }}>
            {dateLabel(spot.created_at)}
          </span>
        </div>
      </div>
    </div>
  )
}

function BackFace({
  spot,
  rarity,
  chipBg,
  chipFg,
  animatedChip,
  shortName,
  cardNumber,
  isFirstOnRevs,
  spotsCount,
  specs,
  specsLoading,
}: {
  spot: Spot
  rarity: Rarity
  chipBg: string
  chipFg: string
  animatedChip: boolean
  shortName: string
  cardNumber: number
  isFirstOnRevs: boolean
  spotsCount: number
  specs: CardSpecs | null
  specsLoading: boolean
}) {
  const cardSerial = `#${String(cardNumber).padStart(3, '0')}`
  const showFirstBadge = isFirstOnRevs
  const dash = (v: string | undefined) => (v && v !== 'N/A' ? v : '—')

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-[14px] bg-[#0d0d0d]"
      style={{
        backgroundImage:
          'radial-gradient(circle at 20% 0%, rgba(232, 32, 58, 0.10), transparent 55%), radial-gradient(circle at 80% 100%, rgba(255,255,255,0.04), transparent 60%)',
      }}
    >
      <div className="flex flex-none items-center justify-between px-2.5 py-1.5">
        <span
          className="flex items-center gap-1 text-fg2"
          style={{ fontSize: '8.5px', letterSpacing: '0.08em' }}
        >
          <ArrowLeft className="h-2.5 w-2.5" />
          RETOUR
        </span>
        <RarityChip rarity={rarity} bg={chipBg} fg={chipFg} animated={animatedChip} />
      </div>

      <div className="px-3 pt-1">
        <p
          className="uppercase text-fg/55"
          style={{ fontSize: '8.5px', letterSpacing: '0.18em' }}
        >
          {spot.brand}
        </p>
        <p
          className="truncate text-left font-display font-extrabold tracking-tight text-white"
          style={{ fontSize: '13px', marginTop: '2px', letterSpacing: '-0.01em' }}
        >
          {shortName}
        </p>
      </div>

      {/* Specs grid — 2x2. "—" while specsLoading is false and specs
          is null (i.e., not yet attempted or failed). Spinner during
          the in-flight fetch. */}
      <div
        className="mx-3 mt-2 rounded-2xl p-2.5"
        style={{
          background: 'var(--color-glass-mid)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
        }}
      >
        {specsLoading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-fg2" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <Stat label="PUISSANCE" value={dash(specs?.horsepower)} />
            <Stat label="0 → 100" value={dash(specs?.zero_to_100)} />
            <Stat label="V. MAX" value={dash(specs?.top_speed)} />
            <Stat label="COUPLE" value={dash(specs?.torque)} />
          </div>
        )}
      </div>

      {/* Technical architecture line — mono font, neutral-500, single
          row. "V8 BiTurbo / Transm. Intégrale" / "Moteur Central
          Arrière / Propulsion" style. Hidden on loading or N/A. */}
      {!specsLoading && specs?.architecture && specs.architecture !== 'N/A' && (
        <p
          className="mx-3 mt-2 truncate font-mono text-fg2/65"
          style={{ fontSize: '10px', letterSpacing: '0.02em' }}
        >
          {specs.architecture}
        </p>
      )}

      {/* Fun fact — single short line, italic feel. Hidden when loading
          or when N/A so the layout doesn't carry an empty box. */}
      {!specsLoading && specs?.fun_fact && specs.fun_fact !== 'N/A' && (
        <p
          className="mx-3 mt-2 text-fg/80"
          style={{ fontSize: '9.5px', lineHeight: 1.35 }}
        >
          {specs.fun_fact}
        </p>
      )}

      {/* Community line — count of same-model spots on REVS */}
      <p
        className="mx-3 mt-2 text-fg2"
        style={{ fontSize: '9px', letterSpacing: '0.04em' }}
      >
        {spotsCount} spot{spotsCount > 1 ? 's' : ''} de ce modèle sur REVS
      </p>

      {/* Footer: card serial + first-on-REVS trophy + Voir sur la carte.
          pb-4 (instead of pb-3) so "Carte #001 · 1er sur REVS" never
          brushes the rarity frame on long cards. */}
      <div className="mt-auto px-3 pb-4 pt-2">
        <div
          className="mb-2 flex items-center gap-1.5 text-fg2"
          style={{ fontSize: '9.5px', letterSpacing: '0.06em' }}
        >
          <span className="font-extrabold text-white">Carte {cardSerial}</span>
          {showFirstBadge && (
            <>
              <span className="text-fg2/40">·</span>
              <span
                className="flex items-center gap-0.5 font-extrabold"
                style={{ color: '#FFD700' }}
              >
                <Trophy className="h-2.5 w-2.5" />
                1er sur REVS
              </span>
            </>
          )}
        </div>
        <Link
          to={`/spot/${spot.id}`}
          onClick={(e) => e.stopPropagation()}
          className="tappable flex w-full items-center justify-center gap-1.5 rounded-full bg-accent py-2 font-extrabold uppercase tracking-wider text-white"
          style={{ fontSize: '10px', boxShadow: '0 6px 18px rgba(232, 32, 58, 0.40)' }}
        >
          <MapPin className="h-3 w-3" />
          Voir sur la carte
        </Link>
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  // Per-cell glass tile — gives each spec its own mini-frame so the
  // back face reads as a stat-block rather than a flat 2x2 of text.
  return (
    <div
      className="flex flex-col rounded-xl px-2 py-1.5"
      style={{
        background: 'rgba(0, 0, 0, 0.40)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
      }}
    >
      <p
        className="font-bold uppercase text-fg/50"
        style={{ fontSize: '8px', letterSpacing: '0.14em' }}
      >
        {label}
      </p>
      <p
        className="mt-0.5 font-display tracking-tight text-white"
        style={{ fontSize: '13px', fontWeight: 900, lineHeight: 1.1 }}
      >
        {value}
      </p>
    </div>
  )
}
