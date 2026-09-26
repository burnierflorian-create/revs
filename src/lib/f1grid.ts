// Dynamic F1 roster — reads the live grid from Supabase (public.f1_grid /
// f1_grid_teams, synced daily from OpenF1 by scripts/sync-f1-grid.mjs) and
// merges it over the static catalogue in ./f1team.
//
// Division of labour:
//   • DB (dynamic)  → who drives what, race number, nationality, team
//     display name + livery colour. This is the mercato-accurate layer.
//   • f1team (static) → stable slugs (URLs + editorial-sheet PKs), news
//     `match[]` aliases, curated brand colours / car photos, and a full
//     fallback if the DB is empty or unreachable.
//
// The merge yields plain F1Team[] / F1Driver[], so existing components
// consume it unchanged — only the data SOURCE moves from import to hook.
import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import {
  F1_TEAMS,
  F1_DRIVERS,
  type F1Team,
  type F1Driver,
  type F1TeamSlug,
  type F1DriverSlug,
} from './f1team'

type GridTeamRow = { team_slug: string; name: string; color: string | null }
type GridDriverRow = {
  driver_slug: string
  name: string
  number: number | null
  country: string | null
  team_slug: string
  team_color: string | null
  headshot_url: string | null
}

export type F1Grid = { teams: F1Team[]; drivers: F1Driver[] }

// News-match fallback for drivers/teams absent from the static catalogue
// (e.g. a brand-new entry like Cadillac or a rookie): match on the last
// word of the name / the slug, lower-cased.
const lastWord = (name: string) =>
  (name || '').trim().split(/\s+/).slice(-1)[0]?.toLowerCase() || ''

function mergeGrid(teamRows: GridTeamRow[], driverRows: GridDriverRow[]): F1Grid {
  const staticTeam = new Map(F1_TEAMS.map((t) => [t.slug as string, t]))
  const dbTeam = new Map(teamRows.map((r) => [r.team_slug, r]))

  // Keep the familiar static grid order for existing teams, then append
  // any teams the DB has that the catalogue doesn't yet know (Cadillac).
  const orderedSlugs = [
    ...F1_TEAMS.map((t) => t.slug as string).filter((s) => dbTeam.has(s)),
    ...teamRows.map((r) => r.team_slug).filter((s) => !staticTeam.has(s)),
  ]

  const teams: F1Team[] = orderedSlugs.map((slug) => {
    const s = staticTeam.get(slug)
    const db = dbTeam.get(slug)
    return {
      slug: slug as F1TeamSlug,
      name: db?.name ?? s?.name ?? slug, // display name from API ("Audi")
      fullName: s?.fullName ?? db?.name ?? slug,
      color: s?.color ?? db?.color ?? '#888888', // prefer curated brand colour
      logo: s?.logo,
      carPhoto: s?.carPhoto,
      match: s?.match ?? [slug.replace(/-/g, ' ')],
    }
  })

  const staticDriver = new Map(F1_DRIVERS.map((d) => [d.slug as string, d]))
  const teamOrder = new Map(teams.map((t, i) => [t.slug, i]))

  const drivers: F1Driver[] = driverRows
    .map((r) => {
      const s = staticDriver.get(r.driver_slug)
      return {
        slug: r.driver_slug as F1DriverSlug,
        name: r.name ?? s?.name ?? r.driver_slug,
        number: r.number ?? s?.number ?? null,
        country: r.country ?? s?.country ?? '',
        team: r.team_slug as F1TeamSlug,
        photo: s?.photo, // curated portrait if any; SVG fallback otherwise
        match: s?.match ?? [lastWord(r.name ?? r.driver_slug)],
      } satisfies F1Driver
    })
    .sort(
      (a, b) =>
        (teamOrder.get(a.team) ?? 99) - (teamOrder.get(b.team) ?? 99) ||
        a.name.localeCompare(b.name),
    )

  return { teams, drivers }
}

// Fetch once per page load, shared across every consumer via this promise.
let gridPromise: Promise<F1Grid | null> | null = null

async function fetchMergedGrid(): Promise<F1Grid | null> {
  const [{ data: dt }, { data: dd }] = await Promise.all([
    supabase.from('f1_grid_teams').select('team_slug, name, color'),
    supabase
      .from('f1_grid')
      .select(
        'driver_slug, name, number, country, team_slug, team_color, headshot_url',
      )
      .eq('active', true),
  ])
  // Empty / failed read → null so callers fall back to the static grid.
  if (!dt || !dd || dt.length === 0 || dd.length === 0) return null
  return mergeGrid(dt as GridTeamRow[], dd as GridDriverRow[])
}

export type UseF1Grid = F1Grid & { loading: boolean }

// Returns the merged grid. Renders the static catalogue INSTANTLY (no empty
// flash), then swaps to the live grid when it arrives; on any failure it
// keeps the static grid. `loading` is true until the DB read settles.
export function useF1Grid(): UseF1Grid {
  const [state, setState] = useState<UseF1Grid>(() => ({
    teams: F1_TEAMS,
    drivers: F1_DRIVERS,
    loading: true,
  }))

  useEffect(() => {
    let active = true
    if (!gridPromise) gridPromise = fetchMergedGrid().catch(() => null)
    gridPromise.then((merged) => {
      if (!active) return
      setState(
        merged
          ? { ...merged, loading: false }
          : { teams: F1_TEAMS, drivers: F1_DRIVERS, loading: false },
      )
    })
    return () => {
      active = false
    }
  }, [])

  return state
}

// Lookups over a merged grid (the static getF1Team/getF1Driver only know
// the hardcoded catalogue, so pages use these against the hook result).
export function findTeam(grid: F1Grid, slug: string | undefined) {
  return slug ? grid.teams.find((t) => t.slug === slug) : undefined
}
export function findDriver(grid: F1Grid, slug: string | undefined) {
  return slug ? grid.drivers.find((d) => d.slug === slug) : undefined
}
export function driversOfTeam(grid: F1Grid, teamSlug: string) {
  return grid.drivers.filter((d) => d.team === teamSlug)
}
