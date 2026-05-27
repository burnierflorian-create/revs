import { useState } from 'react'
import { ArrowLeft, MapPin, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { Spot, Rarity } from '../lib/spots'
import { xpForSpot } from '../lib/spots'

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

/** Each tier ships its own visual identity for the frame, the rarity
 *  chip and the outer glow. `frame` is rendered as a 2px-thick padded
 *  wrapper so we can swap between flat colors and animated gradients
 *  with the same DOM. */
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
    // Animated gold gradient — the `background-size: 250% 100%` + the
    // `legendary-frame-shimmer` keyframe slide it diagonally in a loop.
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

function gpsLabel(lat: number, lng: number): string {
  const fmt = (n: number) => n.toFixed(4)
  return `${fmt(lat)}°, ${fmt(lng)}°`
}

function confidenceLabel(c: number | null | undefined): string {
  if (c == null) return '—'
  return `${Math.round(c)} %`
}

function priceLabel(p: number | null | undefined): string {
  if (!p) return '—'
  return `${new Intl.NumberFormat('fr-FR').format(p)} €`
}

/** Collector card — 2:3 portrait, Pokemon/Panini layout. Tap flips
 *  the card in 3D (CSS `preserve-3d`) to reveal the back face with
 *  AI confidence, estimated price and GPS. Ultra rare / unique get
 *  an animated holographic overlay; unique additionally gets an
 *  animated gold frame. */
export default function CollectorCard({ spot }: { spot: Spot }) {
  const [flipped, setFlipped] = useState(false)
  const rarity = (spot.rarity ?? 'commun') as Rarity
  const v = RARITY_VISUAL[rarity]
  const xp = xpForSpot(spot.estimated_price, spot.rarity)
  const holo = rarity === 'ultra_rare' || rarity === 'unique'

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
        aria-label={`Retourner la carte ${spot.brand} ${spot.model}`}
      >
        <div className={`collector-flip-inner ${flipped ? 'is-flipped' : ''}`}>
          {/* ─── FRONT ─── */}
          <div className="collector-face collector-face-front">
            <FrontFace
              spot={spot}
              rarity={rarity}
              chipBg={v.chipBg}
              chipFg={v.chipFg}
              holo={holo}
              animatedChip={!!v.animated}
              xp={xp}
            />
          </div>

          {/* ─── BACK ─── */}
          <div className="collector-face collector-face-back">
            <BackFace
              spot={spot}
              rarity={rarity}
              chipBg={v.chipBg}
              chipFg={v.chipFg}
              animatedChip={!!v.animated}
              xp={xp}
            />
          </div>
        </div>
      </button>
    </div>
  )
}

function RevsWordmark({ size = 11 }: { size?: number }) {
  return (
    <span
      className="font-display font-extrabold tracking-tighter text-accent"
      style={{ fontSize: `${size}px`, letterSpacing: '-0.02em' }}
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
}: {
  spot: Spot
  rarity: Rarity
  chipBg: string
  chipFg: string
  holo: boolean
  animatedChip: boolean
  xp: number
}) {
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[14px] bg-[#0d0d0d]">
      {/* Top banner: REVS wordmark left, rarity chip right */}
      <div className="flex flex-none items-center justify-between px-2.5 py-1.5">
        <RevsWordmark />
        <RarityChip rarity={rarity} bg={chipBg} fg={chipFg} animated={animatedChip} />
      </div>

      {/* Photo window — ~60% of card height, with inner rounded
          corners and a subtle inset to give a "framed" feel. */}
      <div
        className="relative mx-2 overflow-hidden rounded-[10px] bg-[#050505]"
        style={{ flex: '0 0 60%', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.04)' }}
      >
        {spot.photo_url ? (
          <img
            src={spot.photo_url}
            alt={`${spot.brand} ${spot.model}`}
            loading="lazy"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-fg2">
            pas de photo
          </div>
        )}

        {/* Holographic shimmer overlay — ultra_rare + unique only.
            opacity 0.25, mix-blend screen so the photo still reads. */}
        {holo && <div className="collector-holo-overlay absolute inset-0 pointer-events-none" />}
      </div>

      {/* Bottom info block */}
      <div className="mt-2 flex-1 px-3 pb-3">
        <p
          className="uppercase text-white/55"
          style={{ fontSize: '8.5px', letterSpacing: '0.18em' }}
        >
          {spot.brand}
        </p>
        <h3
          className="truncate font-display font-extrabold tracking-tight text-white"
          style={{ fontSize: '15px', lineHeight: 1.1, marginTop: '2px' }}
        >
          {spot.model}
          {spot.year ? <span className="text-white/65"> · {spot.year}</span> : null}
        </h3>
        <div className="mt-2 flex items-center justify-between">
          <span
            className="flex items-center gap-0.5 font-extrabold text-accent"
            style={{ fontSize: '11px' }}
          >
            <Zap className="h-2.5 w-2.5" fill="currentColor" />+{xp} XP
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
  xp,
}: {
  spot: Spot
  rarity: Rarity
  chipBg: string
  chipFg: string
  animatedChip: boolean
  xp: number
}) {
  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden rounded-[14px] bg-[#0d0d0d]"
      style={{
        backgroundImage:
          'radial-gradient(circle at 20% 0%, rgba(232, 32, 58, 0.10), transparent 55%), radial-gradient(circle at 80% 100%, rgba(255,255,255,0.04), transparent 60%)',
      }}
    >
      {/* Top: flip back hint + rarity chip */}
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

      {/* Title block — same brand/model as front so user keeps context */}
      <div className="px-3 pt-1">
        <p
          className="uppercase text-white/55"
          style={{ fontSize: '8.5px', letterSpacing: '0.18em' }}
        >
          {spot.brand}
        </p>
        <h3
          className="truncate font-display font-extrabold tracking-tight text-white"
          style={{ fontSize: '15px', lineHeight: 1.1, marginTop: '2px' }}
        >
          {spot.model}
        </h3>
      </div>

      {/* Stat grid — IA confidence, price, GPS, plus XP for symmetry. */}
      <div
        className="mx-3 mt-3 grid grid-cols-2 gap-2 rounded-xl p-3"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <Stat label="CONFIANCE IA" value={confidenceLabel(spot.confidence)} />
        <Stat label="VALEUR" value={priceLabel(spot.estimated_price)} />
        <Stat label="XP GAGNÉ" value={`+${xp}`} accent />
        <Stat label="ANNÉE" value={spot.year ? String(spot.year) : '—'} />
        <Stat
          label="GPS"
          value={gpsLabel(spot.lat, spot.lng)}
          span2
          mono
        />
      </div>

      {/* Footer: tap-to-stop-flip CTA to navigate to the full spot
          page. stopPropagation prevents the wrapping flip button
          from re-flipping the card on link tap. */}
      <div className="mt-auto p-3">
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

      {/* Bottom-right edition mark — adds collector flair without
          taking real estate. Card id is the spot id (short form). */}
      <span
        className="absolute bottom-1 right-2 text-white/15"
        style={{ fontSize: '7px', letterSpacing: '0.18em' }}
      >
        #{spot.id.slice(0, 6).toUpperCase()}
      </span>
    </div>
  )
}

function Stat({
  label,
  value,
  accent,
  span2,
  mono,
}: {
  label: string
  value: string
  accent?: boolean
  span2?: boolean
  mono?: boolean
}) {
  return (
    <div className={span2 ? 'col-span-2' : ''}>
      <p
        className="text-fg2"
        style={{ fontSize: '7.5px', letterSpacing: '0.14em' }}
      >
        {label}
      </p>
      <p
        className={`mt-0.5 font-extrabold ${accent ? 'text-accent' : 'text-white'}`}
        style={{
          fontSize: '11px',
          fontFamily: mono ? 'ui-monospace, SFMono-Regular, monospace' : undefined,
        }}
      >
        {value}
      </p>
    </div>
  )
}
