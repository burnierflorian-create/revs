// One-shot Wikipedia-API backfill for the F1 calendar's circuit
// images. Resolves real upload.wikimedia.org thumbnail URLs (no LLM
// hallucination) and stores them in public.f1_circuit_images.
//
//   node scripts/backfill-circuit-images.mjs
//
// Needs VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local.
// Cost: ~48 anon GETs on en.wikipedia.org/w/api.php — free. Idempotent.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function pick(text, name, valueRe) {
  const re = new RegExp(`${name}\\s*=\\s*['"]?\\s*(${valueRe})`)
  const m = re.exec(text)
  return m ? m[1] : ''
}

const envText = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const SUPA_URL =
  process.env.VITE_SUPABASE_URL || pick(envText, 'VITE_SUPABASE_URL', "https://[^\\s'\"]+")
const SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  pick(envText, 'SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+')
if (!SUPA_URL || !SERVICE_ROLE) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(SUPA_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
})

const WIKI_UA =
  'REVS-bot/1.0 (https://revs-ten.vercel.app; tool@revs-ten.vercel.app)'

// Per-round preferred search queries. Each round tries the most specific
// title first (circuit page) and falls back to broader ones if not found.
// Avoids ambiguous results from `opensearch` against just the GP name.
const QUERIES = {
  1:  ['Melbourne Grand Prix Circuit', 'Albert Park Circuit'],
  2:  ['Shanghai International Circuit'],
  3:  ['Suzuka Circuit', 'Suzuka International Racing Course'],
  4:  ['Bahrain International Circuit'],
  5:  ['Jeddah Corniche Circuit'],
  6:  ['Miami International Autodrome'],
  7:  ['Circuit Gilles Villeneuve'],
  8:  ['Circuit de Monaco'],
  9:  ['Circuit de Barcelona-Catalunya'],
  10: ['Red Bull Ring'],
  11: ['Silverstone Circuit'],
  12: ['Circuit de Spa-Francorchamps'],
  13: ['Hungaroring'],
  14: ['Circuit Zandvoort'],
  15: ['Monza Circuit', 'Autodromo Nazionale di Monza', 'Autodromo Nazionale Monza'],
  16: ['Madring', 'Circuit Madrid'],
  17: ['Baku City Circuit'],
  18: ['Marina Bay Street Circuit'],
  19: ['Circuit of the Americas'],
  20: ['Autódromo Hermanos Rodríguez'],
  21: ['Interlagos', 'Autódromo José Carlos Pace'],
  22: ['Las Vegas Strip Circuit'],
  23: ['Lusail International Circuit', 'Losail International Circuit'],
  24: ['Yas Marina Circuit', 'Yas Island', 'Yas Marina'],
}

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
      `https://en.wikipedia.org/w/api.php?action=query&prop=pageimages&titles=${encodeURIComponent(title)}&format=json&pithumbsize=1200`,
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
  } catch (e) {
    console.warn('  wiki fetch error:', e?.message ?? e)
    return null
  }
}

// HEAD-validate a URL — rejects 404, redirects to HTML, and CDN
// configs that bizarrely return non-image content-type.
async function validateImageUrl(url) {
  try {
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        Range: 'bytes=0-1023',
        'User-Agent': WIKI_UA,
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

let ok = 0
let skipped = 0
let failed = 0

for (const [roundStr, candidates] of Object.entries(QUERIES)) {
  const round = parseInt(roundStr, 10)
  let chosen = null
  for (const q of candidates) {
    const url = await wikipediaImage(q)
    if (url && (await validateImageUrl(url))) {
      chosen = url
      break
    }
  }
  if (!chosen) {
    console.log(`  ✗ round ${round} (${candidates[0]}) — no image found`)
    failed += 1
    continue
  }
  const { error } = await admin
    .from('f1_circuit_images')
    .upsert(
      { round, url: chosen, generated_at: new Date().toISOString() },
      { onConflict: 'round' },
    )
  if (error) {
    console.error(`  ! round ${round} upsert failed:`, error.message)
    failed += 1
    continue
  }
  ok += 1
  console.log(`  ✓ round ${round} (${candidates[0]}) → ${chosen.slice(0, 80)}…`)
}

console.log(`\nDone. ok=${ok} failed=${failed} skipped=${skipped} of ${Object.keys(QUERIES).length}`)
process.exit(0)
