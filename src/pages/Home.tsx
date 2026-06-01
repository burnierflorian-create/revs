import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Settings,
  Car,
  Cloud,
  CloudRain,
  Flame,
  Flag,
  Gamepad2,
  Sun,
  ChevronRight,
  Camera,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { timeAgo, type Rarity, type Spot } from '../lib/spots'
import { xpLevel } from '../lib/xp'
import { GP_2026, circuitImage } from '../lib/f1'
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

/** Rarity-tinted text colour for the glass pill that floats over the
 *  recent-spot photos. Emerald for commun matches the "Apple Sport"
 *  launch spec; the other tiers borrow the CollectorCard frame
 *  palette so the badge reads consistent across surfaces. */
const RARITY_TEXT_COLOR: Record<Rarity, string> = {
  commun: '#34D399',
  rare: '#60A5FA',
  ultra_rare: '#C084FC',
  unique: '#FACC15',
}
const RARITY_PILL_LABEL: Record<Rarity, string> = {
  commun: 'Commun',
  rare: 'Rare',
  ultra_rare: 'Ultra Rare',
  unique: 'Légendaire',
}

type CommunityStats = {
  spots_today: number
  online_now: number
  top_brand: string | null
}

function SectionTitle({
  icon,
  label,
  action,
  size = 'md',
}: {
  icon: ReactNode
  label: string
  action?: ReactNode
  /** `lg` bumps the title to a bigger, tighter-tracking display style
   *  used by the post-polish home sections (Challenges, Spots récents). */
  size?: 'md' | 'lg'
}) {
  const isLarge = size === 'lg'
  return (
    <div className={`flex items-center justify-between ${isLarge ? 'mb-4' : 'mb-3'}`}>
      <h2
        className="flex items-center gap-2 font-display font-extrabold text-fg"
        style={
          isLarge
            ? { fontSize: '22px', letterSpacing: '-0.02em', lineHeight: 1.1 }
            : { fontSize: '16px' }
        }
      >
        <span className={isLarge ? '' : 'text-accent'}>{icon}</span>
        {label}
      </h2>
      {action}
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('Spotter')
  const [xp, setXp] = useState(0)
  const [recent, setRecent] = useState<Spot[]>([])
  const [streak, setStreak] = useState(0)
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [radarActive, setRadarActive] = useState(false)
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([])
  const [community, setCommunity] = useState<CommunityStats | null>(null)
  const tier = useMyTier()
  const [title, setTitle] = useState<string | null>(null)
  const [ville, setVille] = useState<string>('')
  const [now, setNow] = useState(() => Date.now())
  // Author pseudo lookup for the Spots récents carousel — populated
  // in a 2nd query after the recent spots load.
  const [recentAuthors, setRecentAuthors] = useState<Record<string, string>>({})
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
      const recentSpots = (recentRes.data ?? []) as Spot[]
      setRecent(recentSpots)
      setLoading(false)

      // Pseudo lookup for the Spots récents carousel. The recent fetch
      // doesn't join profiles, so we follow up with a single IN-query
      // over the distinct author ids. Failure is silent — we fall back
      // to "Spotter" in the carousel render.
      const authorIds = [
        ...new Set(recentSpots.map((s) => s.user_id).filter(Boolean)),
      ]
      if (authorIds.length) {
        supabase
          .from('profiles')
          .select('user_id, pseudo')
          .in('user_id', authorIds)
          .then(({ data }) => {
            if (!active) return
            const m: Record<string, string> = {}
            for (const p of (data ?? []) as {
              user_id: string
              pseudo: string | null
            }[]) {
              m[p.user_id] = (p.pseudo ?? '').trim() || 'Spotter'
            }
            setRecentAuthors(m)
          })
      }

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
          <h1
            className="font-display font-extrabold tracking-tighter text-fg"
            style={{ fontSize: '34px', lineHeight: 1, letterSpacing: '-0.03em' }}
          >
            Bonjour {name}
          </h1>
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
        {/* "Spot du jour / de la semaine" daily card was removed from
            Home per 2026-05-28 cleanup. Code for DailyCard /
            DailyCardSpotRow has been pruned along with the
            fetchRarestSpot call; the rarest-spot lookup can be
            reintroduced later if needed. */}

        {/* COMMUNITY STATS — single horizontal pill, ultra-light footprint. */}
        {community && (
          <section
            className="home-section-enter flex items-center justify-center gap-2.5 rounded-full bg-card px-4 py-2.5 text-xs"
            style={{ border: '1px solid var(--color-border)', animationDelay: '0ms' }}
          >
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              <span className="font-bold text-fg">
                {new Intl.NumberFormat('fr-FR').format(community.online_now)}
              </span>
              <span className="text-fg2">en ligne</span>
            </span>
            <span className="text-fg2/40" aria-hidden>
              ·
            </span>
            <span className="flex items-center gap-1.5">
              <Camera className="h-3 w-3 text-accent" />
              <span className="font-bold text-fg">
                {new Intl.NumberFormat('fr-FR').format(community.spots_today)}
              </span>
              <span className="text-fg2">aujourd'hui</span>
            </span>
          </section>
        )}

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

        {/* PROCHAIN GP — circuit image as backdrop + larger countdown. */}
        {nextGp && (
          <section
            className="home-section-enter"
            style={{ animationDelay: '300ms' }}
          >
            <SectionTitle
              icon={<Flag className="h-[18px] w-[18px]" />}
              label="Prochain GP"
            />
            <button
              onClick={() => navigate(`/f1/${nextGp.round}`)}
              className="tappable relative block w-full overflow-hidden rounded-4xl text-left"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {/* Circuit photo on the back layer; gradient on top keeps the
                  numbers and labels legible regardless of the underlying art. */}
              <img
                src={circuitImage(nextGp.round)}
                alt=""
                aria-hidden
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover opacity-50"
              />
              <div
                aria-hidden
                className="absolute inset-0"
                style={{
                  background:
                    'linear-gradient(160deg, rgba(74,15,22,0.85) 0%, rgba(15,5,7,0.92) 60%, rgba(0,0,0,0.95) 100%)',
                }}
              />
              <div className="relative p-5">
                <div className="flex items-center gap-3">
                  <span className="text-4xl leading-none">{nextGp.flag}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg font-extrabold tracking-tighter text-fg">
                      {nextGp.name}
                    </p>
                    <p className="truncate text-xs text-fg2">
                      {nextGp.circuit}
                    </p>
                  </div>
                </div>
                {/* Single-line digital countdown — "Xd : Yh : Zm" with
                    mono-spaced font, blinking colons, recessed glass
                    pill instead of the previous 4-tile grid. Reads as
                    a stadium scoreboard rather than 4 individual
                    timers. */}
                <div className="mt-5 flex justify-end">
                  <div
                    className="inline-flex items-baseline gap-1.5 rounded-xl px-4 py-2 font-mono tabular-nums tracking-wider text-white"
                    style={{
                      background: 'rgba(0, 0, 0, 0.40)',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      backdropFilter: 'saturate(160%) blur(8px)',
                      WebkitBackdropFilter: 'saturate(160%) blur(8px)',
                      fontSize: '22px',
                      fontWeight: 900,
                    }}
                  >
                    <span>{String(cd.d).padStart(2, '0')}</span>
                    <span
                      className="text-white/55"
                      style={{ fontSize: '14px' }}
                    >
                      d
                    </span>
                    <span className="colon-blink text-white/70">:</span>
                    <span>{String(cd.h).padStart(2, '0')}</span>
                    <span
                      className="text-white/55"
                      style={{ fontSize: '14px' }}
                    >
                      h
                    </span>
                    <span className="colon-blink text-white/70">:</span>
                    <span>{String(cd.m).padStart(2, '0')}</span>
                    <span
                      className="text-white/55"
                      style={{ fontSize: '14px' }}
                    >
                      m
                    </span>
                  </div>
                </div>
              </div>
            </button>
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

        {/* SPOTS RÉCENTS — single-card swipe carousel */}
        <section
          className="home-section-enter"
          style={{ animationDelay: '500ms' }}
        >
          <SectionTitle
            icon={<Flame className="h-[20px] w-[20px] text-accent" />}
            label="Spots récents"
            size="lg"
          />
          {recent.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-white/5 bg-card px-6 py-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
                <Car className="h-8 w-8 text-accent/70" />
              </div>
              <p className="mt-4 font-medium text-fg">
                Sois le premier à spotter ici
              </p>
              <button
                onClick={() => navigate('/new-spot')}
                className="mt-4 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-fg"
              >
                Spotter
              </button>
            </div>
          ) : (
            <RecentSpotsCarousel
              spots={recent}
              authors={recentAuthors}
              onOpen={(id) => navigate(`/spot/${id}`)}
            />
          )}
        </section>
      </div>
    </div>
  )
}

/** Single-card swipe carousel for the recent spots row. Same pattern
 *  as ChallengesCarousel: native CSS scroll-snap drives the swipe
 *  feel, scrollLeft is converted to an index for the dot indicator.
 *  Each card is 85% of the viewport so the next spot peeks ~15% on
 *  the right edge. Photo dominates the layout; brand+model land big
 *  at the bottom over a dark gradient, rarity chip floats top-left,
 *  spotter pseudo sits under the title. */
function RecentSpotsCarousel({
  spots,
  authors,
  onOpen,
}: {
  spots: Spot[]
  authors: Record<string, string>
  onOpen: (id: string) => void
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [idx, setIdx] = useState(0)

  function onScroll() {
    const el = scrollerRef.current
    if (!el) return
    const card = el.querySelector<HTMLDivElement>('[data-spot-card]')
    if (!card) return
    const gap = 12 // matches `gap-3` below
    const step = card.offsetWidth + gap
    const next = Math.round(el.scrollLeft / step)
    if (next !== idx && next >= 0 && next < spots.length) {
      setIdx(next)
    }
  }

  return (
    <div>
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="no-scrollbar -mx-5 overflow-x-auto"
        style={{
          scrollSnapType: 'x mandatory',
          scrollBehavior: 'smooth',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <div
          className="flex gap-3 px-5 pb-1"
          style={{ scrollPaddingInline: '20px' }}
        >
          {spots.map((s, i) => {
            const pseudo = authors[s.user_id] ?? 'Spotter'
            const rarityColor = RARITY_TEXT_COLOR[(s.rarity ?? 'commun') as Rarity]
            const rarityLabel = RARITY_PILL_LABEL[(s.rarity ?? 'commun') as Rarity]
            return (
              <button
                key={s.id}
                data-spot-card
                onClick={() => onOpen(s.id)}
                className="tappable flex-none flex-col text-left transition-all duration-300"
                style={{
                  flexBasis: 'calc(100vw - 60px)',
                  maxWidth: 'calc(100vw - 60px)',
                  scrollSnapAlign: 'start',
                  scrollSnapStop: 'always',
                  background: 'rgba(20, 20, 22, 0.50)',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  borderRadius: '28px',
                  padding: '12px',
                  backdropFilter: 'saturate(170%) blur(22px)',
                  WebkitBackdropFilter: 'saturate(170%) blur(22px)',
                  // shadow-2xl equivalent — big ambient + close contact
                  boxShadow:
                    '0 25px 50px rgba(0, 0, 0, 0.50), 0 8px 14px rgba(0, 0, 0, 0.30)',
                }}
                aria-label={`Spot ${i + 1} sur ${spots.length} — ${s.brand} ${s.model}`}
              >
                {/* Inner photo well — rounded-2xl, thin border, neutral
                    backdrop so the spot photo reads as a framed print
                    inside the larger glass card. */}
                <div
                  className="relative w-full overflow-hidden rounded-2xl"
                  style={{
                    aspectRatio: '4 / 5',
                    background: '#050505',
                    border: '1px solid rgba(255, 255, 255, 0.05)',
                  }}
                >
                  {s.photo_url ? (
                    <img
                      src={s.photo_url}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Car className="h-12 w-12 text-fg2/30" />
                    </div>
                  )}

                  {/* Glass rarity pill — black-50 + white-10 border +
                      backdrop-blur, with rarity-tinted text colour so
                      commun reads emerald, rare blue, ultra_rare violet,
                      unique gold. */}
                  <span
                    className="absolute left-3 top-3 rounded-full font-black uppercase"
                    style={{
                      background: 'rgba(0, 0, 0, 0.55)',
                      border: '1px solid rgba(255, 255, 255, 0.10)',
                      backdropFilter: 'saturate(160%) blur(12px)',
                      WebkitBackdropFilter: 'saturate(160%) blur(12px)',
                      padding: '4px 10px',
                      fontSize: '9px',
                      letterSpacing: '0.16em',
                      color: rarityColor,
                      boxShadow: `0 6px 14px ${rarityColor}26`,
                    }}
                  >
                    {rarityLabel}
                  </span>
                </div>

                {/* Caption block — model on its own row, then a tight
                    flex of avatar + pseudo + bullet + time. Sits inside
                    the same glass card as the photo (no app-bg gap). */}
                <div className="px-1 pb-1 pt-3">
                  <h4
                    className="truncate text-white"
                    style={{
                      fontSize: '14px',
                      fontWeight: 900,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {s.brand} {s.model}
                  </h4>
                  <div
                    className="mt-1.5 flex items-center gap-2 text-fg2"
                    style={{ fontSize: '11px', fontWeight: 600 }}
                  >
                    <div
                      className="flex h-4 w-4 flex-none items-center justify-center rounded-full bg-accent font-bold text-white"
                      style={{ fontSize: '9px' }}
                    >
                      {pseudo.charAt(0).toUpperCase()}
                    </div>
                    <span className="truncate">{pseudo}</span>
                    <span className="text-fg2/45">•</span>
                    <span className="truncate text-fg2/65" style={{ fontWeight: 500 }}>
                      {timeAgo(s.created_at)}
                    </span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {spots.length > 1 && (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {spots.map((_, i) => {
            const active = i === idx
            return (
              <span
                key={i}
                className="rounded-full transition-all"
                style={{
                  width: active ? 18 : 6,
                  height: 6,
                  background: active
                    ? 'linear-gradient(90deg, #FF4E68 0%, #E8203A 100%)'
                    : 'rgba(255,255,255,0.18)',
                  boxShadow: active
                    ? '0 0 12px rgba(232, 32, 58, 0.70)'
                    : undefined,
                  animation: active
                    ? 'carousel-dot-pop 380ms var(--ease-spring) both'
                    : undefined,
                }}
              />
            )
          })}
        </div>
      )}
    </div>
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
      className="tappable flex w-full items-center justify-around rounded-3xl px-3 py-4"
      style={{
        background: 'rgba(20, 20, 22, 0.55)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        backdropFilter: 'saturate(160%) blur(14px)',
        WebkitBackdropFilter: 'saturate(160%) blur(14px)',
      }}
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
              filter: `drop-shadow(0 0 6px ${ringColor}88)`,
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
      <span
        className="line-clamp-1 max-w-[80px] font-bold uppercase text-white/55"
        style={{
          fontSize: '9px',
          letterSpacing: '0.10em',
        }}
      >
        {challenge.title}
      </span>
    </div>
  )
}

