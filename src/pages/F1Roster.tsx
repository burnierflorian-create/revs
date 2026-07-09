import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import {
  F1_DRIVERS,
  F1_TEAMS,
  proxyImage,
  splitStatValue,
  type F1Team,
  type F1Driver,
} from '../lib/f1team'
import { supabase } from '../lib/supabase'

type Tab = 'teams' | 'drivers'

// Rendered both standalone (/f1-roster route) and embedded inside the
// Discover F1 sub-tab. `embedded` flips between a full-page layout
// with its own header and an inline-only grid.
export default function F1Roster({
  embedded = false,
}: {
  embedded?: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('teams')
  // Championship points per team, pulled from the cached f1_teams sheet
  // (public-read). currentPoints is a free-text Claude field, so we
  // extract the leading integer with splitStatValue.
  const [points, setPoints] = useState<Record<string, string>>({})
  useEffect(() => {
    let active = true
    supabase
      .from('f1_teams')
      .select('slug, data')
      .then(({ data }) => {
        if (!active || !data) return
        const m: Record<string, string> = {}
        for (const row of data as { slug: string; data: { currentPoints?: string } | null }[]) {
          const raw = row.data?.currentPoints
          if (raw) m[row.slug] = splitStatValue(raw).number
        }
        setPoints(m)
      })
    return () => {
      active = false
    }
  }, [])

  const grid = (
    <div className="px-4 pb-8">
      {/* Écuries / Pilotes — Apple text nav (no pills) */}
      <div className="mb-5 flex gap-6 px-1">
        {(['teams', 'drivers'] as Tab[]).map((tabKey) => {
          const active = tab === tabKey
          return (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className="relative pb-2 text-sm transition-colors"
            >
              <span
                className={active ? 'font-medium text-fg' : 'font-normal text-fg2'}
              >
                {tabKey === 'teams' ? t('f1gp.teams') : t('f1gp.drivers')}
              </span>
              {active && (
                <span className="absolute inset-x-0 -bottom-px h-px bg-fg" />
              )}
            </button>
          )
        })}
      </div>

      {tab === 'teams' ? (
        <TeamsGrid teams={F1_TEAMS} points={points} />
      ) : (
        <DriversGrid />
      )}
    </div>
  )

  if (embedded) return grid

  return (
    <div className="min-h-screen bg-bg pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 px-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('f1gp.back')}
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="display-xl text-fg">{t('f1gp.teamsAndDrivers')}</h1>
      </div>
      {grid}
    </div>
  )
}

function TeamsGrid({
  teams,
  points,
}: {
  teams: F1Team[]
  points: Record<string, string>
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {teams.map((t) => (
        <TeamCard key={t.slug} team={t} pts={points[t.slug]} />
      ))}
    </div>
  )
}

// #141414 card with a 3px left border in the team's official livery
// colour. The monoplace sits on top; a footer row carries the team name
// (white, bold) on the left and the championship points (red) on the right.
function TeamCard({ team, pts }: { team: F1Team; pts?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [photoFailed, setPhotoFailed] = useState(false)
  const photoUrl = !photoFailed ? proxyImage(team.carPhoto) : undefined
  const hasPts = pts && pts !== '—'
  return (
    <button
      onClick={() => navigate(`/f1-team/${team.slug}`)}
      className="tappable group flex flex-col overflow-hidden rounded-xl text-left"
      style={{
        background: '#141414',
        border: '1px solid rgba(255,255,255,0.06)',
        borderLeft: `3px solid ${team.color}`,
      }}
    >
      <div className="relative aspect-[5/4] w-full overflow-hidden">
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
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="line-clamp-1 text-[13px] font-bold text-white">
          {team.name}
        </span>
        <span
          className="flex-none font-display text-[13px] font-extrabold tabular-nums"
          style={{ color: hasPts ? '#E8203A' : 'rgba(255,255,255,0.25)' }}
        >
          {hasPts ? t('f1gp.points', { pts }) : '—'}
        </span>
      </div>
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
