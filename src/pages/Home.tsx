import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
import { challengeIcon, challengeMedallion } from '../lib/customIcons'
import { prefersReducedMotion } from '../lib/motion'
import { fetchLiveEvents, type LiveEvent } from '../lib/liveEvents'

// ── Traitement unique de toutes les cartes de l'accueil (refonte 27/09/2026).
// Remplace PREMIUM_BORDER / PREMIUM_SHADOW, qui empilaient un liseré rouge, un
// halo rouge et deux ombres internes sur chaque bloc — d'où le rendu
// « dashboard de jeu ». Ici : un verre sombre neutre, une bordure blanche à 6 %
// et rien d'autre. Pas de glow, pas de trame carbone en surimpression.
//
// Volontairement en constante plutôt qu'en classe utilitaire : les trois cartes
// existantes passent déjà leur style en inline, donc un seul objet réutilisé
// évite d'introduire un second mécanisme. ──
const CARD_STYLE = {
  background: 'rgba(20,20,20,0.6)',
  backdropFilter: 'blur(12px) saturate(150%)',
  WebkitBackdropFilter: 'blur(12px) saturate(150%)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: '20px',
} as const
import TitleChip, { StageChip } from '../components/TitleChip'
import { checkLevelUp } from '../components/LevelUpOverlay'
import LiquidXpBar from '../components/LiquidXpBar'
import { triggerStreakBreak } from '../components/StreakBreak'

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
function greetingFor(
  name: string,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  const h = new Date().getHours()
  if (h >= 23 || h < 12)
    return h >= 23
      ? t('home.greeting.night', { name })
      : t('home.greeting.morning', { name })
  if (h < 18) return t('home.greeting.afternoon', { name })
  return t('home.greeting.evening', { name })
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
  const { t } = useTranslation()
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

  // 1 Hz tick — feeds the Motorsport countdown frieze. Paused while the tab
  // is hidden (no point re-rendering the countdown off-screen — saves battery).
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null
    const stop = () => {
      if (t != null) {
        clearInterval(t)
        t = null
      }
    }
    const start = () => {
      if (t == null) t = setInterval(() => setNow(Date.now()), 1000)
    }
    const onVis = () => {
      if (document.hidden) stop()
      else {
        setNow(Date.now())
        start()
      }
    }
    onVis()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
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

      // Level-up check — compares the freshly-fetched XP tier against the
      // last one we saw and fires the full-screen overlay on advancement.
      void checkLevelUp((xpRes.data as number | null) ?? 0)

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
          const s = computeStreak(rows.map((r) => r.created_at))
          setStreak(s)
          // Streak-break detection: if we had a streak last time and it's
          // now 0, play the flame-extinguish overlay once.
          try {
            const prev = Number(localStorage.getItem('revs_last_streak') ?? '0')
            if (prev > 0 && s === 0) triggerStreakBreak()
            localStorage.setItem('revs_last_streak', String(s))
          } catch {
            /* storage unavailable — skip break detection */
          }
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

  // Stable handlers so the memoised cards below don't re-render on the 1 Hz tick.
  const goChallenges = useCallback(() => navigate('/challenges'), [navigate])
  const goRanking = useCallback(() => navigate('/classement'), [navigate])
  const goSettings = useCallback(() => navigate('/settings'), [navigate])

  const upcomingGp = GP_2026.find((g) => new Date(g.date).getTime() >= now)
  const gpDiff = upcomingGp ? new Date(upcomingGp.date).getTime() - now : 0
  const daysToNextGp = upcomingGp
    ? Math.max(0, Math.ceil(gpDiff / 86_400_000))
    : null
  // Only surface the GP frieze when the race is within the next 7 days.
  // Always surface the next Grand Prix (no 7-day window) so the card never
  // disappears between races.
  const nextGp = upcomingGp ?? null

  if (loading) {
    return (
      <div className="min-h-screen bg-bg px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between pt-3 pb-5">
          <Skeleton className="h-3 w-40 rounded-full" />
          <Skeleton className="h-3 w-20 rounded-full" />
        </div>
        <Skeleton className="h-8 w-56 rounded-xl" />
        <div className="mt-4 flex gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
        <Skeleton className="mt-4 h-2 w-full rounded-full" />
        <div className="mt-6 space-y-2.5">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
        <Skeleton className="mt-6 h-[72px] w-full rounded-3xl" />
        <div className="mt-6 space-y-4">
          <Skeleton className="h-24 w-full rounded-[20px]" />
          <Skeleton className="h-32 w-full rounded-[20px]" />
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
          <span className="text-fg/45">{t('home.onlineNow')}</span>
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
          aria-label={t('home.viewProfile')}
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

      {/* ─── 2 · IDENTITÉ — greeting + badges, à même le fond ───
          Plus de conteneur glass ici : la refonte du 27/09/2026 a retiré le
          CockpitWidget (un bloc arrondi-36px qui empilait identité, jauges et
          bouton). Les éléments respirent maintenant directement sur le fond. */}
      <div className="min-w-0 px-1 pt-1">
        <h1
          className="font-display font-extrabold tracking-tighter text-fg"
          style={{ fontSize: '30px', lineHeight: 1, letterSpacing: '-0.03em' }}
        >
          {greetingFor(name, t)}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <TitleChip xp={xp} title={title} size="sm" />
          <StageChip size="sm" />
        </div>
      </div>

      {/* ─── 3 · XP — progression vers le niveau suivant ─── */}
      <div className="mb-3 mt-4 px-1">
        <LiquidXpBar pct={lvl.pct} />
      </div>

      {/* ─── STREAK — pastille rouge, sous la barre d'XP ─── */}
      {streak > 0 && (
        <div className="mb-3 flex px-1" data-tour="streak">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-bold"
            style={{
              background: 'rgba(232,32,58,0.16)',
              color: '#FF7080',
              border: '1px solid rgba(232,32,58,0.40)',
            }}
          >
            🔥 {streak > 1 ? t('home.streak.days_plural', { count: streak }) : t('home.streak.days', { count: streak })}
          </span>
        </div>
      )}

      {/* ─── 4 · MISSIONS — trois cartes horizontales empilées ─── */}
      <div className="mt-5">
        <MissionList challenges={challenges} onTap={goChallenges} />
      </div>

      {/* ─── 5 · SPOTTER — l'action principale, elle doit dominer l'écran.
          24px de respiration au-dessus et en dessous. ─── */}
      <div className="my-6">
        <SpotterAction />
      </div>

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
                    {ev.location} ·{' '}
                    {ev.spot_count > 1
                      ? t('home.live.spots_plural', { count: ev.spot_count })
                      : t('home.live.spots', { count: ev.spot_count })}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 flex-none text-fg/40" />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* ─── 6 · CLASSEMENT VILLE puis 7 · COUNTDOWN F1 ─── */}
      <div className="mt-10 space-y-4">
        <div data-tour="ranking">
          <CityRankCard
            rank={cityRank}
            daysToNextGp={daysToNextGp}
            spotsThisWeek={spotsThisWeek}
            onTap={goRanking}
            onSetCity={goSettings}
          />
        </div>

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

      {/* ─── 8 · DERNIERS SPOTS — contenu social, fin de page ─── */}
      <LatestSpots />
    </div>
  )
}

// ─────────────────────────────── MISSIONS ───────────────────────────────

/** Une mission = une carte horizontale compacte. Remplace les RPM gauges
 *  (MiniSpeedometer SVG) de l'ancien cockpit : trois cadrans côte à côte
 *  rendaient le progrès difficile à lire et occupaient toute la largeur pour
 *  trois libellés tronqués. Ici chaque mission a sa ligne, son nom en entier,
 *  une barre fine et un compteur aligné à droite. */
function MissionCard({
  icon,
  label,
  pct,
  progress,
  target,
  done,
  onTap,
}: {
  icon: string
  label: string
  pct: number
  progress: number
  target: number
  done: boolean
  onTap: () => void
}) {
  return (
    <button
      onClick={onTap}
      aria-label={label}
      className="tappable flex w-full items-center gap-3 text-left transition-transform active:scale-[0.99]"
      style={{
        background: 'rgba(20,20,20,0.6)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '16px',
        padding: '14px 16px',
      }}
    >
      <img
        src={icon}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className="h-8 w-8 flex-none rounded-lg object-cover"
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-fg">
          {label}
        </span>
        {/* Barre de progression fine — 4px, piste blanche à 8 %, remplissage
            dégradé rouge REVS. Le vert signale une mission terminée. */}
        <span
          className="mt-2 block h-1 w-full overflow-hidden rounded-full"
          style={{ background: 'rgba(255,255,255,0.08)' }}
        >
          <span
            className="block h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: done
                ? 'linear-gradient(90deg, #16A34A, #22C55E)'
                : 'linear-gradient(90deg, #C41F2E, #E8203A)',
              transition: 'width 600ms cubic-bezier(0.22,1,0.36,1)',
            }}
          />
        </span>
      </span>
      <span
        className="flex-none tabular-nums text-sm font-bold"
        style={{ color: done ? '#22C55E' : 'rgb(var(--color-fg-2))' }}
      >
        {progress}/{target}
      </span>
    </button>
  )
}

function MissionList({
  challenges,
  onTap,
}: {
  challenges: Challenge[]
  onTap: () => void
}) {
  const { t } = useTranslation()
  const slots = challenges.slice(0, 3)

  if (slots.length === 0) {
    return (
      <button
        onClick={onTap}
        className="tappable flex w-full items-center justify-between gap-3 text-left transition-transform active:scale-[0.99]"
        style={{
          background: 'rgba(20,20,20,0.6)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '16px',
          padding: '14px 16px',
        }}
      >
        <span className="text-sm font-medium text-fg/70">
          {t('home.missions.empty')}
        </span>
        <ChevronRight className="h-4 w-4 flex-none text-fg/30" />
      </button>
    )
  }

  return (
    <div data-tour="speedometers" className="flex flex-col gap-2.5">
      {slots.map((c) => (
        <MissionCard
          key={c.id}
          icon={challengeIcon(c)}
          label={c.title}
          pct={Math.min(100, Math.max(0, computeChallengePct(c)))}
          progress={Math.min(c.progress, c.target_value)}
          target={c.target_value}
          done={c.claimed || c.completed}
          onTap={onTap}
        />
      ))}
    </div>
  )
}

// ──────────────────────── DERNIERS SPOTS COMMUNAUTÉ ────────────────────────

type LatestSpot = {
  id: string
  brand: string
  model: string
  year: number | null
  photo_url: string
  user_id: string
}

/** Carrousel horizontal des cinq derniers spots publiés, tous auteurs
 *  confondus. Donne à l'accueil une respiration « réseau social » : du contenu
 *  produit par d'autres, pas seulement ses propres compteurs.
 *
 *  ── Trois écarts avec la spec, imposés par le schéma réel ──
 *  - `spots.is_public` n'existe pas. La colonne `is_public` est sur `profiles`,
 *    pas sur `spots` : tous les spots sont publics en lecture
 *    (`spots public read using (true)`). Le filtre retenu est `expires_at`,
 *    le même que la Carte, qui écarte les spots périmés.
 *  - `image_url` s'appelle `photo_url`.
 *  - `profiles(pseudo, avatar_url)` ne peut pas être imbriqué : `spots.user_id`
 *    référence `auth.users`, pas `profiles`, donc PostgREST n'a aucune clé
 *    étrangère à suivre. Les pseudos sont donc résolus en seconde requête —
 *    exactement le motif déjà utilisé par Feed.tsx et Map.tsx. Et la colonne
 *    d'avatar s'appelle `avatar`, pas `avatar_url`. */
function LatestSpots() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [spots, setSpots] = useState<LatestSpot[]>([])
  const [names, setNames] = useState<Record<string, string>>({})

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('spots')
        .select('id, brand, model, year, photo_url, user_id')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(5)
      if (!active) return
      const rows = (data ?? []) as LatestSpot[]
      setSpots(rows)
      const ids = [...new Set(rows.map((r) => r.user_id))]
      if (ids.length === 0) return
      const { data: profs } = await supabase
        .from('profiles')
        .select('user_id, pseudo')
        .in('user_id', ids)
      if (!active) return
      const map: Record<string, string> = {}
      for (const pr of (profs ?? []) as { user_id: string; pseudo: string | null }[]) {
        if (pr.pseudo) map[pr.user_id] = pr.pseudo
      }
      setNames(map)
    })()
    return () => {
      active = false
    }
  }, [])

  if (spots.length === 0) return null

  return (
    <section className="home-section-enter mt-10">
      <h2 className="mb-3 flex items-center gap-2 px-1 text-lg font-bold text-fg">
        <span aria-hidden>📸</span>
        {t('home.latestSpots.title')}
      </h2>
      {/* Défilement horizontal aimanté. -mx-5 px-5 fait déborder la piste
          jusqu'aux bords de l'écran tout en gardant l'alignement du contenu. */}
      <div className="no-scrollbar -mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1">
        {spots.map((sp) => (
          <button
            key={sp.id}
            onClick={() => navigate(`/spot/${sp.id}`)}
            className="tappable relative flex-none snap-start overflow-hidden text-left transition-transform active:scale-[0.98]"
            style={{
              width: '200px',
              aspectRatio: '4 / 3',
              borderRadius: '16px',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
            aria-label={`${sp.brand} ${sp.model}`}
          >
            <img
              src={sp.photo_url}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-3/5"
              style={{
                background:
                  'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.45) 45%, transparent 100%)',
              }}
            />
            <span className="absolute inset-x-0 bottom-0 block min-w-0 p-2.5">
              <span className="block truncate text-sm font-bold text-white">
                {sp.brand} {sp.model}
              </span>
              {sp.year != null && (
                <span className="block text-xs text-white/70">{sp.year}</span>
              )}
              {names[sp.user_id] && (
                <span className="block truncate text-xs text-white/60">
                  @{names[sp.user_id]}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </section>
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
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  function onCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return // user backed out of the camera
    setPendingPhoto(file)
    navigate('/new-spot')
  }

  return (
    <div className="mt-6">
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
        className="tappable flex w-full items-center justify-center gap-3 rounded-full"
        style={{
          padding: '12px 28px',
          background:
            'linear-gradient(135deg, #FF3B52 0%, #E8203A 58%, #C7172A 100%)',
          // Tight neon halo (replaces the diffuse 32px drop) for a
          // premium, minimalist red glow. Inset highlights kept.
          boxShadow:
            '0 0 15px rgba(239,68,68,0.5), inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -2px 6px rgba(0,0,0,0.25)',
        }}
        aria-label={t('home.spotter.aria')}
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
          {t('home.spotter.label')}
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
  const { t } = useTranslation()
  const reduce = prefersReducedMotion()
  const cd = {
    d: Math.max(0, Math.floor(gpDiff / 86400000)),
    h: Math.max(0, Math.floor((gpDiff % 86400000) / 3600000)),
    m: Math.max(0, Math.floor((gpDiff % 3600000) / 60000)),
  }
  const blocks = [
    { v: String(cd.d), label: t('home.gp.days') },
    { v: String(cd.h).padStart(2, '0'), label: t('home.gp.hours') },
    { v: String(cd.m).padStart(2, '0'), label: t('home.gp.minutes') },
  ]

  return (
    <button
      onClick={onTap}
      className="home-section-enter tappable relative block w-full overflow-hidden p-4 pb-6 text-left transition-transform active:scale-[0.99]"
      style={CARD_STYLE}
      aria-label={t('home.gp.aria', { name })}
    >
      {/* Top — big flag + GP name + red F1 pill */}
      <div className="flex items-center gap-2.5">
        <span aria-hidden style={{ fontSize: '24px', lineHeight: 1 }}>
          {flag}
        </span>
        <p className="min-w-0 flex-1 truncate text-[17px] font-bold text-white">
          {name}
        </p>
        <img
          src={challengeMedallion('vitesse', 30)}
          alt="F1"
          width={30}
          height={30}
          className="h-[30px] w-[30px] flex-none"
        />
        <span className="sr-only">F1</span>
      </div>

      {/* Circuit — grey italic */}
      <p className="mt-1 truncate text-[12px] italic text-white/45">{circuit}</p>

      {/* Countdown — three F1-style square blocks with red separators */}
      {gpDiff > 0 ? (
        <div className="mt-3.5 flex items-stretch gap-2">
          {blocks.map((b, i) => (
            <div key={b.label} className="flex flex-1 items-stretch gap-2">
              <div
                className="flip-digit flex flex-1 flex-col items-center justify-center py-2.5"
                style={{ borderRadius: '10px' }}
              >
                <span
                  className="font-display font-extrabold leading-none tabular-nums"
                  style={{
                    fontSize: '28px',
                    color: '#fff',
                    textShadow: '0 1px 2px rgba(0,0,0,0.8), 0 0 12px rgba(232,32,58,0.20)',
                  }}
                >
                  {b.v}
                </span>
                <span
                  className="mt-1.5 font-bold uppercase text-white/40"
                  style={{ fontSize: '10px', letterSpacing: '0.1em' }}
                >
                  {b.label}
                </span>
              </div>
              {i < blocks.length - 1 && (
                <span
                  aria-hidden
                  className="flex items-center font-display font-extrabold"
                  style={{
                    fontSize: '18px',
                    color: '#E8203A',
                    textShadow: '0 0 8px rgba(232,32,58,0.7)',
                  }}
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
          {t('home.gp.live')}
        </p>
      )}

      {/* Real(istic) circuit silhouette — glowing red trace with a light
          point lapping the track like a car on a hot lap. */}
      <svg
        aria-hidden
        viewBox={CIRCUIT_VIEWBOX}
        preserveAspectRatio="xMidYMid meet"
        className="circuit-glow mt-4 w-full"
        style={{ height: 70 }}
        fill="none"
      >
        {/* Dim full track */}
        <path
          d={circuitPath(round)}
          stroke="#E8203A"
          strokeOpacity={0.3}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Bright track (also the motion path for the light) */}
        <path
          id={`circuit-${round}`}
          d={circuitPath(round)}
          stroke="#E8203A"
          strokeOpacity={0.9}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* The car — a glowing light lapping the circuit */}
        {!reduce && (
          <circle r={3.1} fill="#ffffff">
            <animateMotion dur="7s" repeatCount="indefinite" rotate="auto">
              <mpath href={`#circuit-${round}`} />
            </animateMotion>
          </circle>
        )}
      </svg>

      {/* Contextual info line under the circuit */}
      <p className="mt-2 text-[11px] text-white/45">
        🏁{' '}
        {cd.d > 1
          ? t('home.gp.raceIn_plural', { count: cd.d })
          : t('home.gp.raceIn', { count: cd.d })}
        {lastWinner && t('home.gp.lastWinner', { winner: lastWinner })}
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
const CityRankCard = memo(function CityRankCard({
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
  const { t } = useTranslation()
  if (rank === undefined) return null // still loading — no flash

  const cardStyle = CARD_STYLE

  // No city set → invite to add one.
  if (!rank) {
    return (
      <section className="home-section-enter">
        <button
          onClick={onSetCity}
          className="tappable flex w-full items-center justify-between gap-3 p-4 text-left transition-transform active:scale-[0.99]"
          style={cardStyle}
        >
          <p className="flex items-center gap-2 text-sm font-medium text-white/80">
            <img
              src={challengeMedallion('classement', 22)}
              alt=""
              aria-hidden
              width={22}
              height={22}
              className="inline-block h-[22px] w-[22px] flex-none"
            />
            {t('home.city.addCity')}
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
        className="tappable relative block w-full overflow-hidden py-4 pl-5 pr-4 text-left transition-transform active:scale-[0.99]"
        style={cardStyle}
      >
        {/* Trame carbone retirée le 27/09/2026 — le verre neutre de CARD_STYLE
            suffit, et la texture tirait la carte vers le « dashboard de jeu ».
            La classe .carbon-weave reste disponible si besoin ponctuel. */}
        {/* Reinforced gold left border — metallic gradient + glow */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0"
          style={{
            width: '3px',
            background:
              'linear-gradient(180deg, #FBE7B6 0%, #E8C979 30%, #C8A96E 60%, rgba(200,169,110,0) 100%)',
            boxShadow: '0 0 12px rgba(200,169,110,0.55)',
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
          <span className="flex flex-1 items-center gap-2 text-[14px] font-bold text-white">
            <img
              src={challengeMedallion('classement', 24)}
              alt=""
              aria-hidden
              width={24}
              height={24}
              className="inline-block h-6 w-6 flex-none"
            />
            {t('home.city.ranking')}
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
                className="font-display italic leading-none"
                style={{
                  fontSize: '52px',
                  fontWeight: 900,
                  letterSpacing: '-0.04em',
                  backgroundImage:
                    'linear-gradient(155deg, #FCEFC7 0%, #EFCF83 30%, #C8A96E 52%, #8E6E38 74%, #F0DAA0 100%)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  color: 'transparent',
                  filter:
                    'drop-shadow(0 2px 5px rgba(0,0,0,0.5)) drop-shadow(0 0 16px rgba(200,169,110,0.4))',
                }}
              >
                #1
              </p>
              <p
                className="mt-2 text-[14px] font-bold"
                style={{ color: '#C8A96E' }}
              >
                👑 {t('home.city.youDominate', { city: rank.city })}
              </p>
              <p className="mt-1.5 text-[11px] text-white/40">
                {daysToNextGp != null &&
                  (daysToNextGp > 1
                    ? t('home.city.nextGp_plural', { count: daysToNextGp })
                    : t('home.city.nextGp', { count: daysToNextGp }))}
                {spotsThisWeek > 1
                  ? t('home.city.spotsThisWeek_plural', { count: spotsThisWeek })
                  : t('home.city.spotsThisWeek', { count: spotsThisWeek })}
              </p>
            </div>

            {/* Mini podium — your rank (#1) in glowing red, next two metallic
                grey; each bar rises on mount (staggered). */}
            <div className="flex flex-none items-end gap-1.5" aria-hidden>
              {[
                { h: 60, me: true },
                { h: 45, me: false },
                { h: 30, me: false },
              ].map((b, i) => (
                <span
                  key={i}
                  className="home-bar-rise rounded-t-[3px]"
                  style={{
                    width: 11,
                    height: b.h,
                    background: b.me
                      ? 'linear-gradient(180deg, #FF5A6E 0%, #E8203A 55%, #B3121F 100%)'
                      : 'linear-gradient(180deg, #3a3a3d 0%, #202022 60%, #161617 100%)',
                    boxShadow: b.me
                      ? '0 0 14px rgba(232,32,58,0.6), inset 0 1px 0 rgba(255,255,255,0.25)'
                      : 'inset 0 1px 0 rgba(255,255,255,0.10)',
                    animationDelay: `${0.15 + i * 0.12}s`,
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
              {t('home.city.stillNeed')}{' '}
              <span className="font-bold text-white">{t('home.city.xpAmount', { count: rank.gapToAbove })}</span>{' '}
              {t('home.city.toPass')}{' '}
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
                  background: 'linear-gradient(90deg, #B3121F 0%, #E8203A 60%, #FF5A6E 100%)',
                  boxShadow: '0 0 10px rgba(232,32,58,0.6)',
                  transition: 'width 800ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              />
            </div>
          </>
        ) : (
          <p className="relative mt-3 text-[13px] text-white/65">
            {t('home.city.spotToEnter', { city: rank.city })}
          </p>
        )}

        <p className="relative mt-2 text-right text-[11px] font-medium text-white/35">
          {rank.total > 1
            ? t('home.city.spotters_plural', { count: rank.total })
            : t('home.city.spotters', { count: rank.total })}
        </p>
      </button>
    </section>
  )
})
