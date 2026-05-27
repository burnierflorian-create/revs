import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Flag,
  Gauge,
  Gift,
  Loader2,
  Sparkles,
  Trophy,
  Zap,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Spot, Rarity } from '../lib/spots'
import {
  resolveRace,
  startRace,
  type RaceOpponent,
  type RaceResult,
  type RaceStake,
} from '../lib/race'
import { Skeleton } from '../components/Skeleton'
import { floatXp } from '../components/XpFloater'
import Confetti from '../components/Confetti'

type Phase =
  | 'select'
  | 'ready'
  | 'countdown'
  | 'sprint'
  | 'finish'
  | 'result'

const RARITY_COLOR: Record<Rarity, string> = {
  commun: '#888888',
  rare: '#4A9EFF',
  ultra_rare: '#9B59B6',
  unique: '#FFD700',
}
const RARITY_LABEL: Record<Rarity, string> = {
  commun: 'COMMUN',
  rare: 'RARE',
  ultra_rare: 'ULTRA RARE',
  unique: 'LÉGENDAIRE',
}
const RARITY_MULT: Record<Rarity, number> = {
  commun: 1.0,
  rare: 1.5,
  ultra_rare: 2.5,
  unique: 4.0,
}
const TIMING_LABEL: Record<RaceResult['timing_bucket'], string> = {
  perfect: 'DÉPART PARFAIT',
  good: 'BON DÉPART',
  miss: 'DÉPART RATÉ',
  false_start: 'FAUX DÉPART',
}
const TIMING_COLOR: Record<RaceResult['timing_bucket'], string> = {
  perfect: '#FFD700',
  good: '#4A9EFF',
  miss: '#999999',
  false_start: '#E8203A',
}
const WIN_CONFETTI = ['#E8203A', '#FFD700', '#FFA500', '#FFF6C8']

/** Top-speed estimate for the HUD gauge — cosmetic only. */
function topSpeedFromHp(hp: number): number {
  return Math.max(180, Math.min(330, Math.round(150 + hp * 0.25)))
}

/** Best-effort haptic feedback. iOS Safari has no Vibration API; the
 *  try/catch swallows any environmental rejection (e.g. user has
 *  disabled motion). */
function vibrate(ms = 8) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms)
    }
  } catch {
    /* no-op */
  }
}

// ─────────────────────────────── PAGE ───────────────────────────────

export default function Race() {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('select')
  const [spots, setSpots] = useState<Spot[] | null>(null)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [start, setStart] = useState<{
    raceId: string
    playerHp: number
    opponent: RaceOpponent
    stake: { type: string; value: RaceStake }
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [countdown, setCountdown] = useState(3)
  const [goAt, setGoAt] = useState<number | null>(null)
  const [tapDelta, setTapDelta] = useState<number | null>(null)
  const [showGoFlash, setShowGoFlash] = useState(false)
  const [result, setResult] = useState<RaceResult | null>(null)
  const goTimerRef = useRef<number | null>(null)

  // Load user's spots.
  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        navigate('/login')
        return
      }
      const { data } = await supabase
        .from('spots')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (active) setSpots((data ?? []) as Spot[])
    })()
    return () => {
      active = false
    }
  }, [navigate])

  const pickedSpot = useMemo(
    () => (pickedId ? spots?.find((s) => s.id === pickedId) ?? null : null),
    [pickedId, spots],
  )

  async function onStartRace() {
    if (!pickedId || busy) return
    setBusy(true)
    vibrate(15)
    const r = await startRace(pickedId)
    setBusy(false)
    if (!r) return
    setStart({
      raceId: r.race_id,
      playerHp: r.player_hp,
      opponent: r.opponent,
      stake: { type: r.stake_type, value: r.stake_value },
    })
    setPhase('ready')
  }

  // 3-2-1-GO at 1s steps; the GO frame fires a white flash overlay
  // + records the anchor used to score the player's tap delta.
  useEffect(() => {
    if (phase !== 'countdown') return
    setCountdown(3)
    setGoAt(null)
    setTapDelta(null)
    setShowGoFlash(false)
    const t1 = window.setTimeout(() => {
      vibrate(5)
      setCountdown(2)
    }, 1000)
    const t2 = window.setTimeout(() => {
      vibrate(5)
      setCountdown(1)
    }, 2000)
    const t3 = window.setTimeout(() => {
      vibrate(12)
      setCountdown(0)
      setGoAt(performance.now())
      setShowGoFlash(true)
      window.setTimeout(() => setShowGoFlash(false), 320)
    }, 3000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [phase])

  // Auto-fail if player doesn't tap within 1.5s after GO.
  useEffect(() => {
    if (phase !== 'countdown' || goAt == null) return
    goTimerRef.current = window.setTimeout(() => {
      onTap(performance.now() + 1500)
    }, 1500)
    return () => {
      if (goTimerRef.current != null) clearTimeout(goTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, goAt])

  async function onTap(now = performance.now()) {
    if (phase !== 'countdown' || !start || tapDelta != null) return
    if (goTimerRef.current != null) {
      clearTimeout(goTimerRef.current)
      goTimerRef.current = null
    }
    const delta = goAt == null ? -50 : Math.round(now - goAt)
    setTapDelta(delta)
    vibrate(delta >= 0 && delta <= 300 ? 20 : 8)
    setPhase('sprint')

    const rPromise = resolveRace(start.raceId, delta)
    window.setTimeout(() => setPhase('finish'), 5000)
    window.setTimeout(async () => {
      const r = await rPromise
      setResult(r)
      setPhase('result')
      if (r?.winner_is_me) vibrate(25)
      if (r && r.xp_awarded > 0) floatXp(r.xp_awarded)
    }, 8000)
    rPromise.then(setResult)
  }

  function reset() {
    setStart(null)
    setPickedId(null)
    setResult(null)
    setTapDelta(null)
    setGoAt(null)
    setPhase('select')
  }

  const showChrome =
    phase === 'select' || phase === 'ready' || phase === 'result'

  return (
    <div
      className="relative min-h-screen bg-bg text-fg"
      style={{
        paddingTop: showChrome ? 'max(1rem, env(safe-area-inset-top))' : 0,
        paddingBottom: showChrome ? 'max(2rem, env(safe-area-inset-bottom))' : 0,
      }}
    >
      {showChrome && (
        <div className="flex items-center gap-4 px-4 py-4">
          <button
            onClick={() => (phase === 'select' ? navigate(-1) : reset())}
            aria-label="Retour"
            className="tappable text-fg2 hover:text-fg"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <h1 className="display-xl text-fg">REVS RACE</h1>
        </div>
      )}

      {phase === 'select' && (
        <SelectPhase
          spots={spots}
          pickedId={pickedId}
          onPick={setPickedId}
          busy={busy}
          onStart={onStartRace}
        />
      )}

      {phase === 'ready' && start && pickedSpot && (
        <ReadyPhase
          spot={pickedSpot}
          playerHp={start.playerHp}
          opponent={start.opponent}
          stake={start.stake.value}
          onGo={() => setPhase('countdown')}
        />
      )}

      {phase === 'countdown' && start && pickedSpot && (
        <CountdownPhase
          spot={pickedSpot}
          opponent={start.opponent}
          countdown={countdown}
          goAt={goAt}
          onTap={() => onTap()}
          showGoFlash={showGoFlash}
        />
      )}

      {phase === 'sprint' && start && pickedSpot && (
        <SprintPhase
          spot={pickedSpot}
          opponent={start.opponent}
          playerHp={start.playerHp}
          result={result}
          slowMo={false}
        />
      )}

      {phase === 'finish' && start && pickedSpot && (
        <SprintPhase
          spot={pickedSpot}
          opponent={start.opponent}
          playerHp={start.playerHp}
          result={result}
          slowMo
        />
      )}

      {phase === 'result' && result && start && pickedSpot && (
        <ResultPhase
          result={result}
          playerSpot={pickedSpot}
          opponent={start.opponent}
          onAgain={reset}
          onHome={() => navigate('/')}
        />
      )}
    </div>
  )
}

// ─────────────────────────────── SELECT — swipe carousel ───────────────────────────────

function SelectPhase({
  spots,
  pickedId,
  onPick,
  busy,
  onStart,
}: {
  spots: Spot[] | null
  pickedId: string | null
  onPick: (id: string) => void
  busy: boolean
  onStart: () => void
}) {
  if (spots === null) {
    return (
      <div className="flex items-center justify-center px-6 pt-10">
        <Skeleton className="aspect-[2/3] w-3/4 max-w-[320px] rounded-3xl" />
      </div>
    )
  }
  if (spots.length === 0) {
    return (
      <div
        className="mx-4 flex flex-col items-center rounded-2xl bg-card px-6 py-12 text-center"
        style={{ border: '1px solid var(--color-border)' }}
      >
        <p className="font-medium">
          Pas encore de cartes. Spotte d'abord pour pouvoir courir !
        </p>
      </div>
    )
  }
  return (
    <SelectCarousel
      spots={spots}
      pickedId={pickedId}
      onPick={onPick}
      busy={busy}
      onStart={onStart}
    />
  )
}

function SelectCarousel({
  spots,
  pickedId,
  onPick,
  busy,
  onStart,
}: {
  spots: Spot[]
  pickedId: string | null
  onPick: (id: string) => void
  busy: boolean
  onStart: () => void
}) {
  // Carousel anchored on the picked card. Falls back to index 0 if
  // nothing's picked yet — first paint shows the most recent spot.
  const initialIdx = useMemo(() => {
    if (!pickedId) return 0
    return Math.max(0, spots.findIndex((s) => s.id === pickedId))
  }, [pickedId, spots])
  const [idx, setIdx] = useState(initialIdx)
  const [dragOffset, setDragOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Mirror the picked card onto the parent whenever the carousel
  // settles, so the "COURIR" button targets the right spot.
  useEffect(() => {
    const s = spots[idx]
    if (s && pickedId !== s.id) onPick(s.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx])

  const onPointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX
    setDragging(true)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    setDragOffset(e.clientX - startX.current)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return
    setDragging(false)
    ;(e.currentTarget as Element).releasePointerCapture?.(e.pointerId)
    const w = containerRef.current?.offsetWidth ?? 320
    const threshold = w * 0.18
    let next = idx
    if (dragOffset < -threshold && idx < spots.length - 1) {
      next = idx + 1
      vibrate(8)
    } else if (dragOffset > threshold && idx > 0) {
      next = idx - 1
      vibrate(8)
    }
    setDragOffset(0)
    setIdx(next)
  }

  const current = spots[idx]
  const currentRarity = (current?.rarity ?? 'commun') as Rarity
  const estHp = 0 // unknown client-side; we display rarity instead

  return (
    <div className="relative">
      {/* Page-level particle backdrop. */}
      <FloatingParticles count={14} />

      <p
        className="mx-4 mb-2 text-center text-[12px] text-fg2"
        style={{ letterSpacing: '0.04em' }}
      >
        Choisis ta carte — swipe pour parcourir
      </p>

      {/* Carousel area */}
      <div
        ref={containerRef}
        className="relative mx-auto"
        style={{
          height: 'min(62vh, 480px)',
          width: '100%',
          touchAction: 'pan-y',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {spots.map((s, i) => {
          const dist = i - idx
          if (Math.abs(dist) > 2) return null
          const dragPct = dragOffset / Math.max(1, containerRef.current?.offsetWidth ?? 320) * 100
          const baseTranslate = dist * 78 // % of own width per step
          const translate = baseTranslate + dragPct
          const scale = 1 - Math.min(0.34, Math.abs(dist) * 0.18)
          const opacity = Math.max(0.12, 1 - Math.abs(dist) * 0.42)
          const z = 100 - Math.abs(dist) * 10
          return (
            <div
              key={s.id}
              className="absolute left-1/2 top-1/2"
              style={{
                transform: `translate(-50%, -50%) translateX(${translate}%) scale(${scale})`,
                transition: dragging
                  ? 'none'
                  : 'transform 360ms var(--ease-spring), opacity 280ms ease',
                opacity,
                zIndex: z,
                width: '64%',
                maxWidth: '300px',
                aspectRatio: '2 / 3',
                pointerEvents: dist === 0 ? 'auto' : 'none',
              }}
            >
              <BigCard spot={s} active={dist === 0} />
            </div>
          )
        })}
      </div>

      {/* Dots indicator */}
      <div className="mt-3 flex items-center justify-center gap-1.5">
        {spots.map((_, i) => (
          <span
            key={i}
            className="rounded-full transition-all"
            style={{
              width: i === idx ? 18 : 6,
              height: 6,
              background:
                i === idx
                  ? RARITY_COLOR[currentRarity]
                  : 'rgba(255,255,255,0.18)',
              boxShadow:
                i === idx ? `0 0 10px ${RARITY_COLOR[currentRarity]}` : undefined,
            }}
          />
        ))}
      </div>

      {/* Stats panel for the centered card */}
      {current && (
        <div
          className="mx-auto mt-4 max-w-[320px] rounded-2xl px-4 py-3"
          style={{
            background:
              `linear-gradient(135deg, ${RARITY_COLOR[currentRarity]}1A 0%, rgba(20,20,20,0.6) 100%)`,
            border: `1px solid ${RARITY_COLOR[currentRarity]}55`,
          }}
        >
          <p
            className="text-center text-[8.5px] uppercase tracking-widest"
            style={{ color: RARITY_COLOR[currentRarity] }}
          >
            {RARITY_LABEL[currentRarity]}
          </p>
          <p
            className="mt-1 text-center font-display font-extrabold tracking-tighter text-white"
            style={{ fontSize: '18px', lineHeight: 1.1 }}
          >
            {current.brand}
          </p>
          <p
            className="text-center text-fg/85"
            style={{ fontSize: '13px' }}
          >
            {current.model}
            {current.year ? ` · ${current.year}` : ''}
          </p>
          <div className="mt-2.5 grid grid-cols-2 gap-3 text-center">
            <div>
              <p className="text-[8px] uppercase tracking-widest text-fg2">Multi</p>
              <p
                className="font-display font-extrabold text-white"
                style={{ fontSize: '15px' }}
              >
                ×{RARITY_MULT[currentRarity]}
              </p>
            </div>
            <div>
              <p className="text-[8px] uppercase tracking-widest text-fg2">
                Score est.
              </p>
              <p
                className="font-display font-extrabold"
                style={{ fontSize: '15px', color: RARITY_COLOR[currentRarity] }}
              >
                ~{Math.round((estHp || 280) * RARITY_MULT[currentRarity] * 1.1)}
              </p>
            </div>
          </div>
        </div>
      )}

      <div
        className="fixed inset-x-0 bottom-0 z-30 px-4 pt-3"
        style={{
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          background:
            'linear-gradient(to top, rgba(10,10,10,0.96) 60%, rgba(10,10,10,0) 100%)',
        }}
      >
        <button
          onClick={onStart}
          disabled={!current || busy}
          className="tappable flex w-full items-center justify-center gap-2 rounded-full bg-accent py-4 font-display font-extrabold uppercase tracking-wider text-white disabled:opacity-40"
          style={{
            fontSize: '15px',
            boxShadow: '0 12px 30px rgba(232, 32, 58, 0.50)',
          }}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Flag className="h-4 w-4" />
          )}
          {busy ? 'PRÉPARATION…' : 'CHOISIR CETTE VOITURE'}
        </button>
      </div>
    </div>
  )
}

function BigCard({ spot, active }: { spot: Spot; active: boolean }) {
  const rarity = (spot.rarity ?? 'commun') as Rarity
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-3xl"
      style={{
        background: '#0d0d0d',
        border: `2px solid ${RARITY_COLOR[rarity]}`,
        boxShadow: active
          ? `0 22px 50px ${RARITY_COLOR[rarity]}66, 0 0 0 1px ${RARITY_COLOR[rarity]}55, inset 0 0 0 1px rgba(255,255,255,0.04)`
          : '0 12px 26px rgba(0,0,0,0.5)',
        animation: active ? 'race-card-pop 360ms var(--ease-spring)' : undefined,
      }}
    >
      {spot.photo_url ? (
        <img
          src={spot.photo_url}
          alt={`${spot.brand} ${spot.model}`}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-fg2">
          pas de photo
        </div>
      )}
      <div
        className="absolute inset-x-0 bottom-0 px-3 pb-4 pt-10 text-white"
        style={{
          background:
            'linear-gradient(to top, rgba(0,0,0,0.92) 0%, transparent 100%)',
        }}
      >
        <p
          className="uppercase tracking-widest text-white/65"
          style={{ fontSize: '10px', letterSpacing: '0.16em' }}
        >
          {spot.brand}
        </p>
        <p
          className="mt-1 font-display font-extrabold tracking-tight"
          style={{ fontSize: '20px', lineHeight: 1.05 }}
        >
          {spot.model}
        </p>
      </div>
      <span
        className="absolute right-3 top-3 rounded-full px-2.5 py-1 font-extrabold uppercase"
        style={{
          background: 'rgba(0,0,0,0.55)',
          color: RARITY_COLOR[rarity],
          border: `1px solid ${RARITY_COLOR[rarity]}66`,
          fontSize: '8.5px',
          letterSpacing: '0.10em',
        }}
      >
        {RARITY_LABEL[rarity]}
      </span>
    </div>
  )
}

// ─────────────────────────────── FACE-À-FACE ───────────────────────────────

function ReadyPhase({
  spot,
  playerHp,
  opponent,
  stake,
  onGo,
}: {
  spot: Spot
  playerHp: number
  opponent: RaceOpponent
  stake: RaceStake
  onGo: () => void
}) {
  const playerRarity = (spot.rarity ?? 'commun') as Rarity
  const playerEst = Math.round(playerHp * RARITY_MULT[playerRarity] * 1.1)
  const oppEst = Math.round(
    opponent.horsepower * RARITY_MULT[opponent.rarity] * 1.1,
  )

  // Auto-launch the countdown after 3.5s if the user hasn't tapped
  // LANCER yet. Cleared on unmount so a manual tap still works.
  useEffect(() => {
    const t = window.setTimeout(() => {
      onGo()
    }, 3500)
    return () => clearTimeout(t)
  }, [onGo])

  return (
    <div className="relative pb-32">
      {/* Perspective road backdrop */}
      <RoadBackdrop />

      <div className="relative px-4">
        {/* Stake — slides in from top */}
        <div
          className="mt-1 mb-4 rounded-2xl px-4 py-3 text-center"
          style={{
            background:
              'linear-gradient(135deg, rgba(232,32,58,0.32) 0%, rgba(232,32,58,0.08) 100%)',
            border: '1px solid rgba(232,32,58,0.45)',
            boxShadow: '0 0 30px rgba(232,32,58,0.20)',
            animation: 'race-pop 420ms var(--ease-spring) both',
          }}
        >
          <p className="text-[10px] uppercase tracking-widest text-white/70">
            Enjeu de la course
          </p>
          <p
            className="mt-1 flex items-center justify-center gap-1.5 font-display font-extrabold tracking-tighter text-white"
            style={{ fontSize: '28px' }}
          >
            <Zap className="h-5 w-5 text-accent" fill="currentColor" />
            {stake.label}
          </p>
        </div>

        {/* Face-à-face */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <Fighter
            title="TOI"
            brand={spot.brand}
            model={spot.model}
            rarity={playerRarity}
            hp={playerHp}
            score={playerEst}
            photoUrl={spot.photo_url}
            mirror={false}
          />
          <div
            className="font-display font-extrabold tracking-tighter text-accent"
            style={{
              fontSize: '48px',
              animation: 'race-vs-pulse 1.6s ease-in-out infinite',
              textShadow:
                '0 0 18px rgba(232,32,58,0.85), 0 0 4px rgba(255,255,255,0.4)',
            }}
          >
            VS
          </div>
          <Fighter
            title="ADVERSAIRE"
            brand={opponent.brand}
            model={opponent.model}
            rarity={opponent.rarity}
            hp={opponent.horsepower}
            score={oppEst}
            photoUrl={opponent.photo_url}
            mirror
          />
        </div>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-30 px-4 pt-3"
        style={{
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          background:
            'linear-gradient(to top, rgba(10,10,10,0.96) 60%, rgba(10,10,10,0) 100%)',
        }}
      >
        <button
          onClick={onGo}
          className="tappable flex w-full items-center justify-center gap-2 rounded-full bg-accent py-4 font-display font-extrabold uppercase tracking-wider text-white"
          style={{
            fontSize: '15px',
            boxShadow: '0 12px 30px rgba(232, 32, 58, 0.50)',
          }}
        >
          <Flag className="h-4 w-4" />
          LANCER LA COURSE
        </button>
      </div>
    </div>
  )
}

function Fighter({
  title,
  brand,
  model,
  rarity,
  hp,
  score,
  photoUrl,
  mirror,
}: {
  title: string
  brand: string
  model: string
  rarity: Rarity
  hp: number
  score: number
  photoUrl: string | null
  mirror: boolean
}) {
  const tilt = mirror ? 'rotateY(-10deg)' : 'rotateY(10deg)'
  return (
    <div className="relative">
      {/* Under-car glow */}
      <div
        className="pointer-events-none absolute -bottom-3 left-1/2 -translate-x-1/2"
        style={{
          width: '85%',
          height: '14px',
          background: `radial-gradient(ellipse at center, ${RARITY_COLOR[rarity]}88 0%, transparent 75%)`,
          filter: 'blur(8px)',
        }}
      />
      <div
        className="overflow-hidden rounded-2xl"
        style={{
          border: `1.5px solid ${RARITY_COLOR[rarity]}`,
          boxShadow: `0 14px 32px ${RARITY_COLOR[rarity]}66, inset 0 0 0 1px rgba(255,255,255,0.04)`,
          background: '#0d0d0d',
          transform: `perspective(900px) ${tilt}`,
        }}
      >
        <div className="relative aspect-square">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={`${brand} ${model}`}
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <PhotoFallback brand={brand} color={RARITY_COLOR[rarity]} />
          )}
        </div>
        <div className="px-2 py-2">
          <p
            className="text-[8.5px] uppercase tracking-widest"
            style={{ color: RARITY_COLOR[rarity] }}
          >
            {title}
          </p>
          <p
            className="mt-0.5 truncate font-display font-extrabold tracking-tight text-white"
            style={{ fontSize: '12px' }}
          >
            {model}
          </p>
          <div className="mt-1.5 flex items-baseline justify-between">
            <span className="text-[10px] text-fg2">
              <span className="text-white/85">{hp} ch</span>
            </span>
            <span
              className="font-extrabold"
              style={{ fontSize: '11px', color: RARITY_COLOR[rarity] }}
            >
              ~{score}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Fallback visual when no photo exists (synthetic AI in last
 *  cascade or a spot that somehow lost its photo). No car emoji —
 *  the spec is explicit. Uses brand initials over a rarity-tinted
 *  radial gradient. */
function PhotoFallback({ brand, color }: { brand: string; color: string }) {
  const initials = brand
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center"
      style={{
        background: `radial-gradient(circle at 50% 100%, ${color}33 0%, #050505 70%)`,
      }}
    >
      <span
        className="font-display font-extrabold tracking-tighter"
        style={{ fontSize: '32px', color, opacity: 0.85 }}
      >
        {initials || '??'}
      </span>
      <span
        className="mt-0.5 text-[8.5px] uppercase tracking-widest text-white/55"
      >
        {brand}
      </span>
    </div>
  )
}

// ─────────────────────────────── COUNTDOWN ───────────────────────────────

function CountdownPhase({
  spot,
  opponent,
  countdown,
  goAt,
  onTap,
  showGoFlash,
}: {
  spot: Spot
  opponent: RaceOpponent
  countdown: number
  goAt: number | null
  onTap: () => void
  showGoFlash: boolean
}) {
  const isGo = goAt != null
  const playerRarity = (spot.rarity ?? 'commun') as Rarity
  return (
    <div
      className="relative flex h-screen flex-col"
      style={{
        background:
          'radial-gradient(circle at 50% 40%, #16080a 0%, #050505 60%, #000 100%)',
      }}
    >
      {/* GO white flash */}
      {showGoFlash && (
        <div
          className="pointer-events-none absolute inset-0 z-40 bg-white"
          style={{ animation: 'race-go-flash 320ms ease-out forwards' }}
        />
      )}

      {/* Cars at the start line — real photos for both */}
      <div className="flex flex-1 items-center justify-center px-4 pt-8">
        <div className="grid w-full grid-cols-2 gap-3">
          <StartCar
            photoUrl={spot.photo_url}
            brand={spot.brand}
            label={spot.model}
            rarity={playerRarity}
            isPlayer
          />
          <StartCar
            photoUrl={opponent.photo_url}
            brand={opponent.brand}
            label={opponent.model}
            rarity={opponent.rarity}
            isPlayer={false}
          />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span
          key={`${countdown}-${isGo}`}
          className="font-display font-extrabold tracking-tighter"
          style={{
            fontSize: isGo ? '170px' : '190px',
            lineHeight: 1,
            color: isGo ? '#22C55E' : '#fff',
            textShadow: isGo
              ? '0 0 60px rgba(34,197,94,0.85)'
              : '0 0 60px rgba(232,32,58,0.55)',
            animation: 'race-pop 320ms var(--ease-spring) both',
          }}
        >
          {isGo ? 'GO!' : countdown}
        </span>
      </div>

      <div
        className="px-4 pt-3"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <button
          onClick={onTap}
          disabled={!isGo}
          className="tappable flex w-full items-center justify-center gap-2 rounded-full font-display font-extrabold uppercase tracking-wider text-white"
          style={{
            padding: '24px',
            fontSize: '22px',
            background: isGo
              ? 'radial-gradient(circle at center, #22C55E 0%, #16A34A 60%, #14532D 100%)'
              : 'rgba(255,255,255,0.05)',
            border: isGo
              ? '3px solid rgba(34, 197, 94, 0.85)'
              : '2px solid rgba(255,255,255,0.10)',
            boxShadow: isGo
              ? '0 0 70px rgba(34, 197, 94, 0.65), inset 0 0 50px rgba(34, 197, 94, 0.30)'
              : 'none',
            opacity: isGo ? 1 : 0.45,
            transition: 'all 180ms var(--ease-spring)',
          }}
        >
          <Zap className="h-5 w-5" fill="currentColor" />
          {isGo ? 'BOOST' : 'ATTENDS LE GO'}
        </button>
      </div>
    </div>
  )
}

function StartCar({
  photoUrl,
  brand,
  label,
  rarity,
  isPlayer,
}: {
  photoUrl: string | null
  brand: string
  label: string
  rarity: Rarity
  isPlayer: boolean
}) {
  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        aspectRatio: '4 / 3',
        border: `2px solid ${RARITY_COLOR[rarity]}`,
        boxShadow: `0 14px 30px ${RARITY_COLOR[rarity]}55`,
      }}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={`${brand} ${label}`}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <PhotoFallback brand={brand} color={RARITY_COLOR[rarity]} />
      )}
      <div
        className="absolute inset-x-0 bottom-0 px-2 py-1.5 text-white"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.92), transparent)',
        }}
      >
        <p
          className="text-[7.5px] uppercase tracking-widest"
          style={{ color: RARITY_COLOR[rarity] }}
        >
          {isPlayer ? 'TOI' : 'ADVERSAIRE'}
        </p>
        <p
          className="truncate font-display font-extrabold tracking-tight"
          style={{ fontSize: '11px' }}
        >
          {label}
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────── SPRINT / FINISH ───────────────────────────────

function SprintPhase({
  spot,
  opponent,
  playerHp,
  result,
  slowMo,
}: {
  spot: Spot
  opponent: RaceOpponent
  playerHp: number
  result: RaceResult | null
  slowMo: boolean
}) {
  const playerRarity = (spot.rarity ?? 'commun') as Rarity
  const playerTop = topSpeedFromHp(playerHp)
  const [speed, setSpeed] = useState(slowMo ? playerTop - 12 : 0)
  const startedAt = useRef<number | null>(null)

  useEffect(() => {
    let frame = 0
    startedAt.current = performance.now()
    const tick = () => {
      const now = performance.now()
      const t = Math.min(1, (now - (startedAt.current ?? now)) / (slowMo ? 2800 : 4600))
      const eased = 1 - Math.pow(1 - t, 3)
      const v = slowMo
        ? playerTop - Math.round(eased * 12)
        : Math.round(eased * playerTop)
      setSpeed(v)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [slowMo, playerTop])

  const playerLead = useMemo(() => {
    if (!result) return 0.5
    const total = result.player_score + result.opponent_score
    if (total <= 0) return 0.5
    return result.player_score / total
  }, [result])

  const playerProgress = slowMo
    ? Math.min(0.98, 0.62 + (playerLead - 0.5) * 0.85)
    : Math.min(0.85, 0.40 + (playerLead - 0.5) * 0.70)
  const oppProgress = slowMo
    ? Math.min(0.98, 0.62 + ((1 - playerLead) - 0.5) * 0.85)
    : Math.min(0.85, 0.40 + ((1 - playerLead) - 0.5) * 0.70)

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden"
      style={{
        background:
          'radial-gradient(circle at 50% 30%, #1a0a0d 0%, #0a0a0a 70%, #000 100%)',
      }}
    >
      {/* 3D perspective road floor — receding toward horizon. */}
      <PerspectiveRoad slowMo={slowMo} />

      {/* HUD top */}
      <div className="z-20 flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div
          className="flex items-center gap-2 rounded-2xl px-3 py-2"
          style={{
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(232,32,58,0.40)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <Gauge className="h-4 w-4 text-accent" />
          <span
            className="font-display font-extrabold tracking-tighter text-white"
            style={{ fontSize: '24px', lineHeight: 1, minWidth: '60px' }}
          >
            {speed}
          </span>
          <span className="text-[9px] uppercase tracking-widest text-fg2">
            km/h
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-[8.5px] uppercase tracking-widest text-fg2">
            Boost
          </span>
          <div
            className="h-2 w-full overflow-hidden rounded-full"
            style={{ background: 'rgba(255,255,255,0.08)' }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (speed / playerTop) * 100)}%`,
                background:
                  'linear-gradient(90deg, #E8203A 0%, #FFD700 60%, #FFF6C8 100%)',
                boxShadow: '0 0 14px rgba(232,32,58,0.55)',
                transition: 'width 200ms linear',
              }}
            />
          </div>
        </div>
      </div>

      {/* Lanes */}
      <div className="z-10 flex flex-1 gap-2 px-3 py-3">
        <Lane
          progress={playerProgress}
          slowMo={slowMo}
          photoUrl={spot.photo_url}
          brand={spot.brand}
          rarity={playerRarity}
          isPlayer
        />
        <Lane
          progress={oppProgress}
          slowMo={slowMo}
          photoUrl={opponent.photo_url}
          brand={opponent.brand}
          rarity={opponent.rarity}
          isPlayer={false}
        />
      </div>

      <p
        className="z-20 mb-3 text-center text-[10px] uppercase tracking-widest text-fg2"
      >
        {slowMo ? 'ARRIVÉE…' : 'COURSE EN COURS'}
      </p>
    </div>
  )
}

function PerspectiveRoad({ slowMo }: { slowMo: boolean }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ perspective: '700px', perspectiveOrigin: '50% -10%' }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'repeating-linear-gradient(0deg, transparent 0px, transparent 60px, rgba(255,255,255,0.22) 60px, rgba(255,255,255,0.22) 90px), radial-gradient(ellipse at 50% 100%, #1c1c1c 0%, #050505 80%)',
          backgroundSize: '100% 150px, 100% 100%',
          transform: 'rotateX(52deg) scale(1.7)',
          transformOrigin: '50% 0%',
          animation: `race-road-scroll ${slowMo ? '700ms' : '220ms'} linear infinite`,
          opacity: 0.55,
        }}
      />
    </div>
  )
}

function Lane({
  progress,
  slowMo,
  photoUrl,
  brand,
  rarity,
  isPlayer,
}: {
  progress: number
  slowMo: boolean
  photoUrl: string | null
  brand: string
  rarity: Rarity
  isPlayer: boolean
}) {
  return (
    <div
      className="relative flex-1 overflow-hidden rounded-2xl"
      style={{
        background: 'transparent',
        border: `1.5px solid ${RARITY_COLOR[rarity]}55`,
        boxShadow: `inset 0 0 36px ${RARITY_COLOR[rarity]}30`,
      }}
    >
      {/* Light trail under the car */}
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2"
        style={{
          bottom: `${4 + progress * 70}%`,
          width: '70%',
          height: '22%',
          background: `radial-gradient(ellipse at center, ${RARITY_COLOR[rarity]}66 0%, transparent 70%)`,
          filter: 'blur(10px)',
          animation: 'race-trail-pulse 600ms ease-in-out infinite',
        }}
      />

      {/* The car */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          bottom: `${6 + progress * 70}%`,
          width: '82%',
          aspectRatio: '4 / 3',
          transition: slowMo
            ? 'bottom 1200ms cubic-bezier(0.22, 1, 0.36, 1)'
            : 'bottom 700ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div
          className="h-full w-full overflow-hidden rounded-xl"
          style={{
            border: `2px solid ${RARITY_COLOR[rarity]}`,
            boxShadow: `0 12px 30px ${RARITY_COLOR[rarity]}66`,
            filter: slowMo ? 'none' : 'blur(0.4px)',
          }}
        >
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={isPlayer ? 'Toi' : 'Adversaire'}
              className="h-full w-full object-cover"
              style={{ filter: slowMo ? 'none' : 'saturate(1.1) contrast(1.05)' }}
              draggable={false}
            />
          ) : (
            <PhotoFallback brand={brand} color={RARITY_COLOR[rarity]} />
          )}
        </div>
      </div>

      {/* Finish line at the top of the lane */}
      <div
        className="absolute inset-x-0 top-0 h-3"
        style={{
          background:
            'repeating-linear-gradient(90deg, #fff 0px, #fff 8px, #000 8px, #000 16px)',
          opacity: slowMo ? 1 : 0.65,
          boxShadow: slowMo ? '0 0 24px rgba(255,255,255,0.55)' : undefined,
        }}
      />

      <div
        className="absolute left-1/2 -translate-x-1/2 rounded-full px-2 py-0.5"
        style={{
          bottom: '8px',
          background: 'rgba(0,0,0,0.65)',
          border: `1px solid ${RARITY_COLOR[rarity]}66`,
          color: RARITY_COLOR[rarity],
          fontSize: '8.5px',
          letterSpacing: '0.12em',
          fontWeight: 800,
          textTransform: 'uppercase',
        }}
      >
        {isPlayer ? 'TOI' : brand}
      </div>
    </div>
  )
}

// ─────────────────────────────── RESULT ───────────────────────────────

function ResultPhase({
  result,
  playerSpot,
  opponent,
  onAgain,
  onHome,
}: {
  result: RaceResult
  playerSpot: Spot
  opponent: RaceOpponent
  onAgain: () => void
  onHome: () => void
}) {
  const won = result.winner_is_me
  const playerRarity = (playerSpot.rarity ?? 'commun') as Rarity
  const winnerRarity = won ? playerRarity : opponent.rarity
  const winnerPhoto = won ? playerSpot.photo_url : opponent.photo_url
  const winnerBrand = won ? playerSpot.brand : opponent.brand
  const glow = RARITY_COLOR[winnerRarity]
  const isPerfect = result.timing_bucket === 'perfect'

  return (
    <div
      className="relative pb-32"
      style={{
        backgroundImage: `radial-gradient(circle at 50% 30%, ${glow}22 0%, transparent 60%)`,
      }}
    >
      {won && (
        <Confetti count={60} duration={2400} colors={WIN_CONFETTI} />
      )}

      <div className="flex items-center justify-center gap-2 px-4 pt-1">
        {won && <Trophy className="h-9 w-9 text-yellow-400" />}
        <p
          className="text-center font-display font-extrabold tracking-tighter"
          style={{
            fontSize: '56px',
            lineHeight: 1,
            color: won ? '#22C55E' : '#9aa0a6',
            textShadow: won
              ? '0 0 32px rgba(34,197,94,0.65)'
              : '0 0 32px rgba(120,120,120,0.45)',
            animation: 'race-pop 460ms var(--ease-spring) both',
          }}
        >
          {won ? 'VICTOIRE' : 'DÉFAITE'}
        </p>
      </div>

      {/* Perfect-start badge — only on actual perfect timing. */}
      {isPerfect && (
        <div className="mt-3 flex justify-center">
          <span
            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 font-extrabold uppercase tracking-wider"
            style={{
              background:
                'linear-gradient(120deg, #E0B341 0%, #FFD700 45%, #B8860B 100%)',
              color: '#1a1306',
              boxShadow: '0 8px 24px rgba(255,215,0,0.55)',
              fontSize: '10px',
              animation: 'race-pop 520ms var(--ease-spring) 80ms both',
            }}
          >
            <Sparkles className="h-3 w-3" />
            PERFECT START
          </span>
        </div>
      )}

      {/* Winning card — slow Y-axis swing */}
      <div className="mt-5 flex justify-center">
        <div
          className="overflow-hidden rounded-2xl"
          style={{
            width: '72%',
            maxWidth: '260px',
            aspectRatio: '2/3',
            border: `2px solid ${glow}`,
            boxShadow: `0 22px 60px ${glow}66, 0 0 0 1px ${glow}44`,
            animation: 'race-win-spin 4.2s ease-in-out infinite',
          }}
        >
          {winnerPhoto ? (
            <img
              src={winnerPhoto}
              alt={winnerBrand}
              className="h-full w-full object-cover"
            />
          ) : (
            <PhotoFallback brand={winnerBrand} color={glow} />
          )}
        </div>
      </div>

      {/* Timing pill */}
      <div className="mt-4 flex justify-center">
        <span
          className="rounded-full px-3 py-1 font-extrabold uppercase tracking-wider"
          style={{
            background: `${TIMING_COLOR[result.timing_bucket]}22`,
            color: TIMING_COLOR[result.timing_bucket],
            border: `1px solid ${TIMING_COLOR[result.timing_bucket]}66`,
            fontSize: '10px',
          }}
        >
          {TIMING_LABEL[result.timing_bucket]} (×{result.timing_mult})
        </span>
      </div>

      {/* Score row */}
      <div className="mt-5 grid grid-cols-2 gap-3 px-4">
        <ScoreCard
          label="TOI"
          brand={playerSpot.brand}
          model={playerSpot.model}
          rarity={playerRarity}
          score={result.player_score}
          winner={won}
        />
        <ScoreCard
          label={opponent.brand}
          brand={opponent.brand}
          model={opponent.model}
          rarity={opponent.rarity}
          score={result.opponent_score}
          winner={!won}
        />
      </div>

      {won ? (
        <LootBoxReveal
          amount={result.xp_awarded}
          label={result.reward_value.label}
        />
      ) : (
        <div
          className="mx-4 mt-5 rounded-2xl bg-card p-4 text-center"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <p className="text-[12px] text-fg2">Lot de consolation</p>
          <p
            className="mt-1 flex items-center justify-center gap-1.5 font-extrabold text-white"
            style={{ fontSize: '20px' }}
          >
            <Zap className="h-4 w-4 text-accent" fill="currentColor" />
            +{result.xp_awarded} XP
          </p>
        </div>
      )}

      <div
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-[auto_1fr] gap-2 px-4 pt-3"
        style={{
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          background:
            'linear-gradient(to top, rgba(10,10,10,0.96) 60%, rgba(10,10,10,0) 100%)',
        }}
      >
        <button
          onClick={onHome}
          className="tappable rounded-full bg-white/[0.07] px-5 py-4 text-sm font-extrabold uppercase tracking-wider text-fg/80"
          style={{ border: '1px solid var(--color-border)' }}
        >
          Accueil
        </button>
        <button
          onClick={onAgain}
          className="tappable flex items-center justify-center gap-2 rounded-full bg-accent py-4 font-display font-extrabold uppercase tracking-wider text-white"
          style={{
            fontSize: '15px',
            boxShadow: '0 12px 30px rgba(232, 32, 58, 0.50)',
          }}
        >
          <Flag className="h-4 w-4" />
          REJOUER
        </button>
      </div>
    </div>
  )
}

function LootBoxReveal({ amount, label }: { amount: number; label: string }) {
  const [stage, setStage] = useState<'shake' | 'burst' | 'reward'>('shake')
  useEffect(() => {
    const t1 = setTimeout(() => setStage('burst'), 700)
    const t2 = setTimeout(() => setStage('reward'), 1100)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [])
  return (
    <div
      className="mx-4 mt-5 flex flex-col items-center rounded-2xl py-5"
      style={{
        background:
          'radial-gradient(circle at 50% 50%, rgba(232,32,58,0.12) 0%, rgba(20,20,20,0.85) 70%)',
        border: '1px solid rgba(232,32,58,0.30)',
        boxShadow: '0 14px 40px rgba(232,32,58,0.18)',
      }}
    >
      <p className="text-[10px] uppercase tracking-widest text-fg2">
        Récompense
      </p>
      <div className="relative mt-2 flex h-20 w-20 items-center justify-center">
        {stage === 'shake' && (
          <Gift
            className="h-14 w-14 text-accent"
            style={{ animation: 'race-loot-shake 0.7s ease-in-out infinite' }}
          />
        )}
        {stage === 'burst' && (
          <>
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(255,255,200,0.85) 0%, rgba(232,32,58,0.45) 50%, transparent 80%)',
                animation: 'race-loot-burst 600ms ease-out forwards',
              }}
            />
            <Gift className="h-14 w-14 text-accent opacity-0" />
          </>
        )}
        {stage === 'reward' && (
          <div
            className="flex items-center justify-center"
            style={{ animation: 'race-reward-rise 560ms var(--ease-spring) both' }}
          >
            <span
              className="flex items-center gap-1.5 rounded-full px-4 py-2 font-extrabold text-white"
              style={{
                background:
                  'linear-gradient(135deg, #E8203A 0%, #B7172A 100%)',
                boxShadow: '0 14px 38px rgba(232,32,58,0.55)',
                fontSize: '20px',
              }}
            >
              <Zap className="h-5 w-5" fill="currentColor" />
              +{amount} XP
            </span>
          </div>
        )}
      </div>
      <p
        className="mt-2 text-center font-extrabold uppercase tracking-wider text-fg/85"
        style={{ fontSize: '11px' }}
      >
        {label}
      </p>
    </div>
  )
}

function ScoreCard({
  label,
  brand,
  model,
  rarity,
  score,
  winner,
}: {
  label: string
  brand: string
  model: string
  rarity: Rarity
  score: number
  winner: boolean
}) {
  return (
    <div
      className="rounded-2xl p-3"
      style={{
        background: '#0d0d0d',
        border: winner
          ? `2px solid ${RARITY_COLOR[rarity]}`
          : '1px solid var(--color-border)',
        boxShadow: winner ? `0 10px 24px ${RARITY_COLOR[rarity]}44` : undefined,
      }}
    >
      {winner && (
        <p
          className="mb-1 flex items-center gap-1 text-[8px] font-extrabold uppercase tracking-wider"
          style={{ color: RARITY_COLOR[rarity] }}
        >
          <Trophy className="h-2.5 w-2.5" /> WIN
        </p>
      )}
      <p
        className="text-[9px] uppercase tracking-widest"
        style={{ color: RARITY_COLOR[rarity] }}
      >
        {label}
      </p>
      <p
        className="mt-0.5 truncate font-display font-extrabold tracking-tight text-white"
        style={{ fontSize: '12px' }}
      >
        {brand !== label ? `${brand} ${model}` : model}
      </p>
      <p
        className="mt-2 font-display font-extrabold tracking-tighter text-white"
        style={{ fontSize: '22px' }}
      >
        {score}
      </p>
      <p className="text-[9px] uppercase tracking-widest text-fg2">SCORE</p>
    </div>
  )
}

// ─────────────────────────────── BACKDROPS ───────────────────────────────

function FloatingParticles({ count = 14 }: { count?: number }) {
  const particles = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      id: i,
      left: `${(i * 11 + Math.random() * 9) % 100}%`,
      delay: `${Math.random() * 7}s`,
      duration: `${8 + Math.random() * 6}s`,
      rx: `${(Math.random() - 0.5) * 60}px`,
      size: 3 + Math.random() * 4,
    }))
  }, [count])
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="race-particle"
          style={{
            left: p.left,
            width: `${p.size}px`,
            height: `${p.size}px`,
            animationDelay: p.delay,
            animationDuration: p.duration,
            ['--rx' as string]: p.rx,
          } as React.CSSProperties}
        />
      ))}
    </div>
  )
}

function RoadBackdrop() {
  // Cheap perspective effect behind the face-à-face — diagonal lines
  // that drift slowly + soft red wash at the bottom.
  return (
    <div
      className="pointer-events-none absolute inset-0 opacity-55"
      style={{
        background:
          'repeating-linear-gradient(120deg, rgba(232,32,58,0.08) 0px, rgba(232,32,58,0.08) 2px, transparent 2px, transparent 12px), radial-gradient(circle at 50% 100%, rgba(232,32,58,0.22) 0%, transparent 60%)',
        backgroundSize: '200% 200%',
        animation: 'race-track-drift 14s linear infinite',
      }}
    />
  )
}
