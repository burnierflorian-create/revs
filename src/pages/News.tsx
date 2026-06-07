import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/spots'
import { SkeletonCard } from '../components/Skeleton'

// Opening Discover silently pings /api/fetch-news (server-throttled) if
// the freshest article is older than this, so news stays fresh without
// the user noticing.
const STALE_MS = 30 * 60 * 1000
// Don't re-ping within this window even across remounts (Discover tab
// switches remount News).
const TRIGGER_COOLDOWN_MS = 15 * 60 * 1000
const TRIGGER_KEY = 'revs_news_triggered_at'
// "NOUVEAU" badge for articles published in the last hour.
const NEW_MS = 60 * 60 * 1000
// When a category has fewer than this, top it up with other recent
// articles instead of showing a near-empty page.
const MIN_VISIBLE = 5
const FILL_WINDOW_MS = 48 * 60 * 60 * 1000

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

export default function News({ categories }: { categories: string[] }) {
  const [items, setItems] = useState<NewsItem[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [pull, setPull] = useState(0)
  const startY = useRef<number | null>(null)
  const triedRef = useRef(false)

  const load = useCallback(async (initial = false, silent = false) => {
    if (initial) setItems(null)
    else if (!silent) setRefreshing(true)
    const { data, error } = await supabase
      .from('news')
      .select('*')
      .gt('expires_at', new Date().toISOString())
      .order('published_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) console.error('news fetch failed:', error)
    setItems((data ?? []) as NewsItem[])
    if (!initial && !silent) setRefreshing(false)
  }, [])

  const triggerServerRefresh = useCallback(async () => {
    try {
      sessionStorage.setItem(TRIGGER_KEY, String(Date.now()))
    } catch {
      /* sessionStorage unavailable */
    }
    try {
      // Server is throttled + idempotent (dedup on url), so a naive
      // call here is safe even if several users open Discover at once.
      await fetch('/api/fetch-news', { method: 'GET' })
    } catch {
      /* offline — keep showing what we have */
    }
    // Silent: reload without flipping any visible refreshing indicator.
    await load(false, true)
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

  // Category first; if fewer than MIN_VISIBLE, top up with the most
  // recent other articles (last 48h) so the page is never near-empty.
  let visible: NewsItem[] | null = null
  if (items) {
    const inCat = items.filter((n) => categories.includes(n.category))
    if (inCat.length >= MIN_VISIBLE) {
      visible = inCat
    } else {
      const cutoff = Date.now() - FILL_WINDOW_MS
      const fill = items.filter(
        (n) =>
          !categories.includes(n.category) &&
          new Date(n.published_at ?? n.created_at).getTime() >= cutoff,
      )
      visible = [...inCat, ...fill].slice(
        0,
        Math.max(MIN_VISIBLE, inCat.length),
      )
    }
  }

  function isNew(n: NewsItem): boolean {
    return (
      Date.now() - new Date(n.published_at ?? n.created_at).getTime() <
      NEW_MS
    )
  }

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
          className="flex items-center justify-center overflow-hidden text-xs text-fg2 transition-[height]"
        >
          {refreshing ? (
            <span className="font-display font-extrabold tracking-tighter text-accent">
              REVS
            </span>
          ) : pull >= PULL_THRESHOLD ? (
            'Relâche pour actualiser'
          ) : (
            'Tire pour actualiser'
          )}
        </div>
      )}
      <div className="px-1 pb-3 pt-2 label-up text-[10px] text-fg2">
        {items && items.length > 0
          ? `Mis à jour ${timeAgo(newestStamp(items) ?? items[0].created_at)}`
          : ''}
      </div>

      {items === null ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div
          className="rounded-3xl bg-card p-6 text-center"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <p className="text-sm text-fg2">Pas d'actu pour le moment.</p>
          <button
            onClick={() => load(false)}
            className="tappable mt-4 rounded-full bg-accent px-6 py-3 text-sm font-extrabold tracking-wider text-fg"
            style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
          >
            Rafraîchir
          </button>
        </div>
      ) : visible && visible.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-fg2">
          Aucun article pour le moment.
        </p>
      ) : (
        // Apple News editorial layout — boxless. Each article floats on
        // the page, separated by a hairline. Tiny grey category eyebrow,
        // pure-white title, a crisp larger thumbnail on the right, and
        // source · time unified on one fine line.
        <div>
          {(visible ?? []).map((n) => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="tappable flex items-start gap-4 py-4 text-left"
              style={{ borderBottom: '1px solid var(--color-divider)' }}
            >
              <div className="min-w-0 flex-1">
                <p
                  className="font-bold uppercase text-fg2"
                  style={{ fontSize: '10px', letterSpacing: '0.14em' }}
                >
                  {n.category.toUpperCase()}
                  {isNew(n) && (
                    <span className="text-accent"> · Nouveau</span>
                  )}
                </p>
                <h2
                  className="mt-1 line-clamp-3 font-display font-bold leading-snug tracking-tight text-fg"
                  style={{ fontSize: '15px' }}
                >
                  {n.title}
                </h2>
                <p className="mt-1.5 truncate text-[11px] font-medium text-fg2">
                  {[n.source, timeAgo(n.published_at ?? n.created_at)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {/* Crisp, larger thumbnail (96px), softly rounded. */}
              <img
                src={n.image_url || fallbackImg(n.category)}
                alt={n.title}
                loading="lazy"
                decoding="async"
                className="h-24 w-24 flex-none rounded-lg object-cover"
              />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
