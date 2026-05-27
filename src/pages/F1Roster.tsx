import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Flag, Users } from 'lucide-react'
import {
  F1_DRIVERS,
  F1_TEAMS,
  flagEmoji,
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
      {/* Sub-toggle: Écuries / Pilotes */}
      <div className="mb-5 flex gap-2">
        <button
          onClick={() => setTab('teams')}
          className={`tappable flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold tracking-wide transition-colors ${
            tab === 'teams'
              ? 'bg-accent text-fg'
              : 'bg-card text-fg2 hover:text-fg'
          }`}
          style={
            tab === 'teams'
              ? undefined
              : { border: '1px solid var(--color-border)' }
          }
        >
          <Flag className="h-4 w-4" />
          Écuries
        </button>
        <button
          onClick={() => setTab('drivers')}
          className={`tappable flex flex-1 items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold tracking-wide transition-colors ${
            tab === 'drivers'
              ? 'bg-accent text-fg'
              : 'bg-card text-fg2 hover:text-fg'
          }`}
          style={
            tab === 'drivers'
              ? undefined
              : { border: '1px solid var(--color-border)' }
          }
        >
          <Users className="h-4 w-4" />
          Pilotes
        </button>
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

function TeamCard({ team }: { team: F1Team }) {
  const navigate = useNavigate()
  const [photoFailed, setPhotoFailed] = useState(false)
  const photoUrl = !photoFailed ? proxyImage(team.carPhoto) : undefined
  return (
    <button
      onClick={() => navigate(`/f1-team/${team.slug}`)}
      className="tappable group relative aspect-[5/4] overflow-hidden rounded-[20px] text-left"
      style={{
        background: `linear-gradient(140deg, ${team.color} 0%, ${team.color}55 60%, #0a0a0a 100%)`,
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Z-0 base: 3-letter code watermark BEHIND the car shot */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-2 -top-1 z-0 font-display text-[68px] font-black leading-none text-white/[0.10]"
      >
        {teamShortCode(team.name)}
      </div>

      {/* Z-10: car photo, contained with interior padding so the car
          never touches the card edges. Padding-bottom is bigger to
          clear the gradient + text overlay below. */}
      {photoUrl && (
        <img
          src={photoUrl}
          alt={team.name}
          loading="lazy"
          onError={() => setPhotoFailed(true)}
          className="absolute inset-0 z-10 h-full w-full object-contain"
          style={{
            objectPosition: 'center 38%',
            padding: '14px 14px 56px',
          }}
        />
      )}

      {/* Z-20: dark gradient on the bottom 50% so the name stays readable */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-1/2 bg-gradient-to-t from-black/95 via-black/50 to-transparent"
      />

      {/* Z-30: text overlay */}
      <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col gap-1 p-4">
        <span className="label-up text-[10px] text-white/65">F1 2026</span>
        <span className="line-clamp-2 font-display text-base font-extrabold leading-tight tracking-tighter text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">
          {team.name}
        </span>
      </div>
    </button>
  )
}

function DriversGrid() {
  const navigate = useNavigate()
  const teamColor = new Map(F1_TEAMS.map((t) => [t.slug, t.color]))
  return (
    <div className="grid grid-cols-2 gap-3">
      {F1_DRIVERS.map((d) => (
        <DriverCard
          key={d.slug}
          driver={d}
          color={teamColor.get(d.team) ?? '#333333'}
          onClick={() => navigate(`/f1-driver/${d.slug}`)}
        />
      ))}
    </div>
  )
}

function DriverCard({
  driver,
  color,
  onClick,
}: {
  driver: F1Driver
  color: string
  onClick: () => void
}) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const photoUrl = !photoFailed ? proxyImage(driver.photo) : undefined

  return (
    <button
      onClick={onClick}
      className="tappable group relative aspect-[5/6] overflow-hidden rounded-[20px] text-left"
      style={{
        background: `linear-gradient(165deg, ${color} 0%, ${color}66 50%, #0a0a0a 100%)`,
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      {/* Z-0 base: race-number watermark — always rendered. When the
          photo loads it covers the watermark; if the photo fails it
          stays visible as the fallback identity. */}
      {driver.number !== null && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-3 -top-4 z-0 font-display text-[120px] font-black leading-none text-white/[0.10]"
        >
          {driver.number}
        </div>
      )}

      {/* Z-10: photo (proxied), centred-top so the face is always
          framed near the top third regardless of source crop. */}
      {photoUrl && (
        <img
          src={photoUrl}
          alt={driver.name}
          loading="lazy"
          onError={() => setPhotoFailed(true)}
          className="absolute inset-0 z-10 h-full w-full object-cover"
          style={{ objectPosition: 'center top' }}
        />
      )}

      {/* Z-20: dark gradient — 40 % of the card height. Slightly
          softer than the 60 % version so more of the portrait is
          visible while the bottom row stays readable. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-2/5 bg-gradient-to-t from-black/95 via-black/55 to-transparent"
      />

      {/* Z-30: text overlay */}
      <div className="absolute inset-x-0 bottom-0 z-30 flex flex-col gap-1 p-3">
        <div className="flex items-center gap-1.5 text-[11px] text-white/85">
          <span aria-hidden>{flagEmoji(driver.country)}</span>
          {driver.number !== null && (
            <span className="font-extrabold tracking-wider">
              #{driver.number}
            </span>
          )}
        </div>
        <span className="line-clamp-2 font-display text-[15px] font-extrabold leading-tight tracking-tighter text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.7)]">
          {driver.name}
        </span>
      </div>
    </button>
  )
}

// 3-letter abbreviation used as a faded watermark on the team card.
// Avoids hardcoding logo URLs (Wikimedia / team-site assets are
// notoriously unstable). Falls back to the first 3 letters of the
// brand name.
function teamShortCode(name: string): string {
  const map: Record<string, string> = {
    'Red Bull Racing': 'RBR',
    Ferrari: 'SF',
    Mercedes: 'MER',
    McLaren: 'MCL',
    'Aston Martin': 'AMR',
    Alpine: 'ALP',
    Williams: 'WIL',
    Haas: 'HAA',
    'Racing Bulls': 'RB',
    'Kick Sauber': 'SAU',
  }
  return map[name] ?? name.slice(0, 3).toUpperCase()
}
