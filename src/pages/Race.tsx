import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Flag,
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

type Phase = 'select' | 'ready' | 'countdown' | 'racing' | 'result'

const RARITY_BORDER: Record<Rarity, string> = {
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

  // ────── start race once a card is picked + user taps "Démarrer" ──────
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

  // ────── countdown driver — schedules 3→2→1→GO at 1000ms intervals ──────
  useEffect(() => {
    if (phase !== 'countdown') return
    setCountdown(3)
    setGoAt(null)
    setTapDelta(null)
    const t1 = window.setTimeout(() => setCountdown(2), 1000)
    const t2 = window.setTimeout(() => setCountdown(1), 2000)
    const t3 = window.setTimeout(() => {
      setCountdown(0)
      setGoAt(performance.now())
    }, 3000)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [phase])

  // ────── auto-fail if user doesn't tap within 1.5s after GO ──────
  useEffect(() => {
    if (phase !== 'countdown' || goAt == null) return
    goTimerRef.current = window.setTimeout(() => {
      onTap(performance.now() + 1500) // forces a "miss" delta
    }, 1500)
    return () => {
      if (goTimerRef.current != null) clearTimeout(goTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, goAt])

  // ────── tap handler. delta < 0 = false start; > 700 = miss ──────
  async function onTap(now = performance.now()) {
    if (phase !== 'countdown' || !start || tapDelta != null) return
    if (goTimerRef.current != null) {
      clearTimeout(goTimerRef.current)
      goTimerRef.current = null
    }
    const delta = goAt == null ? -50 : Math.round(now - goAt)
    setTapDelta(delta)
    setPhase('racing')
    // Resolve server-side, then flip to result after the race anim ends.
    const r = await resolveRace(start.raceId, delta)
    // Hold the racing animation for at least 2500ms even if RPC is fast,
    // so the suspense lands.
    window.setTimeout(() => {
      setResult(r)
      setPhase('result')
      if (r && r.xp_awarded > 0) floatXp(r.xp_awarded)
    }, 2600)
  }

  function reset() {
    setStart(null)
    setPickedId(null)
    setResult(null)
    setTapDelta(null)
    setGoAt(null)
    setPhase('select')
  }

  // ─────────────────────────────── UI ───────────────────────────────

  return (
    <div
      className="min-h-screen bg-bg px-4 text-fg"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => (phase === 'select' ? navigate(-1) : reset())}
          aria-label="Retour"
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="display-xl text-fg">REVS RACE</h1>
      </div>

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
          countdown={countdown}
          goAt={goAt}
          onTap={() => onTap()}
        />
      )}

      {phase === 'racing' && start && pickedSpot && (
        <RacingPhase
          playerSpot={pickedSpot}
          opponent={start.opponent}
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
  if (spots === null) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[2/3] rounded-2xl" />
        ))}
      </div>
    )
  }
  if (spots.length === 0) {
    return (
      <div className="flex flex-col items-center rounded-2xl bg-card px-6 py-12 text-center"
        style={{ border: '1px solid var(--color-border)' }}>
        <p className="font-medium">
          Pas encore de cartes. Spotte d'abord pour pouvoir courir !
        </p>
      </div>
    )
  }
  return (
    <>
      <p className="mb-4 text-sm text-fg2">
        Choisis ta carte. Plus la rareté est haute, plus elle pèse dans le
        score (multiplicateur ×1 / ×1.5 / ×2.5 / ×4).
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
                  ? `2px solid ${RARITY_BORDER[rarity]}`
                  : '2px solid transparent',
                boxShadow: picked
                  ? `0 12px 28px ${RARITY_BORDER[rarity]}55`
                  : '0 8px 18px rgba(0,0,0,0.45)',
                outline: !picked
                  ? `1px solid ${RARITY_BORDER[rarity]}55`
                  : undefined,
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
                  color: RARITY_BORDER[rarity],
                  border: `1px solid ${RARITY_BORDER[rarity]}66`,
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
    </>
  )
}

// ─────────────────────────────── READY ───────────────────────────────

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
  return (
    <div className="pb-32">
      <div
        className="mb-4 rounded-2xl px-4 py-3 text-center"
        style={{
          background:
            'linear-gradient(135deg, rgba(232,32,58,0.22) 0%, rgba(232,32,58,0.08) 100%)',
          border: '1px solid rgba(232,32,58,0.35)',
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

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <Fighter
          title="TOI"
          brand={spot.brand}
          model={spot.model}
          rarity={playerRarity}
          hp={playerHp}
          photoUrl={spot.photo_url}
        />
        <span
          className="font-display font-extrabold tracking-tighter text-fg2"
          style={{ fontSize: '32px' }}
        >
          VS
        </span>
        <Fighter
          title="ADVERSAIRE"
          brand={opponent.brand}
          model={opponent.model}
          rarity={opponent.rarity}
          hp={opponent.horsepower}
          photoUrl={null}
        />
      </div>

      <div
        className="mt-4 rounded-xl bg-card/60 p-3 text-[11px] text-fg2"
        style={{ border: '1px solid var(--color-border)' }}
      >
        Score = puissance × rareté × timing. Vise <strong className="text-fg">GO</strong>{' '}
        dans les 300 ms pour un départ parfait (×1.2).
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
  photoUrl,
}: {
  title: string
  brand: string
  model: string
  rarity: Rarity
  hp: number
  photoUrl: string | null
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        border: `1.5px solid ${RARITY_BORDER[rarity]}`,
        boxShadow: `0 10px 24px ${RARITY_BORDER[rarity]}44`,
        background: '#0d0d0d',
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
          <div className="absolute inset-0 flex items-center justify-center text-3xl">
            🤖
          </div>
        )}
      </div>
      <div className="px-2 py-2">
        <p
          className="text-[8.5px] uppercase tracking-widest"
          style={{ color: RARITY_BORDER[rarity] }}
        >
          {title}
        </p>
        <p
          className="mt-0.5 truncate font-display font-extrabold tracking-tight text-white"
          style={{ fontSize: '12px' }}
        >
          {model}
        </p>
        <p className="mt-0.5 text-[9.5px] text-fg2">
          <span className="text-white/70">{hp} ch</span> · {RARITY_LABEL[rarity]}
        </p>
      </div>
    </div>
  )
}

// ─────────────────────────────── COUNTDOWN ───────────────────────────────

function CountdownPhase({
  countdown,
  goAt,
  onTap,
}: {
  countdown: number
  goAt: number | null
  onTap: () => void
}) {
  const isGo = goAt != null
  return (
    <button
      onClick={onTap}
      className="tappable mx-auto mt-12 flex aspect-square w-full max-w-[280px] items-center justify-center rounded-full"
      style={{
        background: isGo
          ? 'radial-gradient(circle at center, #22C55E 0%, #16A34A 60%, #14532D 100%)'
          : 'radial-gradient(circle at center, #2a0c11 0%, #14080a 70%)',
        border: isGo
          ? '3px solid rgba(34, 197, 94, 0.85)'
          : '3px solid rgba(232, 32, 58, 0.35)',
        boxShadow: isGo
          ? '0 0 80px rgba(34, 197, 94, 0.55), inset 0 0 80px rgba(34, 197, 94, 0.30)'
          : '0 0 60px rgba(232, 32, 58, 0.35), inset 0 0 40px rgba(232, 32, 58, 0.20)',
        transition: 'all 200ms var(--ease-spring)',
      }}
      aria-label={isGo ? 'GO — appuie maintenant' : `Patiente — ${countdown}`}
    >
      <span
        key={`${countdown}-${isGo}`}
        className="font-display font-extrabold tracking-tighter text-white"
        style={{
          fontSize: isGo ? '88px' : '120px',
          textShadow: isGo
            ? '0 0 30px rgba(255,255,255,0.6)'
            : '0 0 30px rgba(232, 32, 58, 0.5)',
          animation: 'race-pop 280ms var(--ease-spring) both',
        }}
      >
        {isGo ? 'GO!' : countdown}
      </span>
    </button>
  )
}

// ─────────────────────────────── RACING ───────────────────────────────

function RacingPhase({
  playerSpot,
  opponent,
}: {
  playerSpot: Spot
  opponent: RaceOpponent
}) {
  // Visual only — actual outcome already locked by resolveRace.
  // Both cars sprint for 2.5s; the result reveal happens after.
  return (
    <div className="mt-8 space-y-5">
      <Track label="TOI" emoji="🏎️" tint="#E8203A" duration={2400} />
      <Track
        label={opponent.brand.toUpperCase()}
        emoji="🏁"
        tint="#8a8a8a"
        duration={2400}
      />
      <p className="mt-6 text-center text-fg2" style={{ fontSize: '13px' }}>
        Course en cours…
      </p>
      <p className="text-center text-fg/40" style={{ fontSize: '11px' }}>
        {playerSpot.brand} {playerSpot.model}
      </p>
    </div>
  )
}

function Track({
  label,
  emoji,
  tint,
  duration,
}: {
  label: string
  emoji: string
  tint: string
  duration: number
}) {
  return (
    <div>
      <p
        className="mb-1.5 text-[10px] uppercase tracking-widest"
        style={{ color: tint }}
      >
        {label}
      </p>
      <div
        className="relative h-10 overflow-hidden rounded-full"
        style={{
          background:
            'repeating-linear-gradient(90deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 12px, transparent 12px, transparent 24px)',
          border: '1px solid var(--color-border)',
        }}
      >
        <span
          className="absolute top-1/2 -translate-y-1/2 text-2xl"
          style={{
            left: 4,
            animation: `race-zoom ${duration}ms cubic-bezier(0.35, 0.2, 0.4, 1) forwards`,
          }}
        >
          {emoji}
        </span>
        <span
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xl"
          aria-hidden
        >
          🏁
        </span>
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
  return (
    <div className="pb-32">
      <div
        className="rounded-3xl p-5 text-center"
        style={{
          background: won
            ? 'linear-gradient(135deg, rgba(34,197,94,0.20) 0%, rgba(34,197,94,0.05) 100%)'
            : 'linear-gradient(135deg, rgba(232,32,58,0.22) 0%, rgba(232,32,58,0.05) 100%)',
          border: won
            ? '1px solid rgba(34,197,94,0.45)'
            : '1px solid rgba(232,32,58,0.45)',
        }}
      >
        <p
          className="flex items-center justify-center gap-2 font-display font-extrabold tracking-tighter"
          style={{
            fontSize: '36px',
            color: won ? '#22C55E' : '#E8203A',
          }}
        >
          {won ? <Trophy className="h-7 w-7" /> : null}
          {won ? 'VICTOIRE' : 'DÉFAITE'}
        </p>
        <p
          className="mt-2 inline-block rounded-full px-3 py-1 font-extrabold uppercase tracking-wider"
          style={{
            background: `${TIMING_COLOR[result.timing_bucket]}22`,
            color: TIMING_COLOR[result.timing_bucket],
            border: `1px solid ${TIMING_COLOR[result.timing_bucket]}66`,
            fontSize: '10px',
          }}
        >
          {TIMING_LABEL[result.timing_bucket]} (×{result.timing_mult})
        </p>
        <p
          className="mt-3 flex items-center justify-center gap-1.5 font-extrabold text-white"
          style={{ fontSize: '20px' }}
        >
          <Zap className="h-4 w-4 text-accent" fill="currentColor" />
          +{result.xp_awarded} XP
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
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
          ? `2px solid ${RARITY_BORDER[rarity]}`
          : '1px solid var(--color-border)',
        boxShadow: winner
          ? `0 10px 24px ${RARITY_BORDER[rarity]}44`
          : undefined,
      }}
    >
      <p
        className="text-[9px] uppercase tracking-widest"
        style={{ color: RARITY_BORDER[rarity] }}
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
