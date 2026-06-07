import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import {
  F1_DRIVERS,
  F1_TEAMS,
  proxyImage,
  type F1Team,
  type F1Driver,
} from '../lib/f1team'

type Tab = 'teams' | 'drivers'

// Rendered both standalone (/f1-roster route) and embedded inside the
// Discover F1 sub-tab. `embedded` flips between a full-page layout
// with its own header and an inline-only grid.
export default function F1Roster({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('teams')

  const grid = (
    <div className="px-4 pb-8">
      {/* Écuries / Pilotes — Apple text nav (no pills) */}
      <div className="mb-5 flex gap-6 px-1">
        {(['teams', 'drivers'] as Tab[]).map((t) => {
          const active = tab === t
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="relative pb-2 text-sm transition-colors"
            >
              <span
                className={active ? 'font-medium text-fg' : 'font-normal text-fg2'}
              >
                {t === 'teams' ? 'Écuries' : 'Pilotes'}
              </span>
              {active && (
                <span className="absolute inset-x-0 -bottom-px h-px bg-fg" />
              )}
            </button>
          )
        })}
      </div>

      {tab === 'teams' ? <TeamsGrid teams={F1_TEAMS} /> : <DriversGrid />}
    </div>
  )

  if (embedded) return grid

  return (
    <div className="min-h-screen bg-bg pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 px-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="display-xl text-fg">Écuries &amp; Pilotes</h1>
      </div>
      {grid}
    </div>
  )
}

function TeamsGrid({ teams }: { teams: F1Team[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {teams.map((t) => (
        <TeamCard key={t.slug} team={t} />
      ))}
    </div>
  )
}

// Uniform jet card — no colour gradient, no giant background letters. The
// monoplace floats on the surface; the team name sits below in clean caps.
function TeamCard({ team }: { team: F1Team }) {
  const navigate = useNavigate()
  const [photoFailed, setPhotoFailed] = useState(false)
  const photoUrl = !photoFailed ? proxyImage(team.carPhoto) : undefined
  return (
    <button
      onClick={() => navigate(`/f1-team/${team.slug}`)}
      className="tappable group flex flex-col"
    >
      <div
        className="relative aspect-[5/4] w-full overflow-hidden rounded-xl"
        style={{
          background: 'rgb(var(--color-card))',
          border: '1px solid var(--color-border)',
        }}
      >
        {photoUrl && (
          <img
            src={photoUrl}
            alt={team.name}
            loading="lazy"
            onError={() => setPhotoFailed(true)}
            className="absolute inset-0 h-full w-full object-contain"
            style={{ padding: '14px' }}
          />
        )}
      </div>
      <span className="mt-2 line-clamp-1 text-center text-xs font-medium uppercase tracking-wide text-fg2">
        {team.name}
      </span>
    </button>
  )
}

function DriversGrid() {
  const navigate = useNavigate()
  return (
    <div className="grid grid-cols-2 gap-3">
      {F1_DRIVERS.map((d) => (
        <DriverCard
          key={d.slug}
          driver={d}
          onClick={() => navigate(`/f1-driver/${d.slug}`)}
        />
      ))}
    </div>
  )
}

// No bright coloured borders. The portrait fills the whole card (rounded
// corners), with the race number as a minimalist grey watermark just
// above the name.
function DriverCard({
  driver,
  onClick,
}: {
  driver: F1Driver
  onClick: () => void
}) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const photoUrl = !photoFailed ? proxyImage(driver.photo) : undefined

  return (
    <button
      onClick={onClick}
      className="tappable group relative aspect-[5/6] overflow-hidden rounded-md text-left"
      style={{
        background: 'rgb(var(--color-card))',
        border: '1px solid var(--color-border)',
      }}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={driver.name}
          loading="lazy"
          onError={() => setPhotoFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: 'center top' }}
        />
      ) : (
        driver.number !== null && (
          <div className="absolute inset-0 flex items-center justify-center font-display text-6xl font-black text-fg/10">
            {driver.number}
          </div>
        )
      )}

      {/* Bottom legibility gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/85 via-black/40 to-transparent"
      />

      {/* Race-number watermark + name (bottom-left) */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-2.5">
        {driver.number !== null && (
          <span className="font-display text-[13px] font-black leading-none text-white/45">
            #{driver.number}
          </span>
        )}
        <span className="line-clamp-1 font-display text-[14px] font-extrabold leading-tight tracking-tight text-white">
          {driver.name}
        </span>
      </div>
    </button>
  )
}
