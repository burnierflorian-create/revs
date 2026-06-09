import { useEffect, useState } from 'react'
import News from './News'
import Meets from '../components/Meets'
import F1Calendar from '../components/F1Calendar'
import Brands from './Brands'
import F1Roster from './F1Roster'
import { appConfig } from '../config/appConfig'
// Spot Wars temporarily pulled from the MVP launch — the component,
// the 0032-spot-wars.sql migration and the spot_wars_leaderboard RPC
// stay on the DB so the feature can be re-enabled by re-adding the
// `wars` tab below + the `<SpotWars />` render branch.


type Universe = 'f1' | 'cars'

export default function Discover({ initial }: { initial?: 'events' }) {
  // F1 universe is phase-gated. When SHOW_F1_MOTORSPORT is off we never
  // land on it: default to CarSpotting (the F1 code/components stay
  // intact, just unreachable from the UI).
  const [universe, setUniverse] = useState<Universe>(
    !appConfig.SHOW_F1_MOTORSPORT || initial === 'events' ? 'cars' : 'f1',
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

  const isF1 = appConfig.SHOW_F1_MOTORSPORT && universe === 'f1'
  const sub = isF1 ? f1Sub : carsSub

  // Apple News / Apple Sports nav: plain text, the active item in pure
  // white (charcoal in light) under a 1px underline; inactive in muted
  // grey. No pills, no gradients.
  const universeBtn = (u: Universe, label: string) => {
    const active = universe === u
    return (
      <button
        onClick={() => setUniverse(u)}
        className="relative pb-2 text-[15px] transition-colors"
      >
        <span className={active ? 'font-semibold text-fg' : 'font-normal text-fg2'}>
          {label}
        </span>
        {active && (
          <span className="absolute inset-x-0 -bottom-px h-px bg-fg" />
        )}
      </button>
    )
  }

  const subTabs: { key: string; label: string }[] = isF1
    ? [
        { key: 'actu', label: 'Actu' },
        { key: 'calendar', label: 'Calendrier' },
        { key: 'roster', label: 'Écuries & Pilotes' },
      ]
    : [
        { key: 'actu', label: 'Actu' },
        { key: 'events', label: 'Events' },
        { key: 'brands', label: 'Marques' },
      ]

  function setSub(k: string) {
    if (isF1) setF1Sub(k as 'actu' | 'calendar' | 'roster')
    else setCarsSub(k as 'actu' | 'events' | 'brands')
  }

  return (
    <div className="min-h-screen bg-bg pt-[max(1rem,env(safe-area-inset-top))]">
      {/* Niveau 1 — bascule univers (Apple text nav). The F1 & Motorsport
          tab is hidden while SHOW_F1_MOTORSPORT is off — only CarSpotting
          remains. */}
      <div className="flex gap-6 px-4 pt-2">
        {appConfig.SHOW_F1_MOTORSPORT && universeBtn('f1', 'F1 & Motorsport')}
        {universeBtn('cars', 'CarSpotting')}
      </div>

      {/* Sous-onglets — barre de texte brut façon Apple News. */}
      <div className="mt-1 flex gap-6 px-4 pt-3">
        {subTabs.map((t) => {
          const active = sub === t.key
          return (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              className="relative pb-2 text-sm transition-colors"
            >
              <span
                className={
                  active ? 'font-medium text-fg' : 'font-normal text-fg2'
                }
              >
                {t.label}
              </span>
              {active && (
                <span className="absolute inset-x-0 -bottom-px h-px bg-fg" />
              )}
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
