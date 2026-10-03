// ═══════ ACTIVER OU COUPER LE CONTRÔLE AUTOMOBILE ═══════
//
// Les déclencheurs de `spots` et `stories` sont posés désactivés par la
// migration 0122 : les activer avant que le front déployé sache fournir un
// jeton casserait toute publication, y compris depuis une version de
// l'application encore ouverte sur un téléphone.
//
//   node scripts/image-gate.mjs etat
//   node scripts/image-gate.mjs activer
//   node scripts/image-gate.mjs couper
import { readFileSync } from 'node:fs'

const action = process.argv[2]
if (!['etat', 'activer', 'couper'].includes(action)) {
  console.error('usage : node scripts/image-gate.mjs <etat|activer|couper>')
  process.exit(1)
}
const env = readFileSync('.env.local', 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const REF = pick('VITE_SUPABASE_URL', '[^\\s]+').match(/https:\/\/([a-z]+)\./)[1]
const TOKEN = pick('SUPABASE_ACCESS_TOKEN', '[A-Za-z0-9._-]+')
async function q(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(JSON.stringify(j))
  return j
}

if (action !== 'etat') {
  const verb = action === 'activer' ? 'enable' : 'disable'
  await q(`alter table public.spots ${verb} trigger trg_validate_spot_image;
           alter table public.stories ${verb} trigger trg_validate_story_image;`)
}

// tgenabled : 'O' = actif, 'D' = désactivé.
const rows = await q(`
  select c.relname as table, t.tgname as trigger, t.tgenabled as state
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
  where t.tgname in ('trg_validate_spot_image', 'trg_validate_story_image')
  order by 1`)
for (const r of rows) {
  console.log(`${r.table.padEnd(8)} ${r.trigger.padEnd(28)} ${r.state === 'O' ? 'ACTIF' : 'coupé'}`)
}
