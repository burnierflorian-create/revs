// ═══════ FLOUTAGE DES PLAQUES — DÉTECTEUR LOCAL, HORS LIGNE ═══════
//
// POURQUOI CE TROISIÈME SCRIPT
// Deux tentatives l'ont précédé, toutes deux inexploitables :
//   · `blur-existing-plates.mjs` appelle l'API Anthropic en direct — la clé
//     locale est invalide sur ce poste (401 vérifié) ;
//   · `blur-existing-plates-prod.mjs` délègue à /api/detect-plate déployé —
//     mais ce détecteur, vérifié sur photos réelles, encadre des enseignes de
//     restaurant et des bouts de chaussée en laissant les plaques lisibles.
//     Haiku puis Sonnet : même échec. Ces modèles ne sont pas fiables sur des
//     coordonnées de boîte précises.
//
// Celui-ci utilise un détecteur SPÉCIALISÉ, entraîné pour une seule tâche.
// Sur la Porsche Cayman S où Claude visait l'enseigne « Buffalo Grill », il
// encadre exactement CT-488-WF. Sur la BMW vue de profil, il ne détecte rien —
// ce qui est la bonne réponse, aucune plaque n'y est visible.
//
// ── LE MODÈLE ──
// ml-debi/yolov8-license-plate-detection · licence MIT · 12 Mo · ONNX.
// sha256 85d236280a1301ad98907947d284951dd2b20c23a6786ff50f7e6a8ec515bd50
//
// ⚠️ NOTE DE LICENCE À TRANCHER AVANT USAGE COMMERCIAL
// Les POIDS sont publiés sous MIT, et ce script ne dépend que de
// `onnxruntime-node` (MIT) — le paquet `ultralytics`, lui sous AGPL-3.0, n'est
// jamais chargé : on exécute un graphe ONNX, pas leur code. L'architecture
// YOLOv8 vient néanmoins de chez eux, et la portée de l'AGPL sur des poids
// entraînés reste un point discuté. Un modèle DETR (architecture Apache-2.0)
// lèverait toute ambiguïté, mais aucun export ONNX MIT n'en existe aujourd'hui.
// À faire valider avant d'en faire une brique du produit payant.
//
// ── CONFIDENTIALITÉ ──
// Tout est local : l'image ne sort jamais de la machine, aucun appel réseau
// vers un service d'analyse, aucun coût par photo. L'original n'est JAMAIS
// supprimé — la version floutée est écrite sous `blurred/<id>.jpg` et seul
// `photo_url` est repointé.
//
// USAGE
//   node scripts/blur-plates-onnx.mjs --dry-run         # détecte + écrit des
//                                                       # aperçus annotés
//   node scripts/blur-plates-onnx.mjs --apply [--limit N]

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import ort from 'onnxruntime-node'
import sharp from 'sharp'

const MODEL = new URL('../models/plate-yolov8.onnx', import.meta.url)
const MODEL_SHA =
  '85d236280a1301ad98907947d284951dd2b20c23a6786ff50f7e6a8ec515bd50'
const SIZE = 640
// Seuil BAS, et c'est délibéré : pour un système de confidentialité, le rappel
// prime sur la précision. Flouter une petite zone en trop ne coûte rien ;
// manquer une plaque coûte la vie privée de quelqu'un. À 0,08 le détecteur
// trouve aussi les plaques secondaires (véhicules voisins) sans produire de
// faux positif sur les photos sans plaque.
const CONF = Number(process.env.PLATE_CONF || 0.08)
const IOU = 0.45
const BUCKET = 'spots'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const pick = (k, re) =>
  (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || null

if (!existsSync(MODEL)) {
  console.error(
    `Modèle absent : ${MODEL.pathname}\n` +
      'Télécharge-le une fois :\n' +
      '  mkdir -p models && curl -L -o models/plate-yolov8.onnx \\\n' +
      '    https://huggingface.co/ml-debi/yolov8-license-plate-detection/resolve/main/best.onnx',
  )
  process.exit(1)
}
const modelBuf = readFileSync(MODEL)
const sha = createHash('sha256').update(modelBuf).digest('hex')
if (sha !== MODEL_SHA) {
  // Un modèle de détection décide de ce qui sera masqué : on ne l'exécute pas
  // sans savoir que c'est bien celui qu'on a validé.
  console.error(`Empreinte du modèle inattendue.\n  attendu ${MODEL_SHA}\n  obtenu  ${sha}`)
  process.exit(1)
}
const session = await ort.InferenceSession.create(modelBuf)

/** Photo → plaques, en coordonnées normalisées 0..1. */
async function detect(buf) {
  const { width: W, height: H } = await sharp(buf).metadata()
  // Letterbox : on préserve le rapport et on complète en gris, comme à
  // l'entraînement. Étirer l'image déplacerait les boîtes.
  const scale = Math.min(SIZE / W, SIZE / H)
  const nw = Math.round(W * scale)
  const nh = Math.round(H * scale)
  const padX = Math.floor((SIZE - nw) / 2)
  const padY = Math.floor((SIZE - nh) / 2)
  const px = await sharp(buf)
    .resize(nw, nh)
    .extend({
      top: padY,
      bottom: SIZE - nh - padY,
      left: padX,
      right: SIZE - nw - padX,
      background: { r: 114, g: 114, b: 114 },
    })
    .removeAlpha()
    .raw()
    .toBuffer()

  const f = new Float32Array(3 * SIZE * SIZE)
  const area = SIZE * SIZE
  for (let i = 0; i < area; i += 1) {
    f[i] = px[i * 3] / 255
    f[area + i] = px[i * 3 + 1] / 255
    f[2 * area + i] = px[i * 3 + 2] / 255
  }

  const out = await session.run({
    images: new ort.Tensor('float32', f, [1, 3, SIZE, SIZE]),
  })
  const t = out.output0
  const [, ch, n] = t.dims
  const d = t.data

  const found = []
  for (let i = 0; i < n; i += 1) {
    let conf = 0
    for (let c = 4; c < ch; c += 1) conf = Math.max(conf, d[c * n + i])
    if (conf < CONF) continue
    const cx = d[i], cy = d[n + i], w = d[2 * n + i], h = d[3 * n + i]
    found.push({
      x: (cx - w / 2 - padX) / scale / W,
      y: (cy - h / 2 - padY) / scale / H,
      width: w / scale / W,
      height: h / scale / H,
      conf,
    })
  }

  // Suppression des recouvrements : le modèle propose 8400 ancres, beaucoup
  // décrivent la même plaque.
  found.sort((a, b) => b.conf - a.conf)
  const keep = []
  const iou = (a, b) => {
    const x1 = Math.max(a.x, b.x)
    const y1 = Math.max(a.y, b.y)
    const x2 = Math.min(a.x + a.width, b.x + b.width)
    const y2 = Math.min(a.y + a.height, b.y + b.height)
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
    return inter / (a.width * a.height + b.width * b.height - inter)
  }
  for (const b of found) if (!keep.some((k) => iou(k, b) > IOU)) keep.push(b)
  return { plates: keep, W, H }
}

/** Pixellisation irréversible des zones données. */
async function pixelate(buf, plates, W, H) {
  const layers = []
  for (const p of plates) {
    // Marge de 18 % : le modèle cadre au plus juste, les caractères de bord
    // dépasseraient d'une boîte exacte.
    const w = Math.max(8, Math.round(p.width * W * 1.18))
    const h = Math.max(6, Math.round(p.height * H * 1.18))
    const l = Math.max(0, Math.min(W - w, Math.round((p.x - p.width * 0.09) * W)))
    const t = Math.max(0, Math.min(H - h, Math.round((p.y - p.height * 0.09) * H)))
    // ⚠️ DEUX PIPELINES, ET C'EST INDISPENSABLE.
    // Enchaîner `.resize(petit).resize(grand)` sur la MÊME instance sharp ne
    // produit pas une pixellisation : le second appel écrase la consigne du
    // premier, et la tuile ressort intacte. Le bogue est silencieux — l'image
    // se compose normalement, le fichier est écrit, la plaque reste lisible.
    // Il faut matérialiser la réduction en mémoire avant de ré-agrandir.
    const shrunk = await sharp(buf)
      .extract({ left: l, top: t, width: w, height: h })
      .resize(Math.max(3, Math.round(w / 12)), Math.max(2, Math.round(h / 12)), {
        fit: 'fill',
      })
      .toBuffer()
    // Ré-agrandissement au plus proche voisin : l'information est détruite,
    // contrairement à un flou gaussien qu'on peut parfois déconvoluer.
    const tile = await sharp(shrunk)
      .resize(w, h, { kernel: 'nearest', fit: 'fill' })
      .toBuffer()
    layers.push({ input: tile, left: l, top: t })
  }
  if (!layers.length) return null
  return sharp(buf).composite(layers).jpeg({ quality: 88 }).toBuffer()
}

const { data: spots, error } = await db
  .from('spots')
  .select('id, brand, model, photo_url')
  .not('photo_url', 'is', null)
  .neq('photo_url', '')
  .order('created_at', { ascending: true })
if (error) throw error

const todo = spots.filter((s) => !s.photo_url.includes('/blurred/'))
console.log(
  `${spots.length} photo(s) · ${spots.length - todo.length} déjà anonymisée(s) · ${todo.length} à examiner`,
)
const list = LIMIT ? todo.slice(0, LIMIT) : todo
if (!list.length) {
  console.log('rien à faire ✓')
  process.exit(0)
}
console.log(`${list.length} traitée(s)${APPLY ? '' : '  [essai à blanc — aperçus dans ./preview]'}\n`)
if (!APPLY) mkdirSync('preview', { recursive: true })

let masked = 0, clean = 0
const failed = []
for (const s of list) {
  const label = `${s.brand ?? '?'} ${s.model ?? '?'}`.trim().slice(0, 30)
  try {
    const r = await fetch(s.photo_url)
    if (!r.ok) throw new Error(`photo HTTP ${r.status}`)
    const buf = Buffer.from(await r.arrayBuffer())
    const { plates, W, H } = await detect(buf)

    if (!plates.length) {
      console.log(`  ○ ${label.padEnd(32)} aucune plaque`)
      clean += 1
      continue
    }

    if (!APPLY) {
      const rects = plates
        .map(
          (p) =>
            `<rect x="${p.x * W}" y="${p.y * H}" width="${p.width * W}" height="${p.height * H}" fill="none" stroke="#00FF00" stroke-width="${Math.max(4, W / 200)}"/>`,
        )
        .join('')
      const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`
      const shot = await sharp(buf)
        .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
        .png()
        .toBuffer()
      writeFileSync(`preview/${s.id}.png`, await sharp(shot).resize({ width: 700 }).png().toBuffer())
      console.log(`  ✓ ${label.padEnd(32)} ${plates.length} plaque(s) — aperçu écrit`)
      masked += 1
      continue
    }

    const out = await pixelate(buf, plates, W, H)
    if (!out) throw new Error('boîtes inexploitables')
    const path = `blurred/${s.id}.jpg`
    const up = await db.storage
      .from(BUCKET)
      .upload(path, out, { upsert: true, contentType: 'image/jpeg' })
    if (up.error) throw up.error
    const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path)
    const { error: uErr } = await db
      .from('spots')
      .update({ photo_url: pub.publicUrl })
      .eq('id', s.id)
    if (uErr) throw uErr
    console.log(`  ✓ ${label.padEnd(32)} ${plates.length} plaque(s) masquée(s)`)
    masked += 1
  } catch (e) {
    // Un échec n'écrit rien : la ligne garde son URL d'origine et sera reprise
    // au passage suivant.
    console.log(`  ✗ ${label.padEnd(32)} ${e?.message ?? e}`)
    failed.push(`${s.id}  ${label}  — ${e?.message ?? e}`)
  }
}

console.log(`\n${masked} avec plaque(s) · ${clean} sans · ${failed.length} échec(s)`)
for (const f of failed) console.log(`  à reprendre : ${f}`)
