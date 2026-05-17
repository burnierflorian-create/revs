// Read-only news freshness probe. Prints count + newest article dates
// only — never secrets. Reads .env.local via safe regex parsing.
import { readFileSync } from 'node:fs'

function pick(name, re) {
  let txt = ''
  try {
    txt = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  } catch {
    return ''
  }
  const m = txt.match(new RegExp(`${name}\\s*=\\s*['"]?\\s*(${re})`))
  return m ? m[1] : ''
}

const url =
  process.env.VITE_SUPABASE_URL || pick('VITE_SUPABASE_URL', 'https://[^\\s\'"]+')
const key =
  process.env.VITE_SUPABASE_ANON_KEY || pick('VITE_SUPABASE_ANON_KEY', '[^\\s\'"]+')

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY')
  process.exit(1)
}

const res = await fetch(
  `${url}/rest/v1/news?select=title,category,published_at,created_at&order=created_at.desc&limit=8`,
  {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
    },
  },
)
const range = res.headers.get('content-range') || ''
const total = range.includes('/') ? range.split('/')[1] : '?'
const rows = await res.json()
console.log(`status ${res.status}  total=${total}`)
const now = Date.now()
for (const r of Array.isArray(rows) ? rows : []) {
  const stamp = r.created_at || r.published_at
  const ageH = stamp
    ? ((now - new Date(stamp).getTime()) / 3600000).toFixed(1)
    : '?'
  console.log(
    `[${r.category}] ${ageH}h  pub=${r.published_at ?? '—'}  ins=${r.created_at ?? '—'}  ${String(r.title).slice(0, 60)}`,
  )
}
