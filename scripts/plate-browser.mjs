// ═══════ PLAQUES — TEST NAVIGATEUR DU CODE CLIENT RÉEL ═══════
//
// `plate-regression.mjs` valide le DÉTECTEUR et une pixelisation écrite avec
// sharp. Mais à la publication, ce n'est pas sharp qui floute : c'est
// `blurRegions` dans src/lib/spots.ts, sur un canvas, dans le navigateur de
// l'utilisateur. Une pixelisation correcte côté serveur ne prouve rien sur
// celle-là — et c'est pourtant elle qui produit le fichier envoyé au Storage.
//
// Ce test charge donc la VRAIE fonction via le serveur Vite, lui donne la
// photo Toyota et la boîte trouvée par le détecteur, récupère le JPEG qu'elle
// produit, et vérifie que la plaque n'y est plus lisible — avec la même mesure
// de jambages que la suite serveur.
//
// PRÉREQUIS : un serveur Vite sur http://localhost:5173
//   npm run dev &  puis  node scripts/plate-browser.mjs
//
// N'ÉCRIT RIEN EN BASE, NE PUBLIE RIEN.

import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'
import pw from 'playwright'
import { detectPlates } from '../server/plate-detect.js'

const BASE = process.env.BASE || 'http://localhost:5173'
const SRC = '.plate-audit/toyota.jpg'

/** Même mesure que plate-regression.mjs — voir le commentaire là-bas. */
async function strokeCount(buf, plate, W, H) {
  const l = Math.max(0, Math.round(plate.x * W))
  const t = Math.max(0, Math.round(plate.y * H))
  const w = Math.max(1, Math.min(W - l, Math.round(plate.width * W)))
  const h = Math.max(1, Math.min(H - t, Math.round(plate.height * H)))
  const { data, info } = await sharp(buf)
    .extract({ left: l, top: t, width: w, height: h })
    .greyscale()
    .resize(240, 60, { fit: 'fill' })
    .normalise()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const iw = info.width
  const ih = info.height
  const y0 = Math.floor(ih * 0.2)
  const y1 = Math.ceil(ih * 0.8)
  const prof = new Float64Array(iw)
  for (let x = 0; x < iw; x += 1) {
    let mn = 255
    let mx = 0
    for (let y = y0; y < y1; y += 1) {
      const v = data[y * iw + x]
      if (v < mn) mn = v
      if (v > mx) mx = v
    }
    prof[x] = mx - mn
  }
  const R = Math.max(2, Math.round(iw / 8))
  const detr = new Float64Array(iw)
  for (let x = 0; x < iw; x += 1) {
    let s = 0
    let n = 0
    for (let k = Math.max(0, x - R); k <= Math.min(iw - 1, x + R); k += 1) {
      s += prof[k]
      n += 1
    }
    detr[x] = prof[x] - s / n
  }
  let strokes = 0
  let last = 0
  let lastX = -1
  for (let x = 0; x < iw; x += 1) {
    const v = detr[x]
    if (Math.abs(v) < 8) continue
    const sign = v > 0 ? 1 : -1
    if (last !== 0 && sign !== last) {
      if (lastX >= 0 && x - lastX <= 15) strokes += 1
      lastX = x
    }
    last = sign
  }
  return strokes
}

const src = readFileSync(SRC)
const det = await detectPlates(src, sharp)
if (!det || !det.plates.length) {
  console.error('Le détecteur ne trouve pas la plaque sur la photo de référence — test impossible.')
  process.exit(2)
}
console.log(`\n═══ TEST NAVIGATEUR · blurRegions (src/lib/spots.ts) ═══`)
console.log(`photo     : ${SRC}  ${det.W}×${det.H}`)
console.log(`boîte     : ${det.plates.length} plaque(s) fournie(s) par le détecteur local\n`)

const browser = await pw.chromium.launch()
const page = await browser.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
await page.goto(`${BASE}/scripts/plate-browser.html`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => window.__pret === true, { timeout: 30000 })

const b64 = await page.evaluate(
  async ({ img, plates }) => {
    // Reconstitue un Blob JPEG comme celui que NewSpot détient en mémoire.
    const bin = Uint8Array.from(atob(img), (c) => c.charCodeAt(0))
    const blob = new Blob([bin], { type: 'image/jpeg' })
    const out = await window.__blurRegions(blob, plates)
    const buf = new Uint8Array(await out.blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < buf.length; i += 1) s += String.fromCharCode(buf[i])
    return btoa(s)
  },
  {
    img: src.toString('base64'),
    plates: det.plates.map(({ x, y, width, height }) => ({ x, y, width, height })),
  },
)
await browser.close()

const out = Buffer.from(b64, 'base64')
writeFileSync('plate-tests/traitees/h-navigateur.jpg', out)

let before = 0
let after = 0
for (const p of det.plates) {
  before = Math.max(before, await strokeCount(src, p, det.W, det.H))
  after = Math.max(after, await strokeCount(out, p, det.W, det.H))
}
const om = await sharp(out).metadata()
const dimsOk = om.width === det.W && om.height === det.H
const destroyed = after <= 6 && after <= before * 0.3
const ok = destroyed && dimsOk && !errs.length

console.log(`  ${dimsOk ? '✓' : '✗'} résolution préservée      ${om.width}×${om.height}`)
console.log(`  ${destroyed ? '✓' : '✗'} plaque détruite           jambages ${before} → ${after}`)
console.log(`  ${errs.length ? '✗' : '✓'} aucune erreur JS          ${errs.length ? errs[0] : 'aucune'}`)
console.log(`\n  H · pixelisation côté client : ${ok ? 'VALIDÉ' : 'ÉCHEC'}`)
console.log(`  sortie : plate-tests/traitees/h-navigateur.jpg`)
process.exit(ok ? 0 : 1)
