import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Car, User, MapPin, Tag, Clock, Trash2 } from 'lucide-react'
import {
  clearSearchHistory,
  getSearchHistory,
  pushSearchHistory,
  runGlobalSearch,
  type SearchHit,
} from '../lib/search'

const KIND_ICON: Record<SearchHit['kind'], React.ReactNode> = {
  car: <Car className="h-4 w-4" />,
  spotter: <User className="h-4 w-4" />,
  city: <MapPin className="h-4 w-4" />,
  brand: <Tag className="h-4 w-4" />,
}

function targetFor(hit: SearchHit): string {
  switch (hit.kind) {
    case 'car':
      return `/spot/${hit.ref_id}`
    case 'spotter':
      return `/u/${hit.ref_id}`
    case 'brand':
      return `/brand/${hit.ref_id}`
    case 'city':
      // No city detail page yet — drop the user on the classement,
      // where they'll see the city leaderboard tab.
      return `/classement`
  }
}

export default function SearchOverlay({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<string[]>([])

  useEffect(() => {
    if (open) {
      setHistory(getSearchHistory())
      // small delay so the focus lands after the transition
      setTimeout(() => inputRef.current?.focus(), 80)
    } else {
      setQ('')
      setHits([])
    }
  }, [open])

  // Debounced live search.
  useEffect(() => {
    const trimmed = q.trim()
    if (trimmed.length < 2) {
      setHits([])
      setBusy(false)
      return
    }
    setBusy(true)
    const t = setTimeout(async () => {
      const r = await runGlobalSearch(trimmed)
      setHits(r)
      setBusy(false)
    }, 220)
    return () => clearTimeout(t)
  }, [q])

  function go(hit: SearchHit) {
    pushSearchHistory(q)
    onClose()
    navigate(targetFor(hit))
  }

  function useHistoryEntry(s: string) {
    setQ(s)
  }

  function dropHistory() {
    clearSearchHistory()
    setHistory([])
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg/95 backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="flex flex-1 items-center gap-2 rounded-full bg-card px-4 py-2.5">
          <Search className="h-4 w-4 text-fg/40" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher voiture, spotter, ville…"
            className="flex-1 bg-transparent text-sm text-fg placeholder-fg/30 outline-none"
            autoComplete="off"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Effacer">
              <X className="h-4 w-4 text-fg/40" />
            </button>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-sm font-medium text-fg/60 hover:text-fg"
        >
          Annuler
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 pb-8">
        {q.trim().length < 2 ? (
          history.length === 0 ? (
            <p className="py-16 text-center text-sm text-fg/40">
              Cherche une voiture, un spotter, une ville ou une marque.
            </p>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between px-1 pt-2">
                <span className="text-xs uppercase tracking-wider text-fg/40">
                  Recherches récentes
                </span>
                <button
                  onClick={dropHistory}
                  className="flex items-center gap-1 text-xs text-fg/40 hover:text-accent"
                >
                  <Trash2 className="h-3 w-3" />
                  Effacer
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {history.map((h) => (
                  <button
                    key={h}
                    onClick={() => useHistoryEntry(h)}
                    className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-xs text-fg/70 hover:bg-white/10"
                  >
                    <Clock className="h-3 w-3" />
                    {h}
                  </button>
                ))}
              </div>
            </>
          )
        ) : busy && hits.length === 0 ? (
          <p className="py-16 text-center text-sm text-fg/40">Recherche…</p>
        ) : hits.length === 0 ? (
          <p className="py-16 text-center text-sm text-fg/40">
            Aucun résultat pour « {q} ».
          </p>
        ) : (
          <div className="space-y-1">
            {hits.map((h, i) => (
              <button
                key={`${h.kind}-${h.ref_id}-${i}`}
                onClick={() => go(h)}
                className="flex w-full items-center gap-3 rounded-xl bg-card px-3 py-2.5 text-left hover:bg-white/[0.06]"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-accent/15 text-accent">
                  {KIND_ICON[h.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">
                    {h.label}
                  </p>
                  <p className="truncate text-xs text-fg/40">{h.sublabel}</p>
                </div>
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-fg/40">
                  {h.kind === 'car'
                    ? 'voiture'
                    : h.kind === 'spotter'
                      ? 'spotter'
                      : h.kind === 'city'
                        ? 'ville'
                        : 'marque'}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
