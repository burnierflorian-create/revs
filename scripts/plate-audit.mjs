// ═══════ PLAQUES — AUDIT COMPLET DU PARC DE PHOTOS ═══════
//
// ── POURQUOI UN AUDIT SÉPARÉ DE blur-plates-onnx.mjs ──
// Ce dernier IGNORE les photos déjà passées en `/blurred/` : pour un
// retraitement c'est le bon comportement, mais pour un audit c'est
// exactement ce qu'il ne faut pas faire. Une photo « déjà traitée » dont la
// plaque est restée lisible ne serait jamais réexaminée. On repasse donc sur
// LES 33, sans exception.
//
// ── CE QU'IL MESURE, ET CE QU'IL NE PROUVE PAS ──
// Il signale les plaques que le détecteur spécialisé TROUVE. Un « aucune
// plaque » ne prouve rien : c'est l'absence d'une preuve, pas la preuve d'une
// absence. Toute photo sans détection est donc exportée dans la planche de
// contrôle pour être regardée — le cas Toyota a montré ce que vaut la parole
// d'un détecteur.
//
// USAGE
//   node scripts/plate-audit.mjs            # audit + planche de contrôle
//
// LECTURE SEULE : aucune écriture en base, aucun upload, aucun fichier
// modifié dans Storage.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import ort from 'onnxruntime-node'
import sharp from 'sharp'

const MODEL = new URL('../models/plate-yolov8.onnx', import.meta.url)
const MODEL_SHA = '85d236280a1301ad98907947d284951dd2b20c23a6786ff50f7e6a8ec515bd50'
const SIZE = 640
const CONF = Number(process.env.PLATE_CONF || 0.08)
const IOU = 0.45
const OUT = 'plate-audit'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)

const modelBuf = readFileSync(MODEL)
if (createHash('sha256').update(modelBuf).digest('hex') !== MODEL_SHA) {
  console.error('Empreinte du modèle inattendue — on n’exécute pas un détecteur non vérifié.')
  process.exit(1)
}
const session = await ort.InferenceSession.create(modelBuf)

/** Photo → plaques en coordonnées normalisées, avec leur score. */
export async function detect(buf) {
  const { width: W, height: H } = await sharp(buf).metadata()
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
  const name = session.inputNames[0]
  const out = await session.run({ [name]: new ort.Tensor('float32', f, [1, 3, SIZE, SIZE]) })
  const t = out[session.outputNames[0]]
  // YOLOv8 : [1, 4+classes, N] — cx, cy, w, h puis les scores.
  const [, ch, n] = t.dims
  const d = t.data
  const raw = []
  for (let i = 0; i < n; i += 1) {
    let best = 0
    for (let c = 4; c < ch; c += 1) best = Math.max(best, d[c * n + i])
    if (best < CONF) continue
    const cx = d[i]
    const cy = d[n + i]
    const w = d[2 * n + i]
    const h = d[3 * n + i]
    raw.push({ x: cx - w / 2, y: cy - h / 2, w, h, score: best })
  }
  raw.sort((a, b) => b.score - a.score)
  const keep = []
  for (const b of raw) {
    const dup = keep.some((k) => {
      const x1 = Math.max(b.x, k.x)
      const y1 = Math.max(b.y, k.y)
      const x2 = Math.min(b.x + b.w, k.x + k.w)
      const y2 = Math.min(b.y + b.h, k.y + k.h)
      const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
      return inter / (b.w * b.h + k.w * k.h - inter) > IOU
    })
    if (!dup) keep.push(b)
  }
  const plates = keep.map((b) => ({
    x: (b.x - padX) / scale / W,
    y: (b.y - padY) / scale / H,
    width: b.w / scale / W,
    height: b.h / scale / H,
    score: b.score,
  }))
  return { plates, W, H }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(OUT, { recursive: true })
  const { data: spots, error } = await db
    .from('spots')
    .select('id, brand, model, photo_url, created_at')
    .not('photo_url', 'is', null)
    .neq('photo_url', '')
    .order('created_at', { ascending: true })
  if (error) throw error

  const rows = []
  for (const s of spots) {
    const label = `${s.brand ?? '?'} ${s.model ?? '?'}`.trim().slice(0, 30)
    const treated = s.photo_url.includes('/blurred/')
    try {
      const r = await fetch(s.photo_url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const buf = Buffer.from(await r.arrayBuffer())
      const { plates, W, H } = await detect(buf)
      rows.push({ id: s.id, label, treated, plates, W, H, buf, date: s.created_at })
      const tag = treated ? '[retraitée]' : '[chemin client]'
      console.log(
        `  ${plates.length ? '⚠' : '○'} ${label.padEnd(32)} ${tag.padEnd(16)} ${
          plates.length ? `${plates.length} plaque(s) score ${plates.map((p) => p.score.toFixed(2)).join(',')}` : 'aucune détection'
        }`,
      )
    } catch (e) {
      console.log(`  ✗ ${label.padEnd(32)} ${e.message}`)
    }
  }

  // Planche de contrôle : toutes les photos, boîtes en vert, pour que
  // « aucune détection » soit vérifiable à l'œil et non pris pour argent
  // comptant.
  const CW = 300
  const CH = 420
  const cols = 7
  const sheet = []
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]
    const rects = r.plates
      .map(
        (p) =>
          `<rect x="${p.x * r.W}" y="${p.y * r.H}" width="${p.width * r.W}" height="${p.height * r.H}" fill="none" stroke="#00FF00" stroke-width="${Math.max(4, r.W / 150)}"/>`,
      )
      .join('')
    const composed = rects
      ? await sharp(r.buf).composite([{ input: Buffer.from(`<svg width="${r.W}" height="${r.H}" xmlns="http://www.w3.org/2000/svg">${rects}</svg>`), top: 0, left: 0 }]).jpeg().toBuffer()
      : r.buf
    const cell = await sharp(composed)
      .resize(CW - 8, CH - 30, { fit: 'contain', background: { r: 12, g: 12, b: 14 } })
      .toBuffer()
    const m = await sharp(cell).metadata()
    sheet.push({ input: cell, left: (i % cols) * CW + 4, top: Math.floor(i / cols) * CH + 24 + Math.round((CH - 30 - m.height) / 2) })
    const col = r.plates.length ? '#f87171' : r.treated ? '#4ade80' : '#fbbf24'
    sheet.push({
      input: Buffer.from(
        `<svg width="${CW}" height="22"><text x="${CW / 2}" y="15" font-family="Helvetica" font-size="12" fill="${col}" text-anchor="middle">${r.label.replace(/[<&]/g, '')}</text></svg>`,
      ),
      left: (i % cols) * CW,
      top: Math.floor(i / cols) * CH + 2,
    })
  }
  const W = cols * CW
  const H = Math.ceil(rows.length / cols) * CH
  await sharp({ create: { width: W, height: H, channels: 3, background: { r: 12, g: 12, b: 14 } } })
    .composite(sheet)
    .jpeg({ quality: 82 })
    .toFile(`${OUT}/planche-controle.jpg`)

  const withPlate = rows.filter((r) => r.plates.length)
  console.log(`\n═══ SYNTHÈSE ═══`)
  console.log(`photos auditées          : ${rows.length}`)
  console.log(`déjà passées en /blurred/: ${rows.filter((r) => r.treated).length}`)
  console.log(`restées au chemin client : ${rows.filter((r) => !r.treated).length}`)
  console.log(`plaque ENCORE détectée   : ${withPlate.length}`)
  for (const r of withPlate) console.log(`   → ${r.id.slice(0, 8)}  ${r.label}  ${r.treated ? '(malgré retraitement)' : '(jamais retraitée)'}`)
  console.log(`\nplanche de contrôle      : ${OUT}/planche-controle.jpg`)
  writeFileSync(
    `${OUT}/audit.json`,
    JSON.stringify(rows.map(({ buf, ...r }) => r), null, 2),
  )
}
