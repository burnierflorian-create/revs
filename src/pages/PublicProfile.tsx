import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Car } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { type Spot } from '../lib/spots'
import { myPseudo, notifyPush } from '../lib/push'
import { xpLevel } from '../lib/xp'
import { Skeleton } from '../components/Skeleton'

type Prof = { pseudo: string | null; ville: string | null; avatar: string | null }
type Rel = { user_id: string } & Prof

export default function PublicProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [meId, setMeId] = useState<string | null>(null)
  const [prof, setProf] = useState<Prof | null>(null)
  const [tier, setTier] = useState<'premium' | 'vip' | null>(null)
  const [xp, setXp] = useState(0)
  const [spots, setSpots] = useState<Spot[]>([])
  const [followers, setFollowers] = useState(0)
  const [following, setFollowing] = useState(0)
  const [isFollowing, setIsFollowing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<null | 'followers' | 'following'>(null)
  const [list, setList] = useState<Rel[]>([])

  const load = useCallback(async () => {
    if (!id) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    setMeId(user?.id ?? null)
    const [p, xpRows, sp, fr, fg, mine, tierRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('pseudo, ville, avatar')
        .eq('user_id', id)
        .maybeSingle(),
      supabase.from('xp_transactions').select('amount').eq('user_id', id),
      supabase
        .from('spots')
        .select('*')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .limit(12),
      supabase
        .from('followers')
        .select('follower_id', { count: 'exact', head: true })
        .eq('following_id', id),
      supabase
        .from('followers')
        .select('following_id', { count: 'exact', head: true })
        .eq('follower_id', id),
      user
        ? supabase
            .from('followers')
            .select('follower_id')
            .eq('follower_id', user.id)
            .eq('following_id', id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.rpc('user_tier', { p_user: id }),
    ])
    setProf((p.data as Prof) ?? { pseudo: null, ville: null, avatar: null })
    setXp(
      ((xpRows.data ?? []) as { amount: number }[]).reduce(
        (a, r) => a + (r.amount ?? 0),
        0,
      ),
    )
    setSpots((sp.data ?? []) as Spot[])
    setFollowers(fr.count ?? 0)
    setFollowing(fg.count ?? 0)
    setIsFollowing(!!mine.data)
    const tierRaw = tierRes.data
    setTier(
      tierRaw === 'premium' || tierRaw === 'vip' ? tierRaw : null,
    )
    setLoading(false)
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function toggleFollow() {
    if (!meId || !id || meId === id || busy) return
    setBusy(true)
    if (isFollowing) {
      setIsFollowing(false)
      setFollowers((n) => Math.max(0, n - 1))
      await supabase
        .from('followers')
        .delete()
        .eq('follower_id', meId)
        .eq('following_id', id)
    } else {
      setIsFollowing(true)
      setFollowers((n) => n + 1)
      await supabase
        .from('followers')
        .insert({ follower_id: meId, following_id: id })
      const who = await myPseudo()
      void notifyPush({
        user_id: id,
        title: '👥 Nouvel abonné',
        body: `${who} a commencé à te suivre`,
        url: `/u/${meId}`,
        type: 'followers',
      })
    }
    setBusy(false)
  }

  async function openList(which: 'followers' | 'following') {
    if (tab === which) {
      setTab(null)
      return
    }
    setTab(which)
    setList([])
    const col = which === 'followers' ? 'follower_id' : 'following_id'
    const match = which === 'followers' ? 'following_id' : 'follower_id'
    const { data: links } = await supabase
      .from('followers')
      .select(col)
      .eq(match, id)
      .limit(100)
    const ids = ((links ?? []) as Record<string, string>[]).map(
      (r) => r[col],
    )
    if (ids.length === 0) return
    const { data: profs } = await supabase
      .from('profiles')
      .select('user_id, pseudo, ville, avatar')
      .in('user_id', ids)
    setList((profs ?? []) as Rel[])
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <Skeleton className="mt-12 h-24 w-24 rounded-full" />
        <Skeleton className="mt-4 h-6 w-40 rounded" />
      </div>
    )
  }

  const name = prof?.pseudo || 'Spotter'
  const isMe = meId === id

  return (
    <div className="min-h-screen bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      <div className="flex items-center gap-4 py-4">
        <button onClick={() => navigate(-1)} aria-label="Retour" className="text-fg/60 hover:text-fg">
          <ArrowLeft className="h-6 w-6" />
        </button>
        <h1 className="font-display text-xl font-bold">Profil</h1>
      </div>

      <div className="flex flex-col items-center text-center">
        <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-card text-4xl font-bold ring-4 ring-accent">
          {prof?.avatar ? (
            <img src={prof.avatar} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </div>
        <h2 className="mt-3 flex items-center gap-2 font-display text-2xl font-bold">
          <span>{name}</span>
          {tier && (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                tier === 'vip'
                  ? 'bg-[#FFD700]/15 text-[#FFD700]'
                  : 'bg-accent/15 text-accent'
              }`}
              aria-label={tier === 'vip' ? 'Membre VIP' : 'Membre Premium'}
            >
              {tier === 'vip' ? '👑 VIP' : '⚡ Premium'}
            </span>
          )}
        </h2>
        {prof?.ville && (
          <p className="text-sm text-[#888888]">{prof.ville}</p>
        )}
        <span className="lvl-glow mt-2 inline-flex rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
          {xpLevel(xp).name} · {xp} XP
        </span>

        {!isMe && (
          <button
            onClick={toggleFollow}
            disabled={busy}
            className={`mt-4 rounded-full px-8 py-2.5 text-sm font-semibold disabled:opacity-50 ${
              isFollowing
                ? 'bg-card text-fg/70'
                : 'bg-accent text-fg'
            }`}
          >
            {isFollowing ? 'Suivi ✓' : 'Suivre'}
          </button>
        )}

        <div className="mt-4 flex gap-6 text-sm">
          <button onClick={() => openList('followers')} className="text-center">
            <span className="block font-bold text-fg">{followers}</span>
            <span className="text-xs text-fg/40">abonnés</span>
          </button>
          <button onClick={() => openList('following')} className="text-center">
            <span className="block font-bold text-fg">{following}</span>
            <span className="text-xs text-fg/40">abonnements</span>
          </button>
        </div>
      </div>

      {tab && (
        <div className="mt-5 space-y-2">
          {list.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg/40">
              Personne pour le moment.
            </p>
          ) : (
            list.map((r) => (
              <button
                key={r.user_id}
                onClick={() => navigate(`/u/${r.user_id}`)}
                className="flex w-full items-center gap-3 rounded-2xl bg-card px-3 py-2.5 text-left"
              >
                <div className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full bg-accent text-sm font-bold">
                  {r.avatar ? (
                    <img src={r.avatar} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  ) : (
                    (r.pseudo || 'S').charAt(0).toUpperCase()
                  )}
                </div>
                <span className="truncate text-sm font-medium">
                  {r.pseudo || 'Spotter'}
                </span>
              </button>
            ))
          )}
        </div>
      )}

      <h3 className="mb-3 mt-7 font-display text-lg font-bold">
        Derniers spots
      </h3>
      {spots.length === 0 ? (
        <p className="pb-10 text-sm text-fg/40">Aucun spot.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 pb-10">
          {spots.map((s) => (
            <button
              key={s.id}
              onClick={() => navigate(`/spot/${s.id}`)}
              className="relative aspect-square overflow-hidden rounded-xl bg-card"
            >
              {s.photo_url ? (
                <img src={s.photo_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Car className="h-6 w-6 text-fg/20" />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
