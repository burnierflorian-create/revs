import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, AtSign, Car } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { type Spot } from '../lib/spots'
import { myPseudo, notifyPush } from '../lib/push'
import { xpLevel } from '../lib/xp'
import { displayHandle, instagramUrl } from '../lib/social'
import { allBadges, computeUnlocks } from '../lib/badges'
import { sinceLabel } from '../lib/presence'
import { Skeleton } from '../components/Skeleton'
import SpotMiniGrid from '../components/profile/SpotMiniGrid'

type Prof = {
  pseudo: string | null
  ville: string | null
  avatar: string | null
  instagram?: string | null
  primary_brand?: string | null
  primary_model?: string | null
  primary_year?: number | null
  primary_color?: string | null
  primary_photo_url?: string | null
  primary_render_url?: string | null
  // Présence — calculée par la vue `profile_public` (migration 0113), avec le
  // même seuil que le panneau Membres. Deux surfaces, un seul calcul : un
  // membre vu « en ligne » dans la liste l'est aussi sur son profil.
  online?: boolean | null
  minutes_ago?: number | null
}
type Rel = { user_id: string } & Prof

export default function PublicProfile() {
  const { t } = useTranslation()
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
  const [likes, setLikes] = useState(0)
  const [isFollowing, setIsFollowing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<null | 'followers' | 'following'>(null)
  const [list, setList] = useState<Rel[]>([])
  const [contentTab, setContentTab] = useState<'spots' | 'likes' | 'bookmarks'>('spots')
  /** Les spots de l'onglet Likes ou Favoris. Chargés À LA DEMANDE : la
   *  plupart des visites s'arrêtent aux Spots, et deux listes de plus à
   *  l'ouverture coûteraient à tout le monde pour servir quelques-uns. */
  const [sideSpots, setSideSpots] = useState<Spot[] | null>(null)
  const [sideLoading, setSideLoading] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const {
      data: { user },
    } = await supabase.auth.getUser()
    setMeId(user?.id ?? null)
    const [p, xpRows, sp, fr, fg, mine, tierRes] = await Promise.all([
      // `profile_public` (migration 0094) plutôt que `profiles` : c'est la
      // MÊME question posée par toutes les surfaces. L'ancienne requête
      // demandait `pseudo, ville, avatar` — ni le véhicule ni l'Instagram.
      // C'était là, et nulle part ailleurs, la cause du « véhicule invisible
      // chez les autres » : la donnée n'était jamais demandée.
      supabase
        .from('profile_public')
        .select(
          'pseudo, ville, avatar, instagram, primary_brand, primary_model, primary_year, primary_color, primary_photo_url, primary_render_url, online, minutes_ago',
        )
        .eq('user_id', id)
        .maybeSingle(),
      supabase.from('xp_transactions').select('amount').eq('user_id', id),
      supabase
        .from('spots')
        .select('*')
        .eq('user_id', id)
        .order('created_at', { ascending: false }),
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
    const allSpots = (sp.data ?? []) as Spot[]
    setSpots(allSpots)
    setFollowers(fr.count ?? 0)
    setFollowing(fg.count ?? 0)
    setIsFollowing(!!mine.data)
    const tierRaw = tierRes.data
    setTier(
      tierRaw === 'premium' || tierRaw === 'vip' ? tierRaw : null,
    )
    setLoading(false)

    // Likes-received drives the Photographe badge — best-effort, after
    // the main render so it never blocks the page.
    const ids = allSpots.map((s) => s.id)
    if (ids.length) {
      const { count } = await supabase
        .from('spot_likes')
        .select('spot_id', { count: 'exact', head: true })
        .in('spot_id', ids)
      setLikes(count ?? 0)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  // Likes ou Favoris, à l'ouverture de l'onglet.
  //
  // Les favoris ne sont demandés QUE sur son propre profil, et la policy
  // « read own bookmarks » les refuserait de toute façon ailleurs : la
  // confidentialité ne repose pas sur cette condition, elle la double.
  useEffect(() => {
    if (!id || contentTab === 'spots') return
    let active = true
    void (async () => {
      // setState DANS le corps asynchrone, pas en synchrone au montage de
      // l'effet : React signale la seconde forme, qui déclenche un rendu de
      // plus avant même que la requête soit partie.
      setSideLoading(true)
      const table = contentTab === 'likes' ? 'spot_likes' : 'spot_bookmarks'
      const { data: links } = await supabase
        .from(table)
        .select('spot_id')
        .eq('user_id', id)
        .order('created_at', { ascending: false })
        .limit(60)
      const ids = ((links ?? []) as { spot_id: string }[]).map((r) => r.spot_id)
      if (!active) return
      if (ids.length === 0) {
        setSideSpots([])
        setSideLoading(false)
        return
      }
      const { data } = await supabase.from('spots').select('*').in('id', ids)
      if (!active) return
      // L'ordre de `in()` n'est pas celui des identifiants : on remet la
      // liste dans l'ordre où la personne a aimé ou rangé, le plus récent
      // d'abord — sinon « mes derniers favoris » n'a plus de sens.
      const byId = new Map(((data ?? []) as Spot[]).map((sp) => [sp.id, sp]))
      setSideSpots(ids.map((i) => byId.get(i)).filter((sp): sp is Spot => !!sp))
      setSideLoading(false)
    })()
    return () => {
      active = false
    }
  }, [id, contentTab])

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
        title: t('community.newFollowerTitle'),
        body: t('community.newFollowerBody', { who }),
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
  // Dérivés d'affichage. `displayHandle` garantit un seul « @ » quelle que
  // soit la forme stockée — c'est ce qui produisait « @@flr_brn ».
  const igUrl = instagramUrl(prof?.instagram)
  const igLabel = displayHandle(prof?.instagram)
  const instagram = igUrl && igLabel ? { url: igUrl, label: igLabel } : null
  const vehicleLabel =
    [prof?.primary_brand, prof?.primary_model].filter(Boolean).join(' ').trim() || null

  const level = xpLevel(xp)

  // Stats derived from the full spot set.
  const uniqueBrands = new Set(
    spots.map((s) => (s.brand ?? '').toLowerCase().trim()).filter(Boolean),
  ).size

  // Earned badges (public view only shows what's unlocked).
  const badgeCtx = {
    spots,
    hasEvent: false,
    plan: tier,
    rank: null,
    followers,
    likesReceived: likes,
    daysWithSpot: new Set(spots.map((s) => s.created_at.slice(0, 10))),
    earlyAdopter: false,
  }
  const unlocks = computeUnlocks(badgeCtx)
  const earnedBadges = allBadges(badgeCtx).filter((b) => unlocks.has(b.slug))

  return (
    <div className="min-h-screen bg-bg pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      {/* Plain gradient header (no cover photo) so the avatar is never
          clipped. The avatar overhangs the header bottom. */}
      <div
        className="relative w-full"
        style={{
          height: '120px',
          background: 'linear-gradient(180deg, #0a0a0a 0%, #141414 100%)',
        }}
      >
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div
          className="absolute left-1/2 z-10 flex -translate-x-1/2 items-center justify-center overflow-hidden rounded-full bg-card text-4xl font-bold"
          style={{
            bottom: '-44px',
            width: '88px',
            height: '88px',
            border: '3px solid #E8203A',
          }}
        >
          {prof?.avatar ? (
            <img
              src={prof.avatar}
              alt=""
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
              style={{ objectPosition: 'center top' }}
            />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </div>
      </div>

      <div className="px-4">
        <div className="flex flex-col items-center pt-[54px] text-center">
          <h2 className="mt-3 flex items-center gap-2 font-display text-2xl font-bold">
            <span>{name}</span>
            {tier && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                  tier === 'vip'
                    ? 'bg-[#FFD700]/15 text-[#FFD700]'
                    : 'bg-accent/15 text-accent'
                }`}
                aria-label={tier === 'vip' ? t('community.memberVip') : t('community.memberPremium')}
              >
                {tier === 'vip' ? '👑 VIP' : '⚡ Premium'}
              </span>
            )}
          </h2>
          {prof?.ville && (
            <p className="text-sm text-[#888888]">{prof.ville}</p>
          )}
          {/* Présence — la même que dans le panneau Membres, parce que c'est
              le même calcul : la vue `profile_public` et `member_directory`
              lisent toutes deux `presence_window()`. Le point vert et le
              « Actif il y a 2 h » ne peuvent donc pas se contredire d'une
              surface à l'autre. */}
          {prof && (prof.online || prof.minutes_ago != null) && (
            <p className="mt-1 flex items-center justify-center gap-1.5 text-[12.5px] text-fg2">
              <span
                aria-hidden
                className="h-2 w-2 flex-none rounded-full"
                style={{
                  background: prof.online ? '#22C55E' : 'rgb(var(--color-fg) / 0.3)',
                }}
              />
              {prof.online
                ? t('members.activeNow')
                : (() => {
                    const k = sinceLabel(prof.minutes_ago)
                    return t('members.lastActive', {
                      when: t(k.key, { n: k.n, count: k.count }),
                    })
                  })()}
            </p>
          )}
          {instagram && (
            <a
              href={instagram.url}
              target="_blank"
              rel="noopener noreferrer"
              className="tappable mt-1 inline-flex items-center gap-1 text-sm font-semibold text-fg2 hover:text-fg"
            >
              <AtSign className="h-3.5 w-3.5" />
              {instagram.label}
            </a>
          )}
          {vehicleLabel && (
            <span
              className="mt-2.5 inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-3 py-1.5 text-[12px] font-bold text-fg/90"
              style={{
                background: 'rgba(232,32,58,0.12)',
                border: '1px solid rgba(232,32,58,0.3)',
              }}
            >
              <Car className="h-3.5 w-3.5 flex-none" style={{ color: '#E8203A' }} />
              <span className="truncate">{vehicleLabel}</span>
            </span>
          )}
          <span className="lvl-glow mt-2 inline-flex rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
            {level.name} · {xp} XP
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
              {isFollowing ? t('community.following') : t('community.follow')}
            </button>
          )}

          {/* Stats row — spots / marques + followers / following. */}
          <div className="mt-5 flex w-full max-w-[340px] items-stretch">
            <div className="flex-1 text-center">
              <span className="block font-display text-xl font-extrabold text-fg">
                {spots.length}
              </span>
              <span className="text-[11px] text-fg/40">{t('community.spots')}</span>
            </div>
            <span className="w-px self-center bg-fg/10" style={{ height: 26 }} />
            <div className="flex-1 text-center">
              <span className="block font-display text-xl font-extrabold text-fg">
                {uniqueBrands}
              </span>
              <span className="text-[11px] text-fg/40">{t('community.brands')}</span>
            </div>
            <span className="w-px self-center bg-fg/10" style={{ height: 26 }} />
            <button onClick={() => openList('followers')} className="flex-1 text-center">
              <span className="block font-display text-xl font-extrabold text-fg">
                {followers}
              </span>
              <span className="text-[11px] text-fg/40">{t('community.followers')}</span>
            </button>
            <span className="w-px self-center bg-fg/10" style={{ height: 26 }} />
            <button onClick={() => openList('following')} className="flex-1 text-center">
              <span className="block font-display text-xl font-extrabold text-fg">
                {following}
              </span>
              <span className="text-[11px] text-fg/40">{t('community.followingCount')}</span>
            </button>
          </div>

          {/* Earned badges — public showcase of unlocked trophies. */}
          {earnedBadges.length > 0 && (
            <div className="mt-6 w-full">
              <h3 className="mb-3 text-left text-[10px] font-black uppercase tracking-[0.2em] text-fg/45">
                {t('community.badgesCount', { n: earnedBadges.length })}
              </h3>
              <div className="grid grid-cols-5 gap-2.5">
                {earnedBadges.slice(0, 15).map((b) => (
                  <div
                    key={b.slug}
                    className="flex flex-col items-center gap-1"
                    title={b.name}
                  >
                    <span
                      className="flex h-12 w-12 items-center justify-center rounded-full text-xl"
                      style={{
                        background: b.gold
                          ? 'rgba(224,179,65,0.14)'
                          : 'rgba(232,32,58,0.12)',
                        border: b.gold
                          ? '1px solid rgba(224,179,65,0.45)'
                          : '1px solid rgba(232,32,58,0.35)',
                      }}
                    >
                      {b.emoji}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      {tab && (
        <div className="mt-5 space-y-2">
          {list.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg/40">
              {t('community.nobodyYet')}
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
                    <img src={r.avatar} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-top" />
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

      {/* ── SPOTS · LIKES · FAVORIS ──
          « Favoris » n'apparaît que sur SON PROPRE profil. Ce n'est pas une
          précaution d'affichage : la policy « read own bookmarks » ferait de
          toute façon revenir une liste vide chez les autres. L'onglet est
          masqué pour ne pas annoncer un contenu que personne ne verra, et
          pour ne pas laisser croire que la personne n'a rien mis de côté.

          Les Likes, eux, sont publics — c'est un geste social, pas un
          rangement personnel. */}
      <div
        role="tablist"
        aria-label={t('community.contentTabs')}
        className="mt-7 flex gap-2"
      >
        {(['spots', 'likes', ...(isMe ? (['bookmarks'] as const) : [])] as const).map((k) => {
          const on = contentTab === k
          return (
            <button
              key={k}
              role="tab"
              aria-selected={on}
              onClick={() => setContentTab(k)}
              className="tappable flex-1 rounded-full px-3 py-2.5 text-[13px] transition-colors"
              style={
                on
                  ? { background: 'var(--revs-red)', color: '#fff', fontWeight: 700 }
                  : {
                      background: 'rgb(var(--color-fg) / 0.05)',
                      color: 'rgb(var(--color-fg-2))',
                      fontWeight: 500,
                    }
              }
            >
              {t(`community.tab.${k}`)}
            </button>
          )
        })}
      </div>

      <div className="mt-4 pb-10">
        {contentTab === 'spots' ? (
          <SpotMiniGrid
            spots={spots}
            loading={false}
            emptyTitle={t('community.noSpot')}
            emptyBody={t('community.noSpotBody')}
          />
        ) : (
          <SpotMiniGrid
            spots={sideSpots}
            loading={sideLoading}
            emptyTitle={
              contentTab === 'likes' ? t('community.noLikes') : t('community.noBookmarks')
            }
            emptyBody={
              contentTab === 'likes'
                ? t('community.noLikesBody')
                : t('community.noBookmarksBody')
            }
          />
        )}
      </div>
      </div>
    </div>
  )
}
