// ═══════════════════════════ ACCUEIL — V2 « Expérience Premium » ═══════════════════════════
//
// Refonte du 29/09/2026, d'après la maquette validée « VERSION C ».
//
// L'accueil est le HUB PERSONNEL : qui je suis, où j'en suis, comment spotter,
// ce qui arrive, ce qu'on me demande, où je me situe. Rien d'autre — pas de
// fil, pas d'actualités, pas de radar, pas de collection complète.
//
// Ordre imposé par la maquette :
//   header · hero+identité (carte XP flottante) · stats · SPOTTER ·
//   événement · défis · classements
//
// CE QUI N'A PAS CHANGÉ, et ne doit pas : le fond du hero (même image, même
// principe de dégradés), la logique de capture du Spotter, la barre de
// navigation basse, et TOUTES les sources de données. Cette refonte est une
// recomposition de mise en page ; aucun système métier n'a été réécrit.
//
// ── Où disparaît l'ancien XP du header ──
// La pastille « Maître Spotter · 2 571 XP » posée en haut à droite est
// supprimée : elle faisait double emploi avec la carte XP, qui dit strictement
// plus (niveau, pourcentage, borne du palier). Un seul affichage d'XP subsiste
// sur la page.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Camera,
  Car,
  ChevronRight,
  Flame,
  LifeBuoy,
  Settings as SettingsIcon,
  Shield,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { setPendingPhoto } from '../lib/pendingPhoto'
import { GP_2026 } from '../lib/f1'
import { fetchProgress, openPrestige, romanPrestige, type Progress } from '../lib/xp'
import { challengeIcon } from '../lib/customIcons'
import { Skeleton } from '../components/Skeleton'
import {
  challengePct as computeChallengePct,
  fetchActiveChallenges,
  fetchChallengeImages,
  type Challenge,
} from '../lib/challenges'
import { fetchLiveEvents, type LiveEvent } from '../lib/liveEvents'
import { checkLevelUp } from '../components/LevelUpOverlay'
import { triggerStreakBreak } from '../components/StreakBreak'
import { RevsMark } from '../components/Logo'
import HomeLeaderboard from '../components/HomeLeaderboard'

// Traitement unique des cartes de l'accueil : un verre sombre neutre, une
// bordure fine, rien d'autre. Pas de halo, pas de liseré rouge — c'est ce qui
// donnait le rendu « dashboard de jeu ». Les couleurs passent par les
// variables du design system pour basculer avec le thème clair.
const CARD_STYLE = {
  background: 'var(--color-glass-mid)',
  backdropFilter: 'blur(12px) saturate(150%)',
  WebkitBackdropFilter: 'blur(12px) saturate(150%)',
  border: '1px solid var(--color-border)',
  borderRadius: '20px',
} as const

// Bloc posé SUR une photo : il lui faut un noir franc, pas le verre thématique
// des cartes de la page — sinon il disparaît en thème clair.
const ON_PHOTO = {
  background: 'rgb(0 0 0 / 0.55)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  border: '1px solid rgb(255 255 255 / 0.12)',
} as const

const nf = new Intl.NumberFormat('fr-FR')

type CommunityStats = {
  spots_today: number
  online_now: number
  top_brand: string | null
}

type Stats = { spots: number; brands: number; models: number; streak: number }

// Salutation selon l'heure locale de l'appareil.
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

// Série en cours : jours consécutifs (heure locale) avec au moins un spot, en
// remontant depuis aujourd'hui — ou depuis hier si rien n'a encore été publié.
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
  // Progression : lue au SERVEUR (my_progress), jamais recalculée ici. C'est
  // ce qui garantit que l'accueil ne peut plus annoncer un niveau différent de
  // celui que la base reconnaît.
  const [prog, setProg] = useState<Progress | null>(null)
  const [challenges, setChallenges] = useState<Challenge[]>([])
  const [challengeImages, setChallengeImages] = useState<Map<string, string>>(
    () => new Map(),
  )
  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([])
  const [community, setCommunity] = useState<CommunityStats | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  // Quatre chiffres réellement calculés depuis les spots de l'utilisateur.
  // Aucun n'est codé en dur : à zéro spot, tout affiche 0.
  const [stats, setStats] = useState<Stats>({
    spots: 0,
    brands: 0,
    models: 0,
    streak: 0,
  })
  const [now, setNow] = useState(() => Date.now())

  // Tick 1 Hz — alimente le compte à rebours de l'événement. En pause quand
  // l'onglet est caché : recalculer un compte à rebours hors écran ne sert
  // qu'à vider la batterie.
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

  // Compteur « en ligne », rafraîchi toutes les 60 s tant qu'on est sur
  // l'accueil.
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
        fetchProgress(),
      ])
      if (!active) return

      const pseudo =
        (profRes.data?.pseudo as string | undefined)?.trim() ||
        (user.email ? user.email.split('@')[0] : 'Spotter')
      setName(pseudo)
      setTitle((profRes.data?.title as string | undefined)?.trim() || null)
      setProg(xpRes)
      setLoading(false)

      // Passage de niveau : le serveur tranche, l'overlay se contente de jouer.
      void checkLevelUp()

      // Chargements secondaires découplés — aucun ne bloque le premier rendu.
      fetchActiveChallenges().then((c) => {
        if (!active) return
        setChallenges(c)
        // Images de défis : une requête, et seulement s'il y a des défis.
        // Un échec laisse la Map vide → repli sur l'icône, jamais d'attente.
        if (c.length > 0) {
          fetchChallengeImages(c).then((m) => {
            if (active) setChallengeImages(m)
          })
        }
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

      // Série + stats de collection — une seule requête pour les quatre
      // chiffres de la rangée.
      supabase
        .from('spots')
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
          // Rupture de série : si on en avait une et qu'elle tombe à 0, on
          // joue l'overlay d'extinction, une seule fois.
          try {
            const prev = Number(localStorage.getItem('revs_last_streak') ?? '0')
            if (prev > 0 && s === 0) triggerStreakBreak()
            localStorage.setItem('revs_last_streak', String(s))
          } catch {
            /* stockage indisponible — on saute la détection */
          }
        })
    })()
    return () => {
      active = false
    }
  }, [])


  const goChallenges = useCallback(() => navigate('/challenges'), [navigate])
  const goEvents = useCallback(() => navigate('/events'), [navigate])
  const goBoard = useCallback(() => navigate('/classement'), [navigate])

  const upcomingGp = GP_2026.find((g) => new Date(g.date).getTime() >= now)
  const gpDiff = upcomingGp ? new Date(upcomingGp.date).getTime() - now : 0
  const nextGp = upcomingGp ?? null

  if (loading) {
    return (
      <div className="min-h-screen bg-bg px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between pt-3 pb-5">
          <Skeleton className="h-4 w-32 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-full" />
        </div>
        <Skeleton className="h-[240px] w-full rounded-[24px]" />
        <div className="mt-4 flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[72px] flex-1 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="mt-4 h-[58px] w-full rounded-full" />
        <Skeleton className="mt-7 h-[120px] w-full rounded-[22px]" />
        <Skeleton className="mt-7 h-[132px] w-full rounded-[20px]" />
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-bg pb-8 text-fg">
      {/* ════════════ 1-3 · HEADER + HERO + CARTE XP ════════════
          L'image n'est pas une carte : elle EST le fond du haut de page.
          Le header vit dedans, posé sur le dégradé du sommet. */}
      <section
        className="relative isolate overflow-hidden"
        style={{ minHeight: 'clamp(330px, 48vh, 470px)' }}
      >
        {/* <picture> sert le WebP portrait aux téléphones et le paysage
            au-delà. Haute priorité : c'est le plus grand élément de la page,
            donc celui que mesure le LCP. */}
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

        {/* Dégradés de lisibilité — volontairement PAS un voile uniforme : la
            voiture doit rester visible au milieu. Le sommet s'assombrit pour
            le header, le bas fond vers --color-bg pour rejoindre la page sans
            couture, y compris en thème clair. */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom,' +
              ' rgb(0 0 0 / 0.72) 0%,' +
              ' rgb(0 0 0 / 0.22) 26%,' +
              ' rgb(0 0 0 / 0.10) 42%,' +
              ' rgb(0 0 0 / 0.52) 70%,' +
              ' rgb(0 0 0 / 0.86) 88%,' +
              ' rgb(var(--color-bg)) 100%)',
          }}
        />

        <HomeHeader online={community?.online_now ?? 0} />

        {/* ── Bloc identité — IDENTITÉ À GAUCHE, XP À DROITE ──
            La carte XP flottait auparavant en haut à droite, juste sous le
            header : elle y lisait comme un troisième bouton de barre plutôt
            que comme une information de profil. Elle descend ici, sur la même
            rangée que le prénom, là où elle appartient.

            `items-end` aligne les DEUX blocs sur la même ligne de base basse :
            la carte est plus haute que le texte, donc c'est le seul alignement
            qui ne laisse ni l'un ni l'autre flotter. `min-w-0` sur la colonne
            de gauche l'autorise à se replier — sans lui, un prénom long
            pousserait la carte hors de l'écran au lieu de passer à la ligne. */}
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-3 px-4 pb-4">
          <div className="home-rise min-w-0 flex-1">
            <h1
              className="font-display font-black leading-[1.06] tracking-tight text-white"
              style={{ fontSize: 'clamp(22px, 6.4vw, 34px)' }}
            >
              {greetingFor(name, t)}
            </h1>
            <p className="home-rise--2 mt-1 truncate text-[13px] font-medium text-white/60">
              {title ?? prog?.title ?? '—'}
            </p>
          </div>

          <div className="home-rise home-rise--2 flex-none">
            <XpCard prog={prog} />
          </div>
        </div>
      </section>

      {/* ════════════ 4 · STATISTIQUES ════════════ */}
      <div className="home-rise home-rise--3 px-4 pt-3.5">
        <QuickStats stats={stats} />
      </div>

      {/* ════════════ 5 · SPOTTER ════════════ */}
      <div className="home-rise home-rise--4 px-4 pt-3.5">
        <SpotterAction />
      </div>

      {/* ════════════ 6 · ÉVÉNEMENT À VENIR ════════════ */}
      <section className="px-4 pt-7">
        <SectionHead title={t('home.upcomingEvent')} onMore={goEvents} />
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

      {/* ════════════ 7 · DÉFIS DU MOMENT ════════════ */}
      <section className="pt-7">
        <div className="px-4">
          <SectionHead title={t('home.currentChallenges')} onMore={goChallenges} />
        </div>
        <ChallengeStrip
          challenges={challenges}
          images={challengeImages}
          onTap={goChallenges}
        />
      </section>

      {/* ════════════ 8 · CLASSEMENTS ════════════ */}
      <section className="px-4 pt-7">
        <SectionHead title={t('home.board.title')} onMore={goBoard} />
        <HomeLeaderboard />
      </section>
    </div>
  )
}

// ═══════════════════════════ HEADER ═══════════════════════════
//
// Volontairement bas : logo, présence, et l'accès aux réglages.
//
// ── POURQUOI IL N'Y A PLUS DE CLOCHE (29/09/2026) ──
//
// Inspection du système de notifications avant de trancher :
//
//   CE QUI EXISTE  ·  Web Push réel. Des événements sont bien émis pour les
//     likes (LikeButton), les commentaires (CommentsSheet), les nouveaux
//     abonnés (PublicProfile), les spots à proximité (NewSpot), plus deux
//     rappels par cron (série en danger, Grand Prix dans 24 h). Les
//     préférences par type vivent dans `notification_prefs` et se règlent
//     déjà dans Réglages. Les appareils sont dans `push_subscriptions`.
//
//   CE QUI N'EXISTE PAS  ·  aucune table de notifications, aucune notion de
//     « lu / non lu », aucune page, aucune route, aucun composant. Le push est
//     émis puis oublié : une fois la notification système balayée, l'événement
//     n'existe plus nulle part.
//
// Une cloche a donc deux choses à offrir qu'elle ne peut pas tenir : une
// destination (il n'y a pas d'écran à ouvrir) et une pastille de non-lus (il
// n'y a rien à compter). L'ancienne version basculait l'activation du push —
// utile, mais ce n'est pas ce qu'une cloche promet, et un bouton qui ne fait
// pas ce qu'il annonce vaut moins que pas de bouton.
//
// Elle reviendra quand il y aura une boîte de réception à ouvrir. D'ici là,
// les notifications se règlent dans Réglages, à un tap d'ici.

function HeaderButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="tappable relative flex h-9 w-9 flex-none items-center justify-center rounded-full text-white/85 transition-transform active:scale-95"
      style={{ ...ON_PHOTO, backdropFilter: 'blur(10px)' }}
    >
      {children}
    </button>
  )
}

function HomeHeader({ online }: { online: number }) {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <header className="relative z-10 flex items-center gap-2.5 px-4 pt-[max(0.9rem,calc(env(safe-area-inset-top)+0.4rem))]">
      <RevsMark height={17} title="REVS" />

      {/* Groupe « en ligne » : nowrap + min-w-0 pour qu'il se tronque plutôt
          que de passer à la ligne sur un écran de 320 px. */}
      <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-white/75">
        <span className="relative flex h-1.5 w-1.5 flex-none" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        <span className="tabular-nums">{online}</span>
        <span className="truncate text-white/45">{t('home.onlineShort')}</span>
      </span>

      <div className="ml-auto flex flex-none items-center gap-2">
        <HeaderButton
          label={t('home.header.settings')}
          onClick={() => navigate('/settings')}
        >
          <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={1.9} />
        </HeaderButton>
      </div>
    </header>
  )
}

// ═══════════════════════════ CARTE XP ═══════════════════════════
//
// Tout vient de xpLevel() : niveau, pourcentage, XP courante et seuil du
// palier suivant. Rien n'est codé en dur — au sommet de l'échelle
// (« REVS OG », sans plafond), l'anneau est plein et le rapport « x / y »
// laisse place au total, parce qu'il n'y a plus de cible.

function XpCard({ prog }: { prog: Progress | null }) {
  const { t } = useTranslation()
  // Au niveau 100, la carte devient un bouton : c'est le seul point d'entrée
  // du prestige, et il doit se trouver là où le joueur regarde sa progression
  // — pas dans un écran séparé qu'il faudrait découvrir.
  const R = 25
  const C = 2 * Math.PI * R
  const pct = Math.min(100, Math.max(0, prog?.pct ?? 0))
  const level = prog?.level ?? 1
  const isMax = prog?.isMax ?? false
  // Sur 100 niveaux, afficher « 34 300 / 45 319 XP » serait illisible dans une
  // carte de 104 px. On montre donc la progression DANS le niveau — ce que la
  // barre représente réellement — plutôt que deux totaux cumulés.
  const inLevel = prog?.levelXp ?? 0
  const span = prog?.levelSpan ?? 1

  const Shell = isMax ? 'button' : 'div'

  return (
    <Shell
      {...(isMax
        ? {
            onClick: openPrestige,
            type: 'button' as const,
            'aria-label': t('prestige.available'),
          }
        : {})}
      // Largeur FLUIDE : la carte partage désormais sa rangée avec le prénom.
      // À 320 px elle descend à ~104 px pour laisser respirer « Bon après-midi
      // Flo » ; au-delà de 430 px elle se fige à 136 px et cesse de grandir —
      // une carte XP plus large que ça déséquilibrerait le hero.
      className={`rounded-[18px] px-2.5 pb-2.5 pt-2 text-center${
        isMax ? ' tappable transition-transform active:scale-[0.96]' : ''
      }`}
      style={{
        width: 'clamp(104px, 32vw, 136px)',
        // Fond nettement plus dense que les autres blocs posés sur la photo :
        // la carte est lue de loin, par-dessus un ciel clair ET une carrosserie
        // sombre. À 0,55 d'opacité elle se dissolvait dans le coucher de soleil.
        background: 'rgb(8 8 10 / 0.74)',
        backdropFilter: 'blur(16px) saturate(140%)',
        WebkitBackdropFilter: 'blur(16px) saturate(140%)',
        // Au niveau 100, la carte s'annonce : liseré rouge et halo, pour que
        // « il se passe quelque chose ici » se lise sans texte.
        border: isMax
          ? '1px solid rgb(var(--color-accent) / 0.65)'
          : '1px solid rgb(255 255 255 / 0.16)',
        boxShadow: isMax
          ? '0 12px 34px rgb(0 0 0 / 0.55), 0 0 22px rgb(var(--color-accent) / 0.35)'
          : '0 12px 34px rgb(0 0 0 / 0.55)',
      }}
    >
      {(prog?.prestige ?? 0) > 0 && (
        <p
          className="mb-1 text-[9px] font-black uppercase tracking-[0.14em]"
          style={{ color: 'rgb(var(--color-accent))' }}
        >
          {t('home.xp.prestige', { n: romanPrestige(prog?.prestige ?? 0) })}
        </p>
      )}
      <p className="flex items-center justify-center gap-1.5 text-[11px] font-semibold text-white/70">
        <span aria-hidden>👑</span>
        {t('home.xp.level')}
        <span
          className="font-display font-black tabular-nums"
          style={{ color: 'rgb(var(--color-accent))' }}
        >
          {level}
        </span>
      </p>

      <div className="relative mx-auto mt-1.5 h-[60px] w-[60px]">
        <svg viewBox="0 0 60 60" className="h-full w-full -rotate-90">
          <circle
            cx="30"
            cy="30"
            r={R}
            fill="none"
            strokeWidth="5"
            stroke="rgb(255 255 255 / 0.20)"
          />
          <circle
            cx="30"
            cy="30"
            r={R}
            fill="none"
            strokeWidth="5"
            strokeLinecap="round"
            stroke="rgb(var(--color-accent))"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct / 100)}
            style={{ transition: 'stroke-dashoffset 600ms ease-out' }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="font-display text-[16px] font-black tabular-nums text-white">
            {isMax ? t('home.xp.max') : `${pct}%`}
          </span>
        </span>
      </div>

      <p className="mt-1.5 text-[10px] font-semibold tabular-nums text-white/65">
        {isMax
          ? t('prestige.available')
          : `${nf.format(inLevel)} / ${nf.format(span)} XP`}
      </p>
    </Shell>
  )
}

// ═══════════════════════════ EN-TÊTE DE SECTION ═══════════════════════════

function SectionHead({ title, onMore }: { title: string; onMore?: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h2 className="font-display text-[17px] font-extrabold tracking-tight text-fg">
        {title}
      </h2>
      {onMore && (
        <button
          onClick={onMore}
          className="tappable inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-fg/50"
        >
          {t('home.seeAll')}
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// ═══════════════════════════ STATISTIQUES ═══════════════════════════
//
// Quatre cartes compactes, chacune cliquable vers une destination qui EXISTE
// DÉJÀ — aucune page n'a été créée pour cette mission :
//
//   Spots   → /ma-galerie            (MyGallery : tous mes spots)
//   Marques → /mes-marques           (MyBrands : mes marques découvertes)
//   Modèles → /profile?tab=collection (la collection de cartes, sur le profil)
//   Série   → /profile                (le badge 🔥 de série y est affiché)
//
// « Villes » avait été envisagée en quatrième stat, mais `spots` n'a aucune
// colonne de ville et rien ne géocode les spots à l'envers : le chiffre aurait
// été inventé. « Série » la remplace, et elle est calculée pour de vrai.

function QuickStats({ stats }: { stats: Stats }) {
  const navigate = useNavigate()
  const { t } = useTranslation()

  // Icônes lucide, comme partout ailleurs dans l'application : les emojis
  // changent de dessin d'un système à l'autre et ne suivent pas le thème.
  // La série garde une teinte chaude — c'est le seul repère de couleur de la
  // rangée, et il est porteur de sens.
  const cells: {
    key: string
    value: number
    label: string
    icon: React.ReactNode
    to: string
  }[] = [
    {
      key: 'spots',
      value: stats.spots,
      label: t('home.stats.spots'),
      icon: <Car className="h-[17px] w-[17px] text-fg/75" strokeWidth={1.8} />,
      to: '/ma-galerie',
    },
    {
      key: 'brands',
      value: stats.brands,
      label: t('home.stats.brands'),
      icon: <Shield className="h-[17px] w-[17px] text-fg/75" strokeWidth={1.8} />,
      to: '/mes-marques',
    },
    {
      key: 'models',
      value: stats.models,
      label: t('home.stats.models'),
      icon: (
        <LifeBuoy className="h-[17px] w-[17px] text-fg/75" strokeWidth={1.8} />
      ),
      to: '/profile?tab=collection',
    },
    {
      key: 'streak',
      value: stats.streak,
      label: t('home.stats.streak'),
      icon: (
        <Flame
          className="h-[17px] w-[17px]"
          strokeWidth={1.8}
          style={{
            color:
              stats.streak > 0 ? 'rgb(var(--color-accent))' : 'rgb(var(--color-fg) / 0.45)',
          }}
        />
      ),
      to: '/profile',
    },
  ]

  return (
    <div className="grid grid-cols-4 gap-2">
      {cells.map((c) => (
        <button
          key={c.key}
          onClick={() => navigate(c.to)}
          aria-label={t('home.stats.open', { count: c.value, label: c.label })}
          className="tappable flex min-w-0 flex-col items-center gap-1 px-1 py-2.5 transition-transform active:scale-[0.96]"
          style={{ ...CARD_STYLE, borderRadius: '16px' }}
        >
          <span className="flex h-[17px] items-center" aria-hidden>
            {c.icon}
          </span>
          <span className="font-display text-[18px] font-extrabold leading-none tabular-nums text-fg">
            {c.value}
          </span>
          <span className="flex min-w-0 items-center gap-0.5">
            <span className="truncate text-[10px] font-semibold text-fg/50">
              {c.label}
            </span>
            <ChevronRight className="h-2.5 w-2.5 flex-none text-fg/30" />
          </span>
        </button>
      ))}
    </div>
  )
}

// ═══════════════════════════ SPOTTER ═══════════════════════════
//
// Le CTA dominant de l'accueil. La LOGIQUE est celle qui existait déjà —
// setPendingPhoto puis /new-spot — elle n'est pas réécrite : seule la
// présentation change.
//
// `capture="environment"` ouvre DIRECTEMENT l'appareil photo arrière. L'entrée
// galerie qui l'accompagnait a été retirée le 28/09/2026 : un spot doit naître
// d'une photo prise sur le moment. L'icône appareil photo à droite est un
// repère visuel, pas un second bouton — toute la surface déclenche la même
// action.

function SpotterAction() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const camRef = useRef<HTMLInputElement>(null)

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return // sorti sans prendre de photo
    setPendingPhoto(file)
    navigate('/new-spot')
  }

  return (
    <>
      <input
        ref={camRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPick}
        className="hidden"
      />
      <button
        onClick={() => camRef.current?.click()}
        className="tappable relative flex w-full items-center rounded-full transition-transform active:scale-[0.97]"
        style={{
          padding: '16px 18px',
          background: 'rgb(var(--color-accent))',
          boxShadow: '0 6px 24px rgb(var(--color-accent) / 0.42)',
        }}
        aria-label={t('home.spotter.aria')}
      >
        {/* Anneau de capture : une onde ambiante et un cœur plein. */}
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
          className="flex-1 text-center font-display font-extrabold uppercase text-white"
          style={{ fontSize: '14.5px', letterSpacing: '0.18em' }}
        >
          {t('home.spotter.label')}
        </span>

        <Camera className="h-[19px] w-[19px] flex-none text-white" aria-hidden />
      </button>
    </>
  )
}

// ═══════════════════════════ ÉVÉNEMENT À VENIR ═══════════════════════════
//
// Un événement en direct prime sur le Grand Prix à venir. Aucune donnée n'est
// fabriquée : sans live ET sans GP au calendrier, on affiche un état vide.
//
// ── DEUX DÉRIVATIONS, ET LEURS LIMITES ──
// GP_2026 ne porte QU'UNE date : celle de la course. La carte affiche donc un
// week-end déduit (course − 2 jours → course), ce qui correspond au format
// vendredi-dimanche de la Formule 1. Ce n'est pas une donnée du système : le
// jour où un GP sortira de ce format, l'affichage sera faux.
// Le lieu est extrait de `circuit`, qui suit partout la forme
// « Circuit, Ville ». Quand la virgule manque, on retombe sur le pays.

/** Week-end de course déduit : « 9 – 11 oct. 2026 ». */
function raceWeekend(iso: string, lang: string): string {
  const end = new Date(iso)
  const start = new Date(end.getTime() - 2 * 86_400_000)
  const d = (x: Date) => x.getDate()
  const my = new Intl.DateTimeFormat(lang, { month: 'short', year: 'numeric' })
  return `${d(start)} – ${d(end)} ${my.format(end)}`
}

function Pill({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums text-white/90"
      style={ON_PHOTO}
    >
      <span aria-hidden className="text-[11px]">
        {icon}
      </span>
      {children}
    </span>
  )
}

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
  const { t, i18n } = useTranslation()

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

  const title = live ? live.title : gp!.name
  const [circuitName, city] = live
    ? [live.location, '']
    : (() => {
        const parts = gp!.circuit.split(',').map((x) => x.trim())
        return [parts[0], parts[1] ?? '']
      })()
  const place = live ? live.location : [city, gp!.country].filter(Boolean).join(', ')

  return (
    <button
      onClick={onTap}
      className="tappable relative w-full overflow-hidden text-left transition-transform active:scale-[0.99]"
      style={{
        borderRadius: '22px',
        border: '1px solid rgb(var(--color-accent) / 0.26)',
        boxShadow: '0 6px 26px rgb(var(--color-accent) / 0.12)',
      }}
    >
      {/* Fond photo. `loading="lazy"` : la carte est sous la ligne de
          flottaison, elle ne doit pas concurrencer le hero au premier rendu. */}
      <picture>
        <source
          media="(max-width: 420px)"
          srcSet="/images/events/f1-track-640.webp"
          type="image/webp"
        />
        <source srcSet="/images/events/f1-track-850.webp" type="image/webp" />
        <img
          src="/images/events/f1-track-850.webp"
          alt=""
          aria-hidden
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: 'center 38%' }}
        />
      </picture>

      {/* Voile dégradé : le texte occupe la gauche, la piste reste lisible à
          droite — c'est la composition de la maquette. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to right, rgb(0 0 0 / 0.93) 0%, rgb(0 0 0 / 0.80) 46%,' +
            ' rgb(0 0 0 / 0.30) 78%, rgb(0 0 0 / 0.12) 100%),' +
            ' linear-gradient(to top, rgb(0 0 0 / 0.75) 0%, rgb(0 0 0 / 0) 55%)',
        }}
      />

      <div className="relative flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          {/* Drapeau + marque. Le logo officiel de la Formule 1 est une marque
              déposée : il n'est pas reproduit, un traitement typographique le
              remplace. */}
          <div className="flex items-center gap-2">
            <span className="text-[17px] leading-none" aria-hidden>
              {live ? '🔴' : gp!.flag}
            </span>
            <span
              className="font-display text-[13px] font-black italic tracking-tighter"
              style={{ color: 'rgb(var(--color-accent))' }}
            >
              {live ? t('home.ev.liveNow') : 'F1'}
            </span>
          </div>

          <h3
            className="mt-1.5 font-display font-black uppercase leading-[0.98] tracking-tight text-white"
            style={{ fontSize: 'clamp(20px, 6.2vw, 27px)' }}
          >
            {title}
          </h3>
          <p className="mt-1 text-[11.5px] font-medium leading-snug text-white/65">
            {circuitName}
            {place && (
              <>
                <br />
                {place}
              </>
            )}
          </p>

          {/* Dates déduites + compte à rebours alimenté par le tick 1 Hz. */}
          {!live && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <Pill icon="📅">{raceWeekend(gp!.date, i18n.language)}</Pill>
              <Pill icon="⏱">
                {t('home.ev.countdown', { d, h, m })}
              </Pill>
            </div>
          )}
        </div>

        <span
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full"
          style={ON_PHOTO}
          aria-hidden
        >
          <ChevronRight className="h-5 w-5 text-white" />
        </span>
      </div>
    </button>
  )
}

// ═══════════════════════════ DÉFIS DU MOMENT ═══════════════════════════
//
// Carrousel horizontal. Les données viennent du système de défis existant
// (fetchActiveChallenges) — rien n'est recréé ici, seule la présentation
// change.
//
// L'image vient de `fetchChallengeImages`, qui branche la bibliothèque
// `car_renders` déjà en place. Un défi sans marque cible n'a pas de sujet
// photographiable : il retombe sur l'icône SVG existante, posée sur un panneau
// dégradé — repli assumé, pas un manque. La mission suivante s'occupera de
// donner une image propre à chaque défi.
//
// La carte occupe ~82 % de la largeur : la suivante dépasse volontairement,
// c'est ce qui donne envie de faire glisser.

function ChallengeStrip({
  challenges,
  images,
  onTap,
}: {
  challenges: Challenge[]
  images: Map<string, string>
  onTap: () => void
}) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  // Index visible — sert uniquement aux points de pagination.
  const onScroll = useMemo(
    () => () => {
      const el = scrollRef.current
      if (!el) return
      const card = el.firstElementChild as HTMLElement | null
      if (!card) return
      const step = card.offsetWidth + 12 // largeur + gap-3
      setActive(Math.round(el.scrollLeft / step))
    },
    [],
  )

  if (challenges.length === 0) {
    return (
      <div className="px-4">
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
    <>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1"
        style={{ scrollbarWidth: 'none' }}
      >
        {challenges.map((c) => {
          const pct = Math.min(100, Math.max(0, computeChallengePct(c)))
          const done = c.claimed || c.completed
          const photo = images.get(c.id)
          return (
            <button
              key={c.id}
              onClick={onTap}
              className="tappable flex w-[82%] max-w-[330px] flex-none snap-start overflow-hidden text-left transition-transform active:scale-[0.98]"
              style={{ ...CARD_STYLE }}
            >
              {/* Visuel — photo réelle quand il en existe une, sinon l'icône
                  du défi sur un panneau sombre. Largeur fixe pour que toutes
                  les cartes s'alignent, quel que soit le repli. */}
              <span
                className="relative flex w-[40%] flex-none items-center justify-center overflow-hidden"
                style={{
                  background:
                    'linear-gradient(145deg, rgb(255 255 255 / 0.06), rgb(0 0 0 / 0.30))',
                }}
              >
                {photo ? (
                  <img
                    src={photo}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  /* challengeIcon() renvoie une data-URI SVG, pas un emoji :
                     elle doit être posée en <img>. Affichée comme du texte,
                     c'est le code source du SVG qui s'imprimait. */
                  <img
                    src={challengeIcon(c, 64)}
                    alt=""
                    aria-hidden
                    width={40}
                    height={40}
                  />
                )}
              </span>

              <span className="flex min-w-0 flex-1 flex-col p-3">
                <span className="flex items-start gap-2">
                  <img
                    src={challengeIcon(c, 40)}
                    alt=""
                    aria-hidden
                    width={20}
                    height={20}
                    className="mt-px block flex-none"
                  />
                  <span className="min-w-0">
                    <span className="block line-clamp-2 text-[13px] font-bold leading-snug text-fg">
                      {c.title}
                    </span>
                    {c.description && (
                      <span className="mt-0.5 block line-clamp-2 text-[10.5px] font-medium leading-snug text-fg/50">
                        {c.description}
                      </span>
                    )}
                  </span>
                </span>

                <span className="mt-auto flex items-baseline justify-between pt-2.5">
                  <span className="text-[11.5px] font-bold tabular-nums text-fg/70">
                    {Math.min(c.progress, c.target_value)}/{c.target_value}
                  </span>
                  <span
                    className="text-[11px] font-bold"
                    style={{ color: 'rgb(var(--color-accent))' }}
                  >
                    +{c.xp_reward} XP
                  </span>
                </span>

                <span
                  className="mt-1.5 block h-1 w-full overflow-hidden rounded-full"
                  style={{ background: 'var(--color-ring-track)' }}
                >
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${done ? 100 : pct}%`,
                      background: done
                        ? 'rgb(52 211 153)'
                        : 'rgb(var(--color-accent))',
                      transition: 'width 500ms ease-out',
                    }}
                  />
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* Pagination — n'apparaît qu'à partir de deux défis. */}
      {challenges.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5" aria-hidden>
          {challenges.map((c, i) => (
            <span
              key={c.id}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === active ? '14px' : '6px',
                background:
                  i === active
                    ? 'rgb(var(--color-accent))'
                    : 'rgb(var(--color-fg) / 0.18)',
              }}
            />
          ))}
        </div>
      )}
    </>
  )
}
