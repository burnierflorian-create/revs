import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Car } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CATEGORIES, categoryLabel, timeAgo, type Spot } from '../lib/spots'
import { Skeleton } from '../components/Skeleton'

const FILTERS = ['Tout', ...CATEGORIES.map((c) => c.label)] as const

export default function MyGallery() {
  const navigate = useNavigate()
  const [spots, setSpots] = useState<Spot[] | null>(null)
  const [filter, setFilter] = useState<string>('Tout')

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('spots')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (active) setSpots((data ?? []) as Spot[])
    })()
    return () => {
      active = false
    }
  }, [])

  const visible =
    spots && filter !== 'Tout'
      ? spots.filter((s) => categoryLabel(s.category) === filter)
      : spots

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button onClick={() => navigate(-1)} aria-label="Retour" className="text-fg/60 hover:text-fg">
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="font-display text-2xl font-bold">Mes spots</h1>
      </div>

      <div className="no-scrollbar -mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              filter === f
                ? 'bg-accent text-fg'
                : 'bg-card text-fg/50 hover:text-fg'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {spots === null ? (
        <div className="grid grid-cols-2 gap-2.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-2xl" />
          ))}
        </div>
      ) : !visible || visible.length === 0 ? (
        <p className="py-16 text-center text-sm text-fg/40">
          {filter === 'Tout'
            ? 'Aucun spot pour le moment.'
            : `Aucun spot en ${filter}.`}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 pb-8">
          {visible.map((s) => (
            <button
              key={s.id}
              onClick={() => navigate(`/spot/${s.id}`)}
              className="relative aspect-square overflow-hidden rounded-2xl bg-card text-left ring-1 ring-white/5"
            >
              {s.photo_url ? (
                <img src={s.photo_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Car className="h-8 w-8 text-fg/20" />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2">
                <p className="truncate text-xs font-semibold text-white">
                  {s.brand} {s.model}
                </p>
                <p className="text-[10px] text-white/50">
                  {timeAgo(s.created_at)}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
