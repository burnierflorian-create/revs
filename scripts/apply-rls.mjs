// Applies a SQL migration to the live Supabase database.
//
//   node scripts/apply-rls.mjs [path-to.sql]   (default: supabase/fix-spots-rls.sql)
//
// DDL (CREATE/DROP POLICY) CANNOT go through the PostgREST data API, and
// the Supabase Management API rejects the project's service_role JWT.
// So this needs a Supabase **personal access token** ("sbp_...") in
// .env.local as SUPABASE_ACCESS_TOKEN (or SUPABASE_DB_TOKEN). That one
// token then lets every future migration run from code — no dashboard.
//
// Credentials are read from .env.local by safe regex parsing — the file
// is never executed and secrets are never printed.

import { readFileSync } from 'node:fs'

function loadEnv(path) {
  const out = {}
  let txt = ''
  try {
    txt = readFileSync(path, 'utf8')
  } catch {
    return out
  }
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = loadEnv(new URL('../.env.local', import.meta.url))
const sqlPath = process.argv[2] || 'supabase/fix-spots-rls.sql'
const sql = readFileSync(new URL(`../${sqlPath}`, import.meta.url), 'utf8')

const url = env.VITE_SUPABASE_URL
const ref = url ? new URL(url).hostname.split('.')[0] : null
const token = env.SUPABASE_ACCESS_TOKEN || env.SUPABASE_DB_TOKEN

if (!ref) {
  console.error('Missing VITE_SUPABASE_URL in .env.local')
  process.exit(1)
}
if (!token) {
  console.error(
    'No DDL token found. Add a Supabase personal access token to ' +
      '.env.local as SUPABASE_ACCESS_TOKEN=sbp_xxx (Supabase → Account ' +
      '→ Access Tokens). The service_role key cannot run DDL — this is ' +
      'a one-time setup; afterwards every migration applies from code.',
  )
  process.exit(1)
}

console.log(`Applying ${sqlPath} to project ${ref} …`)
const res = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/database/query`,
  {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  },
)

const body = await res.text()
console.log(`status ${res.status}`)
console.log(body.slice(0, 800))
process.exit(res.ok ? 0 : 2)
