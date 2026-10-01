// ═══════ DÉTECTION DE PLAQUES — MODÈLE LOCAL, AUCUN APPEL RÉSEAU ═══════
//
// ── POURQUOI ON N'UTILISE PLUS UN MODÈLE DE LANGAGE POUR ÇA ──
// `api/detect-plate.ts` demandait à Claude des coordonnées de boîte. Mesuré en
// production, c'est la mauvaise outil pour la tâche :
//
//   · spot 358583a3 (Toyota RAV4, publié le 01/10) — Claude a renvoyé une
//     boîte PLAUSIBLE mais décalée en bas à gauche. Le floutage s'est appliqué
//     fidèlement sur le pare-chocs et le bitume ; « DM-107-SE » est resté net
//     et lisible en ligne. Chaque couche a rapporté un succès.
//   · spot 7b02c227 (Porsche Cayman S) — Claude encadrait l'enseigne
//     « Buffalo Grill » à l'arrière-plan.
//
// Le passage de Haiku à Sonnet (30/09) n'a rien changé : la Toyota est
// POSTÉRIEURE à ce correctif. Un modèle généraliste estime mal un rectangle,
// et surtout il échoue SILENCIEUSEMENT — une boîte fausse est indiscernable
// d'une boîte juste pour tout le reste du système.
//
// Le détecteur ci-dessous est entraîné pour cette seule tâche. Sur les mêmes
// photos il encadre la plaque exactement, et ne détecte rien là où il n'y a
// rien. Il tourne en local : aucun octet ne sort du serveur, aucun coût par
// photo, pas de quota, pas de latence réseau.
//
// ── MODÈLE ──
// ml-debi/yolov8-license-plate-detection · poids MIT · 12 Mo · ONNX.
// L'empreinte est vérifiée à chaque chargement : un détecteur décide de ce qui
// sera masqué, on ne l'exécute pas sans savoir que c'est bien celui qu'on a
// validé.
//
// ⚠️ LICENCE À TRANCHER AVANT EXPLOITATION COMMERCIALE
// Les poids sont MIT et seul `onnxruntime-node` (MIT) est chargé — le paquet
// `ultralytics` (AGPL-3.0) ne l'est jamais : on exécute un graphe, pas leur
// code. L'architecture YOLOv8 vient néanmoins de chez eux et la portée de
// l'AGPL sur des poids entraînés reste discutée. À faire valider.

import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'

export const MODEL_SHA =
  '85d236280a1301ad98907947d284951dd2b20c23a6786ff50f7e6a8ec515bd50'

const SIZE = 640

// ── SEUIL BAS, DÉLIBÉRÉMENT ──
// Pour un système de confidentialité le RAPPEL prime sur la précision :
// flouter une petite zone en trop ne coûte rien, manquer une plaque coûte la
// vie privée de quelqu'un. À 0,08 le détecteur trouve aussi les plaques
// secondaires (véhicules voisins) sans produire de faux positif sur les
// photos réellement sans plaque — vérifié sur les 33 photos du parc.
export const CONF = Number(process.env.PLATE_CONF || 0.08)
const IOU = 0.45

// Chemins candidats : en local le dépôt, sur Vercel la racine du bundle
// (`includeFiles` recopie `models/` à côté de la fonction).
const CANDIDATES = [
  new URL('../models/plate-yolov8.onnx', import.meta.url).pathname,
  '/var/task/models/plate-yolov8.onnx',
  'models/plate-yolov8.onnx',
]

let sessionPromise = null

/**
 * Charge le modèle UNE fois par instance (Vercel réutilise les instances
 * chaudes, donc le coût de chargement est amorti sur plusieurs publications).
 * Renvoie `null` si le modèle est absent ou altéré — l'appelant doit alors
 * traiter le cas comme un ÉCHEC de détection, jamais comme « aucune plaque ».
 */
export async function getSession() {
  if (sessionPromise) return sessionPromise
  sessionPromise = (async () => {
    const path = CANDIDATES.find((p) => {
      try {
        return existsSync(p)
      } catch {
        return false
      }
    })
    if (!path) {
      console.error('[plate-detect] modèle introuvable dans', CANDIDATES)
      return null
    }
    const buf = readFileSync(path)
    const sha = createHash('sha256').update(buf).digest('hex')
    if (sha !== MODEL_SHA) {
      console.error(`[plate-detect] empreinte inattendue : ${sha}`)
      return null
    }
    const ort = (await import('onnxruntime-node')).default
    return ort.InferenceSession.create(buf)
  })().catch((e) => {
    console.error('[plate-detect] chargement impossible :', e)
    return null
  })
  return sessionPromise
}

/**
 * Détecte les plaques sur une image.
 *
 * @param {Buffer} buf image JPEG/PNG/WebP
 * @param {object} sharpLib instance de `sharp` (injectée pour que ce module
 *   reste utilisable depuis un script comme depuis une fonction Vercel)
 * @returns {Promise<{plates: Array<{x,y,width,height,score}>, W: number, H: number} | null>}
 *   `null` signifie DÉTECTION IMPOSSIBLE — à ne jamais confondre avec un
 *   tableau vide, qui signifie « on a regardé, il n'y a rien ».
 */
export async function detectPlates(buf, sharpLib) {
  const session = await getSession()
  if (!session) return null

  const ort = (await import('onnxruntime-node')).default
  const { width: W, height: H } = await sharpLib(buf).metadata()
  if (!W || !H) return null

  // Letterbox : on préserve le rapport et on complète en gris, comme à
  // l'entraînement. Étirer l'image déplacerait les boîtes — c'est précisément
  // le genre de décalage qu'on cherche à éliminer.
  const scale = Math.min(SIZE / W, SIZE / H)
  const nw = Math.round(W * scale)
  const nh = Math.round(H * scale)
  const padX = Math.floor((SIZE - nw) / 2)
  const padY = Math.floor((SIZE - nh) / 2)
  const px = await sharpLib(buf)
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
    [session.inputNames[0]]: new ort.Tensor('float32', f, [1, 3, SIZE, SIZE]),
  })
  const t = out[session.outputNames[0]]
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

  const plates = keep.map((b) => {
    const x = (b.x - padX) / scale / W
    const y = (b.y - padY) / scale / H
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      width: Math.max(0, Math.min(1 - Math.max(0, x), b.w / scale / W)),
      height: Math.max(0, Math.min(1 - Math.max(0, y), b.h / scale / H)),
      score: b.score,
    }
  })
  return { plates, W, H }
}
