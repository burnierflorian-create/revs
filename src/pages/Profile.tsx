import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronRight,
  Lock,
  Settings,
  Warehouse,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { categoryLabel, type Rarity, type Spot } from '../lib/spots'
import { planDisplayName, planTier } from '../lib/plans'
import { allBadges, computeUnlocks, type Badge } from '../lib/badges'
import { fetchRaceStats } from '../lib/race'
import { xpLevel } from '../lib/xp'
import { useMyTier } from '../lib/tier'
import { Skeleton } from '../components/Skeleton'
import MyCollection from '../components/MyCollection'
import { rarityRank } from '../components/CollectorCard'
import {
  COLLECTIONS,
  claimCollection,
  computeProgress,
  fetchClaimedCollections,
  type CollectionProgress,
} from '../lib/collections'
import { floatXp } from '../components/XpFloater'


export default function Profile() {
  const navigate = useNavigate()
  const tier = useMyTier()

  const [loading, setLoading] = useState(true)
  const [pseudo, setPseudo] = useState('Spotter')
  const [ville, setVille] = useState('')
  const [title, setTitle] = useState<string | null>(null)
  const [avatar, setAvatar] = useState<string | null>(null)
  const [spots, setSpots] = useState<Spot[]>([])
  const [uniqueBrands, setUniqueBrands] = useState(0)
  const [rank, setRank] = useState<number | null>(null)
  const [hasEvent, setHasEvent] = useState(false)
  const [xp, setXp] = useState(0)
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
  // Local-only UI state: which of the two sub-tabs (Garage vs
  // Collection) is currently visible at the bottom of the profile.
  // Single segmented control across the lower half of Profile — replaces
  // the older flat scroll of Stats / Challenges / Subscription / Badges /
  // Collections / Garage. Each tab owns its own content block.
  const [profileTab, setProfileTab] = useState<
    'collection' | 'garage' | 'rewards'
  >('collection')
  // REVS RACE counters drive the race-* badges. Fetched once per
  // mount; absent until the call returns (badges just stay locked).
  const [raceStats, setRaceStats] = useState<{
    wins: number
    losses: number
    perfectStarts: number
  } | null>(null)

  // Cover backdrop: the user's most valuable spot becomes the hero
  // image, blurred + dimmed. Falls back to the brand red gradient when
  // the user has no spot with a photo + price. Computed up here (above
  // the `if (loading) return …` guard) so hook order stays stable
  // across the loading → ready transition.
  const bestSpot = useMemo(() => {
    return spots
      .filter((s) => s.photo_url && (s.estimated_price ?? 0) > 0)
      .sort(
        (a, b) => (b.estimated_price ?? 0) - (a.estimated_price ?? 0),
      )[0]
  }, [spots])

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const [
        spotsRes,
        allUidsRes,
        eventsRes,
        xpRes,
        profRes,
        subRes,
        followersRes,
      ] = await Promise.all([
          supabase
            .from('spots')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          supabase.from('spots').select('user_id'),
          supabase
            .from('events')
            .select('id', { count: 'exact', head: true })
            .eq('organizer_id', user.id),
          supabase.rpc('my_xp'),
          supabase
            .from('profiles')
            .select('pseudo, ville, avatar, created_at, title')
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
      const total = mySpots.length

      let rk: number | null = null
      if (allUidsRes.data && total > 0) {
        const counts = new globalThis.Map<string, number>()
        for (const r of allUidsRes.data as { user_id: string }[]) {
          counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1)
        }
        const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
        const idx = sorted.findIndex(([uid]) => uid === user.id)
        rk = idx >= 0 ? idx + 1 : null
      }

      const email = user.email ?? ''
      setPseudo(
        profRes.data?.pseudo ||
          (email ? email.split('@')[0] : '') ||
          'Spotter',
      )
      setVille(profRes.data?.ville ?? '')
      setTitle((profRes.data as { title?: string | null } | null)?.title ?? null)
      setAvatar(profRes.data?.avatar ?? null)
      setSpots(mySpots)
      setUniqueBrands(
        new Set(mySpots.map((s) => s.brand).filter(Boolean)).size,
      )
      setRank(rk)
      setHasEvent((eventsRes.count ?? 0) > 0)
      setXp(typeof xpRes.data === 'number' ? xpRes.data : 0)
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

  const level = xpLevel(xp)

  // Single furtive identity line: status • level • ville (e.g.
  // "FONDATEUR • EXPERT • ANNECY") — replaces the stacked gold/red badges.
  const statusLabel =
    title ||
    (planTier(plan) === 'vip'
      ? 'VIP'
      : planTier(plan) === 'premium'
        ? 'Premium'
        : null)
  const idLine = [statusLabel, level.name, ville]
    .filter(Boolean)
    .map((s) => (s as string).toUpperCase())
    .join('  •  ')

  useEffect(() => {
    if (loading) return
    const id = requestAnimationFrame(() => setAnimPct(level.pct))
    return () => cancelAnimationFrame(id)
  }, [loading, level.pct])

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

  const total = spots.length
  const daysWithSpot = new Set(spots.map((s) => s.created_at.slice(0, 10)))
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
  const badgeCatalogue = allBadges(badgeCtx)
  const unlocks = computeUnlocks(badgeCtx)
  // Top row: prefer unlocked badges (most-impressive feel); pad with the
  // first locked ones so the row is always 4 wide.
  const unlocked = badgeCatalogue.filter((b) => unlocks.has(b.slug))
  const locked = badgeCatalogue.filter((b) => !unlocks.has(b.slug))
  const topBadges = [...unlocked, ...locked].slice(0, 4)

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* SECTION 1 — Cover + avatar. When the user has a spot worth
          showing off, we use its photo as the immersive backdrop
          (heavy blur + dim overlay). Falls back to the brand red
          gradient when the garage is empty. */}
      <div className="relative">
        {bestSpot?.photo_url ? (
          <div className="relative h-48 w-full overflow-hidden">
            <img
              src={bestSpot.photo_url}
              alt=""
              aria-hidden
              // LCP candidate on the profile route — keep eager and
              // hint the browser to fetch with high priority.
              fetchPriority="high"
              decoding="async"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              style={{
                // Heavy blur + 30% opacity per the 2026-06-02 immersive
                // spec — the photo reads as ambient atmosphere rather
                // than a recognisable scene. scale(1.15) hides the
                // blur fringe on the edges.
                filter: 'blur(24px) saturate(1.10)',
                transform: 'scale(1.15)',
                opacity: 0.30,
              }}
            />
            {/* Vertical transparent → black gradient overlay so the
                backdrop fades smoothly into the dark body of the
                profile. Replaces the flat 40% scrim. */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.85) 70%, rgba(0,0,0,1) 100%)',
              }}
            />
          </div>
        ) : (
          <div
            className="h-48 w-full"
            style={{
              background:
                'radial-gradient(ellipse 80% 100% at 50% 0%, rgba(232,32,58,0.35) 0%, transparent 60%), linear-gradient(180deg, #4a0f16 0%, #1a060a 55%, rgb(var(--color-bg)) 100%)',
            }}
          />
        )}
        {/* Bottom edge softener — blends the cover into the page bg */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
          style={{
            background:
              'linear-gradient(180deg, transparent 0%, rgb(var(--color-bg)) 100%)',
          }}
        />
        <button
          onClick={() => navigate('/settings')}
          aria-label="Paramètres"
          className="tappable absolute right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-fg/80 backdrop-blur transition-colors hover:text-fg"
          style={{ border: '1px solid rgb(var(--color-fg) / 0.10)' }}
        >
          <Settings className="h-5 w-5" />
        </button>
        <div className="absolute inset-x-0 -bottom-14 flex justify-center">
          {/* Avatar with thin white liseré — replaces the conic-gradient
              ring per the immersive header polish. VIP / Premium tier
              still gets its overlay badge at the corner so paid status
              stays unmissable. */}
          <div className="relative">
            {/* Diffuse radial halo behind the avatar — soft warm-neutral
                glow that lifts the disc off the immersive cover
                backdrop without competing with the VIP gold ring.
                pointer-events:none so it never intercepts taps. */}
            <span
              aria-hidden
              className="pointer-events-none absolute z-0 rounded-full"
              style={{
                inset: '-22px',
                background:
                  'radial-gradient(circle at center, rgba(64, 64, 64, 0.45) 0%, rgba(64, 64, 64, 0.18) 45%, transparent 75%)',
                filter: 'blur(18px)',
              }}
            />
            <div
              className="relative z-10 flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-card"
              style={{
                border:
                  tier === 'vip'
                    ? '2px solid rgba(255, 215, 0, 0.55)'
                    : '2px solid rgb(var(--color-fg) / 0.20)',
                boxShadow:
                  tier === 'vip'
                    ? '0 18px 38px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 215, 0, 0.18)'
                    : '0 18px 38px rgba(0, 0, 0, 0.55), 0 0 0 1px rgb(var(--color-fg) / 0.06)',
              }}
            >
              <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full font-display text-4xl font-extrabold tracking-tighter text-fg">
                {avatar ? (
                  <img
                    src={avatar}
                    alt=""
                    // Above-the-fold avatar — keep eager + high priority
                    // so it doesn't flicker in after the cover.
                    fetchPriority="high"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  pseudo.charAt(0).toUpperCase()
                )}
              </div>
            </div>
            {/* Tier badge — gold ⚡ for premium, gold 👑 (slow pulse)
                for VIP. Discreet enough not to fight the avatar but
                impossible to miss. */}
            {tier === 'premium' && (
              <span
                className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full text-lg"
                style={{
                  background:
                    'linear-gradient(135deg, #FFD700 0%, #E8B225 50%, #B8860B 100%)',
                  border: '2px solid rgb(var(--color-card))',
                  boxShadow: '0 4px 14px rgba(255,200,50,0.45)',
                }}
                aria-label="Membre Premium"
              >
                ⚡
              </span>
            )}
            {tier === 'vip' && (
              <span
                className="lvl-glow absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full text-lg"
                style={{
                  background:
                    'linear-gradient(135deg, #FFE066 0%, #FFD700 45%, #B8860B 100%)',
                  border: '2px solid rgb(var(--color-card))',
                  boxShadow: '0 6px 18px rgba(255,200,50,0.55)',
                }}
                aria-label="Membre VIP"
              >
                👑
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Inner pb-40 per the 2026-06-02 collision-fix spec — extra 16
          px on top of .tab-pane's calc(9rem + safe-area) so the
          Collection grid / Garage cover flow / Récompenses drawer
          never slide under the tab bar even on the longest profiles
          (early-adopters with 100+ cards). */}
      <div className="space-y-7 px-4 pb-40 pt-20">
        {/* Identité */}
        <div className="text-center">
          <h1 className="display-xl text-fg">{pseudo}</h1>
          {/* Furtive identity line — status • level • ville, all in one
              thin steel-grey row (no stacked gold/red badges). */}
          {idLine && (
            <p
              className="mt-2.5 text-xs font-normal text-fg2"
              style={{ letterSpacing: '0.18em' }}
            >
              {idLine}
            </p>
          )}
          {/* Unified stats pill — replaces both the followers/following
              card and the section-3 stats row per the 2026-06-01 profile
              refocus. Four tappable stats on one line (spots, marques,
              rang, abonnés), separated by tiny dot bullets. Each stat
              keeps its own deep-link target, the pill is just shared
              chrome. */}
          <div className="mt-4 flex justify-center">
            <div
              className="inline-flex items-center gap-3.5 rounded-full"
              style={{
                background: 'var(--color-glass)',
                border: '1px solid rgb(var(--color-fg) / 0.05)',
                padding: '8px 16px',
              }}
            >
              <ProfileStatTiny
                value={String(total)}
                label="spots"
                onClick={() => navigate('/ma-galerie')}
              />
              <span className="h-1 w-1 rounded-full bg-fg2/40" aria-hidden />
              <ProfileStatTiny
                value={String(uniqueBrands)}
                label="marques"
                onClick={() => navigate('/mes-marques')}
              />
              <span className="h-1 w-1 rounded-full bg-fg2/40" aria-hidden />
              <ProfileStatTiny
                value={rank ? `#${rank}` : '—'}
                label="rang"
                onClick={() => navigate('/classement')}
              />
              {meId && (
                <>
                  <span
                    className="h-1 w-1 rounded-full bg-fg2/40"
                    aria-hidden
                  />
                  <ProfileStatTiny
                    value={String(followers)}
                    label={followers === 1 ? 'abonné' : 'abonnés'}
                    onClick={() => navigate(`/u/${meId}`)}
                  />
                </>
              )}
            </div>
          </div>

          {/* Hairline XP — a 2px jet track filling pure white, right under
              the stats line; tiny unified caption below. Replaces the big
              central "Niveau" card. */}
          <div className="mx-auto mt-4 max-w-[280px]">
            <div className="h-1 w-full overflow-hidden rounded-full bg-fg/[0.10]">
              <div
                className="h-full rounded-full bg-fg transition-[width] duration-1000 ease-out"
                style={{ width: `${animPct}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs font-normal text-fg2">
              {level.isMax
                ? `${level.name} — ${new Intl.NumberFormat('fr-FR').format(xp)} XP`
                : `${level.name} — ${new Intl.NumberFormat('fr-FR').format(xp)} XP (Plus que ${level.toNext} XP avant ${level.next})`}
            </p>
          </div>
        </div>

        {/* PREMIUM BANNER moved to the very bottom of the profile
            page per the 2026-06-01 cleanup so the stats pill flows
            directly into the segmented control without a paid CTA
            wedge. See <PremiumTopBanner /> at the end of this block. */}

        {/* TAB NAV — three plain words spaced horizontally (Apple text
            nav): active in pure white under a 1px underline, inactive in
            muted grey. No pills, no gradient fills, no emoji. */}
        <section>
          <div className="flex gap-6 px-1" role="tablist">
            {(
              [
                { key: 'collection', label: 'Collection' },
                { key: 'garage', label: 'Garage' },
                { key: 'rewards', label: 'Récompenses' },
              ] as const
            ).map((t) => {
              const active = profileTab === t.key
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setProfileTab(t.key)}
                  className="tappable relative pb-2 text-sm transition-colors"
                >
                  <span
                    className={
                      active ? 'font-medium text-fg' : 'font-normal text-fg2'
                    }
                  >
                    {t.label}
                  </span>
                  {active && (
                    <span className="absolute inset-x-0 -bottom-px h-px bg-fg" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Tab content wrapper — px-2 nets px-6 from the screen edge
              (parent already carries px-4). Gives the 2-col collection
              grid breathing room so cards don't slam the phone edge. */}
          <div className="mt-5 px-2">
            {profileTab === 'collection' && <CollectionDecks spots={spots} />}

            {profileTab === 'garage' &&
              (total === 0 ? (
                <div className="flex flex-col items-center rounded-2xl border border-fg/5 bg-card px-6 py-12 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
                    <Warehouse className="h-8 w-8 text-accent/70" />
                  </div>
                  <p className="mt-4 max-w-[15rem] font-medium">
                    Ton garage est vide, pars chasser ta première supercar
                  </p>
                  <button
                    onClick={() => navigate('/new-spot')}
                    className="mt-5 rounded-full bg-accent px-6 py-3 text-sm font-semibold"
                  >
                    Spotter
                  </button>
                </div>
              ) : (
                <GarageCoverFlow
                  spots={spots}
                  onOpen={(id) => navigate(`/spot/${id}`)}
                />
              ))}

            {profileTab === 'rewards' && (
              <div className="space-y-7">
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
                          Abonnement
                        </span>
                        <span className="font-display text-base font-bold text-fg">
                          {planDisplayName(plan)}
                        </span>
                      </span>
                    </span>
                    <span className="text-xs text-fg/55">Gérer →</span>
                  </button>
                )}

                {/* SECTION 1 — Trophées équipés. Horizontal scroll of
                    the 4 featured badges in 64×64 glass squares, with
                    a tiny inline "Voir les N" trigger that opens the
                    BadgesBottomSheet drawer. Replaces the previous
                    grid-cols-4 + full-width pill layout. */}
                <section>
                  <div className="flex items-center justify-between">
                    <h4
                      className="font-black uppercase text-fg2/55"
                      style={{
                        fontSize: '10px',
                        letterSpacing: '0.20em',
                      }}
                    >
                      Trophées équipés
                    </h4>
                    <button
                      onClick={() => setBadgesSheetOpen(true)}
                      className="tappable font-bold text-accent hover:underline"
                      style={{ fontSize: '10px' }}
                    >
                      Voir les {badgeCatalogue.length}
                    </button>
                  </div>
                  <div className="no-scrollbar mt-3 flex gap-3 overflow-x-auto py-1">
                    {topBadges.map((b) => {
                      const isUnlocked = unlocks.has(b.slug)
                      return (
                        <button
                          key={b.slug}
                          onClick={() => navigate(`/badges/${b.slug}`)}
                          className="tappable flex flex-shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl p-2 text-center"
                          style={{
                            width: '64px',
                            height: '64px',
                            background: 'var(--color-glass-strong)',
                            border: isUnlocked
                              ? b.gold
                                ? '1px solid rgba(224,179,65,0.40)'
                                : '1px solid rgba(232,32,58,0.30)'
                              : '1px solid rgb(var(--color-fg) / 0.05)',
                            backdropFilter: 'saturate(160%) blur(12px)',
                            WebkitBackdropFilter: 'saturate(160%) blur(12px)',
                            boxShadow:
                              isUnlocked && !b.gold
                                ? '0 8px 22px rgba(232,32,58,0.16)'
                                : isUnlocked && b.gold
                                  ? '0 8px 22px rgba(224,179,65,0.20)'
                                  : 'inset 0 1px 0 rgb(var(--color-fg) / 0.03)',
                          }}
                          aria-label={b.name}
                        >
                          {isUnlocked ? (
                            <span className="text-xl">{b.emoji}</span>
                          ) : (
                            <Lock className="h-4 w-4 text-fg2/50" />
                          )}
                          <span
                            className="w-full truncate font-bold leading-tight"
                            style={{
                              fontSize: '8px',
                              color: isUnlocked
                                ? b.gold
                                  ? '#E0B341'
                                  : 'rgb(var(--color-accent))'
                                : 'rgb(var(--color-fg) / 0.40)',
                            }}
                          >
                            {b.name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>

                {/* SECTION 2 — Défis en cours. Renders the top 2
                    collections by completion ratio (claimed ones are
                    skipped). Compact h-1 progress bar; the RÉCLAMER
                    button is enabled only at 100%. */}
                <TopChallenges
                  spots={spots}
                  count={2}
                  onShowAll={() => navigate('/challenges')}
                />
              </div>
            )}
          </div>
        </section>

        {/* PREMIUM BANNER (free users only) — relegated to the very
            bottom per the 2026-06-01 cleanup. The user lands on a
            dense identity + stats + tab area first; the paid CTA
            sits as a soft anchor at the end of the scroll. */}
        {!plan && <PremiumTopBanner onTap={() => navigate('/premium')} />}

      </div>

      <BadgesBottomSheet
        open={badgesSheetOpen}
        onClose={() => setBadgesSheetOpen(false)}
        badges={badgeCatalogue}
        unlocks={unlocks}
      />
    </div>
  )
}

// ─────────────────────── Profile helpers (post-restructure) ───────────────────────

/** Tiny tappable stat used inside the unified pill that replaced the
 *  followers/following card AND the old section-3 stats row. Compact
 *  one-line format — bold white number, semibold neutral label, same
 *  baseline. Dots between stats are owned by the parent. */
function ProfileStatTiny({
  value,
  label,
  onClick,
}: {
  value: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="tappable inline-flex items-baseline gap-1 text-fg2"
      style={{ fontSize: '11px', fontWeight: 600 }}
    >
      <span
        className="font-black tabular-nums text-fg"
        style={{ fontSize: '12px' }}
      >
        {value}
      </span>
      <span className="lowercase">{label}</span>
    </button>
  )
}

/** Monochrome list line nudging free users toward /premium — no gold
 *  border, gradient or shimmer. Reads as a quiet settings row: a label
 *  with a thin grey subtitle and a chevron, separated from the page by
 *  a single hairline. */
function PremiumTopBanner({ onTap }: { onTap: () => void }) {
  return (
    <button
      onClick={onTap}
      className="tappable flex w-full items-center justify-between gap-3 py-4 text-left"
      style={{ borderTop: '1px solid var(--color-divider)' }}
    >
      <div className="min-w-0">
        <p className="text-base font-semibold text-fg">Club REVS Premium</p>
        <p className="mt-0.5 text-xs font-normal text-fg2">
          Mode Radar temps réel & spots illimités
        </p>
      </div>
      <ChevronRight className="h-5 w-5 flex-none text-fg2" />
    </button>
  )
}

/** Brand-aware glow used as a soft halo on the GarageCoverFlow horizontal
 *  cards. Lowercase substring match against the brand string keeps
 *  the table small while covering enough variants. Default fallback
 *  is the REVS accent red. */
function brandGlow(brand: string | null | undefined): string {
  const b = (brand ?? '').toLowerCase()
  if (b.includes('ferrari')) return 'rgba(232, 32, 58, 0.30)'
  if (b.includes('lamborghini') || b.includes('lambo'))
    return 'rgba(255, 215, 0, 0.28)'
  if (b.includes('porsche')) return 'rgba(220, 220, 220, 0.25)'
  if (b.includes('mclaren')) return 'rgba(255, 138, 0, 0.30)'
  if (b.includes('audi')) return 'rgba(232, 32, 58, 0.25)'
  if (b.includes('bmw')) return 'rgba(59, 130, 246, 0.28)'
  if (b.includes('mercedes')) return 'rgba(220, 220, 220, 0.25)'
  if (b.includes('bentley')) return 'rgba(34, 139, 34, 0.25)'
  if (b.includes('aston')) return 'rgba(0, 100, 0, 0.25)'
  if (b.includes('rolls')) return 'rgba(160, 100, 200, 0.25)'
  if (b.includes('bugatti')) return 'rgba(20, 70, 180, 0.28)'
  if (b.includes('koenigsegg')) return 'rgba(255, 255, 255, 0.22)'
  if (b.includes('pagani')) return 'rgba(255, 0, 128, 0.25)'
  if (b.includes('toyota') || b.includes('lexus'))
    return 'rgba(140, 140, 140, 0.22)'
  if (b.includes('honda') || b.includes('acura'))
    return 'rgba(220, 220, 220, 0.22)'
  if (b.includes('nissan') || b.includes('nismo'))
    return 'rgba(170, 0, 0, 0.25)'
  if (b.includes('volkswagen') || b.includes('vw'))
    return 'rgba(40, 90, 170, 0.22)'
  if (b.includes('volvo')) return 'rgba(30, 90, 130, 0.22)'
  if (b.includes('mazda')) return 'rgba(200, 0, 0, 0.22)'
  if (b.includes('subaru')) return 'rgba(0, 100, 200, 0.22)'
  return 'rgba(232, 32, 58, 0.20)'
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
const DECK_LABEL: Record<Rarity, string> = {
  hypercar: 'Hypercar',
  supercar: 'Supercar',
  exclusif: 'Exclusif',
  performance: 'Performance',
  premium: 'Premium',
  standard: 'Standard',
}

function CollectionDecks({ spots }: { spots: Spot[] }) {
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
      return { rarity: r, label: DECK_LABEL[r], count: inRarity.length, cover }
    }).filter((d) => d.count > 0)
  }, [spots])

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
        <button
          onClick={() => setOpenRarity(null)}
          className="tappable mb-4 inline-flex items-center gap-2 text-xs font-medium text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Tous les decks
        </button>
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-lg font-semibold tracking-tight text-fg">
            {DECK_LABEL[openRarity]}
          </h3>
          <span className="text-xs font-normal text-fg2">
            {filtered.length} carte{filtered.length > 1 ? 's' : ''}
          </span>
        </div>
        <MyCollection spots={filtered} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
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
              {d.count} carte{d.count > 1 ? 's' : ''} collectionnée
              {d.count > 1 ? 's' : ''}
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
function GarageCoverFlow({
  spots,
  onOpen,
}: {
  spots: Spot[]
  onOpen: (id: string) => void
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [activeIdx, setActiveIdx] = useState(0)

  const cars = useMemo(() => {
    const map = new Map<string, Spot>()
    for (const s of spots) {
      const key = `${(s.brand ?? '').toLowerCase().trim()}|${(s.model ?? '').toLowerCase().trim()}`
      if (!key.replace('|', '').trim()) continue
      const cur = map.get(key)
      if (!cur || rarityRank(s.rarity) > rarityRank(cur.rarity)) {
        map.set(key, s)
      }
    }
    return [...map.values()].sort(
      (a, b) => rarityRank(b.rarity) - rarityRank(a.rarity),
    )
  }, [spots])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const cards = scroller.querySelectorAll('[data-cover-card]')
    if (!cards.length) return

    const obs = new IntersectionObserver(
      (entries) => {
        let bestIdx = activeIdx
        let bestRatio = 0
        entries.forEach((e) => {
          if (e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio
            bestIdx = Number(e.target.getAttribute('data-idx'))
          }
        })
        if (bestRatio > 0) setActiveIdx(bestIdx)
      },
      { root: scroller, threshold: [0.5, 0.7, 0.9, 1.0] },
    )
    cards.forEach((c) => obs.observe(c))
    return () => obs.disconnect()
    // activeIdx omitted on purpose — observer is idempotent re-runs
    // would just churn the observation set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cars.length])

  return (
    <div className="-mx-2">
      {/* Negative margin neutralises the parent's px-2 so the carousel
          can full-bleed under the screen edges; padding inside the
          scroller restores the breathing room at the actual content. */}
      <div
        ref={scrollerRef}
        className="no-scrollbar flex snap-x snap-mandatory items-stretch gap-4 overflow-x-auto py-4"
        style={{
          paddingInline: 'max(env(safe-area-inset-left), 24px)',
          scrollPaddingInline: '24px',
          // WebKit needs this for smooth snap recovery on momentum
          // swipes when the scroller is nested inside another
          // scrolling container.
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {cars.map((s, i) => {
          const active = i === activeIdx
          const glow = brandGlow(s.brand)
          return (
            <button
              key={s.id}
              data-cover-card
              data-idx={i}
              onClick={() => onOpen(s.id)}
              className="snap-center flex-shrink-0 overflow-hidden rounded-3xl text-left transition-all duration-300 ease-out"
              style={{
                width: '280px',
                height: '160px',
                background:
                  'linear-gradient(135deg, rgb(var(--color-card)) 0%, rgb(var(--color-card)) 60%, rgb(var(--color-card)) 100%)',
                border: active
                  ? '1px solid rgb(var(--color-fg) / 0.10)'
                  : '1px solid rgb(var(--color-fg) / 0.05)',
                transform: active ? 'scale(1)' : 'scale(0.90)',
                opacity: active ? 1 : 0.4,
                boxShadow: active
                  ? `0 0 30px ${glow.replace('0.22', '0.35')}, 0 20px 40px rgba(0, 0, 0, 0.55)`
                  : '0 12px 24px rgba(0, 0, 0, 0.40)',
                willChange: 'transform, opacity',
              }}
              aria-label={`${s.brand ?? ''} ${s.model ?? ''}`}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  bottom: '-40px',
                  right: '-40px',
                  width: '180px',
                  height: '180px',
                  borderRadius: '50%',
                  background: glow,
                  filter: 'blur(48px)',
                  opacity: active ? 1 : 0.6,
                }}
              />
              <div className="relative z-10 flex h-full flex-col justify-between p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className="font-black uppercase"
                      style={{
                        color: active ? '#EF4444' : 'rgb(var(--color-fg-2))',
                        fontSize: '9px',
                        letterSpacing: '0.20em',
                      }}
                    >
                      {s.brand}
                    </p>
                    <h3
                      className="mt-0.5 truncate font-display font-black tracking-tight text-fg"
                      style={{
                        fontSize: '18px',
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {s.model}
                    </h3>
                  </div>
                  {typeof s.year === 'number' && s.year > 1900 && (
                    <span
                      className="flex-none rounded-md font-bold text-fg2"
                      style={{
                        background: 'rgb(var(--color-fg) / 0.05)',
                        padding: '2px 8px',
                        fontSize: '9px',
                      }}
                    >
                      {s.year}
                    </span>
                  )}
                </div>
                <p
                  className="text-fg2/70"
                  style={{ fontSize: '11px', fontWeight: 500 }}
                >
                  {categoryLabel(s.category)}
                </p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Dot indicator — keeps users oriented when many cars are
          in the garage. Hidden when only one car is present. */}
      {cars.length > 1 && (
        <div className="mt-1 flex justify-center gap-1.5">
          {cars.map((_, i) => (
            <span
              key={i}
              className="rounded-full transition-all duration-200"
              style={{
                width: i === activeIdx ? '16px' : '5px',
                height: '5px',
                background:
                  i === activeIdx
                    ? 'rgb(var(--color-accent))'
                    : 'rgb(var(--color-fg) / 0.15)',
              }}
              aria-hidden
            />
          ))}
        </div>
      )}
    </div>
  )
}

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
        aria-label="Fermer"
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
            Tous les badges
          </h3>
          <button
            onClick={onClose}
            aria-label="Fermer"
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
          <div className="grid grid-cols-3 gap-2">
            {badges.map((b) => {
              const isUnlocked = unlocks.has(b.slug)
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
                    <span className="text-2xl">{b.emoji}</span>
                  ) : (
                    <span className="flex h-7 items-center justify-center">
                      <Lock className="h-4 w-4 text-fg2/50" />
                    </span>
                  )}
                  <span
                    className={`text-[10px] font-semibold leading-tight ${
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
          Défis en cours
        </h4>
        <button
          onClick={onShowAll}
          className="tappable font-bold text-accent hover:underline"
          style={{ fontSize: '10px' }}
        >
          Tous les défis
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
            Tous les défis sont déjà réclamés. Bravo 🏁
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
            {busy ? '…' : 'Réclamer'}
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
            En cours
          </span>
        )}
      </div>
    </div>
  )
}
