import { useEffect, useState } from 'react'

type GP = {
  round: number
  name: string
  country: string
  flag: string
  circuit: string
  // Race day (Sunday). Time is a generic 13:00Z placeholder — the
  // countdown is day/hour/minute precision, not to-the-second accurate.
  date: string
}

// Static 2026 F1 calendar (official schedule, formula1.com /
// motorsport.com). No runtime API — edit this array if the schedule
// shifts.
const GP_2026: GP[] = [
  { round: 1, name: "GP d'Australie", country: 'Australie', flag: '🇦🇺', circuit: 'Albert Park, Melbourne', date: '2026-03-08T13:00:00Z' },
  { round: 2, name: 'GP de Chine', country: 'Chine', flag: '🇨🇳', circuit: 'Shanghai International Circuit', date: '2026-03-15T13:00:00Z' },
  { round: 3, name: 'GP du Japon', country: 'Japon', flag: '🇯🇵', circuit: 'Suzuka', date: '2026-03-29T13:00:00Z' },
  { round: 4, name: 'GP de Bahreïn', country: 'Bahreïn', flag: '🇧🇭', circuit: 'Bahrain International Circuit, Sakhir', date: '2026-04-12T13:00:00Z' },
  { round: 5, name: "GP d'Arabie saoudite", country: 'Arabie saoudite', flag: '🇸🇦', circuit: 'Jeddah Corniche Circuit', date: '2026-04-19T13:00:00Z' },
  { round: 6, name: 'GP de Miami', country: 'États-Unis', flag: '🇺🇸', circuit: 'Miami International Autodrome', date: '2026-05-03T13:00:00Z' },
  { round: 7, name: 'GP du Canada', country: 'Canada', flag: '🇨🇦', circuit: 'Circuit Gilles-Villeneuve, Montréal', date: '2026-05-24T13:00:00Z' },
  { round: 8, name: 'GP de Monaco', country: 'Monaco', flag: '🇲🇨', circuit: 'Circuit de Monaco', date: '2026-06-07T13:00:00Z' },
  { round: 9, name: "GP d'Espagne", country: 'Espagne', flag: '🇪🇸', circuit: 'Circuit de Barcelona-Catalunya', date: '2026-06-14T13:00:00Z' },
  { round: 10, name: "GP d'Autriche", country: 'Autriche', flag: '🇦🇹', circuit: 'Red Bull Ring, Spielberg', date: '2026-06-28T13:00:00Z' },
  { round: 11, name: 'GP de Grande-Bretagne', country: 'Royaume-Uni', flag: '🇬🇧', circuit: 'Silverstone', date: '2026-07-05T13:00:00Z' },
  { round: 12, name: 'GP de Belgique', country: 'Belgique', flag: '🇧🇪', circuit: 'Spa-Francorchamps', date: '2026-07-19T13:00:00Z' },
  { round: 13, name: 'GP de Hongrie', country: 'Hongrie', flag: '🇭🇺', circuit: 'Hungaroring, Budapest', date: '2026-07-26T13:00:00Z' },
  { round: 14, name: 'GP des Pays-Bas', country: 'Pays-Bas', flag: '🇳🇱', circuit: 'Zandvoort', date: '2026-08-23T13:00:00Z' },
  { round: 15, name: "GP d'Italie", country: 'Italie', flag: '🇮🇹', circuit: 'Monza', date: '2026-09-06T13:00:00Z' },
  { round: 16, name: 'GP de Madrid', country: 'Espagne', flag: '🇪🇸', circuit: 'Madring, Madrid', date: '2026-09-13T13:00:00Z' },
  { round: 17, name: "GP d'Azerbaïdjan", country: 'Azerbaïdjan', flag: '🇦🇿', circuit: 'Baku City Circuit', date: '2026-09-27T13:00:00Z' },
  { round: 18, name: 'GP de Singapour', country: 'Singapour', flag: '🇸🇬', circuit: 'Marina Bay Street Circuit', date: '2026-10-11T13:00:00Z' },
  { round: 19, name: 'GP des États-Unis', country: 'États-Unis', flag: '🇺🇸', circuit: 'Circuit of the Americas, Austin', date: '2026-10-25T13:00:00Z' },
  { round: 20, name: 'GP de Mexico', country: 'Mexique', flag: '🇲🇽', circuit: 'Autódromo Hermanos Rodríguez', date: '2026-11-01T13:00:00Z' },
  { round: 21, name: 'GP de São Paulo', country: 'Brésil', flag: '🇧🇷', circuit: 'Interlagos', date: '2026-11-08T13:00:00Z' },
  { round: 22, name: 'GP de Las Vegas', country: 'États-Unis', flag: '🇺🇸', circuit: 'Las Vegas Strip Circuit', date: '2026-11-21T13:00:00Z' },
  { round: 23, name: 'GP du Qatar', country: 'Qatar', flag: '🇶🇦', circuit: 'Lusail International Circuit', date: '2026-11-29T13:00:00Z' },
  { round: 24, name: "GP d'Abu Dhabi", country: 'Émirats arabes unis', flag: '🇦🇪', circuit: 'Yas Marina Circuit', date: '2026-12-06T13:00:00Z' },
]

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  }).format(new Date(iso))
}

export default function F1Calendar() {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const nextIndex = GP_2026.findIndex(
    (g) => new Date(g.date).getTime() >= now,
  )

  function countdown(iso: string): string {
    const diff = new Date(iso).getTime() - now
    if (diff <= 0) return ''
    const d = Math.floor(diff / 86400000)
    const h = Math.floor((diff % 86400000) / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    return `${d}j ${h}h ${m}min`
  }

  return (
    <section className="pb-2">
      <h2 className="py-3 text-lg font-semibold text-fg">Calendrier F1 2026</h2>
      <div className="space-y-2">
        {GP_2026.map((g, i) => {
          const isPast = new Date(g.date).getTime() < now
          const isNext = i === nextIndex
          return (
            <div
              key={g.round}
              className={`rounded-2xl border p-4 transition-colors ${
                isNext
                  ? 'border-accent bg-accent/10'
                  : isPast
                    ? 'border-white/5 bg-card opacity-40'
                    : 'border-white/5 bg-card'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xl leading-none">{g.flag}</span>
                  <span className="truncate font-semibold text-fg">
                    {g.name}
                  </span>
                </div>
                {isNext && (
                  <span className="flex-none rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold tracking-wide text-fg">
                    PROCHAIN
                  </span>
                )}
              </div>

              <p className="mt-1 text-xs text-fg/50">
                {g.country} · {g.circuit}
              </p>

              <div className="mt-2 flex items-center justify-between">
                <span
                  className={`text-sm ${isNext ? 'text-accent' : 'text-fg/60'}`}
                >
                  {fmtDate(g.date)}
                </span>
                {isNext && (
                  <span className="text-sm font-semibold text-accent">
                    {countdown(g.date)}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
