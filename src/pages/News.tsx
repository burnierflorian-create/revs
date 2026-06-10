import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/spots'
import { Skeleton } from '../components/Skeleton'
import { categoryBadge } from '../lib/categoryStyle'

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
      {/* "MIS À JOUR IL Y A X MIN" — discreet italic line under the
          sub-tabs. */}
      <p className="px-1 pb-3 pt-1 text-[11px] italic text-white/35">
        {items && items.length > 0
          ? `MIS À JOUR ${timeAgo(newestStamp(items) ?? items[0].created_at).toUpperCase()}`
          : ''}
      </p>

      {items === null ? (
        // Animated skeleton loaders — one hero + a few medium cards.
        <div className="flex flex-col gap-2.5 pt-1">
          <Skeleton className="h-[248px] w-full rounded-2xl" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex gap-3 rounded-xl p-[14px]"
              style={{ background: '#141414' }}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-3 w-16 rounded-full" />
                <Skeleton className="h-3.5 w-full rounded-full" />
                <Skeleton className="h-3.5 w-3/4 rounded-full" />
                <Skeleton className="mt-auto h-2.5 w-24 rounded-full" />
              </div>
              <Skeleton className="h-[90px] w-[90px] flex-none rounded-[10px]" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div
          className="rounded-2xl p-6 text-center"
          style={{ background: '#141414' }}
        >
          <p className="text-sm text-white/55">Pas d'actu pour le moment.</p>
          <button
            onClick={() => load(false)}
            className="tappable mt-4 rounded-full px-6 py-3 text-sm font-bold text-white"
            style={{
              background: '#E8203A',
              boxShadow: '0 8px 24px rgba(232,32,58,0.45)',
            }}
          >
            Rafraîchir
          </button>
        </div>
      ) : visible && visible.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-white/45">
          Aucun article pour le moment.
        </p>
      ) : (
        // Apple News premium layout — a large hero card then medium
        // horizontal cards, spaced by a 10px gap (no separators).
        <div className="flex flex-col gap-2.5">
          {(visible ?? []).map((n, i) => {
            const b = categoryBadge(n.category) ?? {
              label: n.category.toUpperCase(),
              color: '#6B7280',
            }
            const meta = [n.source, timeAgo(n.published_at ?? n.created_at)]
              .filter(Boolean)
              .join(' · ')
            const img = n.image_url || fallbackImg(n.category)

            if (i === 0) {
              // HERO — full-width, 200px image, title over a dark gradient.
              return (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tappable block overflow-hidden rounded-2xl"
                  style={{
                    background: '#141414',
                    boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
                  }}
                >
                  <div className="relative h-[200px] w-full">
                    <img
                      src={img}
                      alt={n.title}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                    <span
                      className="absolute left-3 top-3 rounded-md px-2 py-1 text-[10px] font-extrabold text-white"
                      style={{ background: b.color, letterSpacing: '0.06em' }}
                    >
                      {b.label}
                      {isNew(n) && ' · NOUVEAU'}
                    </span>
                    <div
                      aria-hidden
                      className="absolute inset-x-0 bottom-0 h-3/4"
                      style={{
                        background:
                          'linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.4) 45%, transparent 100%)',
                      }}
                    />
                    <h2 className="absolute inset-x-0 bottom-0 line-clamp-3 px-4 pb-3 text-[18px] font-bold leading-snug text-white">
                      {n.title}
                    </h2>
                  </div>
                  <p className="px-4 py-2.5 text-xs text-white/45">{meta}</p>
                </a>
              )
            }

            // MEDIUM — horizontal card, 90×90 image on the right.
            return (
              <a
                key={n.id}
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="tappable flex gap-3 rounded-xl p-[14px]"
                style={{
                  background: '#141414',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                }}
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span
                    className="self-start rounded px-1.5 py-0.5 text-[9px] font-extrabold text-white"
                    style={{ background: b.color, letterSpacing: '0.06em' }}
                  >
                    {b.label}
                  </span>
                  <h3 className="mt-1.5 line-clamp-2 text-[15px] font-semibold leading-snug text-white">
                    {n.title}
                  </h3>
                  <p className="mt-auto pt-2 text-xs text-white/45">{meta}</p>
                </div>
                <img
                  src={img}
                  alt={n.title}
                  loading="lazy"
                  decoding="async"
                  className="h-[90px] w-[90px] flex-none rounded-[10px] object-cover"
                />
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
