export const EVENT_TYPES = [
  'Cars & Coffee',
  'Meeting',
  'Track Day',
  'Rallye',
  'Show',
  'Drive',
  'Autre',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export type CarEvent = {
  id: string
  organizer_id: string
  title: string
  type: string
  starts_at: string
  location: string
  description: string | null
  lat: number | null
  lng: number | null
  created_at: string
}

export function formatEventDate(iso: string): string {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(d)
  const cap = date.charAt(0).toUpperCase() + date.slice(1)
  const h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  return `${cap} · ${h}h${m}`
}
