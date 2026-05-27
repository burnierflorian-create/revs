import { supabase } from './supabase'

export type LiveEvent = {
  id: string
  title: string
  location: string
  starts_at: string
  lat: number | null
  lng: number | null
  spot_count: number
}

export type EventLiveStats = {
  spot_count: number
  participant_count: number
  brand_count: number
}

export async function fetchLiveEvents(): Promise<LiveEvent[]> {
  const { data, error } = await supabase.rpc('live_events')
  if (error) {
    console.warn('[live] events failed:', error.message)
    return []
  }
  return (data ?? []) as LiveEvent[]
}

export async function fetchEventLiveStats(
  eventId: string,
): Promise<EventLiveStats | null> {
  const { data, error } = await supabase
    .rpc('event_live_stats', { p_event_id: eventId })
    .maybeSingle()
  if (error) {
    console.warn('[live] stats failed:', error.message)
    return null
  }
  return (data as EventLiveStats | null) ?? null
}
