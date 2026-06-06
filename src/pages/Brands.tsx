import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { BRAND_CATEGORIES, BRANDS, type Brand } from '../lib/brands'
import BrandLogo from '../components/BrandLogo'

// Used both as a standalone /brands route (with header) and as the
// "Marques" inner content of Discover (no header). `embedded` flips
// between the two layouts.
export default function Brands({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate()
  const byCat = new Map<string, Brand[]>()
  for (const b of BRANDS) {
    const arr = byCat.get(b.category) ?? []
    arr.push(b)
    byCat.set(b.category, arr)
  }

  // Nav clearance is handled globally in index.css (.stack-overlay
  // / .tab-pane). Per-page pb just adds breathing room.
  //
  // Card layout:
  //  - A fixed-aspect logo plate (aspect-square) keeps every cell of the
  //    grid identically sized regardless of which logo loads. This is
  //    what visually harmonises the catalogue.
  //  - Below the plate, the brand name + optional "PRÉPARATEUR" chip.
  //  - `brand.cardBg` overrides the default near-black surface for
  //    marques whose logo would otherwise vanish on dark.
  // Logos float free on the page background (no card plates anymore):
  // every mark is rendered monochrome (white on dark / charcoal on light)
  // so the catalogue reads as one clean, airy 3-column grid.
  const grid = (
    <div className="space-y-10 px-4 pb-8">
      {BRAND_CATEGORIES.map((cat) => {
        const list = byCat.get(cat.key) ?? []
        if (list.length === 0) return null
        return (
          <section key={cat.key}>
            <h2 className="mb-5 flex items-center justify-between px-1">
              <span className="font-display text-lg font-extrabold tracking-tighter text-fg">
                {cat.label}
              </span>
              <span className="label-up text-[10px] text-fg2">
                {list.length}
              </span>
            </h2>
            <div className="grid grid-cols-3 gap-x-4 gap-y-8">
              {list.map((b) => (
                <button
                  key={b.slug}
                  onClick={() => navigate(`/brand/${b.slug}`)}
                  className="tappable group flex flex-col items-center gap-2.5"
                >
                  <BrandLogo brand={b} size={72} mono />
                  <span className="line-clamp-1 text-center text-xs font-light tracking-wide text-fg2">
                    {b.name}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )

  if (embedded) return grid

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
      {grid}
    </div>
  )
}
