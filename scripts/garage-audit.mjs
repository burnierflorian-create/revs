// ═══════ AUDIT DES GARAGE VISUALS — ÉTAT DU PARC ═══════
//
// Classe chaque identité canonique en VALID / NEEDS_REGENERATION / MISSING,
// sur des mesures et non des impressions : format réel du fichier, ratio, et
// part de la largeur occupée par le véhicule, lue par le contrôle de vision.
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import { canRender, cacheKey, GARAGE_VISUAL_VERSION } from '../server/garage-visual.js'
import { checkAngle, conformity, colourMismatch } from './garage-angle-check.mjs'
import { STANDARD, verdictFor } from './garage-standard.mjs'

const env = readFileSync('.env.local', 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const KEY = pick('GEMINI_API_KEY', '[^\\s]+')
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)

const { data: spots } = await db.from('spots').select('*')
const { data: renders } = await db.from('garage_renders').select('*')
const byKey = new Map(renders.map((r) => [r.cache_key, r]))

// Une IDENTITÉ = une clé canonique. Plusieurs utilisateurs, plusieurs spots,
// une seule image : c'est l'unité qui compte pour le coût comme pour l'audit.
const identities = new Map()
for (const s of spots) {
  const g = canRender(s)
  const k = cacheKey(s)
  const cur = identities.get(k) ?? { key: k, spots: [], users: new Set(), eligible: false, rep: s }
  cur.spots.push(s)
  cur.users.add(s.user_id)
  if (g.ok) { cur.eligible = true; cur.rep = s }
  identities.set(k, cur)
}

console.log(`identités canoniques : ${identities.size}  ·  spots : ${spots.length}`)
console.log(`standard : ratio ${STANDARD.ratioLabel} · véhicule ${STANDARD.minWidthPct}–${STANDARD.maxWidthPct} % de la largeur\n`)

const out = []
for (const id of identities.values()) {
  const vKey = `${id.key}|v${GARAGE_VISUAL_VERSION}`
  const row = byKey.get(vKey)
  const label = `${id.rep.brand} ${id.rep.model}`.slice(0, 30)
  if (!id.eligible) {
    out.push({ ...idSummary(id), statut: 'IDENTITÉ_NON_VALIDÉE' })
    continue
  }
  if (!row?.render_url || row.status !== 'ready') {
    out.push({ ...idSummary(id), statut: 'MISSING' })
    console.log(`  MISSING             ${label}`)
    continue
  }
  const res = await fetch(row.render_url)
  if (!res.ok) {
    out.push({ ...idSummary(id), statut: 'MISSING', note: `image HTTP ${res.status}` })
    console.log(`  MISSING (HTTP ${res.status})  ${label}`)
    continue
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const meta = await sharp(buf).metadata()
  const v = await checkAngle({ apiKey: KEY, bytes: buf })
  const verdict = v.ok
    ? verdictFor({ width: meta.width, height: meta.height, vision: v.verdict,
        expectedColour: id.key.split('|')[2], conformity, colourMismatch })
    : { statut: 'NEEDS_REGENERATION', raisons: ['contrôle de vision indisponible'] }
  out.push({ ...idSummary(id), url: row.render_url,
    px: `${meta.width}×${meta.height}`, ratio: +(meta.width / meta.height).toFixed(3),
    widthPct: v.verdict?.width_pct ?? null, vue: v.verdict?.view ?? null,
    peinture: v.verdict?.body_colour ?? null, ...verdict })
  console.log(`  ${verdict.statut.padEnd(19)} ${label.padEnd(32)} ${meta.width}×${meta.height} ratio=${(meta.width/meta.height).toFixed(2)} largeur=${String(v.verdict?.width_pct ?? '?').padStart(3)}%  ${verdict.raisons.join(', ')}`)
}

function idSummary(id) {
  return { key: id.key, marque: id.rep.brand, modele: id.rep.model,
    spots: id.spots.length, utilisateurs: id.users.size }
}

writeFileSync('scripts/.garage-audit.json', JSON.stringify(out, null, 2))
const by = (st) => out.filter((o) => o.statut === st).length
console.log(`\n── BILAN ──`)
for (const st of ['VALID', 'NEEDS_REGENERATION', 'MISSING', 'IDENTITÉ_NON_VALIDÉE']) {
  console.log(`  ${st.padEnd(22)} ${by(st)}`)
}
console.log(`\nspots couverts par une identité VALID : ${out.filter(o=>o.statut==='VALID').reduce((n,o)=>n+o.spots,0)}`)
