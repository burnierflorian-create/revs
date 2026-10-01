// ═══════ PLAQUES — REJOUER LE DÉTECTEUR DE PRODUCTION SUR UNE PHOTO ═══════
//
// Ce script appelle EXACTEMENT le même modèle et le même prompt que
// `api/detect-plate.ts`, puis dessine la ou les boîtes renvoyées sur l'image.
// Il existe pour une raison précise : le cas Toyota (spot 358583a3) montre une
// plaque lisible ALORS QUE le floutage a bien été appliqué — à côté. Aucun log,
// aucun code de retour ne signale ce cas, parce que chaque couche a réussi sa
// tâche. Seul l'œil sur l'image le voit.
//
// USAGE
//   node scripts/plate-replay.mjs <image.jpg> [sortie.png]
//
// N'ÉCRIT RIEN EN BASE, NE PUBLIE RIEN. Diagnostic seul.

import { readFileSync, writeFileSync } from 'node:fs'
import sharp from 'sharp'

const [src, out = src.replace(/\.(jpe?g|png)$/i, '-boxes.png')] = process.argv.slice(2)
if (!src) {
  console.error('usage : node scripts/plate-replay.mjs <image> [sortie.png]')
  process.exit(2)
}

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const KEY = (env.match(/^ANTHROPIC_API_KEY=("?)([^"\n\r]+)\1/m) || [])[2]
if (!KEY) {
  console.error('ANTHROPIC_API_KEY absente de .env.local')
  process.exit(2)
}

// ── COPIE CONFORME DE api/detect-plate.ts ──
// Dupliqué volontairement plutôt qu'importé : le endpoint est un handler
// Vercel (TypeScript, typé VercelRequest) qu'on ne peut pas appeler hors
// contexte HTTP. Toute modification du prompt côté API doit être reportée ici,
// sinon le diagnostic ne mesure plus la production.
const SYSTEM = `Tu protèges la vie privée sur une app de partage de photos. Pour chaque photo, repère TOUTES les plaques d'immatriculation visibles afin qu'elles soient anonymisées (floutées) avant publication.

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

const MODEL = process.env.REVS_PLATE_MODEL || 'claude-sonnet-4-6'
const buf = readFileSync(src)
const meta = await sharp(buf).metadata()
const mime = /\.png$/i.test(src) ? 'image/png' : 'image/jpeg'

const r = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 600,
    system: [{ type: 'text', text: SYSTEM }],
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } },
          { type: 'text', text: "Détecte les plaques d'immatriculation à anonymiser." },
        ],
      },
    ],
  }),
})
if (!r.ok) {
  console.error('HTTP', r.status, (await r.text()).slice(0, 300))
  process.exit(2)
}
const body = await r.json()
const text = (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
const m = text.match(/\{[\s\S]*\}/)
const plates = m ? JSON.parse(m[0]).plates || [] : []

console.log(`\n═══ ${src} ═══`)
console.log(`modèle   : ${MODEL}`)
console.log(`image    : ${meta.width}×${meta.height}`)
console.log(`réponse  : ${text.trim().slice(0, 200)}`)
console.log(`plaques  : ${plates.length}`)

const W = meta.width
const H = meta.height
const rects = plates
  .map((p, i) => {
    const x = Math.round(p.x * W)
    const y = Math.round(p.y * H)
    const w = Math.round((p.width ?? p.w) * W)
    const h = Math.round((p.height ?? p.h) * H)
    console.log(`  #${i + 1} px : x=${x} y=${y} ${w}×${h}  (norm ${p.x.toFixed(3)}, ${p.y.toFixed(3)}, ${(p.width ?? p.w).toFixed(3)}, ${(p.height ?? p.h).toFixed(3)})`)
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#ff2d55" stroke-width="${Math.max(3, Math.round(W / 250))}"/>`
  })
  .join('')

const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`
await sharp(buf).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(out)
console.log(`\noverlay  : ${out}`)
writeFileSync(out.replace(/\.png$/, '.json'), JSON.stringify({ src, model: MODEL, plates }, null, 2))
