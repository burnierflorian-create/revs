import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Car, ChevronRight, Tag } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { brandSlugFor } from '../lib/brands'
import { Skeleton } from '../components/Skeleton'

type Brand = { brand: string; count: number; photo: string | null; slug: string | null }

export default function MyBrands() {
  const { t } = useTranslation()
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
        else
          map.set(key, {
            brand: b,
            count: 1,
            photo: s.photo_url,
            slug: brandSlugFor(b),
          })
      }
      setBrands([...map.values()].sort((a, z) => z.count - a.count))
    })()
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('brandspage.back')}
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div className="min-w-0">
          <h1 className="display-xl text-fg">{t('brandspage.myBrands')}</h1>
          {brands && brands.length > 0 && (
            <p className="label-up mt-1 text-[10px] text-fg2">
              {t('brandspage.brandsSpotted', { count: brands.length })}
            </p>
          )}
        </div>
      </div>

      {brands === null ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : brands.length === 0 ? (
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
            <Tag className="h-7 w-7 text-accent" />
          </div>
          <p className="mt-4 font-display text-xl font-extrabold tracking-tighter text-fg">
            {t('brandspage.noBrandsYet')}
          </p>
          <p className="mt-1 text-sm text-fg2">
            {t('brandspage.spotToStart')}
          </p>
          <button
            onClick={() => navigate('/new-spot')}
            className="tappable mt-5 rounded-full bg-accent px-6 py-3 text-sm font-extrabold tracking-wider text-fg"
            style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
          >
            {t('brandspage.spotNow')}
          </button>
        </div>
      ) : (
        <div className="space-y-2 pb-8">
          {brands.map((b) => {
            const clickable = b.slug !== null
            const Comp = clickable ? 'button' : 'div'
            return (
              <Comp
                key={b.brand}
                onClick={
                  clickable ? () => navigate(`/brand/${b.slug}`) : undefined
                }
                className={`flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left ${
                  clickable ? 'tappable' : ''
                }`}
                style={{ border: '1px solid var(--color-border)' }}
              >
                <div
                  className="h-14 w-14 flex-none overflow-hidden rounded-xl"
                  style={{
                    background: 'rgb(var(--color-fg) / 0.04)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {b.photo ? (
                    <img
                      src={b.photo}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Car className="h-6 w-6 text-fg2/40" />
                    </div>
                  )}
                </div>
                <span className="flex-1 truncate font-display text-base font-extrabold tracking-tighter text-fg">
                  {b.brand}
                </span>
                <span className="flex-none rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-extrabold tracking-wider text-accent">
                  {b.count}
                  <span className="ml-0.5 text-[9px] font-bold opacity-80">
                    {t('brandspage.spotSuffix', { count: b.count })}
                  </span>
                </span>
                {clickable && (
                  <ChevronRight className="h-4 w-4 flex-none text-fg2" />
                )}
              </Comp>
            )
          })}
        </div>
      )}
    </div>
  )
}
