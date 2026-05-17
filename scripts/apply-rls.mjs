// Applies supabase/fix-spots-rls.sql to the live database.
//
// DDL (CREATE POLICY) cannot go through the PostgREST data API, so this
// uses the Supabase Management API SQL endpoint. It needs a token with
// DDL rights in SUPABASE_DB_TOKEN (a Supabase personal access token,
// "sbp_..."), falling back to SUPABASE_SERVICE_ROLE_KEY if that is what
// you have. Reads credentials from .env.local — never prints them.

import { readFileSync } from 'node:fs'

function loadEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const env = loadEnv(new URL('../.env.local', import.meta.url))
const sql = readFileSync(
  new URL('../supabase/fix-spots-rls.sql', import.meta.url),
  'utf8',
)

const url = env.VITE_SUPABASE_URL
const ref = url && new URL(url).hostname.split('.')[0]
const token = env.SUPABASE_DB_TOKEN || env.SUPABASE_SERVICE_ROLE_KEY

if (!ref || !token) {
  console.error('Missing VITE_SUPABASE_URL or a DB token in .env.local')
  process.exit(1)
}

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
console.log(body.slice(0, 600))
process.exit(res.ok ? 0 : 2)
