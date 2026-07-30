import { ImageResponse } from '@vercel/og'
import { createClient } from '@supabase/supabase-js'
import React from 'react'

// Styled 1200×630 Open Graph image for a collector card, rendered server-side
// (Satori/@vercel/og) so link previews show the card — not just the raw photo.
// EDGE runtime (doesn't count against the Hobby 12-serverless cap). On ANY
// failure (font fetch, render) it redirects to the car photo so og:image is
// never broken.

export const config = { runtime: 'edge' }
declare const process: { env: Record<string, string | undefined> }

const APP_ORIGIN = 'https://revs-ten.vercel.app'
const RARITY_LABELS: Record<string, string> = {
  standard: 'Commun',
  premium: 'Peu commun',
  performance: 'Rare',
  exclusif: 'Épique',
  supercar: 'Ultra Rare',
  hypercar: 'Légendaire',
}
const RARITY_COLOR: Record<string, string> = {
  standard: '#8a8d92',
  premium: '#3fa588',
  performance: '#6ba4ee',
  exclusif: '#E0A845',
  supercar: '#b06be6',
  hypercar: '#FFD700',
}
const HOLO = 'linear-gradient(115deg, #ff0096, #00e1ff 22%, #b45aff 44%, #ffe646 66%, #ff0096 90%)'

// ── Card-key + level helpers (mirror of src/lib/colorKey.ts + SQL card_norm /
// card_level_for). Inlined because edge functions don't share the Vite bundle. ──
const cardNorm = (s: string | null | undefined) =>
  (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ')
const COLOR_MAP: [string, string[]][] = [
  ['noir', ['noir', 'noire', 'noirs', 'black', 'nero', 'nera']],
  ['blanc', ['blanc', 'blanche', 'white', 'bianco', 'bianca', 'weiss']],
  ['gris', ['gris', 'grise', 'grey', 'gray', 'grigio', 'argent', 'argente', 'silver', 'anthracite', 'graphite', 'gunmetal']],
  ['rouge', ['rouge', 'red', 'rosso', 'rossa', 'rot']],
  ['bleu', ['bleu', 'bleue', 'blue', 'blu', 'azzurro', 'azur']],
  ['vert', ['vert', 'verte', 'green', 'verde']],
  ['jaune', ['jaune', 'yellow', 'giallo', 'gelb']],
  ['orange', ['orange', 'arancio', 'arancione', 'papaya']],
  ['violet', ['violet', 'violette', 'purple', 'viola', 'mauve', 'lila']],
  ['marron', ['marron', 'brun', 'brune', 'brown', 'marrone']],
  ['beige', ['beige', 'sable', 'tan', 'creme', 'cream']],
  ['or', ['or', 'dore', 'doree', 'gold', 'golden', 'oro']],
  ['rose', ['rose', 'pink', 'rosa']],
  ['bronze', ['bronze', 'cuivre', 'copper']],
]
const W2B = new Map<string, string>()
for (const [b, ss] of COLOR_MAP) for (const s of ss) if (!W2B.has(s)) W2B.set(s, b)
function colorKey(input: string | null | undefined): string {
  const words = (input ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z]+/)
    .filter(Boolean)
  for (const w of words) {
    const b = W2B.get(w)
    if (b) return b
  }
  return 'autre'
}
const BADGE_NAME: Record<number, string> = { 2: 'Chasseur', 3: 'Traqueur', 4: 'Obsédé', 5: 'Légende' }

let fontCache: ArrayBuffer | null = null
async function getFont(): Promise<ArrayBuffer> {
  if (fontCache) return fontCache
  const res = await fetch('https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.17/files/inter-latin-800-normal.woff')
  if (!res.ok) throw new Error('font ' + res.status)
  fontCache = await res.arrayBuffer()
  return fontCache
}

const h = React.createElement

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const id = (url.searchParams.get('id') || '').trim()

  let spot: { user_id?: string; brand?: string; model?: string; year?: number | null; rarity?: string | null; photo_url?: string | null; color?: string | null } | null =
    null
  let level = 1
  let count = 1
  try {
    const sbUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (sbUrl && sbKey && /^[0-9a-f-]{10,}$/i.test(id)) {
      const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } })
      const { data } = await sb.from('spots').select('user_id,brand,model,year,rarity,photo_url,color').eq('id', id).maybeSingle()
      spot = (data as typeof spot) ?? null
      // The spot owner's card level for this (brand, model, base colour).
      if (spot?.user_id && spot.brand && spot.model) {
        const { data: cp } = await sb
          .from('card_progress')
          .select('level,valid_count')
          .eq('user_id', spot.user_id)
          .eq('brand_key', cardNorm(spot.brand))
          .eq('model_key', cardNorm(spot.model))
          .eq('color_key', colorKey(spot.color))
          .maybeSingle()
        if (cp) {
          level = (cp as { level?: number }).level ?? 1
          count = (cp as { valid_count?: number }).valid_count ?? 1
        }
      }
    }
  } catch {
    /* ignore — handled by fallback below */
  }

  const photo = spot?.photo_url || ''

  try {
    const font = await getFont()
    const brand = spot?.brand || ''
    const model = spot?.model || 'REVS'
    const year = spot?.year || ''
    const rarity = (spot?.rarity as string) || 'standard'
    const rlabel = RARITY_LABELS[rarity] || 'CARTE'
    const accent = RARITY_COLOR[rarity] || '#E8203A'
    const holo = rarity === 'supercar' || rarity === 'hypercar'
    const fullName = [brand, model].filter(Boolean).join(' ') || 'REVS'
    // Cap absurdly long names and scale the headline so it never overflows.
    const carName = fullName.length > 42 ? `${fullName.slice(0, 41).trimEnd()}…` : fullName
    const nameSize = carName.length > 30 ? 38 : carName.length > 22 ? 44 : 50

    // ── portrait card ──
    // Build the border fill without any `undefined` style keys — Satori calls
    // .trim() on style values and crashes on undefined.
    const cardBorder = holo ? { backgroundImage: HOLO } : { background: accent }
    const card = h(
      'div',
      { style: { display: 'flex', width: 400, height: 560, borderRadius: 26, padding: 8, ...cardBorder } },
      h(
        'div',
        { style: { display: 'flex', position: 'relative', width: 384, height: 544, borderRadius: 20, overflow: 'hidden', background: '#0e0e11' } },
        [
          photo ? h('img', { key: 'p', src: photo, width: 384, height: 544, style: { position: 'absolute', top: 0, left: 0, width: 384, height: 544, objectFit: 'cover' } }) : null,
          h('div', { key: 's', style: { position: 'absolute', top: 0, left: 0, width: 384, height: 544, display: 'flex', backgroundImage: 'linear-gradient(to top, rgba(5,5,7,0.97), rgba(5,5,7,0.25) 42%, rgba(5,5,7,0) 62%)' } }),
          h('div', { key: 'c', style: { position: 'absolute', top: 16, left: 16, display: 'flex', padding: '7px 14px', borderRadius: 10, fontSize: 20, fontWeight: 800, color: holo ? '#0a0a0a' : '#0a0a0a', background: accent } }, rlabel.toUpperCase()),
          h(
            'div',
            { key: 'm', style: { position: 'absolute', left: 20, right: 20, bottom: 20, display: 'flex', flexDirection: 'column' } },
            [
              brand ? h('div', { key: 'b', style: { display: 'flex', fontSize: 18, fontWeight: 800, color: 'rgba(255,255,255,0.78)', letterSpacing: 1 } }, `${brand.toUpperCase()}${year ? ` · ${year}` : ''}`) : null,
              h('div', { key: 'n', style: { display: 'flex', fontSize: 34, fontWeight: 800, color: '#fff', marginTop: 2 } }, model),
            ],
          ),
        ],
      ),
    )

    // ── evolution badge (mastery + spot count), Satori-safe styles ──
    const badgeName = BADGE_NAME[level] || ''
    const badgeBg =
      level >= 5
        ? { backgroundImage: 'linear-gradient(120deg,#E0B341,#FFD700 45%,#E8203A)' }
        : { background: level >= 4 ? '#c98bf0' : level >= 3 ? '#7fd0ff' : '#c9d8ef' }
    const badgeFg = level >= 5 ? '#1a1306' : level >= 4 ? '#1a0a26' : '#0c0c0f'
    const evoLine =
      badgeName || count > 1
        ? h('div', { key: 'evo', style: { display: 'flex', marginTop: 18, alignItems: 'center' } }, [
            badgeName
              ? h('div', { key: 'bg', style: { display: 'flex', padding: '8px 16px', borderRadius: 10, fontSize: 22, fontWeight: 800, color: badgeFg, ...badgeBg } }, `NV${level} · ${badgeName.toUpperCase()}`)
              : null,
            count > 1
              ? h('div', { key: 'ct', style: { display: 'flex', marginLeft: badgeName ? 14 : 0, fontSize: 22, fontWeight: 800, color: 'rgba(255,255,255,0.82)' } }, `SPOTTÉ ×${count}`)
              : null,
          ])
        : null

    // ── right column ──
    const right = h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', width: 604, height: 560, justifyContent: 'center', overflow: 'hidden' } },
      [
        h('div', { key: 'logo', style: { display: 'flex', fontSize: 52, fontWeight: 800, letterSpacing: -1 } }, [
          h('span', { key: 'r', style: { color: '#E8203A' } }, 'R'),
          h('span', { key: 'e', style: { color: '#fff' } }, 'EVS'),
        ]),
        h('div', { key: 'rar', style: { display: 'flex', marginTop: 26, fontSize: 24, fontWeight: 800, color: accent, letterSpacing: 2 } }, rlabel.toUpperCase()),
        h('div', { key: 'name', style: { display: 'flex', width: 600, marginTop: 8, fontSize: nameSize, fontWeight: 800, color: '#fff', lineHeight: 1.05 } }, carName),
        evoLine,
        h('div', { key: 'tag', style: { display: 'flex', width: 600, marginTop: 30, fontSize: 30, fontWeight: 800, color: 'rgba(255,255,255,0.92)' } }, 'Spotte. Collectionne. Deviens n°1.'),
        h('div', { key: 'pill', style: { display: 'flex', marginTop: 26, padding: '12px 22px', borderRadius: 999, background: '#fff', color: '#0a0a0a', fontSize: 24, fontWeight: 800, alignSelf: 'flex-start' } }, 'revs-ten.vercel.app'),
      ],
    )

    const tree = h(
      'div',
      { style: { display: 'flex', width: '100%', height: '100%', padding: 70, alignItems: 'center', background: '#0a0a0a', backgroundImage: 'linear-gradient(120deg, rgba(232,32,58,0.16), rgba(10,10,10,0) 46%)' } },
      [card, h('div', { key: 'gap', style: { display: 'flex', width: 56 } }), right],
    )

    // Buffer the render INSIDE the try so a Satori error becomes a clean 302
    // fallback (not a 0-byte 200 that breaks the preview).
    const image = new ImageResponse(tree, {
      width: 1200,
      height: 630,
      fonts: [{ name: 'Inter', data: font, weight: 800, style: 'normal' }],
    })
    const buf = await image.arrayBuffer()
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800',
      },
    })
  } catch (e) {
    // Never leave og:image broken → fall back to the car photo. Surface the
    // render error in a header for debugging (harmless to crawlers).
    return new Response(null, {
      status: 302,
      headers: {
        Location: photo || `${APP_ORIGIN}/favicon.svg`,
        'x-og-error': String((e as Error)?.message || e).slice(0, 300),
      },
    })
  }
}
