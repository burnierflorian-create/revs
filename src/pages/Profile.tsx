import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Car, Settings, Lock, Warehouse, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { categoryLabel, timeAgo, type Spot } from '../lib/spots'
import { xpLevel } from '../lib/xp'
import { Skeleton } from '../components/Skeleton'

type Badge = {
  emoji: string
  name: string
  desc: string
  condition: string
  unlocked: boolean
  xp?: number
  gold?: boolean
}

function memberSince(iso: string | undefined): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso))
}

export default function Profile() {
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [pseudo, setPseudo] = useState('Spotter')
  const [ville, setVille] = useState('')
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
  const [animPct, setAnimPct] = useState(0)
  const [openBadge, setOpenBadge] = useState<Badge | null>(null)

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
            .select('pseudo, ville, avatar, created_at')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('subscriptions')
            .select('plan, status')
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
      setAvatar(profRes.data?.avatar ?? null)
      setJoined(memberSince(user.created_at))
      setSpots(mySpots)
      setUniqueBrands(
        new Set(mySpots.map((s) => s.brand).filter(Boolean)).size,
      )
      setRank(rk)
      setHasEvent((eventsRes.count ?? 0) > 0)
      setXp(typeof xpRes.data === 'number' ? xpRes.data : 0)
      const s = subRes.data as { plan?: string; status?: string } | null
      setPlan(
        s && (s.status === 'active' || s.status === 'trialing')
          ? (s.plan ?? null)
          : null,
      )
      setEarlyAdopter(earlier < 100)
      setMeId(user.id)
      setFollowers(followersRes.count ?? 0)
      setFollowing(followingRes.count ?? 0)
      setLoading(false)
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
  const has = (pred: (s: Spot) => boolean) => spots.some(pred)
  const brandHas = (needle: string) =>
    has((s) => (s.brand ?? '').toLowerCase().includes(needle))

  const priceAtLeast = (min: number) =>
    spots.filter((s) => (s.estimated_price ?? 0) >= min).length
  const millionClub = priceAtLeast(1_000_000) >= 1

  const badges: Badge[] = [
    { emoji: '🚀', name: 'Premier Spot', desc: 'Ton tout premier spot publié.', condition: 'Poste ton premier spot', xp: 5, unlocked: total >= 1 },
    { emoji: '🔟', name: 'Série de 10', desc: 'Tu prends le rythme.', condition: 'Atteins 10 spots au total', unlocked: total >= 10 },
    { emoji: '💯', name: 'Centurion', desc: 'Un vrai chasseur.', condition: 'Atteins 100 spots au total', unlocked: total >= 100 },
    { emoji: '🏎️', name: 'Ferrari Hunter', desc: 'Le Cheval cabré dans ton garage.', condition: 'Spotte une Ferrari', unlocked: brandHas('ferrari') },
    { emoji: '🐂', name: 'Lambo Spotter', desc: 'Le taureau, capturé.', condition: 'Spotte une Lamborghini', unlocked: brandHas('lamborghini') },
    { emoji: '🇯🇵', name: 'JDM Fan', desc: 'La culture japonaise de la perf.', condition: 'Spotte une japonaise de performance', unlocked: has((s) => s.category === 'JDM') },
    { emoji: '📅', name: 'Organisateur', desc: 'Tu fais vivre la communauté.', condition: 'Crée un événement', xp: 20, unlocked: hasEvent },
    { emoji: '⚡', name: 'Hypercar', desc: 'Tu vises haut de gamme.', condition: 'Spotte une voiture à plus de 200 000 €', xp: 40, unlocked: priceAtLeast(200_000) >= 1 },
    { emoji: '🔭', name: 'Supercar Spotter', desc: 'Œil de lynx pour les supercars.', condition: '10 voitures à plus de 80 000 €', unlocked: priceAtLeast(80_000) >= 10 },
    { emoji: '🦅', name: 'Hypercar Hunter', desc: 'Chasseur d’exception.', condition: '5 voitures à plus de 200 000 €', unlocked: priceAtLeast(200_000) >= 5 },
    { emoji: '💎', name: 'Rare Find', desc: 'Une perle rare.', condition: 'Édition limitée ou plus de 500 000 €', unlocked: priceAtLeast(500_000) >= 1, gold: true },
    { emoji: '🏆', name: 'Million Club', desc: 'Le club très fermé du million.', condition: 'Spotte une voiture à plus de 1 000 000 €', xp: 100, unlocked: millionClub, gold: true },
    { emoji: '👑', name: 'Légendaire', desc: 'Badge doré ultra rare.', condition: 'Débloque le Million Club', unlocked: millionClub, gold: true },
    { emoji: '🤝', name: 'Supporter', desc: 'Tu soutiens REVS.', condition: 'Abonne-toi au plan Starter', unlocked: plan === 'starter', gold: true },
    { emoji: '✨', name: 'Premium', desc: 'Membre Premium.', condition: 'Abonne-toi au plan Premium', unlocked: plan === 'premium' },
    { emoji: '👑', name: 'VIP', desc: 'Le statut ultime.', condition: 'Abonne-toi au plan VIP', unlocked: plan === 'vip', gold: true },
    { emoji: '🌅', name: 'Early Adopter', desc: 'Tu étais là dès le début.', condition: 'Parmi les 100 premiers inscrits', unlocked: earlyAdopter, gold: true },
  ]

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* SECTION 1 — Cover + avatar */}
      <div className="relative">
        <div
          className="h-44 w-full"
          style={{
            background:
              'linear-gradient(135deg,#5a1219 0%,#2a0a0d 45%,#0a0a0a 100%)',
          }}
        />
        <button
          onClick={() => navigate('/settings')}
          aria-label="Paramètres"
          className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-fg/80 backdrop-blur transition-colors hover:text-fg"
        >
          <Settings className="h-5 w-5" />
        </button>
        <div className="absolute inset-x-0 -bottom-12 flex justify-center">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-card text-4xl font-bold text-fg ring-4 ring-accent">
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
      </div>

      <div className="space-y-7 px-4 pb-10 pt-16">
        {/* Identité */}
        <div className="text-center">
          <h1 className="font-display text-2xl font-bold">{pseudo}</h1>
          {ville && <p className="mt-0.5 text-sm text-[#888888]">{ville}</p>}
          <span className="lvl-glow mt-3 inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
            {level.name}
          </span>
          {joined && (
            <p className="mt-2 text-xs text-[#888888]">
              Membre depuis {joined}
            </p>
          )}
          {meId && (
            <button
              onClick={() => navigate(`/u/${meId}`)}
              className="mt-3 text-sm text-fg/70"
            >
              <span className="font-bold text-fg">{followers}</span> abonnés
              {' · '}
              <span className="font-bold text-fg">{following}</span>{' '}
              abonnements
            </button>
          )}
        </div>

        {/* SECTION 2 — XP */}
        <section className="rounded-2xl border border-white/5 bg-card p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-[#888888]">
              Niveau {level.name}
            </span>
            <span className="font-display text-lg font-bold text-fg">
              {xp} XP
            </span>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-out"
              style={{ width: `${animPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[#888888]">
            {level.isMax
              ? 'Niveau maximum atteint 👑'
              : `Plus que ${level.toNext} XP avant ${level.next}`}
          </p>
        </section>

        {/* SECTION 3 — Stats */}
        <section className="grid grid-cols-3 gap-3">
          <Stat
            value={String(total)}
            label="Spots"
            onClick={() => navigate('/ma-galerie')}
          />
          <Stat
            value={String(uniqueBrands)}
            label="Marques"
            onClick={() => navigate('/mes-marques')}
          />
          <Stat
            value={rank ? `#${rank}` : '—'}
            label="Rang global"
            onClick={() => navigate('/classement')}
          />
        </section>

        {/* SECTION 4 — Badges */}
        <section>
          <h2 className="mb-3 font-display text-lg font-bold">Mes badges</h2>
          <div className="grid grid-cols-4 gap-2">
            {badges.map((b) => (
              <button
                key={b.name}
                onClick={() => setOpenBadge(b)}
                className={`relative flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3.5 text-center transition-transform active:scale-95 ${
                  b.unlocked
                    ? b.gold
                      ? 'bg-[#E0B341]/15 ring-1 ring-[#E0B341]/50'
                      : 'bg-accent/10 ring-1 ring-accent/30'
                    : 'bg-card'
                }`}
              >
                {b.unlocked ? (
                  <span className="text-2xl">{b.emoji}</span>
                ) : (
                  <span className="flex h-7 items-center justify-center">
                    <Lock className="h-4 w-4 text-fg/25" />
                  </span>
                )}
                <span
                  className={`text-[10px] leading-tight ${
                    b.unlocked
                      ? b.gold
                        ? 'font-bold text-[#E0B341]'
                        : 'text-accent'
                      : 'text-fg/30'
                  }`}
                >
                  {b.name}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* SECTION 5 — Garage */}
        <section>
          <h2 className="mb-3 font-display text-lg font-bold">
            Mon garage{' '}
            <span className="text-fg/40">
              ({total} voiture{total > 1 ? 's' : ''})
            </span>
          </h2>
          {total === 0 ? (
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
            <div className="grid grid-cols-3 gap-2.5">
              {spots.map((s) => (
                <button
                  key={s.id}
                  onClick={() => navigate(`/spot/${s.id}`)}
                  className="relative aspect-square overflow-hidden rounded-2xl bg-card text-left ring-1 ring-white/5"
                >
                  {s.photo_url ? (
                    <img
                      src={s.photo_url}
                      alt={`${s.brand} ${s.model}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Car className="h-8 w-8 text-fg/20" />
                    </div>
                  )}
                  <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[8px] font-semibold tracking-wide backdrop-blur">
                    {categoryLabel(s.category).toUpperCase()}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2">
                    <p className="truncate text-[11px] font-semibold">
                      {s.brand} {s.model}
                    </p>
                    <p className="text-[9px] text-fg/50">
                      {timeAgo(s.created_at)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      {openBadge && (
        <div
          onClick={() => setOpenBadge(null)}
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-t-3xl bg-card p-6 pb-8 text-center sm:rounded-3xl"
          >
            <div className="flex justify-end">
              <button
                onClick={() => setOpenBadge(null)}
                aria-label="Fermer"
                className="text-fg/40 hover:text-fg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div
              className={`mx-auto flex h-20 w-20 items-center justify-center rounded-full text-4xl ${
                openBadge.unlocked
                  ? openBadge.gold
                    ? 'bg-[#E0B341]/20 ring-2 ring-[#E0B341]/60'
                    : 'bg-accent/15 ring-2 ring-accent/40'
                  : 'bg-white/5'
              }`}
            >
              {openBadge.unlocked ? (
                openBadge.emoji
              ) : (
                <Lock className="h-7 w-7 text-fg/30" />
              )}
            </div>
            <h3
              className={`mt-4 font-display text-xl font-bold ${
                openBadge.unlocked && openBadge.gold
                  ? 'text-[#E0B341]'
                  : 'text-fg'
              }`}
            >
              {openBadge.name}
            </h3>
            <p className="mt-1 text-sm text-fg/60">{openBadge.desc}</p>

            <div className="mt-5 space-y-2 rounded-2xl bg-white/5 p-4 text-left text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="text-fg/40">Comment l'obtenir</span>
                <span className="text-right font-medium text-fg">
                  {openBadge.condition}
                </span>
              </div>
              {openBadge.xp != null && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-fg/40">XP associé</span>
                  <span className="font-bold text-accent">
                    +{openBadge.xp} XP
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="text-fg/40">Statut</span>
                <span
                  className={`font-semibold ${
                    openBadge.unlocked ? 'text-accent' : 'text-fg/40'
                  }`}
                >
                  {openBadge.unlocked ? 'Obtenu ✓' : 'Verrouillé'}
                </span>
              </div>
            </div>

            {!openBadge.unlocked && (
              <p className="mt-4 text-xs text-fg/40">
                Continue à spotter pour le débloquer 💪
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({
  value,
  label,
  onClick,
}: {
  value: string
  label: string
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl border border-white/5 bg-card px-2 py-4 text-center shadow-[0_2px_10px_rgba(0,0,0,0.4)] transition-transform active:scale-95"
    >
      <div className="font-display text-xl font-bold text-fg">{value}</div>
      <div className="mt-1 text-[11px] text-[#888888]">{label}</div>
    </button>
  )
}
