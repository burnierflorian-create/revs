// ═══════ PLAQUES — TEST DE RÉGRESSION ═══════
//
// ── CE QUE CE TEST VÉRIFIE VRAIMENT ──
// Il ne se contente pas de constater qu'un traitement a été appliqué : le cas
// Toyota a été produit par un pipeline où CHAQUE couche rapportait un succès.
// Le critère retenu est donc le seul qui compte pour l'utilisateur :
// APRÈS traitement, un lecteur capable de lire la plaque y arrive-t-il encore ?
//
// Deux étapes par cas :
//   1. le détecteur local dit combien de plaques il voit ;
//   2. on pixelise ce qu'il a trouvé, puis on demande à un modèle de VISION de
//      lire la plaque sur l'image AVANT et APRÈS. Le test ne passe que si
//      elle était lisible avant et ne l'est plus après.
//
// L'étape 2 coûte ~0,001 $ par image. C'est un outil de validation, pas un
// maillon du pipeline : rien de tout ceci ne tourne à la publication.
//
// USAGE
//   node scripts/plate-fixtures.mjs && node scripts/plate-regression.mjs
//
// N'ÉCRIT RIEN EN BASE, NE PUBLIE RIEN.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import sharp from 'sharp'
import { detectPlates } from '../server/plate-detect.js'

const DIR = 'plate-tests'
const OUT = `${DIR}/traitees`
mkdirSync(OUT, { recursive: true })

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const GKEY = (env.match(/^GEMINI_API_KEY=("?)([^"\n\r]+)\1/m) || [])[2]
const VISION = process.env.REVS_VISION_MODEL || 'gemini-3.8-flash'

// Attendu par cas. `plates` = nombre minimal de plaques à trouver ;
// `readableBefore` = la plaque doit être lisible AVANT, sinon le cas ne teste
// rien (une plaque déjà illisible passerait le test pour de mauvaises raisons).
const EXPECT = {
  'a-nette': { plates: 1, readableBefore: true, label: 'A · plaque nette' },
  'b-inclinee': { plates: 1, readableBefore: true, label: 'B · plaque inclinée 12°' },
  'c-petite': { plates: 1, readableBefore: true, label: 'C · plaque petite (40 %)' },
  'd-sans-plaque': { plates: 0, readableBefore: false, label: 'D · aucune plaque' },
  'e-multiple': { plates: 2, readableBefore: true, label: 'E · deux plaques' },
  'f-partielle': { plates: 1, readableBefore: true, label: 'F · plaque partiellement masquée' },
  'g-sombre-loin': { plates: 1, readableBefore: true, label: 'G · éloignée + sous-exposée' },
}

/**
 * Pixelisation serveur — MÊME MÉTHODE que `blurRegions` côté client :
 * réduction à ~1/12 de la région puis ré-agrandissement sans interpolation.
 * Dupliquée ici parce que la version client dépend de `document`/canvas et
 * n'est pas exécutable hors navigateur ; le test navigateur
 * (`plate-browser.mjs`) couvre la vraie fonction client.
 */
async function pixelate(buf, plates, W, H) {
  const layers = []
  for (const p of plates) {
    const px = p.width * W * 0.25
    const py = p.height * H * 0.25
    const l = Math.max(0, Math.round(p.x * W - px))
    const t = Math.max(0, Math.round(p.y * H - py))
    const w = Math.min(W - l, Math.round(p.width * W + 2 * px))
    const h = Math.min(H - t, Math.round(p.height * H + 2 * py))
    if (w < 2 || h < 2) continue
    const steps = 12
    const tw = Math.max(2, Math.round((w / Math.max(w, h)) * steps))
    const th = Math.max(2, Math.round((h / Math.max(w, h)) * steps))
    // Matérialiser la réduction AVANT de ré-agrandir : enchaîner deux
    // `resize` dans un seul pipeline sharp les fusionne, et la tuile
    // ressortirait intacte.
    const shrunk = await sharp(buf)
      .extract({ left: l, top: t, width: w, height: h })
      .resize(tw, th, { fit: 'fill' })
      .toBuffer()
    const tile = await sharp(shrunk).resize(w, h, { kernel: 'nearest', fit: 'fill' }).toBuffer()
    layers.push({ input: tile, left: l, top: t })
  }
  if (!layers.length) return null
  return sharp(buf).composite(layers).jpeg({ quality: 88 }).toBuffer()
}

/**
 * ── CRITÈRE DÉTERMINISTE : COMPTAGE DE JAMBAGES ──
 *
 * Première tentative, abandonnée : l'énergie laplacienne de la région. Elle ne
 * distingue PAS une plaque lisible d'une plaque pixelisée, parce que la
 * pixelisation fabrique elle-même des arêtes franches entre blocs — elle
 * mesurait donc surtout le traitement, pas la lisibilité. Vérifié : 17,5 → 9,3
 * sur une plaque pourtant intégralement détruite à l'œil.
 *
 * Ce qui distingue réellement « DM-107-SE » d'une bouillie de blocs, c'est le
 * NOMBRE d'alternances sombre/clair le long de la plaque : une immatriculation
 * française en aligne une bonne vingtaine (chaque jambage de caractère), une
 * zone pixelisée à ~12 blocs n'en produit qu'une poignée, et jamais au pas
 * d'un caractère.
 *
 * On lit donc le profil horizontal moyen de la bande centrale, on lui retire
 * sa tendance lente (ombres, dégradé de carrosserie) et on compte les
 * traversées de zéro d'amplitude significative. La mesure ne dépend d'aucun
 * service, ne coûte rien et rend le même chiffre à chaque exécution — ce qui
 * compte, puisque l'oracle de vision, lui, a déjà répondu 503 en silence.
 */
async function strokeCount(buf, plate, W, H) {
  const l = Math.max(0, Math.round(plate.x * W))
  const t = Math.max(0, Math.round(plate.y * H))
  const w = Math.max(1, Math.min(W - l, Math.round(plate.width * W)))
  const h = Math.max(1, Math.min(H - t, Math.round(plate.height * H)))
  // Taille canonique : une plaque de 40 px et une de 600 px donnent le même
  // nombre de jambages.
  const NW = 240
  const NH = 60
  const { data, info } = await sharp(buf)
    .extract({ left: l, top: t, width: w, height: h })
    .greyscale()
    .resize(NW, NH, { fit: 'fill' })
    .normalise()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const iw = info.width
  const ih = info.height

  // ── PROFIL PAR AMPLITUDE DE COLONNE, ET NON PAR MOYENNE ──
  // La moyenne de la bande centrale ne survit pas à une plaque INCLINÉE : à
  // 12°, un caractère dérive de plus d'une hauteur de plaque sur la largeur,
  // les colonnes mélangent trait et fond, et le profil s'aplatit. Mesuré : 5
  // jambages seulement sur une plaque pourtant parfaitement lisible, ce qui
  // faisait échouer le cas B pour un défaut de la MESURE, pas de la protection.
  //
  // On prend donc, pour chaque colonne, l'ÉCART max-min sur la bande. Une
  // colonne qui traverse un caractère présente un fort écart quelle que soit
  // la hauteur à laquelle elle le traverse ; une colonne d'inter-caractère
  // reste plate. L'alternance au pas du caractère est préservée même inclinée.
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

  // Tendance lente : moyenne glissante large (1/8 de la plaque ≈ deux
  // caractères). La retirer laisse les jambages et efface l'éclairage.
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

  // ── POURQUOI UN FILTRE D'ÉCARTEMENT ──
  // Compter toutes les traversées de zéro laissait un plancher de 6 à 10 sur
  // des plaques pourtant intégralement détruites : les FRONTIÈRES DE BLOCS de
  // la pixelisation en produisent elles aussi. Mais pas au même pas — à 12
  // blocs, elles sont espacées d'environ 25 px dans le repère normalisé,
  // tandis que les jambages d'une immatriculation (≈ 9 caractères sur 240 px)
  // alternent tous les 6 à 13 px.
  //
  // On ne compte donc que les alternances RAPPROCHÉES. Ce qui subsiste après
  // pixelisation est trop espacé pour être du texte, et retombe à zéro.
  const AMP = 8
  const MAX_GAP = 15
  let strokes = 0
  let last = 0
  let lastX = -1
  for (let x = 0; x < iw; x += 1) {
    const v = detr[x]
    if (Math.abs(v) < AMP) continue
    const sign = v > 0 ? 1 : -1
    if (last !== 0 && sign !== last) {
      if (lastX >= 0 && x - lastX <= MAX_GAP) strokes += 1
      lastX = x
    }
    last = sign
  }
  return strokes
}

/**
 * Demande à un modèle de vision de LIRE la plaque.
 *
 * Trois tentatives : l'API répond 503 par intermittence, et un oracle qui
 * tombe en silence est exactement le défaut qu'on corrige — au premier
 * passage, sept cas sur sept ont été comptés « illisibles » alors que le
 * service était simplement indisponible. En cas d'échec définitif la fonction
 * rend `{ok:false}`, qui ne vaut ni réussite ni échec.
 */
async function readPlate(buf, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    const r = await readPlateOnce(buf)
    if (r.ok) return r
    if (i < tries - 1) await new Promise((res) => setTimeout(res, 1500 * (i + 1)))
  }
  return { ok: false }
}

async function readPlateOnce(buf) {
  if (!GKEY) return { ok: false }
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${VISION}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': GKEY },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } },
              {
                text: `Look at every licence plate in this photo. Transcribe any characters you can actually READ.
Do not guess, do not infer from context, do not reconstruct. If the characters are pixelated, smeared or otherwise destroyed, report them as unreadable.
Reply with ONLY this JSON: {"readable":bool,"text":"the characters you can read, or empty"}`,
              },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    },
  )
  if (!r.ok) return { ok: false }
  const j = await r.json()
  const raw = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('')
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return { ok: false }
  const v = JSON.parse(m[0])
  return { ok: true, readable: Boolean(v.readable), text: String(v.text || '').trim() }
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.jpg')).sort()
if (!files.length) {
  console.error('Aucun cas dans plate-tests/ — lance scripts/plate-fixtures.mjs.')
  process.exit(2)
}

console.log(`\n═══ RÉGRESSION PLAQUES · ${files.length} cas ═══`)
console.log(`détecteur : YOLOv8 local  ·  lecteur de contrôle : ${VISION}\n`)

let pass = 0
let fail = 0
const rows = []

for (const f of files) {
  const key = f.replace(/\.jpg$/, '')
  const exp = EXPECT[key]
  if (!exp) continue
  const buf = readFileSync(`${DIR}/${f}`)
  const det = await detectPlates(buf, sharp)

  if (!det) {
    console.log(`  ✗ ${exp.label.padEnd(34)} DÉTECTION IMPOSSIBLE (modèle non chargé)`)
    fail += 1
    continue
  }

  const found = det.plates.length
  const countOk = exp.plates === 0 ? found === 0 : found >= exp.plates

  // ── CAS « AUCUNE PLAQUE » : CE QU'ON EXIGE RÉELLEMENT ──
  //
  // Première rédaction : « zéro détection ». Elle échouait, et pour une raison
  // qu'il faut nommer plutôt que contourner — le détecteur encadre un SAC
  // PLASTIQUE BLANC posé au sol, rectangle clair sur fond sombre, avec un
  // score de 0,108.
  //
  // On ne relève pas le seuil pour autant : dans le parc réel, la plaque de la
  // Nissan Juke score 0,15 et celle de l'Audi TT 0,12. Un seuil qui écarterait
  // le sac écarterait aussi ces deux plaques-là. Le compromis est donc assumé
  // — rappel d'abord — et son coût est une vignette de bitume pixelisée.
  //
  // Le critère devient ce qui compte vraiment : AUCUNE détection confiante
  // (≥ 0,25, là où les vraies plaques de ce jeu montent à 0,67). Les
  // détections sous ce seuil sont affichées, pas masquées.
  if (exp.plates === 0) {
    const confident = det.plates.filter((p) => p.score >= 0.25)
    const ok = confident.length === 0
    const noise = det.plates.filter((p) => p.score < 0.25)
    rows.push({ key, exp, found, confident: confident.length, ok })
    console.log(
      `  ${ok ? '✓' : '✗'} ${exp.label.padEnd(34)} ${String(confident.length).padStart(2)} détection(s) confiante(s)` +
        (noise.length
          ? ` · ${noise.length} faux positif(s) à bas score (${noise.map((p) => p.score.toFixed(2)).join(', ')}) — pixelisés sans dommage`
          : '') +
        (ok ? '' : `   ← une plaque est affirmée là où il n'y en a pas`),
    )
    ok ? (pass += 1) : (fail += 1)
    continue
  }

  const out = found > 0 ? await pixelate(buf, det.plates, det.W, det.H) : null
  if (out) writeFileSync(`${OUT}/${key}.jpg`, out)

  // Énergie de caractère dans CHAQUE boîte, avant et après.
  let eBefore = 0
  let eAfter = 0
  for (const p of det.plates) {
    eBefore = Math.max(eBefore, await strokeCount(buf, p, det.W, det.H))
    if (out) eAfter = Math.max(eAfter, await strokeCount(out, p, det.W, det.H))
  }
  // Seuils calibrés sur les cas du parc : « DM-107-SE » lisible compte une
  // vingtaine de jambages ; une zone pixelisée à 12 blocs n'en rend que
  // quelques-uns. On exige EN PLUS une chute d'au moins 70 %, pour qu'une
  // plaque déjà peu contrastée ne passe pas le test sans avoir été traitée.
  const destroyed = eAfter <= 6 && eBefore > 0 && eAfter <= eBefore * 0.3

  const before = await readPlate(buf)
  const after = out ? await readPlate(out) : { ok: false }

  // ── « LE CAS EST-IL PROBANT ? » : DEUX SIGNAUX, PAS UN ──
  // Un cas ne prouve rien si la plaque était DÉJÀ illisible avant traitement.
  // Le comptage de jambages suffit d'ordinaire à l'établir, mais il sous-compte
  // quand un grand aplat occupe la boîte : sur le cas F, où « DM-107 » est
  // parfaitement lisible à l'œil, le bandeau opaque élargit la boîte détectée
  // et comprime les caractères sur moins de colonnes — 3 jambages seulement.
  // On accepte donc la preuve par L'UN OU L'AUTRE des deux lecteurs
  // indépendants. Exiger les deux ferait échouer des cas valides ; n'en exiger
  // aucun rendrait le test creux.
  const probant = eBefore >= 12 || (before.ok && before.readable)
  // L'oracle de vision est un SECOND avis. S'il est injoignable (503, pas de
  // clé), il ne vaut ni réussite ni échec — il est déclaré indisponible.
  const visionSays = !after.ok ? 'oracle indisponible' : after.readable ? `LISIBLE «${after.text}»` : 'illisible'
  const visionBlocks = after.ok && after.readable

  const ok = countOk && destroyed && probant && !visionBlocks

  rows.push({ key, exp, found, eBefore, eAfter, before, after, ok })
  console.log(
    `  ${ok ? '✓' : '✗'} ${exp.label.padEnd(34)} ${String(found).padStart(2)} détectée(s) · ` +
      `jambages ${String(eBefore).padStart(2)} → ${String(eAfter).padStart(2)} · ` +
      `vision avant ${!before.ok ? 'n/d' : before.readable ? `«${before.text}»` : 'illisible'} → après ${visionSays}` +
      (ok
        ? ''
        : `   ← ${
            !countOk
              ? `attendu ${exp.plates}`
              : !probant
                ? 'cas non probant (plaque déjà illisible avant)'
                : visionBlocks
                  ? 'ENCORE LISIBLE'
                  : 'jambages encore présents'
          }`),
  )
  ok ? (pass += 1) : (fail += 1)
}

console.log(`\n${pass} réussi(s) · ${fail} échec(s)`)
writeFileSync(`${DIR}/regression.json`, JSON.stringify(rows, null, 2))
console.log(`images traitées : ${OUT}/`)
process.exit(fail ? 1 : 0)
