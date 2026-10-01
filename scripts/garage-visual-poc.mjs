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
import {
  buildPrompt,
  cacheKey,
  pickProvider,
  providers,
} from '../server/garage-visual.js'

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

// Le prompt, la clé de cache et le contrôle qualité vivent dans
// `server/garage-visual.js`, partagés avec la couche fournisseur. Deux
// copies du prompt finiraient par diverger, et on ne comparerait plus des
// moteurs mais des consignes.
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

const { provider, report } = await pickProvider({ GEMINI_API_KEY: GEMINI_KEY })
console.log('moteurs   :')
report.forEach((r) => console.log(`  ${r.id.padEnd(8)} ${r.ok ? '✓ disponible' : '✗ ' + r.reason}`))
if (!provider) {
  console.log('\nAUCUN MOTEUR DISPONIBLE — rien ne sera généré, rien ne sera dépensé.')
  console.log('Les 5 véhicules de l’échantillon et leurs clés de cache :')
  for (const s of spots) {
    console.log(`  ${(s.brand + ' ' + s.model).padEnd(42)} → ${cacheKey(s)}`)
  }
  console.log(`\ncoût évité : ${(spots.length * providers.gemini.usdPerImage).toFixed(2)} $`)
  process.exit(0)
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
