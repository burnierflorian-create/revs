import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { setPendingPhoto } from '../lib/pendingPhoto'
import { xpLevel } from '../lib/xp'
import { GP_2026 } from '../lib/f1'
import { circuitPath, CIRCUIT_VIEWBOX } from '../lib/circuits'
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

// Time-of-day greeting from the device's local hour.
function greetingFor(name: string): string {
  const h = new Date().getHours()
  if (h >= 23 || h < 12) return h >= 23 ? `Bonne nuit ${name}` : `Bonjour ${name}`
  if (h < 18) return `Bon après-midi ${name}`
  return `Bonsoir ${name}`
}

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
  const [spotsThisWeek, setSpotsThisWeek] = useState(0)
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
          const weekAgo = Date.now() - 7 * 86_400_000
          setSpotsThisWeek(
            rows.filter((r) => new Date(r.created_at).getTime() >= weekAgo)
              .length,
          )
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

  const upcomingGp = GP_2026.find((g) => new Date(g.date).getTime() >= now)
  const gpDiff = upcomingGp ? new Date(upcomingGp.date).getTime() - now : 0
  const daysToNextGp = upcomingGp
    ? Math.max(0, Math.ceil(gpDiff / 86_400_000))
    : null
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
        <button
          onClick={() => navigate('/profile')}
          className="tappable inline-flex items-center gap-1.5"
          style={{
            background: '#141414',
            borderRadius: '20px',
            padding: '6px 12px',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
          aria-label="Voir mon profil"
        >
          <span aria-hidden style={{ fontSize: '13px' }}>🎯</span>
          <span
            className="font-bold"
            style={{ fontSize: '12px', color: '#E8203A' }}
          >
            {lvl.name}
          </span>
          <span className="text-white/30" style={{ fontSize: '12px' }}>·</span>
          <span
            className="font-extrabold tabular-nums text-white"
            style={{ fontSize: '12px' }}
          >
            {new Intl.NumberFormat('fr-FR').format(Math.floor(xp))} XP
          </span>
        </button>
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
          daysToNextGp={daysToNextGp}
          spotsThisWeek={spotsThisWeek}
          onTap={() => navigate('/classement')}
          onSetCity={() => navigate('/settings')}
        />

        {nextGp && (
          <GpCountdownCard
            round={nextGp.round}
            flag={nextGp.flag}
            name={nextGp.name}
            circuit={nextGp.circuit}
            gpDiff={gpDiff}
            lastWinner={nextGp.winners?.[0]?.driver ?? null}
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
          {greetingFor(name)}
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

// Mini-speedometer geometry — 110×110 box, 270° sweep with a bottom gap.
// t in [0,1] maps the arc from −135° (bottom-left, t=0) through 0° (top,
// t=0.5) to +135° (bottom-right, t=1), measured clockwise from the top.
const S_BOX = 110
const S_CX = 55
const S_CY = 55
const S_R_TICK = 48 // outer radius of the tick ring
const S_NEEDLE = 41 // needle length (~85% of tick radius)
function sPoint(t: number, r: number) {
  const a = ((-135 + t * 270) * Math.PI) / 180
  return { x: S_CX + r * Math.sin(a), y: S_CY - r * Math.cos(a) }
}
function sArc(t0: number, t1: number, r: number): string {
  const s = sPoint(t0, r)
  const e = sPoint(t1, r)
  const large = t1 - t0 > 0.5 ? 1 : 0
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
}
// Fixed colour per gauge position (gauge index → accent).
const GAUGE_COLORS = ['#E8203A', '#F0C040', '#4DA6FF']

/** One 110px supercar-dashboard speedometer: brushed-metal frame, radial
 *  black face, 60-tick scale with a red danger zone, and a thin gradient
 *  needle that sweeps from −135° to the live % over 1.2s (ease-out). */
function MiniSpeedometer({ pct, done }: { pct: number; done: boolean }) {
  const uid = useId().replace(/:/g, '')
  const [disp, setDisp] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    const to = pct
    const start = performance.now()
    const dur = 1200
    let raf = 0
    const easeOut = (k: number) => 1 - Math.pow(1 - k, 3)
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / dur)
      const v = from + (to - from) * easeOut(k)
      fromRef.current = v
      setDisp(v)
      if (k < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pct])

  const t = Math.max(0, Math.min(1, disp / 100))
  const needleDeg = -135 + t * 270

  return (
    <div
      className="relative"
      style={{
        width: S_BOX,
        height: S_BOX,
        filter: 'drop-shadow(0 4px 20px rgba(0,0,0,0.8))',
      }}
    >
      <svg
        viewBox={`0 0 ${S_BOX} ${S_BOX}`}
        width={S_BOX}
        height={S_BOX}
        className="absolute inset-0"
      >
        <defs>
          <radialGradient id={`face-${uid}`} cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor="#0a0a0a" />
            <stop offset="100%" stopColor="#1a1a1a" />
          </radialGradient>
          <linearGradient id={`frame-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#333" />
            <stop offset="50%" stopColor="#555" />
            <stop offset="100%" stopColor="#333" />
          </linearGradient>
        </defs>

        {/* Black radial face */}
        <circle cx={S_CX} cy={S_CY} r={51} fill={`url(#face-${uid})`} />
        {/* Brushed-metal outer frame */}
        <circle
          cx={S_CX}
          cy={S_CY}
          r={52}
          fill="none"
          stroke={`url(#frame-${uid})`}
          strokeWidth={2}
        />
        {/* Soft reflection arc across the top */}
        <path
          d={sArc(0.33, 0.67, 46)}
          fill="none"
          stroke="rgba(255,255,255,0.04)"
          strokeWidth={6}
          strokeLinecap="round"
        />
        {/* Red danger zone — last 20% (80→100) */}
        <path
          d={sArc(0.8, 1, S_R_TICK - 2)}
          fill="none"
          stroke="#E8203A"
          strokeOpacity={0.15}
          strokeWidth={6}
        />
        {/* 60-tick scale: long at 0/25/50/75/100, medium every 25%, short else */}
        {Array.from({ length: 61 }).map((_, i) => {
          const tt = i / 60
          const isLong = i % 15 === 0
          const isMed = !isLong && i % 5 === 0
          const len = isLong ? 9 : isMed ? 6 : 3
          const outer = sPoint(tt, S_R_TICK)
          const inner = sPoint(tt, S_R_TICK - len)
          return (
            <line
              key={i}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke={isLong ? '#cfcfcf' : isMed ? '#8a8a8a' : '#555'}
              strokeWidth={isLong ? 1.4 : isMed ? 1 : 0.7}
              strokeLinecap="round"
            />
          )
        })}
        {/* Key numbers */}
        {[0, 1, 2, 3, 4].map((m) => {
          const p = sPoint(m / 4, S_R_TICK - 17)
          return (
            <text
              key={m}
              x={p.x}
              y={p.y}
              fill="#ffffff"
              fontSize="7"
              fontWeight="700"
              textAnchor="middle"
              dominantBaseline="central"
            >
              {m * 25}
            </text>
          )
        })}
      </svg>

      {/* Needle (HTML) — thin red gradient, driven each frame by the tween */}
      <div className="absolute" style={{ left: '50%', top: '50%' }}>
        <div
          style={{
            position: 'absolute',
            left: '-0.5px',
            bottom: '0px',
            width: '1px',
            height: `${S_NEEDLE}px`,
            background: 'linear-gradient(to top, #E8203A 0%, #ff6b6b 100%)',
            borderRadius: '1px',
            transformOrigin: 'bottom center',
            transform: `rotate(${needleDeg}deg)`,
          }}
        />
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{
            left: '-2.5px',
            top: '-2.5px',
            width: '5px',
            height: '5px',
            background: '#E8203A',
            boxShadow: '0 0 8px rgba(232,32,58,0.95)',
          }}
        />
      </div>

      {/* Centre hub + live percentage */}
      <div
        className="absolute flex items-center justify-center rounded-full"
        style={{
          left: '50%',
          top: '50%',
          width: 32,
          height: 32,
          transform: 'translate(-50%, -50%)',
          background: '#000',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <span
          className="font-display tabular-nums text-white"
          style={{ fontSize: '13px', fontWeight: 800, color: done ? '#22C55E' : '#fff' }}
        >
          {Math.round(Math.max(0, Math.min(100, disp)))}
        </span>
      </div>
    </div>
  )
}

// Local emoji + colour for a challenge, derived by reading its title /
// brand / category — no catalogue change, no API. Brand-specific emojis
// take priority (a Ferrari challenge gets 🐴, a McLaren one 🧡, …), then
// fall back to type/category (hypercar 🚀, supercar 🏎️, streak 🔥, …).
function challengeStyle(c: Challenge): { emoji: string; color: string } {
  const hay = [c.title ?? '', c.target_brand ?? '', c.target_category ?? '']
    .join(' ')
    .toLowerCase()
  const has = (...ks: string[]) => ks.some((k) => hay.includes(k))

  // Brand-specific (most distinctive) first.
  if (has('ferrari')) return { emoji: '🐴', color: '#E8203A' }
  if (has('lamborghini', 'lambo')) return { emoji: '🐂', color: '#F0C040' }
  if (has('mclaren')) return { emoji: '🧡', color: '#FF6B00' }
  if (has('porsche')) return { emoji: '🐎', color: '#F5C518' }
  if (has('mercedes', 'amg')) return { emoji: '⭐', color: '#4DA6FF' }
  if (has('bmw')) return { emoji: '🔵', color: '#3B82F6' }
  if (has('audi')) return { emoji: '💎', color: '#4DA6FF' }
  if (has('rolls-royce', 'rolls royce', 'rolls')) return { emoji: '👑', color: '#C8A96E' }

  // Type / category.
  if (has('jdm', 'japon')) return { emoji: '🎌', color: '#FF6B00' }
  if (has('électrique', 'electrique', 'electric', 'ev ')) return { emoji: '⚡', color: '#22C55E' }
  if (has('hypercar')) return { emoji: '🚀', color: '#9B59B6' }
  if (has('supercar')) return { emoji: '🏎️', color: '#E8203A' }
  if (has('streak', 'série', 'serie', 'jours', 'régularité', "d'affilée")) return { emoji: '🔥', color: '#E8203A' }
  if (has('marque', 'différent', 'differ', 'variété', 'variete')) return { emoji: '🎯', color: '#E8203A' }
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
            <MiniSpeedometer pct={s.pct} done={s.done} />
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
  round,
  flag,
  name,
  circuit,
  gpDiff,
  lastWinner,
  onTap,
}: {
  round: number
  flag: string
  name: string
  circuit: string
  gpDiff: number
  lastWinner: string | null
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
          'repeating-linear-gradient(45deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 5px), #141414',
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
                className="flex flex-1 flex-col items-center justify-center py-2.5"
                style={{ background: '#0d0d0d', borderRadius: '10px' }}
              >
                <span
                  className="font-display font-extrabold leading-none text-white tabular-nums"
                  style={{ fontSize: '28px' }}
                >
                  {b.v}
                </span>
                <span
                  className="mt-1 font-bold uppercase text-white/40"
                  style={{ fontSize: '10px', letterSpacing: '0.1em' }}
                >
                  {b.label}
                </span>
              </div>
              {i < blocks.length - 1 && (
                <span
                  aria-hidden
                  className="flex items-center font-display font-extrabold"
                  style={{ fontSize: '18px', color: '#E8203A' }}
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

      {/* Real(istic) circuit silhouette — stylised per-track SVG */}
      <svg
        aria-hidden
        viewBox={CIRCUIT_VIEWBOX}
        preserveAspectRatio="xMidYMid meet"
        className="mt-4 w-full"
        style={{ height: 60 }}
        fill="none"
      >
        <path
          d={circuitPath(round)}
          stroke="#E8203A"
          strokeOpacity={0.7}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      {/* Contextual info line under the circuit */}
      <p className="mt-2 text-[11px] text-white/45">
        🏁 Course dans {cd.d} jour{cd.d > 1 ? 's' : ''}
        {lastWinner && ` · Dernier vainqueur : ${lastWinner}`}
      </p>

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
  daysToNextGp,
  spotsThisWeek,
  onTap,
  onSetCity,
}: {
  rank: CityRank | null | undefined
  daysToNextGp: number | null
  spotsThisWeek: number
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
        {/* Soft golden glow at the centre (replaces the podium SVG) */}
        {isFirst && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(circle at 50% 50%, rgba(200,169,110,0.06) 0%, transparent 60%)',
            }}
          />
        )}

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
          <div className="relative flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p
                className="font-display italic leading-none text-white"
                style={{
                  fontSize: '48px',
                  fontWeight: 900,
                  letterSpacing: '-0.04em',
                  textShadow: '0 0 30px rgba(200,169,110,0.3)',
                }}
              >
                #1
              </p>
              <p
                className="mt-2 text-[14px] font-bold"
                style={{ color: '#C8A96E' }}
              >
                👑 Tu domines {rank.city} !
              </p>
              <p className="mt-1.5 text-[11px] text-white/40">
                {daysToNextGp != null && `Prochain GP dans ${daysToNextGp} jour${daysToNextGp > 1 ? 's' : ''} · `}
                {spotsThisWeek} spot{spotsThisWeek > 1 ? 's' : ''} cette semaine
              </p>
            </div>

            {/* Mini podium — your rank (#1) in red, the next two greyed */}
            <div className="flex flex-none items-end gap-1.5" aria-hidden>
              {[
                { h: 60, me: true },
                { h: 45, me: false },
                { h: 30, me: false },
              ].map((b, i) => (
                <span
                  key={i}
                  className="rounded-t-[3px]"
                  style={{
                    width: 11,
                    height: b.h,
                    background: b.me ? '#E8203A' : '#222',
                    boxShadow: b.me
                      ? '0 0 12px rgba(232,32,58,0.5)'
                      : undefined,
                  }}
                />
              ))}
            </div>
          </div>
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
