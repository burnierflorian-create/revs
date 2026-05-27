import type { VercelRequest, VercelResponse } from '@vercel/node'

// Server-side image proxy for the Wikimedia driver portraits and team
// car shots used in /api/f1 ... grid cards. Wikimedia normally serves
// `Access-Control-Allow-Origin: *` for upload.wikimedia.org, but in
// practice some clients still get blocked (Referer policy, transient
// 429, or just a 404 on a stale URL). Going through this proxy:
//   - removes the browser as a variable (the server fetch always works
//     when the asset exists)
//   - lets us cache aggressively at the Vercel edge
//   - surfaces 404 vs 5xx clearly in our own logs
//
// Strict host allowlist — this endpoint MUST NOT become an open SSRF.

const ALLOWED_HOSTS = new Set([
  'upload.wikimedia.org',
  'commons.wikimedia.org',
])

export const config = { maxDuration: 15 }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = String(req.query.url ?? '')
  if (!raw) {
    res.status(400).json({ error: 'url manquante' })
    return
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    res.status(400).json({ error: 'URL invalide' })
    return
  }
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    res.status(403).json({ error: 'Source non autorisée' })
    return
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      // Wikimedia's terms require a descriptive User-Agent that points
      // back to the operating app — otherwise they may throttle.
      headers: {
        'User-Agent': 'revs-app/1.0 (https://revs-ten.vercel.app; contact@revs.app)',
        Accept: 'image/*',
      },
    })
    if (!upstream.ok) {
      console.warn('[image-proxy] upstream', upstream.status, raw)
      res.status(upstream.status).end()
      return
    }
    const contentType =
      upstream.headers.get('content-type') ?? 'image/jpeg'
    const buf = Buffer.from(await upstream.arrayBuffer())

    res.setHeader('Content-Type', contentType)
    // 24 h browser cache + s-maxage on the Vercel edge so the same
    // image only hits Wikimedia once a day, app-wide.
    res.setHeader(
      'Cache-Control',
      'public, max-age=86400, s-maxage=86400, immutable',
    )
    res.status(200).send(buf)
  } catch (e) {
    console.error('[image-proxy] fetch failed:', e, raw)
    res.status(502).json({ error: 'Proxy échoué' })
  }
}
