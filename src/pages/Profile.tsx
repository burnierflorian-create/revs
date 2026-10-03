import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { ArrowLeft, ChevronRight, Lock, Warehouse, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { type Rarity, type Spot } from '../lib/spots'
import { cardKey } from '../lib/cardLevels'
import { planDisplayName, planTier } from '../lib/plans'
import { allBadges, computeUnlocks, type Badge } from '../lib/badges'
import { badgeIcon } from '../lib/customIcons'
import Showroom from '../components/Showroom'
import { fetchRaceStats } from '../lib/race'
import { fetchProgress, type Progress } from '../lib/xp'
import { useMyTier } from '../lib/tier'
import { TAB_ACTIVE_EVENT } from '../layouts/TabsContainer'
import { appConfig } from '../config/appConfig'
import { Skeleton } from '../components/Skeleton'
import MyCollection from '../components/MyCollection'
import { BadgeUnlockWatcher } from '../components/BadgeUnlocked'
import { rarityBadge } from '../lib/rarityStyle'
import {
  COLLECTIONS,
  claimCollection,
  computeProgress,
  fetchClaimedCollections,
  type CollectionProgress,
} from '../lib/collections'
import { floatXp } from '../components/XpFloater'
import {
  fetchMyReferralStats,
  shareRevsApp,
  type ReferralStats,
} from '../lib/referrals'
import ProfileHero from '../components/profile/ProfileHero'
import SanctionBanner from '../components/SanctionBanner'
import ModerationLink from '../components/ModerationLink'
import ProfileStats from '../components/profile/ProfileStats'
import ProfileProgress from '../components/profile/ProfileProgress'
import ProfileTabs from '../components/profile/ProfileTabs'
import type { ProfileStat, ProfileTabKey } from '../components/profile/types'
import BadgeShowcase from '../components/profile/BadgeShowcase'
import ReferralCard from '../components/profile/ReferralCard'
import SectionHead from '../components/profile/SectionHead'
import SpotMiniGrid from '../components/profile/SpotMiniGrid'


export default function Profile() {
  const navigate = useNavigate()
  const tier = useMyTier()
  const { t } = useTranslation()

  const [loading, setLoading] = useState(true)
  const [pseudo, setPseudo] = useState('Spotter')
  const [ville, setVille] = useState('')
  const [title, setTitle] = useState<string | null>(null)
  const [dreamCar, setDreamCar] = useState<string | null>(null)
  const [instagram, setInstagram] = useState<string | null>(null)
  const [garageBrand, setGarageBrand] = useState<string | null>(null)
  const [primarySpotId, setPrimarySpotId] = useState<string | null>(null)
  const [avatar, setAvatar] = useState<string | null>(null)
  const [spots, setSpots] = useState<Spot[]>([])
  const [uniqueBrands, setUniqueBrands] = useState(0)
  const [rank, setRank] = useState<number | null>(null)
  const [hasEvent, setHasEvent] = useState(false)
  // Progression : lue au SERVEUR (my_progress). Aucun calcul de niveau ne vit
  // deux fois — règle posée par la refonte XP du 29/09.
  const [prog, setProg] = useState<Progress | null>(null)
  const [referral, setReferral] = useState<ReferralStats | null>(null)
  const [shareCopied, setShareCopied] = useState(false)
  const [plan, setPlan] = useState<string | null>(null)
  const [earlyAdopter, setEarlyAdopter] = useState(false)
  const [meId, setMeId] = useState<string | null>(null)
  const [followers, setFollowers] = useState(0)
  const [likesReceived, setLikesReceived] = useState(0)
  const [animPct, setAnimPct] = useState(0)
  // Récompenses: full-badge drawer open state. The 4 featured tiles
  // stay always-visible; this gate controls the slide-up sheet that
  // surfaces the remaining N-4 trophies.
  const [badgesSheetOpen, setBadgesSheetOpen] = useState(false)
  const [xpHistory, setXpHistory] = useState<
    { amount: number; reason: string; created_at: string }[]
  >([])
  // Local-only UI state: which of the two sub-tabs (Garage vs
  // Collection) is currently visible at the bottom of the profile.
  // Single segmented control across the lower half of Profile — replaces
  // the older flat scroll of Stats / Challenges / Subscription / Badges /
  // Collections / Garage. Each tab owns its own content block.
  // Garage is the default active tab for the Phase 1 launch — the raw
  // chronological spot history. Collection (stylised cards) is locked
  // behind SHOW_CARD_COLLECTION until Phase 2.
  // `?tab=` permet à l'accueil d'atterrir directement sur le bon bloc — la
  // statistique « Modèles » ouvre la Collection, pas le haut du profil. Lu une
  // seule fois, à l'initialisation : ensuite l'onglet redevient un état local,
  // et changer d'onglet ne réécrit pas l'URL.
  const [profileTab, setProfileTab] = useState<ProfileTabKey>(() => {
    if (typeof window === 'undefined') return 'garage'
    const p = new URLSearchParams(window.location.search).get('tab')
    return p === 'collection' ||
      p === 'rewards' ||
      p === 'badges' ||
      p === 'likes' ||
      p === 'favorites'
      ? p
      : 'garage'
  })
  /** Spots aimés et spots mis de côté.
   *
   *  Chargés À L'OUVERTURE de leur onglet et pas avant : un profil qu'on
   *  ouvre pour regarder son garage n'a aucune raison de payer deux requêtes
   *  supplémentaires. `null` = jamais demandé, et c'est ce qui distingue
   *  « pas encore chargé » de « vide ». */
  const [likedSpots, setLikedSpots] = useState<Spot[] | null>(null)
  const [savedSpots, setSavedSpots] = useState<Spot[] | null>(null)
  const [listBusy, setListBusy] = useState(false)

  useEffect(() => {
    if (profileTab !== 'likes' && profileTab !== 'favorites') return
    if (profileTab === 'likes' && likedSpots !== null) return
    if (profileTab === 'favorites' && savedSpots !== null) return
    let active = true
    ;(async () => {
      // `setListBusy` est posé DANS la tâche asynchrone et non avant elle :
      // appelé en synchrone au corps de l'effet, il déclenche un second rendu
      // immédiat pour rien — l'effet vient justement de s'exécuter.
      setListBusy(true)
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        if (active) setListBusy(false)
        return
      }
      const table = profileTab === 'likes' ? 'spot_likes' : 'spot_bookmarks'
      // Deux requêtes et non une par spot : on récupère les identifiants,
      // puis les spots en un seul `in`. Un `select` imbriqué aurait ramené
      // les colonnes du spot autant de fois qu'il y a de lignes de liaison.
      const { data: links } = await supabase
        .from(table)
        .select('spot_id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200)
      const ids = (links ?? []).map((l) => (l as { spot_id: string }).spot_id)
      let rows: Spot[] = []
      if (ids.length) {
        const { data } = await supabase.from('spots').select('*').in('id', ids)
        // L'ordre de `in` n'est pas garanti : on réimpose celui des liaisons,
        // qui est chronologique inverse — le dernier aimé en premier.
        const bySpot = new Map((data ?? []).map((r) => [(r as Spot).id, r as Spot]))
        rows = ids.map((i) => bySpot.get(i)).filter(Boolean) as Spot[]
      }
      if (!active) return
      if (profileTab === 'likes') setLikedSpots(rows)
      else setSavedSpots(rows)
      setListBusy(false)
    })()
    return () => {
      active = false
    }
  }, [profileTab, likedSpots, savedSpots])

  // REVS RACE counters drive the race-* badges. Fetched once per
  // mount; absent until the call returns (badges just stay locked).
  const [raceStats, setRaceStats] = useState<{
    wins: number
    losses: number
    perfectStarts: number
  } | null>(null)


  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const [
        spotsRes,
        rankRes,
        eventsRes,
        profRes,
        subRes,
        followersRes,
      ] = await Promise.all([
          supabase
            .from('spots')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          // Rang : une comparaison indexée sur profiles.xp_total (migration
          // 0084) au lieu d'un tirage de TOUTE la table `spots` vers le
          // navigateur. Et c'est désormais le MÊME rang que /classement, vers
          // lequel la statistique renvoie.
          supabase.rpc('my_rank'),
          supabase
            .from('events')
            .select('id', { count: 'exact', head: true })
            .eq('organizer_id', user.id),
          supabase
            .from('profiles')
            .select('pseudo, ville, avatar, created_at, title, dream_car, instagram, garage_brand, primary_spot_id')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('subscriptions')
            .select('plan, status, current_period_end, stripe_customer_id')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('followers')
            .select('follower_id', { count: 'exact', head: true })
            .eq('following_id', user.id),
        ])

      const myCreated =
        (profRes.data?.created_at as string | undefined) ||
        user.created_at
      let earlier = 999
      if (myCreated) {
        const { count } = await supabase
          .from('profiles')
          .select('user_id', { count: 'exact', head: true })
          .lt('created_at', myCreated)
        earlier = count ?? 999
      }

      if (!active) return

      const mySpots = (spotsRes.data ?? []) as Spot[]

      const rk = (rankRes.data as number | null) ?? null

      const email = user.email ?? ''
      setPseudo(
        profRes.data?.pseudo ||
          (email ? email.split('@')[0] : '') ||
          'Spotter',
      )
      setVille(profRes.data?.ville ?? '')
      setTitle((profRes.data as { title?: string | null } | null)?.title ?? null)
      setDreamCar(
        (profRes.data as { dream_car?: string | null } | null)?.dream_car?.trim() ||
          null,
      )
      setInstagram(
        (profRes.data as { instagram?: string | null } | null)?.instagram ?? null,
      )
      setGarageBrand(
        (profRes.data as { garage_brand?: string | null } | null)?.garage_brand ?? null,
      )
      setPrimarySpotId(
        (profRes.data as { primary_spot_id?: string | null } | null)?.primary_spot_id ?? null,
      )
      setAvatar(profRes.data?.avatar ?? null)
      setSpots(mySpots)
      setUniqueBrands(
        new Set(mySpots.map((s) => s.brand).filter(Boolean)).size,
      )
      setRank(rk)
      setHasEvent((eventsRes.count ?? 0) > 0)
      const s = subRes.data as {
        plan?: string
        status?: string
        current_period_end?: string
        stripe_customer_id?: string
      } | null
      const isActiveSub = s?.status === 'active' || s?.status === 'trialing'
      setPlan(isActiveSub ? (s?.plan ?? null) : null)
      setEarlyAdopter(earlier < 100)
      setMeId(user.id)
      setFollowers(followersRes.count ?? 0)
      setLoading(false)

      // Progression serveur + parrainage — découplés, aucun ne bloque le rendu.
      void fetchProgress().then((p) => {
        if (active) setProg(p)
      })
      void fetchMyReferralStats().then((r) => {
        if (active) setReferral(r)
      })

      // REVS RACE stats — fire-and-forget, no blocking on render.
      fetchRaceStats(user.id).then((rs) => {
        setRaceStats({
          wins: rs.wins,
          losses: rs.losses,
          perfectStarts: rs.perfect_starts,
        })
      })

      // Likes-received count drives the "Photographe" badge. Best-
      // effort follow-up — we don't want to delay the main render on
      // it, so it sits outside the Promise.all.
      const myIds = mySpots.map((s) => s.id)
      if (myIds.length) {
        const { count: lc } = await supabase
          .from('spot_likes')
          .select('spot_id', { count: 'exact', head: true })
          .in('spot_id', myIds)
        if (active) setLikesReceived(lc ?? 0)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // ── RELECTURE QUAND L'ONGLET REDEVIENT VISIBLE (02/10/2026) ──
  //
  // L'effet ci-dessus a `[]` en dépendances : il ne lit la base QU'UNE FOIS,
  // au montage. Or les onglets restent montés (voir TabsContainer), donc le
  // Profil ne revoyait jamais ses données après son premier affichage.
  //
  // Conséquence mesurée au navigateur : l'utilisateur désigne sa voiture dans
  // les Paramètres, `profiles.primary_spot_id` est bien écrit — vérifié en
  // base — et le Profil continue d'afficher celle que l'heuristique de rareté
  // avait choisie au montage. Trois désignations successives, trois fois la
  // même voiture affichée. Rien n'était « en cache » au sens d'un cache : la
  // question n'était simplement jamais reposée.
  //
  // On ne relit QUE la ligne `profiles`. C'est elle qui porte tout ce que les
  // Paramètres peuvent modifier — véhicule principal, pseudo, ville, avatar,
  // voiture de rêve, Instagram. Les spots, le rang et les statistiques ne
  // changent pas depuis les Paramètres : les recharger à chaque aller-retour
  // d'onglet coûterait cinq requêtes pour rien.
  useEffect(() => {
    function onTabActive(e: Event) {
      const tab = (e as CustomEvent<{ tab?: string }>).detail?.tab
      if (tab !== 'profile') return
      void (async () => {
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) return
        const { data } = await supabase
          .from('profiles')
          .select(
            'pseudo, ville, avatar, title, dream_car, instagram, garage_brand, primary_spot_id',
          )
          .eq('user_id', user.id)
          .maybeSingle()
        if (!data) return
        const p = data as {
          pseudo?: string | null
          ville?: string | null
          avatar?: string | null
          dream_car?: string | null
          instagram?: string | null
          garage_brand?: string | null
          primary_spot_id?: string | null
        }
        setPseudo(p.pseudo ?? '')
        setVille(p.ville ?? '')
        setAvatar(p.avatar ?? null)
        setDreamCar(p.dream_car?.trim() || null)
        setInstagram(p.instagram ?? null)
        setGarageBrand(p.garage_brand ?? null)
        setPrimarySpotId(p.primary_spot_id ?? null)
      })()
    }
    window.addEventListener(TAB_ACTIVE_EVENT, onTabActive)
    return () => window.removeEventListener(TAB_ACTIVE_EVENT, onTabActive)
  }, [])

  useEffect(() => {
    if (loading) return
    const id = requestAnimationFrame(() => setAnimPct(prog?.pct ?? 0))
    return () => cancelAnimationFrame(id)
  }, [loading, prog?.pct])

  // Last 10 XP transactions for the Récompenses history list.
  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user || !active) return
      const { data } = await supabase
        .from('xp_transactions')
        .select('amount, reason, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10)
      if (active)
        setXpHistory(
          (data ?? []) as {
            amount: number
            reason: string
            created_at: string
          }[],
        )
    })()
    return () => {
      active = false
    }
  }, [])

  // ── Dérivés mémoïsés, AVANT le retour anticipé de chargement ──
  // Un hook placé après `if (loading) return` change l'ordre des hooks entre
  // deux rendus : React lève « Rendered fewer hooks than expected » à la
  // transition. Les deux blocs ci-dessous vivaient là et cassaient donc le
  // passage chargement → contenu.
  const uniqueModels = useMemo(
    () =>
      new Set(
        spots
          .filter((s) => s.brand && s.model)
          .map((s) => `${s.brand}|${s.model}`.toLowerCase()),
      ).size,
    [spots],
  )
  const garageCount = useMemo(
    () => new Set(spots.map((s) => cardKey(s.brand ?? '', s.model ?? '', s.color))).size,
    [spots],
  )
  // Collection = même clé. Garage et Collection comptent le même ensemble mais
  // le montrent autrement : le Garage les expose, la Collection les classe.
  const cardCount = garageCount

  if (loading) {
    return (
      <div className="min-h-screen bg-bg">
        <Skeleton className="h-44 w-full rounded-none" />
        <div className="space-y-7 px-4 pb-8">
          <div className="-mt-10 flex flex-col items-center">
            <Skeleton className="h-24 w-24 rounded-full" />
            <Skeleton className="mt-4 h-6 w-32 rounded" />
            <Skeleton className="mt-2 h-4 w-24 rounded" />
          </div>
          <Skeleton className="h-20 rounded-2xl" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  const daysWithSpot = new Set(spots.map((s) => s.created_at.slice(0, 10)))
  // Current daily streak — consecutive UTC days with a spot, counting
  // back from today (or yesterday if today has none yet).
  const streak = (() => {
    const fmt = (dt: Date) => dt.toISOString().slice(0, 10)
    const cur = new Date()
    if (!daysWithSpot.has(fmt(cur))) {
      cur.setUTCDate(cur.getUTCDate() - 1)
      if (!daysWithSpot.has(fmt(cur))) return 0
    }
    let n = 0
    while (daysWithSpot.has(fmt(cur))) {
      n += 1
      cur.setUTCDate(cur.getUTCDate() - 1)
    }
    return n
  })()
  const badgeCtx = {
    spots,
    hasEvent,
    plan,
    rank,
    followers,
    likesReceived,
    daysWithSpot,
    earlyAdopter,
    raceStats: raceStats ?? undefined,
  }
  // Statut de COMPTE (« Fondateur », « VIP ») — distinct du titre de niveau.
  // Les deux s'affichent côte à côte : depuis la refonte XP, le statut
  // n'écrase plus la progression.
  const accountStatusLabel =
    title ||
    (planTier(plan) === 'vip'
      ? 'VIP'
      : planTier(plan) === 'premium'
        ? t('profilepage.status.premium')
        : null)

  // Modèles distincts — dérivé des spots DÉJÀ chargés, aucune requête de plus.

  // Garage = voitures distinctes (marque + modèle + teinte) — pas le nombre
  // brut de spots, sinon dix photos de la même voiture compteraient dix fois.

  const profileStats: ProfileStat[] = [
    { key: 'spots', value: spots.length, label: t('profilepage.stats.spots'), to: '/ma-galerie' },
    { key: 'brands', value: uniqueBrands, label: t('profilepage.stats.brands'), to: '/mes-marques' },
    // « Modèles » n'a pas de page dédiée : elle bascule sur l'onglet
    // Collection, qui EST la liste des modèles collectionnés.
    { key: 'models', value: uniqueModels, label: t('profilepage.stats.models'), onPress: () => setProfileTab('collection') },
    { key: 'rank', value: rank ?? 0, prefix: '#', empty: !rank, label: t('profilepage.stats.rank'), to: '/classement' },
    { key: 'followers', value: followers, label: t('profilepage.stats.followersShort'), ...(meId ? { to: `/u/${meId}` } : {}) },
  ]

  /** Partage l'APPLICATION avec le code de parrainage — plus le lien de
   *  profil, qui était une impasse d'acquisition. */
  async function doShare() {
    const copied = await shareRevsApp(
      referral?.invite_code ?? null,
      t('profilepage.shareApp.text'),
    )
    if (copied) {
      setShareCopied(true)
      window.setTimeout(() => setShareCopied(false), 1800)
    }
  }

  const badgeCatalogue = allBadges(badgeCtx)
  const unlocks = computeUnlocks(badgeCtx)
  // Top row: prefer unlocked badges (most-impressive feel); pad with the
  // first locked ones so the row is always 4 wide.
  const unlocked = badgeCatalogue.filter((b) => unlocks.has(b.slug))
  const locked = badgeCatalogue.filter((b) => !unlocks.has(b.slug))

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* Fires badge-unlocked notifications for newly-earned badges. Lives
          here (rendered only once data is loaded) so its hooks are never
          conditional on this page's loading early-return. */}
      <BadgeUnlockWatcher badges={unlocked} />
      {/* SECTION 1 — Cover + avatar. When the user has a spot worth
          showing off, we use its photo as the immersive backdrop
          (heavy blur + dim overlay). Falls back to the brand red
          gradient when the garage is empty. */}
      <ProfileHero
        pseudo={pseudo}
        avatar={avatar}
        accountTitle={accountStatusLabel}
        levelTitle={prog?.title ?? null}
        ville={ville}
        dreamCar={dreamCar}
        instagram={instagram}
        garageBrand={garageBrand}
        primarySpotId={primarySpotId}
        verified={!!title || tier === 'vip'}
        spots={spots}
        inviteCode={referral?.invite_code ?? null}
        onShare={() => void doShare()}
      />

      {/* Bloc identité. PAS de pb-40 ici : la marge de sécurité au-dessus de
          la barre de navigation appartient au conteneur le plus EXTERNE. Elle
          était appliquée aux deux, ce qui creusait 160 px morts entre les
          onglets et leur propre contenu. */}
      <div className="space-y-6 px-4 pb-5 pt-4">
        {/* Série en cours — une seule pastille, sous l'identité. */}
        {streak > 0 && (
          <div className="-mt-1 flex justify-center">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold"
              style={{
                background: 'rgb(var(--color-accent) / 0.16)',
                color: '#FF7080',
                border: '1px solid rgb(var(--color-accent) / 0.40)',
              }}
            >
              🔥 {t('profilepage.streak.days', { count: streak })}
            </span>
          </div>
        )}

        {/* Une sanction en cours se lit AVANT tout le reste : c'est ce qui
            explique pourquoi le compte ne se comporte plus normalement. */}
        <SanctionBanner />

        <ProfileStats stats={profileStats} />

        <ProfileProgress prog={prog} animPct={animPct} />

        <ModerationLink />

        <ProfileTabs active={profileTab} onChange={setProfileTab} />
      </div>

      <div className="pb-40">
        {/* TAB NAV — three plain words spaced horizontally (Apple text
            nav): active in pure white under a 1px underline, inactive in
            muted grey. No pills, no gradient fills, no emoji. */}
        <section className="w-full">
          {/* Tab content wrapper — full width, ZERO horizontal padding/margin
              (the parent no longer carries px-4). Collection grid + garage
              scroll go truly edge-to-edge; inner blocks that need breathing
              room (deck list, empty states, unlocked rewards) re-add their
              own px-4. */}
          <div className="mt-5 w-full">
            {profileTab === 'collection' && (
              <div className="mb-3 px-4">
                <SectionHead
                  title={t('profilepage.collection.heading')}
                  count={t('profilepage.collection.count', { count: cardCount })}
                />
              </div>
            )}
            {profileTab === 'collection' &&
              (appConfig.SHOW_CARD_COLLECTION ? (
                <CollectionDecks spots={spots} />
              ) : (
                // Phase 2 lock — the real decks render underneath but are
                // frosted by the overlay's backdrop-blur (satin), so the
                // card UI is teasingly visible without being usable.
                <div className="relative">
                  <div
                    aria-hidden
                    className="pointer-events-none select-none"
                  >
                    <CollectionDecks spots={spots} />
                  </div>
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-3xl text-center"
                    style={{
                      background: 'rgba(10,10,10,0.92)',
                      backdropFilter: 'blur(16px)',
                      WebkitBackdropFilter: 'blur(16px)',
                    }}
                  >
                    <span
                      className="flex h-14 w-14 items-center justify-center rounded-full"
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid #333',
                      }}
                    >
                      <Lock className="h-6 w-6 text-white/70" strokeWidth={1.6} />
                    </span>
                    <p
                      className="font-bold text-white"
                      style={{ fontSize: '18px' }}
                    >
                      {t('profilepage.collectionLock.title')}
                    </p>
                    <p
                      className="leading-relaxed"
                      style={{
                        fontSize: '14px',
                        color: '#999999',
                        paddingLeft: '24px',
                        paddingRight: '24px',
                      }}
                    >
                      {t('profilepage.collectionLock.body')}
                    </p>
                  </div>
                </div>
              ))}

            {profileTab === 'garage' && (
              <div className="mb-3 px-4">
                <SectionHead
                  title={t('profilepage.garage.heading')}
                  count={t('profilepage.garage.count', { count: garageCount })}
                  onMore={garageCount > 0 ? () => navigate('/ma-galerie') : undefined}
                />
              </div>
            )}
            {profileTab === 'garage' &&
              (spots.length === 0 ? (
                <div className="mx-4 flex flex-col items-center rounded-2xl border border-fg/5 bg-card px-6 py-12 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
                    <Warehouse className="h-8 w-8 text-accent/70" />
                  </div>
                  <p className="mt-4 max-w-[15rem] font-medium">
                    {t('profilepage.garage.empty')}
                  </p>
                  <button
                    onClick={() => navigate('/new-spot')}
                    className="mt-5 rounded-full bg-accent px-6 py-3 text-sm font-semibold"
                  >
                    {t('profilepage.garage.spot')}
                  </button>
                </div>
              ) : (
                <Showroom
                  spots={spots}
                  onOpen={(id) => navigate(`/spot/${id}`)}
                />
              ))}

            {profileTab === 'badges' && (
              <BadgeShowcase badges={badgeCatalogue} unlocks={unlocks} />
            )}

            {profileTab === 'likes' && (
              <>
                <SectionHead
                  title={t('profilepage.likes.title', { count: likedSpots?.length ?? 0 })}
                />
                <SpotMiniGrid
                  spots={likedSpots}
                  loading={listBusy}
                  emptyTitle={t('profilepage.likes.emptyTitle')}
                  emptyBody={t('profilepage.likes.emptyBody')}
                  ctaLabel={t('profilepage.likes.cta')}
                  onCta={() => navigate('/feed')}
                />
              </>
            )}

            {profileTab === 'favorites' && (
              <>
                <SectionHead
                  title={t('profilepage.favorites.title', { count: savedSpots?.length ?? 0 })}
                />
                <SpotMiniGrid
                  spots={savedSpots}
                  loading={listBusy}
                  emptyTitle={t('profilepage.favorites.emptyTitle')}
                  emptyBody={t('profilepage.favorites.emptyBody')}
                  ctaLabel={t('profilepage.favorites.cta')}
                  onCta={() => navigate('/feed')}
                />
              </>
            )}

            {/* Récompenses — locked "coming soon" until Phase 2
                (SHOW_COLLECTIONS_TO_COMPLETE). The tab stays visible and
                clickable; tapping it lands on this frosted lock panel. */}
            {profileTab === 'rewards' &&
              !appConfig.SHOW_COLLECTIONS_TO_COMPLETE && (
                <div
                  className="relative overflow-hidden rounded-3xl"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  <div
                    aria-hidden
                    className="absolute inset-0"
                    style={{
                      background: 'var(--color-glass)',
                      backdropFilter: 'saturate(140%) blur(16px)',
                      WebkitBackdropFilter: 'saturate(140%) blur(16px)',
                    }}
                  />
                  <div
                    className="relative flex flex-col items-center justify-center gap-4 px-8 py-16 text-center"
                    style={{ minHeight: '300px' }}
                  >
                    <span
                      className="flex h-14 w-14 items-center justify-center rounded-full bg-fg/[0.06]"
                      style={{ border: '1px solid var(--color-border)' }}
                    >
                      <Lock className="h-6 w-6 text-fg2" strokeWidth={1.6} />
                    </span>
                    <p className="text-lg font-semibold text-fg">
                      {t('profilepage.rewardsLock.title')}
                    </p>
                    <p className="max-w-[20rem] text-sm leading-relaxed text-fg2">
                      {t('profilepage.rewardsLock.body')}
                    </p>
                  </div>
                </div>
              )}

            {profileTab === 'rewards' &&
              appConfig.SHOW_COLLECTIONS_TO_COMPLETE && (
              <div className="space-y-7 px-4">
                {/* Gérer mon abonnement — paid users only */}
                {plan && (
                  <button
                    onClick={() => navigate('/premium')}
                    className="tappable flex w-full items-center justify-between gap-3 rounded-2xl bg-card px-4 py-3.5 text-left"
                    style={{
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className="flex h-9 w-9 items-center justify-center rounded-xl"
                        style={{
                          background:
                            planTier(plan) === 'vip'
                              ? 'linear-gradient(135deg, #d4af37 0%, #ffd700 100%)'
                              : 'rgb(var(--color-accent))',
                          color: planTier(plan) === 'vip' ? '#000' : '#fff',
                          fontSize: '16px',
                        }}
                      >
                        {planTier(plan) === 'vip' ? '👑' : '⚡'}
                      </span>
                      <span className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-widest text-fg2">
                          {t('profilepage.subscription.label')}
                        </span>
                        <span className="font-display text-base font-bold text-fg">
                          {planDisplayName(plan)}
                        </span>
                      </span>
                    </span>
                    <span className="text-xs text-fg/55">{t('profilepage.subscription.manage')}</span>
                  </button>
                )}

                {/* Badges — full 4-col grid; unlocked are coloured, locked
                    greyed with a cadenas. Tap → badge detail (condition). */}
                <section>
                  <div className="mb-3 flex items-baseline justify-between">
                    <h4
                      className="font-black uppercase text-fg2/55"
                      style={{ fontSize: '10px', letterSpacing: '0.20em' }}
                    >
                      {t('profilepage.badges.heading')}
                    </h4>
                    <span className="text-[10px] font-bold text-fg2">
                      {t('profilepage.badges.unlockedCount', {
                        unlocked: unlocked.length,
                        total: badgeCatalogue.length,
                      })}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-x-2 gap-y-4">
                    {[...unlocked, ...locked].map((b) => {
                      const isU = unlocks.has(b.slug)
                      const icon = badgeIcon(b.slug)
                      return (
                        <button
                          key={b.slug}
                          onClick={() => navigate(`/badges/${b.slug}`)}
                          className="tappable flex min-w-0 flex-col items-center gap-1.5"
                          aria-label={b.name}
                        >
                          <span
                            className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded-full text-2xl"
                            style={{
                              background: isU
                                ? b.gold
                                  ? 'rgba(224,179,65,0.14)'
                                  : 'rgba(232,32,58,0.12)'
                                : 'rgba(255,255,255,0.04)',
                              border: isU
                                ? b.gold
                                  ? '1px solid rgba(224,179,65,0.45)'
                                  : '1px solid rgba(232,32,58,0.35)'
                                : '1px solid rgb(var(--color-fg) / 0.06)',
                              opacity: isU ? 1 : 0.55,
                            }}
                          >
                            {isU ? (
                              icon ? (
                                <img
                                  src={icon}
                                  alt=""
                                  loading="lazy"
                                  decoding="async"
                                  className="h-full w-full rounded-full object-cover"
                                />
                              ) : (
                                b.emoji
                              )
                            ) : (
                              <Lock className="h-5 w-5 text-fg2/50" />
                            )}
                          </span>
                          <span
                            className="line-clamp-2 text-center font-semibold leading-tight"
                            style={{
                              fontSize: '9px',
                              color: isU
                                ? b.gold
                                  ? '#E0B341'
                                  : 'rgb(var(--color-fg))'
                                : 'rgb(var(--color-fg) / 0.4)',
                            }}
                          >
                            {b.name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>

                {/* Collections to complete */}
                <TopChallenges
                  spots={spots}
                  count={2}
                  onShowAll={() => navigate('/challenges')}
                />

                {/* Historique XP — last 10 transactions */}
                {xpHistory.length > 0 && (
                  <section>
                    <h4
                      className="mb-3 font-black uppercase text-fg2/55"
                      style={{ fontSize: '10px', letterSpacing: '0.20em' }}
                    >
                      {t('profilepage.xpHistory.heading')}
                    </h4>
                    <div className="space-y-1.5">
                      {xpHistory.map((tx, i) => {
                        const r = xpReasonLabel(tx.reason, t)
                        const date = new Intl.DateTimeFormat('fr-FR', {
                          day: 'numeric',
                          month: 'short',
                        }).format(new Date(tx.created_at))
                        return (
                          <div
                            key={i}
                            className="flex items-center gap-3 rounded-xl bg-card px-3 py-2.5"
                            style={{ border: '1px solid var(--color-border)' }}
                          >
                            <span className="text-lg" aria-hidden>
                              {r.emoji}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium text-fg">
                                {r.label}
                              </p>
                              <p className="text-[11px] text-fg2">{date}</p>
                            </div>
                            <span
                              className="flex-none font-display font-extrabold tabular-nums"
                              style={{
                                color:
                                  tx.amount >= 0
                                    ? '#E8203A'
                                    : 'rgb(var(--color-fg) / 0.4)',
                                fontSize: '14px',
                              }}
                            >
                              {tx.amount >= 0 ? '+' : ''}
                              {tx.amount} XP
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>
        </section>

        {/* PARRAINAGE — l'acquisition passe avant l'upsell : inviter un ami
            est gratuit pour le joueur et utile au produit, l'abonnement ne
            l'est que pour le produit. */}
        <div className="mt-8 px-4">
          <ReferralCard stats={referral} onShare={() => void doShare()} />
        </div>

        {/* PREMIUM — discret, tout en bas, après le contenu réel du profil. */}
        <div className="mt-6 px-4">
          <PremiumTopBanner
            onTap={() => navigate('/premium')}
            plan={plan}
          />
        </div>

      </div>

      <BadgesBottomSheet
        open={badgesSheetOpen}
        onClose={() => setBadgesSheetOpen(false)}
        badges={badgeCatalogue}
        unlocks={unlocks}
      />

      {/* Retour visuel quand le partage natif n'existe pas (navigateur de
          bureau) et que le contenu a été copié à la place. */}
      {shareCopied && (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex justify-center"
          role="status"
        >
          <span
            className="rounded-full px-4 py-2 text-[13px] font-bold text-white"
            style={{ background: 'rgb(var(--color-accent))' }}
          >
            {t('profilepage.shareApp.copied')}
          </span>
        </div>
      )}
    </div>
  )
}

// ────────────────────────── SHARE SHEET ─────────────────────────

/** Human-readable label + emoji for an xp_transactions.reason. */
function xpReasonLabel(
  reason: string,
  t: TFunction,
): { emoji: string; label: string } {
  if (reason === 'spot')
    return { emoji: '📸', label: t('profilepage.xpReason.spot') }
  if (reason === 'daily_first')
    return { emoji: '☀️', label: t('profilepage.xpReason.dailyFirst') }
  if (reason === 'streak')
    return { emoji: '🔥', label: t('profilepage.xpReason.streak') }
  if (reason.startsWith('collection:'))
    return { emoji: '🃏', label: t('profilepage.xpReason.collection') }
  if (reason.startsWith('referral'))
    return { emoji: '🤝', label: t('profilepage.xpReason.referral') }
  if (reason.startsWith('challenge') || reason.startsWith('weekly'))
    return { emoji: '🎯', label: t('profilepage.xpReason.challenge') }
  if (reason.startsWith('like'))
    return { emoji: '❤️', label: t('profilepage.xpReason.like') }
  if (reason.startsWith('event'))
    return { emoji: '🎪', label: t('profilepage.xpReason.event') }
  if (reason === 'reconcile')
    return { emoji: '⚙️', label: t('profilepage.xpReason.reconcile') }
  return { emoji: '✨', label: reason }
}

/** Premium card — a real dark-red gradient card (logo + REVS PREMIUM +
 *  perks + red "Découvrir" CTA). When already subscribed, it shows the
 *  active tier + renewal date instead of the upsell. */
function PremiumTopBanner({
  onTap,
  plan,
  renewsAt,
}: {
  onTap: () => void
  plan?: string | null
  renewsAt?: string | null
}) {
  const { t } = useTranslation()
  const active = !!plan
  const renew = renewsAt
    ? new Intl.DateTimeFormat('fr-FR', {
        day: 'numeric',
        month: 'long',
      }).format(new Date(renewsAt))
    : null
  return (
    <button
      onClick={onTap}
      className="tappable flex w-full items-center gap-3 text-left transition-transform active:scale-[0.99]"
      style={{
        background: '#141414',
        borderRadius: '16px',
        padding: '16px',
        border: active ? '1px solid #E8203A' : '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {/* Small REVS logo */}
      <span
        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg font-display text-base font-black tracking-tighter text-white"
        style={{
          background: 'rgba(232,32,58,0.18)',
          border: '1px solid rgba(232,32,58,0.45)',
        }}
        aria-hidden
      >
        R
      </span>

      <div className="min-w-0 flex-1">
        <p
          className="font-display font-extrabold tracking-tight"
          style={{ color: '#E8203A', fontSize: '14px' }}
        >
          REVS PREMIUM
        </p>
        {active && (
          <p className="mt-0.5 truncate text-[12px]">
            <span className="font-bold" style={{ color: '#34D399' }}>
              {t('profilepage.premium.active')}
            </span>
            {renew && (
              <span className="text-white/45"> {t('profilepage.premium.renews', { date: renew })}</span>
            )}
          </p>
        )}
        {/* Upsell case: no second line at all — only the logo, the red
            "REVS PREMIUM" title and the "Découvrir →" button. The price
            lives exclusively on the /premium page. */}
      </div>

      <span
        className="flex-none rounded-full px-3.5 py-2 text-[12px] font-extrabold text-white"
        style={{ background: '#E8203A' }}
      >
        {active ? t('profilepage.premium.manage') : t('profilepage.premium.discover')}
      </span>
    </button>
  )
}

// ─────────────────────────── COLLECTION DECKS ───────────────────────────

/** Rarity-anchored collection cards per the 2026-06-04 ennoblissement.
 *  The Collection tab lands on horizontal "portfolio" cards — one per
 *  rarity that has at least one spot — each backdropped by the user's
 *  best (priciest) photographed car in that category, heavily darkened
 *  and blurred. No neon glyphs, no tints, no emoji: just a white deck
 *  name and a grey card count. Tapping drills into the filtered grid.
 *  Ordered high → low so Hypercar leads. */
type Deck = {
  rarity: Rarity
  label: string
  count: number
  /** URL of the priciest photographed spot in this rarity — used as a
   *  furtive, darkened background for the card. Null when none of the
   *  rarity's spots carry a photo. */
  cover: string | null
}
const DECK_RARITY_ORDER: Rarity[] = [
  'hypercar',
  'supercar',
  'exclusif',
  'performance',
  'premium',
  'standard',
]
function CollectionDecks({ spots }: { spots: Spot[] }) {
  const { t } = useTranslation()
  const [openRarity, setOpenRarity] = useState<Rarity | null>(null)

  const decks = useMemo<Deck[]>(() => {
    return DECK_RARITY_ORDER.map((r) => {
      const inRarity = spots.filter((s) => (s.rarity ?? 'standard') === r)
      // Best photo = the priciest spot that actually carries an image.
      const cover =
        inRarity
          .filter((s) => s.photo_url)
          .sort(
            (a, b) => (b.estimated_price ?? 0) - (a.estimated_price ?? 0),
          )[0]?.photo_url ?? null
      // Count UNIQUE cards (brand+model+colour), not raw spots — the
      // collection is one evolving card per car.
      const cards = new Set(
        inRarity.map((s) => cardKey(s.brand ?? '', s.model ?? '', s.color)),
      )
      return {
        rarity: r,
        label: t(`profilepage.rarity.${r}`),
        count: cards.size,
        cover,
      }
    }).filter((d) => d.count > 0)
  }, [spots, t])

  // Total unique cards across all rarities (one evolving card per car).
  const totalCards = useMemo(
    () => decks.reduce((n, d) => n + d.count, 0),
    [decks],
  )

  if (spots.length === 0) {
    // Reuse the MyCollection empty state so the message stays
    // consistent with the rest of the app.
    return <MyCollection spots={spots} />
  }

  if (openRarity) {
    const filtered = spots.filter(
      (s) => (s.rarity ?? 'standard') === openRarity,
    )
    return (
      <div>
        {/* Header keeps the 16px gutter; the grid below stays full-bleed. */}
        <div className="px-4">
          <button
            onClick={() => setOpenRarity(null)}
            className="tappable mb-4 inline-flex items-center gap-2 text-xs font-medium text-fg2 hover:text-fg"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('profilepage.decks.allDecks')}
          </button>
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-lg font-semibold tracking-tight text-fg">
              {t(`profilepage.rarity.${openRarity}`)}
            </h3>
            <span className="text-xs font-normal text-fg2">
              {t('profilepage.decks.cardCount', {
                count: new Set(
                  filtered.map((s) =>
                    cardKey(s.brand ?? '', s.model ?? '', s.color),
                  ),
                ).size,
              })}
            </span>
          </div>
        </div>
        <MyCollection spots={filtered} />
      </div>
    )
  }

  return (
    // Deck list keeps the 16px gutter (full-bleed only applies to the
    // 2-col card grid shown after drilling into a deck).
    <div className="space-y-3 px-4">
      {/* Collection summary — total cards + rarity distribution pills,
          ordered Légendaire-first like the decks below. */}
      <div
        className="rounded-2xl px-5 py-4"
        style={{
          background: 'rgb(var(--color-card))',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="flex items-baseline justify-between">
          <span
            className="text-[10px] font-black uppercase text-fg2/55"
            style={{ letterSpacing: '0.2em' }}
          >
            {t('profilepage.decks.summaryLabel')}
          </span>
          <span className="font-display text-2xl font-extrabold leading-none text-fg">
            {totalCards}
            <span className="ml-1.5 text-[11px] font-bold text-fg2">
              {t('profilepage.decks.cardWord', { count: totalCards })}
            </span>
          </span>
        </div>
        <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto py-0.5">
          {decks.map((d) => {
            const rb = rarityBadge(d.rarity)
            return (
              <span
                key={d.rarity}
                className="flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black uppercase"
                style={{
                  background: rb.bg,
                  color: rb.fg,
                  border: `1px solid ${rb.border}`,
                  letterSpacing: '0.04em',
                }}
              >
                {rb.label}
                <span className="font-extrabold opacity-80">{d.count}</span>
              </span>
            )
          })}
        </div>
      </div>

      {decks.map((d) => (
        <button
          key={d.rarity}
          onClick={() => setOpenRarity(d.rarity)}
          className="tappable relative flex w-full items-center gap-4 overflow-hidden rounded-2xl px-5 py-5 text-left transition-transform duration-200 active:scale-[0.98]"
          style={{
            background: 'rgb(var(--color-card))',
            border: '1px solid var(--color-border)',
          }}
        >
          {/* Furtive background: the best car of the deck, darkened and
              blurred so the white text reads cleanly on top. */}
          {d.cover && (
            <>
              <img
                src={d.cover}
                alt=""
                aria-hidden
                loading="lazy"
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                style={{ opacity: 0.3, filter: 'blur(6px)' }}
              />
              {/* Discreet dark linear filter behind the white text so the
                  deck name stays perfectly legible over any blurred
                  background photo. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/60 via-black/20 to-transparent"
              />
            </>
          )}

          {/* Card level-up teaser — a discreet "Lv.1" + greyed micro-lock
              hinting the evolution system is coming. Shown until
              SHOW_CARD_LEVEL_UP flips on. */}
          {!appConfig.SHOW_CARD_LEVEL_UP && (
            <span
              className={`absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                d.cover ? 'bg-black/40 text-white/80' : 'bg-fg/[0.06] text-fg2'
              }`}
            >
              Lv.1
              <Lock className="h-2.5 w-2.5 opacity-70" strokeWidth={2.2} />
            </span>
          )}

          <div className="relative z-10 min-w-0 flex-1">
            <h4
              className={`text-base font-semibold tracking-tight ${
                d.cover ? 'text-white' : 'text-fg'
              }`}
            >
              {d.label}
            </h4>
            <p
              className={`mt-0.5 text-xs font-normal ${
                d.cover ? 'text-white/65' : 'text-fg2'
              }`}
            >
              {t('profilepage.decks.cardsCollected', { count: d.count })}
            </p>
          </div>

          <ChevronRight
            className={`relative z-10 h-4 w-4 flex-none ${
              d.cover ? 'text-white/55' : 'text-fg2'
            }`}
          />
        </button>
      ))}
    </div>
  )
}

// ─────────────────────────── GARAGE COVER FLOW ──────────────────────────

/** Horizontal "Cover Flow" carousel for the Garage tab. Dedupes the
 *  user's spots by (brand, model) keeping the highest-rarity instance
 *  so the same car never appears twice. CSS scroll-snap drives the
 *  swipe feel; an IntersectionObserver watches which card is centred
 *  in the scroller and sets that one to scale-100 / others to
 *  scale-90 opacity-40 — the classic 3-D depth effect. Tapping the
 *  active card opens the underlying spot. */
// ────────────────────────── BADGES BOTTOM SHEET ─────────────────────────

/** Slide-up drawer that surfaces the full badge catalogue from the
 *  Récompenses tab. The 4 featured tiles remain visible on the main
 *  surface; opening the sheet swaps the "Voir tous" nav with an
 *  in-place modal that keeps the user anchored in /profile. Portaled
 *  to document.body so the scroll-locked layout under the sheet
 *  doesn't fight with Profile's own overflow rules. */
function BadgesBottomSheet({
  open,
  onClose,
  badges,
  unlocks,
}: {
  open: boolean
  onClose: () => void
  badges: Badge[]
  unlocks: Set<string>
}) {
  const { t } = useTranslation()
  // Lock body scroll while the sheet is open. We restore the previous
  // overflow value on close so nothing the rest of the app set is
  // accidentally clobbered.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button
        aria-label={t('profilepage.badgesSheet.closeAria')}
        onClick={onClose}
        className="absolute inset-0"
        style={{
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          animation: 'sheet-backdrop-in 220ms ease-out both',
        }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 overflow-hidden"
        style={{
          background: 'rgb(var(--color-card) / 0.96)',
          borderTopLeftRadius: '28px',
          borderTopRightRadius: '28px',
          borderTop: '1px solid rgb(var(--color-fg) / 0.08)',
          maxHeight: '85vh',
          paddingBottom: 'env(safe-area-inset-bottom)',
          backdropFilter: 'saturate(160%) blur(22px)',
          WebkitBackdropFilter: 'saturate(160%) blur(22px)',
          boxShadow: '0 -24px 60px rgba(0, 0, 0, 0.65)',
          animation:
            'sheet-slide-up 280ms cubic-bezier(0.32, 0.72, 0, 1) both',
        }}
      >
        {/* Drag handle pill — iOS-style affordance. Not actually
            draggable on this MVP (would need pointer-event plumbing),
            but the visual cue keeps the sheet readable. */}
        <div className="flex justify-center pt-3">
          <span
            className="rounded-full"
            style={{
              width: '40px',
              height: '4px',
              background: 'rgb(var(--color-fg) / 0.18)',
            }}
            aria-hidden
          />
        </div>
        <div className="flex items-center justify-between px-5 pb-3 pt-4">
          <h3
            className="font-display font-extrabold tracking-tight text-fg"
            style={{ fontSize: '20px', letterSpacing: '-0.02em' }}
          >
            {t('profilepage.badgesSheet.title')}
          </h3>
          <button
            onClick={onClose}
            aria-label={t('profilepage.badgesSheet.closeAria')}
            className="tappable flex h-9 w-9 items-center justify-center rounded-full text-fg2 hover:text-fg"
            style={{
              background: 'rgb(var(--color-fg) / 0.06)',
              border: '1px solid rgb(var(--color-fg) / 0.08)',
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div
          className="overflow-y-auto px-4 pb-6"
          style={{
            maxHeight: 'calc(85vh - 100px)',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <div className="grid grid-cols-3 gap-2.5">
            {badges.map((b) => {
              const isUnlocked = unlocks.has(b.slug)
              const icon = badgeIcon(b.slug)
              return (
                <div
                  key={b.slug}
                  className="flex flex-col items-center gap-2 rounded-2xl p-3 text-center"
                  style={{
                    background: 'var(--color-glass-mid)',
                    border: isUnlocked
                      ? b.gold
                        ? '1px solid rgba(224,179,65,0.40)'
                        : '1px solid rgba(232,32,58,0.30)'
                      : '1px solid rgb(var(--color-fg) / 0.05)',
                    backdropFilter: 'saturate(150%) blur(10px)',
                    WebkitBackdropFilter: 'saturate(150%) blur(10px)',
                    boxShadow:
                      isUnlocked && !b.gold
                        ? '0 8px 22px rgba(232,32,58,0.16)'
                        : isUnlocked && b.gold
                          ? '0 8px 22px rgba(224,179,65,0.20)'
                          : 'inset 0 1px 0 rgb(var(--color-fg) / 0.03)',
                  }}
                >
                  {isUnlocked ? (
                    icon ? (
                      <img
                        src={icon}
                        alt=""
                        className="h-12 w-12 rounded-xl object-cover"
                      />
                    ) : (
                      <span className="flex h-12 items-center justify-center text-2xl">
                        {b.emoji}
                      </span>
                    )
                  ) : (
                    <span className="flex h-12 items-center justify-center">
                      <Lock className="h-4 w-4 text-fg2/50" />
                    </span>
                  )}
                  <span
                    className={`line-clamp-2 text-[10px] font-semibold leading-tight ${
                      isUnlocked
                        ? b.gold
                          ? 'text-[#E0B341]'
                          : 'text-accent'
                        : 'text-fg2/60'
                    }`}
                  >
                    {b.name}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}


// ───────────────────────────── TOP CHALLENGES ─────────────────────────────

/** Compact top-N collections list used on the Récompenses tab. Picks
 *  the N collections (default 2) with the highest completion ratio,
 *  excluding ones already claimed. Each card surfaces a thin h-1
 *  progress bar + the RÉCLAMER CTA, which is only enabled when the
 *  collection has reached 100% completion. Replaces the previous
 *  full-length CollectionsSection list on this tab — the long list
 *  is still reachable from /challenges. */
function TopChallenges({
  spots,
  count,
  onShowAll,
}: {
  spots: Spot[]
  count: number
  onShowAll: () => void
}) {
  const { t } = useTranslation()
  const [claimed, setClaimed] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchClaimedCollections().then((m) => {
      if (active) setClaimed(m)
    })
    return () => {
      active = false
    }
  }, [])

  const top = useMemo<CollectionProgress[]>(() => {
    const all = COLLECTIONS.map((c) =>
      computeProgress(c, spots, claimed[c.id] ?? null),
    )
    // Unclaimed only, sorted by ratio desc. Ties broken by raw
    // matchedCount to keep the leaderboard deterministic across re-
    // renders (Map iteration order is insertion-stable but the spec
    // here is "highest %, then highest absolute count").
    return all
      .filter((p) => p.claimedAt === null)
      .sort((a, b) => {
        const ra = a.matchedCount / Math.max(1, a.target)
        const rb = b.matchedCount / Math.max(1, b.target)
        if (rb !== ra) return rb - ra
        return b.matchedCount - a.matchedCount
      })
      .slice(0, count)
  }, [spots, claimed, count])

  async function onClaim(id: string, xpReward: number) {
    if (busyId) return
    setBusyId(id)
    const { ok } = await claimCollection(id)
    setBusyId(null)
    if (ok) {
      floatXp(xpReward)
      setClaimed((c) => ({ ...c, [id]: new Date().toISOString() }))
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h4
          className="font-black uppercase text-fg2/55"
          style={{ fontSize: '10px', letterSpacing: '0.20em' }}
        >
          {t('profilepage.challenges.heading')}
        </h4>
        <button
          onClick={onShowAll}
          className="tappable font-bold text-accent hover:underline"
          style={{ fontSize: '10px' }}
        >
          {t('profilepage.challenges.seeAll')}
        </button>
      </div>
      <div className="space-y-3">
        {top.length === 0 ? (
          <div
            className="rounded-2xl p-4 text-center text-xs text-fg2"
            style={{
              background: 'var(--color-glass)',
              border: '1px solid rgb(var(--color-fg) / 0.05)',
            }}
          >
            {t('profilepage.challenges.allClaimed')}
          </div>
        ) : (
          top.map((p) => (
            <TopChallengeCard
              key={p.collection.id}
              progress={p}
              busy={busyId === p.collection.id}
              onClaim={() => onClaim(p.collection.id, p.collection.xpReward)}
            />
          ))
        )}
      </div>
    </section>
  )
}

function TopChallengeCard({
  progress,
  busy,
  onClaim,
}: {
  progress: CollectionProgress
  busy: boolean
  onClaim: () => void
}) {
  const { t } = useTranslation()
  const { collection, matchedCount, target } = progress
  const pct = Math.min(100, Math.round((matchedCount / target) * 100))
  const complete = matchedCount >= target
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-2xl p-4"
      style={{
        background: 'var(--color-glass)',
        border: '1px solid rgb(var(--color-fg) / 0.05)',
        backdropFilter: 'saturate(150%) blur(10px)',
        WebkitBackdropFilter: 'saturate(150%) blur(10px)',
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none" aria-hidden>
            {collection.emoji}
          </span>
          <h5
            className="min-w-0 flex-1 truncate font-display font-black tracking-tight text-fg"
            style={{ fontSize: '13px', letterSpacing: '-0.01em' }}
          >
            {collection.title}
          </h5>
        </div>
        {/* Thin h-1 progress bar per spec — accent-red fill, neutral
            track. Reads as a status strip rather than a chunky
            achievement gauge. */}
        <div
          className="mt-2.5 h-1 w-full overflow-hidden rounded-full"
          style={{ background: 'rgb(var(--color-fg) / 0.06)' }}
        >
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
            style={{
              width: `${pct}%`,
              boxShadow: complete
                ? '0 0 10px rgba(232, 32, 58, 0.50)'
                : undefined,
            }}
          />
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <span
          className="mb-1 block font-bold text-fg2"
          style={{ fontSize: '10px' }}
        >
          {matchedCount} / {target}
        </span>
        {complete ? (
          <button
            onClick={onClaim}
            disabled={busy}
            className="tappable rounded-lg font-black uppercase tracking-wider text-white shadow-md transition-transform active:scale-[0.97]"
            style={{
              background:
                'linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)',
              border: '1px solid rgb(var(--color-fg) / 0.10)',
              padding: '6px 12px',
              fontSize: '9px',
              letterSpacing: '0.10em',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? '…' : t('profilepage.challenges.claim')}
          </button>
        ) : (
          <span
            className="inline-block cursor-not-allowed rounded-lg font-bold uppercase tracking-wider text-fg2"
            style={{
              background: 'rgb(var(--color-card) / 0.60)',
              border: '1px solid rgb(var(--color-fg) / 0.05)',
              padding: '6px 12px',
              fontSize: '9px',
              letterSpacing: '0.10em',
            }}
          >
            {t('profilepage.challenges.inProgress')}
          </span>
        )}
      </div>
    </div>
  )
}
