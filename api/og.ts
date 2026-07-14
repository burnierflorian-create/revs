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

  let spot: { brand?: string; model?: string; year?: number | null; rarity?: string | null; photo_url?: string | null } | null =
    null
  try {
    const sbUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (sbUrl && sbKey && /^[0-9a-f-]{10,}$/i.test(id)) {
      const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } })
      const { data } = await sb.from('spots').select('brand,model,year,rarity,photo_url').eq('id', id).maybeSingle()
      spot = (data as typeof spot) ?? null
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
    const carName = [brand, model].filter(Boolean).join(' ') || 'REVS'

    // ── portrait card ──
    const card = h(
      'div',
      { style: { display: 'flex', width: 400, height: 560, borderRadius: 26, padding: 8, background: holo ? undefined : accent, backgroundImage: holo ? HOLO : undefined, boxShadow: `0 20px 60px rgba(0,0,0,0.6)` } },
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

    // ── right column ──
    const right = h(
      'div',
      { style: { display: 'flex', flexDirection: 'column', flex: 1, height: 560, justifyContent: 'center' } },
      [
        h('div', { key: 'logo', style: { display: 'flex', fontSize: 52, fontWeight: 800, letterSpacing: -1 } }, [
          h('span', { key: 'r', style: { color: '#E8203A' } }, 'R'),
          h('span', { key: 'e', style: { color: '#fff' } }, 'EVS'),
        ]),
        h('div', { key: 'rar', style: { display: 'flex', marginTop: 26, fontSize: 24, fontWeight: 800, color: accent, letterSpacing: 2 } }, rlabel.toUpperCase()),
        h('div', { key: 'name', style: { display: 'flex', marginTop: 8, fontSize: 46, fontWeight: 800, color: '#fff', lineHeight: 1.05 } }, carName),
        h('div', { key: 'tag', style: { display: 'flex', marginTop: 30, fontSize: 30, fontWeight: 800, color: 'rgba(255,255,255,0.92)' } }, 'Spotte. Collectionne. Deviens n°1.'),
        h('div', { key: 'pill', style: { display: 'flex', marginTop: 26, padding: '12px 22px', borderRadius: 999, background: '#fff', color: '#0a0a0a', fontSize: 24, fontWeight: 800, alignSelf: 'flex-start' } }, 'revs-ten.vercel.app'),
      ],
    )

    const tree = h(
      'div',
      { style: { display: 'flex', width: '100%', height: '100%', padding: 70, gap: 56, alignItems: 'center', background: '#0a0a0a', backgroundImage: 'radial-gradient(900px 500px at 30% -10%, rgba(232,32,58,0.20), rgba(232,32,58,0) 60%)' } },
      [card, right],
    )

    return new ImageResponse(tree, {
      width: 1200,
      height: 630,
      fonts: [{ name: 'Inter', data: font, weight: 800, style: 'normal' }],
      headers: { 'Cache-Control': 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800' },
    })
  } catch {
    // Never leave og:image broken → fall back to the car photo.
    return Response.redirect(photo || `${APP_ORIGIN}/favicon.svg`, 302)
  }
}
