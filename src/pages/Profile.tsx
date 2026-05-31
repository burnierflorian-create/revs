import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronRight,
  Lock,
  Settings,
  Warehouse,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { categoryLabel, type Spot } from '../lib/spots'
import { planDisplayName, planTier } from '../lib/plans'
import { allBadges, computeUnlocks } from '../lib/badges'
import { fetchRaceStats } from '../lib/race'
import { xpLevel } from '../lib/xp'
import { useMyTier } from '../lib/tier'
import { Skeleton } from '../components/Skeleton'
import CollectionsSection from '../components/CollectionsSection'
import MyCollection from '../components/MyCollection'
import TitleChip from '../components/TitleChip'


function memberSince(iso: string | undefined): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso))
}

export default function Profile() {
  const navigate = useNavigate()
  const tier = useMyTier()

  const [loading, setLoading] = useState(true)
  const [pseudo, setPseudo] = useState('Spotter')
  const [ville, setVille] = useState('')
  const [title, setTitle] = useState<string | null>(null)
  const [avatar, setAvatar] = useState<string | null>(null)
  const [joined, setJoined] = useState('')
  const [spots, setSpots] = useState<Spot[]>([])
  const [uniqueBrands, setUniqueBrands] = useState(0)
  const [rank, setRank] = useState<number | null>(null)
  const [hasEvent, setHasEvent] = useState(false)
  const [xp, setXp] = useState(0)
  const [plan, setPlan] = useState<string | null>(null)
  const [earlyAdopter, setEarlyAdopter] = useState(false)
  const [meId, setMeId] = useState<string | null>(null)
  const [followers, setFollowers] = useState(0)
  const [following, setFollowing] = useState(0)
  const [likesReceived, setLikesReceived] = useState(0)
  const [animPct, setAnimPct] = useState(0)
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
        followingRes,
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
          supabase
            .from('followers')
            .select('following_id', { count: 'exact', head: true })
            .eq('follower_id', user.id),
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
      setJoined(memberSince(user.created_at))
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
      setFollowing(followingRes.count ?? 0)
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
          <div className="relative h-56 w-full overflow-hidden">
            <img
              src={bestSpot.photo_url}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                // Stronger blur per the immersive Apple-style spec; the
                // photo reads as ambient colour rather than a recognisable
                // scene. scale(1.15) hides the blur fringe on the edges.
                filter: 'blur(28px) brightness(0.65) saturate(1.10)',
                transform: 'scale(1.15)',
              }}
            />
            {/* Flat 40% black scrim — replaces the layered gradient so
                the immersive backdrop reads as one tone rather than three. */}
            <div
              aria-hidden
              className="absolute inset-0"
              style={{ background: 'rgba(0, 0, 0, 0.40)' }}
            />
          </div>
        ) : (
          <div
            className="h-56 w-full"
            style={{
              background:
                'radial-gradient(ellipse 80% 100% at 50% 0%, rgba(232,32,58,0.35) 0%, transparent 60%), linear-gradient(180deg, #4a0f16 0%, #1a060a 55%, #0a0a0a 100%)',
            }}
          />
        )}
        {/* Bottom edge softener — blends the cover into the page bg */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
          style={{
            background:
              'linear-gradient(180deg, transparent 0%, var(--color-bg) 100%)',
          }}
        />
        <button
          onClick={() => navigate('/settings')}
          aria-label="Paramètres"
          className="tappable absolute right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-fg/80 backdrop-blur transition-colors hover:text-fg"
          style={{ border: '1px solid rgba(255,255,255,0.10)' }}
        >
          <Settings className="h-5 w-5" />
        </button>
        <div className="absolute inset-x-0 -bottom-14 flex justify-center">
          {/* Avatar with thin white liseré — replaces the conic-gradient
              ring per the immersive header polish. VIP / Premium tier
              still gets its overlay badge at the corner so paid status
              stays unmissable. */}
          <div className="relative">
            <div
              className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-card"
              style={{
                border:
                  tier === 'vip'
                    ? '2px solid rgba(255, 215, 0, 0.55)'
                    : '2px solid rgba(255, 255, 255, 0.20)',
                boxShadow:
                  tier === 'vip'
                    ? '0 18px 38px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 215, 0, 0.18)'
                    : '0 18px 38px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.06)',
              }}
            >
              <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full font-display text-4xl font-extrabold tracking-tighter text-fg">
                {avatar ? (
                  <img
                    src={avatar}
                    alt=""
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
                  border: '2px solid var(--color-card)',
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
                  border: '2px solid var(--color-card)',
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

      <div className="space-y-7 px-4 pb-10 pt-20">
        {/* Identité */}
        <div className="text-center">
          <h1 className="display-xl text-fg">{pseudo}</h1>
          <div className="mt-2 flex justify-center">
            <TitleChip xp={xp} title={title} />
          </div>
          {ville && (
            <p className="mt-1.5 text-sm text-fg2">{ville}</p>
          )}
          {/* Subscribers see their plan badge in place of the XP level
              pill — once you've paid, "Débutant" feels off. Free tier
              keeps the level pill as before. */}
          {planTier(plan) === 'vip' ? (
            <span
              className="mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold text-black shadow-md"
              style={{
                background:
                  'linear-gradient(120deg, #d4af37 0%, #ffd700 50%, #b8860b 100%)',
              }}
            >
              VIP 👑
            </span>
          ) : planTier(plan) === 'premium' ? (
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-xs font-bold text-fg shadow-md">
              Premium ⚡
            </span>
          ) : (
            // Editorial rank chip — sport-red uppercase with a barely-
            // there 5% red wash + matching border, per the immersive
            // header spec (309487.jpg).
            <span
              className="mt-3 inline-flex items-center rounded-md font-extrabold uppercase"
              style={{
                color: '#EF4444',
                background: 'rgba(239, 68, 68, 0.05)',
                border: '1px solid rgba(239, 68, 68, 0.30)',
                padding: '2px 10px',
                fontSize: '11px',
                letterSpacing: '0.16em',
              }}
            >
              {level.name}
            </span>
          )}
          {joined && (
            <p className="mt-2 text-xs text-fg2">Membre depuis {joined}</p>
          )}
          {meId && (
            <div className="mt-4 flex justify-center">
              <button
                onClick={() => navigate(`/u/${meId}`)}
                className="tappable grid grid-cols-[1fr_1px_1fr] items-center gap-x-5 rounded-2xl bg-card px-6 py-3"
                style={{ border: '1px solid var(--color-border)', minWidth: '220px' }}
              >
                <span className="flex flex-col items-center">
                  <span className="font-display text-lg font-extrabold tracking-tighter text-fg">
                    {followers}
                  </span>
                  <span className="label-up text-[10px] text-fg2">
                    Abonnés
                  </span>
                </span>
                <span className="h-7 w-px bg-white/[0.08] justify-self-center" />
                <span className="flex flex-col items-center">
                  <span className="font-display text-lg font-extrabold tracking-tighter text-fg">
                    {following}
                  </span>
                  <span className="label-up text-[10px] text-fg2">
                    Abonnements
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>

        {/* SECTION 2 — XP */}
        <section
          className="rounded-3xl bg-card p-5"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <div className="flex items-baseline justify-between">
            <span className="label-up text-[10px] text-fg2">
              Niveau {level.name}
            </span>
            <span className="font-display text-2xl font-extrabold tracking-tighter text-fg">
              {xp} <span className="text-sm text-fg2">XP</span>
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-out"
              style={{
                width: `${animPct}%`,
                // Discreet red glow on the filled segment so the bar
                // still reads against the dark surface despite the
                // thinner 1.5px height.
                boxShadow:
                  '0 0 8px rgba(232, 32, 58, 0.55), 0 0 1px rgba(232, 32, 58, 0.75) inset',
              }}
            />
          </div>
          <p className="mt-2 text-xs text-fg2">
            {level.isMax
              ? 'Niveau maximum atteint 👑'
              : `Plus que ${level.toNext} XP avant ${level.next}`}
          </p>
        </section>

        {/* SECTION 3 — Stats single horizontal line (replaces the
            old 3-column grid). Each block stays tappable, separated
            by bullet dots, and lives between two hairline rules. */}
        <section
          className="flex items-center justify-center gap-5 py-3.5"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.05)',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <ProfileStatInline
            value={String(total)}
            label="spots"
            onClick={() => navigate('/ma-galerie')}
          />
          <span className="h-1 w-1 rounded-full bg-fg2/50" aria-hidden />
          <ProfileStatInline
            value={String(uniqueBrands)}
            label="marques"
            onClick={() => navigate('/mes-marques')}
          />
          <span className="h-1 w-1 rounded-full bg-fg2/50" aria-hidden />
          <ProfileStatInline
            value={rank ? `#${rank}` : '—'}
            label="rang"
            onClick={() => navigate('/classement')}
          />
        </section>

        {/* PREMIUM BANNER (free users only, isolated at top) */}
        {!plan && <PremiumTopBanner onTap={() => navigate('/premium')} />}

        {/* SEGMENTED CONTROL — 3 tabs (Collection / Garage / Récompenses) */}
        <section>
          <div
            className="flex gap-1 rounded-xl p-1"
            style={{
              background: 'rgba(10, 10, 10, 0.60)',
              border: '1px solid rgba(255, 255, 255, 0.05)',
              backdropFilter: 'saturate(160%) blur(14px)',
              WebkitBackdropFilter: 'saturate(160%) blur(14px)',
            }}
            role="tablist"
          >
            {(
              [
                { key: 'collection', label: 'Collection', emoji: '🃏' },
                { key: 'garage', label: 'Garage', emoji: '🏎️' },
                { key: 'rewards', label: 'Récompenses', emoji: '🏆' },
              ] as const
            ).map((t) => {
              const active = profileTab === t.key
              return (
                <button
                  key={t.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setProfileTab(t.key)}
                  className="tappable flex-1 rounded-lg py-2 text-xs font-bold transition-all"
                  style={{
                    background: active
                      ? 'rgba(255, 255, 255, 0.10)'
                      : 'transparent',
                    color: active ? '#fff' : 'rgba(255, 255, 255, 0.45)',
                    boxShadow: active
                      ? '0 4px 12px rgba(0, 0, 0, 0.30)'
                      : undefined,
                  }}
                >
                  <span className="mr-1" aria-hidden>
                    {t.emoji}
                  </span>
                  {t.label}
                </button>
              )
            })}
          </div>

          <div className="mt-5">
            {profileTab === 'collection' && <MyCollection spots={spots} />}

            {profileTab === 'garage' &&
              (total === 0 ? (
                <div className="flex flex-col items-center rounded-2xl border border-white/5 bg-card px-6 py-12 text-center">
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
                <div className="space-y-3">
                  {spots.map((s) => (
                    <GarageRow
                      key={s.id}
                      spot={s}
                      onOpen={() => navigate(`/spot/${s.id}`)}
                    />
                  ))}
                </div>
              ))}

            {profileTab === 'rewards' && (
              <div className="space-y-6">
                {/* Quick row: Challenges + Parrainage */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => navigate('/challenges')}
                    className="flex flex-col items-start gap-1 rounded-2xl border border-white/5 bg-card p-4 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <span className="text-xs uppercase tracking-wider text-fg/40">
                      Challenges
                    </span>
                    <span className="font-display text-lg font-bold text-fg">
                      Cette semaine
                    </span>
                    <span className="text-xs text-accent">
                      3 défis actifs →
                    </span>
                  </button>
                  <button
                    onClick={() => navigate('/referral')}
                    className="flex flex-col items-start gap-1 rounded-2xl border border-white/5 bg-card p-4 text-left transition-colors hover:bg-white/[0.04]"
                  >
                    <span className="text-xs uppercase tracking-wider text-fg/40">
                      Parrainage
                    </span>
                    <span className="font-display text-lg font-bold text-fg">
                      Inviter
                    </span>
                    <span className="text-xs text-accent">
                      +50 XP par ami →
                    </span>
                  </button>
                </div>

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
                              : 'var(--color-accent)',
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

                {/* Mes Badges */}
                <section>
                  <div className="mb-3 flex items-baseline justify-between">
                    <h2 className="font-display text-lg font-extrabold tracking-tighter text-fg">
                      Mes badges
                    </h2>
                    <span className="label-up text-[10px] text-fg2">
                      {unlocked.length}/{badgeCatalogue.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    {topBadges.map((b) => {
                      const isUnlocked = unlocks.has(b.slug)
                      return (
                        <button
                          key={b.slug}
                          onClick={() => navigate(`/badges/${b.slug}`)}
                          className={`tappable relative flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-center ${
                            isUnlocked
                              ? b.gold
                                ? 'bg-[#E0B341]/12'
                                : 'bg-accent/8'
                              : 'bg-card'
                          }`}
                          style={{
                            border: isUnlocked
                              ? b.gold
                                ? '1px solid rgba(224,179,65,0.4)'
                                : '1px solid rgba(232,32,58,0.3)'
                              : '1px solid var(--color-border)',
                            boxShadow:
                              isUnlocked && !b.gold
                                ? '0 0 20px rgba(232,32,58,0.18)'
                                : isUnlocked && b.gold
                                  ? '0 0 22px rgba(224,179,65,0.22)'
                                  : undefined,
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
                        </button>
                      )
                    })}
                  </div>
                  <button
                    onClick={() => navigate('/badges')}
                    className="tappable mt-3 flex w-full items-center justify-center gap-1 rounded-full bg-card py-2.5 text-sm font-semibold text-fg/80 hover:bg-white/[0.06]"
                    style={{ border: '1px solid var(--color-border)' }}
                  >
                    Voir tous les badges
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </section>

                {/* Défis Collections (themed: AMG, JDM, Italian Big 3, …) */}
                <CollectionsSection spots={spots} />
              </div>
            )}
          </div>
        </section>

      </div>

    </div>
  )
}

// ─────────────────────── Profile helpers (post-restructure) ───────────────────────

/** Inline stat tappable used by the single-line stats row that
 *  replaced the old 3-column boxed grid. Big number + tiny label
 *  sit on the same baseline; dots separate them in the parent. */
function ProfileStatInline({
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
      className="tappable flex items-baseline gap-1.5"
    >
      <span
        className="font-display font-extrabold tracking-tighter text-fg tabular-nums"
        style={{ fontSize: '17px' }}
      >
        {value}
      </span>
      <span
        className="font-medium text-fg2 lowercase"
        style={{ fontSize: '11px' }}
      >
        {label}
      </span>
    </button>
  )
}

/** Jet-black banner with a drifting gold sweep that nudges free
 *  users toward /premium. Lifted from the previous Section 3.5 into
 *  its own component so the top of Profile stays uncluttered. */
function PremiumTopBanner({ onTap }: { onTap: () => void }) {
  return (
    <button
      onClick={onTap}
      className="tappable group relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-2xl px-4 py-4 text-left transition-transform active:scale-[0.99]"
      style={{
        background:
          'linear-gradient(95deg, #050505 0%, #141414 50%, #050505 100%)',
        border: '1px solid rgba(224, 179, 65, 0.32)',
        boxShadow:
          '0 16px 36px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 215, 0, 0.06) inset',
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(95deg, rgba(224, 179, 65, 0) 0%, rgba(255, 215, 0, 0.10) 35%, rgba(255, 246, 200, 0.18) 50%, rgba(255, 215, 0, 0.10) 65%, rgba(184, 134, 11, 0) 100%)',
          backgroundSize: '220% 100%',
          animation: 'founder-shimmer 6s linear infinite',
        }}
      />
      <div className="relative z-10 flex items-center gap-3">
        <span
          className="flex h-10 w-10 flex-none items-center justify-center rounded-xl"
          style={{
            background:
              'linear-gradient(135deg, rgba(255, 215, 0, 0.25) 0%, rgba(184, 134, 11, 0.10) 100%)',
            border: '1px solid rgba(255, 215, 0, 0.35)',
            color: '#FFD700',
            fontSize: '18px',
          }}
        >
          ⚡
        </span>
        <div className="min-w-0">
          <p
            className="font-display font-extrabold uppercase tracking-widest"
            style={{
              color: '#FFD700',
              fontSize: '11px',
              letterSpacing: '0.16em',
            }}
          >
            Club REVS Premium
          </p>
          <p className="mt-0.5 text-fg/75" style={{ fontSize: '12px' }}>
            Mode Radar temps réel & spots illimités
          </p>
        </div>
      </div>
      <ChevronRight
        className="relative z-10 h-5 w-5 flex-none text-fg/55 transition-transform group-hover:translate-x-0.5"
      />
    </button>
  )
}

/** Brand-aware glow used as a soft halo on the GarageRow horizontal
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

/** Horizontal landscape card used by the Garage tab. Replaces the
 *  old 2-column SVG silhouette grid. Subtle vertical gradient bg +
 *  a brand-coloured radial halo at the bottom-right corner, with
 *  brand small caps, model bold, year chip top-right. */
function GarageRow({
  spot,
  onOpen,
}: {
  spot: Spot
  onOpen: () => void
}) {
  const glow = brandGlow(spot.brand)
  return (
    <button
      onClick={onOpen}
      className="tappable group relative w-full overflow-hidden rounded-2xl text-left"
      style={{
        height: '128px',
        background:
          'linear-gradient(135deg, #1a1a1a 0%, #0c0c0c 60%, #050505 100%)',
        border: '1px solid rgba(255, 255, 255, 0.05)',
        boxShadow: '0 18px 38px rgba(0, 0, 0, 0.45)',
      }}
    >
      {/* Brand-colour halo at the lower-right corner. Sits behind
          the text via z-0; transitions on hover for a subtle pulse. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-12 -right-12 transition-all group-hover:scale-110"
        style={{
          width: '180px',
          height: '180px',
          borderRadius: '50%',
          background: glow,
          filter: 'blur(48px)',
        }}
      />

      <div className="relative z-10 flex h-full flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              className="font-bold uppercase text-fg/45"
              style={{ fontSize: '10px', letterSpacing: '0.18em' }}
            >
              {spot.brand}
            </p>
            <h3
              className="mt-1 truncate font-display tracking-tight text-white"
              style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}
            >
              {spot.model}
            </h3>
          </div>
          {typeof spot.year === 'number' && spot.year > 1900 && (
            <span
              className="flex-none rounded-md px-2 py-0.5 font-bold text-white/85"
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.10)',
                backdropFilter: 'saturate(150%) blur(10px)',
                WebkitBackdropFilter: 'saturate(150%) blur(10px)',
                fontSize: '10px',
              }}
            >
              {spot.year}
            </span>
          )}
        </div>
        <p className="text-xs text-fg/55">
          {categoryLabel(spot.category)}
        </p>
      </div>
    </button>
  )
}

