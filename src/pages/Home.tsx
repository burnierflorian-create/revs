import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Image as ImageIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { setPendingPhoto } from '../lib/pendingPhoto'
import { GP_2026 } from '../lib/f1'
import { xpLevel } from '../lib/xp'
import { challengeIcon } from '../lib/customIcons'
import { Skeleton } from '../components/Skeleton'
import {
  challengePct as computeChallengePct,
  fetchActiveChallenges,
  type Challenge,
} from '../lib/challenges'
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
//
// 28/09/2026 : les couleurs passent par les variables du design system au lieu
// d'être figées. Elles l'étaient en valeurs sombres, si bien qu'en thème clair
// les cartes restaient noires sur fond clair. --color-glass et --color-border
// basculent, eux, avec le thème.
const CARD_STYLE = {
  background: 'var(--color-glass-mid)',
  backdropFilter: 'blur(12px) saturate(150%)',
  WebkitBackdropFilter: 'blur(12px) saturate(150%)',
  border: '1px solid var(--color-border)',
  borderRadius: '20px',
} as const
import { checkLevelUp } from '../components/LevelUpOverlay'
import { triggerStreakBreak } from '../components/StreakBreak'
import { RevsMark } from '../components/Logo'

type CommunityStats = {
  spots_today: number
  online_now: number
  top_brand: string | null
}


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
  // Quatre chiffres réellement calculés à partir des spots de l'utilisateur.
  // Aucun n'est codé en dur : à zéro spot, tout affiche 0.
  const [stats, setStats] = useState({ spots: 0, brands: 0, models: 0, streak: 0 })
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
        // brand et model s'ajoutent à created_at : la requête servait déjà au
        // calcul de la série, elle alimente maintenant aussi les stats — sans
        // aller-retour supplémentaire.
        .select('created_at, brand, model')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200)
        .then(({ data }) => {
          if (!active) return
          const rows = (data ?? []) as {
            created_at: string
            brand: string | null
            model: string | null
          }[]
          const s = computeStreak(rows.map((r) => r.created_at))
          const uniq = (v: (string | null)[]) =>
            new Set(v.map((x) => x?.trim().toLowerCase()).filter(Boolean)).size
          setStats({
            spots: rows.length,
            brands: uniq(rows.map((r) => r.brand)),
            models: uniq(rows.map((r) => r.model)),
            streak: s,
          })
          // Streak-break detection: if we had a streak last time and it's
          // now 0, play the flame-extinguish overlay once.
          try {
            const prev = Number(localStorage.getItem('revs_last_streak') ?? '0')
            if (prev > 0 && s === 0) triggerStreakBreak()
            localStorage.setItem('revs_last_streak', String(s))
          } catch {
            /* storage unavailable — skip break detection */
          }
        })

    })()
    return () => {
      active = false
    }
  }, [])

  const lvl = xpLevel(xp)

  // Handler stable : le tick 1 Hz ne doit pas recréer la fonction.
  const goChallenges = useCallback(() => navigate('/challenges'), [navigate])

  const upcomingGp = GP_2026.find((g) => new Date(g.date).getTime() >= now)
  const gpDiff = upcomingGp ? new Date(upcomingGp.date).getTime() - now : 0
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
    <div className="relative min-h-screen bg-bg pb-10 text-fg">
      {/* ══════════════════ 1-2 · HEADER + HERO ══════════════════
          L'image n'est pas une carte : elle EST le fond du haut de page.
          Le header vit dedans, posé sur le dégradé sombre du sommet. */}
      <section
        className="relative isolate overflow-hidden"
        style={{ minHeight: 'clamp(430px, 64vh, 660px)' }}
      >
        {/* <picture> sert le WebP portrait aux téléphones et le paysage
            au-delà ; le PNG ne sert que de repli. L'image est marquée
            haute priorité : c'est le plus grand élément de la page, donc
            celui que mesure le LCP. */}
        <picture>
          <source
            media="(max-width: 600px)"
            srcSet="/images/hero-home-mobile.webp"
            type="image/webp"
          />
          <source srcSet="/images/hero-home.webp" type="image/webp" />
          <img
            src="/images/hero-home.png"
            alt=""
            aria-hidden
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: 'center 58%' }}
          />
        </picture>

        {/* Dégradés de lisibilité. Volontairement PAS un voile noir uniforme :
            la voiture doit rester visible au milieu. Le sommet s'assombrit
            pour le header, le bas fond vers --color-bg pour rejoindre la page
            sans couture — y compris en thème clair, où --color-bg est clair. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom,' +
              ' rgb(0 0 0 / 0.72) 0%,' +
              ' rgb(0 0 0 / 0.20) 24%,' +
              ' rgb(0 0 0 / 0.06) 40%,' +
              ' rgb(0 0 0 / 0.45) 66%,' +
              ' rgb(0 0 0 / 0.80) 84%,' +
              ' rgb(var(--color-bg)) 100%)',
          }}
        />

        {/* ── Header compact ── */}
        <header className="relative flex items-center gap-3 px-5 pt-[max(0.9rem,calc(env(safe-area-inset-top)+0.4rem))]">
          <RevsMark height={17} title="REVS" />

          {/* Groupe « en ligne » : whitespace-nowrap + min-w-0 pour qu'il se
              tronque plutôt que de passer à la ligne sur un écran de 320 px. */}
          <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-white/75">
            <span className="relative flex h-1.5 w-1.5 flex-none" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            <span className="tabular-nums">{community?.online_now ?? 0}</span>
            <span className="truncate text-white/45">{t('home.onlineShort')}</span>
          </span>

          <button
            onClick={() => navigate('/profile')}
            className="tappable ml-auto inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1"
            style={{
              background: 'rgb(0 0 0 / 0.42)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: '1px solid rgb(255 255 255 / 0.12)',
            }}
            aria-label={t('home.viewProfile')}
          >
            <span aria-hidden style={{ fontSize: '11px' }}>🎯</span>
            {/* Le nom de palier peut être long (« Maître Spotter ») : il est
                borné pour que la pastille ne pousse jamais le header sur deux
                lignes. */}
            <span
              className="max-w-[86px] truncate font-bold"
              style={{ fontSize: '11px', color: 'rgb(var(--color-accent))' }}
            >
              {lvl.name}
            </span>
            <span className="text-white/25" style={{ fontSize: '11px' }}>·</span>
            <span
              className="font-extrabold tabular-nums text-white"
              style={{ fontSize: '11px' }}
            >
              {new Intl.NumberFormat('fr-FR').format(Math.floor(xp))} XP
            </span>
          </button>
        </header>

        {/* ── Identité + stats, calées en bas du hero ── */}
        <div className="absolute inset-x-0 bottom-0 px-5 pb-5">
          <h1
            className="home-rise font-display font-black leading-[1.04] tracking-tight text-white"
            style={{ fontSize: 'clamp(28px, 8.4vw, 38px)' }}
          >
            {greetingFor(name, t)}
          </h1>
          <p className="home-rise home-rise--2 mt-1 text-[13.5px] font-medium text-white/65">
            {title ?? lvl.name}
          </p>

          <QuickStats stats={stats} className="home-rise home-rise--3 mt-4" />
        </div>
      </section>

      {/* ══════════════════ 4 · SPOTTER ══════════════════ */}
      <div className="home-rise home-rise--4 px-5 pt-5">
        <SpotterAction />
      </div>

      {/* ══════════════════ 5 · ÉVÉNEMENT À VENIR ══════════════════ */}
      <section className="px-5 pt-8">
        <SectionHead
          title={t('home.upcomingEvent')}
          onMore={() => navigate(liveEvents.length > 0 ? '/events' : '/f1')}
        />
        <UpcomingEvent
          live={liveEvents[0] ?? null}
          gp={nextGp}
          msLeft={gpDiff}
          onTap={() =>
            liveEvents.length > 0
              ? navigate(`/event/${liveEvents[0].id}/live`)
              : nextGp && navigate(`/f1/${nextGp.round}`)
          }
        />
      </section>

      {/* ══════════════════ 6 · DÉFIS DU MOMENT ══════════════════ */}
      <section className="pt-8">
        <div className="px-5">
          <SectionHead title={t('home.currentChallenges')} onMore={goChallenges} />
        </div>
        <ChallengeStrip challenges={challenges} onTap={goChallenges} />
      </section>
    </div>
  )
}

// ═══════════════════════════ EN-TÊTE DE SECTION ═══════════════════════════

function SectionHead({ title, onMore }: { title: string; onMore: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="font-display text-[17px] font-extrabold tracking-tight text-fg">
        {title}
      </h2>
      <button
        onClick={onMore}
        className="tappable inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-fg/50"
      >
        {t('home.seeAll')}
        <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ═══════════════════════════ STATS RAPIDES ═══════════════════════════
//
// Un seul bloc, quatre colonnes séparées par des filets très fins.
//
// « Villes » avait été demandé en quatrième stat, mais la table `spots` n'a
// aucune colonne de ville et rien ne géocode les spots à l'envers : le chiffre
// aurait été inventé. Il est remplacé par « Série », déjà calculée plus haut.
// « Badges » a été écarté pour la même raison : computeUnlocks() réclame le
// rang global, les likes reçus et les compteurs de course, soit cinq requêtes
// de plus au chargement de l'accueil — et un contexte partiel donnerait un
// nombre faux.

function QuickStats({
  stats,
  className = '',
}: {
  stats: { spots: number; brands: number; models: number; streak: number }
  className?: string
}) {
  const { t } = useTranslation()
  const cells: [number, string][] = [
    [stats.spots, t('home.stats.spots')],
    [stats.brands, t('home.stats.brands')],
    [stats.models, t('home.stats.models')],
    [stats.streak, t('home.stats.streak')],
  ]
  return (
    <div
      className={`flex items-stretch ${className}`}
      style={{
        background: 'rgb(0 0 0 / 0.42)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgb(255 255 255 / 0.10)',
        borderRadius: '16px',
        padding: '11px 4px',
      }}
    >
      {cells.map(([value, label], i) => (
        <div
          key={label}
          className="min-w-0 flex-1 px-1 text-center"
          style={
            i > 0 ? { borderLeft: '1px solid rgb(255 255 255 / 0.09)' } : undefined
          }
        >
          <p
            className="font-display font-extrabold tabular-nums leading-none text-white"
            style={{ fontSize: 'clamp(16px, 5vw, 20px)' }}
          >
            {value}
          </p>
          <p className="mt-1 truncate text-[10.5px] font-medium text-white/50">
            {label}
          </p>
        </div>
      ))}
    </div>
  )
}

// ═══════════════════════════ ÉVÉNEMENT À VENIR ═══════════════════════════
//
// Un événement en direct prime sur le Grand Prix à venir. Aucune donnée n'est
// fabriquée : sans live ET sans GP au calendrier, on affiche un état vide.

function UpcomingEvent({
  live,
  gp,
  msLeft,
  onTap,
}: {
  live: LiveEvent | null
  gp: (typeof GP_2026)[number] | null
  msLeft: number
  onTap: () => void
}) {
  const { t } = useTranslation()

  if (!live && !gp) {
    return (
      <div
        className="px-4 py-5 text-center text-[13px] text-fg/45"
        style={{ ...CARD_STYLE }}
      >
        {t('home.noEvent')}
      </div>
    )
  }

  const d = Math.floor(msLeft / 86_400_000)
  const h = Math.floor((msLeft % 86_400_000) / 3_600_000)
  const m = Math.floor((msLeft % 3_600_000) / 60_000)

  return (
    <button
      onClick={onTap}
      className="tappable w-full overflow-hidden text-left transition-transform active:scale-[0.99]"
      style={{ ...CARD_STYLE }}
    >
      <div className="flex items-center gap-3.5 p-4">
        <span
          className="flex h-12 w-12 flex-none items-center justify-center rounded-xl text-2xl"
          style={{
            background: 'rgb(var(--color-accent) / 0.12)',
            border: '1px solid rgb(var(--color-accent) / 0.28)',
          }}
          aria-hidden
        >
          {live ? '🔴' : gp!.flag}
        </span>

        <div className="min-w-0 flex-1">
          {live && (
            <span
              className="mb-1 inline-block rounded-full px-2 py-0.5 text-[9.5px] font-bold tracking-wider text-white"
              style={{ background: 'rgb(var(--color-accent))' }}
            >
              LIVE
            </span>
          )}
          <p className="truncate font-display text-[15.5px] font-bold text-fg">
            {live ? live.title : gp!.name}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-fg/50">
            {live ? live.location : gp!.circuit}
          </p>
        </div>

        <ChevronRight className="h-4 w-4 flex-none text-fg/30" />
      </div>

      {!live && (
        <div
          className="flex"
          style={{ borderTop: '1px solid rgb(255 255 255 / 0.06)' }}
        >
          {([[d, t('home.cd.days')], [h, t('home.cd.hours')], [m, t('home.cd.minutes')]] as [number, string][]).map(
            ([v, l], i) => (
              <div
                key={l}
                className="flex-1 py-2.5 text-center"
                style={
                  i > 0
                    ? { borderLeft: '1px solid rgb(255 255 255 / 0.06)' }
                    : undefined
                }
              >
                <p className="font-display text-[17px] font-extrabold tabular-nums leading-none text-fg">
                  {v}
                </p>
                <p className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-fg/40">
                  {l}
                </p>
              </div>
            ),
          )}
        </div>
      )}
    </button>
  )
}

// ═══════════════════════════ DÉFIS DU MOMENT ═══════════════════════════
//
// Défilement horizontal. Les données viennent du système de défis existant
// (fetchActiveChallenges) — rien n'est recréé ici, seule la présentation change.

function ChallengeStrip({
  challenges,
  onTap,
}: {
  challenges: Challenge[]
  onTap: () => void
}) {
  const { t } = useTranslation()

  if (challenges.length === 0) {
    return (
      <div className="px-5">
        <div
          className="px-4 py-5 text-center text-[13px] text-fg/45"
          style={{ ...CARD_STYLE }}
        >
          {t('home.missions.empty')}
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1"
      style={{ scrollbarWidth: 'none' }}
    >
      {challenges.map((c) => {
        const pct = Math.min(100, Math.max(0, computeChallengePct(c)))
        const done = c.claimed || c.completed
        return (
          <button
            key={c.id}
            onClick={onTap}
            className="tappable w-[168px] flex-none snap-start p-3.5 text-left transition-transform active:scale-[0.98]"
            style={{ ...CARD_STYLE }}
          >
            {/* challengeIcon() renvoie une data-URI SVG, pas un emoji : elle
                doit être posée en <img>. Affichée comme du texte, c'est le
                code source du SVG qui s'imprimait dans la carte. */}
            <img
              src={challengeIcon(c, 40)}
              alt=""
              aria-hidden
              width={26}
              height={26}
              className="block"
            />
            <p className="mt-2 line-clamp-2 min-h-[2.4em] text-[12.5px] font-semibold leading-snug text-fg">
              {c.title}
            </p>

            <div className="mt-2.5 flex items-baseline justify-between">
              <span className="text-[11px] font-bold tabular-nums text-fg/70">
                {Math.min(c.progress, c.target_value)}/{c.target_value}
              </span>
              <span
                className="text-[10.5px] font-bold"
                style={{ color: 'rgb(var(--color-accent))' }}
              >
                +{c.xp_reward} XP
              </span>
            </div>

            <div
              className="mt-1.5 h-1 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--color-ring-track)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${done ? 100 : pct}%`,
                  background: done
                    ? 'rgb(52 211 153)'
                    : 'rgb(var(--color-accent))',
                }}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ═══════════════════════════ SPOTTER ═══════════════════════════
//
// Le CTA dominant de l'accueil. La LOGIQUE est celle qui existait déjà —
// setPendingPhoto puis /new-spot — elle n'est pas réécrite : seule la
// présentation change, et un second bouton s'ajoute.
//
// Les deux entrées diffèrent par le seul attribut `capture` : présent, il
// ouvre directement l'appareil photo ; absent, il ouvre la galerie. C'est la
// distinction que fait le bouton secondaire, pour les photos déjà prises.

function SpotterAction() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const camRef = useRef<HTMLInputElement>(null)
  const libRef = useRef<HTMLInputElement>(null)

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return // l'utilisateur a quitté sans prendre de photo
    setPendingPhoto(file)
    navigate('/new-spot')
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPick}
        className="hidden"
      />
      <input
        ref={libRef}
        type="file"
        accept="image/*"
        onChange={onPick}
        className="hidden"
      />

      <button
        onClick={() => camRef.current?.click()}
        className="tappable flex flex-1 items-center justify-center gap-2.5 rounded-full transition-transform active:scale-[0.97]"
        style={{
          padding: '15px 24px',
          background: 'rgb(var(--color-accent))',
          boxShadow: '0 4px 20px rgb(var(--color-accent) / 0.4)',
        }}
        aria-label={t('home.spotter.aria')}
      >
        {/* Anneau de capture : deux ondes ambiantes et un cœur plein. */}
        <span
          className="relative flex h-5 w-5 flex-none items-center justify-center"
          aria-hidden
        >
          <span
            className="absolute inset-0 animate-ping rounded-full"
            style={{
              border: '1.5px solid rgb(255 255 255 / 0.55)',
              animationDuration: '2.4s',
            }}
          />
          <span
            className="relative h-2 w-2 rounded-full bg-white"
            style={{ boxShadow: '0 0 10px rgb(255 255 255 / 0.85)' }}
          />
        </span>
        <span
          className="font-display font-extrabold uppercase text-white"
          style={{ fontSize: '14.5px', letterSpacing: '0.14em' }}
        >
          {t('home.spotter.label')}
        </span>
      </button>

      <button
        onClick={() => libRef.current?.click()}
        className="tappable flex h-[52px] w-[52px] flex-none items-center justify-center rounded-full transition-transform active:scale-[0.94]"
        style={{ ...CARD_STYLE, borderRadius: '999px' }}
        aria-label={t('home.spotter.fromLibrary')}
      >
        <ImageIcon className="h-5 w-5 text-fg/70" />
      </button>
    </div>
  )
}
