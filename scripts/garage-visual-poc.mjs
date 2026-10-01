// ═══════════ GARAGE VISUAL — POC DE GÉNÉRATION IMAGE-TO-IMAGE ═══════════
//
// CE QUE CE SCRIPT EST, ET CE QU'IL N'EST PAS
// C'est un banc d'essai, pas un morceau du produit. Il prend CINQ spots réels
// couvrant cinq difficultés différentes, demande au modèle une représentation
// NOUVELLE de la voiture photographiée, écrit les images à côté des originaux
// et mesure ce qu'il faut pour décider : fidélité, orientation, durée, coût,
// résolution, taux d'échec.
//
// Il n'écrit RIEN en base, ne touche à aucune table, ne remplace aucune photo.
// Le pipeline de production (cache, déclenchement après publication, backfill)
// ne sera construit qu'après un GO — c'est l'objet même de ce POC.
//
// ── ÉTAT AU 01/10/2026 — TOUJOURS BLOQUÉ ──
// Le script est complet et prêt, mais il ne peut pas tourner : l'API Gemini
// accorde `limit: 0` en offre gratuite sur TOUS les modèles image
// (3.1-flash-image, 3.1-flash-lite-image, 3-pro-image, 2.5-flash-image).
// Revérifié le 01/10 : inchangé. La clé elle-même est valide — les modèles
// texte répondent 200. Il manque uniquement la facturation sur le projet
// Google Cloud associé.
//
// ⚠️ CONSÉQUENCE À DIRE CLAIREMENT : aucune image n'a JAMAIS été produite par
// ce script. Les rendus visibles dans le Garage en production ne viennent pas
// d'ici — ils sortent de `scripts/detour-spot-photos.mjs`, un détourage local
// sans aucune IA générative. C'est pourquoi ils ressemblent à « la photo avec
// un autre fond » : c'est littéralement ce qu'ils sont.
//
// USAGE
//   node scripts/garage-visual-poc.mjs                 # l'échantillon de 5
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

// Cinq véhicules représentatifs du parc REVS (§18) — chacun teste une
// difficulté différente, et pas seulement « est-ce que ça marche » :
//   · la BERLINE sombre et banale : le cas où un modèle a le plus de latitude
//     pour inventer une voiture vaguement ressemblante ;
//   · la MODERNE dont la photo source est polluée (rétroviseur et bras du
//     photographe au premier plan) : le cas qui dit si le moteur comprend ce
//     qui appartient au véhicule et ce qui appartient à la scène ;
//   · la SPORTIVE à silhouette très identifiable : la fidélité s'y voit tout
//     de suite ;
//   · le SUV : proportions hautes, souvent mal rendues ;
//   · l'ANCIENNE (1953) : la seule qui dira si le moteur connaît autre chose
//     que des voitures contemporaines.
const DEFAULT_SPOTS = [
  'a4074eae', // BERLINE   — Mercedes Classe C W206 AMG Line 2022, noir obsidien
  '0cb6565b', // MODERNE   — Tesla Model 3 2021, blanc nacré (photo polluée :
              //             rétroviseur et bras du photographe au premier plan)
  '89d4e868', // SPORTIVE  — Porsche 911 GT3 2018, bleu Miami
  'ed85283b', // SUV       — Porsche Cayenne Coupé GTS 2022, blanc Carrara
  '546d76ec', // ANCIENNE  — Bentley R-Type 1953, gris taupe
]

const ATTEMPTS = Number(process.env.REVS_POC_N || 1)
const OUT = new URL('../.garage-poc/', import.meta.url).pathname

/**
 * Le prompt — RÉÉCRIT le 01/10/2026.
 *
 * ── CE QUI N'ALLAIT PAS DANS LE PRÉCÉDENT ──
 * Il commençait par « Re-photograph THIS EXACT CAR … This is a retouching
 * task ». C'est un cadrage de RETOUCHE, et un modèle à qui l'on demande une
 * retouche rend une retouche : la photo d'origine avec un autre fond. C'est
 * exactement ce qu'on cherche à ne plus produire. Le mot « retouching » a donc
 * disparu, et l'instruction d'ouverture demande maintenant une IMAGE NOUVELLE.
 *
 * ── CE QUI A CHANGÉ ──
 * 1. La photo d'entrée est présentée comme une RÉFÉRENCE D'IDENTIFICATION, pas
 *    comme un calque à modifier. C'est le pivot de toute la réécriture.
 * 2. Une liste explicite de ce qui appartient à la SCÈNE et non au véhicule :
 *    personnes, bras, mains, le rétroviseur et le montant de la voiture DEPUIS
 *    LAQUELLE la photo a été prise, bâtiments, enseignes, poteaux, trottoirs.
 *    Sans cette liste, le modèle n'a aucune raison de deviner que le gros
 *    rétroviseur au premier plan n'est pas une pièce du sujet.
 * 3. L'identité reste en tête ET en queue, sous forme d'interdits : un modèle
 *    qui lit d'abord une longue description de studio a déjà commencé à
 *    composer un studio, et la vraie voiture devient un détail.
 *
 * ── NIVEAU DE CONFIANCE (§27) ──
 * Quand l'identification REVS est incertaine, on NE donne PAS la désignation
 * précise au modèle : lui dire « Ferrari Modèle inconnu » l'inviterait à
 * inventer une Ferrari. On lui demande alors de s'en tenir à ce qu'il VOIT.
 */
const CONFIDENT = 85

function buildPrompt(spot) {
  const name = [spot.brand, spot.model].filter(Boolean).join(' ').trim()
  const year = spot.year ? `, model year ${spot.year}` : ''
  const sure = Number(spot.confidence ?? 0) >= CONFIDENT && !/inconnu|unknown/i.test(name)

  // Avec une identification sûre, la désignation aide le modèle à restituer
  // les bons détails. Sans elle, elle le pousserait à en inventer.
  const identity = sure
    ? `The subject is a ${name}${year}, finished in "${spot.color}". Render that exact model and generation — the correct silhouette, roofline, greenhouse, overhangs, bumpers, lamp signatures, grille and wheel design.`
    : `The model is NOT reliably identified. Do not name or guess a model: reproduce faithfully the car VISIBLE in the reference photo — its exact silhouette, proportions, lamp shapes, glass area and wheels — in the colour "${spot.color}".`

  return `Create a NEW premium automotive showroom photograph of one single car.

The attached photo is a REFERENCE FOR IDENTIFYING THE CAR ONLY. Do not edit it, do not reuse its framing, its angle, its lighting or any part of its surroundings. Build a new image from scratch.

SUBJECT
${identity}
Keep the real paint colour and finish. Keep any body kit, spoiler, wrap or wheel option that is genuinely on this car.

WHAT BELONGS TO THE SCENE, NOT TO THE CAR — exclude all of it
The reference photo was taken in the street, often from inside another vehicle. Everything below belongs to that situation and must not appear in the output:
people, arms, hands, faces, reflections of people; the door mirror, window frame, A-pillar, dashboard or bodywork of the car the photo was taken FROM; other vehicles; buildings, shopfronts, signage, lettering, awnings; poles, posts, traffic signs, road markings, kerbs, pavements, street furniture; trees, sky, any outdoor background; any object in front of or overlapping the car.
Only the identified car survives into the new image.

COMPOSITION
Three-quarter view, REAR of the car toward the LEFT of the frame and FRONT toward the RIGHT. Camera at about headlight height — a low, car-level viewpoint, never a drone or steep top-down angle. 50-85mm equivalent lens, no wide-angle distortion. The complete vehicle is inside the frame, all four wheels visible, nothing cropped, with comfortable margin on every side. The car fills most of the frame and is the obvious subject — not a small object lost in empty space.

ENVIRONMENT — the REVS showroom
A dark, seamless studio: black and graphite, falling off to deep black at the edges. Polished floor with a soft, believable reflection of the car beneath it. Elegant vertical studio light sources, a sense of depth, optional faint atmospheric haze. Clean and minimal — no walls, props, furniture, decoration or text of any kind.

LIGHTING
Premium automotive studio lighting that gives the bodywork volume: long soft strip highlights along the shoulder line and roof, a gentle rim light separating the car from the background, clean speculars on the wheels and lamps. A soft contact shadow directly under the car so it sits on the floor instead of floating.

STRICT PROHIBITIONS
- Do NOT output a different model, generation or trim than the subject.
- Do NOT restyle, modernise, lower, widen or otherwise "improve" the bodywork.
- Do NOT change the paint colour.
- Do NOT include any person, body part, or reflection of a person.
- Do NOT render a readable licence plate: leave the plate area blank, dark or softly blurred.
- Do NOT add any manufacturer badge, logo or lettering that is not genuinely on this car.
- Do NOT add text, captions, graphics or watermarks anywhere.
- Do NOT reuse the background, framing or perspective of the reference photo.

Output: one photorealistic image, nothing else.`
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
  .select('id, brand, model, year, color, category, confidence, photo_url')
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
