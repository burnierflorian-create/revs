import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Settings,
  Cloud,
  CloudRain,
  Gamepad2,
  Sun,
  ChevronRight,
  Target,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { type Spot } from '../lib/spots'
import { xpLevel } from '../lib/xp'
import { GP_2026 } from '../lib/f1'
import { Skeleton } from '../components/Skeleton'
import {
  challengePct as computeChallengePct,
  fetchActiveChallenges,
  type Challenge,
} from '../lib/challenges'
import { fetchMyRadarPrefs } from '../lib/radar'
import { fetchLiveEvents, type LiveEvent } from '../lib/liveEvents'
import {
  fetchSpottingPrediction,
  type PredictionResult,
} from '../lib/spotPredictions'
import TitleChip from '../components/TitleChip'
import { useMyTier } from '../lib/tier'

/** Feature flag — flip back to `true` to restore the 🎮 chip in the
 *  Home header. The /games and /race routes stay registered in App.tsx
 *  so the feature is reachable by URL meanwhile. */
const SHOW_GAMES_ENTRY = false

/** Feature flag — gates the WeatherCard render AND its underlying
 *  fetchSpottingPrediction call. Both the component code and the
 *  client lib stay in place so flipping this back to `true` revives
 *  the feature without any plumbing work. The Map screen mirrors the
 *  same constant so neither surface fires a Claude call while hidden. */
const SHOW_WEATHER_IA = false

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
  const [streak, setStreak] = useState(0)
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [radarActive, setRadarActive] = useState(false)
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([])
  const [community, setCommunity] = useState<CommunityStats | null>(null)
  const tier = useMyTier()
  const [title, setTitle] = useState<string | null>(null)
  const [ville, setVille] = useState<string>('')
  const [now, setNow] = useState(() => Date.now())
  // Weather-style AI hook card under the community stats. Re-introduces
  // the prediction fetch I'd ripped from Home in commit e8f035b — the
  // new card has a different shape (icon + temp + concise message) and
  // sits under the stats. The Map bottom sheet still uses the same
  // server-cached prediction so cost is paid once per day either way.
  const [prediction, setPrediction] = useState<PredictionResult | null>(null)
  const [predictionLoading, setPredictionLoading] = useState(false)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Live community stats — refresh every 60s while on the home tab.
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

      const [profRes, recentRes, xpRes, streakRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('pseudo, ville, title')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('spots')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10),
        supabase.rpc('my_xp'),
        supabase
          .from('spot_count_daily')
          .select('date, count')
          .eq('user_id', user.id)
          .gt('count', 0)
          .order('date', { ascending: false })
          .limit(90),
      ])

      if (!active) return

      const pseudo =
        (profRes.data?.pseudo as string | undefined)?.trim() ||
        (user.email ? user.email.split('@')[0] : 'Spotter')
      const profVille =
        (profRes.data?.ville as string | undefined)?.trim() ?? ''
      const profTitle =
        (profRes.data?.title as string | undefined)?.trim() || null
      setTitle(profTitle)
      setVille(profVille)

      const days = new Set(
        ((streakRes.data ?? []) as { date: string }[]).map((r) => r.date),
      )
      const dayStr = (d: Date) => d.toISOString().slice(0, 10)
      const cursor = new Date()
      if (!days.has(dayStr(cursor)))
        cursor.setUTCDate(cursor.getUTCDate() - 1)
      let st = 0
      while (days.has(dayStr(cursor))) {
        st += 1
        cursor.setUTCDate(cursor.getUTCDate() - 1)
      }
      setStreak(st)

      setName(pseudo)
      setXp((xpRes.data as number | null) ?? 0)
      // recentSpots is still derived here even though Home no longer
      // renders the "Spots récents" carousel — it feeds the spotting-
      // prediction prompt below (brand counts + last car). The home
      // RPC and the AI prompt are unchanged; only the UI surface
      // dropped the carousel.
      const recentSpots = (recentRes.data ?? []) as Spot[]
      setLoading(false)

      // AI weather hook — only fires when the user has set their city
      // and isn't blocking the rest of the home grid. The Map sheet
      // hits the same RPC; both share the server cache per
      // (user, city, date) so it costs nothing twice. Gated by the
      // SHOW_WEATHER_IA flag so no Claude call lands while archived.
      if (SHOW_WEATHER_IA && profVille) {
        setPredictionLoading(true)
        // Reuse the brand-counting context the prediction prompt
        // expects. recentSpots is in scope from above; we don't
        // re-query for it.
        const counts = new Map<string, number>()
        for (const s of recentSpots) {
          const b = (s.brand ?? '').trim()
          if (!b) continue
          counts.set(b, (counts.get(b) ?? 0) + 1)
        }
        const topBrands = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([brand]) => brand)
        const lastCar = recentSpots[0]
          ? `${recentSpots[0].brand ?? ''} ${recentSpots[0].model ?? ''}`.trim()
          : undefined
        fetchSpottingPrediction(profVille, {
          pseudo,
          spot_count: recentSpots.length,
          top_brands: topBrands,
          level: xpLevel((xpRes.data as number | null) ?? 0).name,
          last_car: lastCar,
        }).then((p) => {
          if (!active) return
          setPrediction(p)
          setPredictionLoading(false)
        })
      }

      // Challenges fetch is decoupled from the main grid: it's a
      // single RPC and doesn't block first paint of the home tab.
      fetchActiveChallenges().then((c) => {
        if (active) setChallenges(c)
      })
      fetchMyRadarPrefs().then((p) => {
        if (active) setRadarActive(p?.enabled === true)
      })
      fetchLiveEvents().then((evs) => {
        if (active) setLiveEvents(evs)
      })
      // Initial fetch — subsequent refreshes happen on a 60s interval
      // mounted in a dedicated effect (see below) so the counters stay
      // live while the user lingers on the home tab.
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

  const level = xpLevel(xp)
  const upcomingGp = GP_2026.find((g) => new Date(g.date).getTime() >= now)
  const gpDiff = upcomingGp ? new Date(upcomingGp.date).getTime() - now : 0
  // Only surface the GP block when the race is within the next 7 days
  // — beyond that the countdown is noise and the home tab should breathe.
  const SEVEN_DAYS_MS = 7 * 86_400_000
  const nextGp =
    upcomingGp && gpDiff <= SEVEN_DAYS_MS ? upcomingGp : null
  const cd = {
    d: Math.max(0, Math.floor(gpDiff / 86400000)),
    h: Math.max(0, Math.floor((gpDiff % 86400000) / 3600000)),
    m: Math.max(0, Math.floor((gpDiff % 3600000) / 60000)),
    s: Math.max(0, Math.floor((gpDiff % 60000) / 1000)),
  }
  if (loading) {
    return (
      <div className="min-h-screen bg-black px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between py-5">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48 rounded" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
        <div className="space-y-7 pb-8">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative min-h-screen px-5 pt-[max(1rem,env(safe-area-inset-top))] text-fg"
      style={{
        // Diagonal premium wash per the launch polish spec —
        // neutral-950 (#0a0a0a) → black → neutral-950 sweep from
        // top-left to bottom-right. Reads as a single luxury
        // surface across the whole scroll rather than a top-only
        // radial pool.
        background:
          'linear-gradient(135deg, #0a0a0a 0%, #050505 50%, #0a0a0a 100%)',
      }}
    >
      {/* HEADER — compact greeting + identity pills + settings */}
      <header className="flex items-start justify-between pt-5 pb-4">
        <div className="min-w-0">
          {/* Greeting line — H1 + inline online-status pulse dot.
              The dot replaces the boxy COMMUNITY STATS pill that
              used to sit below the header; an emerald ping ring +
              solid core reads as a single online-indicator glyph
              without taking any vertical real estate. */}
          <div className="flex items-center gap-2.5">
            <h1
              className="font-display font-extrabold tracking-tighter text-fg"
              style={{
                fontSize: '34px',
                lineHeight: 1,
                letterSpacing: '-0.03em',
              }}
            >
              Bonjour {name}
            </h1>
            <span
              className="relative flex h-2 w-2 flex-none"
              style={{ marginTop: '6px' }}
              aria-label="En ligne"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Title chip honours profiles.title — Fondateur shows in
                gold with an animated shimmer, manual special titles
                render with their own theme, otherwise the XP-derived
                ladder takes over. */}
            <TitleChip xp={xp} title={title} size="sm" />
            <span
              className="inline-flex items-baseline gap-1.5 font-medium text-fg/70"
              style={{ fontSize: '12px' }}
            >
              <span>{level.name}</span>
              <span className="text-fg/30">·</span>
              <span className="tabular-nums">
                {new Intl.NumberFormat('fr-FR').format(xp)} XP
              </span>
            </span>
            {tier === 'premium' && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-extrabold tracking-wider text-accent"
                style={{ border: '1px solid rgba(232,32,58,0.35)' }}
              >
                ⚡ PREMIUM ACTIF
              </span>
            )}
            {tier === 'vip' && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold tracking-wider"
                style={{
                  background:
                    'linear-gradient(120deg, rgba(255,200,50,0.20) 0%, rgba(184,134,11,0.12) 100%)',
                  color: '#FFD700',
                  border: '1px solid rgba(255,200,50,0.45)',
                  boxShadow: '0 4px 14px rgba(255,200,50,0.25)',
                }}
              >
                👑 CERCLE VIP
              </span>
            )}
            {streak > 0 && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
                style={{
                  background:
                    'linear-gradient(135deg, rgba(255, 159, 64, 0.22) 0%, rgba(255, 87, 34, 0.12) 100%)',
                  color: '#FFB766',
                  border: '1px solid rgba(255, 159, 64, 0.40)',
                  boxShadow: '0 4px 14px rgba(255, 122, 47, 0.18)',
                }}
              >
                <span
                  aria-hidden
                  style={{ animation: 'streak-glow 2.2s ease-in-out infinite' }}
                >
                  🔥
                </span>
                {streak} {streak > 1 ? 'jours' : 'jour'}
              </span>
            )}
            {radarActive && (
              <button
                onClick={() => navigate('/radar')}
                className="tappable inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-bold text-accent"
                aria-label="Radar actif"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                RADAR ON
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-none items-center gap-2">
          {/* Jeux REVS entry point — temporarily hidden. The /games
              and /race routes stay live so the feature is reachable
              for testing via direct URL; we just don't surface it
              in the header until the multiplayer pass ships. Flip
              SHOW_GAMES_ENTRY back to true to restore the chip. */}
          {SHOW_GAMES_ENTRY && (
            <button
              onClick={() => navigate('/games')}
              aria-label="Jeux REVS"
              className="tappable flex h-9 w-9 items-center justify-center rounded-full bg-card text-fg2 transition-colors hover:text-fg"
            >
              <Gamepad2 className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={() => navigate('/settings')}
            aria-label="Réglages"
            className="tappable flex h-9 w-9 items-center justify-center rounded-full bg-card text-fg2 transition-colors hover:text-fg"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div className="space-y-8 pb-10">
        {/* REVS RADAR — top-of-page hero per the 2026-06-01 car-spotting
            refocus. Sits in the slot the F1 hero used to occupy, anchors
            the home tab to its core ADN (spotting + hot zones). Pulses
            a mini-sonar on the left and reads a city-aware hot-zone
            count derived from the community stats RPC on the right.
            Taps through to /radar. */}
        <RevsRadarCard
          ville={ville}
          community={community}
          onTap={() => navigate('/radar')}
        />

        {/* "Spot du jour / de la semaine" daily card was removed from
            Home per 2026-05-28 cleanup. Code for DailyCard /
            DailyCardSpotRow has been pruned along with the
            fetchRarestSpot call; the rarest-spot lookup can be
            reintroduced later if needed. */}

        {/* COMMUNITY STATS pill removed 2026-06-01 — the live counters
            now condense into a single green pulse dot next to the
            greeting (see header). The `community` state is still
            populated because RevsRadarCard derives its hot-zone
            count from community.spots_today; only the boxy
            "X en ligne · Y aujourd'hui" pill is gone. */}

        {/* WEATHER / AI HOOK — daily retention card sitting under the
            stats. Currently archived behind SHOW_WEATHER_IA — the
            WeatherCard component, the WEATHER_THEME palette and the
            prediction lib all stay in place; flipping the flag back
            to true is the only step needed to revive it. */}
        {SHOW_WEATHER_IA && ville && (prediction || predictionLoading) && (
          <WeatherCard
            prediction={prediction}
            loading={predictionLoading}
            ville={ville}
            delayMs={100}
          />
        )}

        {/* LIVE EVENTS BANNER */}
        {liveEvents.length > 0 && (
          <section
            className="home-section-enter space-y-2"
            style={{ animationDelay: '200ms' }}
          >
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
          </section>
        )}

        {/* 6 — CHALLENGES DE LA SEMAINE (swipe carousel) */}
        {challenges.length > 0 && (
          <section
            className="home-section-enter"
            style={{ animationDelay: '400ms' }}
          >
            <p
              className="mb-3 font-extrabold uppercase tracking-widest text-white/45"
              style={{ fontSize: '11px', letterSpacing: '0.18em' }}
            >
              Objectifs de la semaine
            </p>
            <ChallengeRings
              challenges={challenges}
              onPick={() => navigate('/challenges')}
            />
          </section>
        )}

        {/* PROCHAIN GP — relegated to the bottom as a secondary card per
            the 2026-06-01 car-spotting refocus. The full circuit-art
            hero moved out of the top slot; this compact pill keeps the
            countdown reachable without competing with the radar above. */}
        {nextGp && (
          <section
            className="home-section-enter"
            style={{ animationDelay: '500ms' }}
          >
            <p
              className="mb-3 font-extrabold uppercase tracking-widest text-white/40"
              style={{ fontSize: '11px', letterSpacing: '0.18em' }}
            >
              Motorsport actu
            </p>
            <button
              onClick={() => navigate(`/f1/${nextGp.round}`)}
              className="tappable relative block w-full overflow-hidden rounded-3xl text-left transition-opacity hover:opacity-100"
              style={{
                border: '1px solid rgba(255, 255, 255, 0.05)',
                background:
                  'linear-gradient(135deg, rgba(20,20,22,0.85) 0%, rgba(5,5,7,0.95) 100%)',
                opacity: 0.78,
              }}
            >
              <div className="relative flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="text-2xl leading-none">{nextGp.flag}</span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate font-display font-bold tracking-tight text-white"
                      style={{ fontSize: '14px' }}
                    >
                      {nextGp.name}
                    </p>
                    <p className="truncate text-[11px] text-fg2 font-medium">
                      {nextGp.circuit}
                    </p>
                  </div>
                </div>
                <div
                  className="inline-flex flex-none items-baseline gap-1 rounded-lg font-mono tabular-nums text-white"
                  style={{
                    background: 'rgba(0, 0, 0, 0.40)',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 700,
                  }}
                >
                  <span>{String(cd.d).padStart(2, '0')}</span>
                  <span className="text-white/45">d</span>
                  <span className="colon-blink text-white/60">:</span>
                  <span>{String(cd.h).padStart(2, '0')}</span>
                  <span className="text-white/45">h</span>
                  <span className="colon-blink text-white/60">:</span>
                  <span>{String(cd.m).padStart(2, '0')}</span>
                  <span className="text-white/45">m</span>
                </div>
              </div>
            </button>
          </section>
        )}
      </div>
    </div>
  )
}


// ──────────────────────────────── REVS RADAR ────────────────────────────────

/** Top-of-page hero per the 2026-06-01 car-spotting refocus. Pulls the
 *  user's city from profiles.ville and the community RPC's spots_today
 *  to derive a hot-zone count, then renders a black-satin glass card
 *  with a mini sonar on the left and a city-aware status line on the
 *  right. Taps through to /radar so the user lands on the live map.
 *  The sonar uses two stacked ping rings (Tailwind's animate-ping
 *  keyframes) — no JS animation loop, no canvas, just CSS so battery
 *  cost stays at zero.
 *
 *  Hot-zone count derivation: spots_today / 5, floored, clamped to
 *  [1, 9]. We don't surface raw activity numbers — "3 zones" reads
 *  more like a radar UI than "47 spots aujourd'hui". When the day
 *  is dead (≤2 community spots), the copy flips to a "sois le
 *  premier" tone instead of overpromising activity. */
function RevsRadarCard({
  ville,
  community,
  onTap,
}: {
  ville: string
  community: CommunityStats | null
  onTap: () => void
}) {
  const cityLabel = ville?.trim() || 'Ta zone'
  const today = community?.spots_today ?? 0
  const zones = Math.min(9, Math.max(1, Math.floor(today / 5)))
  const aliveDay = today >= 3
  const headline = aliveDay
    ? `${cityLabel} est active`
    : `${cityLabel} attend ton scan`
  const subline = aliveDay
    ? `${zones} zone${zones > 1 ? 's' : ''} à forte activité détectée${zones > 1 ? 's' : ''}. Prends ton objectif, les bolides sortent.`
    : 'Zone calme. Sois le premier à allumer le radar aujourd\'hui.'

  return (
    <section className="home-section-enter" style={{ animationDelay: '0ms' }}>
      <button
        onClick={onTap}
        className="tappable flex w-full items-center gap-4 text-left transition-transform active:scale-[0.99]"
        style={{
          background: 'var(--color-glass-mid)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '28px',
          padding: '20px',
          backdropFilter: 'saturate(170%) blur(22px)',
          WebkitBackdropFilter: 'saturate(170%) blur(22px)',
          boxShadow:
            '0 24px 48px rgba(0, 0, 0, 0.50), 0 8px 14px rgba(0, 0, 0, 0.30)',
        }}
        aria-label="Ouvrir REVS RADAR"
      >
        {/* Mini sonar — two concentric ping rings + centred bullseye
            inside a circular well. The outer ring is a tiny bit slower
            than the inner so the pulses interlace rather than ping in
            lockstep. Pure CSS, GPU-friendly. */}
        <div
          className="relative flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-full"
          style={{
            background: 'rgba(0, 0, 0, 0.40)',
            border: '1px solid rgba(232, 32, 58, 0.18)',
          }}
        >
          <span
            aria-hidden
            className="absolute inset-0 animate-ping rounded-full"
            style={{
              border: '1px solid rgba(232, 32, 58, 0.35)',
              animationDuration: '2.6s',
            }}
          />
          <span
            aria-hidden
            className="absolute animate-ping rounded-full"
            style={{
              inset: '14px',
              border: '1px solid rgba(232, 32, 58, 0.22)',
              animationDuration: '2.2s',
              animationDelay: '0.4s',
            }}
          />
          <div
            className="relative flex h-8 w-8 items-center justify-center rounded-full"
            style={{
              background: 'rgba(232, 32, 58, 0.12)',
              border: '1px solid rgba(232, 32, 58, 0.45)',
              boxShadow: '0 0 14px rgba(232, 32, 58, 0.35)',
            }}
          >
            <Target className="h-4 w-4 text-accent" />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <p
            className="font-black uppercase text-accent"
            style={{ fontSize: '10px', letterSpacing: '0.20em' }}
          >
            Radar temps réel
          </p>
          <h3
            className="mt-0.5 truncate font-display font-bold tracking-tight text-white"
            style={{ fontSize: '15px', letterSpacing: '-0.01em' }}
          >
            {headline}
          </h3>
          <p
            className="mt-1 font-medium text-fg2"
            style={{ fontSize: '11px', lineHeight: 1.5 }}
          >
            {subline}
          </p>
        </div>

        <ChevronRight className="h-4 w-4 flex-none text-fg2/40" />
      </button>
    </section>
  )
}

// ─────────────────────────────── WEATHER CARD ───────────────────────────────

/** Mock weather chip mapped from the AI's spotting score bucket. We
 *  don't ship a real weather API; the temperature is a plausible
 *  default per condition and the icon comes from Lucide. The Claude-
 *  generated message is the real personalised hook — that's the actual
 *  retention lever, the weather chrome is just packaging. */
const WEATHER_THEME: Record<
  'bon' | 'moyen' | 'mauvais',
  { Icon: typeof Sun; temp: string; bg: string; border: string; iconColor: string }
> = {
  bon: {
    Icon: Sun,
    temp: '22°',
    bg: 'linear-gradient(135deg, rgba(255, 184, 92, 0.18) 0%, rgba(232, 32, 58, 0.10) 100%)',
    border: '1px solid rgba(255, 184, 92, 0.35)',
    iconColor: '#FFB85C',
  },
  moyen: {
    Icon: Cloud,
    temp: '16°',
    bg: 'linear-gradient(135deg, rgba(148, 163, 184, 0.18) 0%, rgba(71, 85, 105, 0.12) 100%)',
    border: '1px solid rgba(148, 163, 184, 0.30)',
    iconColor: '#CBD5E1',
  },
  mauvais: {
    Icon: CloudRain,
    temp: '12°',
    bg: 'linear-gradient(135deg, rgba(96, 165, 250, 0.18) 0%, rgba(30, 64, 175, 0.12) 100%)',
    border: '1px solid rgba(96, 165, 250, 0.32)',
    iconColor: '#93C5FD',
  },
}

function WeatherCard({
  prediction,
  loading,
  ville,
  delayMs,
}: {
  prediction: PredictionResult | null
  loading: boolean
  ville: string
  delayMs: number
}) {
  const score = prediction?.score_conditions ?? 'moyen'
  const theme = WEATHER_THEME[score]
  const { Icon } = theme
  return (
    <section
      className="home-section-enter relative overflow-hidden rounded-3xl px-5 py-4"
      style={{
        background: theme.bg,
        backdropFilter: 'saturate(160%) blur(18px)',
        WebkitBackdropFilter: 'saturate(160%) blur(18px)',
        border: theme.border,
        boxShadow: '0 16px 36px rgba(0, 0, 0, 0.35)',
        animationDelay: `${delayMs}ms`,
      }}
    >
      <div className="flex items-center gap-4">
        <div
          className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl"
          style={{
            background: 'rgba(0, 0, 0, 0.30)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <Icon className="h-7 w-7" style={{ color: theme.iconColor }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className="font-display font-extrabold tracking-tighter text-white"
              style={{ fontSize: '24px', lineHeight: 1, letterSpacing: '-0.02em' }}
            >
              {theme.temp}
            </span>
            <span
              className="truncate text-white/65"
              style={{ fontSize: '12px', letterSpacing: '0.02em' }}
            >
              {ville}
            </span>
            <span
              className="ml-auto flex-none rounded-full px-2 py-0.5 font-bold tracking-wider text-white/85"
              style={{
                background: 'rgba(0, 0, 0, 0.35)',
                border: '1px solid rgba(255, 255, 255, 0.10)',
                fontSize: '8.5px',
                letterSpacing: '0.18em',
              }}
            >
              IA 🎯
            </span>
          </div>
          {loading && !prediction ? (
            <p
              className="mt-1 leading-snug text-white/65"
              style={{ fontSize: '13px' }}
            >
              Analyse en cours…
            </p>
          ) : (
            <p
              className="mt-1 leading-snug text-white/90"
              style={{ fontSize: '14px', fontWeight: 500 }}
            >
              {prediction?.message ??
                'Conditions standards aujourd’hui — sors quand même, on ne sait jamais.'}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────── CHALLENGE RINGS ───────────────────────────────

/** Replaces the full-width challenge carousel with an Apple-Watch-style
 *  row of activity rings. Each ring renders the top-3 active challenges
 *  as an SVG progress circle, colour-cycled red / gold / blue. Tapping
 *  anywhere on the row jumps to the full /challenges page. */
const RING_COLORS = ['#E8203A', '#FFD700', '#3B82F6'] as const

function challengeEmoji(c: Challenge): string {
  // Coarse classifier — enough to read at a glance without per-
  // challenge metadata. Falls back to 🎯 (target) when nothing fits.
  const t = c.title.toLowerCase()
  const b = (c.target_brand ?? '').toLowerCase()
  const cat = (c.target_category ?? '').toLowerCase()
  if (b.includes('ferrari')) return '🐎'
  if (b.includes('lamborghini')) return '🐂'
  if (b.includes('porsche') || b.includes('audi')) return '🏁'
  if (b.includes('mercedes')) return '⭐'
  if (b.includes('bmw')) return '🔵'
  if (cat.includes('hypercar')) return '👑'
  if (cat.includes('jdm')) return '🌸'
  if (cat.includes('youngtimer') || cat.includes('classic')) return '🕰️'
  if (t.includes('marathon')) return '🏃'
  if (t.includes('italian')) return '🇮🇹'
  return '🎯'
}

function ChallengeRings({
  challenges,
  onPick,
}: {
  challenges: Challenge[]
  onPick: () => void
}) {
  const top = challenges.slice(0, 3)
  return (
    <button
      onClick={onPick}
      // Glass card removed 2026-06-01 — the 3 rings now float directly
      // on the page background. The button keeps its tap target (px+py
      // for touch room) but loses the rgba black tile + border + blur
      // wrapper, so the section reads cleaner under the new "Objectifs
      // de la semaine" eyebrow without a heavy container.
      className="tappable flex w-full items-start justify-around px-3 py-2"
      aria-label={`Voir les ${top.length} défis de la semaine`}
    >
      {top.map((c, i) => (
        <ChallengeRing
          key={c.id}
          challenge={c}
          color={RING_COLORS[i % RING_COLORS.length]}
        />
      ))}
    </button>
  )
}

function ChallengeRing({
  challenge,
  color,
}: {
  challenge: Challenge
  color: string
}) {
  // SVG progress ring: 2πr with r=24 ≈ 150.8. We round-trip to a
  // clean integer so the stroke-dasharray reads cleanly in DevTools.
  const r = 24
  const circ = 2 * Math.PI * r
  const pct = Math.min(100, Math.max(0, computeChallengePct(challenge)))
  const offset = circ * (1 - pct / 100)
  const done = challenge.claimed || challenge.completed
  const ringColor = done ? '#22C55E' : color
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-14 w-14">
        <svg
          className="h-full w-full"
          viewBox="0 0 56 56"
          style={{ transform: 'rotate(-90deg)' }}
          aria-hidden
        >
          <circle
            cx="28"
            cy="28"
            r={r}
            stroke="rgba(255, 255, 255, 0.08)"
            strokeWidth="4"
            fill="transparent"
          />
          <circle
            cx="28"
            cy="28"
            r={r}
            stroke={ringColor}
            strokeWidth="4"
            fill="transparent"
            strokeDasharray={circ.toFixed(2)}
            strokeDashoffset={offset.toFixed(2)}
            strokeLinecap="round"
            style={{
              transition:
                'stroke-dashoffset 1000ms cubic-bezier(0.22, 1, 0.36, 1)',
              // Neon halo per the 2026-06-02 spec — 15px diffuse blur
              // at 15% alpha (hex 26) so the glow lifts the ring off
              // the page without bleeding into adjacent SVGs.
              filter: `drop-shadow(0 0 15px ${ringColor}26)`,
            }}
          />
        </svg>
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center"
          style={{ fontSize: '16px' }}
        >
          {challengeEmoji(challenge)}
        </span>
      </div>
      {/* Label wraps freely (whitespace-normal, no clamp) so long titles
          land on two natural rows. Per the 2026-06-02 strict spec:
          10px font, max-w-[90px], mt-2, dark/light-aware tint via
          text-fg2 (auto-flips with the theme). */}
      <span
        className="mt-2 block max-w-[90px] whitespace-normal text-center font-black uppercase leading-tight tracking-tight text-fg2"
        style={{ fontSize: '10px' }}
      >
        {challenge.title}
      </span>
    </div>
  )
}

