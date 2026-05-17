import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/spots'
import { SkeletonCard } from '../components/Skeleton'

// Vercel Hobby crons run once/day, so news goes stale through the day.
// When someone opens Actu and the freshest article is older than this,
// we ping /api/fetch-news (server-throttled) so the feed self-heals.
const STALE_MS = 2 * 60 * 60 * 1000
// Don't re-ping within this window even across remounts (Discover tab
// switches remount News).
const TRIGGER_COOLDOWN_MS = 15 * 60 * 1000
const TRIGGER_KEY = 'revs_news_triggered_at'

function newestStamp(list: { created_at: string }[]): string | null {
  let max = 0
  let stamp: string | null = null
  for (const n of list) {
    const t = new Date(n.created_at).getTime()
    if (t > max) {
      max = t
      stamp = n.created_at
    }
  }
  return stamp
}

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

// Royalty-free Unsplash fallbacks per category (verified URLs) used when
// the RSS item has no image — instead of a grey placeholder.
const CATEGORY_IMG: Record<string, string> = {
  F1: 'https://images.unsplash.com/photo-1752959805242-0a7799902ae4?w=800',
  Supercar:
    'https://images.unsplash.com/photo-1541348263662-e068662d82af?w=800',
  Hypercar:
    'https://images.unsplash.com/photo-1567808291548-fc3ee04dbcf0?w=800',
  Events:
    'https://images.unsplash.com/photo-1617060219602-8cbf8f1eff8d?w=800',
}
function fallbackImg(cat: string): string {
  return CATEGORY_IMG[cat] ?? CATEGORY_IMG.Supercar
}

export default function News() {
  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [filter, setFilter] = useState<Filter>('Tout')
  const [refreshing, setRefreshing] = useState(false)
  const [autoBusy, setAutoBusy] = useState(false)
  const [pull, setPull] = useState(0)
  const startY = useRef<number | null>(null)
  const triedRef = useRef(false)

  const load = useCallback(async (initial = false) => {
    if (initial) setItems(null)
    else setRefreshing(true)
    const { data, error } = await supabase
      .from('news')
      .select('*')
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(50)
    if (error) console.error('news fetch failed:', error)
    setItems((data ?? []) as NewsItem[])
    if (!initial) setRefreshing(false)
  }, [])

  const triggerServerRefresh = useCallback(async () => {
    try {
      sessionStorage.setItem(TRIGGER_KEY, String(Date.now()))
    } catch {
      /* sessionStorage unavailable */
    }
    setAutoBusy(true)
    try {
      // Server is throttled + idempotent (dedup on url), so a naive
      // call here is safe even if several users open Actu at once.
      await fetch('/api/fetch-news', { method: 'GET' })
    } catch {
      /* offline — keep showing what we have */
    }
    await load(false)
    setAutoBusy(false)
  }, [load])

  useEffect(() => {
    load(true)
    // Reload from DB every 30 min in case the cron / another client
    // refreshed it while this tab stayed open.
    const id = window.setInterval(() => load(false), 30 * 60 * 1000)
    return () => window.clearInterval(id)
  }, [load])

  // Once the first list arrives, self-heal if it's stale.
  useEffect(() => {
    if (triedRef.current || items === null) return
    triedRef.current = true
    const stamp = newestStamp(items)
    const ageMs = stamp ? Date.now() - new Date(stamp).getTime() : Infinity
    let lastTrigger = 0
    try {
      lastTrigger = Number(sessionStorage.getItem(TRIGGER_KEY) || 0)
    } catch {
      /* ignore */
    }
    if (
      ageMs > STALE_MS &&
      Date.now() - lastTrigger > TRIGGER_COOLDOWN_MS
    ) {
      void triggerServerRefresh()
    }
  }, [items, triggerServerRefresh])

  const PULL_THRESHOLD = 70

  function onTouchStart(e: React.TouchEvent) {
    startY.current = window.scrollY <= 0 ? e.touches[0].clientY : null
  }
  function onTouchMove(e: React.TouchEvent) {
    if (startY.current == null) return
    const delta = e.touches[0].clientY - startY.current
    setPull(delta > 0 && window.scrollY <= 0 ? Math.min(delta, 90) : 0)
  }
  function onTouchEnd() {
    if (pull >= PULL_THRESHOLD && !refreshing) load(false)
    setPull(0)
    startY.current = null
  }

  const visible =
    items && filter !== 'Tout'
      ? items.filter((n) => n.category === filter)
      : items

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className="bg-bg px-4"
    >
      {(pull > 0 || refreshing) && (
        <div
          style={{ height: refreshing ? 36 : Math.round(pull / 2) }}
          className="flex items-center justify-center overflow-hidden text-xs text-fg/50 transition-[height]"
        >
          {refreshing
            ? 'Actualisation…'
            : pull >= PULL_THRESHOLD
              ? 'Relâche pour actualiser'
              : 'Tire pour actualiser'}
        </div>
      )}
      <div className="flex items-center justify-between px-1 pb-1 pt-1 text-[11px] text-fg/40">
        <span>
          {autoBusy
            ? 'Actualisation des news…'
            : items && items.length > 0
              ? `Mis à jour ${timeAgo(newestStamp(items) ?? items[0].created_at)}`
              : ''}
        </span>
        {autoBusy && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
        )}
      </div>

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
            onClick={() => load(false)}
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
                <img
                  src={n.image_url || fallbackImg(n.category)}
                  alt={n.title}
                  className="aspect-video w-full rounded-2xl object-cover"
                />
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
