import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Skeleton } from '../components/Skeleton'
import { xpLevel } from '../lib/xp'
import { detectCountry, countryFlag } from '../lib/country'

// Uniform leaderboard row (all three RPCs return the same shape now).
type Row = {
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

type Scope = 'global' | 'country' | 'city'

const GOLD = '#D4AF37'
const SILVER = '#C0C5CE'
const BRONZE = '#CD7F32'

function levelName(xp: number): string {
  return xp <= 0 ? 'Rookie' : xpLevel(xp).name
}

// ─────────────────────────── Rank row ───────────────────────────
function RankRow({
  rank,
  row,
  isMe,
  onTap,
}: {
  rank: number
  row: Row
  isMe: boolean
  onTap: () => void
}) {
  const name = row.pseudo || 'Spotter'
  const podium = rank <= 3
  const medal = rank === 1 ? '👑' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null
  const medalColor =
    rank === 1 ? GOLD : rank === 2 ? SILVER : rank === 3 ? BRONZE : null
  const avatarPx = podium ? 48 : 40

  // Base background + border by rank; "me" always gets a subtle red border.
  const baseBg =
    rank === 1
      ? 'linear-gradient(95deg, rgba(212,175,55,0.20) 0%, #141414 70%)'
      : rank === 2
        ? 'linear-gradient(95deg, rgba(192,197,206,0.16) 0%, #141414 70%)'
        : rank === 3
          ? 'linear-gradient(95deg, rgba(205,127,50,0.16) 0%, #141414 70%)'
          : isMe
            ? 'rgba(232,32,58,0.10)'
            : '#141414'
  const border = isMe
    ? '1px solid rgba(232,32,58,0.6)'
    : medalColor
      ? `1px solid ${medalColor}99`
      : '1px solid rgba(255,255,255,0.06)'

  return (
    <button
      onClick={onTap}
      className={`tappable relative flex w-full items-center gap-3 overflow-hidden rounded-2xl px-3 py-2.5 text-left transition-transform active:scale-[0.99] ${
        rank === 1 ? 'gold-shimmer' : ''
      }`}
      style={{
        background: baseBg,
        border,
        boxShadow:
          rank === 1 ? '0 6px 22px rgba(212,175,55,0.18)' : undefined,
      }}
    >
      {/* Rank / medal */}
      <span
        className="flex w-7 flex-none items-center justify-center font-display text-base font-extrabold tabular-nums"
        style={{ color: medalColor ?? 'rgba(255,255,255,0.4)' }}
      >
        {medal ?? rank}
      </span>

      {/* Avatar */}
      <div
        className="flex flex-none items-center justify-center overflow-hidden rounded-full font-display text-sm font-extrabold text-white"
        style={{
          width: avatarPx,
          height: avatarPx,
          background: '#E8203A',
          boxShadow: medalColor
            ? `0 0 0 2px ${medalColor}`
            : '0 0 0 2px rgba(255,255,255,0.06)',
        }}
      >
        {row.avatar ? (
          <img
            src={row.avatar}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          name.charAt(0).toUpperCase()
        )}
      </div>

      {/* Name + level + spots */}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-white">
          {name}
          {isMe && <span className="text-white/45">(toi)</span>}
          {rank === 1 && (
            <span
              className="flex-none rounded-full px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-black"
              style={{ background: GOLD, letterSpacing: '0.08em' }}
            >
              Meilleur
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-white/45">
          <span
            className="font-bold uppercase"
            style={{ color: row.xp <= 0 ? 'rgba(255,255,255,0.5)' : '#E8203A' }}
          >
            {levelName(row.xp)}
          </span>
          {' · '}
          {row.spots} spot{row.spots > 1 ? 's' : ''}
        </p>
      </div>

      {/* XP */}
      <span
        className="font-display text-base font-extrabold tabular-nums"
        style={{ color: '#E8203A' }}
      >
        {row.xp}
        <span className="ml-0.5 text-[11px] font-bold text-white/40">XP</span>
      </span>
    </button>
  )
}

// Render a list, capped, with the user's own row appended if beyond the cap.
function RankList({
  rows,
  meId,
  onOpen,
}: {
  rows: Row[]
  meId: string | null
  onOpen: (id: string) => void
}) {
  const CAP = 100
  const meIdx = rows.findIndex((r) => r.user_id === meId)
  const shown = rows.slice(0, CAP)
  const meInShown = meIdx >= 0 && meIdx < CAP
  return (
    <div className="space-y-2 pb-8">
      {shown.map((r, i) => (
        <RankRow
          key={r.user_id}
          rank={i + 1}
          row={r}
          isMe={r.user_id === meId}
          onTap={() => onOpen(r.user_id)}
        />
      ))}
      {!meInShown && meIdx >= 0 && (
        <>
          <p className="py-1 text-center text-xs text-white/30">···</p>
          <RankRow
            rank={meIdx + 1}
            row={rows[meIdx]}
            isMe
            onTap={() => onOpen(rows[meIdx].user_id)}
          />
        </>
      )}
    </div>
  )
}

// ─────────────────────────── Page ───────────────────────────
export default function Leaderboard() {
  const navigate = useNavigate()
  const [scope, setScope] = useState<Scope>('global')
  const [meId, setMeId] = useState<string | null>(null)

  const [myCity, setMyCity] = useState<string | null>(null)
  const [myCountry, setMyCountry] = useState<string | null>(null)

  const [globalRows, setGlobalRows] = useState<Row[] | null>(null)
  const [countryRows, setCountryRows] = useState<Row[] | null>(null)
  const [cityRows, setCityRows] = useState<Row[] | null>(null)
  const [cityStats, setCityStats] = useState<CityStats | null>(null)

  // Initial load: identity, city/country, and the global board.
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
              .select('ville, country')
              .eq('user_id', user.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      if (!active) return

      setGlobalRows(Array.isArray(globalRes.data) ? (globalRes.data as Row[]) : [])

      const prof = profRes.data as
        | { ville?: string | null; country?: string | null }
        | null
      setMyCity(prof?.ville?.trim() || null)

      // Country: from profile, else detect from locale and persist it.
      let country = prof?.country?.trim() || ''
      if (!country && user) {
        country = detectCountry()
        await supabase
          .from('profiles')
          .update({ country })
          .eq('user_id', user.id)
      }
      if (active) setMyCountry(country || null)
    })()
    return () => {
      active = false
    }
  }, [])

  // Lazy-fetch the country board.
  useEffect(() => {
    if (scope !== 'country' || !myCountry || countryRows !== null) return
    let active = true
    supabase
      .rpc('country_leaderboard', { p_country: myCountry, p_limit: 500 })
      .then(({ data }) => {
        if (active) setCountryRows(Array.isArray(data) ? (data as Row[]) : [])
      })
    return () => {
      active = false
    }
  }, [scope, myCountry, countryRows])

  // Lazy-fetch the city board + stats.
  useEffect(() => {
    if (scope !== 'city' || !myCity || cityRows !== null) return
    let active = true
    ;(async () => {
      const [lbRes, statsRes] = await Promise.all([
        supabase.rpc('city_leaderboard', { p_city: myCity, p_limit: 500 }),
        supabase.rpc('city_stats', { p_city: myCity }).maybeSingle(),
      ])
      if (!active) return
      setCityRows(Array.isArray(lbRes.data) ? (lbRes.data as Row[]) : [])
      setCityStats((statsRes.data as CityStats | null) ?? null)
    })()
    return () => {
      active = false
    }
  }, [scope, myCity, cityRows])

  const tabs: { key: Scope; label: string }[] = [
    { key: 'global', label: '🌍 Global' },
    { key: 'country', label: `${countryFlag(myCountry)} Mon Pays` },
    { key: 'city', label: '📍 Ma Ville' },
  ]

  const open = (id: string) => navigate(`/u/${id}`)

  const loadingSkeleton = (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-16 rounded-2xl" />
      ))}
    </div>
  )

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

      {/* Three pill tabs */}
      <div className="mb-5 flex gap-2">
        {tabs.map((t) => {
          const active = scope === t.key
          return (
            <button
              key={t.key}
              onClick={() => setScope(t.key)}
              className="tappable flex-1 rounded-full py-2.5 text-center text-[13px] font-bold transition-colors"
              style={
                active
                  ? { background: '#E8203A', color: '#fff' }
                  : {
                      background: '#141414',
                      color: 'rgba(255,255,255,0.55)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }
              }
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* GLOBAL */}
      {scope === 'global' &&
        (globalRows === null ? (
          loadingSkeleton
        ) : globalRows.length === 0 ? (
          <p className="py-16 text-center text-sm text-white/40">
            Pas encore de spotters.
          </p>
        ) : (
          <RankList rows={globalRows} meId={meId} onOpen={open} />
        ))}

      {/* MON PAYS */}
      {scope === 'country' &&
        (!myCountry ? (
          loadingSkeleton
        ) : countryRows === null ? (
          loadingSkeleton
        ) : countryRows.length === 0 ? (
          <p className="py-16 text-center text-sm text-white/40">
            Personne en {myCountry} pour l'instant.
          </p>
        ) : (
          <RankList rows={countryRows} meId={meId} onOpen={open} />
        ))}

      {/* MA VILLE */}
      {scope === 'city' &&
        (!myCity ? (
          <div
            className="rounded-2xl p-6 text-center"
            style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <p className="text-sm text-white/60">
              Ajoute ta ville dans le profil pour le classement local.
            </p>
            <button
              onClick={() => navigate('/profile')}
              className="tappable mt-4 rounded-full px-5 py-2.5 text-sm font-extrabold tracking-wider text-white"
              style={{ background: '#E8203A', boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
            >
              Aller au profil
            </button>
          </div>
        ) : cityRows === null ? (
          loadingSkeleton
        ) : (
          <>
            {/* City stats — kept */}
            {cityStats && cityStats.total_spots > 0 && (
              <div
                className="mb-4 rounded-2xl p-5"
                style={{ background: '#141414', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">
                  {myCity} en chiffres
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 divide-x divide-white/[0.08]">
                  <div className="pr-4">
                    <p className="font-display text-3xl font-extrabold tracking-tighter text-white">
                      {cityStats.total_spots}
                    </p>
                    <p className="text-xs text-white/45">spots</p>
                  </div>
                  {cityStats.top_car && (
                    <div className="min-w-0 pl-4">
                      <p className="truncate font-display text-base font-extrabold tracking-tighter text-white">
                        {cityStats.top_car}
                      </p>
                      <p className="text-xs text-white/45">
                        voiture top — {cityStats.top_car_count} fois
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {cityRows.length === 0 ? (
              <p className="py-16 text-center text-sm text-white/40">
                Pas encore de spotters à {myCity}.
              </p>
            ) : (
              <RankList rows={cityRows} meId={meId} onOpen={open} />
            )}
          </>
        ))}
    </div>
  )
}
