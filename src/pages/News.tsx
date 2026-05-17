import { useCallback, useEffect, useState } from 'react'
import { Newspaper } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/spots'
import { SkeletonCard } from '../components/Skeleton'

type NewsItem = {
  id: string
  title: string
  summary: string | null
  source: string | null
  category: string
  url: string
  image_url: string | null
  published_at: string | null
  created_at: string
}

const FILTERS = ['Tout', 'F1', 'Supercar', 'Hypercar', 'Events'] as const
type Filter = (typeof FILTERS)[number]

// Badge colour per category — F1 red, Supercar orange, Hypercar violet,
// Events blue.
const BADGE: Record<string, string> = {
  F1: 'bg-accent',
  Supercar: 'bg-[#F59E0B]',
  Hypercar: 'bg-[#8B5CF6]',
  Events: 'bg-[#3B82F6]',
}
function badgeClass(cat: string): string {
  return BADGE[cat] ?? 'bg-white/20'
}

export default function News() {
  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [filter, setFilter] = useState<Filter>('Tout')

  const fetchNews = useCallback(async () => {
    setItems(null)
    const { data, error } = await supabase
      .from('news')
      .select('*')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(50)
    if (error) console.error('news fetch failed:', error)
    setItems((data ?? []) as NewsItem[])
  }, [])

  useEffect(() => {
    fetchNews()
  }, [fetchNews])

  const visible =
    items && filter !== 'Tout'
      ? items.filter((n) => n.category === filter)
      : items

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <h1 className="py-4 text-2xl font-semibold text-fg">Actu</h1>

      <div className="no-scrollbar -mx-4 mb-2 flex gap-2 overflow-x-auto px-4 pb-2">
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

      {items === null ? (
        <div className="divide-y divide-white/5">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-white/5 bg-card p-6 text-center">
          <p className="text-sm text-fg/60">Pas d'actu pour le moment.</p>
          <button
            onClick={fetchNews}
            className="mt-4 rounded-full bg-accent px-6 py-3 text-sm font-medium text-fg"
          >
            Rafraîchir
          </button>
        </div>
      ) : visible && visible.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-fg/40">
          Aucun article dans « {filter} ».
        </p>
      ) : (
        <div className="divide-y divide-white/5">
          {(visible ?? []).map((n) => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block py-5"
            >
              <div className="relative">
                {n.image_url ? (
                  <img
                    src={n.image_url}
                    alt={n.title}
                    className="aspect-video w-full rounded-2xl object-cover"
                  />
                ) : (
                  <div className="flex aspect-video w-full items-center justify-center rounded-2xl bg-card">
                    <Newspaper size={40} color="#444444" />
                  </div>
                )}
                <span
                  className={`absolute left-3 top-3 rounded-full px-3 py-1 text-[10px] font-semibold tracking-wide text-fg backdrop-blur ${badgeClass(
                    n.category,
                  )}`}
                >
                  {n.category.toUpperCase()}
                </span>
              </div>

              <div className="mt-3">
                <h2 className="font-semibold text-fg">{n.title}</h2>
                {n.summary && (
                  <p className="mt-1 text-sm text-fg/60">{n.summary}</p>
                )}
                <p className="mt-2 text-xs text-fg/30">
                  {[n.source, timeAgo(n.published_at ?? n.created_at)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
