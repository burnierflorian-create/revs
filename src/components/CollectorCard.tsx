import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, MapPin, Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Spot, Rarity } from '../lib/spots'
import { xpForSpot } from '../lib/spots'
import { fetchCardSpecs, type CardSpecs } from '../lib/cardSpecs'

const RARITY_ORDER: Rarity[] = ['commun', 'rare', 'ultra_rare', 'unique']

export function rarityRank(r: Rarity | null | undefined): number {
  return RARITY_ORDER.indexOf((r ?? 'commun') as Rarity)
}

const RARITY_LABEL: Record<Rarity, string> = {
  commun: 'COMMUN',
  rare: 'RARE',
  ultra_rare: 'ULTRA RARE',
  unique: 'LÉGENDAIRE',
}

const RARITY_VISUAL: Record<
  Rarity,
  { frame: string; chipBg: string; chipFg: string; glow: string; animated?: boolean }
> = {
  commun: {
    frame: '#888888',
    chipBg: 'rgba(136, 136, 136, 0.22)',
    chipFg: '#E5E7EB',
    glow: '0 14px 32px rgba(0, 0, 0, 0.55)',
  },
  rare: {
    frame: '#4A9EFF',
    chipBg: 'rgba(74, 158, 255, 0.22)',
    chipFg: '#BFDBFE',
    glow: '0 14px 34px rgba(74, 158, 255, 0.35)',
  },
  ultra_rare: {
    frame: '#9B59B6',
    chipBg: 'rgba(155, 89, 182, 0.30)',
    chipFg: '#E9D5FF',
    glow: '0 16px 38px rgba(155, 89, 182, 0.45)',
  },
  unique: {
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

/** Smart shortening rules applied before any auto-fit work:
 *  - Drop anything in parentheses ("(8S facelift)", "(F30)", …) since
 *    generation codes are noise on a card.
 *  - Drop a single trailing body-type word (Roadster / Coupé / etc.)
 *    when it makes the result fit better.
 *  The auto-fit FitText handles the rest by shrinking the font down
 *  to 11px and wrapping to two lines only as a last resort. */
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

/** Auto-shrink a single-line label to fit its container. Starts at
 *  `max` px, steps down to `min` px. If even at `min` the text still
 *  overflows, allows it to wrap (whiteSpace: normal) instead of
 *  ellipsing — the spec is explicit: never truncate with "…". */
function FitText({
  text,
  max = 15,
  min = 11,
  className,
  style,
}: {
  text: string
  max?: number
  min?: number
  className?: string
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [wrap, setWrap] = useState(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      // Force single-line during measurement
      el.style.whiteSpace = 'nowrap'
      let s = max
      el.style.fontSize = `${s}px`
      while (s > min && el.scrollWidth > el.offsetWidth + 0.5) {
        s -= 1
        el.style.fontSize = `${s}px`
      }
      // If even at min it still overflows, allow wrapping rather
      // than clipping. React state flip triggers the second render.
      if (el.scrollWidth > el.offsetWidth + 0.5) {
        setWrap(true)
      } else {
        setWrap(false)
      }
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (el.parentElement) ro.observe(el.parentElement)
    return () => ro.disconnect()
  }, [text, max, min])

  return (
    <span
      ref={ref}
      className={className}
      style={{
        // Use -webkit-box so WebkitLineClamp can cap the wrap fallback
        // at 2 lines. Harmless when wrap=false (whiteSpace:nowrap +
        // overflow:hidden govern the single-line measurement instead).
        display: '-webkit-box',
        WebkitBoxOrient: 'vertical',
        WebkitLineClamp: 2,
        whiteSpace: wrap ? 'normal' : 'nowrap',
        overflow: 'hidden',
        textOverflow: 'clip',
        lineHeight: 1.05,
        wordBreak: 'break-word',
        ...style,
      }}
    >
      {text}
    </span>
  )
}

/** Collector card — 2:3 portrait, Pokemon/Panini layout. Tap flips
 *  in 3D to reveal community meta + Claude-sourced specs. Specs are
 *  lazy-loaded on first flip; spinner during fetch. */
export default function CollectorCard({
  spot,
  cardNumber,
  isFirstOnRevs,
  spotsCount,
}: {
  spot: Spot
  cardNumber: number
  isFirstOnRevs: boolean
  spotsCount: number
}) {
  const [flipped, setFlipped] = useState(false)
  const [specs, setSpecs] = useState<CardSpecs | null>(null)
  const [specsLoading, setSpecsLoading] = useState(false)
  const [specsTried, setSpecsTried] = useState(false)

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

  const rarity = (spot.rarity ?? 'commun') as Rarity
  const v = RARITY_VISUAL[rarity]
  const xp = xpForSpot(spot.estimated_price, spot.rarity)
  const holo = rarity === 'ultra_rare' || rarity === 'unique'
  const shortName = shortModelName(spot.model)

  return (
    <div
      className="collector-frame"
      style={{
        background: v.frame,
        backgroundSize: v.animated ? '250% 100%' : undefined,
        animation: v.animated ? 'legendary-frame-shimmer 3.4s linear infinite' : undefined,
        boxShadow: v.glow,
        aspectRatio: '2 / 3',
        padding: '2px',
        borderRadius: '16px',
        width: '100%',
      }}
    >
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        className="collector-flip tappable relative block h-full w-full text-left"
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
          rarity === 'unique'
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
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[14px] bg-[#0d0d0d]">
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
          className="uppercase text-white/55"
          style={{ fontSize: '8.5px', letterSpacing: '0.18em' }}
        >
          {spot.brand}
        </p>
        <FitText
          text={shortName + (spot.year ? ` · ${spot.year}` : '')}
          max={15}
          min={11}
          className="font-display font-extrabold tracking-tight text-white"
          style={{ marginTop: '2px' }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span
            className="font-extrabold text-accent"
            style={{ fontSize: '11px' }}
          >
            +{xp} XP
          </span>
          <span className="text-white/45" style={{ fontSize: '9px' }}>
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
          className="uppercase text-white/55"
          style={{ fontSize: '8.5px', letterSpacing: '0.18em' }}
        >
          {spot.brand}
        </p>
        <FitText
          text={shortName}
          max={14}
          min={11}
          className="font-display font-extrabold tracking-tight text-white"
          style={{ marginTop: '2px' }}
        />
      </div>

      {/* Specs grid — 2x2. "—" while specsLoading is false and specs
          is null (i.e., not yet attempted or failed). Spinner during
          the in-flight fetch. */}
      <div
        className="mx-3 mt-2 rounded-xl p-2.5"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {specsLoading ? (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-fg2" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
            <Stat label="PUISSANCE" value={dash(specs?.horsepower)} />
            <Stat label="0 → 100" value={dash(specs?.zero_to_100)} />
            <Stat label="V. MAX" value={dash(specs?.top_speed)} />
            <Stat label="COUPLE" value={dash(specs?.torque)} />
          </div>
        )}
      </div>

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

      {/* Footer: card serial + first-on-REVS trophy + Voir sur la carte */}
      <div className="mt-auto px-3 pb-3 pt-2">
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
  return (
    <div>
      <p
        className="text-fg2"
        style={{ fontSize: '7.5px', letterSpacing: '0.12em' }}
      >
        {label}
      </p>
      <p
        className="mt-0.5 font-extrabold text-white"
        style={{ fontSize: '11px' }}
      >
        {value}
      </p>
    </div>
  )
}
