import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Search as SearchIcon, X } from 'lucide-react'
import { BRANDS } from '../lib/brands'
import BrandLogo from '../components/BrandLogo'

/** Natures de marque proposées par le filtre. `all` n'est pas une valeur de
 *  `BrandType` : c'est l'absence de filtre. */
const KINDS = ['all', 'brand', 'tuner'] as const
type Kind = (typeof KINDS)[number]

/**
 * Ordre d'affichage de la grille.
 *
 * Le tri alphabétique convenait à la liste A–Z, où l'on vient chercher un nom
 * qu'on connaît déjà. Dans une grille de découverte il ouvre sur ABT, AC
 * Schnitzer et Alpina — trois préparateurs allemands, avant la première
 * marque que quiconque reconnaîtrait. La planche ouvre sur Ferrari,
 * Lamborghini et Porsche.
 *
 * Les catégories existent déjà dans `BRANDS` ; il suffisait de les classer.
 * À l'intérieur d'une catégorie, l'ordre reste alphabétique.
 *
 * Les hypercars passent APRÈS les supercars et le premium, bien qu'elles
 * soient les plus prestigieuses : la catégorie contient Apollo, Hennessey et
 * Pininfarina, qui en tête de grille ouvrent sur trois noms que presque
 * personne ne reconnaît. La planche ouvre sur Ferrari, Lamborghini et
 * Porsche — toutes trois en « supercars ».
 */
const CATEGORY_RANK: Record<string, number> = {
  supercars: 0,
  premium: 1,
  sport: 2,
  hypercars: 3,
  jdm: 4,
  american: 5,
  tuners: 6,
}

// Explorer brands — an iOS Contacts / Apple Music-style typographic list.
// Used standalone (/brands) and embedded inside Discover's "Marques" tab.
export default function Brands({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<Kind>('all')

  const needle = q.trim().toLowerCase()

  // Filtre (instantané, dès la première frappe) puis tri alphabétique.
  const sorted = useMemo(() => {
    const list = BRANDS.filter((b) => {
      if (kind !== 'all' && b.type !== kind) return false
      if (!needle) return true
      return (
        b.name.toLowerCase().includes(needle) ||
        b.match.some((m) => m.includes(needle))
      )
    })
    return [...list].sort((a, b) => {
      const d = (CATEGORY_RANK[a.category] ?? 9) - (CATEGORY_RANK[b.category] ?? 9)
      return d !== 0 ? d : a.name.localeCompare(b.name, 'fr')
    })
  }, [needle, kind])

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
            placeholder={t('brandspage.searchBrand')}
            // 16px font-size prevents the iOS focus auto-zoom.
            style={{ fontSize: '16px' }}
            className="flex-1 bg-transparent font-medium tracking-tight text-fg/80 outline-none placeholder:text-fg2"
          />
          {q && (
            <button
              onClick={() => setQ('')}
              aria-label={t('brandspage.clear')}
              className="tappable text-fg2 hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* En-tête de section + filtre de nature.
          Le « Toutes ▾ » de la planche n'est pas décoratif ici : `BRANDS`
          porte déjà un champ `type` qui sépare constructeurs et préparateurs,
          et c'est exactement la distinction que la liste signalait jusqu'ici
          par un « (Préparateur) » entre parenthèses derrière chaque nom. */}
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-1">
        <h2 className="text-[17px] font-bold text-fg">
          {t('brandspage.brands')}
        </h2>
        <div className="flex flex-none gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className="tappable rounded-full px-3 py-1.5 text-[12px] transition-colors"
              style={
                kind === k
                  ? { background: 'var(--revs-red)', color: '#fff', fontWeight: 700 }
                  : {
                      background: 'rgb(var(--color-fg) / 0.05)',
                      color: 'rgb(var(--color-fg-2))',
                      fontWeight: 500,
                    }
              }
            >
              {t(`brandspage.kind.${k}`)}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="px-8 py-16 text-center text-sm text-fg2">
          {t('brandspage.noBrandsFor', { query: q })}
        </p>
      ) : (
        /* ── GRILLE DE LA PLANCHE ──
           La liste A–Z d'avant était un annuaire : correcte pour retrouver
           un nom qu'on connaît déjà, muette pour découvrir. Or c'est l'onglet
           « Découvrir ». La grille montre les logos, qui se reconnaissent
           plus vite qu'ils ne se lisent.

           La planche pose une photo de calandre au bas de chaque carte. REVS
           n'a aucun visuel de face par marque, et la silhouette maison de
           CarSilhouettes ne pouvait pas tenir ce rôle : son tracé est figé à
           #F5F5F5, donc invisible sur le thème clair. Le socle garde la
           couleur de la marque — c'est elle qui donne à Ferrari sa carte
           rouge sur la référence — sans l'objet qui la portait. */
        <div className="grid grid-cols-3 gap-2.5 px-4">
          {sorted.map((b) => (
            <button
              key={b.slug}
              onClick={() => navigate(`/brand/${b.slug}`)}
              className="tappable relative flex aspect-[3/4] flex-col items-center overflow-hidden rounded-2xl px-2 pt-4"
              style={{
                background: 'rgb(var(--color-card))',
                border: '1px solid var(--color-border)',
              }}
            >
              {/* Plaque sombre sous le logo.
                  La liste A–Z affichait les marques en monochrome (`mono`),
                  donc toujours lisibles mais privées de leur couleur. La
                  grille les montre en couleur, comme la planche — sauf qu'un
                  tiers des logos sont blancs ou argentés (De Tomaso, Bentley,
                  Aston Martin) et s'effaçaient sur le thème clair. Cette
                  plaque est presque invisible sur le fond sombre, où elle ne
                  change rien, et rend le fond local sombre en thème clair, où
                  elle sauve ces logos-là. */}
              <span
                className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-xl"
                style={{ background: 'rgba(14,14,16,0.92)' }}
              >
                <BrandLogo brand={b} size={36} className="flex-none" />
              </span>
              <span className="mt-2 line-clamp-2 text-center text-[12px] font-semibold leading-tight text-fg">
                {b.name}
              </span>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[34%] items-end justify-center pb-2.5"
                style={{
                  background: `linear-gradient(to top, ${b.color}3d 0%, transparent 100%)`,
                }}
              >
                <ChevronRight className="h-4 w-4 text-fg/70" />
              </span>
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
          aria-label={t('brandspage.back')}
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="display-xl text-fg">{t('brandspage.brands')}</h1>
      </div>
      {list}
    </div>
  )
}
