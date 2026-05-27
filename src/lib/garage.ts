import { supabase } from './supabase'

/** Fire the async garage-image generator. Best-effort: failures here
 *  don't bubble up — the worker also persists '' on failure, so the
 *  same spot won't keep retrying. */
export async function triggerGarageImage(spotId: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch('/api/car-info?action=garage-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ spot_id: spotId }),
    })
  } catch {
    // silent
  }
}

/** True when the value points to a usable, rendered image. NULL or ''
 *  both indicate "no garage image" — first means never attempted yet,
 *  second means attempted and gave up. UI treats both identically. */
export function hasGarageImage(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith('http')
}
