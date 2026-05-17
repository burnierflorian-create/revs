import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Car } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  categoryLabel,
  spotterName,
  timeAgo,
  type Spot,
} from '../lib/spots'
import EmptyState from '../components/EmptyState'

export default function Feed() {
  const navigate = useNavigate()
  const [spots, setSpots] = useState<Spot[] | null>(null)

  const fetchSpots = useCallback(async () => {
    const { data } = await supabase
      .from('spots')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
    setSpots((data ?? []) as Spot[])
  }, [])

  useEffect(() => {
    fetchSpots()
    const onFocus = () => {
      if (document.visibilityState !== 'hidden') fetchSpots()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [fetchSpots])

  if (spots === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <div className="text-sm text-fg/40">Chargement…</div>
      </div>
    )
  }

  if (spots.length === 0) {
    return (
      <EmptyState
        icon={Car}
        title="Aucun spot pour le moment"
        subtitle="Soyez les premiers à spotter une supercar !"
        buttonLabel="Spotter maintenant"
        onButton={() => navigate('/new-spot')}
      />
    )
  }

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <h1 className="py-4 text-2xl font-semibold text-fg">Feed</h1>
      <div className="divide-y divide-white/5">
        {spots.map((spot) => (
          <article key={spot.id} className="py-5">
            <div className="relative">
              {spot.photo_url ? (
                <img
                  src={spot.photo_url}
                  alt={`${spot.brand} ${spot.model}`}
                  className="aspect-video w-full rounded-2xl object-cover"
                />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center rounded-2xl bg-white/5">
                  <Car size={40} color="#444444" />
                </div>
              )}
              <span className="absolute left-3 top-3 rounded-full bg-black/70 px-3 py-1 text-[10px] font-semibold tracking-wide text-fg backdrop-blur">
                {categoryLabel(spot.category).toUpperCase()}
              </span>
            </div>

            <div className="mt-3">
              <h2 className="font-semibold text-fg">
                {spot.brand} {spot.model}
              </h2>
              <p className="mt-1 text-sm text-fg/50">
                {[spot.color, spot.year, timeAgo(spot.created_at)]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="mt-1 text-xs text-fg/30">
                par {spotterName(null)}
              </p>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
