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
import { useTheme } from '../lib/theme'

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
              })
            } else {
              const above = idx > 0 ? rows[idx - 1] : null
              setCityRank({
                city: ville,
                rank: idx + 1,
                total: rows.length,
                gapToAbove: above ? Math.max(0, above.xp - rows[idx].xp) : 0,
                abovePseudo: above?.pseudo ?? null,
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

// Car-dashboard speedometer geometry — a 180° arc (left → top → right) of
// evenly-spaced tick marks in a 240×150 box. Angles use the math
// convention (0° = east, 90° = north). Fraction t in [0,1] maps to the
// arc via deg = 180 − t·180. Pure constants — safe at module scope.
const G_CX = 120
const G_CY = 128
const G_R = 98
const G_TICKS = 40
// Tick / needle position for a 0..1 fraction along the arc.
function gaugePoint(t: number, r: number) {
  const deg = 180 - t * 180
  const a = (deg * Math.PI) / 180
  return { x: G_CX + r * Math.cos(a), y: G_CY - r * Math.sin(a) }
}
// Emoji slots: slot 0 left (t=0), slot 1 top (t=0.5), slot 2 right (t=1).
const EMOJI_T = [0, 0.5, 1]

// The three fixed cockpit objectives, in arc order (outer→inner =
// red→gold→silver). Labels are FORCED — always shown verbatim — while
// `match` ties each slot to a live challenge (by keyword) so the arc
// fill still reflects real progress when that challenge exists.
const FORCED_ARCS: {
  label: string
  emoji: string
  match: (t: string, b: string, cat: string) => boolean
}[] = [
  {
    label: 'Marathon du week-end',
    emoji: '🏎️',
    match: (t) => t.includes('marathon') || t.includes('week'),
  },
  {
    label: 'Youngtimer Collector',
    emoji: '🏁',
    match: (t, _b, cat) =>
      t.includes('youngtimer') ||
      cat.includes('youngtimer') ||
      cat.includes('classic') ||
      t.includes('collector'),
  },
  {
    label: "Roi de l'Audi",
    emoji: '⚙️',
    match: (t, b) => b.includes('audi') || t.includes('audi'),
  },
]

/** Three concentric supercar-tach arcs: outer = REVS red, middle = gold,
 *  inner = silver. The three objective labels are fixed; each arc binds
 *  to a matching live challenge for its fill (falling back to the next
 *  unused challenge, else an empty gauge). Colours deepen in light mode
 *  so gold/silver still read on the alabaster widget. Tap → /challenges. */
function RpmGauges({
  challenges,
  onTap,
}: {
  challenges: Challenge[]
  onTap: () => void
}) {
  const { theme } = useTheme()
  const light = theme === 'light'
  // [colour, glow] per arc, matching each challenge's perimeter emoji:
  // Marathon = red, Youngtimer = yellow, Roi de l'Audi = blue.
  const palette: { c: string; glow: string }[] = light
    ? [
        { c: '#E8203A', glow: 'rgba(232,32,58,0.30)' },
        { c: '#D4A017', glow: 'rgba(212,160,23,0.30)' },
        { c: '#2563EB', glow: 'rgba(37,99,235,0.30)' },
      ]
    : [
        { c: '#FF2D46', glow: 'rgba(255,45,70,0.45)' },
        { c: '#F5C518', glow: 'rgba(245,197,24,0.45)' },
        { c: '#3B82F6', glow: 'rgba(59,130,246,0.45)' },
      ]

  // Bind each fixed slot to a real challenge: keyword match first, then
  // the next still-unbound challenge, else none (empty arc).
  const used = new Set<number>()
  const slots = FORCED_ARCS.map((f) => {
    let idx = challenges.findIndex(
      (c, i) =>
        !used.has(i) &&
        f.match(
          c.title.toLowerCase(),
          (c.target_brand ?? '').toLowerCase(),
          (c.target_category ?? '').toLowerCase(),
        ),
    )
    if (idx < 0) idx = challenges.findIndex((_, i) => !used.has(i))
    if (idx >= 0) used.add(idx)
    const c = idx >= 0 ? challenges[idx] : null
    return {
      label: f.label,
      emoji: f.emoji,
      pct: c ? Math.min(100, Math.max(0, computeChallengePct(c))) : 0,
      done: c ? c.claimed || c.completed : false,
      // Real "Actuel / Objectif" counters for the legend.
      progress: c ? Math.min(c.progress, c.target_value) : 0,
      target: c ? c.target_value : 0,
    }
  })

  // Central focal readout — cumulative average progress of the 3 arcs.
  const cumulative = Math.round(
    slots.reduce((sum, s) => sum + s.pct, 0) / slots.length,
  )

  return (
    <button
      onClick={onTap}
      aria-label="Voir mes objectifs de la semaine"
      className="tappable mx-auto mt-3 flex flex-col items-center"
    >
      {/* Car-dashboard speedometer — 40 tick marks lighting up red as the
          cumulative % rises, a thin spring-animated needle pointing at the
          value, the % + DÉFIS centred, and the 3 challenge emojis on the
          outer rim (🏎️ left / 🏁 top / ⚙️ right). */}
      <div className="relative" style={{ width: '240px', height: '150px' }}>
        <svg
          viewBox="0 0 240 150"
          width="100%"
          height="100%"
          style={{ overflow: 'visible' }}
          aria-hidden
        >
          {Array.from({ length: G_TICKS }).map((_, i) => {
            const t = i / (G_TICKS - 1)
            const inner = gaugePoint(t, G_R - 11)
            const outer = gaugePoint(t, G_R)
            const lit = i < Math.round((cumulative / 100) * G_TICKS)
            return (
              <line
                key={i}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke={lit ? '#E8203A' : '#2a2a2a'}
                strokeWidth={3}
                strokeLinecap="round"
                style={{
                  filter: lit
                    ? 'drop-shadow(0 0 3px rgba(232,32,58,0.75))'
                    : undefined,
                  transition: 'stroke 350ms ease',
                }}
              />
            )
          })}
        </svg>

        {/* Needle — HTML element pivoting at the gauge centre, spring-eased.
            rot = 0 at 50% (straight up), ±90° at the extremes. */}
        <div
          className="absolute"
          style={{ left: `${(G_CX / 240) * 100}%`, top: `${(G_CY / 150) * 100}%` }}
        >
          {/* soft red glow under the pivot */}
          <span
            aria-hidden
            className="absolute rounded-full"
            style={{
              left: '-22px',
              top: '-22px',
              width: '44px',
              height: '44px',
              background:
                'radial-gradient(circle, rgba(232,32,58,0.45) 0%, transparent 70%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: '-2px',
              bottom: '0px',
              width: '4px',
              height: '74px',
              borderRadius: '2px',
              background:
                'linear-gradient(to top, rgba(232,32,58,0.15) 0%, #E8203A 100%)',
              transformOrigin: 'bottom center',
              transform: `rotate(${(cumulative / 100 - 0.5) * 180}deg)`,
              transition: 'transform 900ms cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          />
          <span
            aria-hidden
            className="absolute rounded-full"
            style={{
              left: '-6px',
              top: '-6px',
              width: '12px',
              height: '12px',
              background: '#E8203A',
              boxShadow: '0 0 12px rgba(232,32,58,0.85)',
            }}
          />
        </div>

        {/* Center readout — big white %, grey DÉFIS under it (above needle). */}
        <span
          className="absolute z-10 flex flex-col items-center"
          style={{
            left: 0,
            right: 0,
            top: '74px',
            transform: 'translateY(-50%)',
          }}
        >
          <span
            className="font-display font-extrabold leading-none text-fg"
            style={{ fontSize: '32px', letterSpacing: '-0.03em' }}
          >
            {cumulative}
            <span className="font-bold text-fg/50" style={{ fontSize: '16px' }}>
              %
            </span>
          </span>
          <span
            className="mt-1.5 font-black uppercase text-fg2"
            style={{ fontSize: '11px', letterSpacing: '0.18em' }}
          >
            Défis
          </span>
        </span>

        {/* Challenge emojis on the outer rim. */}
        {slots.map((s, i) => {
          const p = gaugePoint(EMOJI_T[i], G_R)
          const col = s.done ? '#22C55E' : palette[i].c
          return (
            <span
              key={`ic-${i}`}
              aria-hidden
              className="absolute z-10 flex items-center justify-center rounded-full transition-colors duration-500"
              style={{
                left: `${(p.x / 240) * 100}%`,
                top: `${(p.y / 150) * 100}%`,
                transform: 'translate(-50%, -50%)',
                width: '34px',
                height: '34px',
                fontSize: '17px',
                lineHeight: 1,
                background: s.done ? 'rgba(34,197,94,0.20)' : `${palette[i].c}2E`,
                border: `1.5px solid ${col}`,
              }}
            >
              {s.emoji}
            </span>
          )
        })}
      </div>

      {/* Challenge list — coloured 20px emoji, bold name, coloured counter,
          a thin red progress bar; 12px between rows. */}
      <div className="mt-2 flex w-full flex-col gap-3">
        {slots.map((s, i) => {
          const pct =
            s.target > 0 ? Math.min(100, (s.progress / s.target) * 100) : 0
          const counterCol = s.done ? '#22C55E' : palette[i].c
          return (
            <div key={s.label} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2.5">
                <span aria-hidden style={{ fontSize: '20px', lineHeight: 1 }}>
                  {s.emoji}
                </span>
                <span
                  className="flex-1 truncate font-bold text-fg"
                  style={{ fontSize: '14px' }}
                >
                  {s.label}
                </span>
                <span
                  className="flex-none tabular-nums font-extrabold"
                  style={{ fontSize: '13px', color: counterCol }}
                >
                  {s.progress} / {s.target}
                </span>
              </div>
              <div
                className="h-1 w-full overflow-hidden rounded-full"
                style={{ background: 'rgb(var(--color-fg) / 0.10)' }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: '#E8203A',
                    transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </button>
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
  const WINDOW_MS = 14 * 86_400_000
  const progressPct = Math.min(
    1,
    Math.max(0, 1 - Math.max(0, gpDiff) / WINDOW_MS),
  )

  return (
    <button
      onClick={onTap}
      className="home-section-enter tappable relative block w-full overflow-hidden rounded-2xl p-5 pb-6 text-left transition-transform active:scale-[0.99]"
      style={{
        background: '#141414',
        border: '1px solid rgba(255,255,255,0.06)',
        boxShadow: '0 8px 22px rgba(0,0,0,0.45)',
      }}
      aria-label={`Grand Prix — ${name}`}
    >
      {/* Line 1 — flag + GP name + discreet red F1 badge */}
      <div className="flex items-center gap-2.5">
        <span aria-hidden style={{ fontSize: '26px', lineHeight: 1 }}>
          {flag}
        </span>
        <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-white">
          {name}
        </p>
        <span
          className="flex-none rounded-md px-2 py-0.5 text-[10px] font-extrabold tracking-wide text-white"
          style={{ background: '#E8203A', letterSpacing: '0.08em' }}
        >
          F1
        </span>
      </div>

      {/* Line 2 — circuit */}
      <p className="mt-1.5 truncate text-[12px] text-white/45">{circuit}</p>

      {/* Line 3 — countdown, calm white 20px (no aggressive red) */}
      <p
        className="mt-4 font-display font-bold leading-none tracking-tight text-white"
        style={{ fontSize: '20px' }}
      >
        {gpDiff > 0
          ? `Dans ${cd.d}j ${String(cd.h).padStart(2, '0')}h ${String(cd.m).padStart(2, '0')}m`
          : 'En cours !'}
      </p>

      {/* Thin red progress bar flush at the very bottom of the card */}
      <div
        className="absolute inset-x-0 bottom-0 h-1"
        style={{ background: 'rgba(255,255,255,0.10)' }}
      >
        <div
          className="h-full"
          style={{
            width: `${progressPct * 100}%`,
            background: '#E8203A',
            boxShadow: '0 0 8px rgba(232,32,58,0.5)',
            transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      </div>
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
        className="tappable block w-full overflow-hidden rounded-2xl p-4 text-left transition-transform active:scale-[0.99]"
        style={{
          ...cardStyle,
          // Thin gold border crowns the leader's card.
          border: isFirst
            ? '1px solid rgba(212,175,55,0.65)'
            : cardStyle.border,
        }}
      >
        <div className="flex items-center gap-2">
          <span aria-hidden style={{ fontSize: '18px' }}>
            🏆
          </span>
          <p className="flex-1 truncate text-[15px] font-bold text-white">
            Classement {rank.city}
          </p>
          <span className="text-[11px] font-medium text-white/40">
            {rank.total} spotter{rank.total > 1 ? 's' : ''}
          </span>
        </div>

        {isFirst ? (
          <p className="mt-3 font-display text-[20px] font-extrabold tracking-tight text-white">
            👑 Tu domines {rank.city} !
          </p>
        ) : inRanking ? (
          <div className="mt-3 flex items-baseline gap-2.5">
            <span
              className="font-display font-extrabold leading-none"
              style={{ fontSize: '28px', color: '#E8203A' }}
            >
              #{rank.rank}
            </span>
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-white/65">
              encore{' '}
              <span className="font-bold text-white">{rank.gapToAbove} XP</span>{' '}
              pour dépasser{' '}
              <span className="font-semibold text-white">
                {rank.abovePseudo ?? `#${rank.rank - 1}`}
              </span>
            </p>
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-white/65">
            Spotte pour entrer dans le classement de {rank.city}.
          </p>
        )}
      </button>
    </section>
  )
}
