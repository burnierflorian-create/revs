// Fixes the project's auth redirect configuration:
//   • site_url        → the canonical prod URL (was localhost:3000)
//   • uri_allow_list  → prod + Vercel previews + local dev
// Without this, ANY redirectTo the app passes (OAuth return, password
// reset) is rejected and Supabase falls back to site_url = localhost,
// which breaks the flow in production. Google OAuth cannot work until
// the return URL is allow-listed.
//
// Does NOT touch the Google provider credentials — those are set
// separately once the Google Cloud OAuth client exists.
import { readFileSync } from 'node:fs'

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
const url =
  process.env.VITE_SUPABASE_URL ||
  pick(envText, 'VITE_SUPABASE_URL', 'https://[^\\s\'"]+')
const ref = url ? new URL(url).hostname.split('.')[0] : null
const token =
  process.env.SUPABASE_ACCESS_TOKEN ||
  process.env.SUPABASE_DB_TOKEN ||
  pick(envText, 'SUPABASE_ACCESS_TOKEN', 'sbp_[A-Za-z0-9_]+') ||
  pick(envText, 'SUPABASE_DB_TOKEN', 'sbp_[A-Za-z0-9_]+')

if (!ref || !token) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_ACCESS_TOKEN in .env.local')
  process.exit(1)
}

const SITE_URL = 'https://revs-ten.vercel.app'
const ALLOW_LIST = [
  'https://revs-ten.vercel.app',
  'https://revs-ten.vercel.app/**',
  'https://revs-*.vercel.app/**', // Vercel preview deploys
  'http://localhost:5173/**', // Vite dev
  'http://localhost:3000/**', // fallback dev port
].join(',')

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ site_url: SITE_URL, uri_allow_list: ALLOW_LIST }),
})
const body = await res.json()
console.log(`status ${res.status}`)
console.log('site_url       :', body.site_url)
console.log('uri_allow_list :', body.uri_allow_list)
process.exit(res.ok ? 0 : 2)
