import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    res.status(500).json({ error: 'Server not configured' })
    return
  }

  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : ''
  if (!token) {
    res.status(401).json({ error: 'Missing token' })
    return
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })

  try {
    // Verify the caller's token and resolve their user id.
    const { data, error } = await admin.auth.getUser(token)
    if (error || !data.user) {
      res.status(401).json({ error: 'Invalid token' })
      return
    }
    // FKs are ON DELETE CASCADE, so spots/events/likes/xp/profile go too.
    const { error: delErr } = await admin.auth.admin.deleteUser(data.user.id)
    if (delErr) {
      res.status(500).json({ error: delErr.message })
      return
    }
    res.status(200).json({ deleted: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed'
    res.status(500).json({ error: message })
  }
}
