import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Car, Camera } from 'lucide-react'
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
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div className="min-w-0">
          <h1 className="display-xl text-fg">Mes spots</h1>
          {spots && spots.length > 0 && (
            <p className="label-up mt-1 text-[10px] text-fg2">
              {spots.length} spot{spots.length > 1 ? 's' : ''}
            </p>
          )}
        </div>
      </div>

      <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`tappable shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-sm font-bold tracking-wide transition-colors ${
              filter === f
                ? 'bg-accent text-fg'
                : 'bg-card text-fg2 hover:text-fg'
            }`}
            style={
              filter === f
                ? undefined
                : { border: '1px solid var(--color-border)' }
            }
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
      ) : spots.length === 0 ? (
        <div
          className="rounded-3xl bg-card p-8 text-center"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <div
            className="mx-auto flex h-14 w-14 items-center justify-center rounded-full"
            style={{
              background: 'rgba(232,32,58,0.12)',
              border: '1px solid rgba(232,32,58,0.35)',
            }}
          >
            <Camera className="h-7 w-7 text-accent" />
          </div>
          <p className="mt-4 font-display text-xl font-extrabold tracking-tighter text-fg">
            Ton garage est vide 🏎️
          </p>
          <p className="mt-1 text-sm text-fg2">
            Commence à spotter pour le remplir.
          </p>
          <button
            onClick={() => navigate('/new-spot')}
            className="tappable mt-5 rounded-full bg-accent px-6 py-3 text-sm font-extrabold tracking-wider text-fg"
            style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
          >
            SPOTTER MAINTENANT
          </button>
        </div>
      ) : !visible || visible.length === 0 ? (
        <p className="py-16 text-center text-sm text-fg2">
          Aucun spot en {filter}.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 pb-8">
          {visible.map((s) => (
            <button
              key={s.id}
              onClick={() => navigate(`/spot/${s.id}`)}
              className="tappable relative aspect-square overflow-hidden rounded-2xl bg-card text-left"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {s.photo_url ? (
                <img
                  src={s.photo_url}
                  alt={`${s.brand} ${s.model}`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Car className="h-8 w-8 text-fg2/40" />
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent p-2.5 pt-7">
                <p className="truncate font-display text-xs font-extrabold leading-tight tracking-tighter text-white">
                  {s.brand} {s.model}
                </p>
                <p className="mt-0.5 text-[10px] text-fg/55">
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
