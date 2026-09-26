// Enables the Google OAuth provider on the Supabase project.
//   GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_SECRET=... node scripts/enable-google.mjs
// (or add both to .env.local). Get these from Google Cloud Console →
// APIs & Services → Credentials → OAuth 2.0 Client ID (Web application),
// whose "Authorized redirect URI" MUST be exactly:
//   https://<project-ref>.supabase.co/auth/v1/callback
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

const clientId =
  process.env.GOOGLE_OAUTH_CLIENT_ID ||
  pick(envText, 'GOOGLE_OAUTH_CLIENT_ID', '[^\\s\'"]+')
const secret =
  process.env.GOOGLE_OAUTH_SECRET ||
  pick(envText, 'GOOGLE_OAUTH_SECRET', '[^\\s\'"]+')

if (!ref || !token) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_ACCESS_TOKEN in .env.local')
  process.exit(1)
}
if (!clientId || !secret) {
  console.error(
    'Missing Google credentials. Provide GOOGLE_OAUTH_CLIENT_ID and ' +
      'GOOGLE_OAUTH_SECRET as env vars or in .env.local.',
  )
  process.exit(1)
}

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    external_google_enabled: true,
    external_google_client_id: clientId,
    external_google_secret: secret,
  }),
})
const body = await res.json()
console.log(`status ${res.status}`)
console.log('external_google_enabled   :', body.external_google_enabled)
console.log('external_google_client_id :', body.external_google_client_id)
process.exit(res.ok ? 0 : 2)
