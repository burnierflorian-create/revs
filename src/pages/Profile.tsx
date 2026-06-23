import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Lock,
  Settings,
  Share,
  Warehouse,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { type Rarity, type Spot } from '../lib/spots'
import { planDisplayName, planTier } from '../lib/plans'
import { allBadges, computeUnlocks, type Badge } from '../lib/badges'
import { fetchRaceStats } from '../lib/race'
import { xpLevel } from '../lib/xp'
import { useMyTier } from '../lib/tier'
import { appConfig } from '../config/appConfig'
import { Skeleton } from '../components/Skeleton'
import MyCollection from '../components/MyCollection'
import { rarityRank } from '../components/CollectorCard'
import { rarityBadge } from '../lib/rarityStyle'
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
  const [shareOpen, setShareOpen] = useState(false)
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
  const [profileTab, setProfileTab] = useState<
    'collection' | 'garage' | 'rewards'
  >('garage')
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
  const badgeCatalogue = allBadges(badgeCtx)
  const unlocks = computeUnlocks(badgeCtx)
  // Top row: prefer unlocked badges (most-impressive feel); pad with the
  // first locked ones so the row is always 4 wide.
  const unlocked = badgeCatalogue.filter((b) => unlocks.has(b.slug))
  const locked = badgeCatalogue.filter((b) => !unlocks.has(b.slug))

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* SECTION 1 — Cover + avatar. When the user has a spot worth
          showing off, we use its photo as the immersive backdrop
          (heavy blur + dim overlay). Falls back to the brand red
          gradient when the garage is empty. */}
      <div className="relative">
        {/* Plain gradient header (no cover photo) so the avatar can never
            be clipped by an immersive backdrop. */}
        <div
          className="w-full"
          style={{
            height: '120px',
            background: 'linear-gradient(180deg, #0a0a0a 0%, #141414 100%)',
          }}
        />
        {/* Share profile — round button left of the settings gear. */}
        <button
          onClick={() => setShareOpen(true)}
          aria-label="Partager le profil"
          className="tappable absolute top-[max(1rem,env(safe-area-inset-top))] flex h-9 w-9 items-center justify-center rounded-full text-white/80 backdrop-blur transition-colors hover:text-white"
          style={{
            right: '60px',
            background: '#222',
            border: '1px solid rgb(var(--color-fg) / 0.10)',
          }}
        >
          <Share className="h-[18px] w-[18px]" />
        </button>
        <button
          onClick={() => navigate('/settings')}
          aria-label="Paramètres"
          className="tappable absolute right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-fg/80 backdrop-blur transition-colors hover:text-fg"
          style={{ border: '1px solid rgb(var(--color-fg) / 0.10)' }}
        >
          <Settings className="h-5 w-5" />
        </button>
        <div
          className="absolute left-1/2 z-10 -translate-x-1/2"
          style={{ bottom: '-44px' }}
        >
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
              className="relative z-20 flex items-center justify-center overflow-hidden rounded-full bg-card"
              style={{
                width: '88px',
                height: '88px',
                border:
                  tier === 'vip'
                    ? '3px solid rgba(255, 215, 0, 0.6)'
                    : '3px solid #E8203A',
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
                    style={{ objectPosition: 'top' }}
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
      <div className="space-y-7 px-4 pb-40 pt-[54px]">
        {/* Identité */}
        <div className="text-center">
          <h1
            className="font-display font-extrabold tracking-tight text-fg"
            style={{ fontSize: '24px' }}
          >
            {pseudo}
          </h1>
          {/* Furtive identity line — status • level • ville. */}
          {idLine && (
            <p
              className="mt-1.5 text-[11px] font-normal text-fg2"
              style={{ letterSpacing: '0.18em' }}
            >
              {idLine}
            </p>
          )}
          {/* Streak — visible red pill right under the title. */}
          {streak > 0 && (
            <div className="mt-2.5 flex justify-center">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-bold"
                style={{
                  background: 'rgba(232,32,58,0.16)',
                  color: '#FF7080',
                  border: '1px solid rgba(232,32,58,0.40)',
                }}
              >
                🔥 {streak} jour{streak > 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Stats — four big animated counters; tap deep-links each. */}
          <div className="mx-auto mt-5 flex max-w-[320px] items-stretch">
            <StatCounter
              value={total}
              label="spots"
              onClick={() => navigate('/ma-galerie')}
            />
            <span className="w-px self-center bg-fg/10" style={{ height: 28 }} />
            <StatCounter
              value={uniqueBrands}
              label="marques"
              onClick={() => navigate('/mes-marques')}
            />
            <span className="w-px self-center bg-fg/10" style={{ height: 28 }} />
            <StatCounter
              value={rank ?? 0}
              prefix="#"
              empty={!rank}
              label="rang"
              onClick={() => navigate('/classement')}
            />
            {meId && (
              <>
                <span
                  className="w-px self-center bg-fg/10"
                  style={{ height: 28 }}
                />
                <StatCounter
                  value={followers}
                  label={followers === 1 ? 'abonné' : 'abonnés'}
                  onClick={() => navigate(`/u/${meId}`)}
                />
              </>
            )}
          </div>

          {/* Premium XP bar — #222 track, red→#ff4d4d gradient fill. */}
          <div className="mx-auto mt-5 max-w-[300px]">
            <div className="mb-1.5 grid grid-cols-3 items-baseline text-[11px]">
              <span className="text-left font-bold" style={{ color: '#E8203A' }}>
                {level.name}
              </span>
              <span className="text-center font-bold text-fg">
                {new Intl.NumberFormat('fr-FR').format(xp)} XP
              </span>
              <span className="text-right font-normal text-fg2">
                {level.isMax ? 'MAX' : level.next}
              </span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full"
              style={{ background: '#222' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${animPct}%`,
                  background: 'linear-gradient(90deg, #E8203A 0%, #ff4d4d 100%)',
                  transition: 'width 1000ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
              />
            </div>
          </div>

          {/* Badge preview — 3 badges (prefer unlocked). Tapping any of
              them, or the "Voir tous" link below, opens the full
              /badges page. */}
          {badgeCatalogue.length > 0 && (
            <div className="mt-5 flex flex-col items-center gap-2">
              <div className="flex items-center justify-center gap-2.5">
                {[...unlocked, ...locked].slice(0, 3).map((b) => {
                  const isU = unlocks.has(b.slug)
                  return (
                    <button
                      key={b.slug}
                      onClick={() => navigate('/badges')}
                      className="tappable flex h-10 w-10 items-center justify-center rounded-full text-lg"
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
                        opacity: isU ? 1 : 0.5,
                      }}
                      aria-label={b.name}
                    >
                      {isU ? b.emoji : <Lock className="h-4 w-4 text-fg2/50" />}
                    </button>
                  )
                })}
              </div>
              <button
                onClick={() => navigate('/badges')}
                className="tappable text-[12px] font-semibold text-fg2 hover:text-fg"
              >
                Voir tous les badges →
              </button>
            </div>
          )}
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

          {/* Tab content wrapper — the extra px-2 was removed 2026-06-23
              so Collection / Garage / Récompenses span full width. The
              parent's px-4 is the only horizontal gutter (16px); the
              collection grid + garage scroll break out of it to reach the
              screen edges where the spec asks for it. */}
          <div className="mt-5">
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
                      Bientôt disponible
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
                      Phase 2 — Tes spots seront transformés en cartes de
                      collection uniques très bientôt.
                    </p>
                  </div>
                </div>
              ))}

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
                      Bientôt disponible
                    </p>
                    <p className="max-w-[20rem] text-sm leading-relaxed text-fg2">
                      Débloque des récompenses uniques et des accessoires
                      physiques lors de la Phase 2.
                    </p>
                  </div>
                </div>
              )}

            {profileTab === 'rewards' &&
              appConfig.SHOW_COLLECTIONS_TO_COMPLETE && (
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

                {/* Badges — full 4-col grid; unlocked are coloured, locked
                    greyed with a cadenas. Tap → badge detail (condition). */}
                <section>
                  <div className="mb-3 flex items-baseline justify-between">
                    <h4
                      className="font-black uppercase text-fg2/55"
                      style={{ fontSize: '10px', letterSpacing: '0.20em' }}
                    >
                      Badges
                    </h4>
                    <span className="text-[10px] font-bold text-fg2">
                      {unlocked.length} / {badgeCatalogue.length} débloqués
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-3">
                    {[...unlocked, ...locked].map((b) => {
                      const isU = unlocks.has(b.slug)
                      return (
                        <button
                          key={b.slug}
                          onClick={() => navigate(`/badges/${b.slug}`)}
                          className="tappable flex flex-col items-center gap-1.5"
                          aria-label={b.name}
                        >
                          <span
                            className="flex h-16 w-16 items-center justify-center rounded-full text-2xl"
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
                            {isU ? b.emoji : <Lock className="h-5 w-5 text-fg2/50" />}
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
                      Historique XP
                    </h4>
                    <div className="space-y-1.5">
                      {xpHistory.map((t, i) => {
                        const r = xpReasonLabel(t.reason)
                        const date = new Intl.DateTimeFormat('fr-FR', {
                          day: 'numeric',
                          month: 'short',
                        }).format(new Date(t.created_at))
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
                                  t.amount >= 0
                                    ? '#E8203A'
                                    : 'rgb(var(--color-fg) / 0.4)',
                                fontSize: '14px',
                              }}
                            >
                              {t.amount >= 0 ? '+' : ''}
                              {t.amount} XP
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

        {/* PREMIUM CARD — upsell for free users, active-status for
            subscribers. */}
        <PremiumTopBanner
          onTap={() => navigate('/premium')}
          plan={plan}
        />

      </div>

      <BadgesBottomSheet
        open={badgesSheetOpen}
        onClose={() => setBadgesSheetOpen(false)}
        badges={badgeCatalogue}
        unlocks={unlocks}
      />

      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        pseudo={pseudo}
        userId={meId}
      />
    </div>
  )
}

// ────────────────────────── SHARE SHEET ─────────────────────────

/** Slide-up sheet to share the profile: the vanity link to copy + the
 *  native iOS/Android share sheet. The link points at the public profile
 *  route that already exists (/u/:id). */
function ShareSheet({
  open,
  onClose,
  pseudo,
  userId,
}: {
  open: boolean
  onClose: () => void
  pseudo: string
  userId: string | null
}) {
  const [copied, setCopied] = useState(false)
  if (!open) return null

  const handle = `revs.app/@${pseudo.toLowerCase().replace(/\s+/g, '')}`
  const url = userId
    ? `${window.location.origin}/u/${userId}`
    : window.location.origin

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked */
    }
  }
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: `${pseudo} sur REVS`, url })
      } else {
        void copy()
      }
    } catch {
      /* user cancelled */
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md rounded-t-3xl p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Partager le profil</h2>
          <button onClick={onClose} aria-label="Fermer" className="text-white/50 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Link to copy */}
        <button
          onClick={copy}
          className="tappable flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left"
          style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">
            {handle}
          </span>
          {copied ? (
            <Check className="h-5 w-5 flex-none" style={{ color: '#22C55E' }} />
          ) : (
            <Copy className="h-5 w-5 flex-none text-white/45" />
          )}
        </button>
        <p className="mt-1.5 px-1 text-[11px] text-white/35">
          {copied ? 'Lien copié !' : 'Touche pour copier le lien'}
        </p>

        {/* Native share */}
        <button
          onClick={share}
          className="tappable mt-4 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-sm font-extrabold text-white"
          style={{ background: '#E8203A', boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
        >
          <Share className="h-[18px] w-[18px]" />
          Partager
        </button>
      </div>
    </div>,
    document.body,
  )
}

// ─────────────────────── Profile helpers (post-restructure) ───────────────────────

/** Human-readable label + emoji for an xp_transactions.reason. */
function xpReasonLabel(reason: string): { emoji: string; label: string } {
  if (reason === 'spot') return { emoji: '📸', label: 'Spot publié' }
  if (reason === 'daily_first')
    return { emoji: '☀️', label: 'Premier spot du jour' }
  if (reason === 'streak') return { emoji: '🔥', label: 'Bonus streak' }
  if (reason.startsWith('collection:'))
    return { emoji: '🃏', label: 'Collection complétée' }
  if (reason.startsWith('referral'))
    return { emoji: '🤝', label: 'Parrainage' }
  if (reason.startsWith('challenge') || reason.startsWith('weekly'))
    return { emoji: '🎯', label: 'Défi réussi' }
  if (reason.startsWith('like')) return { emoji: '❤️', label: 'Like reçu' }
  if (reason.startsWith('event')) return { emoji: '🎪', label: 'Event' }
  if (reason === 'reconcile') return { emoji: '⚙️', label: 'Ajustement' }
  return { emoji: '✨', label: reason }
}

/** Tappable stat with a count-up animation: the number tweens from 0 to
 *  its value over ~1s (easeOutCubic) the first time the profile renders.
 *  `prefix` is prepended (e.g. "#" for rank); `empty` shows "—" instead. */
function StatCounter({
  value,
  label,
  prefix = '',
  empty = false,
  onClick,
}: {
  value: number
  label: string
  prefix?: string
  empty?: boolean
  onClick: () => void
}) {
  const [disp, setDisp] = useState(0)
  useEffect(() => {
    if (empty) return
    const start = performance.now()
    const dur = 1000
    let raf = 0
    const ease = (k: number) => 1 - Math.pow(1 - k, 3)
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / dur)
      setDisp(Math.round(value * ease(k)))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, empty])
  return (
    <button
      onClick={onClick}
      className="tappable flex flex-1 flex-col items-center justify-center"
    >
      <span
        className="font-display font-extrabold tabular-nums text-fg"
        style={{ fontSize: '22px', lineHeight: 1 }}
      >
        {empty ? '—' : `${prefix}${disp}`}
      </span>
      <span className="mt-1 text-[11px] text-fg2">{label}</span>
    </button>
  )
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
        {active ? (
          <p className="mt-0.5 truncate text-[12px]">
            <span className="font-bold" style={{ color: '#34D399' }}>
              ✓ Premium actif
            </span>
            {renew && (
              <span className="text-white/45"> · renouv. {renew}</span>
            )}
          </p>
        ) : (
          // No price on the card — the tariff lives on /premium only.
          <p className="mt-0.5 truncate text-[12px] text-white/50">
            Spots illimités & avantages exclusifs
          </p>
        )}
      </div>

      <span
        className="flex-none rounded-full px-3.5 py-2 text-[12px] font-extrabold text-white"
        style={{ background: '#E8203A' }}
      >
        {active ? 'Gérer' : 'Découvrir →'}
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
            Collection
          </span>
          <span className="font-display text-2xl font-extrabold leading-none text-fg">
            {spots.length}
            <span className="ml-1.5 text-[11px] font-bold text-fg2">
              carte{spots.length > 1 ? 's' : ''}
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

  return (
    // -mx-4 cancels the profile's 16px gutter so the scroll starts from
    // the left screen edge (16px padding on the first item) and the last
    // cards can bleed off the right edge.
    <div className="-mx-4">
      {/* Garage — horizontal scroll of 160×200 photo cards. Each uses the
          best (highest-rarity) spot photo of that model as its background,
          with a dark gradient + brand / year / model overlays. */}
      <div
        ref={scrollerRef}
        className="no-scrollbar flex items-stretch gap-3 overflow-x-auto py-2"
        style={{
          paddingLeft: 'max(env(safe-area-inset-left), 16px)',
          paddingRight: 'max(env(safe-area-inset-right), 16px)',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {cars.map((s) => (
          <button
            key={s.id}
            onClick={() => onOpen(s.id)}
            className="relative flex-shrink-0 overflow-hidden rounded-2xl text-left transition-transform active:scale-[0.97]"
            style={{
              width: 160,
              height: 200,
              background: 'linear-gradient(160deg, #141414 0%, #1a1a1a 100%)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
            aria-label={`${s.brand ?? ''} ${s.model ?? ''}`}
          >
            {s.photo_url ? (
              <img
                src={s.photo_url}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 flex items-center justify-center px-2 text-center font-display font-black uppercase"
                style={{
                  color: 'rgba(255,255,255,0.07)',
                  fontSize: '30px',
                  letterSpacing: '-0.02em',
                  lineHeight: 1,
                }}
              >
                {s.brand}
              </span>
            )}

            {/* Dark bottom gradient for legibility */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0"
              style={{
                height: '60%',
                background:
                  'linear-gradient(to top, #0a0a0a 0%, rgba(10,10,10,0.4) 55%, transparent 100%)',
              }}
            />

            {/* Brand — white with a strong drop shadow so it stays legible
                over any photo (light or dark). */}
            <span
              className="absolute left-3 top-3 font-extrabold uppercase"
              style={{
                color: '#FFFFFF',
                fontSize: '10px',
                letterSpacing: '0.12em',
                textShadow: '0 1px 4px rgba(0,0,0,0.8)',
              }}
            >
              {s.brand}
            </span>

            {/* Year — grey badge top-right */}
            {typeof s.year === 'number' && s.year > 1900 && (
              <span
                className="absolute right-3 top-3 rounded-md px-1.5 py-0.5 text-[9px] font-bold text-white/75"
                style={{
                  background: 'rgba(0,0,0,0.45)',
                  backdropFilter: 'blur(4px)',
                  WebkitBackdropFilter: 'blur(4px)',
                }}
              >
                {s.year}
              </span>
            )}

            {/* Model — white bold, bottom */}
            <h3
              className="absolute inset-x-0 bottom-0 line-clamp-2 px-3 pb-3 font-display font-extrabold leading-tight text-white"
              style={{ fontSize: '15px', letterSpacing: '-0.01em' }}
            >
              {s.model}
            </h3>
          </button>
        ))}
      </div>
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
