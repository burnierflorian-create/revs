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

function readEnvText(path) {
  try {
    // Normalize literal "\n" written by echo/printf into real newlines
    // so a mangled append still parses.
    return readFileSync(path, 'utf8').replace(/\\n/g, '\n')
  } catch {
    return ''
  }
}

// Extract a value tolerantly: the var may have a leading "\n",
// surrounding quotes/spaces, or be glued after another line.
function pick(txt, name, valueRe) {
  const re = new RegExp(`${name}\\s*=\\s*['"]?\\s*(${valueRe})`, 'g')
  let best = ''
  for (const m of txt.matchAll(re)) if (m[1].length > best.length) best = m[1]
  return best
}

const envText = readEnvText(new URL('../.env.local', import.meta.url))
const sqlPath = process.argv[2] || 'supabase/fix-spots-rls.sql'
const sql = readFileSync(new URL(`../${sqlPath}`, import.meta.url), 'utf8')

const url =
  process.env.VITE_SUPABASE_URL ||
  pick(envText, 'VITE_SUPABASE_URL', 'https://[^\\s\'"]+')
const ref = url ? new URL(url).hostname.split('.')[0] : null
// Prefer an inline env var (so you can run it without editing files):
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/apply-rls.mjs
// From the file, take the LONGEST sbp_ match so a leftover truncated
// fragment never shadows the real token.
const token =
  process.env.SUPABASE_ACCESS_TOKEN ||
  process.env.SUPABASE_DB_TOKEN ||
  pick(envText, 'SUPABASE_ACCESS_TOKEN', 'sbp_[A-Za-z0-9_]+') ||
  pick(envText, 'SUPABASE_DB_TOKEN', 'sbp_[A-Za-z0-9_]+')

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
console.log(body.slice(0, 6000))
process.exit(res.ok ? 0 : 2)
