import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Crown, MapPin, Globe2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Skeleton } from '../components/Skeleton'
import TitleChip from '../components/TitleChip'

type GlobalRow = { user_id: string; xp: number }
type CityRow = {
  user_id: string
  xp: number
  spots: number
  pseudo: string | null
  avatar: string | null
}
type CityStats = {
  total_spots: number
  top_car: string | null
  top_car_count: number
  top_spotter_id: string | null
  top_spotter_pseudo: string | null
}
type Prof = {
  pseudo: string | null
  ville: string | null
  avatar: string | null
  title: string | null
}

const PER = 20
type Scope = 'global' | 'city'

export default function Leaderboard() {
  const navigate = useNavigate()
  const [scope, setScope] = useState<Scope>('global')

  // Global state
  const [rows, setRows] = useState<GlobalRow[] | null>(null)
  const [profiles, setProfiles] = useState<Record<string, Prof>>({})
  const [meId, setMeId] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  // City state
  const [myCity, setMyCity] = useState<string | null>(null)
  const [cityRows, setCityRows] = useState<CityRow[] | null>(null)
  const [cityStats, setCityStats] = useState<CityStats | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (active) setMeId(user?.id ?? null)

      const [globalRes, profRes] = await Promise.all([
        supabase.rpc('top_spotters', { limit_count: 500 }),
        user
          ? supabase
              .from('profiles')
              .select('ville')
              .eq('user_id', user.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (!active) return

      setRows(Array.isArray(globalRes.data) ? (globalRes.data as GlobalRow[]) : [])
      const city = (profRes.data as { ville?: string | null } | null)?.ville?.trim()
      setMyCity(city || null)
    })()
    return () => {
      active = false
    }
  }, [])

  // Lazy-fetch city data the first time the user switches to that tab.
  useEffect(() => {
    if (scope !== 'city' || !myCity || cityRows !== null) return
    let active = true
    ;(async () => {
      const [lbRes, statsRes] = await Promise.all([
        supabase.rpc('city_leaderboard', { p_city: myCity, p_limit: 10 }),
        supabase.rpc('city_stats', { p_city: myCity }).maybeSingle(),
      ])
      if (!active) return
      setCityRows(Array.isArray(lbRes.data) ? (lbRes.data as CityRow[]) : [])
      setCityStats((statsRes.data as CityStats | null) ?? null)
    })()
    return () => {
      active = false
    }
  }, [scope, myCity, cityRows])

  const slice = rows ? rows.slice(page * PER, page * PER + PER) : []

  useEffect(() => {
    if (slice.length === 0) return
    const ids = slice
      .map((r) => r.user_id)
      .filter((id) => !(id in profiles))
    if (ids.length === 0) return
    supabase
      .from('profiles')
      .select('user_id, pseudo, ville, avatar, title')
      .in('user_id', ids)
      .then(({ data }) => {
        setProfiles((cur) => {
          const next = { ...cur }
          for (const p of (data ?? []) as ({ user_id: string } & Prof)[])
            next[p.user_id] = {
              pseudo: p.pseudo,
              ville: p.ville,
              avatar: p.avatar,
              title: p.title,
            }
          for (const id of ids)
            if (!next[id])
              next[id] = { pseudo: null, ville: null, avatar: null, title: null }
          return next
        })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, rows])

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="tappable text-fg2 hover:text-fg"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="display-xl text-fg">Classement</h1>
      </div>

      {/* Scope tabs */}
      <div className="mb-5 flex gap-2">
        <button
          onClick={() => setScope('global')}
          className={`tappable flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold tracking-wide transition-colors ${
            scope === 'global'
              ? 'bg-accent text-fg'
              : 'bg-card text-fg2 hover:text-fg'
          }`}
          style={
            scope === 'global'
              ? undefined
              : { border: '1px solid var(--color-border)' }
          }
        >
          <Globe2 className="h-4 w-4" />
          Global
        </button>
        <button
          onClick={() => setScope('city')}
          disabled={!myCity}
          className={`tappable flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-sm font-bold tracking-wide transition-colors disabled:opacity-30 ${
            scope === 'city'
              ? 'bg-accent text-fg'
              : 'bg-card text-fg2 hover:text-fg'
          }`}
          style={
            scope === 'city'
              ? undefined
              : { border: '1px solid var(--color-border)' }
          }
        >
          <MapPin className="h-4 w-4" />
          {myCity ? `Ma ville · ${myCity}` : 'Ma ville'}
        </button>
      </div>

      {scope === 'global' ? (
        rows === null ? (
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
                const isTop1 = rank === 1
                const isPodium = rank <= 3
                return (
                  <button
                    key={r.user_id}
                    onClick={() => navigate(`/u/${r.user_id}`)}
                    className="tappable flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left"
                    style={
                      isTop1
                        ? {
                            background:
                              'linear-gradient(95deg, rgba(212,175,55,0.18) 0%, rgb(var(--color-card) / 0.95) 70%)',
                            border: '1px solid rgba(212,175,55,0.45)',
                            boxShadow:
                              '0 6px 22px rgba(212,175,55,0.18)',
                          }
                        : me
                          ? {
                              background: 'rgba(232,32,58,0.12)',
                              border: '1px solid rgba(232,32,58,0.45)',
                            }
                          : {
                              background: 'rgb(var(--color-card))',
                              border: '1px solid var(--color-border)',
                            }
                    }
                  >
                    <span
                      className={`w-7 text-center font-display text-base font-extrabold tracking-tighter ${
                        isTop1
                          ? 'text-[#FFD700]'
                          : isPodium
                            ? 'text-fg'
                            : 'text-fg2'
                      }`}
                    >
                      {isTop1 ? <Crown className="mx-auto h-5 w-5" /> : rank}
                    </span>
                    <div
                      className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full bg-accent font-display text-sm font-extrabold tracking-tighter text-fg"
                      style={
                        isTop1
                          ? { boxShadow: '0 0 0 2px rgba(212,175,55,0.6)' }
                          : { boxShadow: '0 0 0 2px rgb(var(--color-fg) / 0.06)' }
                      }
                    >
                      {p?.avatar ? (
                        <img
                          src={p.avatar}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        name.charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-fg">
                        {name}
                        {me && ' (toi)'}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <TitleChip xp={r.xp} title={p?.title} size="xs" />
                        {p?.ville && (
                          <span className="truncate text-[11px] text-fg2">
                            · {p.ville}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="font-display text-base font-extrabold tracking-tighter text-accent">
                      {r.xp}
                      <span className="ml-0.5 text-[11px] font-bold text-fg2">
                        XP
                      </span>
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
                  className="tappable rounded-full bg-card px-5 py-2 text-sm font-semibold disabled:opacity-30"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  Précédent
                </button>
                <span className="label-up text-[10px] text-fg2">
                  {page + 1} / {Math.ceil(rows.length / PER)}
                </span>
                <button
                  disabled={(page + 1) * PER >= rows.length}
                  onClick={() => setPage((p) => p + 1)}
                  className="tappable rounded-full bg-card px-5 py-2 text-sm font-semibold disabled:opacity-30"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  Suivant
                </button>
              </div>
            )}
          </>
        )
      ) : !myCity ? (
        <div
          className="rounded-3xl bg-card p-6 text-center"
          style={{ border: '1px solid var(--color-border)' }}
        >
          <p className="text-sm text-fg2">
            Configure ta ville dans le profil pour débloquer le
            classement local.
          </p>
          <button
            onClick={() => navigate('/profile')}
            className="tappable mt-4 rounded-full bg-accent px-5 py-2.5 text-sm font-extrabold tracking-wider text-fg"
            style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
          >
            Aller au profil
          </button>
        </div>
      ) : cityRows === null ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      ) : (
        <>
          {/* City stats card */}
          {cityStats && cityStats.total_spots > 0 && (
            <div
              className="mb-4 rounded-3xl bg-card p-5"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <p className="label-up text-[10px] text-fg2">
                {myCity} en chiffres
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 divide-x divide-fg/[0.08]">
                <div className="pr-4">
                  <p className="font-display text-3xl font-extrabold tracking-tighter text-fg">
                    {cityStats.total_spots}
                  </p>
                  <p className="text-xs text-fg2">spots</p>
                </div>
                {cityStats.top_car && (
                  <div className="min-w-0 pl-4">
                    <p className="truncate font-display text-base font-extrabold tracking-tighter text-fg">
                      {cityStats.top_car}
                    </p>
                    <p className="text-xs text-fg2">
                      voiture top — {cityStats.top_car_count} fois
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {cityRows.length === 0 ? (
            <p className="py-16 text-center text-sm text-fg2">
              Pas encore de spotteurs publics à {myCity}.
            </p>
          ) : (
            <div className="space-y-2 pb-8">
              {cityRows.map((r, i) => {
                const rank = i + 1
                const me = r.user_id === meId
                const isTop = rank === 1
                return (
                  <button
                    key={r.user_id}
                    onClick={() => navigate(`/u/${r.user_id}`)}
                    className="tappable flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left"
                    style={
                      isTop
                        ? {
                            background:
                              'linear-gradient(95deg, rgba(212,175,55,0.18) 0%, rgb(var(--color-card) / 0.95) 70%)',
                            border: '1px solid rgba(212,175,55,0.45)',
                            boxShadow:
                              '0 6px 22px rgba(212,175,55,0.18)',
                          }
                        : me
                          ? {
                              background: 'rgba(232,32,58,0.12)',
                              border: '1px solid rgba(232,32,58,0.45)',
                            }
                          : {
                              background: 'rgb(var(--color-card))',
                              border: '1px solid var(--color-border)',
                            }
                    }
                  >
                    <span
                      className={`w-7 text-center font-display text-base font-extrabold tracking-tighter ${
                        isTop ? 'text-[#FFD700]' : 'text-fg2'
                      }`}
                    >
                      {isTop ? <Crown className="mx-auto h-5 w-5" /> : rank}
                    </span>
                    <div
                      className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-full bg-accent font-display text-sm font-extrabold tracking-tighter text-fg"
                      style={
                        isTop
                          ? { boxShadow: '0 0 0 2px rgba(212,175,55,0.6)' }
                          : { boxShadow: '0 0 0 2px rgb(var(--color-fg) / 0.06)' }
                      }
                    >
                      {r.avatar ? (
                        <img
                          src={r.avatar}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        (r.pseudo || 'S').charAt(0).toUpperCase()
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-fg">
                        {r.pseudo || 'Spotter'}
                        {me && ' (toi)'}
                        {isTop && (
                          <span className="label-up rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-[9px] text-yellow-300">
                            MEILLEUR 🏆
                          </span>
                        )}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <TitleChip xp={r.xp} size="xs" />
                        <span className="truncate text-[11px] text-fg2">
                          · {r.spots} spot{r.spots > 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                    <span className="font-display text-base font-extrabold tracking-tighter text-accent">
                      {r.xp}
                      <span className="ml-0.5 text-[11px] font-bold text-fg2">
                        XP
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
