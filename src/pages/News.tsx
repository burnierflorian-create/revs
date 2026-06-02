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
        // Apple News editorial layout — text block on the left, fixed
        // thumbnail on the right, glass card shell. Replaces the
        // previous "image on top, text below" stack so the feed reads
        // like Apple News rather than a Pinterest stream.
        <div className="space-y-3 pb-2">
          {(visible ?? []).map((n) => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="tappable flex items-center gap-4 p-4 text-left"
              style={{
                background: 'rgba(20, 20, 22, 0.40)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '28px',
                backdropFilter: 'saturate(160%) blur(12px)',
                WebkitBackdropFilter: 'saturate(160%) blur(12px)',
                boxShadow: '0 12px 28px rgba(0, 0, 0, 0.18)',
              }}
            >
              <div className="min-w-0 flex-1 space-y-1.5">
                {/* Stacked badge row — category + NOUVEAU pill when
                    fresh. Single .gap row so they wrap gracefully on
                    long category names. */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[8px] font-black uppercase tracking-widest text-fg ${badgeClass(
                      n.category,
                    )}`}
                    style={{ letterSpacing: '0.16em' }}
                  >
                    {n.category.toUpperCase()}
                  </span>
                  {isNew(n) && (
                    <span
                      className="badge-new rounded-full font-black uppercase tracking-widest text-red-400"
                      style={{
                        background: 'rgba(239, 68, 68, 0.10)',
                        border: '1px solid rgba(239, 68, 68, 0.20)',
                        padding: '2px 8px',
                        fontSize: '8px',
                        letterSpacing: '0.16em',
                      }}
                    >
                      Nouveau
                    </span>
                  )}
                </div>
                <h2
                  className="line-clamp-2 font-display font-black leading-tight tracking-tight text-white"
                  style={{ fontSize: '14px' }}
                >
                  {n.title}
                </h2>
                {n.summary && (
                  <p className="line-clamp-2 text-xs font-medium leading-normal text-neutral-400">
                    {n.summary}
                  </p>
                )}
                <p className="text-[10px] font-medium text-fg2/70">
                  {[n.source, timeAgo(n.published_at ?? n.created_at)]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {/* Right-side fixed-ratio thumbnail. 20×20 (80px) per the
                  Apple News editorial layout. Falls back to the
                  category-mapped fallback image. */}
              <div
                className="h-20 w-20 flex-none overflow-hidden rounded-2xl"
                style={{
                  background: '#0a0a0a',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  boxShadow:
                    'inset 0 1px 0 rgba(255, 255, 255, 0.03)',
                }}
              >
                <img
                  src={n.image_url || fallbackImg(n.category)}
                  alt={n.title}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
