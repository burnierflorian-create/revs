import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
// Env-pasted keys often carry a trailing newline/space or '=' padding;
// web-push then rejects them. Normalize to URL-safe base64, no padding.
function cleanKey(s: string | undefined): string {
  return (s || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}
const VAPID_PUBLIC = cleanKey(process.env.VAPID_PUBLIC_KEY)
const VAPID_PRIVATE = cleanKey(process.env.VAPID_PRIVATE_KEY)

type PrefKey = 'likes' | 'comments' | 'followers' | 'nearby' | 'streak'

function distanceKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!SUPABASE_URL || !SERVICE_ROLE || !VAPID_PUBLIC || !VAPID_PRIVATE) {
    res.status(500).json({ error: 'Push not configured (VAPID/Supabase env)' })
    return
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })

  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const {
    user_id,
    title,
    body: message,
    url,
    type,
    nearby,
  } = body as {
    user_id?: string
    title?: string
    body?: string
    url?: string
    type?: PrefKey
    nearby?: {
      lat: number
      lng: number
      radiusKm?: number
      excludeUserId?: string
    }
  }

  // Auth: a valid Supabase user token OR our internal cron key.
  const cronKey = process.env.CRON_SECRET
  const isCron =
    !!cronKey && req.headers['x-cron-key'] === cronKey
  if (!isCron) {
    const auth = req.headers.authorization || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    const { data: u } = token
      ? await admin.auth.getUser(token)
      : { data: { user: null } }
    if (!u?.user) {
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
  }

  if (!title) {
    res.status(400).json({ error: 'Missing title' })
    return
  }

  try {
  webpush.setVapidDetails(
    'mailto:contact@revs.app',
    VAPID_PUBLIC,
    VAPID_PRIVATE,
  )

  // Resolve target user ids.
  let targets: string[] = []
  if (user_id) {
    targets = [user_id]
  } else if (nearby) {
    const radius = nearby.radiusKm ?? 10
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('user_id')
      .limit(1000)
    const ids = [
      ...new Set(
        ((subs ?? []) as { user_id: string }[]).map((s) => s.user_id),
      ),
    ].filter((u) => u !== nearby.excludeUserId)
    for (const uid of ids.slice(0, 300)) {
      const { data: last } = await admin
        .from('spots')
        .select('lat, lng')
        .eq('user_id', uid)
        .order('created_at', { ascending: false })
        .limit(1)
      const s = last?.[0] as { lat: number; lng: number } | undefined
      if (
        s &&
        Number.isFinite(s.lat) &&
        Number.isFinite(s.lng) &&
        distanceKm(nearby.lat, nearby.lng, s.lat, s.lng) <= radius
      )
        targets.push(uid)
    }
  }
  if (targets.length === 0) {
    res.status(200).json({ sent: 0, reason: 'no targets' })
    return
  }

  // Respect per-type preferences (default = enabled if no row).
  if (type) {
    const { data: prefs } = await admin
      .from('notification_prefs')
      .select(`user_id, ${type}`)
      .in('user_id', targets)
    const off = new Set(
      ((prefs ?? []) as Record<string, unknown>[])
        .filter((p) => p[type] === false)
        .map((p) => p.user_id as string),
    )
    targets = targets.filter((t) => !off.has(t))
  }
  if (targets.length === 0) {
    res.status(200).json({ sent: 0, reason: 'prefs off' })
    return
  }

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .in('user_id', targets)

  const payload = JSON.stringify({ title, body: message ?? '', url: url ?? '/' })
  let sent = 0
  const dead: string[] = []
  await Promise.all(
    ((subs ?? []) as {
      id: string
      endpoint: string
      p256dh: string
      auth: string
    }[]).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        )
        sent += 1
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode
        if (code === 404 || code === 410) dead.push(s.id)
      }
    }),
  )
  if (dead.length) {
    await admin.from('push_subscriptions').delete().in('id', dead)
  }

  res.status(200).json({ sent, pruned: dead.length })
  } catch (e) {
    const err = e as { message?: string; stack?: string }
    console.error('[send-push] crashed:', err)
    res.status(500).json({
      error: err?.message || String(e),
      stack: (err?.stack || '').split('\n').slice(0, 5),
    })
  }
}
