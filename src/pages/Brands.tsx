import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Search as SearchIcon, X } from 'lucide-react'
import { BRANDS, brandTagline, type Brand } from '../lib/brands'
import BrandLogo from '../components/BrandLogo'

// First letter for the A-Z section bucket; non-letters fall under '#'.
function sectionLetter(name: string): string {
  const c = name.trim().charAt(0).toUpperCase()
  return /[A-Z]/.test(c) ? c : '#'
}

// Explorer brands — an iOS Contacts / Apple Music-style typographic list.
// Used standalone (/brands) and embedded inside Discover's "Marques" tab.
export default function Brands({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const needle = q.trim().toLowerCase()

  // Filter (instant, from the first keystroke) then sort alphabetically.
  const sorted = useMemo(() => {
    const list = needle
      ? BRANDS.filter(
          (b) =>
            b.name.toLowerCase().includes(needle) ||
            b.match.some((m) => m.includes(needle)),
        )
      : BRANDS
    return [...list].sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  }, [needle])

  // Bucket into A-Z sections.
  const sections = useMemo(() => {
    const groups = new Map<string, Brand[]>()
    for (const b of sorted) {
      const l = sectionLetter(b.name)
      const arr = groups.get(l) ?? []
      arr.push(b)
      groups.set(l, arr)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [sorted])

  const letters = sections.map(([l]) => l)

  function jumpTo(letter: string) {
    sectionRefs.current[letter]?.scrollIntoView({ block: 'start' })
  }

  // Drag the alphabet rail like iOS — resolve the letter under the finger.
  function onRailTouch(e: React.TouchEvent) {
    const t = e.touches[0]
    if (!t) return
    const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null
    const l = el?.dataset?.letter
    if (l) jumpTo(l)
  }

  const list = (
    <div className="relative pb-10">
      {/* Search — instant filter */}
      <div className="px-4 pb-2 pt-1">
        <div
          className="flex items-center gap-2 rounded-full px-4 py-2.5"
          style={{
            background: 'var(--color-glass)',
            border: '1px solid var(--color-border)',
            backdropFilter: 'saturate(160%) blur(22px)',
            WebkitBackdropFilter: 'saturate(160%) blur(22px)',
          }}
        >
          <SearchIcon className="h-4 w-4 flex-none text-fg2" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher une marque…"
            className="flex-1 bg-transparent text-xs font-medium tracking-tight text-fg/80 outline-none placeholder:text-fg2"
          />
          {q && (
            <button
              onClick={() => setQ('')}
              aria-label="Effacer"
              className="tappable text-fg2 hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {sections.length === 0 ? (
        <p className="px-8 py-16 text-center text-sm text-fg2">
          Aucune marque pour « {q} ».
        </p>
      ) : (
        sections.map(([letter, brands]) => (
          <div
            key={letter}
            ref={(el) => {
              sectionRefs.current[letter] = el
            }}
          >
            {/* Sticky section header (iOS Contacts) */}
            <div className="sticky top-0 z-10 bg-bg px-4 py-1 text-[11px] font-bold tracking-widest text-fg2">
              {letter}
            </div>
            {brands.map((b) => (
              <button
                key={b.slug}
                onClick={() => navigate(`/brand/${b.slug}`)}
                className="tappable flex w-full items-center gap-3.5 px-4 py-2.5 text-left"
                style={{ borderBottom: '1px solid var(--color-divider)' }}
              >
                <BrandLogo brand={b} size={24} mono className="flex-none" />
                <span className="flex-1 truncate text-sm font-medium uppercase tracking-wider text-fg">
                  {b.name}
                </span>
                <span className="flex-none text-xs font-light text-fg2">
                  {brandTagline(b)}
                </span>
                <ChevronRight className="h-4 w-4 flex-none text-fg2/50" />
              </button>
            ))}
          </div>
        ))
      )}

      {/* A-Z index rail — tap or drag to jump. Hidden while searching. */}
      {!needle && letters.length > 3 && (
        <div
          className="fixed right-0.5 top-1/2 z-20 flex -translate-y-1/2 select-none flex-col items-center py-2"
          style={{ touchAction: 'none' }}
          onTouchStart={onRailTouch}
          onTouchMove={onRailTouch}
        >
          {letters.map((l) => (
            <button
              key={l}
              data-letter={l}
              onClick={() => jumpTo(l)}
              className="px-1 text-[10px] font-bold leading-[1.18] text-fg2/70 transition-colors active:text-accent"
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  )

  if (embedded) return list

  return (
    <div className="min-h-screen bg-bg pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 px-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="display-xl text-fg">Marques</h1>
      </div>
      {list}
    </div>
  )
}
