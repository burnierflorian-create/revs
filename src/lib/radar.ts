import { supabase } from './supabase'
import { getCurrentPositionSafe } from './geo'

export type RadarPrefs = {
  enabled: boolean
  radius_km: 5 | 10 | 20
  lat: number | null
  lng: number | null
  updated_at: string
}

export async function fetchMyRadarPrefs(): Promise<RadarPrefs | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('radar_prefs')
    .select('enabled, radius_km, lat, lng, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) {
    console.warn('[radar] fetch failed:', error.message)
    return null
  }
  return (data as RadarPrefs | null) ?? null
}

export async function saveRadarPrefs(
  patch: Partial<RadarPrefs>,
): Promise<RadarPrefs | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('radar_prefs')
    .upsert(
      { user_id: user.id, ...patch, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    .select('enabled, radius_km, lat, lng, updated_at')
    .single()
  if (error) {
    console.warn('[radar] save failed:', error.message)
    return null
  }
  return data as RadarPrefs
}

/** Browser geolocation as a Promise. Delegates to the shared
 *  hardened helper in lib/geo so radar callers get the same
 *  defensive callbacks + minifier-safe wrappers. */
export async function getCurrentPosition(): Promise<{ lat: number; lng: number }> {
  const pos = await getCurrentPositionSafe({
    highAccuracy: false,
    timeoutMs: 10_000,
    maxAgeMs: 60_000,
  })
  return { lat: pos.coords.latitude, lng: pos.coords.longitude }
}

/** Fire-and-forget radar fanout after a successful spot insert.
 *  Never throws — server-side failure shouldn't disrupt the publish flow. */
export async function triggerRadarFanout(spotId: string): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return
    await fetch('/api/send-push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ radar: { spot_id: spotId } }),
    })
  } catch {
    // silent — fanout is best-effort
  }
}
