// One-shot privacy migration: blur license plates on EXISTING spot photos.
//
// Naming: the 2026-06-07 directive asked for `blur-existing-plates.ts`, but
// this repo's batch scripts are all `.mjs` so they run with a bare `node`
// (no tsx / ts-node in devDeps). Kept `.mjs` for that reason — same loader
// + service-role pattern as backfill-rarity.mjs.
//
//   node scripts/blur-existing-plates.mjs               # DRY-RUN — detect
//                                                       # plates only (no
//                                                       # blur / upload /
//                                                       # DB write). Caps at
//                                                       # --limit (default 5).
//   node scripts/blur-existing-plates.mjs --apply       # real run, all spots
//   node scripts/blur-existing-plates.mjs --apply --limit 50
//   node scripts/blur-existing-plates.mjs --apply --delay 1200   # throttle ms
//
// Strategy ("garder l'original" — decided 2026-06-07):
//   1. Pull every spot with a photo_url that isn't already anonymised.
//   2. Detect plates with Claude vision (same privacy prompt as
//      api/detect-plate.ts).
//   3. Blur each plate region with sharp (pixelate + gaussian feather).
//   4. Upload the blurred image to a NEW path `blurred/<id>.jpg` in the
//      same `spots` bucket — the ORIGINAL object is left untouched so the
//      run is fully reversible.
//   5. Point spots.photo_url at the new public URL.
//   6. Idempotent: skips spots whose photo_url already lives under
//      `/blurred/`, and records processed ids in scripts/.blur-progress.json
//      so an interrupted run resumes cleanly.
//
// Reads VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY
// from .env.local WITHOUT sourcing it (regex pick). Service role bypasses
// RLS so we can update arbitrary rows.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const VISION_MODEL = 'claude-sonnet-4-6'
const BUCKET = 'spots'

// ─────────────────────── Env parsing (no sourcing) ───────────────────────
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
const ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY ||
  pick(envText, 'ANTHROPIC_API_KEY', 'sk-ant-[A-Za-z0-9_-]+')

// ─────────────────────── Args ───────────────────────
const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const LIMIT = (() => {
  const i = args.indexOf('--limit')
  if (i >= 0) return parseInt(args[i + 1], 10) || Infinity
  return APPLY ? Infinity : 5 // dry-run defaults to a tiny sample
})()
const DELAY = (() => {
  const i = args.indexOf('--delay')
  return i >= 0 ? parseInt(args[i + 1], 10) || 0 : 800
})()

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error(
    'Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
  process.exit(1)
}
if (!ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env.local (needed for plate detection)')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
})
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY })

// ─────────────────────── Progress (resumable) ───────────────────────
const PROGRESS_PATH = new URL('./.blur-progress.json', import.meta.url)
function loadProgress() {
  try {
    if (existsSync(PROGRESS_PATH))
      return new Set(JSON.parse(readFileSync(PROGRESS_PATH, 'utf8')))
  } catch {
    /* corrupt / missing — start fresh */
  }
  return new Set()
}
function saveProgress(set) {
  try {
    writeFileSync(PROGRESS_PATH, JSON.stringify([...set]))
  } catch (e) {
    console.warn('Could not persist progress:', e?.message ?? e)
  }
}

// ─────────────────────── Plate detection (mirrors detect-plate.ts) ───────────────────────
const DETECT_SYSTEM = `Tu protèges la vie privée sur une app de partage de photos. Pour chaque photo, repère TOUTES les plaques d'immatriculation visibles afin qu'elles soient anonymisées (floutées) avant publication.

Tu renvoies un rectangle englobant en coordonnées normalisées [0..1] pour chaque plaque :
- Repère : (0,0) = coin haut-gauche, (1,1) = coin bas-droit.
- "x" / "y" = coin haut-gauche du rectangle.
- "width" / "height" = dimensions positives.

Règles :
- Précision : la boîte couvre EXACTEMENT le rectangle de la plaque, sans déborder largement sur le pare-chocs.
- Mieux vaut couvrir un peu trop large que pas assez (la plaque ne doit pas dépasser de la zone floutée).
- N'inclus PAS les badges/logos de marque.
- AUCUNE plaque visible (capot fermé, voiture vue de profil sans plaque, déjà floutée) → tableau vide.
- TOUTES les plaques visibles, plaque avant ET arrière, latérale, plaque commerciale.

Réponds UNIQUEMENT par un JSON de cette forme, RIEN d'autre, AUCUN markdown, AUCUNE phrase :
{"plates":[{"x":0.31,"y":0.62,"width":0.18,"height":0.05}]}

Si aucune plaque : {"plates":[]}`

function extractJSON(text) {
  if (typeof text !== 'string') return null
  let t = text.trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) t = fenced[1].trim()
  try {
    return JSON.parse(t)
  } catch {
    /* fall through */
  }
  const start = t.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < t.length; i += 1) {
    const c = t[i]
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(t.slice(start, i + 1))
        } catch {
          /* keep scanning */
        }
      }
    }
  }
  return null
}

function cleanPlates(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const p of raw) {
    const o = p ?? {}
    const x = Number(o.x ?? o.left)
    const y = Number(o.y ?? o.top)
    const w = Number(o.width ?? o.w)
    const h = Number(o.height ?? o.h)
    if (
      [x, y, w, h].every(Number.isFinite) &&
      w > 0 &&
      h > 0 &&
      x >= 0 &&
      y >= 0 &&
      x + w <= 1.01 &&
      y + h <= 1.01
    ) {
      out.push({ x, y, width: w, height: h })
    }
  }
  return out
}

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

async function detectPlates(base64, mime) {
  const r = await anthropic.messages.create({
    model: VISION_MODEL,
    max_tokens: 600,
    system: [{ type: 'text', text: DETECT_SYSTEM }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
          { type: 'text', text: "Détecte les plaques d'immatriculation à anonymiser." },
        ],
      },
    ],
  })
  if (r.stop_reason === 'refusal') return []
  const block = r.content.find((b) => b.type === 'text')
  const parsed = extractJSON(block && 'text' in block ? block.text : '')
  return parsed && 'plates' in parsed ? cleanPlates(parsed.plates) : []
}

// ─────────────────────── Blur (sharp, lazy-imported) ───────────────────────
// Pixelate the plate (shrink → nearest-upscale) then gaussian-soften the
// edges, and composite the patch back over the original. Only loaded in
// --apply mode so a dry-run runs without sharp installed.
async function blurPlates(buf, plates) {
  const sharp = (await import('sharp')).default
  const meta = await sharp(buf).metadata()
  const W = meta.width
  const H = meta.height
  if (!W || !H) return null
  const composites = []
  for (const p of plates) {
    let left = Math.round(p.x * W)
    let top = Math.round(p.y * H)
    let w = Math.round(p.width * W)
    let h = Math.round(p.height * H)
    // Pad ~14% so feathered edges fully cover the plate.
    const padX = Math.round(w * 0.14)
    const padY = Math.round(h * 0.14)
    left = Math.max(0, left - padX)
    top = Math.max(0, top - padY)
    w = Math.min(W - left, w + padX * 2)
    h = Math.min(H - top, h + padY * 2)
    if (w <= 1 || h <= 1) continue
    const small = Math.max(3, Math.round(Math.max(w, h) / 14))
    const patch = await sharp(buf)
      .extract({ left, top, width: w, height: h })
      .resize(small, null, { fit: 'inside' })
      .resize(w, h, { kernel: 'nearest' })
      .blur(10)
      .toBuffer()
    composites.push({ input: patch, left, top })
  }
  if (!composites.length) return null
  return sharp(buf).composite(composites).jpeg({ quality: 85 }).toBuffer()
}

// ─────────────────────── Fetch helpers ───────────────────────
async function downloadImage(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download ${res.status}`)
  const ct = (res.headers.get('content-type') || '').split(';')[0].trim()
  const mime = ALLOWED_MIME.has(ct) ? ct : 'image/jpeg'
  const buf = Buffer.from(await res.arrayBuffer())
  return { buf, mime }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─────────────────────── Main ───────────────────────
async function main() {
  console.log(
    `\n🔒 blur-existing-plates — ${APPLY ? 'APPLY (writes enabled)' : 'DRY-RUN (no writes)'}` +
      ` · limit=${LIMIT === Infinity ? '∞' : LIMIT} · delay=${DELAY}ms\n`,
  )

  const { data: spots, error } = await supabase
    .from('spots')
    .select('id, photo_url, user_id')
    .not('photo_url', 'is', null)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('Query failed:', error.message)
    process.exit(1)
  }

  const progress = loadProgress()
  // Skip already-anonymised rows (photo_url already under /blurred/) and
  // anything we've recorded as done.
  const todo = spots.filter(
    (s) =>
      s.photo_url &&
      !s.photo_url.includes('/blurred/') &&
      !progress.has(s.id),
  )
  console.log(
    `${spots.length} spots with photos · ${spots.length - todo.length} already done/anonymised · ${todo.length} to process\n`,
  )

  let processed = 0
  let withPlates = 0
  let blurred = 0
  let failed = 0

  for (const spot of todo) {
    if (processed >= LIMIT) break
    processed += 1
    const tag = `[${processed}] ${spot.id}`
    try {
      const { buf, mime } = await downloadImage(spot.photo_url)
      const plates = await detectPlates(buf.toString('base64'), mime)
      if (plates.length > 0) withPlates += 1

      if (!APPLY) {
        console.log(
          `${tag} · ${plates.length} plaque(s) détectée(s)` +
            (plates.length
              ? ` → ${plates.map((p) => `[${p.x.toFixed(2)},${p.y.toFixed(2)} ${p.width.toFixed(2)}×${p.height.toFixed(2)}]`).join(' ')}`
              : ''),
        )
      } else if (plates.length === 0) {
        console.log(`${tag} · aucune plaque — rien à flouter`)
        progress.add(spot.id)
        saveProgress(progress)
      } else {
        const out = await blurPlates(buf, plates)
        if (!out) {
          console.log(`${tag} · flou ignoré (régions vides)`)
          progress.add(spot.id)
          saveProgress(progress)
        } else {
          const path = `blurred/${spot.id}.jpg`
          const { error: upErr } = await supabase.storage
            .from(BUCKET)
            .upload(path, out, { contentType: 'image/jpeg', upsert: true })
          if (upErr) throw new Error(`upload: ${upErr.message}`)
          const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
          const { error: updErr } = await supabase
            .from('spots')
            .update({ photo_url: pub.publicUrl })
            .eq('id', spot.id)
          if (updErr) throw new Error(`update: ${updErr.message}`)
          blurred += 1
          progress.add(spot.id)
          saveProgress(progress)
          console.log(`${tag} · ✅ ${plates.length} plaque(s) floutée(s) → ${path}`)
        }
      }
    } catch (e) {
      failed += 1
      console.warn(`${tag} · ⚠️  ${e?.message ?? e}`)
    }
    if (DELAY) await sleep(DELAY)
  }

  console.log(
    `\n── Résumé ──\n` +
      `Spots traités       : ${processed}\n` +
      `Avec plaque(s)      : ${withPlates}\n` +
      (APPLY ? `Floutés + remplacés : ${blurred}\n` : '') +
      `Échecs              : ${failed}\n` +
      (APPLY
        ? ''
        : `\n(DRY-RUN — aucune image modifiée. Relance avec --apply pour exécuter.)\n`),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
