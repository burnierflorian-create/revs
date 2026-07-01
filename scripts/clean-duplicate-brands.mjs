// One-off cleanup: strip a duplicated leading brand from the model field.
// The full re-recognition sometimes returned model="Ferrari 488 Pista" (with
// the brand baked in) which then displays as "Ferrari Ferrari 488 Pista".
// This removes a leading "<brand> " (repeated) from the model. Pure DB — no
// AI, no photo download.
//
//   node scripts/clean-duplicate-brands.mjs            # apply
//   node scripts/clean-duplicate-brands.mjs --dry-run  # preview only
//
// Reads VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function readEnvText(path) {
  try {
    return readFileSync(path, 'utf8').replace(/\\n/g, '\n')
  } catch {
    return ''
  }
}
function pick(txt, name, valueRe) {
  const re = new RegExp(`${name}\\s*=\\s*['"]?\\s*(${valueRe})`, 'g')
  let best = ''
  for (const m of txt.matchAll(re)) if (m[1].length > best.length) best = m[1]
  return best
}
const envText = readEnvText(new URL('../.env.local', import.meta.url))
const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || pick(envText, 'VITE_SUPABASE_URL', 'https://[^\\s\'"]+')
const SERVICE_ROLE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  pick(envText, 'SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+')
if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const DRY_RUN = process.argv.includes('--dry-run')
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

// Remove a leading "<brand> " from the model, repeated (handles doubles).
function stripLeadingBrand(brand, model) {
  let m = (model ?? '').trim()
  const b = (brand ?? '').trim()
  if (!b || !m) return m
  const bl = b.toLowerCase()
  for (let i = 0; i < 3; i += 1) {
    if (m.toLowerCase().startsWith(bl + ' ')) m = m.slice(b.length).trim()
    else break
  }
  return m
}

const { data, error } = await supabase.from('spots').select('id, brand, model')
if (error) {
  console.error('fetch failed:', error.message)
  process.exit(1)
}
const spots = data ?? []
console.log(`${spots.length} spots à examiner${DRY_RUN ? ' (DRY RUN)' : ''}.\n`)

let changed = 0
let failed = 0
for (const s of spots) {
  const cleaned = stripLeadingBrand(s.brand, s.model)
  if (!cleaned || cleaned === (s.model ?? '').trim()) continue // nothing to do
  console.log(`  Spot ${s.id} : "${s.brand} ${s.model}" → "${s.brand} ${cleaned}"`)
  if (DRY_RUN) {
    changed += 1
    continue
  }
  const { error: uErr } = await supabase
    .from('spots')
    .update({ model: cleaned })
    .eq('id', s.id)
  if (uErr) {
    failed += 1
    console.log(`    ↳ DB error: ${uErr.message}`)
  } else changed += 1
}

console.log(
  `\nDone. ${changed} modèle(s) ${DRY_RUN ? 'à nettoyer' : 'nettoyé(s)'} · ${failed} échec(s).`,
)
