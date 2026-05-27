import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Flag,
  Gauge,
  Gift,
  Loader2,
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

/** Top speed estimate for the HUD gauge — calibrated so a 200 HP car
 *  caps near 200 km/h and a 700 HP car around 325 km/h. The gauge is
 *  cosmetic; it doesn't feed the real score. */
function topSpeedFromHp(hp: number): number {
  return Math.max(180, Math.min(330, Math.round(150 + hp * 0.25)))
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

  // ────── load user's spots once ──────
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

  // ────── countdown: 3 → 2 → 1 → GO at 1s intervals ──────
  useEffect(() => {
    if (phase !== 'countdown') return
    setCountdown(3)
    setGoAt(null)
    setTapDelta(null)
    setShowGoFlash(false)
    const t1 = window.setTimeout(() => setCountdown(2), 1000)
    const t2 = window.setTimeout(() => setCountdown(1), 2000)
    const t3 = window.setTimeout(() => {
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

  // ────── auto-fail if the player doesn't tap within 1.5s after GO ──────
  useEffect(() => {
    if (phase !== 'countdown' || goAt == null) return
    goTimerRef.current = window.setTimeout(() => {
      onTap(performance.now() + 1500) // forces a 'miss' bucket
    }, 1500)
    return () => {
      if (goTimerRef.current != null) clearTimeout(goTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, goAt])

  // ────── tap → resolve RPC + drive sprint/finish/result ──────
  async function onTap(now = performance.now()) {
    if (phase !== 'countdown' || !start || tapDelta != null) return
    if (goTimerRef.current != null) {
      clearTimeout(goTimerRef.current)
      goTimerRef.current = null
    }
    const delta = goAt == null ? -50 : Math.round(now - goAt)
    setTapDelta(delta)
    setPhase('sprint')

    // Fire resolveRace in parallel with the sprint animation. The
    // RPC typically returns in <500ms; we cache the result and the
    // sprint phase reads it once available so the lead car can pull
    // ahead. Race timing budget: 5s sprint + 3s finish = 8s total
    // before result reveal.
    const rPromise = resolveRace(start.raceId, delta)

    window.setTimeout(() => setPhase('finish'), 5000)
    window.setTimeout(async () => {
      const r = await rPromise
      setResult(r)
      setPhase('result')
      if (r && r.xp_awarded > 0) floatXp(r.xp_awarded)
    }, 8000)

    // Also store the promised result early so SprintPhase can read
    // it when it lands.
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

  // ─────────────────────────────── RENDER ───────────────────────────────

  // The select / ready phases use the page chrome (back button + title).
  // The race phases (countdown / sprint / finish) are full-bleed for
  // immersion; the result phase comes back to the chrome.
  const showChrome = phase === 'select' || phase === 'ready' || phase === 'result'

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

      <div className={showChrome ? 'px-4' : ''}>
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
            onCancel={reset}
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
    </div>
  )
}

// ─────────────────────────────── PARTICLES ───────────────────────────────

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

// ─────────────────────────────── SELECT ───────────────────────────────

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
  return (
    <div className="relative">
      <FloatingParticles />
      {spots === null ? (
        <div className="grid grid-cols-2 gap-3 pb-32">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="aspect-[2/3] rounded-2xl" />
          ))}
        </div>
      ) : spots.length === 0 ? (
        <div
          className="flex flex-col items-center rounded-2xl bg-card px-6 py-12 text-center"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <p className="font-medium">
            Pas encore de cartes. Spotte d'abord pour pouvoir courir !
          </p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-fg2">
            Choisis ta carte. La rareté multiplie ton score (×1 / ×1.5 /
            ×2.5 / ×4).
          </p>
          <div className="grid grid-cols-2 gap-3 pb-32">
            {spots.map((s) => {
              const rarity = (s.rarity ?? 'commun') as Rarity
              const picked = pickedId === s.id
              return (
                <button
                  key={s.id}
                  onClick={() => onPick(s.id)}
                  className="tappable relative aspect-[2/3] overflow-hidden rounded-2xl text-left"
                  style={{
                    background: '#0d0d0d',
                    border: picked
                      ? `2px solid ${RARITY_COLOR[rarity]}`
                      : '2px solid transparent',
                    outline: !picked
                      ? `1px solid ${RARITY_COLOR[rarity]}55`
                      : undefined,
                    boxShadow: picked
                      ? `0 16px 38px ${RARITY_COLOR[rarity]}66, 0 0 0 1px ${RARITY_COLOR[rarity]}44`
                      : '0 8px 18px rgba(0, 0, 0, 0.45)',
                    transform: picked ? 'translateY(-4px) scale(1.02)' : undefined,
                    transition: 'transform 280ms var(--ease-spring), box-shadow 240ms ease',
                    animation: picked ? 'race-card-pop 380ms var(--ease-spring)' : undefined,
                  }}
                >
                  {s.photo_url ? (
                    <img
                      src={s.photo_url}
                      alt={`${s.brand} ${s.model}`}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-fg2">
                      pas de photo
                    </div>
                  )}
                  <div
                    className="absolute inset-x-0 bottom-0 px-2.5 pb-2 pt-6 text-white"
                    style={{
                      background:
                        'linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 100%)',
                    }}
                  >
                    <p className="text-[8.5px] uppercase tracking-widest text-white/55">
                      {s.brand}
                    </p>
                    <p
                      className="truncate font-display font-extrabold tracking-tight"
                      style={{ fontSize: '13px' }}
                    >
                      {s.model}
                    </p>
                  </div>
                  <span
                    className="absolute right-1.5 top-1.5 rounded-full px-2 py-0.5 font-extrabold uppercase"
                    style={{
                      background: 'rgba(0,0,0,0.55)',
                      color: RARITY_COLOR[rarity],
                      border: `1px solid ${RARITY_COLOR[rarity]}66`,
                      fontSize: '7.5px',
                      letterSpacing: '0.08em',
                    }}
                  >
                    {RARITY_LABEL[rarity]}
                  </span>
                </button>
              )
            })}
          </div>
        </>
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
          disabled={!pickedId || busy}
          className="tappable flex w-full items-center justify-center gap-2 rounded-full bg-accent py-4 text-sm font-extrabold uppercase tracking-wider text-white disabled:opacity-40"
          style={{ boxShadow: '0 10px 26px rgba(232, 32, 58, 0.45)' }}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Flag className="h-4 w-4" />
          )}
          {busy ? 'PRÉPARATION…' : 'COURIR'}
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────── READY (face-à-face) ───────────────────────────────

function ReadyPhase({
  spot,
  playerHp,
  opponent,
  stake,
  onGo,
  onCancel,
}: {
  spot: Spot
  playerHp: number
  opponent: RaceOpponent
  stake: RaceStake
  onGo: () => void
  onCancel: () => void
}) {
  const playerRarity = (spot.rarity ?? 'commun') as Rarity
  const playerEstScore = Math.round(playerHp * RARITY_MULT[playerRarity] * 1.1)
  const oppEstScore = Math.round(
    opponent.horsepower * RARITY_MULT[opponent.rarity] * 1.1,
  )
  return (
    <div className="relative pb-32">
      {/* Animated track gradient backdrop */}
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            'repeating-linear-gradient(120deg, rgba(232,32,58,0.08) 0px, rgba(232,32,58,0.08) 2px, transparent 2px, transparent 12px), radial-gradient(circle at 50% 100%, rgba(232,32,58,0.20) 0%, transparent 60%)',
          backgroundSize: '200% 200%',
          animation: 'race-track-drift 14s linear infinite',
        }}
      />

      <div className="relative">
        {/* Stake banner */}
        <div
          className="mb-5 rounded-2xl px-4 py-3 text-center"
          style={{
            background:
              'linear-gradient(135deg, rgba(232,32,58,0.28) 0%, rgba(232,32,58,0.08) 100%)',
            border: '1px solid rgba(232,32,58,0.45)',
            boxShadow: '0 0 28px rgba(232,32,58,0.18)',
          }}
        >
          <p className="text-[10px] uppercase tracking-widest text-white/70">
            Enjeu de la course
          </p>
          <p
            className="mt-1 flex items-center justify-center gap-1.5 font-display font-extrabold tracking-tighter text-white"
            style={{ fontSize: '26px' }}
          >
            <Zap className="h-5 w-5 text-accent" fill="currentColor" />
            {stake.label}
          </p>
        </div>

        {/* Face-à-face */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
          <Fighter
            title="TOI"
            brand={spot.brand}
            model={spot.model}
            rarity={playerRarity}
            hp={playerHp}
            score={playerEstScore}
            photoUrl={spot.photo_url}
            mirror={false}
          />
          <div
            className="font-display font-extrabold tracking-tighter text-accent"
            style={{
              fontSize: '44px',
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
            score={oppEstScore}
            photoUrl={null}
            mirror
          />
        </div>

        <div
          className="mt-5 rounded-xl bg-card/60 p-3 text-[11px] text-fg2"
          style={{ border: '1px solid var(--color-border)' }}
        >
          Score = puissance × rareté × timing. Le score estimé suppose un
          départ correct — vise <strong className="text-fg">GO</strong> dans
          les 300 ms pour le multiplicateur parfait (×1.2).
        </div>
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-[auto_1fr] gap-2 px-4 pt-3"
        style={{
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          background:
            'linear-gradient(to top, rgba(10,10,10,0.96) 60%, rgba(10,10,10,0) 100%)',
        }}
      >
        <button
          onClick={onCancel}
          className="tappable rounded-full bg-white/[0.07] px-5 py-4 text-sm font-extrabold uppercase tracking-wider text-fg/70"
          style={{ border: '1px solid var(--color-border)' }}
        >
          Annuler
        </button>
        <button
          onClick={onGo}
          className="tappable flex items-center justify-center gap-2 rounded-full bg-accent py-4 text-sm font-extrabold uppercase tracking-wider text-white"
          style={{ boxShadow: '0 10px 26px rgba(232, 32, 58, 0.45)' }}
        >
          <Flag className="h-4 w-4" />
          C'est parti
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
  const tilt = mirror ? 'rotateY(-8deg)' : 'rotateY(8deg)'
  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        border: `1.5px solid ${RARITY_COLOR[rarity]}`,
        boxShadow: `0 12px 30px ${RARITY_COLOR[rarity]}44, inset 0 0 0 1px rgba(255,255,255,0.04)`,
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
          />
        ) : (
          <AiSilhouette brand={brand} color={RARITY_COLOR[rarity]} />
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
  )
}

function AiSilhouette({ brand, color }: { brand: string; color: string }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center"
      style={{
        background:
          `radial-gradient(circle at 50% 100%, ${color}33 0%, #050505 70%)`,
      }}
    >
      <span style={{ fontSize: '52px' }}>🏎️</span>
      <span
        className="mt-1 text-[8.5px] uppercase tracking-widest text-white/55"
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
      {/* White flash overlay on GO */}
      {showGoFlash && (
        <div
          className="pointer-events-none absolute inset-0 z-40 bg-white"
          style={{ animation: 'race-go-flash 320ms ease-out forwards' }}
        />
      )}

      {/* Cars at the start line */}
      <div className="flex flex-1 items-center justify-center px-6 pt-6">
        <div className="grid w-full grid-cols-2 gap-3">
          <StartCar
            photoUrl={spot.photo_url}
            brand={spot.brand}
            label={spot.model}
            rarity={playerRarity}
          />
          <StartCar
            photoUrl={null}
            brand={opponent.brand}
            label={opponent.model}
            rarity={opponent.rarity}
          />
        </div>
      </div>

      {/* Countdown digit, centered, transitions to GO! green */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span
          key={`${countdown}-${isGo}`}
          className="font-display font-extrabold tracking-tighter"
          style={{
            fontSize: isGo ? '160px' : '180px',
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

      {/* Tap button — appears at GO. Fixed bottom so the user's
          thumb hovers nearby during the countdown. */}
      <div
        className="px-4 pt-3"
        style={{
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        }}
      >
        <button
          onClick={onTap}
          disabled={!isGo}
          className="tappable flex w-full items-center justify-center rounded-full font-display font-extrabold uppercase tracking-wider text-white"
          style={{
            padding: '22px',
            fontSize: '22px',
            background: isGo
              ? 'radial-gradient(circle at center, #22C55E 0%, #16A34A 60%, #14532D 100%)'
              : 'rgba(255,255,255,0.05)',
            border: isGo
              ? '3px solid rgba(34, 197, 94, 0.85)'
              : '2px solid rgba(255,255,255,0.10)',
            boxShadow: isGo
              ? '0 0 60px rgba(34, 197, 94, 0.65), inset 0 0 40px rgba(34, 197, 94, 0.30)'
              : 'none',
            opacity: isGo ? 1 : 0.45,
            transition: 'all 180ms var(--ease-spring)',
          }}
        >
          {isGo ? 'DÉMARRER' : 'ATTENDS LE GO'}
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
}: {
  photoUrl: string | null
  brand: string
  label: string
  rarity: Rarity
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
        />
      ) : (
        <AiSilhouette brand={brand} color={RARITY_COLOR[rarity]} />
      )}
      <div
        className="absolute inset-x-0 bottom-0 px-2 py-1.5 text-white"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.92), transparent)',
        }}
      >
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
  // Speed gauge climbs over 4.5s easeOut; in slowMo it sits near top.
  const [speed, setSpeed] = useState(slowMo ? playerTop - 12 : 0)
  const startedAt = useRef<number | null>(null)

  useEffect(() => {
    let frame = 0
    startedAt.current = performance.now()
    const tick = () => {
      const now = performance.now()
      const t = Math.min(1, ((now - (startedAt.current ?? now)) / (slowMo ? 2800 : 4600)))
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3)
      const v = slowMo ? playerTop - Math.round(eased * 12) : Math.round(eased * playerTop)
      setSpeed(v)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [slowMo, playerTop])

  // Lead position: 0..1 along the lane. The car with the higher score
  // pulls ahead — we read the result as soon as resolveRace lands.
  const playerLead = useMemo(() => {
    if (!result) return 0.5
    const total = result.player_score + result.opponent_score
    if (total <= 0) return 0.5
    return result.player_score / total
  }, [result])

  // Lane progress endpoints — finish phase pushes the leader further.
  const playerProgress = slowMo
    ? Math.min(0.98, 0.62 + (playerLead - 0.5) * 0.85)
    : Math.min(0.85, 0.40 + (playerLead - 0.5) * 0.70)
  const opponentProgress = slowMo
    ? Math.min(0.98, 0.62 + ((1 - playerLead) - 0.5) * 0.85)
    : Math.min(0.85, 0.40 + ((1 - playerLead) - 0.5) * 0.70)

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden"
      style={{
        background:
          'radial-gradient(circle at 50% 40%, #1a0a0d 0%, #0a0a0a 70%, #000 100%)',
      }}
    >
      {/* HUD top — speed gauge + boost bar */}
      <div className="z-20 flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div
          className="flex items-center gap-2 rounded-2xl px-3 py-2"
          style={{
            background: 'rgba(0,0,0,0.55)',
            border: '1px solid rgba(232,32,58,0.40)',
            backdropFilter: 'blur(6px)',
          }}
        >
          <Gauge className="h-4 w-4 text-accent" />
          <span
            className="font-display font-extrabold tracking-tighter text-white"
            style={{ fontSize: '22px', lineHeight: 1, minWidth: '54px' }}
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
            className="h-1.5 w-full overflow-hidden rounded-full"
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

      {/* Track lanes — two columns with scrolling road lines */}
      <div className="z-10 flex flex-1 gap-2 px-3 py-3">
        <Lane
          progress={playerProgress}
          slowMo={slowMo}
          spotPhotoUrl={spot.photo_url}
          aiBrand={null}
          rarity={playerRarity}
          isPlayer
        />
        <Lane
          progress={opponentProgress}
          slowMo={slowMo}
          spotPhotoUrl={null}
          aiBrand={opponent.brand}
          rarity={opponent.rarity}
          isPlayer={false}
        />
      </div>

      <div className="z-20 mb-4 text-center">
        <p
          className="text-[10px] uppercase tracking-widest text-fg2"
        >
          {slowMo ? 'ARRIVÉE…' : 'COURSE EN COURS'}
        </p>
      </div>
    </div>
  )
}

function Lane({
  progress,
  slowMo,
  spotPhotoUrl,
  aiBrand,
  rarity,
  isPlayer,
}: {
  progress: number
  slowMo: boolean
  spotPhotoUrl: string | null
  aiBrand: string | null
  rarity: Rarity
  isPlayer: boolean
}) {
  return (
    <div
      className="relative flex-1 overflow-hidden rounded-2xl"
      style={{
        background:
          'repeating-linear-gradient(0deg, transparent 0px, transparent 38px, rgba(255,255,255,0.08) 38px, rgba(255,255,255,0.08) 42px), linear-gradient(180deg, #1a1a1a 0%, #050505 100%)',
        backgroundSize: '100% 80px, 100% 100%',
        animation: `race-road-scroll ${slowMo ? '600ms' : '180ms'} linear infinite`,
        border: `1.5px solid ${RARITY_COLOR[rarity]}55`,
        boxShadow: `inset 0 0 36px ${RARITY_COLOR[rarity]}28`,
      }}
    >
      {/* Light trail behind the car */}
      <div
        className="pointer-events-none absolute left-1/2 -translate-x-1/2"
        style={{
          bottom: `${4 + progress * 70}%`,
          width: '60%',
          height: '22%',
          background: `radial-gradient(ellipse at center, ${RARITY_COLOR[rarity]}55 0%, transparent 70%)`,
          filter: 'blur(8px)',
          animation: 'race-trail-pulse 600ms ease-in-out infinite',
        }}
      />

      {/* The car itself */}
      <div
        className="absolute left-1/2 -translate-x-1/2"
        style={{
          bottom: `${6 + progress * 70}%`,
          width: '78%',
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
          {spotPhotoUrl ? (
            <img
              src={spotPhotoUrl}
              alt={isPlayer ? 'Toi' : 'Adversaire'}
              className="h-full w-full object-cover"
              style={{ filter: slowMo ? 'none' : 'saturate(1.1) contrast(1.05)' }}
            />
          ) : (
            <AiSilhouette brand={aiBrand ?? 'AI'} color={RARITY_COLOR[rarity]} />
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

      {/* Player / AI label badge bottom */}
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
        {isPlayer ? 'TOI' : aiBrand}
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
  const glowColor = RARITY_COLOR[winnerRarity]
  return (
    <div
      className="relative pb-32"
      style={{
        backgroundImage: `radial-gradient(circle at 50% 30%, ${glowColor}22 0%, transparent 60%)`,
      }}
    >
      {won && <Confetti count={50} duration={2200} />}

      <p
        className="mt-4 text-center font-display font-extrabold tracking-tighter"
        style={{
          fontSize: '52px',
          lineHeight: 1,
          color: won ? '#22C55E' : '#E8203A',
          textShadow: won
            ? '0 0 32px rgba(34,197,94,0.65)'
            : '0 0 32px rgba(232,32,58,0.65)',
          animation: 'race-pop 460ms var(--ease-spring) both',
        }}
      >
        {won ? 'VICTOIRE' : 'DÉFAITE'}
      </p>

      {/* Winner card centerpiece — slow Y-axis swing */}
      <div className="mt-5 flex justify-center">
        <div
          className="overflow-hidden rounded-2xl"
          style={{
            width: '70%',
            maxWidth: '260px',
            aspectRatio: '2/3',
            border: `2px solid ${glowColor}`,
            boxShadow: `0 22px 60px ${glowColor}66, 0 0 0 1px ${glowColor}44`,
            animation: 'race-win-spin 4.2s ease-in-out infinite',
          }}
        >
          {won ? (
            playerSpot.photo_url ? (
              <img
                src={playerSpot.photo_url}
                alt={playerSpot.model}
                className="h-full w-full object-cover"
              />
            ) : (
              <AiSilhouette brand={playerSpot.brand} color={glowColor} />
            )
          ) : (
            <AiSilhouette brand={opponent.brand} color={glowColor} />
          )}
        </div>
      </div>

      {/* Timing pill */}
      <p
        className="mx-auto mt-4 inline-block rounded-full px-3 py-1 font-extrabold uppercase tracking-wider"
        style={{
          background: `${TIMING_COLOR[result.timing_bucket]}22`,
          color: TIMING_COLOR[result.timing_bucket],
          border: `1px solid ${TIMING_COLOR[result.timing_bucket]}66`,
          fontSize: '10px',
          display: 'block',
          width: 'fit-content',
        }}
      >
        {TIMING_LABEL[result.timing_bucket]} (×{result.timing_mult})
      </p>

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
          model={opponent.model}
          brand={opponent.brand}
          rarity={opponent.rarity}
          score={result.opponent_score}
          winner={!won}
        />
      </div>

      {/* Loot-box reveal — only on win. */}
      {won && (
        <LootBoxReveal
          amount={result.xp_awarded}
          label={result.reward_value.label}
        />
      )}
      {!won && (
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
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-2 gap-2 px-4 pt-3"
        style={{
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          background:
            'linear-gradient(to top, rgba(10,10,10,0.96) 60%, rgba(10,10,10,0) 100%)',
        }}
      >
        <button
          onClick={onHome}
          className="tappable rounded-full bg-white/[0.07] py-4 text-sm font-extrabold uppercase tracking-wider text-fg/80"
          style={{ border: '1px solid var(--color-border)' }}
        >
          Accueil
        </button>
        <button
          onClick={onAgain}
          className="tappable flex items-center justify-center gap-2 rounded-full bg-accent py-4 text-sm font-extrabold uppercase tracking-wider text-white"
          style={{ boxShadow: '0 10px 26px rgba(232, 32, 58, 0.45)' }}
        >
          <Flag className="h-4 w-4" />
          Rejouer
        </button>
      </div>
    </div>
  )
}

/** Loot-box visual: a box icon shakes for 600ms, a burst halo expands
 *  and fades, then the reward badge rises into place. Pure CSS; the
 *  animation runs once on mount via the `react-loot` key bump. */
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
    <div className="mx-4 mt-5 flex flex-col items-center rounded-2xl py-5"
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
