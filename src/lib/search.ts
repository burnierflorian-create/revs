import { supabase } from './supabase'
import { BRANDS, type Brand } from './brands'

export type SearchHit = {
  kind: 'car' | 'spotter' | 'city' | 'brand'
  label: string
  sublabel: string
  ref_id: string
  rank: number
}

const HISTORY_KEY = 'revs.search-history'
const HISTORY_MAX = 8

export function getSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((s): s is string => typeof s === 'string') : []
  } catch {
    return []
  }
}

export function pushSearchHistory(query: string) {
  const q = query.trim()
  if (q.length < 2) return
  try {
    const cur = getSearchHistory()
    const next = [q, ...cur.filter((s) => s.toLowerCase() !== q.toLowerCase())].slice(
      0,
      HISTORY_MAX,
    )
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

export function clearSearchHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {
    // ignore
  }
}

/** Local brand search — instant, no roundtrip. Matches name AND slug. */
function brandHits(q: string): SearchHit[] {
  const needle = q.trim().toLowerCase()
  if (needle.length < 2) return []
  return BRANDS.filter(
    (b: Brand) =>
      b.name.toLowerCase().includes(needle) ||
      b.slug.toLowerCase().includes(needle),
  )
    .slice(0, 5)
    .map((b) => ({
      kind: 'brand' as const,
      label: b.name,
      sublabel: 'Marque',
      ref_id: b.slug,
      rank: b.name.toLowerCase().startsWith(needle) ? 11 : 6,
    }))
}

export async function runGlobalSearch(query: string): Promise<SearchHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  // Run brand search locally + server search in parallel for snappy UX.
  const [{ data, error }, brands] = await Promise.all([
    supabase.rpc('global_search', { p_q: q, p_limit: 16 }),
    Promise.resolve(brandHits(q)),
  ])
  if (error) {
    console.warn('[search] rpc failed:', error.message)
    return brands
  }
  const remote = (data ?? []) as SearchHit[]
  // Combine + sort by rank desc, then label asc.
  return [...brands, ...remote].sort(
    (a, b) => b.rank - a.rank || a.label.localeCompare(b.label),
  )
}
