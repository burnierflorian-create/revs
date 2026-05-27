import { useEffect, useState } from 'react'
import {
  Flag,
  CarFront,
  Newspaper,
  CalendarDays,
  Users,
  Sparkles,
  Swords,
  Trophy,
} from 'lucide-react'
import News from './News'
import Meets from '../components/Meets'
import F1Calendar from '../components/F1Calendar'
import Brands from './Brands'
import F1Roster from './F1Roster'
import SpotWars from '../components/SpotWars'

const RED = '#E8203A'
const ORANGE = '#F59E0B'

type Universe = 'f1' | 'cars'

export default function Discover({ initial }: { initial?: 'events' }) {
  const [universe, setUniverse] = useState<Universe>(
    initial === 'events' ? 'cars' : 'f1',
  )
  const [f1Sub, setF1Sub] = useState<'actu' | 'calendar' | 'roster'>('actu')
  const [carsSub, setCarsSub] = useState<
    'actu' | 'events' | 'brands' | 'wars'
  >(initial === 'events' ? 'events' : 'actu')

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
        className="tappable flex flex-1 items-center justify-center gap-2 rounded-3xl px-3 py-3.5 text-sm font-extrabold tracking-wide transition-colors"
        style={
          active
            ? {
                backgroundColor: c,
                color: '#0A0A0A',
                boxShadow: `0 6px 24px ${c}40`,
              }
            : {
                backgroundColor: `${c}14`,
                color: c,
                border: `1px solid ${c}38`,
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
        { key: 'actu', label: 'Actu', icon: <Newspaper className="h-4 w-4" /> },
        {
          key: 'calendar',
          label: 'Calendrier',
          icon: <CalendarDays className="h-4 w-4" />,
        },
        {
          key: 'roster',
          label: 'Écuries & Pilotes',
          icon: <Trophy className="h-4 w-4" />,
        },
      ]
    : [
        {
          key: 'actu',
          label: 'Actu',
          icon: <Newspaper className="h-4 w-4" />,
        },
        {
          key: 'wars',
          label: 'Wars',
          icon: <Swords className="h-4 w-4" />,
        },
        {
          key: 'events',
          label: 'Events',
          icon: <Users className="h-4 w-4" />,
        },
        {
          key: 'brands',
          label: 'Marques',
          icon: <Sparkles className="h-4 w-4" />,
        },
      ]

  function setSub(k: string) {
    if (isF1) setF1Sub(k as 'actu' | 'calendar' | 'roster')
    else setCarsSub(k as 'actu' | 'events' | 'brands' | 'wars')
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

      {/* Sous-onglets de l'univers actif */}
      <div className="flex gap-2 px-4 pt-3">
        {subTabs.map((t) => {
          const active = sub === t.key
          return (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              className="tappable flex flex-1 items-center justify-center gap-1.5 rounded-full py-2.5 text-sm font-bold tracking-wide transition-colors"
              style={
                active
                  ? { backgroundColor: color, color: '#0A0A0A' }
                  : {
                      backgroundColor: 'var(--color-card)',
                      border: '1px solid var(--color-border)',
                    }
              }
            >
              <span style={active ? undefined : { color }}>{t.icon}</span>
              <span className={active ? '' : 'text-fg2'}>{t.label}</span>
            </button>
          )
        })}
      </div>

      <div key={`${universe}-${sub}`} className="discover-fade pt-3">
        {isF1 ? (
          f1Sub === 'actu' ? (
            <News categories={['F1']} />
          ) : f1Sub === 'calendar' ? (
            <div className="px-4">
              <F1Calendar />
            </div>
          ) : (
            <F1Roster embedded />
          )
        ) : carsSub === 'actu' ? (
          <News categories={['Supercar', 'Hypercar']} />
        ) : carsSub === 'wars' ? (
          <SpotWars />
        ) : carsSub === 'events' ? (
          <Meets />
        ) : (
          <Brands embedded />
        )}
      </div>
    </div>
  )
}
