// Read-only backup of the tables the évolutive-cards migration will touch.
// Writes a timestamped JSON snapshot under backups/. Safe to run anytime.
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const env = readFileSync('.env.local', 'utf8').replace(/\\n/g, '\n')
const pick = (n) => { const m = env.match(new RegExp(`${n}\\s*=\\s*['"]?([^'"\\s]+)`)); return m ? m[1] : '' }
const sb = createClient(pick('VITE_SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
const stamp = process.argv[2] || 'manual'
const out = { at: stamp, tables: {} }
for (const t of ['spots', 'card_progress', 'xp_transactions']) {
  const { data, error } = await sb.from(t).select('*')
  if (error) { console.error(t, error.message); process.exit(1) }
  out.tables[t] = data
  console.log(`${t}: ${data.length} rows`)
}
const file = `backups/backup-cards-${stamp}.json`
writeFileSync(file, JSON.stringify(out, null, 2))
console.log('→ wrote', file)
