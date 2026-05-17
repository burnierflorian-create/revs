// Static 2026 F1 calendar. Race dates are the official Sundays; the
// session times (FP/Quali) are the standard weekend layout derived from
// the race date — indicative, not to-the-minute official. `winners`
// holds recent known podium-toppers per circuit where confident;
// otherwise the detail page shows a neutral placeholder. Edit this file
// when the schedule or results change — no runtime API.

export type GpSession = {
  label: string
  // ISO datetime (UTC).
  date: string
}

export type GpWinner = {
  year: number
  driver: string
}

export type GrandPrix = {
  round: number
  name: string
  country: string
  flag: string
  circuit: string
  // Race day (Sunday), generic 13:00Z — countdown is d/h/m/s.
  date: string
  officialUrl: string
  winners?: GpWinner[]
}

const RACE_HERO =
  'https://images.unsplash.com/photo-1752959805242-0a7799902ae4?w=1200'

// Official F1 season hub (stable URL). Per-GP slugs change yearly so we
// link the season page rather than fabricate a per-race path.
const F1_2026 = 'https://www.formula1.com/en/racing/2026.html'

export const GP_2026: GrandPrix[] = [
  { round: 1, name: "GP d'Australie", country: 'Australie', flag: '🇦🇺', circuit: 'Albert Park, Melbourne', date: '2026-03-08T05:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Lando Norris' }, { year: 2024, driver: 'Carlos Sainz' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 2, name: 'GP de Chine', country: 'Chine', flag: '🇨🇳', circuit: 'Shanghai International Circuit', date: '2026-03-15T07:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Oscar Piastri' }, { year: 2024, driver: 'Max Verstappen' }, { year: 2019, driver: 'Lewis Hamilton' }] },
  { round: 3, name: 'GP du Japon', country: 'Japon', flag: '🇯🇵', circuit: 'Suzuka', date: '2026-03-29T05:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Max Verstappen' }, { year: 2024, driver: 'Max Verstappen' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 4, name: 'GP de Bahreïn', country: 'Bahreïn', flag: '🇧🇭', circuit: 'Bahrain International Circuit, Sakhir', date: '2026-04-12T15:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Oscar Piastri' }, { year: 2024, driver: 'Max Verstappen' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 5, name: "GP d'Arabie saoudite", country: 'Arabie saoudite', flag: '🇸🇦', circuit: 'Jeddah Corniche Circuit', date: '2026-04-19T17:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Oscar Piastri' }, { year: 2024, driver: 'Max Verstappen' }, { year: 2023, driver: 'Sergio Pérez' }] },
  { round: 6, name: 'GP de Miami', country: 'États-Unis', flag: '🇺🇸', circuit: 'Miami International Autodrome', date: '2026-05-03T19:30:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Oscar Piastri' }, { year: 2024, driver: 'Lando Norris' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 7, name: 'GP du Canada', country: 'Canada', flag: '🇨🇦', circuit: 'Circuit Gilles-Villeneuve, Montréal', date: '2026-05-24T18:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'George Russell' }, { year: 2024, driver: 'Max Verstappen' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 8, name: 'GP de Monaco', country: 'Monaco', flag: '🇲🇨', circuit: 'Circuit de Monaco', date: '2026-06-07T13:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Lando Norris' }, { year: 2024, driver: 'Charles Leclerc' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 9, name: "GP d'Espagne", country: 'Espagne', flag: '🇪🇸', circuit: 'Circuit de Barcelona-Catalunya', date: '2026-06-14T13:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Oscar Piastri' }, { year: 2024, driver: 'Max Verstappen' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 10, name: "GP d'Autriche", country: 'Autriche', flag: '🇦🇹', circuit: 'Red Bull Ring, Spielberg', date: '2026-06-28T13:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Lando Norris' }, { year: 2024, driver: 'George Russell' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 11, name: 'GP de Grande-Bretagne', country: 'Royaume-Uni', flag: '🇬🇧', circuit: 'Silverstone', date: '2026-07-05T14:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Lando Norris' }, { year: 2024, driver: 'Lewis Hamilton' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 12, name: 'GP de Belgique', country: 'Belgique', flag: '🇧🇪', circuit: 'Spa-Francorchamps', date: '2026-07-19T13:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Oscar Piastri' }, { year: 2024, driver: 'Lewis Hamilton' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 13, name: 'GP de Hongrie', country: 'Hongrie', flag: '🇭🇺', circuit: 'Hungaroring, Budapest', date: '2026-07-26T13:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Lando Norris' }, { year: 2024, driver: 'Oscar Piastri' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 14, name: 'GP des Pays-Bas', country: 'Pays-Bas', flag: '🇳🇱', circuit: 'Zandvoort', date: '2026-08-23T13:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Oscar Piastri' }, { year: 2024, driver: 'Lando Norris' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 15, name: "GP d'Italie", country: 'Italie', flag: '🇮🇹', circuit: 'Monza', date: '2026-09-06T13:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Max Verstappen' }, { year: 2024, driver: 'Charles Leclerc' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 16, name: 'GP de Madrid', country: 'Espagne', flag: '🇪🇸', circuit: 'Madring, Madrid', date: '2026-09-13T13:00:00Z', officialUrl: F1_2026 },
  { round: 17, name: "GP d'Azerbaïdjan", country: 'Azerbaïdjan', flag: '🇦🇿', circuit: 'Baku City Circuit', date: '2026-09-27T11:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Max Verstappen' }, { year: 2024, driver: 'Oscar Piastri' }, { year: 2023, driver: 'Sergio Pérez' }] },
  { round: 18, name: 'GP de Singapour', country: 'Singapour', flag: '🇸🇬', circuit: 'Marina Bay Street Circuit', date: '2026-10-11T12:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'George Russell' }, { year: 2024, driver: 'Lando Norris' }, { year: 2023, driver: 'Carlos Sainz' }] },
  { round: 19, name: 'GP des États-Unis', country: 'États-Unis', flag: '🇺🇸', circuit: 'Circuit of the Americas, Austin', date: '2026-10-25T19:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Max Verstappen' }, { year: 2024, driver: 'Charles Leclerc' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 20, name: 'GP de Mexico', country: 'Mexique', flag: '🇲🇽', circuit: 'Autódromo Hermanos Rodríguez', date: '2026-11-01T20:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Lando Norris' }, { year: 2024, driver: 'Carlos Sainz' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 21, name: 'GP de São Paulo', country: 'Brésil', flag: '🇧🇷', circuit: 'Interlagos', date: '2026-11-08T17:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Max Verstappen' }, { year: 2024, driver: 'Max Verstappen' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 22, name: 'GP de Las Vegas', country: 'États-Unis', flag: '🇺🇸', circuit: 'Las Vegas Strip Circuit', date: '2026-11-21T06:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Max Verstappen' }, { year: 2024, driver: 'George Russell' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 23, name: 'GP du Qatar', country: 'Qatar', flag: '🇶🇦', circuit: 'Lusail International Circuit', date: '2026-11-29T16:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Max Verstappen' }, { year: 2024, driver: 'Max Verstappen' }, { year: 2023, driver: 'Max Verstappen' }] },
  { round: 24, name: "GP d'Abu Dhabi", country: 'Émirats arabes unis', flag: '🇦🇪', circuit: 'Yas Marina Circuit', date: '2026-12-06T13:00:00Z', officialUrl: F1_2026, winners: [{ year: 2025, driver: 'Lando Norris' }, { year: 2024, driver: 'Lando Norris' }, { year: 2023, driver: 'Max Verstappen' }] },
]

export function gpByRound(round: number): GrandPrix | undefined {
  return GP_2026.find((g) => g.round === round)
}

export function circuitImage(_round: number): string {
  return RACE_HERO
}

// Build the standard race-weekend session layout from the race date:
// FP1/FP2 Friday, FP3/Quali Saturday, Race Sunday. Times are the usual
// slots relative to the race start — indicative.
export function sessionsFor(gp: GrandPrix): GpSession[] {
  const race = new Date(gp.date)
  const day = (offsetDays: number, h: number, m: number) => {
    const d = new Date(race)
    d.setUTCDate(d.getUTCDate() + offsetDays)
    d.setUTCHours(h, m, 0, 0)
    return d.toISOString()
  }
  return [
    { label: 'Essais libres 1', date: day(-2, 9, 30) },
    { label: 'Essais libres 2', date: day(-2, 13, 0) },
    { label: 'Essais libres 3', date: day(-1, 8, 30) },
    { label: 'Qualifications', date: day(-1, 12, 0) },
    { label: 'Course', date: gp.date },
  ]
}

export function fmtGpDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  }).format(new Date(iso))
}

export function fmtGpDateTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}
