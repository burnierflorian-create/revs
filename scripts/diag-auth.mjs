// Read-only diagnostic: dumps the project's GoTrue auth config so we can
// see whether Google OAuth is enabled/configured and which redirect URLs
// are allow-listed. Never prints secrets in full — client secret and the
// access token are masked. Safe-parses .env.local (never executes it).
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

console.log(`Project ref: ${ref}`)
console.log(`Callback URL Google Cloud must allow: https://${ref}.supabase.co/auth/v1/callback\n`)

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  headers: { Authorization: `Bearer ${token}` },
})
if (!res.ok) {
  console.error(`config/auth failed: ${res.status} ${await res.text()}`)
  process.exit(2)
}
const c = await res.json()

const mask = (v) => (v ? `${String(v).slice(0, 6)}…(${String(v).length} chars)` : '(empty)')
console.log('── Google provider ──')
console.log('external_google_enabled     :', c.external_google_enabled)
console.log('external_google_client_id   :', c.external_google_client_id || '(empty)')
console.log('external_google_secret      :', mask(c.external_google_secret))
console.log('\n── Redirect / site URLs ──')
console.log('site_url                     :', c.site_url)
console.log('uri_allow_list               :', c.uri_allow_list || '(empty)')
console.log('\n── Signup gating ──')
console.log('disable_signup               :', c.disable_signup)
console.log('external_email_enabled       :', c.external_email_enabled)
console.log('mailer_autoconfirm           :', c.mailer_autoconfirm)
