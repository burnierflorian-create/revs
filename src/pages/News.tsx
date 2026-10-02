import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Globe } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/spots'
import { Skeleton } from '../components/Skeleton'
import { categoryBadge } from '../lib/categoryStyle'

// News is fetched ONLY by the once-daily server cron (vercel.json →
// /api/fetch-news, gated to 06:00 Europe/Paris). The client never triggers a
// fetch — it just reads the table + news_meta.last_fetched_at. "NOUVEAU"
// badge for articles published in the last hour.
const NEW_MS = 60 * 60 * 1000

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
  const { t } = useTranslation()
  const [items, setItems] = useState<NewsItem[] | null>(null)
  // Real last-fetch time (written by the 06:00 Paris cron into news_meta) —
  // the single source of truth for the "Mis à jour il y a X" label.
  const [lastFetched, setLastFetched] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [pull, setPull] = useState(0)
  const startY = useRef<number | null>(null)

  const load = useCallback(async (initial = false, silent = false) => {
    if (initial) setItems(null)
    else if (!silent) setRefreshing(true)
    // Pure DB reads — the client NEVER triggers an RSS fetch (that endpoint is
    // cron-only). Show EVERY article, newest first, plus the cron's real
    // last-fetch timestamp.
    const [newsRes, metaRes] = await Promise.all([
      supabase
        .from('news')
        .select('*')
        .order('published_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('news_meta')
        .select('last_fetched_at')
        .eq('id', 'singleton')
        .maybeSingle(),
    ])
    if (newsRes.error) console.error('news fetch failed:', newsRes.error)
    setItems((newsRes.data ?? []) as NewsItem[])
    setLastFetched(
      (metaRes.data?.last_fetched_at as string | undefined) ?? null,
    )
    if (!initial && !silent) setRefreshing(false)
  }, [])

  // Read once on mount. No polling interval — news only ever changes at the
  // daily 06:00 Paris cron, and it's served as-is for the rest of the day.
  useEffect(() => {
    load(true)
  }, [load])

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

  // Strict category filter — the CarSpotting and F1 tabs must stay fully
  // separated (no cross-category top-up), so each universe only ever shows
  // its own articles.
  const visible: NewsItem[] | null = items
    ? items.filter((n) => categories.includes(n.category))
    : null

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
            t('discoverpage.news.pullRelease')
          ) : (
            t('discoverpage.news.pullStart')
          )}
        </div>
      )}
      {/* "MIS À JOUR IL Y A X MIN" — discreet italic line under the
          sub-tabs. */}
      <p className="px-1 pb-3 pt-1 text-[11px] italic text-fg2">
        {items && items.length > 0
          ? t('discoverpage.news.updated', {
              time: timeAgo(
                lastFetched ?? newestStamp(items) ?? items[0].created_at,
              ).toUpperCase(),
            })
          : ''}
      </p>

      {items === null ? (
        // Animated skeleton loaders — one hero + a few medium cards.
        <div className="flex flex-col gap-2.5 pt-1">
          <Skeleton className="h-[248px] w-full rounded-2xl" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="flex gap-3 rounded-xl bg-card p-[14px]"
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
          className="rounded-2xl bg-card p-6 text-center"
        >
          <p className="text-sm text-fg2">{t('discoverpage.news.empty')}</p>
          <button
            onClick={() => load(false)}
            className="tappable mt-4 rounded-full px-6 py-3 text-sm font-bold text-white"
            style={{
              background: 'var(--revs-red)',
              boxShadow: '0 8px 24px rgb(var(--color-accent) / 0.45)',
            }}
          >
            {t('discoverpage.news.refresh')}
          </button>
        </div>
      ) : visible && visible.length === 0 ? (
        <p className="px-1 py-8 text-center text-sm text-fg2">
          {t('discoverpage.news.noArticles')}
        </p>
      ) : (
        // ── MISE EN PAGE DE LA PLANCHE DU 02/10 ──
        // Une carte principale puis des lignes compactes. Deux écarts avec la
        // version précédente, tous deux issus de la référence :
        //
        //  · le titre passe SOUS l'image au lieu d'être posé dessus. Un titre
        //    en surimpression dépend du contenu de la photo : sur un capot
        //    clair il devenait illisible, et le dégradé qu'il fallait pour le
        //    sauver mangeait la moitié de l'image ;
        //  · la vignette des lignes passe à GAUCHE. L'œil descend alors une
        //    colonne d'images alignées au lieu de zigzaguer.
        <div className="flex flex-col gap-2.5">
          {(visible ?? []).map((n, i) => {
            const b = categoryBadge(n.category) ?? {
              label: n.category.toUpperCase(),
              color: '#6B7280',
            }
            const when = timeAgo(n.published_at ?? n.created_at)
            const img = n.image_url || fallbackImg(n.category)

            if (i === 0) {
              return (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tappable block overflow-hidden rounded-2xl bg-card"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  <div className="relative aspect-[16/10] w-full">
                    <img
                      src={img}
                      alt={n.title}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                    <span
                      className="absolute left-3 top-3 rounded-lg px-2.5 py-1 text-[11px] font-extrabold text-white"
                      style={{ background: b.color, letterSpacing: '0.04em' }}
                    >
                      {b.label}
                      {isNew(n) && ` · ${t('discoverpage.news.new')}`}
                    </span>
                    {/* L'horodatage est posé sur l'image : il a donc son
                        propre voile sombre, sinon il disparaît sur un ciel. */}
                    <span
                      className="absolute right-3 top-3 rounded-md px-2 py-1 text-[12px] font-medium text-white/85"
                      style={{ background: 'rgba(0,0,0,0.42)', backdropFilter: 'blur(6px)' }}
                    >
                      {when}
                    </span>
                  </div>
                  <div className="px-4 pb-3.5 pt-3.5">
                    <h2 className="line-clamp-2 text-[19px] font-bold leading-snug text-fg">
                      {n.title}
                    </h2>
                    {n.summary && (
                      <p className="mt-1.5 line-clamp-2 text-[14px] leading-snug text-fg2">
                        {n.summary}
                      </p>
                    )}
                    {/* Pied de carte — source à gauche, chevron à droite.
                        La planche montre ici un compteur de « j'aime » et de
                        commentaires. La table `news` n'en porte aucun : les
                        afficher supposerait de les inventer, donc la place
                        reste à la source. */}
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5 flex-none text-fg2" />
                        <span className="truncate text-[13px] text-fg2">{n.source}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 flex-none text-fg2" />
                    </div>
                  </div>
                </a>
              )
            }

            return (
              <a
                key={n.id}
                href={n.url}
                target="_blank"
                rel="noopener noreferrer"
                className="tappable flex items-center gap-3 rounded-2xl bg-card p-3"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <img
                  src={img}
                  alt={n.title}
                  loading="lazy"
                  decoding="async"
                  className="h-[76px] w-[96px] flex-none rounded-xl object-cover"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center justify-between gap-2">
                    <span
                      className="rounded-md px-1.5 py-0.5 text-[9px] font-extrabold text-white"
                      style={{ background: b.color, letterSpacing: '0.05em' }}
                    >
                      {b.label}
                    </span>
                    <span className="flex-none text-[11px] text-fg2">{when}</span>
                  </span>
                  <h3 className="mt-1.5 line-clamp-2 text-[15px] font-semibold leading-snug text-fg">
                    {n.title}
                  </h3>
                </div>
                <ChevronRight className="h-4 w-4 flex-none text-fg2" />
              </a>
            )
          })}
        </div>
      )}
    </div>
  )
}
