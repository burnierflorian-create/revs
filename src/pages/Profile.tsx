import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Camera,
  ChevronRight,
  Crown,
  Lock,
  Settings,
  Sparkles,
  Tag,
  Trophy,
  Warehouse,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { type Spot } from '../lib/spots'
import { planDisplayName, planInterval, planTier } from '../lib/plans'
import { allBadges, computeUnlocks } from '../lib/badges'
import { fetchRaceStats } from '../lib/race'
import { xpLevel } from '../lib/xp'
import { translateError } from '../lib/errors'
import { useMyTier } from '../lib/tier'
import { Skeleton } from '../components/Skeleton'
import GarageCard from '../components/GarageCard'
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
  const [subStatus, setSubStatus] = useState<string | null>(null)
  const [renewalAt, setRenewalAt] = useState<string | null>(null)
  const [hasCustomer, setHasCustomer] = useState(false)
  const [portalBusy, setPortalBusy] = useState(false)
  const [portalErr, setPortalErr] = useState<string | null>(null)
  const [earlyAdopter, setEarlyAdopter] = useState(false)
  const [meId, setMeId] = useState<string | null>(null)
  const [followers, setFollowers] = useState(0)
  const [following, setFollowing] = useState(0)
  const [likesReceived, setLikesReceived] = useState(0)
  const [animPct, setAnimPct] = useState(0)
  // Local-only UI state: which of the two sub-tabs (Garage vs
  // Collection) is currently visible at the bottom of the profile.
  const [garageTab, setGarageTab] = useState<'garage' | 'collection'>('garage')
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
      setSubStatus(isActiveSub ? (s?.status ?? null) : null)
      setRenewalAt(isActiveSub ? (s?.current_period_end ?? null) : null)
      setHasCustomer(isActiveSub && !!s?.stripe_customer_id)
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

  // Open the Stripe Customer Portal for cancel / update card / etc.
  // The endpoint resolves stripe_customer_id server-side from the
  // authenticated user, so we just hand it the session token.
  async function openPortal() {
    if (portalBusy) return
    setPortalErr(null)
    setPortalBusy(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Session introuvable')
      const res = await fetch('/api/create-checkout-session?action=portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
      throw new Error(data.error || 'Portail indisponible')
    } catch (e) {
      setPortalErr(translateError(e))
      setPortalBusy(false)
    }
  }

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
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                filter: 'blur(20px) brightness(0.45) saturate(1.05)',
                transform: 'scale(1.15)',
              }}
            />
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, rgba(0,0,0,0.30) 0%, rgba(10,10,10,0.55) 70%, var(--color-bg) 100%)',
              }}
            />
          </div>
        ) : (
          <div
            className="h-48 w-full"
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
          {/* Avatar with conic-gradient ring — gold sweep for VIP,
              accent-red default. Tier badge (⚡/👑) overlays the
              bottom-right corner when subscribed. */}
          <div className="relative">
            <div
              className="flex h-28 w-28 items-center justify-center rounded-full p-[3px]"
              style={
                tier === 'vip'
                  ? {
                      background:
                        'conic-gradient(from 220deg, #FFD700 0%, #B8860B 25%, #5a3f00 55%, #FFD700 100%)',
                      boxShadow: '0 8px 32px rgba(255,200,50,0.40)',
                    }
                  : {
                      background:
                        'conic-gradient(from 220deg, #E8203A 0%, #b91528 25%, #4a0f16 55%, #E8203A 100%)',
                      boxShadow: '0 8px 32px rgba(232,32,58,0.35)',
                    }
              }
            >
              <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-card font-display text-4xl font-extrabold tracking-tighter text-fg">
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
            <span className="lvl-glow mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
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
                className="tappable flex items-center gap-5 rounded-2xl bg-card px-5 py-3"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <span className="flex flex-col items-center">
                  <span className="font-display text-lg font-extrabold tracking-tighter text-fg">
                    {followers}
                  </span>
                  <span className="label-up text-[10px] text-fg2">
                    Abonnés
                  </span>
                </span>
                <span className="h-7 w-px bg-white/[0.08]" />
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
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-out"
              style={{ width: `${animPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-fg2">
            {level.isMax
              ? 'Niveau maximum atteint 👑'
              : `Plus que ${level.toNext} XP avant ${level.next}`}
          </p>
        </section>

        {/* SECTION 3 — Stats (3 cols : Spots / Marques / Rang ; XP est
            dans la barre Section 2 juste au-dessus) */}
        <section className="grid grid-cols-3 gap-2.5">
          <Stat
            icon={<Camera className="h-4 w-4" />}
            count={total}
            label="Spots"
            onClick={() => navigate('/ma-galerie')}
          />
          <Stat
            icon={<Tag className="h-4 w-4" />}
            count={uniqueBrands}
            label="Marques"
            onClick={() => navigate('/mes-marques')}
          />
          <Stat
            icon={<Trophy className="h-4 w-4" />}
            display={rank ? `#${rank}` : '—'}
            label="Rang"
            onClick={() => navigate('/classement')}
          />
        </section>

        {/* SECTION 3.25 — Challenges + Parrainage */}
        <section className="grid grid-cols-2 gap-3">
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
            <span className="text-xs text-accent">3 défis actifs →</span>
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
            <span className="text-xs text-accent">+50 XP par ami →</span>
          </button>
        </section>

        {/* SECTION 3.5 — Abonnement (centralised here, removed from Settings) */}
        {plan ? (
          <section
            className="overflow-hidden rounded-2xl p-4"
            style={
              planTier(plan) === 'vip'
                ? {
                    background:
                      'linear-gradient(135deg, rgba(212,175,55,0.16) 0%, rgba(255,215,0,0.06) 50%, rgba(15,15,15,0.95) 100%)',
                    boxShadow:
                      'inset 0 0 0 1px rgba(212,175,55,0.5), 0 6px 24px rgba(212,175,55,0.12)',
                  }
                : {
                    background:
                      'linear-gradient(135deg, rgba(230,57,70,0.16) 0%, rgba(230,57,70,0.04) 60%, rgba(15,15,15,0.95) 100%)',
                    boxShadow:
                      'inset 0 0 0 1px rgba(230,57,70,0.45), 0 6px 24px rgba(230,57,70,0.10)',
                  }
            }
          >
            <div className="flex items-start gap-3">
              <span
                className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl"
                style={
                  planTier(plan) === 'vip'
                    ? {
                        background:
                          'linear-gradient(135deg, #d4af37 0%, #ffd700 100%)',
                        color: '#000',
                      }
                    : { background: 'var(--color-accent)', color: '#fff' }
                }
              >
                {planTier(plan) === 'vip' ? (
                  <Crown className="h-5 w-5" />
                ) : (
                  <Sparkles className="h-5 w-5" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fg/45">
                  Mon abonnement
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-display text-lg font-bold">
                  <span>
                    {planDisplayName(plan)}{' '}
                    {planTier(plan) === 'vip' ? '👑' : '⚡'}
                  </span>
                  <span className="text-xs font-medium text-fg/50">
                    {planInterval(plan) === 'year' ? 'annuel' : 'mensuel'}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      subStatus === 'trialing'
                        ? 'bg-[#F59E0B]/15 text-[#F59E0B]'
                        : 'bg-emerald-500/15 text-emerald-400'
                    }`}
                  >
                    {subStatus === 'trialing' ? 'En essai' : 'Actif'}
                  </span>
                </p>
                {renewalAt && (
                  <p className="mt-1 text-[11px] text-fg/50">
                    {subStatus === 'trialing' ? 'Fin de l’essai' : 'Prochain renouvellement'}{' '}
                    : {formatRenewal(renewalAt)}
                  </p>
                )}
              </div>
            </div>

            <button
              onClick={() => navigate('/radar')}
              className="mt-4 flex w-full items-center justify-between rounded-full bg-accent/20 px-5 py-3 text-sm font-semibold text-fg transition-colors hover:bg-accent/30"
            >
              <span className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                </span>
                Mode Radar
              </span>
              <ChevronRight className="h-4 w-4 text-fg/60" />
            </button>

            <button
              onClick={openPortal}
              disabled={portalBusy || !hasCustomer}
              className="mt-2 flex w-full items-center justify-between rounded-full bg-white/10 px-5 py-3 text-sm font-semibold text-fg backdrop-blur transition-colors hover:bg-white/15 disabled:opacity-50"
            >
              <span>
                {portalBusy ? 'Ouverture…' : 'Gérer mon abonnement'}
              </span>
              <ChevronRight className="h-4 w-4 text-fg/60" />
            </button>
            {portalErr && (
              <p className="mt-2 text-center text-xs text-accent">{portalErr}</p>
            )}
          </section>
        ) : (
          /* Premium upgrade banner — jet-black gradient with a drifting
             gold accent line and a thin yellow border. Borrows the
             founder-shimmer keyframe for the inner highlight so the
             motion stays consistent with the Fondateur title chip. */
          <button
            onClick={() => navigate('/premium')}
            className="tappable group relative flex w-full items-center justify-between gap-3 overflow-hidden rounded-2xl px-4 py-4 text-left transition-transform active:scale-[0.99]"
            style={{
              background:
                'linear-gradient(95deg, #050505 0%, #141414 50%, #050505 100%)',
              border: '1px solid rgba(224, 179, 65, 0.32)',
              boxShadow:
                '0 16px 36px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 215, 0, 0.06) inset',
            }}
          >
            {/* Gold highlight sweep — uses founder-shimmer (already
                in design-system.css) for a slow drift across the
                banner. Sits at z-0; content stays above on z-10. */}
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
                <p
                  className="mt-0.5 text-fg/75"
                  style={{ fontSize: '12px' }}
                >
                  Mode Radar temps réel & spots illimités
                </p>
              </div>
            </div>

            <ChevronRight
              className="relative z-10 h-5 w-5 flex-none text-fg/55 transition-transform group-hover:translate-x-0.5"
            />
          </button>
        )}

        {/* SECTION 4 — Badges (top 4 + lien gallery) */}
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

        {/* SECTION 4.5 — Collections */}
        <CollectionsSection spots={spots} />

        {/* SECTION 5 — Garage / Collection (tabbed). The toggle stays
            local to Profile; tapping it just swaps which sub-section
            renders below. Counts shown in the header reflect the
            active tab — same spots array, two different views. */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-display text-lg font-bold">
              {garageTab === 'garage' ? 'Mon garage' : 'Ma Collection'}{' '}
              <span className="text-fg/40">
                ({total}{' '}
                {garageTab === 'garage'
                  ? `voiture${total > 1 ? 's' : ''}`
                  : `carte${total > 1 ? 's' : ''}`}
                )
              </span>
            </h2>
          </div>

          {/* Tab toggle — segmented control */}
          <div
            className="mb-4 grid grid-cols-2 gap-1 rounded-full p-1"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--color-border)' }}
            role="tablist"
          >
            {(['garage', 'collection'] as const).map((tab) => {
              const active = garageTab === tab
              return (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setGarageTab(tab)}
                  className="tappable rounded-full py-2 text-[12px] font-extrabold uppercase tracking-wider transition-colors"
                  style={{
                    background: active ? 'var(--color-accent)' : 'transparent',
                    color: active ? '#fff' : 'var(--color-fg-2)',
                    boxShadow: active ? '0 6px 16px rgba(232,32,58,0.40)' : undefined,
                  }}
                >
                  {tab === 'garage' ? 'Garage' : 'Collection'}
                </button>
              )
            })}
          </div>

          {garageTab === 'garage' ? (
            total === 0 ? (
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
              <div className="grid grid-cols-2 gap-3">
                {spots.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/spot/${s.id}`)}
                    className="tappable relative aspect-[4/3] overflow-hidden rounded-[20px] bg-[#0a0a0a] text-left"
                    style={{ border: '1px solid var(--color-border)' }}
                  >
                    <GarageCard
                      brand={s.brand}
                      model={s.model}
                      year={s.year}
                      category={s.category}
                      imageUrl={s.garage_image_url}
                    />
                  </button>
                ))}
              </div>
            )
          ) : (
            <MyCollection spots={spots} />
          )}
        </section>
      </div>

    </div>
  )
}

// Tiny RAF-based count-up — animates from 0 to `target` in `ms` ms.
// Pure number animation; the caller decides how to render. Returns the
// target instantly when `target` is not a finite number.
function useCountUp(target: number | null, ms = 800): number {
  const [value, setValue] = useState(0)
  const startRef = useRef<number | null>(null)
  useEffect(() => {
    if (target == null || !Number.isFinite(target)) {
      setValue(target ?? 0)
      return
    }
    let raf = 0
    startRef.current = null
    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now
      const t = Math.min(1, (now - startRef.current) / ms)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(target * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return value
}

function Stat({
  count,
  display,
  label,
  icon,
  onClick,
}: {
  // For animated counters pass `count` (number). Static / formatted
  // labels (e.g. "#12") use `display`.
  count?: number | null
  display?: string
  label: string
  icon: React.ReactNode
  onClick?: () => void
}) {
  const animated = useCountUp(count ?? null)
  const value =
    display ?? (count == null ? '—' : new Intl.NumberFormat('fr-FR').format(animated))
  return (
    <button
      onClick={onClick}
      className="tappable w-full rounded-3xl bg-card px-2 py-5 text-center shadow-soft"
      style={{ border: '1px solid rgba(232,32,58,0.15)' }}
    >
      <div className="flex justify-center text-accent">{icon}</div>
      <div className="mt-2 font-display text-2xl font-extrabold tracking-tighter text-accent">
        {value}
      </div>
      <div className="label-up mt-1 text-[10px] text-fg2">{label}</div>
    </button>
  )
}

function formatRenewal(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
}
