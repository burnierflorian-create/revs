import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Car, Settings, Warehouse } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { categoryLabel, timeAgo, type Spot } from '../lib/spots'
import { xpLevel } from '../lib/xp'
import { Skeleton } from '../components/Skeleton'

type TopRow = { user_id: string; xp: number }
type ProfileRow = { user_id: string; pseudo: string | null; ville: string | null }

function memberSince(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
  }).format(d)
}

export default function Profile() {
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [pseudo, setPseudo] = useState('Spotter')
  const [joined, setJoined] = useState('')
  const [spots, setSpots] = useState<Spot[]>([])
  const [uniqueBrands, setUniqueBrands] = useState(0)
  const [rank, setRank] = useState<number | null>(null)
  const [hasEvent, setHasEvent] = useState(false)
  const [xp, setXp] = useState(0)
  const [top, setTop] = useState<TopRow[]>([])
  const [profiles, setProfiles] = useState<
    Record<string, { pseudo: string | null; ville: string | null }>
  >({})
  const [animPct, setAnimPct] = useState(0)

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const [spotsRes, allUidsRes, eventsRes, xpRes, topRes] =
        await Promise.all([
          supabase
            .from('spots')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false }),
          supabase.from('spots').select('user_id'),
          supabase
            .from('events')
            .select('id', { count: 'exact', head: true })
            .eq('organizer_id', user.id),
          supabase.rpc('my_xp'),
          supabase.rpc('top_spotters'),
        ])

      if (!active) return

      const mySpots = (spotsRes.data ?? []) as Spot[]
      const total = mySpots.length

      let rk: number | null = null
      if (allUidsRes.data && total > 0) {
        const counts = new globalThis.Map<string, number>()
        for (const r of allUidsRes.data as { user_id: string }[]) {
          counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1)
        }
        const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
        const idx = sorted.findIndex(([uid]) => uid === user.id)
        rk = idx >= 0 ? idx + 1 : null
      }

      const topRows = Array.isArray(topRes.data)
        ? (topRes.data as TopRow[])
        : []

      const ids = [user.id, ...topRows.map((r) => r.user_id)]
      const { data: profData } = await supabase
        .from('profiles')
        .select('user_id, pseudo, ville')
        .in('user_id', ids)
      if (!active) return

      const profMap: Record<
        string,
        { pseudo: string | null; ville: string | null }
      > = {}
      for (const p of (profData ?? []) as ProfileRow[]) {
        profMap[p.user_id] = { pseudo: p.pseudo, ville: p.ville }
      }

      const email = user.email ?? ''
      const ownPseudo =
        profMap[user.id]?.pseudo ||
        (email ? email.split('@')[0] : '') ||
        'Spotter'

      setUserId(user.id)
      setPseudo(ownPseudo)
      setJoined(memberSince(user.created_at))
      setSpots(mySpots)
      setUniqueBrands(
        new Set(mySpots.map((s) => s.brand).filter(Boolean)).size,
      )
      setRank(rk)
      setHasEvent((eventsRes.count ?? 0) > 0)
      setXp(typeof xpRes.data === 'number' ? xpRes.data : 0)
      setTop(topRows)
      setProfiles(profMap)
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [])

  const level = xpLevel(xp)

  useEffect(() => {
    if (loading) return
    const id = requestAnimationFrame(() => setAnimPct(level.pct))
    return () => cancelAnimationFrame(id)
  }, [loading, level.pct])

  async function logout() {
    await supabase.auth.signOut()
    navigate('/auth', { replace: true })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="space-y-8 pb-8">
          <div className="flex flex-col items-center pt-6">
            <Skeleton className="h-20 w-20 rounded-full" />
            <Skeleton className="mt-4 h-6 w-32 rounded" />
            <Skeleton className="mt-2 h-5 w-40 rounded-full" />
          </div>
          <Skeleton className="h-24 rounded-xl" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  const total = spots.length
  const has = (pred: (s: Spot) => boolean) => spots.some(pred)
  const brandHas = (needle: string) =>
    has((s) => (s.brand ?? '').toLowerCase().includes(needle))

  const badges = [
    { emoji: '🚀', name: 'Premier Spot', unlocked: total >= 1 },
    { emoji: '🔟', name: 'Série de 10', unlocked: total >= 10 },
    { emoji: '💯', name: 'Centurion', unlocked: total >= 100 },
    { emoji: '🏎️', name: 'Ferrari Hunter', unlocked: brandHas('ferrari') },
    { emoji: '🐂', name: 'Lambo Spotter', unlocked: brandHas('lamborghini') },
    {
      emoji: '🇯🇵',
      name: 'JDM Fan',
      unlocked: has((s) => s.category === 'JDM'),
    },
    { emoji: '📅', name: 'Organisateur', unlocked: hasEvent },
    {
      emoji: '⚡',
      name: 'Hypercar',
      unlocked: has((s) => s.category === 'hypercar'),
    },
  ]

  const nameFor = (uid: string) =>
    profiles[uid]?.pseudo ||
    (uid === userId ? pseudo : `Spotter ${uid.slice(0, 4)}`)

  return (
    <div className="relative min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <button
        onClick={() => navigate('/settings')}
        aria-label="Paramètres"
        className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-10 text-fg/40 transition-colors hover:text-fg"
      >
        <Settings className="h-6 w-6" />
      </button>
      <div className="space-y-8 pb-8">
        {/* SECTION 1 — Header */}
        <header className="flex flex-col items-center pt-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent text-3xl font-bold text-fg">
            {pseudo.charAt(0).toUpperCase()}
          </div>
          <h1 className="mt-4 text-xl font-bold">{pseudo}</h1>
          <span className="mt-2 inline-block rounded-full bg-accent px-3 py-1 text-xs font-medium">
            {level.name}
          </span>
          {joined && (
            <p className="mt-2 text-sm text-[#888888]">Membre depuis {joined}</p>
          )}
        </header>

        {/* SECTION 2 — XP / progression */}
        <section className="rounded-xl bg-card p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-[#888888]">Niveau {level.name}</span>
            <span className="text-lg font-bold text-fg">{xp} XP</span>
          </div>
          <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-out"
              style={{ width: `${animPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[#888888]">
            {level.isMax
              ? 'Niveau maximum atteint 👑'
              : `Plus que ${level.toNext} XP avant ${level.next}`}
          </p>
        </section>

        {/* SECTION 3 — Stats */}
        <section className="grid grid-cols-3 gap-3">
          <Stat value={String(total)} label="Spots" />
          <Stat value={String(uniqueBrands)} label="Marques" />
          <Stat value={rank ? `#${rank}` : '—'} label="Rang global" />
        </section>

        {/* SECTION 4 — Badges */}
        <section>
          <h2 className="mb-3 text-[18px] font-semibold">Mes badges</h2>
          <div className="grid grid-cols-4 gap-2">
            {badges.map((b) => (
              <div
                key={b.name}
                className={`flex flex-col items-center gap-1 rounded-xl bg-card px-1 py-3 text-center ${
                  b.unlocked ? '' : 'opacity-30 grayscale'
                }`}
              >
                <span className="text-2xl">{b.emoji}</span>
                <span
                  className={`text-[10px] leading-tight ${
                    b.unlocked ? 'text-accent' : 'text-[#888888]'
                  }`}
                >
                  {b.name}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* SECTION 5 — Top spotters */}
        <section>
          <h2 className="mb-1 text-[18px] font-semibold">Top spotters</h2>
          <p className="mb-3 text-xs text-[#888888]">
            Classement global par XP
          </p>
          {top.length === 0 ? (
            <p className="rounded-xl bg-card px-4 py-6 text-center text-sm text-fg/60">
              Pas encore de classement — spotte pour gagner de l'XP.
            </p>
          ) : (
            <div className="space-y-2">
              {top.map((r, i) => {
                const isMe = r.user_id === userId
                const name = nameFor(r.user_id)
                return (
                  <div
                    key={r.user_id}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                      isMe ? 'bg-accent/15 ring-1 ring-accent' : 'bg-card'
                    }`}
                  >
                    <span className="w-5 text-center text-sm font-bold text-[#888888]">
                      {i + 1}
                    </span>
                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-accent text-sm font-bold text-fg">
                      {name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">
                        {name}
                        {isMe && ' (toi)'}
                      </p>
                      <p className="text-xs text-[#888888]">
                        {xpLevel(r.xp).name}
                        {profiles[r.user_id]?.ville
                          ? ` · ${profiles[r.user_id]?.ville}`
                          : ''}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-accent">
                      {r.xp} XP
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* SECTION 6 — Garage */}
        <section>
          <h2 className="mb-3 text-[18px] font-semibold">
            Mon garage ({total} voiture{total > 1 ? 's' : ''})
          </h2>
          {total === 0 ? (
            <div className="flex flex-col items-center rounded-xl bg-card px-6 py-12 text-center">
              <Warehouse size={48} color="#444444" strokeWidth={1.5} />
              <p className="mt-4 max-w-[15rem] font-medium">
                Ton garage est vide, pars chasser ta première supercar
              </p>
              <button
                onClick={() => navigate('/new-spot')}
                className="mt-6 rounded-full bg-accent px-6 py-3 text-sm font-medium"
              >
                Spotter
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {spots.map((s) => (
                <div
                  key={s.id}
                  className="relative aspect-[4/3] overflow-hidden rounded-xl bg-card"
                >
                  {s.photo_url ? (
                    <img
                      src={s.photo_url}
                      alt={`${s.brand} ${s.model}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Car size={32} color="#444444" />
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-semibold tracking-wide backdrop-blur">
                    {categoryLabel(s.category).toUpperCase()}
                  </span>
                  <span className="absolute right-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[9px] backdrop-blur">
                    {timeAgo(s.created_at)}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                    <p className="truncate text-xs font-semibold">
                      {s.brand} {s.model}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* SECTION 7 — Premium + Déconnexion */}
        <button
          onClick={() => navigate('/premium')}
          className="w-full rounded-full bg-accent py-3 text-sm font-medium"
        >
          Passer Premium ✨
        </button>
        <button
          onClick={logout}
          className="w-full rounded-full border border-accent py-3 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
        >
          Se déconnecter
        </button>
      </div>
    </div>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-card px-2 py-4 text-center">
      <div className="text-xl font-bold text-fg">{value}</div>
      <div className="mt-1 text-[11px] text-[#888888]">{label}</div>
    </div>
  )
}
