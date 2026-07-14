import { createClient } from '@supabase/supabase-js'

// Open Graph share page for a collector card. A shared link points here so
// that Messages / WhatsApp / iMessage / Discord / X fetch it, read the OG
// tags, and render a rich, CLICKABLE preview of the spotted car. Humans get a
// short branded landing that then opens the app (carrying ?ref= for referral).
//
// Runs as an EDGE function (runtime: 'edge') so it does NOT count against the
// Hobby plan's 12 serverless-function cap (api/ is already full).
//
// og:image is the car photo (a public, always-renderable URL). The fully
// styled card visual can be wired in later as a dedicated OG image endpoint.

export const config = { runtime: 'edge' }

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

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const parts = url.pathname.split('/').filter(Boolean)
  const id = decodeURIComponent(parts[parts.length - 1] || '')
  const ref = url.searchParams.get('ref') || ''

  let spot: { brand?: string; model?: string; year?: number | null; rarity?: string | null; photo_url?: string | null } | null =
    null
  try {
    const sbUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
    const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (sbUrl && sbKey && id && /^[0-9a-f-]{10,}$/i.test(id)) {
      const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false } })
      const { data } = await sb
        .from('spots')
        .select('brand,model,year,rarity,photo_url')
        .eq('id', id)
        .maybeSingle()
      spot = (data as typeof spot) ?? null
    }
  } catch {
    /* fall through to a generic REVS page */
  }

  const brand = spot?.brand || ''
  const model = spot?.model || ''
  const year = spot?.year || ''
  const rarity = (spot?.rarity as string) || 'standard'
  const rlabel = RARITY_LABELS[rarity] || 'Carte'
  const accent = RARITY_COLOR[rarity] || '#E8203A'
  const carName = [brand, model].filter(Boolean).join(' ') || 'une voiture'
  const photo = spot?.photo_url || ''

  const title = spot ? `J'ai spotté une ${carName} sur REVS` : 'REVS — Spotte, collectionne, deviens n°1'
  const desc = spot
    ? `${rlabel}${year ? ` · ${year}` : ''} · Rejoins REVS et commence ta collection 🏎️`
    : 'Spotte les voitures autour de toi et collectionne-les en cartes.'

  const appUrl = `${APP_ORIGIN}/${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`
  const canonical = `${APP_ORIGIN}/s/${encodeURIComponent(id)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`

  const imageTags = photo
    ? `<meta property="og:image" content="${esc(photo)}">
<meta property="og:image:alt" content="${esc(carName)}">
<meta name="twitter:image" content="${esc(photo)}">`
    : ''

  const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="REVS">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
${imageTags}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="theme-color" content="#0a0a0a">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; background:
      radial-gradient(1000px 600px at 50% -10%, rgba(232,32,58,0.14), transparent 60%), #0a0a0a;
    color:#f4f4f6; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
    display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px 20px; -webkit-font-smoothing:antialiased; }
  .logo { font-weight:900; font-size:26px; letter-spacing:-0.03em; margin-bottom:24px; }
  .logo .r { color:#E8203A; }
  .card { width:min(300px,80vw); aspect-ratio:3/4.2; border-radius:22px; padding:5px;
    background:${esc(accent)}; box-shadow:0 20px 60px rgba(0,0,0,0.6), 0 0 40px ${esc(accent)}55; }
  .inner { position:relative; height:100%; border-radius:18px; overflow:hidden; background:#0e0e11; }
  .inner img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .scrim { position:absolute; inset:0; background:linear-gradient(to top, rgba(5,5,7,0.96) 0%, rgba(5,5,7,0.4) 34%, transparent 60%); }
  .chip { position:absolute; top:12px; left:12px; padding:5px 11px; border-radius:9px; font-size:11px; font-weight:800; letter-spacing:0.06em;
    color:#0a0a0a; background:${esc(accent)}; }
  .meta { position:absolute; left:14px; right:14px; bottom:14px; }
  .brand { font-size:11px; font-weight:800; letter-spacing:0.07em; color:rgba(255,255,255,0.75); }
  .model { font-size:20px; font-weight:800; letter-spacing:-0.02em; margin-top:2px; }
  .cta { margin-top:30px; display:inline-flex; align-items:center; gap:8px; text-decoration:none;
    background:#E8203A; color:#fff; font-weight:800; font-size:16px; padding:15px 30px; border-radius:999px; box-shadow:0 8px 24px rgba(232,32,58,0.45); }
  .hint { margin-top:16px; font-size:13px; color:rgba(255,255,255,0.45); }
</style>
</head>
<body>
  <div class="logo"><span class="r">R</span>EVS</div>
  <div class="card">
    <div class="inner">
      ${photo ? `<img src="${esc(photo)}" alt="${esc(carName)}">` : ''}
      <div class="scrim"></div>
      ${spot ? `<div class="chip">${esc(rlabel.toUpperCase())}</div>` : ''}
      <div class="meta">
        ${brand ? `<div class="brand">${esc(brand.toUpperCase())}${year ? ` · ${esc(year)}` : ''}</div>` : ''}
        <div class="model">${esc(model || 'REVS')}</div>
      </div>
    </div>
  </div>
  <a class="cta" href="${esc(appUrl)}">Ouvrir REVS 🏎️</a>
  <div class="hint">Spotte les voitures autour de toi et collectionne-les.</div>
  <script>
    // Send humans into the app (crawlers ignore JS, so they keep the OG tags).
    setTimeout(function () { window.location.replace(${JSON.stringify(appUrl)}); }, 2400);
  </script>
</body>
</html>`

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400',
    },
  })
}
