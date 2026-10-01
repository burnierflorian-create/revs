// ═══════════ AUDIT DE QUALITÉ DES GARAGE VISUALS ═══════════
//
// POURQUOI CE SCRIPT EXISTE
// Les 32 rendus en production ne viennent d'aucune IA générative : ils sortent
// de `scripts/detour-spot-photos.mjs`, un détourage local. Quand ce détourage
// échoue, il n'échoue pas en renvoyant une erreur — il renvoie une image. Une
// image qui garde le rétroviseur du photographe, un bras, une enseigne de
// commerce lisible, ou la voiture coupée au bord du cadre.
//
// Un œil humain repère ça en une seconde ; encore faut-il regarder les 32. Ce
// script applique à la place trois mesures objectives sur le canal alpha, et
// classe chaque rendu. Il ne remplace pas le jugement : il dit lesquels
// regarder.
//
// ── LES TROIS MESURES ──
// 1. COMPOSANTES CONNEXES. Une voiture proprement détourée forme UNE tache
//    opaque. Deux taches = la voiture plus autre chose — c'est exactement la
//    signature du rétroviseur du photographe.
// 2. BORDS TOUCHÉS. Un sujet qui touche plusieurs bords est coupé : pas de
//    marge, donc pas de composition possible (§10 du cahier des charges).
// 3. COUVERTURE. Au-delà de ~85 % d'opacité, rien n'a été retiré : le décor
//    d'origine est encore là. En dessous de ~12 %, le véhicule est minuscule.
//
// USAGE
//   node scripts/garage-render-audit.mjs                # mesure et classe
//   node scripts/garage-render-audit.mjs --quarantine   # retire les ratés
//   node scripts/garage-render-audit.mjs --restore      # annule le retrait
//
// `--quarantine` met `garage_render_url` à NULL : le Showroom retombe alors
// sur la photo du spot, qui reste la photo du spot. Rien n'est supprimé du
// stockage, et `--restore` rétablit tout depuis la sauvegarde.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const pick = (k, re) =>
  (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)

const QUARANTINE = process.argv.includes('--quarantine')
const RESTORE = process.argv.includes('--restore')
const BACKUP = new URL('../.garage-poc/quarantine.json', import.meta.url).pathname

// Seuils. Volontairement larges : le but est de repérer les ratés francs,
// pas de noter finement. Un rendu « à vérifier » reste en ligne.
const MIN_COVERAGE = 0.12
const MAX_COVERAGE = 0.85
const BLOB_MIN_SHARE = 0.015 // une tache sous 1,5 % du cadre est du bruit
const W = 180 // largeur d'analyse ; le détail fin n'apporte rien ici

// ─────────────── Restauration ───────────────
if (RESTORE) {
  if (!existsSync(BACKUP)) {
    console.error('Aucune sauvegarde à restaurer.')
    process.exit(1)
  }
  const saved = JSON.parse(readFileSync(BACKUP, 'utf8'))
  let n = 0
  for (const [id, url] of Object.entries(saved)) {
    const { error } = await db
      .from('spots')
      .update({ garage_render_url: url })
      .eq('id', id)
    if (!error) n += 1
  }
  console.log(`${n} rendu(s) rétabli(s).`)
  process.exit(0)
}

/**
 * Compte les taches opaques d'au moins `BLOB_MIN_SHARE` du cadre.
 * Parcours en largeur sur un masque binaire — pas de dépendance, et à
 * 180 px de large le coût est négligeable.
 */
function blobs(mask, w, h) {
  const seen = new Uint8Array(w * h)
  const found = []
  const stack = new Int32Array(w * h)
  for (let i = 0; i < w * h; i += 1) {
    if (!mask[i] || seen[i]) continue
    let top = 0
    stack[top++] = i
    seen[i] = 1
    let size = 0
    let minX = w, maxX = 0, minY = h, maxY = 0
    while (top > 0) {
      const p = stack[--top]
      const x = p % w
      const y = (p / w) | 0
      size += 1
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      // 4-connexité : suffisant, et évite de relier deux objets qui ne se
      // touchent que par un coin de pixel.
      if (x > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[top++] = p - 1 }
      if (x < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[top++] = p + 1 }
      if (y > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[top++] = p - w }
      if (y < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[top++] = p + w }
    }
    found.push({ size, minX, maxX, minY, maxY })
  }
  return found.sort((a, b) => b.size - a.size)
}

async function measure(url) {
  const res = await fetch(url)
  if (!res.ok) return { error: `HTTP ${res.status}` }
  const buf = Buffer.from(await res.arrayBuffer())
  const img = sharp(buf)
  const meta = await img.metadata()
  const { data, info } = await img
    .resize({ width: W, fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const w = info.width
  const h = info.height
  const ch = info.channels
  const mask = new Uint8Array(w * h)
  let opaque = 0
  for (let i = 0; i < w * h; i += 1) {
    // Seuil haut : les franges semi-transparentes du détourage ne comptent pas
    // comme du sujet, sinon tout se retrouve relié en une seule tache.
    const a = data[i * ch + ch - 1]
    if (a > 160) { mask[i] = 1; opaque += 1 }
  }
  const coverage = opaque / (w * h)
  const parts = blobs(mask, w, h).filter((b) => b.size / (w * h) >= BLOB_MIN_SHARE)
  const main = parts[0]

  // Bords touchés par la tache principale (2 px de tolérance).
  let edges = 0
  if (main) {
    if (main.minX <= 2) edges += 1
    if (main.maxX >= w - 3) edges += 1
    if (main.minY <= 2) edges += 1
    if (main.maxY >= h - 3) edges += 1
  }

  return {
    px: `${meta.width}×${meta.height}`,
    kb: Math.round(buf.length / 1024),
    coverage,
    parts: parts.length,
    secondShare: parts[1] ? parts[1].size / (w * h) : 0,
    edges,
  }
}

function verdict(m) {
  const why = []
  if (m.error) return { level: 'ERREUR', why: [m.error] }
  if (m.parts > 1) why.push(`${m.parts} objets détourés (parasite probable)`)
  if (m.coverage > MAX_COVERAGE) why.push(`décor conservé (${Math.round(m.coverage * 100)}% opaque)`)
  if (m.coverage < MIN_COVERAGE) why.push(`véhicule minuscule (${Math.round(m.coverage * 100)}%)`)
  if (m.edges >= 3) why.push(`coupé sur ${m.edges} bords`)
  if (why.length) return { level: 'À RETIRER', why }
  if (m.edges === 2) return { level: 'à vérifier', why: ['touche 2 bords'] }
  return { level: 'acceptable', why: [] }
}

// ─────────────── Exécution ───────────────
const { data: spots, error } = await db
  .from('spots')
  .select('id, brand, model, color, garage_render_url')
  .not('garage_render_url', 'is', null)
  .order('created_at', { ascending: false })
if (error) throw error

console.log(`rendus à auditer : ${spots.length}\n`)
const rows = []
for (const s of spots) {
  const m = await measure(s.garage_render_url)
  const v = verdict(m)
  rows.push({ s, m, v })
  const name = `${s.brand} ${s.model}`.slice(0, 38).padEnd(38)
  const stat = m.error
    ? m.error
    : `${m.px.padEnd(10)} ${String(Math.round(m.coverage * 100)).padStart(3)}%  ${m.parts} obj  ${m.edges} bords`
  console.log(`${v.level === 'acceptable' ? '✓' : v.level === 'à vérifier' ? '·' : '✗'} ${name} ${stat}`)
  if (v.why.length) console.log(`    ↳ ${v.why.join(' · ')}`)
}

const bad = rows.filter((r) => r.v.level === 'À RETIRER')
const warn = rows.filter((r) => r.v.level === 'à vérifier')
const good = rows.filter((r) => r.v.level === 'acceptable')
console.log(`\n═══ BILAN ═══`)
console.log(`acceptables  : ${good.length}`)
console.log(`à vérifier   : ${warn.length}`)
console.log(`à retirer    : ${bad.length}`)

if (!QUARANTINE) {
  console.log('\n(mesure seule — relance avec --quarantine pour retirer les ratés)')
  process.exit(0)
}

mkdirSync(new URL('../.garage-poc/', import.meta.url).pathname, { recursive: true })
const backup = existsSync(BACKUP) ? JSON.parse(readFileSync(BACKUP, 'utf8')) : {}
let n = 0
for (const r of bad) {
  backup[r.s.id] = r.s.garage_render_url
  const { error: e } = await db
    .from('spots')
    .update({ garage_render_url: null })
    .eq('id', r.s.id)
  if (!e) n += 1
}
writeFileSync(BACKUP, JSON.stringify(backup, null, 2))
console.log(`\n${n} rendu(s) retiré(s). Le Showroom retombe sur la photo du spot.`)
console.log(`Sauvegarde : ${BACKUP} — rétablir avec --restore.`)
