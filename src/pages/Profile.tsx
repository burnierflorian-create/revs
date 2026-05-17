import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Car, Warehouse } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { categoryLabel, timeAgo, type Spot } from '../lib/spots'
import { Skeleton } from '../components/Skeleton'

type Tier = { label: string; emoji: string }

function tierFor(n: number): Tier {
  if (n >= 100) return { label: 'Légende', emoji: '👑' }
  if (n >= 50) return { label: 'Élite', emoji: '💎' }
  if (n >= 20) return { label: 'Expert', emoji: '🔥' }
  if (n >= 5) return { label: 'Spotter', emoji: '⭐' }
  return { label: 'Débutant', emoji: '🔰' }
}

function memberSince(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
  }).format(d)
}

export default function Profile() {
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [pseudo, setPseudo] = useState('Spotter')
  const [joined, setJoined] = useState('')
  const [spots, setSpots] = useState<Spot[]>([])
  const [uniqueBrands, setUniqueBrands] = useState(0)
  const [rank, setRank] = useState<number | null>(null)
  const [hasEvent, setHasEvent] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const [spotsRes, allUidsRes, eventsRes] = await Promise.all([
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
      ])

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
      setPseudo(email ? email.split('@')[0] || 'Spotter' : 'Spotter')
      setJoined(memberSince(user.created_at))
      setSpots(mySpots)
      setUniqueBrands(
        new Set(mySpots.map((s) => s.brand).filter(Boolean)).size,
      )
      setRank(rk)
      setHasEvent((eventsRes.count ?? 0) > 0)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [])

  async function logout() {
    await supabase.auth.signOut()
    navigate('/auth', { replace: true })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="space-y-8 pb-8">
          <div className="flex flex-col items-center pt-6">
            <Skeleton className="h-20 w-20 rounded-full" />
            <Skeleton className="mt-4 h-6 w-32 rounded" />
            <Skeleton className="mt-2 h-5 w-40 rounded-full" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/3] rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  const total = spots.length
  const tier = tierFor(total)
  const has = (pred: (s: Spot) => boolean) => spots.some(pred)
  const brandHas = (needle: string) =>
    has((s) => (s.brand ?? '').toLowerCase().includes(needle))

  const badges = [
    { emoji: '🚀', name: 'Premier Spot', unlocked: total >= 1 },
    { emoji: '🔟', name: 'Série de 10', unlocked: total >= 10 },
    { emoji: '💯', name: 'Centurion', unlocked: total >= 100 },
    { emoji: '🏎️', name: 'Ferrari Hunter', unlocked: brandHas('ferrari') },
    { emoji: '🐂', name: 'Lambo Spotter', unlocked: brandHas('lamborghini') },
    {
      emoji: '🇯🇵',
      name: 'JDM Fan',
      unlocked: has((s) => s.category === 'JDM'),
    },
    { emoji: '📅', name: 'Organisateur', unlocked: hasEvent },
    {
      emoji: '⚡',
      name: 'Hypercar',
      unlocked: has((s) => s.category === 'hypercar'),
    },
  ]

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="space-y-8 pb-8">
        {/* SECTION 1 — Header */}
        <header className="flex flex-col items-center pt-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-3xl font-bold text-fg">
            {pseudo.charAt(0).toUpperCase()}
          </div>
          <h1 className="mt-4 text-xl font-bold">{pseudo}</h1>
          <span className="mt-2 inline-block rounded-full bg-accent px-3 py-1 text-xs font-medium">
            {tier.label} {tier.emoji}
          </span>
          {joined && (
            <p className="mt-2 text-sm text-[#888888]">Membre depuis {joined}</p>
          )}
        </header>

        {/* SECTION 2 — Stats */}
        <section className="grid grid-cols-3 gap-3">
          <Stat value={String(total)} label="Spots" />
          <Stat value={String(uniqueBrands)} label="Marques" />
          <Stat value={rank ? `#${rank}` : '—'} label="Rang global" />
        </section>

        {/* SECTION 3 — Badges */}
        <section>
          <h2 className="mb-3 text-[18px] font-semibold">Mes badges</h2>
          <div className="grid grid-cols-4 gap-2">
            {badges.map((b) => (
              <div
                key={b.name}
                className={`flex flex-col items-center gap-1 rounded-xl bg-card px-1 py-3 text-center ${
                  b.unlocked ? '' : 'opacity-30 grayscale'
                }`}
              >
                <span className="text-2xl">{b.emoji}</span>
                <span
                  className={`text-[10px] leading-tight ${
                    b.unlocked ? 'text-accent' : 'text-[#888888]'
                  }`}
                >
                  {b.name}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 4 — Garage */}
        <section>
          <h2 className="mb-3 text-[18px] font-semibold">
            Mon garage ({total} voiture{total > 1 ? 's' : ''})
          </h2>
          {total === 0 ? (
            <div className="flex flex-col items-center rounded-xl bg-card px-6 py-12 text-center">
              <Warehouse size={48} color="#444444" strokeWidth={1.5} />
              <p className="mt-4 max-w-[15rem] font-medium">
                Ton garage est vide, pars chasser ta première supercar
              </p>
              <button
                onClick={() => navigate('/new-spot')}
                className="mt-6 rounded-full bg-accent px-6 py-3 text-sm font-medium"
              >
                Spotter
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {spots.map((s) => (
                <div
                  key={s.id}
                  className="relative aspect-[4/3] overflow-hidden rounded-xl bg-card"
                >
                  {s.photo_url ? (
                    <img
                      src={s.photo_url}
                      alt={`${s.brand} ${s.model}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Car size={32} color="#444444" />
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-semibold tracking-wide backdrop-blur">
                    {categoryLabel(s.category).toUpperCase()}
                  </span>
                  <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[9px] backdrop-blur">
                    {timeAgo(s.created_at)}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <p className="truncate text-xs font-semibold">
                      {s.brand} {s.model}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* SECTION 5 — Premium + Déconnexion */}
        <button
          onClick={() => navigate('/premium')}
          className="w-full rounded-full bg-accent py-3 text-sm font-medium"
        >
          Passer Premium ✨
        </button>
        <button
          onClick={logout}
          className="w-full rounded-full border border-accent py-3 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-card px-2 py-4 text-center">
      <div className="text-xl font-bold text-fg">{value}</div>
      <div className="mt-1 text-[11px] text-[#888888]">{label}</div>
    </div>
  )
}
