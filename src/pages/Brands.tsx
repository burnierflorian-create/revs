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
  // Each mark sits inside a "carbon wheel-centre" pastille: a jet-black
  // domed disc with a metallic radial sheen, the real (coloured) emblem
  // detoured cleanly inside. No generic white plates. Brand name floats
  // below in a thin label.
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
            <div className="grid grid-cols-3 gap-x-4 gap-y-7">
              {list.map((b) => (
                <button
                  key={b.slug}
                  onClick={() => navigate(`/brand/${b.slug}`)}
                  className="tappable group flex flex-col items-center gap-2.5"
                >
                  <div
                    className="flex items-center justify-center rounded-full transition-transform group-active:scale-95"
                    style={{
                      width: 84,
                      height: 84,
                      background:
                        'radial-gradient(circle at 38% 28%, #2c2c30 0%, #161618 46%, #060607 100%)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      boxShadow:
                        '0 10px 24px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.14), inset 0 -4px 8px rgba(0,0,0,0.6)',
                    }}
                  >
                    <BrandLogo brand={b} size={52} />
                  </div>
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
