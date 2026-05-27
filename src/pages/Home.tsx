import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Settings,
  Car,
  Flame,
  Flag,
  Target,
  ChevronRight,
  Camera,
  Zap,
  Loader2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { categoryLabel, timeAgo, xpForSpot, type Spot } from '../lib/spots'
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
import RarityBadge from '../components/RarityBadge'
import TitleChip from '../components/TitleChip'
import { effectiveTitle } from '../lib/titles'
import { useMyTier } from '../lib/tier'
import {
  fetchRarestSpot,
  fetchSpottingPrediction,
  type PredictionResult,
  type RarestSpot,
  type SpotScore,
} from '../lib/spotPredictions'
import type { DailyChallengeContext } from '../lib/dailyChallenge'
import DailyChallengeCard from '../components/DailyChallengeCard'

type CommunityStats = {
  spots_today: number
  online_now: number
  top_brand: string | null
}

function SectionTitle({
  icon,
  label,
  action,
}: {
  icon: ReactNode
  label: string
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 font-display text-base font-bold text-fg">
        <span className="text-accent">{icon}</span>
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
  const [prediction, setPrediction] = useState<PredictionResult | null>(null)
  const [predictionLoading, setPredictionLoading] = useState(false)
  const [rarest, setRarest] = useState<RarestSpot | null>(null)
  const [spotterContext, setSpotterContext] =
    useState<DailyChallengeContext | null>(null)
  const [now, setNow] = useState(() => Date.now())

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
      const ville = (profRes.data?.ville as string | undefined)?.trim() ?? ''
      const profTitle =
        (profRes.data?.title as string | undefined)?.trim() || null
      setTitle(profTitle)

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
      setRecent((recentRes.data ?? []) as Spot[])
      setLoading(false)

      // Build the spotter context once — reused by both the spotting
      // prediction (city + weather) and the daily challenge (no city
      // strictly required). Computed asynchronously so the rest of the
      // page renders without waiting on it.
      ;(async () => {
        const { count: spotCount } = await supabase
          .from('spots')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
        const { data: mySpots } = await supabase
          .from('spots')
          .select('brand, model, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(60)
        const recentList = (mySpots ?? []) as {
          brand: string | null
          model: string | null
          created_at: string
        }[]
        const counts = new Map<string, number>()
        for (const r of recentList) {
          const b = (r.brand ?? '').trim()
          if (!b) continue
          counts.set(b, (counts.get(b) ?? 0) + 1)
        }
        const topBrands = [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([brand]) => brand)
        const lastCar = recentList[0]
          ? `${recentList[0].brand ?? ''} ${recentList[0].model ?? ''}`.trim()
          : undefined
        const ctx = {
          pseudo,
          city: ville || undefined,
          spot_count: spotCount ?? recentList.length,
          top_brands: topBrands,
          level: xpLevel((xpRes.data as number | null) ?? 0).name,
          last_car: lastCar,
        }
        if (!active) return
        setSpotterContext(ctx)

        // Spotting prediction — only fires once per day per city thanks
        // to the server cache. Skip when the user hasn't set their city.
        if (ville) {
          setPredictionLoading(true)
          const p = await fetchSpottingPrediction(ville, ctx)
          if (!active) return
          setPrediction(p)
          setPredictionLoading(false)
        }
      })()
      // Rarest spot of the day — falls back to the last 7 days
      // automatically when nothing was posted today.
      fetchRarestSpot().then((r) => {
        if (active) setRarest(r)
      })

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
    <div className="min-h-screen bg-bg px-5 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      {/* HEADER — compact greeting + identity pills + settings */}
      <header className="flex items-start justify-between pt-4 pb-3">
        <div className="min-w-0">
          <h1 className="font-display text-[28px] font-extrabold leading-none tracking-tighter text-fg">
            Bonjour {name}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {/* Title chip honours profiles.title — Fondateur shows in
                gold, manual special titles render with their own theme,
                otherwise the XP-derived ladder takes over. */}
            <TitleChip xp={xp} title={title} size="sm" />
            <span className="text-[11px] text-fg2">
              · {level.name} · {new Intl.NumberFormat('fr-FR').format(xp)} XP
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
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F59E0B]/15 px-3 py-1 text-xs font-bold text-[#F59E0B]">
                🔥 {streak} {streak > 1 ? 'jours' : 'jour'}
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
        <button
          onClick={() => navigate('/settings')}
          aria-label="Réglages"
          className="tappable flex h-9 w-9 flex-none items-center justify-center rounded-full bg-card text-fg2 transition-colors hover:text-fg"
        >
          <Settings className="h-5 w-5" />
        </button>
      </header>

      <div className="space-y-7 pb-10">
        {/* UNIFIED daily card — prediction (top) + rarest spot (bottom),
            joined by a hairline separator. Whole card stays under 220 px
            so it's fully visible above the fold without scrolling. */}
        <DailyCard
          prediction={prediction}
          predictionLoading={predictionLoading}
          rarest={rarest}
          onOpenSpot={(id) => navigate(`/spot/${id}`)}
        />

        {/* DAILY CHALLENGE — sits right under the prediction/rare card. */}
        {spotterContext && <DailyChallengeCard context={spotterContext} />}

        {/* COMMUNITY STATS — single horizontal pill, ultra-light footprint. */}
        {community && (
          <section
            className="flex items-center justify-center gap-2.5 rounded-full bg-card px-4 py-2.5 text-xs"
            style={{ border: '1px solid var(--color-border)' }}
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

        {/* LIVE EVENTS BANNER */}
        {liveEvents.length > 0 && (
          <section className="space-y-2">
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
          <section>
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
                <div className="mt-5 grid grid-cols-4 gap-2">
                  {[
                    { v: cd.d, l: 'JOURS' },
                    { v: cd.h, l: 'HEURES' },
                    { v: cd.m, l: 'MIN' },
                    { v: cd.s, l: 'SEC' },
                  ].map((u) => (
                    <div
                      key={u.l}
                      className="rounded-2xl bg-black/50 py-3.5 text-center backdrop-blur-sm"
                    >
                      <div className="font-display text-[28px] font-extrabold leading-none tabular-nums tracking-tighter text-fg">
                        {String(u.v).padStart(2, '0')}
                      </div>
                      <div className="mt-1 text-[9px] font-semibold tracking-widest text-fg2">
                        {u.l}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </button>
          </section>
        )}

        {/* 6 — CHALLENGES DE LA SEMAINE */}
        {challenges.length > 0 && (
          <section>
            <SectionTitle
              icon={<Target className="h-[18px] w-[18px]" />}
              label="Challenges de la semaine"
              action={
                <button
                  onClick={() => navigate('/challenges')}
                  className="flex items-center gap-0.5 text-xs font-medium text-fg/60 hover:text-fg"
                >
                  Tout voir
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              }
            />
            <div className="no-scrollbar -mx-5 overflow-x-auto">
              <div className="flex gap-3 px-5 pb-2">
                {challenges.map((c) => {
                  const pct = computeChallengePct(c)
                  return (
                    <button
                      key={c.id}
                      onClick={() => navigate('/challenges')}
                      className={`tappable relative flex w-[84%] min-h-[140px] flex-none flex-col rounded-3xl p-5 text-left ${
                        c.claimed ? 'bg-green-500/8' : ''
                      }`}
                      style={{
                        background: c.claimed
                          ? undefined
                          : 'linear-gradient(155deg, #1a1a1d 0%, #141416 60%, #0f0f11 100%)',
                        border: c.claimed
                          ? '1px solid rgba(34,197,94,0.35)'
                          : '1px solid var(--color-border)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p
                          className="font-display leading-tight tracking-tighter text-fg"
                          style={{ fontSize: '18px', fontWeight: 800 }}
                        >
                          {c.title}
                        </p>
                        <span
                          className="flex flex-none items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-[12px] font-extrabold uppercase tracking-wider text-fg"
                          style={{
                            boxShadow: '0 8px 22px rgba(232,32,58,0.50)',
                          }}
                        >
                          <Zap className="h-3.5 w-3.5" />+{c.xp_reward} XP
                        </span>
                      </div>
                      <p className="mt-2 text-[13px] leading-snug text-fg2">
                        {c.description}
                      </p>
                      <div className="mt-auto pt-4">
                        <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.07]">
                          <div
                            className={`h-full rounded-full transition-[width] duration-700 ease-out ${
                              c.completed ? 'bg-green-500' : 'bg-accent'
                            }`}
                            style={{
                              width: `${pct}%`,
                              boxShadow: c.completed
                                ? undefined
                                : '0 0 10px rgba(232,32,58,0.55)',
                            }}
                          />
                        </div>
                        <p className="label-up mt-2 text-[10px] text-fg2">
                          {c.claimed
                            ? '✓ COMPLÉTÉ'
                            : `${c.progress} / ${c.target_value}`}
                        </p>
                      </div>
                    </button>
                  )
                })}
                {challenges.length > 1 && (
                  <div className="flex w-6 flex-none items-center justify-center self-stretch text-fg2/40">
                    →
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* SPOTS RÉCENTS */}
        <section>
          <SectionTitle
            icon={<Flame className="h-[18px] w-[18px]" />}
            label="Spots récents 🔥"
            action={
              <button
                onClick={() => navigate('/feed')}
                className="flex items-center gap-0.5 text-xs font-medium text-fg/60 hover:text-fg"
              >
                Voir tout
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            }
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
            <div className="no-scrollbar -mx-5 flex gap-4 overflow-x-auto px-5 pb-2">
              {recent.map((s) => (
                <button
                  key={s.id}
                  onClick={() => navigate(`/spot/${s.id}`)}
                  className="tappable relative h-[180px] w-[200px] flex-none overflow-hidden rounded-3xl bg-card text-left"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  {s.photo_url ? (
                    <img
                      src={s.photo_url}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Car className="h-9 w-9 text-fg2/30" />
                    </div>
                  )}
                  {/* Rarity chip — discreet top-left */}
                  <span className="absolute left-2.5 top-2.5">
                    <RarityBadge rarity={s.rarity} size="xs" />
                  </span>
                  {/* Stronger gradient + brand/model layout */}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/85 to-transparent p-3.5 pt-16">
                    <p
                      title={`${s.brand} ${s.model}`}
                      className="line-clamp-2 font-display leading-[1.05] tracking-tighter text-white"
                      style={{ fontSize: '17px', fontWeight: 800 }}
                    >
                      {s.brand} {s.model}
                    </p>
                    <p className="mt-1 text-[11px] text-white/60">
                      {timeAgo(s.created_at)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// Per-condition gradient for the top half of the unified card. Plain
// dark for "mauvais" days so the card doesn't shout when there's
// nothing happening.
const PREDICTION_THEME: Record<SpotScore, { background: string }> = {
  bon: {
    background:
      'linear-gradient(155deg, #5a1018 0%, #2e0a0d 55%, #150708 100%)',
  },
  moyen: {
    background:
      'linear-gradient(155deg, #4a2a08 0%, #2e1804 55%, #150b02 100%)',
  },
  mauvais: {
    background:
      'linear-gradient(155deg, #1e2024 0%, #14161a 55%, #0d0e10 100%)',
  },
}

// One unified card: prediction on top (60 %), rarest spot on bottom
// (40 %), separated by a 1 px hairline. Capped at ~220 px total so the
// whole thing fits above the fold without scrolling. Each half is
// rendered only when its data is available — separator only when both
// halves are present.
function DailyCard({
  prediction,
  predictionLoading,
  rarest,
  onOpenSpot,
}: {
  prediction: PredictionResult | null
  predictionLoading: boolean
  rarest: RarestSpot | null
  onOpenSpot: (id: string) => void
}) {
  const hasPredictionSlot = prediction !== null || predictionLoading
  if (!hasPredictionSlot && !rarest) return null

  const theme = prediction
    ? PREDICTION_THEME[prediction.score_conditions]
    : PREDICTION_THEME.mauvais

  return (
    <section
      className="overflow-hidden rounded-[20px]"
      style={{
        background: 'var(--color-card)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* TOP — prediction */}
      {hasPredictionSlot && (
        <div
          className="relative px-4 py-3.5"
          style={{ background: theme.background }}
        >
          <div className="pr-14">
            <span className="label-up text-[9px] text-white/65">
              Meilleur moment pour spotter
            </span>
            {predictionLoading && !prediction ? (
              <div className="mt-1.5 flex items-center gap-2 text-[13px] text-white/70">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyse en cours…
              </div>
            ) : (
              <p
                className="mt-1.5 leading-snug text-white"
                style={{ fontSize: '16px', fontWeight: 600 }}
              >
                {prediction?.message}
              </p>
            )}
          </div>
          <span
            className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[9px] font-bold tracking-wider text-white/85 backdrop-blur"
            style={{ border: '1px solid rgba(255,255,255,0.12)' }}
          >
            IA 🎯
          </span>
        </div>
      )}

      {/* Hairline divider — only when both halves render. */}
      {hasPredictionSlot && rarest && (
        <div className="h-px" style={{ background: 'rgba(255,255,255,0.08)' }} />
      )}

      {/* BOTTOM — rarest spot, landscape thumb + meta-right layout. */}
      {rarest && <DailyCardSpotRow rarest={rarest} onOpen={onOpenSpot} />}
    </section>
  )
}

function DailyCardSpotRow({
  rarest,
  onOpen,
}: {
  rarest: RarestSpot
  onOpen: (id: string) => void
}) {
  const { spot, window: w, spotterPseudo, spotterAvatar, spotterTitle, spotterXp } = rarest
  const title = effectiveTitle(spotterXp, spotterTitle)
  const name = `${spot.brand} ${spot.model}`.trim() || 'Voiture'
  return (
    <button
      onClick={() => onOpen(spot.id)}
      className="tappable flex w-full items-center gap-3 p-3 text-left"
    >
      <div
        className="relative h-[88px] w-[120px] flex-none overflow-hidden rounded-xl bg-[#0a0a0a]"
        style={{ border: '1px solid rgba(255,255,255,0.06)' }}
      >
        {spot.photo_url ? (
          <img
            src={spot.photo_url}
            alt={name}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Car className="h-6 w-6 text-fg2/30" />
          </div>
        )}
        {/* rarity chip — discreet top-left */}
        <span className="absolute left-1.5 top-1.5">
          <RarityBadge rarity={spot.rarity} size="xs" />
        </span>
        {/* XP chip — discreet bottom-right, gold when ultra/legendary */}
        <span
          className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-extrabold tracking-wider backdrop-blur"
          style={
            spot.rarity === 'ultra_rare' || spot.rarity === 'unique'
              ? {
                  background:
                    'linear-gradient(120deg, #E0B341 0%, #FFD700 60%, #B8860B 100%)',
                  color: '#1a1306',
                }
              : {
                  background: 'rgba(0,0,0,0.65)',
                  color: 'var(--color-fg)',
                  border: '1px solid rgba(255,255,255,0.14)',
                }
          }
        >
          <Zap className="h-2.5 w-2.5" />+
          {xpForSpot(spot.estimated_price, spot.rarity)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="label-up text-[9px] text-fg2">
          {w === 'today' ? 'Spot du jour' : 'Spot de la semaine'}
        </p>
        <p
          className="mt-0.5 line-clamp-2 font-display leading-tight tracking-tighter text-white"
          style={{ fontSize: '14px', fontWeight: 800 }}
        >
          {name}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-fg2">
          {categoryLabel(spot.category)}
        </p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <div className="flex h-5 w-5 flex-none items-center justify-center overflow-hidden rounded-full bg-accent text-[10px] font-extrabold text-fg">
            {spotterAvatar ? (
              <img
                src={spotterAvatar}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              spotterPseudo.charAt(0).toUpperCase()
            )}
          </div>
          <span
            className={`truncate text-[11px] font-bold ${title.textClass}`}
          >
            {title.emoji && (
              <span className="mr-0.5" aria-hidden>
                {title.emoji}
              </span>
            )}
            {spotterPseudo}
          </span>
        </div>
      </div>
    </button>
  )
}

