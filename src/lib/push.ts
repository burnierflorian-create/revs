import { supabase } from './supabase'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as
  | string
  | undefined

const PROMPTED_KEY = 'revs_push_prompted'

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined' &&
    !!VAPID_PUBLIC
  )
}

// Ask permission + register the subscription. Returns true on success.
export async function enablePush(): Promise<boolean> {
  if (!pushSupported() || !VAPID_PUBLIC) return false
  try {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return false
    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          VAPID_PUBLIC,
        ) as unknown as BufferSource,
      }))
    const json = sub.toJSON() as {
      endpoint?: string
      keys?: { p256dh?: string; auth?: string }
    }
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user || !json.endpoint || !json.keys?.p256dh || !json.keys?.auth)
      return false
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      },
      { onConflict: 'endpoint' },
    )
    return !error
  } catch {
    return false
  }
}

// Prompt after the first spot. Only lock the "done" flag once the
// outcome is final (subscribed OK, or permission explicitly denied) —
// a transient failure (e.g. SW not ready yet) must be retryable.
export async function maybePromptPush(): Promise<void> {
  if (!pushSupported()) return
  try {
    if (localStorage.getItem(PROMPTED_KEY) === '1') return
    if (Notification.permission === 'denied') return
  } catch {
    /* ignore */
  }
  const ok = await enablePush()
  let denied = false
  try {
    denied = Notification.permission === 'denied'
  } catch {
    /* ignore */
  }
  if (ok || denied) {
    try {
      localStorage.setItem(PROMPTED_KEY, '1')
    } catch {
      /* ignore */
    }
  }
}

export async function myPseudo(): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 'Un spotter'
  const { data } = await supabase
    .from('profiles')
    .select('pseudo')
    .eq('user_id', user.id)
    .maybeSingle()
  return (
    (data?.pseudo as string | undefined)?.trim() ||
    (user.email ? user.email.split('@')[0] : 'Un spotter')
  )
}

// Fire-and-forget server send (authenticated with the caller's token).
export async function notifyPush(p: {
  user_id?: string
  title: string
  body?: string
  url?: string
  type?: 'likes' | 'comments' | 'followers' | 'nearby' | 'streak'
  nearby?: {
    lat: number
    lng: number
    radiusKm?: number
    excludeUserId?: string
  }
  brand_nearby?: {
    brand: string
    lat: number
    lng: number
    radiusKm?: number
    excludeUserId?: string
  }
}): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) return
    await fetch('/api/send-push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(p),
    })
  } catch {
    /* best-effort */
  }
}
