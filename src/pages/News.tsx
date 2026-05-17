import { useCallback, useEffect, useState } from 'react'
import { Newspaper, Rss } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/spots'
import EmptyState from '../components/EmptyState'
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

export default function News() {
  const [items, setItems] = useState<NewsItem[] | null>(null)

  const fetchNews = useCallback(async () => {
    setItems(null)
    const { data } = await supabase
      .from('news')
      .select('*')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(50)
    setItems((data ?? []) as NewsItem[])
  }, [])

  useEffect(() => {
    fetchNews()
  }, [fetchNews])

  if (items === null) {
    return (
      <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="py-4 text-2xl font-semibold text-fg">Actu</h1>
        <div className="divide-y divide-white/5">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Rss}
        title="Pas d'actu pour le moment"
        subtitle="Les dernières news F1 et auto arriveront bientôt."
        buttonLabel="Rafraîchir"
        onButton={fetchNews}
      />
    )
  }

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))]">
      <h1 className="py-4 text-2xl font-semibold text-fg">Actu</h1>
      <div className="divide-y divide-white/5">
        {items.map((n) => (
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
              <span className="absolute left-3 top-3 rounded-full bg-accent/80 px-3 py-1 text-[10px] font-semibold tracking-wide text-fg backdrop-blur">
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
    </div>
  )
}
