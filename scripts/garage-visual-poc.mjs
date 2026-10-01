// ═══════════ GARAGE VISUAL — POC DE GÉNÉRATION IMAGE-TO-IMAGE ═══════════
//
// CE QUE CE SCRIPT EST, ET CE QU'IL N'EST PAS
// C'est un banc d'essai, pas un morceau du produit. Il prend deux spots réels,
// demande au modèle une transformation de LA voiture photographiée, écrit les
// images à côté des originaux et mesure ce qu'il faut pour décider : fidélité,
// orientation, durée, coût, résolution, taux d'échec.
//
// Il n'écrit RIEN en base, ne touche à aucune table, ne remplace aucune photo.
// Le pipeline de production (cache, déclenchement après publication, backfill)
// ne sera construit qu'après un GO — c'est l'objet même de ce POC.
//
// ── ÉTAT AU 30/09/2026 ──
// Le script est complet et prêt, mais il ne peut pas tourner : l'API Gemini
// accorde `limit: 0` en offre gratuite sur TOUS les modèles image
// (3.1-flash-image, 3.1-flash-lite-image, 3-pro-image, 2.5-flash-image).
// La clé elle-même est valide — les modèles texte répondent 200. Il manque
// uniquement la facturation sur le projet Google Cloud associé.
//
// USAGE
//   node scripts/garage-visual-poc.mjs                 # les 2 véhicules par défaut
//   node scripts/garage-visual-poc.mjs <spot_id> ...   # des spots choisis
//   REVS_POC_N=3 node scripts/garage-visual-poc.mjs    # 3 essais par véhicule
//                                                     # (mesure le taux d'échec)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const pick = (k, re) =>
  (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]

const GEMINI_KEY = pick('GEMINI_API_KEY', '[^\\s]+')
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)

// Le modèle image courant recommandé par Google. `gemini-2.5-flash-image` est
// déprécié ; vérifié le 30/09/2026 sur /v1beta/models, les deux sont exposés
// par l'API mais seul celui-ci doit être utilisé pour du neuf.
const MODEL = process.env.REVS_POC_MODEL || 'gemini-3.1-flash-image'

// Prix de sortie publié pour ce modèle : 60 $/1M jetons, 1 120 jetons par image
// en 1K → 0,067 $ l'image. L'entrée (la photo source) s'y ajoute, marginalement.
const USD_PER_IMAGE = 0.067

// Deux véhicules représentatifs du parc REVS :
//   · une supercar à forme très identifiable et couleur saturée — le cas où la
//     fidélité se voit immédiatement ;
//   · une berline sombre et banale — le cas difficile, où un modèle a le plus
//     de latitude pour « inventer » une voiture vaguement ressemblante.
const DEFAULT_SPOTS = [
  'b2892f02', // McLaren 720S 2019, orange Papaya Spark
  'a4074eae', // Mercedes-Benz Classe C W206 AMG Line 2022, noir obsidien
]

const ATTEMPTS = Number(process.env.REVS_POC_N || 1)
const OUT = new URL('../.garage-poc/', import.meta.url).pathname

/**
 * Le prompt.
 *
 * Il est écrit en anglais : les modèles image sont nettement plus obéissants
 * sur les termes photographiques anglais (« three-quarter », « rim light »),
 * et c'est de la consigne machine, pas de l'interface — rien ici n'est montré
 * à un utilisateur, donc rien à traduire.
 *
 * La structure est délibérée. L'instruction d'identité vient EN PREMIER et
 * revient en dernier sous forme d'interdits : un modèle qui lit d'abord une
 * longue description de studio a déjà commencé à composer une image de studio,
 * et la vraie voiture devient un détail. On lui dit donc, dans l'ordre :
 * ce qui ne doit pas changer, puis ce qu'on refait autour.
 */
function buildPrompt(spot) {
  const name = [spot.brand, spot.model].filter(Boolean).join(' ')
  const year = spot.year ? `, ${spot.year}` : ''
  return `Re-photograph THIS EXACT CAR in a premium automotive studio. This is a retouching task, not a creative one.

IDENTITY — the single most important requirement:
The car in the output must be the same physical car as in the input photo: a ${name}${year}, colour "${spot.color}". Keep its exact body shape, proportions, wheelbase, roofline, greenhouse, bumpers, lights, grille, wheel design and trim. Keep the factory paint colour and finish exactly as in the source photo. Keep any visible body kit, spoiler or wrap that is on the real car.

VIEW:
Three-quarter view with the REAR of the car on the LEFT of the frame and the FRONT on the RIGHT. Camera at roughly headlight height, slight downward tilt, 50-85mm equivalent focal length, no wide-angle distortion. The entire vehicle is inside the frame with comfortable margin on all four sides. Wheels straight or gently turned toward the camera.

ENVIRONMENT — the REVS showroom:
Seamless black and graphite studio. Dark polished floor with a soft, believable reflection of the car underneath it. Deep black background falling off to pure black at the edges. No walls, props, text, furniture or decoration of any kind.

LIGHTING:
Premium automotive studio lighting. Long soft strip highlights running along the shoulder line and roof, gentle rim light separating the car from the background, clean specular highlights on the wheels. Contact shadow directly under the car, soft and grounded — the car must sit on the floor, not float.

STRICT PROHIBITIONS:
- Do NOT replace the car with a different model, generation or trim.
- Do NOT restyle, modernise, lower, widen or "improve" the bodywork.
- Do NOT change the paint colour.
- Do NOT include any person, reflection of a person, or body part.
- Do NOT render any readable licence plate: leave the plate area blank, dark or blurred.
- Do NOT add any manufacturer badge, logo, lettering or watermark that is not already on the real car.
- Do NOT add text, captions or graphics anywhere in the image.

Output: one photorealistic image only.`
}

/** La photo du spot, telle qu'elle est stockée (déjà floutée côté plaques). */
async function fetchPhoto(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`photo inaccessible (HTTP ${r.status})`)
  const buf = Buffer.from(await r.arrayBuffer())
  const mime = r.headers.get('content-type') || 'image/jpeg'
  return { data: buf.toString('base64'), mime, bytes: buf.length }
}

async function generate(spot, photo, attempt) {
  const t0 = Date.now()
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inlineData: { mimeType: photo.mime, data: photo.data } },
              { text: buildPrompt(spot) },
            ],
          },
        ],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    },
  )
  const ms = Date.now() - t0
  const json = await res.json()
  if (!res.ok || json.error) {
    return { ok: false, ms, status: res.status, error: json.error?.message || `HTTP ${res.status}` }
  }
  const parts = json.candidates?.[0]?.content?.parts || []
  const img = parts.find((p) => p.inlineData)
  if (!img) {
    // Un refus du modèle ressort ici : pas d'erreur HTTP, mais pas d'image.
    return { ok: false, ms, status: res.status, error: `aucune image renvoyée (${json.candidates?.[0]?.finishReason || 'raison inconnue'})` }
  }
  const bytes = Buffer.from(img.inlineData.data, 'base64')
  const file = `${OUT}${spot.id.slice(0, 8)}-${attempt}.png`
  writeFileSync(file, bytes)
  return { ok: true, ms, file, bytes: bytes.length, usage: json.usageMetadata }
}

/** Dimensions PNG/JPEG lues dans l'en-tête, sans dépendance. */
function dimensions(file) {
  const b = readFileSync(file)
  if (b[0] === 0x89 && b[1] === 0x50) {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
  }
  let i = 2
  while (i < b.length) {
    if (b[i] !== 0xff) { i += 1; continue }
    const m = b[i + 1]
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }
    }
    i += 2 + b.readUInt16BE(i + 2)
  }
  return { w: 0, h: 0 }
}

// ─────────────────────────────── Exécution ───────────────────────────────
if (!GEMINI_KEY) {
  console.error('GEMINI_API_KEY absente de .env.local.')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SPOTS
const { data: all } = await db
  .from('spots')
  .select('id, brand, model, year, color, category, photo_url')
const spots = wanted
  .map((w) => all?.find((s) => s.id.startsWith(w)))
  .filter(Boolean)

if (spots.length !== wanted.length) {
  console.error(`spots introuvables : ${wanted.filter((w) => !all?.some((s) => s.id.startsWith(w))).join(', ')}`)
  process.exit(1)
}

console.log(`modèle    : ${MODEL}`)
console.log(`véhicules : ${spots.length} · ${ATTEMPTS} essai(s) chacun`)
console.log(`sortie    : ${OUT}\n`)

const runs = []
for (const spot of spots) {
  const label = `${spot.brand} ${spot.model} (${spot.color})`
  let photo
  try {
    photo = await fetchPhoto(spot.photo_url)
  } catch (e) {
    console.log(`✗ ${label} — ${e.message}`)
    continue
  }
  writeFileSync(`${OUT}${spot.id.slice(0, 8)}-source.jpg`, Buffer.from(photo.data, 'base64'))
  for (let n = 1; n <= ATTEMPTS; n += 1) {
    const r = await generate(spot, photo, n)
    runs.push({ spot: label, ...r })
    if (r.ok) {
      const d = dimensions(r.file)
      console.log(`✓ ${label} · essai ${n} · ${r.ms} ms · ${d.w}×${d.h} · ${Math.round(r.bytes / 1024)} Ko`)
    } else {
      console.log(`✗ ${label} · essai ${n} · ${r.ms} ms · ${r.status} · ${r.error}`)
    }
  }
}

const ok = runs.filter((r) => r.ok)
const times = ok.map((r) => r.ms)
console.log('\n═══ MESURES ═══')
console.log(`générations réussies : ${ok.length} / ${runs.length}`)
console.log(`taux d'échec         : ${runs.length ? Math.round((1 - ok.length / runs.length) * 100) : 0} %`)
if (times.length) {
  console.log(`temps moyen          : ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} ms`)
  console.log(`temps min / max      : ${Math.min(...times)} / ${Math.max(...times)} ms`)
}
console.log(`coût de cet essai    : ${(ok.length * USD_PER_IMAGE).toFixed(3)} $ (${USD_PER_IMAGE} $/image)`)
console.log(`coût des 32 spots    : ${(32 * USD_PER_IMAGE).toFixed(2)} $ en une passe`)
console.log('\nLes images sont dans .garage-poc/ — comparer chaque -N.png à son -source.jpg.')
console.log('Rien n’a été écrit en base : ce script ne fait que mesurer.')
