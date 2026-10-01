import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { proxyImage, type F1Team, type F1Driver } from '../lib/f1team'
import { useF1Grid } from '../lib/f1grid'
import { DriverHelmet, CarSilhouette } from '../components/F1Visual'
import { appConfig } from '../config/appConfig'
import { supabase } from '../lib/supabase'

type Tab = 'teams' | 'drivers' | 'results'

type ResultRow = {
  round: number
  race_name: string
  winner_name: string | null
  winner_team_slug: string | null
}

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
  // Live grid (mercato-accurate), synced from OpenF1. Falls back to the
  // static catalogue instantly, then swaps in the DB grid when it loads.
  const { teams, drivers } = useF1Grid()
  // Real constructor standings (points + championship position), synced
  // from Jolpica into f1_grid_teams. Replaces the old AI-estimated points.
  const [points, setPoints] = useState<Record<string, string>>({})
  const [positions, setPositions] = useState<Record<string, number>>({})
  /** Classement PILOTES — `f1_grid` porte déjà `points` et `position`,
   *  synchronisés depuis Jolpica. La donnée existait, elle n'était
   *  simplement pas affichée. */
  const [driverStand, setDriverStand] = useState<
    Record<string, { pts: number; pos: number }>
  >({})
  useEffect(() => {
    let active = true
    supabase
      .from('f1_grid')
      .select('driver_slug, points, position')
      .then(({ data }) => {
        if (!active || !data) return
        const m: Record<string, { pts: number; pos: number }> = {}
        for (const r of data as { driver_slug: string; points: number | null; position: number | null }[]) {
          if (r.points != null && r.position != null) {
            m[r.driver_slug] = { pts: r.points, pos: r.position }
          }
        }
        setDriverStand(m)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    let active = true
    supabase
      .from('f1_grid_teams')
      .select('team_slug, points, position')
      .then(({ data }) => {
        if (!active || !data) return
        const pts: Record<string, string> = {}
        const pos: Record<string, number> = {}
        for (const r of data as {
          team_slug: string
          points: number | null
          position: number | null
        }[]) {
          if (r.points != null) pts[r.team_slug] = String(r.points)
          if (r.position != null) pos[r.team_slug] = r.position
        }
        setPoints(pts)
        setPositions(pos)
      })
    return () => {
      active = false
    }
  }, [])

  // 2026 race winners (Jolpica), newest first.
  const [results, setResults] = useState<ResultRow[]>([])
  useEffect(() => {
    let active = true
    supabase
      .from('f1_results')
      .select('round, race_name, winner_name, winner_team_slug')
      .order('round', { ascending: false })
      .then(({ data }) => {
        if (active && data) setResults(data as ResultRow[])
      })
    return () => {
      active = false
    }
  }, [])

  // Order the grid by championship position when we have it (leader first),
  // falling back to the static catalogue order.
  const orderedTeams = useMemo(
    () =>
      [...teams].sort(
        (a, b) => (positions[a.slug] ?? 99) - (positions[b.slug] ?? 99),
      ),
    [teams, positions],
  )

  const grid = (
    <div className="px-4 pb-8">
      {/* Écuries / Pilotes — Apple text nav (no pills) */}
      <div className="mb-5 flex gap-6 px-1">
        {(['teams', 'drivers', 'results'] as Tab[]).map((tabKey) => {
          const active = tab === tabKey
          return (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className="relative pb-2 text-sm transition-colors"
            >
              <span
                className={active ? 'font-semibold text-fg' : 'font-normal text-fg2'}
              >
                {t(`f1gp.${tabKey}`)}
              </span>
              {/* Indicateur rouge REVS : l'onglet actif doit se repérer d'un
                  coup d'œil, sans relire les libellés. Un trait blanc se
                  confondait avec le texte. */}
              {active && (
                <span
                  className="absolute inset-x-0 -bottom-px h-[2px] rounded-full"
                  style={{
                    background: '#E8203A',
                    boxShadow: '0 0 10px rgba(232,32,58,0.5)',
                  }}
                />
              )}
            </button>
          )
        })}
      </div>

      {tab === 'teams' ? (
        <TeamsGrid teams={orderedTeams} points={points} positions={positions} />
      ) : tab === 'drivers' ? (
        <DriversGrid
          drivers={drivers}
          teamColor={Object.fromEntries(teams.map((tm) => [tm.slug, tm.color]))}
          standings={driverStand}
        />
      ) : (
        <ResultsList
          results={results}
          teamColor={Object.fromEntries(teams.map((tm) => [tm.slug, tm.color]))}
        />
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
  positions,
}: {
  teams: F1Team[]
  points: Record<string, string>
  positions: Record<string, number>
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {teams.map((t) => (
        <TeamCard key={t.slug} team={t} pts={points[t.slug]} pos={positions[t.slug]} />
      ))}
    </div>
  )
}

// #141414 card with a 3px left border in the team's official livery
// colour. The monoplace sits on top; a footer row carries the team name
// (white, bold) on the left and the championship points (red) on the right.
function TeamCard({ team, pts, pos }: { team: F1Team; pts?: string; pos?: number }) {
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
        {/* Position au championnat — affichée UNIQUEMENT si la donnée existe
            réellement. Un « P— » décoratif vaudrait moins que rien. */}
        {pos != null && (
          <span
            className="absolute left-2 top-2 z-10 rounded-md px-1.5 py-0.5 font-display text-[11px] font-black tabular-nums"
            style={{
              background: 'rgba(0,0,0,0.55)',
              border: `1px solid ${team.color}`,
              color: '#fff',
              backdropFilter: 'blur(4px)',
            }}
          >
            P{pos}
          </span>
        )}
        {appConfig.SHOW_F1_PHOTOS && photoUrl ? (
          <img
            src={photoUrl}
            alt={team.name}
            loading="lazy"
            onError={() => setPhotoFailed(true)}
            className="absolute inset-0 h-full w-full object-contain"
            style={{ padding: '14px' }}
          />
        ) : (
          <CarSilhouette
            color={team.color}
            className="absolute inset-0 h-full w-full p-5 opacity-95"
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

function DriversGrid({
  drivers,
  teamColor,
  standings,
}: {
  drivers: F1Driver[]
  teamColor: Record<string, string>
  standings: Record<string, { pts: number; pos: number }>
}) {
  const navigate = useNavigate()
  // Classés par position réelle quand elle existe ; les autres suivent.
  // Une grille de pilotes dans un ordre arbitraire n'apprend rien.
  const ordered = [...drivers].sort(
    (a, b) => (standings[a.slug]?.pos ?? 99) - (standings[b.slug]?.pos ?? 99),
  )
  return (
    <div className="grid grid-cols-2 gap-3">
      {ordered.map((d) => (
        <DriverCard
          key={d.slug}
          driver={d}
          color={teamColor[d.team] ?? '#888888'}
          standing={standings[d.slug]}
          onClick={() => navigate(`/f1-driver/${d.slug}`)}
        />
      ))}
    </div>
  )
}

function ResultsList({
  results,
  teamColor,
}: {
  results: ResultRow[]
  teamColor: Record<string, string>
}) {
  const { t } = useTranslation()
  if (results.length === 0) {
    return (
      <p className="px-1 py-8 text-center text-sm text-fg2">
        {t('f1gp.resultsEmpty')}
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {results.map((r) => {
        const color = (r.winner_team_slug && teamColor[r.winner_team_slug]) || '#888888'
        return (
          <div
            key={r.round}
            className="flex items-center gap-3 rounded-2xl bg-card p-3"
            style={{ border: '1px solid var(--color-border)', borderLeft: `3px solid ${color}` }}
          >
            <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full font-display text-[13px] font-black tabular-nums text-white/80"
              style={{ background: 'rgba(255,255,255,0.06)' }}>
              {r.round}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-extrabold tracking-tight text-fg">
                {r.race_name}
              </p>
              {r.winner_name && (
                <p className="mt-0.5 truncate text-[12px] text-fg2">
                  <span className="font-semibold" style={{ color }}>
                    {t('f1gp.winner')}
                  </span>{' '}
                  · {r.winner_name}
                </p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// No bright coloured borders. The portrait fills the whole card (rounded
// corners), with the race number as a minimalist grey watermark just
// above the name.
function DriverCard({
  driver,
  color,
  standing,
  onClick,
}: {
  driver: F1Driver
  color: string
  standing?: { pts: number; pos: number }
  onClick: () => void
}) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const photoUrl = !photoFailed ? proxyImage(driver.photo) : undefined

  return (
    <button
      onClick={onClick}
      className="tappable group relative aspect-[5/6] overflow-hidden rounded-md text-left"
      style={{
        background: `radial-gradient(120% 80% at 50% 18%, ${color}26 0%, rgb(var(--color-card)) 62%)`,
        border: '1px solid var(--color-border)',
      }}
    >
      {appConfig.SHOW_F1_PHOTOS && photoUrl ? (
        <img
          src={photoUrl}
          alt={driver.name}
          loading="lazy"
          onError={() => setPhotoFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: 'center top' }}
        />
      ) : (
        <DriverHelmet
          color={color}
          number={driver.number}
          className="absolute inset-0 h-full w-full pb-8 pt-3"
        />
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
        {/* Position et points — affichés UNIQUEMENT quand la donnée existe.
            Rien d'inventé : `f1_grid` les porte, synchronisés depuis Jolpica. */}
        {standing && (
          <span className="flex items-center gap-1.5 text-[11px] font-bold leading-none">
            <span style={{ color: '#E8203A' }}>P{standing.pos}</span>
            <span className="text-white/35">·</span>
            <span className="tabular-nums text-white/70">{standing.pts} pts</span>
          </span>
        )}
      </div>
    </button>
  )
}
