import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { setPendingPhoto } from '../lib/pendingPhoto'
import { xpLevel, XP_LADDER } from '../lib/xp'
import { GP_2026 } from '../lib/f1'
import { Skeleton } from '../components/Skeleton'
import {
  challengePct as computeChallengePct,
  fetchActiveChallenges,
  type Challenge,
} from '../lib/challenges'
import { fetchLiveEvents, type LiveEvent } from '../lib/liveEvents'
import TitleChip from '../components/TitleChip'

type CommunityStats = {
  spots_today: number
  online_now: number
  top_brand: string | null
}

type CityRank = {
  city: string
  rank: number
  total: number
  gapToAbove: number
  abovePseudo: string | null
  progressToNext: number // 0..1 toward the rank above (my XP / above XP)
}

type CityRow = { user_id: string; xp: number; pseudo: string | null }

// Current daily streak: consecutive days (local) with at least one spot,
// counting back from today (or yesterday if today has none yet).
function computeStreak(isoDates: string[]): number {
  const fmt = (dt: Date) => dt.toLocaleDateString('en-CA') // YYYY-MM-DD
  const days = new Set(isoDates.map((d) => fmt(new Date(d))))
  const cursor = new Date()
  if (!days.has(fmt(cursor))) {
    cursor.setDate(cursor.getDate() - 1)
    if (!days.has(fmt(cursor))) return 0
  }
  let streak = 0
  while (days.has(fmt(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

export default function Home() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('Spotter')
  const [xp, setXp] = useState(0)
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([])
  const [community, setCommunity] = useState<CommunityStats | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [streak, setStreak] = useState(0)
  const [cityRank, setCityRank] = useState<CityRank | null | undefined>(
    undefined,
  )
  const [now, setNow] = useState(() => Date.now())

  // 1 Hz tick — feeds the Motorsport countdown frieze.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Live community stats — refresh every 60s while on the home tab so
  // the "passionnés en ligne" micro-stat stays warm.
  useEffect(() => {
    let active = true
    const refresh = async () => {
      const { data } = await supabase.rpc('home_community_stats').maybeSingle()
      if (active && data) setCommunity(data as CommunityStats)
    }
    const t = setInterval(refresh, 60_000)
    return () => {
      active = false
      clearInterval(t)
    }
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const [profRes, xpRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('pseudo, title, ville')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase.rpc('my_xp'),
      ])
      if (!active) return

      const pseudo =
        (profRes.data?.pseudo as string | undefined)?.trim() ||
        (user.email ? user.email.split('@')[0] : 'Spotter')
      setName(pseudo)
      setTitle((profRes.data?.title as string | undefined)?.trim() || null)
      setXp((xpRes.data as number | null) ?? 0)
      setLoading(false)

      // Decoupled secondary fetches — none block the cockpit's first paint.
      fetchActiveChallenges().then((c) => {
        if (active) setChallenges(c)
      })
      fetchLiveEvents().then((evs) => {
        if (active) setLiveEvents(evs)
      })
      supabase
        .rpc('home_community_stats')
        .maybeSingle()
        .then(({ data }) => {
          if (active) setCommunity((data as CommunityStats | null) ?? null)
        })

      // Streak — consecutive spotting days (from the user's recent spots).
      supabase
        .from('spots')
        .select('created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200)
        .then(({ data }) => {
          if (!active) return
          const rows = (data ?? []) as { created_at: string }[]
          setStreak(computeStreak(rows.map((r) => r.created_at)))
        })

      // City ranking — drives the "🏆 Classement <ville>" card. Uses the
      // city_leaderboard RPC (sorted by XP desc) to derive my rank, the
      // number of spotters and the XP gap to the rank just above me.
      const ville =
        (profRes.data?.ville as string | undefined)?.trim() || ''
      if (!ville) {
        if (active) setCityRank(null)
      } else {
        supabase
          .rpc('city_leaderboard', { p_city: ville, p_limit: 500 })
          .then(({ data }) => {
            if (!active) return
            const rows = (data ?? []) as CityRow[]
            const idx = rows.findIndex((r) => r.user_id === user.id)
            if (idx < 0) {
              setCityRank({
                city: ville,
                rank: 0,
                total: rows.length,
                gapToAbove: 0,
                abovePseudo: null,
                progressToNext: 0,
              })
            } else {
              const above = idx > 0 ? rows[idx - 1] : null
              setCityRank({
                city: ville,
                rank: idx + 1,
                total: rows.length,
                gapToAbove: above ? Math.max(0, above.xp - rows[idx].xp) : 0,
                abovePseudo: above?.pseudo ?? null,
                progressToNext: above
                  ? Math.min(1, rows[idx].xp / Math.max(1, above.xp))
                  : 1,
              })
            }
          })
      }
    })()
    return () => {
      active = false
    }
  }, [])

  const lvl = xpLevel(xp)
  // In-tier XP numbers for the "x / y XP" micro-stat, derived from the
  // ladder thresholds (xpLevel only exposes pct + toNext).
  const tier =
    XP_LADDER.find((t) => t.max === null || xp < t.max) ?? XP_LADDER[0]
  const inTier = Math.max(0, Math.floor(xp) - tier.min)
  const tierSpan = tier.max == null ? inTier : tier.max - tier.min

  const upcomingGp = GP_2026.find((g) => new Date(g.date).getTime() >= now)
  const gpDiff = upcomingGp ? new Date(upcomingGp.date).getTime() - now : 0
  // Only surface the GP frieze when the race is within the next 7 days.
  const nextGp = upcomingGp && gpDiff <= 7 * 86_400_000 ? upcomingGp : null

  if (loading) {
    return (
      <div className="min-h-screen bg-bg px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between pt-3 pb-5">
          <Skeleton className="h-3 w-40 rounded-full" />
          <Skeleton className="h-3 w-20 rounded-full" />
        </div>
        <Skeleton className="h-[420px] w-full rounded-[36px]" />
        <div className="mt-12 space-y-12">
          <Skeleton className="h-16 w-full rounded-3xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-bg px-5 pb-12 pt-[max(0.75rem,env(safe-area-inset-top))] text-fg">
      {/* ─── 1 · MICRO-STATS — fluid, box-less, straight on the page ─── */}
      <div className="flex items-center justify-between px-1 pb-3 pt-2">
        <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-fg/70">
          <span className="relative flex h-2 w-2 flex-none" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="tabular-nums">{community?.online_now ?? 0}</span>
          <span className="text-fg/45">passionnés en ligne</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-fg/70">
          <span aria-hidden>🎯</span>
          {lvl.isMax ? (
            <span className="font-bold tracking-wide text-fg/80">MAX</span>
          ) : (
            <>
              <span className="tabular-nums">{inTier}</span>
              <span className="text-fg/40">/ {tierSpan} XP</span>
            </>
          )}
        </span>
      </div>

      {/* ─── STREAK PILL — visible red badge above the cockpit ─── */}
      {streak > 0 && (
        <div className="mb-3 flex px-1">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-bold"
            style={{
              background: 'rgba(232,32,58,0.16)',
              color: '#FF7080',
              border: '1px solid rgba(232,32,58,0.40)',
            }}
          >
            🔥 {streak} jour{streak > 1 ? 's' : ''} de streak
          </span>
        </div>
      )}

      {/* ─── 2 · THE GIGA COCKPIT WIDGET ─── */}
      <CockpitWidget
        name={name}
        xp={xp}
        title={title}
        challenges={challenges}
        onChallenges={() => navigate('/challenges')}
      />

      {/* LIVE EVENTS — kept as a conditional safety surface; only renders
          while a meet is actually broadcasting. */}
      {liveEvents.length > 0 && (
        <div className="mt-6 space-y-2">
          {liveEvents.slice(0, 2).map((ev) => (
            <button
              key={ev.id}
              onClick={() => navigate(`/event/${ev.id}/live`)}
              className="relative w-full overflow-hidden rounded-2xl border border-red-500/40 bg-gradient-to-r from-red-600/25 via-red-500/10 to-card p-4 text-left transition-transform active:scale-[0.99]"
            >
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3 flex-none">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white">
                      LIVE
                    </span>
                    <span className="truncate font-display text-base font-bold text-fg">
                      {ev.title}
                    </span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-fg/60">
                    {ev.location} · {ev.spot_count} spot
                    {ev.spot_count > 1 ? 's' : ''}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 flex-none text-fg/40" />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ─── 3 · COMPLÉMENTS — city ranking first (personal), then GP ─── */}
      <div className="mt-10 space-y-4">
        <CityRankCard
          rank={cityRank}
          onTap={() => navigate('/classement')}
          onSetCity={() => navigate('/settings')}
        />

        {nextGp && (
          <GpCountdownCard
            flag={nextGp.flag}
            name={nextGp.name}
            circuit={nextGp.circuit}
            gpDiff={gpDiff}
            onTap={() => navigate(`/f1/${nextGp.round}`)}
          />
        )}
      </div>
    </div>
  )
}

// ───────────────────────────── COCKPIT WIDGET ─────────────────────────────

/** The monolithic top-of-app container. Three stacked zones: identity,
 *  the RPM challenge gauges, and the scan action. Rendered as theme-aware
 *  "jet glass" — near-black satin at night, alabaster frost by day — so a
 *  single surface anchors the whole cockpit while honouring the dual
 *  theme (deep shadow in the dark, soft vaporous shadow in the light). */
function CockpitWidget({
  name,
  xp,
  title,
  challenges,
  onChallenges,
}: {
  name: string
  xp: number
  title: string | null
  challenges: Challenge[]
  onChallenges: () => void
}) {
  return (
    <section
      className="home-section-enter relative overflow-hidden"
      style={{
        borderRadius: '36px',
        background: 'var(--color-glass-strong)',
        border: '1px solid rgb(var(--color-fg) / 0.06)',
        backdropFilter: 'saturate(160%) blur(26px)',
        WebkitBackdropFilter: 'saturate(160%) blur(26px)',
        boxShadow:
          '0 30px 70px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgb(var(--color-fg) / 0.07)',
        padding: '22px 22px 26px',
      }}
    >
      {/* Soft top-left sheen for depth — invariant white glint, low alpha. */}
      <span
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          top: '-40px',
          left: '-30px',
          width: '180px',
          height: '180px',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.05)',
          filter: 'blur(40px)',
        }}
      />

      {/* — Zone A · IDENTITY — */}
      {/* Settings gear intentionally removed here (2026-06-05): account
          configuration is centralised on the Profile tab's header gear. */}
      <div className="relative min-w-0">
        <h1
          className="font-display font-extrabold tracking-tighter text-fg"
          style={{ fontSize: '30px', lineHeight: 1, letterSpacing: '-0.03em' }}
        >
          Bonjour {name}
        </h1>
        <div className="mt-2.5">
          <TitleChip xp={xp} title={title} size="sm" />
        </div>
      </div>

      {/* — Zone B · RPM CHALLENGE GAUGES — */}
      <RpmGauges challenges={challenges} onTap={onChallenges} />

      {/* — Zone C · SPOTTER (native camera) — */}
      <SpotterAction />
    </section>
  )
}

// ─────────────────────────────── RPM GAUGES ───────────────────────────────

// Mini-speedometer geometry (100×100 box, 270° arc with a bottom gap).
// t in [0,1] maps the arc from −135° (bottom-left) to +135° (bottom-right)
// measured from the top, clockwise. Pure constants — safe at module scope.
const M_CX = 50
const M_CY = 50
const M_R = 40
const M_TICKS = 45
function mPoint(t: number, r: number) {
  const deg = -135 + t * 270
  const a = (deg * Math.PI) / 180
  return { x: M_CX + r * Math.sin(a), y: M_CY - r * Math.cos(a) }
}
function mArc(t0: number, t1: number, r: number): string {
  const s = mPoint(t0, r)
  const e = mPoint(t1, r)
  const large = t1 - t0 > 0.5 ? 1 : 0
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
}
// Fixed colour per gauge position + a subtle carbon-fibre disc texture.
const GAUGE_COLORS = ['#E8203A', '#F0C040', '#4DA6FF']
const CARBON =
  'repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,0.035) 0px, rgba(255,255,255,0.035) 1px, transparent 1px, transparent 3px), #0d0d0d'

/** One 100px supercar-dashboard speedometer. The needle, progress arc and
 *  centre number are all driven by a JS spring tween that sweeps from 0 to
 *  the real % over ~1s on mount (and on any later value change). */
function MiniSpeedometer({
  pct,
  color,
  done,
}: {
  pct: number
  color: string
  done: boolean
}) {
  const [disp, setDisp] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const to = pct
    const start = performance.now()
    const dur = 1000
    let raf = 0
    const easeOutBack = (k: number) => {
      const c = 1.70158
      return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2)
    }
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / dur)
      const v = from + (to - from) * easeOutBack(k)
      fromRef.current = v
      setDisp(v)
      if (k < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pct])

  const t = Math.max(0, Math.min(1, disp / 100))
  const arcColor = done ? '#22C55E' : color
  const needleDeg = -135 + t * 270

  return (
    <div className="relative" style={{ width: 100, height: 100 }}>
      <div
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{ background: CARBON, border: '1px solid rgba(255,255,255,0.05)' }}
      />
      <svg viewBox="0 0 100 100" width="100" height="100" className="absolute inset-0">
        {Array.from({ length: M_TICKS }).map((_, i) => {
          const tt = i / (M_TICKS - 1)
          const major = i % 11 === 0
          const inner = mPoint(tt, M_R - (major ? 7 : 4))
          const outer = mPoint(tt, M_R)
          return (
            <line
              key={i}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="#3a3a3a"
              strokeWidth={major ? 1.2 : 0.7}
              strokeLinecap="round"
            />
          )
        })}
        {[0, 1, 2, 3, 4].map((m) => {
          const p = mPoint(m / 4, M_R - 13)
          return (
            <text
              key={m}
              x={p.x}
              y={p.y}
              fill="#9a9a9a"
              fontSize="6"
              fontWeight="700"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {m * 25}
            </text>
          )
        })}
        <path
          d={mArc(0, 1, M_R)}
          fill="none"
          stroke="#2a2a2a"
          strokeWidth={4}
          strokeLinecap="round"
        />
        {t > 0.002 && (
          <path
            d={mArc(0, t, M_R)}
            fill="none"
            stroke={arcColor}
            strokeWidth={4}
            strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${arcColor})` }}
          />
        )}
      </svg>

      {/* Needle (HTML) — driven each frame by the tween, no CSS transition. */}
      <div className="absolute" style={{ left: '50%', top: '50%' }}>
        <div
          style={{
            position: 'absolute',
            left: '-0.75px',
            bottom: '0px',
            width: '1.5px',
            height: `${M_R - 6}px`,
            background: '#E8203A',
            borderRadius: '1px',
            transformOrigin: 'bottom center',
            transform: `rotate(${needleDeg}deg)`,
          }}
        />
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{
            left: '-3px',
            top: '-3px',
            width: '6px',
            height: '6px',
            background: '#E8203A',
            boxShadow: '0 0 6px rgba(232,32,58,0.9)',
          }}
        />
      </div>

      {/* Centre percentage */}
      <span
        className="absolute font-display font-extrabold text-white"
        style={{
          left: 0,
          right: 0,
          top: '56px',
          textAlign: 'center',
          fontSize: '14px',
        }}
      >
        {Math.round(Math.max(0, Math.min(100, disp)))}%
      </span>
    </div>
  )
}

// Local emoji + colour for a challenge, derived from its type / category /
// brand — no catalogue change, no API. Keeps the adaptive challenge text
// while giving each a distinctive dashboard identity.
function challengeStyle(c: Challenge): { emoji: string; color: string } {
  const cat = (c.target_category ?? '').toLowerCase()
  if (c.type === 'spot_brand' || c.target_brand)
    return { emoji: '⚙️', color: '#3B82F6' }
  if (cat.includes('hypercar')) return { emoji: '👑', color: '#9B59B6' }
  if (cat.includes('supercar')) return { emoji: '🏎️', color: '#E8203A' }
  if (cat.includes('jdm')) return { emoji: '🏁', color: '#FF6B00' }
  if (cat.includes('classic') || cat.includes('youngtimer'))
    return { emoji: '🏁', color: '#F5C518' }
  if (c.type === 'spot_count') return { emoji: '🔥', color: '#E8203A' }
  return { emoji: '🎯', color: '#E8203A' }
}

/** Dashboard speedometer bound to the user's REAL adaptive weekly
 *  challenges (get_my_weekly_challenges — migrations 0042/0043): their
 *  titles, live progress, and a locally-derived emoji/colour. The list
 *  bars fill from the same live progress. Tap → /challenges. */
function RpmGauges({
  challenges,
  onTap,
}: {
  challenges: Challenge[]
  onTap: () => void
}) {
  // Up to three real challenges drive the gauge + the list below.
  const slots = challenges.slice(0, 3).map((c) => {
    const st = challengeStyle(c)
    return {
      label: c.title,
      emoji: st.emoji,
      color: st.color,
      pct: Math.min(100, Math.max(0, computeChallengePct(c))),
      done: c.claimed || c.completed,
      progress: Math.min(c.progress, c.target_value),
      target: c.target_value,
    }
  })

  return (
    <div className="mt-3 flex w-full items-start justify-between gap-2">
      {slots.map((s, i) => {
        const color = GAUGE_COLORS[i % GAUGE_COLORS.length]
        const counterCol = s.done ? '#22C55E' : color
        return (
          <button
            key={s.label}
            onClick={onTap}
            aria-label={s.label}
            className="tappable flex min-w-0 flex-1 flex-col items-center"
          >
            <MiniSpeedometer pct={s.pct} color={color} done={s.done} />
            <span aria-hidden className="mt-2" style={{ fontSize: '20px', lineHeight: 1 }}>
              {s.emoji}
            </span>
            <span
              className="mt-1 line-clamp-2 text-center font-semibold text-white"
              style={{ fontSize: '11px', lineHeight: 1.2 }}
            >
              {s.label}
            </span>
            <span
              className="mt-0.5 tabular-nums font-extrabold"
              style={{ fontSize: '12px', color: counterCol }}
            >
              {s.progress}/{s.target}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ─────────────────────────────── SPOTTER ───────────────────────────────

/** Centered premium "SPOTTER" CTA with a holographic capture ring. The
 *  hidden file input carries capture="environment", and we click it
 *  synchronously inside the tap gesture — that's the iOS requirement for
 *  the native camera to open instantly. The captured photo is stashed
 *  (pendingPhoto) and NewSpot consumes it on mount. */
function SpotterAction() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  function onCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return // user backed out of the camera
    setPendingPhoto(file)
    navigate('/new-spot')
  }

  return (
    <div className="mt-6 flex justify-center">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onCapture}
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        className="tappable inline-flex items-center gap-3 rounded-full"
        style={{
          padding: '12px 28px 12px 14px',
          background:
            'linear-gradient(135deg, #FF3B52 0%, #E8203A 58%, #C7172A 100%)',
          // Tight neon halo (replaces the diffuse 32px drop) for a
          // premium, minimalist red glow. Inset highlights kept.
          boxShadow:
            '0 0 15px rgba(239,68,68,0.5), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -2px 6px rgba(0,0,0,0.25)',
        }}
        aria-label="Spotter une voiture — ouvrir la caméra"
      >
        {/* Holo capture ring — two ambient ping rings + bright core. */}
        <span
          className="relative flex h-7 w-7 flex-none items-center justify-center"
          aria-hidden
        >
          <span
            className="absolute inset-0 animate-ping rounded-full"
            style={{
              border: '1.5px solid rgba(255,255,255,0.55)',
              animationDuration: '2.4s',
            }}
          />
          <span
            className="absolute animate-ping rounded-full"
            style={{
              inset: '5px',
              border: '1.5px solid rgba(255,255,255,0.35)',
              animationDuration: '2s',
              animationDelay: '0.3s',
            }}
          />
          <span
            className="relative h-2.5 w-2.5 rounded-full bg-white"
            style={{ boxShadow: '0 0 10px rgba(255,255,255,0.85)' }}
          />
        </span>
        <span
          className="font-display font-extrabold uppercase text-white"
          style={{ fontSize: '14px', letterSpacing: '0.14em' }}
        >
          Spotter
        </span>
      </button>
    </div>
  )
}

// ──────────────────────── GP COUNTDOWN CARD ────────────────────────

/** A proper #141414 card for the next Grand Prix: country flag, GP name,
 *  a large red "Dans Xj Xh Xm" countdown and a progress bar that fills as
 *  race day approaches (14-day perceptual window). */
function GpCountdownCard({
  flag,
  name,
  circuit,
  gpDiff,
  onTap,
}: {
  flag: string
  name: string
  circuit: string
  gpDiff: number
  onTap: () => void
}) {
  const cd = {
    d: Math.max(0, Math.floor(gpDiff / 86400000)),
    h: Math.max(0, Math.floor((gpDiff % 86400000) / 3600000)),
    m: Math.max(0, Math.floor((gpDiff % 3600000) / 60000)),
  }
  const blocks = [
    { v: String(cd.d), label: 'JOURS' },
    { v: String(cd.h).padStart(2, '0'), label: 'HEURES' },
    { v: String(cd.m).padStart(2, '0'), label: 'MINUTES' },
  ]

  return (
    <button
      onClick={onTap}
      className="home-section-enter tappable relative block w-full overflow-hidden rounded-2xl p-4 pb-6 text-left transition-transform active:scale-[0.99]"
      style={{
        background:
          'repeating-linear-gradient(45deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 5px), #141414',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 8px 22px rgba(0,0,0,0.45)',
      }}
      aria-label={`Grand Prix — ${name}`}
    >
      {/* Top — big flag + GP name + red F1 pill */}
      <div className="flex items-center gap-2.5">
        <span aria-hidden style={{ fontSize: '24px', lineHeight: 1 }}>
          {flag}
        </span>
        <p className="min-w-0 flex-1 truncate text-[17px] font-bold text-white">
          {name}
        </p>
        <span
          className="flex-none rounded-full px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-white"
          style={{ background: '#E8203A', letterSpacing: '0.08em' }}
        >
          F1
        </span>
      </div>

      {/* Circuit — grey italic */}
      <p className="mt-1 truncate text-[12px] italic text-white/45">{circuit}</p>

      {/* Countdown — three F1-style square blocks with red separators */}
      {gpDiff > 0 ? (
        <div className="mt-3.5 flex items-stretch gap-2">
          {blocks.map((b, i) => (
            <div key={b.label} className="flex flex-1 items-stretch gap-2">
              <div
                className="flex flex-1 flex-col items-center justify-center rounded-lg py-2"
                style={{ background: '#0d0d0d' }}
              >
                <span
                  className="font-display font-extrabold leading-none text-white tabular-nums"
                  style={{ fontSize: '24px' }}
                >
                  {b.v}
                </span>
                <span
                  className="mt-1 font-bold uppercase text-white/40"
                  style={{ fontSize: '9px', letterSpacing: '0.1em' }}
                >
                  {b.label}
                </span>
              </div>
              {i < blocks.length - 1 && (
                <span
                  aria-hidden
                  className="flex items-center font-display font-extrabold"
                  style={{ fontSize: '22px', color: '#E8203A' }}
                >
                  :
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p
          className="mt-3.5 font-display font-extrabold"
          style={{ fontSize: '22px', color: '#E8203A' }}
        >
          En cours !
        </p>
      )}

      {/* Simplified circuit schematic — thin red lines, F1-logo style */}
      <svg
        aria-hidden
        viewBox="0 0 120 34"
        className="mt-4 w-full"
        style={{ height: 34, opacity: 0.6 }}
        fill="none"
      >
        <path
          d="M8 24 C 2 12, 16 4, 30 8 C 40 11, 38 20, 50 21 C 64 22, 66 8, 82 9 C 98 10, 104 6, 112 12 C 118 17, 110 26, 96 25 C 74 23, 64 29, 44 28 C 26 27, 16 31, 8 24 Z"
          stroke="#E8203A"
          strokeWidth={1.4}
          strokeLinecap="round"
        />
      </svg>

      {/* Fine red line flush at the very bottom of the card */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[2px]"
        style={{ background: '#E8203A', boxShadow: '0 0 8px rgba(232,32,58,0.6)' }}
      />
    </button>
  )
}

// ──────────────────────── CITY RANK CARD ────────────────────────

/** "🏆 Classement <ville>" — the user's current position in their city,
 *  the number of spotters, and the XP gap to the rank just above (a clear
 *  nudge to keep spotting). First place gets a "👑 Tu domines" hero line.
 *  When the profile has no city, it invites the user to set one. */
function CityRankCard({
  rank,
  onTap,
  onSetCity,
}: {
  rank: CityRank | null | undefined
  onTap: () => void
  onSetCity: () => void
}) {
  if (rank === undefined) return null // still loading — no flash

  const cardStyle = {
    background: '#141414',
    border: '1px solid rgba(255,255,255,0.06)',
    boxShadow: '0 8px 22px rgba(0,0,0,0.45)',
  }

  // No city set → invite to add one.
  if (!rank) {
    return (
      <section className="home-section-enter">
        <button
          onClick={onSetCity}
          className="tappable flex w-full items-center justify-between gap-3 rounded-2xl p-4 text-left transition-transform active:scale-[0.99]"
          style={cardStyle}
        >
          <p className="text-sm font-medium text-white/80">
            🏆 Ajoute ta ville pour voir ton classement
          </p>
          <ChevronRight className="h-5 w-5 flex-none text-white/30" />
        </button>
      </section>
    )
  }

  const isFirst = rank.rank === 1
  const inRanking = rank.rank > 0

  return (
    <section className="home-section-enter">
      <button
        onClick={onTap}
        className="tappable relative block w-full overflow-hidden rounded-2xl py-4 pl-5 pr-4 text-left transition-transform active:scale-[0.99]"
        style={cardStyle}
      >
        {/* 3px gold gradient left border */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0"
          style={{
            width: '3px',
            background: 'linear-gradient(180deg, #C8A96E 0%, transparent 100%)',
          }}
        />
        {/* Discreet podium backdrop */}
        <svg
          aria-hidden
          viewBox="0 0 60 40"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2"
          style={{ width: 72, height: 48, opacity: 0.06 }}
        >
          <rect x="2" y="20" width="16" height="20" rx="1" fill="#fff" />
          <rect x="22" y="8" width="16" height="32" rx="1" fill="#fff" />
          <rect x="42" y="26" width="16" height="14" rx="1" fill="#fff" />
        </svg>

        <div className="relative flex items-center">
          <span className="flex-1 text-[14px] font-bold text-white">
            🏆 Classement
          </span>
          <span
            className="text-[14px] font-extrabold"
            style={{ color: '#E8203A' }}
          >
            {rank.city}
          </span>
        </div>

        {isFirst ? (
          <>
            <p
              className="relative mt-1 font-display font-extrabold italic leading-none text-white"
              style={{ fontSize: '64px', letterSpacing: '-0.04em' }}
            >
              #1
            </p>
            <p
              className="relative mt-2 text-[14px] font-bold"
              style={{ color: '#C8A96E' }}
            >
              👑 Tu domines {rank.city} !
            </p>
          </>
        ) : inRanking ? (
          <>
            <p
              className="relative mt-1 font-display font-extrabold italic leading-none text-white"
              style={{ fontSize: '64px', letterSpacing: '-0.04em' }}
            >
              #{rank.rank}
            </p>
            <p className="relative mt-2 text-[13px] text-white/55">
              encore{' '}
              <span className="font-bold text-white">{rank.gapToAbove} XP</span>{' '}
              pour dépasser{' '}
              <span className="font-semibold text-white">
                {rank.abovePseudo ?? `#${rank.rank - 1}`}
              </span>
            </p>
            <div
              className="relative mt-2.5 h-1 w-full overflow-hidden rounded-full"
              style={{ background: 'rgba(255,255,255,0.10)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.round(rank.progressToNext * 100)}%`,
                  background: '#E8203A',
                  transition: 'width 800ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              />
            </div>
          </>
        ) : (
          <p className="relative mt-3 text-[13px] text-white/65">
            Spotte pour entrer dans le classement de {rank.city}.
          </p>
        )}

        <p className="relative mt-2 text-right text-[11px] font-medium text-white/35">
          {rank.total} spotter{rank.total > 1 ? 's' : ''}
        </p>
      </button>
    </section>
  )
}
