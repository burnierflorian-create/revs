// ═══════ REMETTRE EN FILE LES RENDUS NON CONFORMES ═══════
//
// Lit le verdict de scripts/garage-audit.mjs et libère UNIQUEMENT les
// identités marquées NEEDS_REGENERATION : la ligne de cache est supprimée et
// les spots concernés repassent en repli photo le temps de la régénération.
//
// Les rendus VALID ne sont jamais touchés — c'est tout l'intérêt d'auditer
// avant de régénérer : on ne repaie pas ce qui est déjà bon.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { cacheKey, canRender, GARAGE_VISUAL_VERSION } from '../server/garage-visual.js'

const APPLY = process.argv.includes('--apply')
const env = readFileSync('.env.local', 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)

const audit = JSON.parse(readFileSync('scripts/.garage-audit.json', 'utf8'))
const todo = audit.filter((a) => a.statut === 'NEEDS_REGENERATION')
console.log(`à remettre en file : ${todo.length}`)
for (const a of todo) console.log(`  ${a.marque} ${a.modele}`.slice(0, 44).padEnd(46), a.raisons.join(', '))
if (!APPLY) {
  console.log('\nessai à blanc — relancer avec --apply')
  process.exit(0)
}

const { data: spots } = await db.from('spots').select('id, brand, model, color, ident_locked, ai_verified, garage_render_url')
let freedSpots = 0
for (const a of todo) {
  const vKey = `${a.key}|v${GARAGE_VISUAL_VERSION}`
  await db.from('garage_renders').delete().eq('cache_key', vKey)
  // Le fichier reste dans le bucket : il sera écrasé par le nouveau rendu
  // (upsert sur le même chemin). Le supprimer d'abord laisserait une fenêtre
  // où les spots pointent vers une image absente.
  for (const s of spots) {
    if (!canRender(s).ok) continue
    if (cacheKey(s) !== a.key) continue
    await db.from('spots').update({ garage_render_url: null }).eq('id', s.id)
    freedSpots += 1
  }
}
console.log(`\nlignes de cache supprimées : ${todo.length}  ·  spots repassés en repli : ${freedSpots}`)
