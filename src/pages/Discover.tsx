import { useEffect, useState } from 'react'
import {
  Flag,
  CarFront,
  Newspaper,
  CalendarDays,
  Users,
  Sparkles,
  Trophy,
} from 'lucide-react'
import News from './News'
import Meets from '../components/Meets'
import F1Calendar from '../components/F1Calendar'
import Brands from './Brands'
import F1Roster from './F1Roster'
// Spot Wars temporarily pulled from the MVP launch — the component,
// the 0032-spot-wars.sql migration and the spot_wars_leaderboard RPC
// stay on the DB so the feature can be re-enabled by re-adding the
// `wars` tab below + the `<SpotWars />` render branch.


type Universe = 'f1' | 'cars'

export default function Discover({ initial }: { initial?: 'events' }) {
  const [universe, setUniverse] = useState<Universe>(
    initial === 'events' ? 'cars' : 'f1',
  )
  const [f1Sub, setF1Sub] = useState<'actu' | 'calendar' | 'roster'>('actu')
  const [carsSub, setCarsSub] = useState<
    'actu' | 'events' | 'brands'
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
  const sub = isF1 ? f1Sub : carsSub

  // Unified glass pill 2026-06-02 — kills the dual red/orange tiles
  // wedged side-by-side. Inactive pills carry a neutral glass (no
  // brand colour), only the active one flips to the REVS gradient
  // (red → orange) so the selection reads like a single accent
  // statement rather than a coloured juxtaposition.
  const universeBtn = (u: Universe, label: string, icon: React.ReactNode) => {
    const active = universe === u
    return (
      <button
        onClick={() => setUniverse(u)}
        className={`tappable flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-xs transition-colors ${
          active ? 'font-black text-white' : 'font-bold text-neutral-400'
        }`}
        style={
          active
            ? {
                background:
                  'linear-gradient(90deg, #DC2626 0%, #F97316 100%)',
                boxShadow: '0 8px 24px rgba(220, 38, 38, 0.30)',
                border: '1px solid rgba(255, 255, 255, 0.10)',
              }
            : {
                background: 'var(--color-glass-mid)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                backdropFilter: 'saturate(160%) blur(8px)',
                WebkitBackdropFilter: 'saturate(160%) blur(8px)',
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
    else setCarsSub(k as 'actu' | 'events' | 'brands')
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

      {/* Sub-tabs — same unified glass language as the universe row.
          Active flips to the same REVS red→orange gradient (no more
          full-saturation block colour). Inactive stays in the neutral
          glass with a subtle bg-neutral-900/60. */}
      <div className="flex gap-2 px-4 pt-3">
        {subTabs.map((t) => {
          const active = sub === t.key
          return (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              className={`tappable flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs transition-colors ${
                active ? 'font-black text-white' : 'font-bold text-neutral-400'
              }`}
              style={
                active
                  ? {
                      background:
                        'linear-gradient(90deg, #DC2626 0%, #F97316 100%)',
                      boxShadow: '0 8px 24px rgba(220, 38, 38, 0.30)',
                      border: '1px solid rgba(255, 255, 255, 0.10)',
                    }
                  : {
                      background: 'var(--color-glass-mid)',
                      border: '1px solid rgba(255, 255, 255, 0.05)',
                      backdropFilter: 'saturate(160%) blur(8px)',
                      WebkitBackdropFilter: 'saturate(160%) blur(8px)',
                    }
              }
            >
              {t.icon}
              <span>{t.label}</span>
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
        ) : carsSub === 'events' ? (
          <Meets />
        ) : (
          <Brands embedded />
        )}
      </div>
    </div>
  )
}
