import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sun, CloudRain, ChevronRight } from 'lucide-react'
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
import { fetchSupercarWeather, type SupercarWeather } from '../lib/weather'
import TitleChip from '../components/TitleChip'
import { useTheme } from '../lib/theme'

type CommunityStats = {
  spots_today: number
  online_now: number
  top_brand: string | null
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
  const [ville, setVille] = useState<string>('')
  const [now, setNow] = useState(() => Date.now())
  const [weather, setWeather] = useState<SupercarWeather | null>(null)
  const [weatherLoading, setWeatherLoading] = useState(true)

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
          .select('pseudo, ville, title')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase.rpc('my_xp'),
      ])
      if (!active) return

      const pseudo =
        (profRes.data?.pseudo as string | undefined)?.trim() ||
        (user.email ? user.email.split('@')[0] : 'Spotter')
      setName(pseudo)
      setVille((profRes.data?.ville as string | undefined)?.trim() ?? '')
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
    })()
    return () => {
      active = false
    }
  }, [])

  // Real weather for the "Météo des Supercars" module. Defaults to
  // Annecy (Flo's home base) when the profile has no city set so the
  // module always has something meaningful to say.
  useEffect(() => {
    if (loading) return
    const city = ville?.trim() || 'Annecy'
    let active = true
    // weatherLoading starts true and only flips off once resolved, so no
    // synchronous in-effect setState is needed for the first read.
    fetchSupercarWeather(city).then((w) => {
      if (!active) return
      setWeather(w)
      setWeatherLoading(false)
    })
    return () => {
      active = false
    }
  }, [ville, loading])

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

      {/* ─── 3 · COMPLÉMENTS — floating on the page, massive breathing ─── */}
      <div className="mt-12 space-y-12">
        <SupercarWeatherModule
          weather={weather}
          loading={weatherLoading}
          city={ville?.trim() || 'Annecy'}
        />

        {nextGp && (
          <MotorsportFrieze
            name={nextGp.name}
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

// Tachometer geometry: three concentric arcs opening at the bottom
// (270° sweep, 90° gap), drawn clockwise from the down-left tip. Pure
// functions of constants — safe in the module scope (no Date/random).
const GAUGE_CX = 100
const GAUGE_CY = 92
const GAUGE_START = 225 // down-left
const GAUGE_SWEEP = 270 // to down-right, over the top
const GAUGE_RADII = [78, 61, 44] as const

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) }
}
function arcPath(r: number, startDeg: number, endDeg: number): string {
  const s = polar(GAUGE_CX, GAUGE_CY, r, startDeg)
  const e = polar(GAUGE_CX, GAUGE_CY, r, endDeg)
  const large = endDeg - startDeg > 180 ? 1 : 0
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
}

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
    emoji: '🛞',
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
  // [colour, glow] per arc — REVS red / gold / silver.
  const palette: { c: string; glow: string }[] = light
    ? [
        { c: '#E8203A', glow: 'rgba(232,32,58,0.30)' },
        { c: '#C99A12', glow: 'rgba(201,154,18,0.28)' },
        { c: '#8A9099', glow: 'rgba(138,144,153,0.26)' },
      ]
    : [
        { c: '#FF2D46', glow: 'rgba(255,45,70,0.45)' },
        { c: '#FFD700', glow: 'rgba(255,215,0,0.40)' },
        { c: '#CBD0D8', glow: 'rgba(203,208,216,0.38)' },
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

  const trackStroke = 'rgb(var(--color-fg) / 0.08)'

  return (
    <button
      onClick={onTap}
      aria-label="Voir mes objectifs de la semaine"
      className="tappable mx-auto mt-5 flex flex-col items-center"
    >
      {/* The concentric tach */}
      <div className="relative" style={{ width: '224px', height: '196px' }}>
        <svg
          viewBox="0 0 200 175"
          width="100%"
          height="100%"
          style={{ overflow: 'visible' }}
          aria-hidden
        >
          {GAUGE_RADII.map((r, i) => {
            const pal = palette[i]
            const { pct, done } = slots[i]
            const stroke = done ? '#22C55E' : pal.c
            const fillEnd = GAUGE_START + (GAUGE_SWEEP * pct) / 100
            return (
              <g key={r}>
                <path
                  d={arcPath(r, GAUGE_START, GAUGE_START + GAUGE_SWEEP)}
                  fill="none"
                  stroke={trackStroke}
                  strokeWidth={9}
                  strokeLinecap="round"
                />
                {pct > 0 && (
                  <path
                    d={arcPath(r, GAUGE_START, fillEnd)}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={9}
                    strokeLinecap="round"
                    style={{
                      filter: `drop-shadow(0 0 6px ${done ? 'rgba(34,197,94,0.40)' : pal.glow})`,
                    }}
                  />
                )}
              </g>
            )
          })}
        </svg>

        {/* Start-tip icons — one per arc, on its down-left origin. */}
        {GAUGE_RADII.map((r, i) => {
          const p = polar(GAUGE_CX, GAUGE_CY, r, GAUGE_START)
          return (
            <span
              key={`ic-${r}`}
              aria-hidden
              className="absolute flex items-center justify-center rounded-full"
              style={{
                left: `${(p.x / 200) * 100}%`,
                top: `${(p.y / 175) * 100}%`,
                transform: 'translate(-50%, -50%)',
                width: '20px',
                height: '20px',
                fontSize: '11px',
                background: 'var(--color-glass-strong)',
                border: '1px solid rgb(var(--color-fg) / 0.10)',
              }}
            >
              {slots[i].emoji}
            </span>
          )
        })}

        {/* Central focal readout — the cumulative % is the gauge's hero
            figure. text-fg flips white↔charcoal with the theme. */}
        <span
          className="absolute left-1/2 flex flex-col items-center"
          style={{
            top: `${(GAUGE_CY / 175) * 100}%`,
            transform: 'translate(-50%,-50%)',
          }}
        >
          <span
            className="font-display font-extrabold leading-none text-fg"
            style={{ fontSize: '30px', letterSpacing: '-0.03em' }}
          >
            {cumulative}
            <span className="font-bold text-fg/55" style={{ fontSize: '15px' }}>
              %
            </span>
          </span>
          <span
            className="mt-1 font-black uppercase text-fg2"
            style={{ fontSize: '7px', letterSpacing: '0.22em' }}
          >
            Cumulé
          </span>
        </span>
      </div>

      {/* Forced-label legend — auto emoji + verbatim objective + the real
          "Actuel / Objectif" counter (colour-coded to its arc). */}
      <div className="mt-1 flex w-full flex-col gap-1.5">
        {slots.map((s, i) => (
          <div key={s.label} className="flex items-center gap-2">
            <span aria-hidden style={{ fontSize: '12px' }}>
              {s.emoji}
            </span>
            <span
              className="flex-1 truncate font-bold uppercase tracking-wide text-fg/75"
              style={{ fontSize: '10.5px', letterSpacing: '0.04em' }}
            >
              {s.label}
            </span>
            <span
              className="flex-none tabular-nums font-extrabold"
              style={{
                fontSize: '11px',
                color: s.done ? '#22C55E' : palette[i].c,
              }}
            >
              {s.progress} / {s.target}
            </span>
          </div>
        ))}
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
          boxShadow:
            '0 16px 32px rgba(232,32,58,0.42), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -2px 6px rgba(0,0,0,0.25)',
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

// ──────────────────────── MÉTÉO DES SUPERCARS ────────────────────────

/** Ultra-sober textual weather module. Reads the real conditions for the
 *  user's city and resolves a binary "sortie index": dry → supercars are
 *  out; wet → limited, prefer covered spots. Theme-aware throughout. */
function SupercarWeatherModule({
  weather,
  loading,
  city,
}: {
  weather: SupercarWeather | null
  loading: boolean
  city: string
}) {
  const dry = weather?.condition !== 'humide'
  const Icon = dry ? Sun : CloudRain
  const accent = dry ? '#FFB85C' : '#93C5FD'

  return (
    <section className="home-section-enter">
      <p
        className="mb-3 px-1 font-black uppercase text-fg2"
        style={{ fontSize: '10px', letterSpacing: '0.22em' }}
      >
        Météo des supercars
      </p>
      <div className="flex items-center gap-4 px-1">
        <div
          className="flex h-12 w-12 flex-none items-center justify-center rounded-2xl"
          style={{
            background: 'rgb(var(--color-fg) / 0.05)',
            border: '1px solid rgb(var(--color-fg) / 0.07)',
          }}
        >
          <Icon className="h-6 w-6" style={{ color: accent }} />
        </div>
        <div className="min-w-0 flex-1">
          {loading && !weather ? (
            <p className="text-[14px] font-medium text-fg/55">
              Lecture du ciel sur {city}…
            </p>
          ) : (
            <>
              <p className="flex items-baseline gap-2">
                <span
                  className="font-display font-extrabold tracking-tight text-fg"
                  style={{ fontSize: '15px', letterSpacing: '-0.01em' }}
                >
                  {weather?.headline ?? 'Conditions standards'}
                </span>
                {weather && (
                  <span className="tabular-nums text-[12px] font-semibold text-fg2">
                    {weather.tempC}° · {city}
                  </span>
                )}
              </p>
              <p
                className="mt-0.5 font-medium text-fg/65"
                style={{ fontSize: '13px', lineHeight: 1.45 }}
              >
                {weather?.detail ??
                  'Sors quand même — on ne sait jamais ce qui passe.'}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

// ──────────────────────── MOTORSPORT FRIEZE ────────────────────────

/** Box-less motorsport block: a thin grey "Motorsport • <GP>" eyebrow
 *  over the linear countdown frieze where the F1 car slides toward the
 *  chequered flag as race day approaches. No card, no border — floats on
 *  the page per the cockpit clean-up. */
function MotorsportFrieze({
  name,
  gpDiff,
  onTap,
}: {
  name: string
  gpDiff: number
  onTap: () => void
}) {
  const cd = {
    d: Math.max(0, Math.floor(gpDiff / 86400000)),
    h: Math.max(0, Math.floor((gpDiff % 86400000) / 3600000)),
    m: Math.max(0, Math.floor((gpDiff % 3600000) / 60000)),
  }
  // 14-day perceptual window — the car only starts creeping once the GP
  // is within a fortnight; further out it idles at the start gate.
  const WINDOW_MS = 14 * 86_400_000
  const progressPct = Math.min(1, Math.max(0, 1 - Math.max(0, gpDiff) / WINDOW_MS))
  const carLeft = `calc(12px + ${progressPct} * (100% - 24px))`

  return (
    <section className="home-section-enter">
      <button
        onClick={onTap}
        className="tappable block w-full px-1 text-left"
        aria-label={`Grand Prix — ${name}`}
      >
        <p
          className="mb-4 font-black uppercase text-fg2"
          style={{ fontSize: '10px', letterSpacing: '0.22em' }}
        >
          Motorsport • {name}
        </p>
        <div className="relative">
          <div
            className="relative h-1 rounded-full"
            style={{ background: 'rgb(var(--color-fg) / 0.08)' }}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{
                width: `${progressPct * 100}%`,
                background:
                  'linear-gradient(90deg, rgba(232,32,58,0.25) 0%, rgba(232,32,58,0.85) 100%)',
                boxShadow: '0 0 8px rgba(232, 32, 58, 0.45)',
                transition: 'width 700ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
            />
          </div>
          <span
            aria-hidden
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{
              left: carLeft,
              top: '2px',
              fontSize: '18px',
              lineHeight: 1,
              filter: 'drop-shadow(0 0 6px rgba(232, 32, 58, 0.55))',
              transition: 'left 700ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            🏎️
          </span>
          <span
            aria-hidden
            className="absolute -translate-y-1/2"
            style={{ right: '-4px', top: '2px', fontSize: '14px', lineHeight: 1 }}
          >
            🏁
          </span>
        </div>
        <p className="mt-3 text-[11px] font-medium text-fg2">
          {gpDiff > 0
            ? `Dans ${cd.d}j · ${String(cd.h).padStart(2, '0')}h · ${String(cd.m).padStart(2, '0')}m`
            : 'En cours !'}
        </p>
      </button>
    </section>
  )
}
