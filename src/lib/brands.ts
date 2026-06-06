// Static catalogue of the 36 brands & tuners featured in REVS.
//
// `slug` is the canonical URL identifier (`/brand/:slug`) and the value
// stored in `brand_follows.brand` / `brand_descriptions.brand`. Keep it
// lowercase / kebab-case and **stable forever** — changing it would
// orphan rows in the DB.
//
// `match` is the list of lowercased substrings we use to associate a
// spot to a brand: a spot whose `brand` column matches any of these
// counts. This handles the "Mercedes" vs "Mercedes-Benz" naming drift.

export type BrandCategory =
  | 'hypercars'
  | 'supercars'
  | 'premium'
  | 'sport'
  | 'jdm'
  | 'american'
  | 'tuners'

export type BrandType = 'brand' | 'tuner'

export type Brand = {
  slug: string
  name: string
  category: BrandCategory
  type: BrandType
  domain: string
  color: string
  match: string[]
  // Ordered list of logo URLs. BrandLogo walks this list on each
  // <img onError>; the first one that loads wins. Always followed by
  // a Clearbit attempt and then a monogram fallback.
  logos?: string[]
  // Some logos are near-black wordmarks (Brabus, Mansory, etc.) that
  // vanish on the app's dark theme. When true, BrandLogo applies a
  // CSS `brightness(0) invert(1)` filter to render them in pure white.
  // Trades brand colour for visibility — a fair deal for a dark theme.
  invertOnDark?: boolean
  // When true, the brand has claimed/verified their page on REVS.
  // Drives the "COMPTE OFFICIEL ✓" badge in the page header. All
  // brands are community pages by default — flip this when a brand
  // takes over their listing.
  verified?: boolean
  // Override the grid card background. Used for marques whose logo
  // would disappear against the default near-black `bg-card` (Bugatti,
  // Maserati, etc.). The value is consumed as an inline style.
  cardBg?: string
  // Optional 1 px border on the grid card. Reserved for marques where
  // a subtle metallic stroke fits the brand (Rolls-Royce gold).
  cardBorder?: string
  // Multiplier applied to the logo's inner ratio inside its container.
  // Use when the source SVG/PNG has a lot of empty padding around the
  // glyph (McLaren speedmark, Koenigsegg shield). 1 = default,
  // 1.3 = ~30 % bigger, 0.8 = ~20 % smaller. Clamped at 0.98 max.
  logoScale?: number
  // Extra CSS `filter` applied to the logo image, composed with the
  // `invertOnDark` filter when both are set. Used to bump brightness
  // on washed-out monochrome marks (Bentley silver wings).
  logoFilter?: string
}

export const BRAND_CATEGORIES: { key: BrandCategory; label: string }[] = [
  { key: 'hypercars', label: 'Hypercars' },
  { key: 'supercars', label: 'Supercars & Prestige' },
  { key: 'premium', label: 'Premium Allemand' },
  { key: 'sport', label: 'Sport & GT' },
  { key: 'jdm', label: 'JDM' },
  { key: 'american', label: 'Américaines' },
  { key: 'tuners', label: 'Préparateurs' },
]

// Primary CDN for logos. Stable URL pattern → easy to add new brands.
const CL = 'https://www.carlogos.org/car-logos'
// Wikimedia Commons SVGs used as a secondary fallback for the brands
// where I already had a verified URL. Triple-source coverage
// (Wikimedia + Clearbit) maximises the chance a real logo loads
// before BrandLogo gives up and shows the wordmark fallback.
const WM = 'https://upload.wikimedia.org/wikipedia'

// Hard-coded wordmark SVGs used as the PRIMARY source for marques
// where every external image we tried 404s or renders broken. Encoded
// as data URLs so they slot into the same `logos[]` array as remote
// URLs and go through the exact same <img> pipeline (object-fit,
// filter, fallback chain).
const SHELBY_SVG = '<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="60%" text-anchor="middle" font-family="serif" font-size="52" font-weight="bold" fill="white" letter-spacing="4">SHELBY</text></svg>'
const ROLLS_SVG = '<svg viewBox="0 0 200 120" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="52%" text-anchor="middle" font-family="serif" font-size="56" font-weight="bold" fill="white">RR</text><text x="50%" y="88%" text-anchor="middle" font-family="serif" font-size="13" fill="white" letter-spacing="3">ROLLS-ROYCE</text></svg>'
const RANGE_ROVER_SVG = '<svg viewBox="0 0 200 80" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="45%" text-anchor="middle" font-family="serif" font-size="22" fill="white" letter-spacing="3">RANGE</text><text x="50%" y="75%" text-anchor="middle" font-family="serif" font-size="22" fill="white" letter-spacing="3">ROVER</text></svg>'
const ABT_SVG = '<svg viewBox="0 0 120 60" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="70%" text-anchor="middle" font-family="sans-serif" font-size="42" font-weight="900" fill="white" letter-spacing="2">ABT</text></svg>'
const CUPRA_SVG = '<svg viewBox="0 0 160 60" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="70%" text-anchor="middle" font-family="sans-serif" font-size="36" font-weight="bold" fill="#c8932a" letter-spacing="6">CUPRA</text></svg>'

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// Generic wordmark fallback rendered when every URL in `logoCandidates`
// (incl. Clearbit) has 404'd. The brand's full name is centered in a
// 200×80 viewBox; SVG scaling handles long names gracefully.
export function wordmarkDataUrl(name: string): string {
  const safe = name.toUpperCase().replace(/[<>&]/g, '')
  const svg = `<svg viewBox="0 0 220 80" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="60%" text-anchor="middle" font-family="sans-serif" font-size="${
    safe.length > 8 ? 22 : 30
  }" font-weight="900" fill="white" letter-spacing="3">${safe}</text></svg>`
  return svgDataUrl(svg)
}

export const BRANDS: Brand[] = [
  // Hypercars — ultra-low-volume marques
  { slug: 'bugatti',      name: 'Bugatti',       category: 'hypercars', type: 'brand', domain: 'bugatti.com',         color: '#002F6C', match: ['bugatti'],
    logos: [`${CL}/bugatti-logo.png`], cardBg: '#1a1a4e' },
  { slug: 'pagani',       name: 'Pagani',        category: 'hypercars', type: 'brand', domain: 'pagani.com',          color: '#1D4E8A', match: ['pagani'],
    logos: [`${CL}/pagani-logo.png`] },
  { slug: 'koenigsegg',   name: 'Koenigsegg',    category: 'hypercars', type: 'brand', domain: 'koenigsegg.com',      color: '#1A2A44', match: ['koenigsegg'],
    logos: [`${CL}/koenigsegg-logo.png`], logoScale: 1.3 },
  { slug: 'rimac',        name: 'Rimac',         category: 'hypercars', type: 'brand', domain: 'rimac-automobili.com',color: '#E60000', match: ['rimac'],
    logos: [`${CL}/rimac-logo.png`] },

  // Supercars & Prestige
  { slug: 'ferrari',      name: 'Ferrari',       category: 'supercars', type: 'brand', domain: 'ferrari.com',         color: '#DC0000', match: ['ferrari'],
    logos: [`${CL}/ferrari-logo.png`] },
  { slug: 'lamborghini',  name: 'Lamborghini',   category: 'supercars', type: 'brand', domain: 'lamborghini.com',     color: '#B8860B', match: ['lamborghini', 'lambo'],
    logos: [`${CL}/lamborghini-logo.png`] },
  { slug: 'mclaren',      name: 'McLaren',       category: 'supercars', type: 'brand', domain: 'mclaren.com',         color: '#FF8000', match: ['mclaren'],
    logos: [`${CL}/mclaren-logo.png`], cardBg: '#2a2a2a', logoScale: 1.3 },
  { slug: 'aston-martin', name: 'Aston Martin',  category: 'supercars', type: 'brand', domain: 'astonmartin.com',     color: '#007054', match: ['aston'],
    logos: [`${CL}/aston-martin-logo.png`] },
  { slug: 'porsche',      name: 'Porsche',       category: 'supercars', type: 'brand', domain: 'porsche.com',         color: '#D5A019', match: ['porsche'],
    logos: [`${CL}/porsche-logo.png`] },
  { slug: 'lotus',        name: 'Lotus',         category: 'supercars', type: 'brand', domain: 'lotuscars.com',       color: '#006633', match: ['lotus'],
    logos: [`${CL}/lotus-logo.png`] },
  { slug: 'maserati',     name: 'Maserati',      category: 'supercars',   type: 'brand', domain: 'maserati.com',        color: '#003B6F', match: ['maserati'],
    logos: [`${CL}/maserati-logo.png`], cardBg: '#0d1b2a' },
  { slug: 'bentley',      name: 'Bentley',       category: 'supercars',   type: 'brand', domain: 'bentleymotors.com',   color: '#003E25', match: ['bentley'],
    logos: [`${CL}/bentley-logo.png`], cardBg: '#2a2a2a', logoScale: 1.2, logoFilter: 'brightness(1.5)' },
  { slug: 'rolls-royce',  name: 'Rolls-Royce',   category: 'supercars',   type: 'brand', domain: 'rolls-roycemotorcars.com', color: '#4B0E1A', match: ['rolls'],
    logos: [svgDataUrl(ROLLS_SVG)], cardBg: '#1e1e1e', cardBorder: '#A4895F66' },
  { slug: 'range-rover',  name: 'Range Rover',   category: 'supercars',   type: 'brand', domain: 'landrover.com',       color: '#00563F', match: ['range rover', 'land rover'],
    logos: [svgDataUrl(RANGE_ROVER_SVG)], cardBg: '#1a3a1a' },

  // Premium Allemand — the major German trio, isolated
  { slug: 'mercedes-benz',name: 'Mercedes-Benz', category: 'premium',   type: 'brand', domain: 'mercedes-benz.com',   color: '#007681', match: ['mercedes', 'merc', 'amg'],
    logos: [`${WM}/commons/9/90/Mercedes-Logo.svg`] },
  { slug: 'bmw',          name: 'BMW',           category: 'premium',   type: 'brand', domain: 'bmw.com',             color: '#1C69D4', match: ['bmw'],
    logos: [`${WM}/commons/4/44/BMW.svg`] },
  { slug: 'audi',         name: 'Audi',          category: 'premium',   type: 'brand', domain: 'audi.com',            color: '#BB0A30', match: ['audi'],
    logos: [`${WM}/commons/9/92/Audi-Logo_2016.svg`] },

  // Sport & GT
  { slug: 'alpine',       name: 'Alpine',        category: 'sport',     type: 'brand', domain: 'alpinecars.com',      color: '#0E7CFF', match: ['alpine'],
    logos: [`${CL}/alpine-logo.png`, `${WM}/commons/4/41/Alpine_logo.svg`] },
  { slug: 'cupra',        name: 'Cupra',         category: 'sport',     type: 'brand', domain: 'cupraofficial.com',   color: '#B68666', match: ['cupra'],
    logos: [svgDataUrl(CUPRA_SVG)], cardBg: '#0d0d0d' },
  { slug: 'hyundai-n',    name: 'Hyundai N',     category: 'sport',     type: 'brand', domain: 'hyundai.com',         color: '#002C5F', match: ['hyundai'],
    logos: [`${CL}/hyundai-logo.png`, `${WM}/commons/5/5c/Hyundai_Motor_Company_logo.svg`], invertOnDark: true },
  { slug: 'lexus',        name: 'Lexus',         category: 'sport',   type: 'brand', domain: 'lexus.com',           color: '#1A1A1A', match: ['lexus'],
    logos: [`${CL}/lexus-logo.png`], invertOnDark: true },
  { slug: 'alfa-romeo',   name: 'Alfa Romeo',    category: 'sport',   type: 'brand', domain: 'alfaromeo.com',       color: '#B71234', match: ['alfa'],
    logos: [`${CL}/alfa-romeo-logo.png`] },

  // JDM
  { slug: 'toyota',       name: 'Toyota',        category: 'jdm',       type: 'brand', domain: 'toyota.com',          color: '#EB0A1E', match: ['toyota'],
    logos: [`${CL}/toyota-logo.png`, `${WM}/commons/9/9d/Toyota_carlogo.svg`] },
  { slug: 'nissan',       name: 'Nissan',        category: 'jdm',       type: 'brand', domain: 'nissan.com',          color: '#C3002F', match: ['nissan'],
    logos: [`${CL}/nissan-logo.png`], invertOnDark: true },
  { slug: 'honda',        name: 'Honda',         category: 'jdm',       type: 'brand', domain: 'honda.com',           color: '#CC0000', match: ['honda'],
    logos: [`${CL}/honda-logo.png`, `${WM}/commons/7/7b/Honda_Logo.svg`] },
  { slug: 'subaru',       name: 'Subaru',        category: 'jdm',       type: 'brand', domain: 'subaru.com',          color: '#00417C', match: ['subaru'],
    logos: [`${CL}/subaru-logo.png`] },
  { slug: 'mazda',        name: 'Mazda',         category: 'jdm',       type: 'brand', domain: 'mazda.com',           color: '#101820', match: ['mazda'],
    logos: [`${CL}/mazda-logo.png`], invertOnDark: true },
  { slug: 'mitsubishi',   name: 'Mitsubishi',    category: 'jdm',       type: 'brand', domain: 'mitsubishi-motors.com',color:'#ED1C24', match: ['mitsubishi'],
    logos: [`${CL}/mitsubishi-logo.png`] },

  // Américaines
  { slug: 'chevrolet',    name: 'Chevrolet',     category: 'american',  type: 'brand', domain: 'chevrolet.com',       color: '#FCB424', match: ['chevrolet', 'chevy', 'corvette'],
    logos: [`${CL}/chevrolet-logo.png`, `${WM}/commons/1/14/Chevrolet_logo.svg`] },
  { slug: 'dodge',        name: 'Dodge',         category: 'american',  type: 'brand', domain: 'dodge.com',           color: '#D22630', match: ['dodge'],
    logos: [`${CL}/dodge-logo.png`, `${WM}/commons/a/a5/Dodge_logo.svg`], invertOnDark: true },
  { slug: 'ford',         name: 'Ford',          category: 'american',  type: 'brand', domain: 'ford.com',            color: '#003478', match: ['ford'],
    logos: [`${CL}/ford-logo.png`, `${WM}/commons/3/3e/Ford_logo_flat.svg`] },
  { slug: 'shelby',       name: 'Shelby',        category: 'american',  type: 'brand', domain: 'shelby.com',          color: '#003478', match: ['shelby'],
    logos: [svgDataUrl(SHELBY_SVG)], cardBg: '#0a1628' },

  // Préparateurs
  { slug: 'brabus',       name: 'Brabus',        category: 'tuners',    type: 'tuner', domain: 'brabus.com',          color: '#000000', match: ['brabus'],
    logos: [`${CL}/brabus-logo.png`], invertOnDark: true },
  { slug: 'mansory',      name: 'Mansory',       category: 'tuners',    type: 'tuner', domain: 'mansory.com',         color: '#C9A557', match: ['mansory'],
    logos: [`${CL}/mansory-logo.png`], invertOnDark: true },
  { slug: 'ruf',          name: 'RUF',           category: 'tuners',    type: 'tuner', domain: 'ruf-automobile.de',   color: '#00963A', match: ['ruf'],
    logos: [`${CL}/ruf-logo.png`], invertOnDark: true },
  { slug: 'abt',          name: 'ABT',           category: 'tuners',    type: 'tuner', domain: 'abt-sportsline.com',  color: '#222222', match: ['abt'],
    logos: [svgDataUrl(ABT_SVG)], cardBg: '#252525' },
]

const BY_SLUG = new Map(BRANDS.map((b) => [b.slug, b]))

export function getBrand(slug: string | undefined): Brand | undefined {
  return slug ? BY_SLUG.get(slug) : undefined
}

// Map a free-text spot brand to one of our catalog slugs, or null if no
// match. Used both to filter spots on a brand page and to detect which
// brand badge a user is closing in on.
export function brandSlugFor(raw: string | null | undefined): string | null {
  if (!raw) return null
  const needle = raw.toLowerCase().trim()
  if (!needle) return null
  for (const b of BRANDS) {
    for (const m of b.match) {
      if (needle.includes(m)) return b.slug
    }
  }
  return null
}

// Ordered list of logo URLs to try for a brand. Generic Clearbit lookup
// is always appended as the last network attempt — if every URL 404s,
// BrandLogo paints the monogram.
export function logoCandidates(b: Brand): string[] {
  return [...(b.logos ?? []), `https://logo.clearbit.com/${b.domain}`]
}

// Human-readable category label for a brand. Used in the detail page
// header badge. Tuner overrides take precedence over the bucket.
// Matches the labels in BRAND_CATEGORIES so the grid section title and
// the badge stay consistent.
export function brandTagline(b: Brand): string {
  if (b.type === 'tuner') return 'Préparateur'
  switch (b.category) {
    case 'hypercars':
      return 'Hypercar'
    case 'supercars':
      return 'Supercar & Prestige'
    case 'premium':
      return 'Premium Allemand'
    case 'sport':
      return 'Sport & GT'
    case 'jdm':
      return 'JDM'
    case 'american':
      return 'Marque américaine'
    case 'tuners':
      return 'Préparateur'
  }
}

export function brandsByCategory(): Record<BrandCategory, Brand[]> {
  const out = {} as Record<BrandCategory, Brand[]>
  for (const c of BRAND_CATEGORIES) out[c.key] = []
  for (const b of BRANDS) out[b.category].push(b)
  return out
}
