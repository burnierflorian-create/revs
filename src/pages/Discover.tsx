import { useEffect, useState } from 'react'
import { Flag, CarFront, Newspaper, CalendarDays, Users } from 'lucide-react'
import News from './News'
import Meets from '../components/Meets'
import F1Calendar from '../components/F1Calendar'

const RED = '#E63946'
const ORANGE = '#F59E0B'

type Universe = 'f1' | 'cars'

export default function Discover({ initial }: { initial?: 'events' }) {
  const [universe, setUniverse] = useState<Universe>(
    initial === 'events' ? 'cars' : 'f1',
  )
  const [f1Sub, setF1Sub] = useState<'actu' | 'calendar'>('actu')
  const [carsSub, setCarsSub] = useState<'actu' | 'events'>(
    initial === 'events' ? 'events' : 'actu',
  )

  // Discover is kept alive across /discover ↔ /events ↔ /actu — sync to
  // the route prop so navigating to /events from another tab correctly
  // switches the inner state instead of showing whatever was last open.
  useEffect(() => {
    if (initial === 'events') {
      setUniverse('cars')
      setCarsSub('events')
    }
  }, [initial])

  const isF1 = universe === 'f1'
  const color = isF1 ? RED : ORANGE
  const sub = isF1 ? f1Sub : carsSub

  const universeBtn = (u: Universe, label: string, icon: React.ReactNode) => {
    const c = u === 'f1' ? RED : ORANGE
    const active = universe === u
    return (
      <button
        onClick={() => setUniverse(u)}
        className="flex flex-1 items-center justify-center gap-2 rounded-2xl px-3 py-3 text-sm font-bold transition-colors"
        style={
          active
            ? { backgroundColor: c, color: '#0A0A0A' }
            : {
                backgroundColor: `${c}1A`,
                color: c,
                border: `1px solid ${c}55`,
              }
        }
      >
        {icon}
        <span>{label}</span>
      </button>
    )
  }

  const subTabs: { key: string; label: string; icon: React.ReactNode }[] = isF1
    ? [
        { key: 'actu', label: 'Actu F1', icon: <Newspaper className="h-4 w-4" /> },
        {
          key: 'calendar',
          label: 'Calendrier GP',
          icon: <CalendarDays className="h-4 w-4" />,
        },
      ]
    : [
        {
          key: 'actu',
          label: 'Actu Supercars',
          icon: <Newspaper className="h-4 w-4" />,
        },
        {
          key: 'events',
          label: 'Événements',
          icon: <Users className="h-4 w-4" />,
        },
      ]

  function setSub(k: string) {
    if (isF1) setF1Sub(k as 'actu' | 'calendar')
    else setCarsSub(k as 'actu' | 'events')
  }

  return (
    <div className="min-h-screen bg-bg pt-[max(1rem,env(safe-area-inset-top))]">
      {/* Niveau 1 — bascule entre les deux univers */}
      <div className="flex gap-2 px-4 pt-2">
        {universeBtn(
          'f1',
          'F1 & Motorsport',
          <Flag className="h-4 w-4" />,
        )}
        {universeBtn(
          'cars',
          'CarSpotting',
          <CarFront className="h-4 w-4" />,
        )}
      </div>

      {/* Bannière d'ambiance propre à l'univers */}
      <div className="px-4 pt-3">
        <div
          className="flex items-center gap-3 rounded-2xl border p-4"
          style={{
            borderColor: `${color}4D`,
            background: `linear-gradient(135deg, ${color}33, ${color}0D)`,
          }}
        >
          <div
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full"
            style={{ backgroundColor: `${color}26`, color }}
          >
            {isF1 ? (
              <Flag className="h-5 w-5" />
            ) : (
              <CarFront className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide"
                style={{ backgroundColor: color, color: '#0A0A0A' }}
              >
                {isF1 ? 'F1' : 'SPOT'}
              </span>
              <h1 className="truncate text-lg font-extrabold text-fg">
                {isF1 ? 'F1 & Motorsport' : 'CarSpotting'}
              </h1>
            </div>
            <p className="mt-0.5 text-[11px] text-fg/50">
              {isF1
                ? 'Le paddock — actus écuries & pilotes, calendrier 2026'
                : 'La rue & la passion — supercars, hypercars, meets'}
            </p>
          </div>
        </div>
      </div>

      {/* Sous-onglets de l'univers actif */}
      <div className="flex gap-2 px-4 pt-3">
        {subTabs.map((t) => {
          const active = sub === t.key
          return (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-semibold transition-colors"
              style={
                active
                  ? { backgroundColor: color, color: '#0A0A0A' }
                  : { backgroundColor: 'var(--color-card, #1A1A1A)' }
              }
            >
              <span style={active ? undefined : { color }}>{t.icon}</span>
              <span className={active ? '' : 'text-fg/60'}>{t.label}</span>
            </button>
          )
        })}
      </div>

      <div key={`${universe}-${sub}`} className="discover-fade pt-3">
        {isF1 ? (
          f1Sub === 'actu' ? (
            <News categories={['F1']} />
          ) : (
            <div className="px-4">
              <F1Calendar />
            </div>
          )
        ) : carsSub === 'actu' ? (
          <News categories={['Supercar', 'Hypercar']} />
        ) : (
          <Meets />
        )}
      </div>
    </div>
  )
}
