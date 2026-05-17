import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Car, Settings } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { timeAgo, type Spot } from '../lib/spots'
import { formatEventDate, type CarEvent } from '../lib/events'
import { Skeleton } from '../components/Skeleton'

function levelFor(n: number): { num: number; label: string } {
  if (n >= 50) return { num: 4, label: 'Légende' }
  if (n >= 20) return { num: 3, label: 'Expert' }
  if (n >= 5) return { num: 2, label: 'Spotter' }
  return { num: 1, label: 'Débutant' }
}

export default function Home() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('Spotter')
  const [totalSpots, setTotalSpots] = useState(0)
  const [uniqueBrands, setUniqueBrands] = useState(0)
  const [rank, setRank] = useState<number | null>(null)
  const [recent, setRecent] = useState<Spot[]>([])
  const [nextEvent, setNextEvent] = useState<CarEvent | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const email = user.email ?? ''
      const display = email ? email.split('@')[0] : 'Spotter'

      const [countRes, brandsRes, allUidsRes, recentRes, eventRes] =
        await Promise.all([
          supabase
            .from('spots')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id),
          supabase.from('spots').select('brand').eq('user_id', user.id),
          supabase.from('spots').select('user_id'),
          supabase
            .from('spots')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(3),
          supabase
            .from('events')
            .select('*')
            .gt('starts_at', new Date().toISOString())
            .order('starts_at', { ascending: true })
            .limit(1),
        ])

      if (!active) return

      const total = countRes.count ?? 0
      const brands = brandsRes.data
        ? new Set(
            (brandsRes.data as { brand: string }[]).map((r) => r.brand),
          ).size
        : 0

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

      setName(display)
      setTotalSpots(total)
      setUniqueBrands(brands)
      setRank(rk)
      setRecent((recentRes.data ?? []) as Spot[])
      setNextEvent((eventRes.data?.[0] ?? null) as CarEvent | null)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [])

  const level = levelFor(totalSpots)

  if (loading) {
    return (
      <div className="min-h-screen bg-bg px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between py-5">
          <div className="space-y-2">
            <Skeleton className="h-7 w-44 rounded" />
            <Skeleton className="h-5 w-32 rounded-full" />
          </div>
          <Skeleton className="h-6 w-6 rounded" />
        </div>
        <div className="space-y-8">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-12 w-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2 rounded" />
                  <Skeleton className="h-3 w-1/4 rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg px-5 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      {/* SECTION 1 — Header */}
      <header className="flex items-start justify-between py-5">
        <div>
          <h1 className="text-2xl font-bold text-fg">Bonjour {name}</h1>
          <span className="mt-2 inline-block rounded-full bg-accent px-3 py-1 text-xs font-medium text-fg">
            Niveau {level.num} · {level.label}
          </span>
        </div>
        <button
          aria-label="Réglages"
          className="text-fg/40 transition-colors hover:text-fg"
        >
          <Settings className="h-6 w-6" />
        </button>
      </header>

      <div className="space-y-8 pb-8">
        {/* SECTION 2 — CTA Spotter */}
        <button
          onClick={() => navigate('/new-spot')}
          className="w-full rounded-2xl bg-accent px-5 py-5 text-left"
        >
          <div className="text-lg font-semibold text-fg">
            📷 Spotter une voiture
          </div>
          <div className="mt-1 text-sm text-fg/70">
            L'IA reconnaîtra la voiture automatiquement
          </div>
        </button>

        {/* SECTION 3 — Stats */}
        <section className="grid grid-cols-3 gap-3">
          <Stat value={String(totalSpots)} label="Spots" />
          <Stat value={String(uniqueBrands)} label="Marques" />
          <Stat value={rank ? `#${rank}` : '—'} label="Rang local" />
        </section>

        {/* SECTION 4 — Spots récents */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-fg">
              🔥 Spots récents
            </h2>
            <button
              onClick={() => navigate('/feed')}
              aria-label="Voir le feed"
              className="text-fg/40 transition-colors hover:text-fg"
            >
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-[#888888]">Aucun spot pour le moment.</p>
          ) : (
            <ul className="space-y-3">
              {recent.map((s) => (
                <li key={s.id} className="flex items-center gap-3">
                  {s.photo_url ? (
                    <img
                      src={s.photo_url}
                      alt=""
                      className="h-12 w-12 flex-none rounded-full object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-white/5">
                      <Car size={20} color="#444444" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">
                      {s.brand} {s.model}
                    </p>
                    <p className="text-xs text-fg/40">
                      {timeAgo(s.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* SECTION 5 — Prochain événement */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-fg">
            📅 Prochain événement
          </h2>
          {nextEvent ? (
            <div className="rounded-2xl bg-card p-4">
              <p className="font-semibold text-fg">{nextEvent.title}</p>
              <p className="mt-1 text-sm text-accent">
                {formatEventDate(nextEvent.starts_at)}
              </p>
              <p className="mt-1 text-sm text-fg/60">{nextEvent.location}</p>
              <button
                onClick={() => navigate('/events')}
                className="mt-3 rounded-full bg-accent px-4 py-2 text-xs font-medium text-fg"
              >
                Voir
              </button>
            </div>
          ) : (
            <p className="text-sm text-[#888888]">
              Aucun événement prévu ·{' '}
              <button
                onClick={() => navigate('/new-event')}
                className="text-accent"
              >
                Proposez le premier !
              </button>
            </p>
          )}
        </section>

        {/* SECTION 6 — Challenge du jour */}
        <section className="rounded-2xl bg-card p-4">
          <h2 className="text-base font-semibold text-fg">
            🏆 Challenge du jour
          </h2>
          <p className="mt-1 text-sm text-fg/60">
            Spotte ta première supercar à Annecy ou Genève
          </p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: totalSpots > 0 ? '100%' : '0%' }}
            />
          </div>
        </section>
      </div>

      {/* Bouton flottant — page Accueil uniquement */}
      <button
        onClick={() => navigate('/new-spot')}
        className="fixed bottom-24 right-4 z-20 rounded-full bg-accent px-5 py-3 text-sm font-medium text-fg shadow-lg shadow-accent/40 active:scale-95"
      >
        📷 Spotter
      </button>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-card px-2 py-4 text-center">
      <div className="text-xl font-bold text-fg">{value}</div>
      <div className="mt-1 text-[11px] text-fg/40">{label}</div>
    </div>
  )
}
