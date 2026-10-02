import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin } from 'lucide-react'
import { proxyImage, type F1Team, type F1Driver } from '../lib/f1team'
import { useF1Grid } from '../lib/f1grid'
import { DriverHelmet, CarSilhouette } from '../components/F1Visual'
import { appConfig } from '../config/appConfig'
import { supabase } from '../lib/supabase'
import {
  RankBadge,
  RowChevron,
  ScoreBar,
  SectionTitle,
  TeamCrest,
} from '../components/discover/kit'

type Tab = 'teams' | 'drivers' | 'results'

type ResultRow = {
  round: number
  race_name: string
  date: string | null
  winner_slug: string | null
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
      .select('round, race_name, date, winner_slug, winner_name, winner_team_slug')
      .order('round', { ascending: false })
      .then(({ data }) => {
        if (active && data) setResults(data as ResultRow[])
      })
    return () => {
      active = false
    }
  }, [])

  /** Portrait du vainqueur d'une manche, par son slug de pilote.
   *  Les résultats et la grille viennent de deux tables distinctes mais
   *  partagent ce slug — pas besoin d'une colonne de photo dans
   *  `f1_results`, qui serait une seconde copie à maintenir. */
  const winnerPhoto = useMemo(() => {
    const bySlug = new Map(drivers.map((d) => [d.slug as string, d.photo]))
    return (slug: string | null) => {
      const raw = slug ? bySlug.get(slug) : undefined
      return raw ? proxyImage(raw) : undefined
    }
  }, [drivers])

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
      {/* Écuries / Pilotes / Résultats.
          La planche montre ces trois contenus sous le MÊME état d'onglet
          « Écuries & Pilotes », chacun partant du haut de l'écran. Deux
          lectures étaient possibles : trois sections d'un même défilement,
          ou trois vues. Les trois vues sont conservées — en une seule page,
          dix écuries, vingt-deux pilotes et onze résultats feraient une
          colonne de quarante-trois lignes à parcourir pour atteindre la
          dernière. Les libellés passent en pastilles pour s'accorder au
          niveau supérieur. */}
      <div className="mb-4 flex gap-2">
        {(['teams', 'drivers', 'results'] as Tab[]).map((tabKey) => {
          const active = tab === tabKey
          return (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              aria-pressed={active}
              className="tappable flex-none rounded-full px-4 py-1.5 text-[13px] transition-colors"
              style={
                active
                  ? {
                      background: 'var(--revs-red)',
                      color: '#fff',
                      fontWeight: 700,
                      boxShadow: '0 2px 12px rgb(var(--color-accent) / 0.4)',
                    }
                  : {
                      background: 'rgb(var(--color-fg) / 0.05)',
                      color: 'rgb(var(--color-fg-2))',
                      fontWeight: 500,
                    }
              }
            >
              {t(`f1gp.${tabKey}`)}
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
          teamName={Object.fromEntries(teams.map((tm) => [tm.slug, tm.name]))}
          standings={driverStand}
        />
      ) : (
        <ResultsList
          results={results}
          teamColor={Object.fromEntries(teams.map((tm) => [tm.slug, tm.color]))}
          photoOf={winnerPhoto}
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
    <>
      <SectionTitle>{`Écuries ${new Date().getFullYear()}`}</SectionTitle>
      <div className="grid grid-cols-3 gap-2.5">
        {teams.map((t) => (
          <TeamCard key={t.slug} team={t} pts={points[t.slug]} pos={positions[t.slug]} />
        ))}
      </div>
    </>
  )
}

/**
 * Carte d'écurie — la vignette de la planche.
 *
 * Trois écarts avec la version précédente, tous repris de la référence :
 *  · la bordure prend la couleur de la livrée sur les QUATRE côtés, au lieu
 *    d'un seul filet à gauche. C'est ce qui fait reconnaître l'écurie avant
 *    d'avoir lu son nom ;
 *  · le fond est un dégradé teinté de cette même couleur, et non un gris
 *    uniforme — les dix cartes se distinguaient auparavant par leur seule
 *    photo ;
 *  · les points passent à la couleur de l'écurie. Ils étaient tous rouges,
 *    ce qui faisait dix fois le rouge REVS sur un écran qui parle de dix
 *    identités différentes.
 *
 * La pastille de position disparaît : la grille est déjà triée par position,
 * donc le rang se lit dans l'ordre de lecture.
 */
function TeamCard({ team, pts }: { team: F1Team; pts?: string; pos?: number }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [photoFailed, setPhotoFailed] = useState(false)
  const photoUrl = !photoFailed ? proxyImage(team.carPhoto) : undefined
  const hasPts = pts && pts !== '—'
  return (
    <button
      onClick={() => navigate(`/f1-team/${team.slug}`)}
      className="tappable group flex flex-col overflow-hidden rounded-2xl text-left"
      style={{
        background: `linear-gradient(to bottom, ${team.color}2e 0%, rgb(var(--color-card)) 72%)`,
        border: `1px solid ${team.color}80`,
      }}
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        {appConfig.SHOW_F1_PHOTOS && photoUrl ? (
          <img
            src={photoUrl}
            alt={team.name}
            loading="lazy"
            onError={() => setPhotoFailed(true)}
            className="absolute inset-0 h-full w-full object-contain"
            style={{ padding: '8px' }}
          />
        ) : (
          <CarSilhouette
            color={team.color}
            className="absolute inset-0 h-full w-full p-3 opacity-95"
          />
        )}
      </div>
      <div className="flex items-end justify-between gap-1 px-2 pb-2">
        <span className="min-w-0">
          <span className="line-clamp-2 text-[12px] font-bold leading-tight text-fg">
            {team.name}
          </span>
          <span
            className="mt-0.5 block font-display text-[12px] font-extrabold tabular-nums"
            style={{ color: hasPts ? team.color : 'rgb(var(--color-fg-2))' }}
          >
            {hasPts ? t('f1gp.points', { pts }) : '—'}
          </span>
        </span>
        <RowChevron />
      </div>
    </button>
  )
}

/**
 * Classement pilotes — une LIGNE par pilote, et non plus une vignette.
 *
 * La grille de portraits précédente était un trombinoscope : elle montrait
 * bien les visages, mais il fallait lire chaque carte pour reconstituer
 * l'ordre, et l'écart entre le premier et le quatrième n'apparaissait nulle
 * part. En ligne, le rang est à gauche, les points à droite, et la barre
 * donne l'écart d'un coup d'œil — c'est la composition de la planche.
 */
function DriversGrid({
  drivers,
  teamColor,
  teamName,
  standings,
}: {
  drivers: F1Driver[]
  teamColor: Record<string, string>
  teamName: Record<string, string>
  standings: Record<string, { pts: number; pos: number }>
}) {
  const navigate = useNavigate()
  const ordered = [...drivers].sort(
    (a, b) => (standings[a.slug]?.pos ?? 99) - (standings[b.slug]?.pos ?? 99),
  )
  // Référence de la barre : les points du leader. Pas le total du plateau —
  // rapporté à la somme, le premier remplirait un cinquième de sa barre et
  // toutes les lignes se ressembleraient.
  const leader = Math.max(1, ...ordered.map((d) => standings[d.slug]?.pts ?? 0))
  return (
    <>
      <SectionTitle>
        {`Classement pilotes ${new Date().getFullYear()}`}
      </SectionTitle>
      <div className="flex flex-col gap-2">
        {ordered.map((d, i) => (
          <DriverRow
            key={d.slug}
            driver={d}
            color={teamColor[d.team] ?? '#888888'}
            rank={standings[d.slug]?.pos ?? i + 1}
            pts={standings[d.slug]?.pts}
            ratio={(standings[d.slug]?.pts ?? 0) / leader}
            teamName={teamName[d.team] ?? d.team}
            onClick={() => navigate(`/f1-driver/${d.slug}`)}
          />
        ))}
      </div>
    </>
  )
}

/** Ligne de la planche : rang, portrait, écusson, nom, écurie, points. */
function DriverRow({
  driver,
  color,
  rank,
  pts,
  ratio,
  teamName,
  onClick,
}: {
  driver: F1Driver
  color: string
  rank: number
  pts?: number
  ratio: number
  teamName: string
  onClick: () => void
}) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const photoUrl = !photoFailed ? proxyImage(driver.photo) : undefined
  return (
    <button
      onClick={onClick}
      className="tappable flex w-full items-center gap-3 overflow-hidden rounded-2xl bg-card py-2 pl-2.5 pr-3 text-left"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <RankBadge n={rank} color={color} />
      {/* Portrait — recadré sur le haut du buste, comme sur la référence. */}
      <span
        className="relative h-[46px] w-[42px] flex-none overflow-hidden rounded-lg"
        style={{ background: `${color}1f` }}
      >
        {appConfig.SHOW_F1_PHOTOS && photoUrl ? (
          <img
            src={photoUrl}
            alt=""
            loading="lazy"
            onError={() => setPhotoFailed(true)}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ objectPosition: 'center top' }}
          />
        ) : (
          <DriverHelmet color={color} number={driver.number} className="h-full w-full p-1" />
        )}
      </span>
      {/* Pas d'écusson sur la ligne pilote, contrairement à la planche : la
          couleur de l'écurie y est DÉJÀ portée deux fois — par le contour du
          rang et par le casque. Une troisième occurrence n'ajoutait aucune
          information et prenait 36 px sur la largeur du nom, qui se tronquait
          en « Kimi ANTO… ». Elle reste en revanche sur la ligne de résultat,
          où aucun autre élément ne porte la livrée. */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-tight text-fg">
          {driver.name}
        </span>
        <span className="mt-0.5 flex items-center gap-1 text-[12px] text-fg2">
          <MapPin className="h-3 w-3 flex-none" />
          <span className="truncate">{teamName}</span>
        </span>
        {pts != null && <ScoreBar ratio={ratio} color={color} />}
      </span>
      {pts != null && (
        <span className="flex-none whitespace-nowrap text-[15px] font-bold tabular-nums text-fg">
          {pts}
          <span className="ml-1 text-[12px] font-medium text-fg2">pts</span>
        </span>
      )}
      <RowChevron />
    </button>
  )
}

/**
 * Derniers résultats.
 *
 * ── CE QUE LA PLANCHE DEMANDE, ET CE QUE LA BASE CONTIENT ──
 * La référence montre le classement d'arrivée d'une course : un pilote par
 * ligne, avec son temps (1:28:12.345) puis les écarts (+5.432, +8.112).
 * `f1_results` ne porte rien de tel — une ligne par Grand Prix, avec le seul
 * VAINQUEUR, et aucun temps nulle part. `f1_race_results` ajoute un podium
 * de trois noms sur deux manches, toujours sans chrono.
 *
 * Fabriquer ces temps aurait donné exactement l'écran de la planche. Ce sont
 * des résultats sportifs : inventés, ils seraient faux, et le lecteur n'a
 * aucun moyen de s'en apercevoir. L'anatomie de la ligne est donc conservée
 * — rang, portrait, écusson, nom, valeur à droite — et appliquée à ce qui
 * existe : une manche par ligne, son vainqueur, sa date.
 */
function ResultsList({
  results,
  teamColor,
  photoOf,
}: {
  results: ResultRow[]
  teamColor: Record<string, string>
  photoOf: (slug: string | null) => string | undefined
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
    <>
      <SectionTitle>Derniers résultats</SectionTitle>
      <div className="flex flex-col gap-2">
        {results.map((r) => {
          const color = (r.winner_team_slug && teamColor[r.winner_team_slug]) || '#888888'
          return (
            <div
              key={r.round}
              className="flex items-center gap-3 overflow-hidden rounded-2xl bg-card py-2 pl-2.5 pr-3"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <RankBadge n={r.round} color={color} />
              {/* Portrait du vainqueur — soumis à la même garde que le reste
                  de la F1 : les clichés officiels ne s'affichent que si les
                  droits d'image sont acquis (appConfig.SHOW_F1_PHOTOS, à
                  false). La planche les montre ; un drapeau posé pour une
                  raison juridique ne se contourne pas pour faire ressembler
                  un écran à sa maquette.
                  Tant qu'il est baissé, l'emplacement n'est pas réservé : un
                  rectangle teinté et vide occuperait la place d'une image
                  sans en être une. */}
              {appConfig.SHOW_F1_PHOTOS && photoOf(r.winner_slug) && (
                <span
                  className="relative h-[46px] w-[42px] flex-none overflow-hidden rounded-lg"
                  style={{ background: `${color}1f` }}
                >
                  <img
                    src={photoOf(r.winner_slug)}
                    alt=""
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{ objectPosition: 'center top' }}
                  />
                </span>
              )}
              <TeamCrest color={color} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold leading-tight text-fg">
                  {r.race_name}
                </span>
                {r.winner_name && (
                  <span className="mt-0.5 flex items-center gap-1 text-[12px] text-fg2">
                    <MapPin className="h-3 w-3 flex-none" />
                    <span className="truncate">{r.winner_name}</span>
                  </span>
                )}
              </span>
              {r.date && (
                <span className="flex-none whitespace-nowrap text-[12.5px] font-medium tabular-nums text-fg2">
                  {new Date(r.date).toLocaleDateString(undefined, {
                    day: '2-digit',
                    month: 'short',
                  })}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}
