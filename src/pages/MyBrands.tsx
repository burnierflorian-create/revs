import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Car } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Skeleton } from '../components/Skeleton'

type Brand = { brand: string; count: number; photo: string | null }

export default function MyBrands() {
  const navigate = useNavigate()
  const [brands, setBrands] = useState<Brand[] | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('spots')
        .select('brand, photo_url, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (!active) return
      const map = new Map<string, Brand>()
      for (const s of (data ?? []) as {
        brand: string | null
        photo_url: string | null
      }[]) {
        const b = (s.brand ?? '').trim()
        if (!b) continue
        const key = b.toLowerCase()
        const cur = map.get(key)
        if (cur) cur.count += 1
        else map.set(key, { brand: b, count: 1, photo: s.photo_url })
      }
      setBrands(
        [...map.values()].sort((a, z) => z.count - a.count),
      )
    })()
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button onClick={() => navigate(-1)} aria-label="Retour" className="text-fg/60 hover:text-fg">
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="font-display text-2xl font-bold">Mes marques</h1>
      </div>

      {brands === null ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-2xl" />
          ))}
        </div>
      ) : brands.length === 0 ? (
        <p className="py-16 text-center text-sm text-fg/40">
          Aucune marque spottée pour le moment.
        </p>
      ) : (
        <div className="space-y-2 pb-8">
          {brands.map((b) => (
            <div
              key={b.brand}
              className="flex items-center gap-3 rounded-2xl bg-card p-3"
            >
              <div className="h-14 w-14 flex-none overflow-hidden rounded-xl bg-white/5">
                {b.photo ? (
                  <img src={b.photo} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Car className="h-6 w-6 text-fg/20" />
                  </div>
                )}
              </div>
              <span className="flex-1 truncate font-semibold text-fg">
                {b.brand}
              </span>
              <span className="rounded-full bg-accent/15 px-3 py-1 text-sm font-bold text-accent">
                {b.count} spot{b.count > 1 ? 's' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
