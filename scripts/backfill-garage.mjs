// One-shot backfill: regenerate garage_image_url for every spot using
// the CarImages API (carimagesapi.com). Idempotent — re-running it
// overwrites whatever was there before.
//
//   node scripts/backfill-garage.mjs           # all spots
//   node scripts/backfill-garage.mjs --missing # only spots without a URL
//   node scripts/backfill-garage.mjs --limit 20
//
// Reads VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
// CARIMAGES_API_KEY (+ optional CARIMAGES_API_SECRET) from .env.local
// without sourcing it. The service-role key bypasses RLS so we can
// update arbitrary rows; api_secret opts into server-side mode that
// skips the domain whitelist.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

// ─────────────────────── Env parsing ───────────────────────
function readEnvText(path) {
  try {
    return readFileSync(path, 'utf8').replace(/\\n/g, '\n')
  } catch {
    return ''
  }
}
function pick(txt, name, valueRe) {
  const re = new RegExp(`${name}\\s*=\\s*['"]?\\s*(${valueRe})`, 'g')
  let best = ''
  for (const m of txt.matchAll(re)) if (m[1].length > best.length) best = m[1]
  return best
}

const envText = readEnvText(new URL('../.env.local', import.meta.url))
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  pick(envText, 'VITE_SUPABASE_URL', 'https://[^\\s\'"]+')
const SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  pick(envText, 'SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+')
const CARIMAGES_API_KEY =
  process.env.CARIMAGES_API_KEY ||
  pick(envText, 'CARIMAGES_API_KEY', '[A-Za-z0-9_-]+')
const CARIMAGES_API_SECRET =
  process.env.CARIMAGES_API_SECRET ||
  pick(envText, 'CARIMAGES_API_SECRET', '[A-Za-z0-9_-]+')
const ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY ||
  pick(envText, 'ANTHROPIC_API_KEY', '[A-Za-z0-9_\\-.]+')

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing one of: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
  console.error('  url        :', SUPABASE_URL ? 'ok' : 'MISSING')
  console.error('  serviceK   :', SERVICE_ROLE ? 'ok' : 'MISSING')
  process.exit(1)
}
if (!CARIMAGES_API_KEY && !ANTHROPIC_API_KEY) {
  console.error('Need at least one of CARIMAGES_API_KEY or ANTHROPIC_API_KEY.')
  console.error('  carimagesK :', CARIMAGES_API_KEY ? 'ok' : 'MISSING')
  console.error('  anthropic  :', ANTHROPIC_API_KEY ? 'ok (fallback active)' : 'MISSING')
  process.exit(1)
}
console.log('Backfill setup:')
console.log('  carimages  :', CARIMAGES_API_KEY ? 'enabled' : 'disabled')
console.log('  anthropic  :', ANTHROPIC_API_KEY ? 'fallback enabled' : 'fallback disabled')

const args = process.argv.slice(2)
const onlyMissing = args.includes('--missing')
const limitIdx = args.indexOf('--limit')
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1] ?? '0', 10) : null

// ─────────────────────── CarImages call ───────────────────────
async function signedUrl({ make, model, year }) {
  const qs = new URLSearchParams()
  qs.set('api_key', CARIMAGES_API_KEY)
  if (CARIMAGES_API_SECRET) qs.set('api_secret', CARIMAGES_API_SECRET)
  qs.set('make', make)
  if (model) qs.set('model', model)
  if (year) qs.set('year', String(year))
  qs.set('format', 'png')
  qs.set('width', '600')
  try {
    const r = await fetch(`https://carimagesapi.com/api/v1/signed-url?${qs}`, {
      headers: { Accept: 'application/json' },
    })
    if (!r.ok) return null
    const data = await r.json()
    return typeof data?.url === 'string' && data.url.startsWith('http')
      ? data.url
      : null
  } catch {
    return null
  }
}

const anthropic = ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: ANTHROPIC_API_KEY })
  : null

// Validate an image URL. We can't rely on HEAD alone — many press
// CDNs return 405/403 to bare HEAD requests. So we do a GET with a
// Range header (downloads ~1 KB), a realistic User-Agent, and only
// require the content-type to start with image/. This still catches
// 404s, HTML redirects, and non-image payloads while accepting most
// real photos including Wikipedia / Wikimedia / manufacturer CDNs.
async function validateImageUrl(url) {
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-1023',
        'User-Agent':
          'Mozilla/5.0 (compatible; REVS-bot/1.0; +https://revs-ten.vercel.app)',
        Accept: 'image/*,*/*;q=0.8',
      },
      redirect: 'follow',
    })
    if (!r.ok && r.status !== 206) return false
    const ct = (r.headers.get('content-type') ?? '').toLowerCase()
    return ct.startsWith('image/')
  } catch {
    return false
  }
}

// Claude + web_search fallback. Returns a validated image URL or
// null. Skipped when ANTHROPIC_API_KEY is unset.
async function claudePressPhoto(brand, model, year) {
  if (!anthropic) return null
  const yearPart = year ? ` ${year}` : ''
  try {
    const r = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 240,
      system: [
        {
          type: 'text',
          text:
            "Tu reçois le modèle d'une voiture. Utilise web_search pour " +
            "trouver UNE photo officielle pointant directement vers le " +
            'fichier image (HTTPS). Préfère TOUJOURS upload.wikimedia.org ' +
            '(Wikipedia Commons) — leur CDN est stable et ne bloque pas ' +
            'les requêtes. Évite Pinterest, Getty, Shutterstock, Stock, ' +
            'Alamy. Réponds UNIQUEMENT par l\'URL, sans aucun autre ' +
            "texte, sans markdown, sans ponctuation finale.",
        },
      ],
      messages: [{ role: 'user', content: `${brand} ${model}${yearPart}` }],
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    })
    const last = r.content.filter((b) => b.type === 'text').pop()
    const text = (last?.text ?? '').trim()
    // Accept any HTTPS URL — extension filtering caused too many
    // false negatives on URLs with query strings.
    const m = text.match(/https?:\/\/[^\s)"'<>]+/i)
    if (!m) {
      console.warn(`    [no url in response]`, text.slice(0, 120))
      return null
    }
    const candidate = m[0].replace(/[.,;:]+$/, '') // strip trailing punctuation
    const ok = await validateImageUrl(candidate)
    if (!ok) {
      console.warn(`    [validation failed]`, candidate.slice(0, 120))
      return null
    }
    return candidate
  } catch (e) {
    console.warn('  claude fallback failed:', e?.message ?? e)
    return null
  }
}

const WIKI_UA =
  'REVS-bot/1.0 (https://revs-ten.vercel.app; tool@revs-ten.vercel.app)'

// Resolves a real Wikipedia thumbnail URL for the given query. Goes
// through the MediaWiki API so URLs are guaranteed to exist (no LLM
// hallucination). Two steps:
//   1) opensearch — find the matching article title.
//   2) pageimages — fetch its primary thumbnail.
async function wikipediaImage(query) {
  try {
    const searchRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&namespace=0&format=json`,
      { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } },
    )
    if (!searchRes.ok) return null
    const searchData = await searchRes.json()
    const title = searchData?.[1]?.[0]
    if (!title) return null
    const imgRes = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&titles=${encodeURIComponent(title)}&format=json&pithumbsize=800`,
      { headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' } },
    )
    if (!imgRes.ok) return null
    const imgData = await imgRes.json()
    const pages = imgData?.query?.pages ?? {}
    const page = Object.values(pages)[0]
    const thumb = page?.thumbnail?.source
    return typeof thumb === 'string' && thumb.startsWith('http')
      ? thumb
      : null
  } catch {
    return null
  }
}

async function findImageFor(brand, model, year) {
  // 1) CarImages first when available — gives transparent-bg PNGs.
  if (CARIMAGES_API_KEY) {
    const tries = [
      { make: brand, model, year },
      { make: brand, model },
      { make: brand },
    ]
    for (const t of tries) {
      if (!t.make) continue
      const url = await signedUrl(t)
      if (url) return url
    }
  }
  // 2) Wikipedia MediaWiki API — real URLs, ladder from most specific
  // to least. Doesn't burn Anthropic tokens.
  if (brand) {
    const queries = [
      `${brand} ${model} ${year ?? ''}`.trim(),
      `${brand} ${model}`.trim(),
      brand,
    ]
    for (const q of queries) {
      const url = await wikipediaImage(q)
      if (url && (await validateImageUrl(url))) return url
    }
  }
  // 3) Claude press photo last resort — hallucinates URLs sometimes
  // but worth a try for obscure cars where Wikipedia has no thumb.
  if (brand && anthropic) {
    const url = await claudePressPhoto(brand, model, year)
    if (url) return url
  }
  return ''
}

// ─────────────────────── Main loop ───────────────────────
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
})

let query = admin
  .from('spots')
  .select('id, brand, model, year, garage_image_url')
  .order('created_at', { ascending: false })
if (onlyMissing) {
  query = query.or('garage_image_url.is.null,garage_image_url.eq.')
}
if (limit && Number.isFinite(limit) && limit > 0) {
  query = query.limit(limit)
}

const { data: spots, error } = await query
if (error) {
  console.error('select failed:', error.message)
  process.exit(2)
}
console.log(
  `Processing ${spots.length} spot(s) — only-missing=${onlyMissing} limit=${limit ?? 'none'}`,
)

let ok = 0
let empty = 0
// Anthropic Tier-2 allows 30 000 input tokens / minute. Each
// web_search-enabled call expands to ~10-15 k tokens once the search
// results are fed back in. BATCH=2 keeps the concurrent token cost
// well under the cap, and the PAUSE_MS between batches makes sure the
// 1-minute window has fully cleared before we open the next two calls.
const BATCH = 2
const PAUSE_MS = 35000
for (let i = 0; i < spots.length; i += BATCH) {
  if (i > 0) {
    await new Promise((r) => setTimeout(r, PAUSE_MS))
  }
  const batch = spots.slice(i, i + BATCH)
  await Promise.all(
    batch.map(async (s) => {
      const url = await findImageFor(s.brand, s.model, s.year)
      const { error: upErr } = await admin
        .from('spots')
        .update({ garage_image_url: url })
        .eq('id', s.id)
      if (upErr) {
        console.error(`  ! update failed for ${s.id}:`, upErr.message)
        return
      }
      if (url) {
        ok += 1
        console.log(`  ✓ ${s.brand} ${s.model} → ${url.slice(0, 80)}…`)
      } else {
        empty += 1
        console.log(`  · ${s.brand} ${s.model} → no image found (marked '')`)
      }
    }),
  )
}

console.log(`\nDone. ok=${ok} empty=${empty} of ${spots.length}`)
process.exit(0)
