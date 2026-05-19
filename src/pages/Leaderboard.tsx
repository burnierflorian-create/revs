import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { xpLevel } from '../lib/xp'
import { Skeleton } from '../components/Skeleton'

type Row = { user_id: string; xp: number }
type Prof = { pseudo: string | null; ville: string | null; avatar: string | null }

const PER = 20

export default function Leaderboard() {
  const navigate = useNavigate()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [profiles, setProfiles] = useState<Record<string, Prof>>({})
  const [meId, setMeId] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (active) setMeId(user?.id ?? null)
      const { data } = await supabase.rpc('top_spotters', {
        limit_count: 500,
      })
      if (!active) return
      setRows(Array.isArray(data) ? (data as Row[]) : [])
    })()
    return () => {
      active = false
    }
  }, [])

  const slice = rows ? rows.slice(page * PER, page * PER + PER) : []

  useEffect(() => {
    if (slice.length === 0) return
    const ids = slice
      .map((r) => r.user_id)
      .filter((id) => !(id in profiles))
    if (ids.length === 0) return
    supabase
      .from('profiles')
      .select('user_id, pseudo, ville, avatar')
      .in('user_id', ids)
      .then(({ data }) => {
        setProfiles((cur) => {
          const next = { ...cur }
          for (const p of (data ?? []) as ({ user_id: string } & Prof)[])
            next[p.user_id] = {
              pseudo: p.pseudo,
              ville: p.ville,
              avatar: p.avatar,
            }
          for (const id of ids) if (!next[id]) next[id] = { pseudo: null, ville: null, avatar: null }
          return next
        })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, rows])

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button onClick={() => navigate(-1)} aria-label="Retour" className="text-fg/60 hover:text-fg">
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="font-display text-2xl font-bold">Classement</h1>
      </div>

      {rows === null ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-sm text-fg/40">
          Pas encore de classement — spotte pour gagner de l'XP.
        </p>
      ) : (
        <>
          <div className="space-y-2 pb-4">
            {slice.map((r, i) => {
              const rank = page * PER + i + 1
              const p = profiles[r.user_id]
              const name = p?.pseudo || 'Spotter'
              const me = r.user_id === meId
              return (
                <button
                  key={r.user_id}
                  onClick={() => navigate(`/u/${r.user_id}`)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${
                    me ? 'bg-accent/15 ring-1 ring-accent' : 'bg-card'
                  }`}
                >
                  <span className="w-7 text-center text-sm font-bold text-fg/50">
                    {rank}
                  </span>
                  <div className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full bg-accent text-sm font-bold text-fg">
                    {p?.avatar ? (
                      <img src={p.avatar} alt="" className="h-full w-full object-cover" />
                    ) : (
                      name.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">
                      {name}
                      {me && ' (toi)'}
                    </p>
                    <p className="truncate text-xs text-fg/40">
                      {xpLevel(r.xp).name}
                      {p?.ville ? ` · ${p.ville}` : ''}
                    </p>
                  </div>
                  <span className="text-sm font-bold text-accent">
                    {r.xp} XP
                  </span>
                </button>
              )
            })}
          </div>
          {rows.length > PER && (
            <div className="flex items-center justify-between pb-8">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="rounded-full bg-card px-5 py-2 text-sm disabled:opacity-30"
              >
                Précédent
              </button>
              <span className="text-xs text-fg/40">
                {page + 1} / {Math.ceil(rows.length / PER)}
              </span>
              <button
                disabled={(page + 1) * PER >= rows.length}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-full bg-card px-5 py-2 text-sm disabled:opacity-30"
              >
                Suivant
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
