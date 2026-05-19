import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Settings,
  Camera,
  Car,
  Tag,
  Trophy,
  Zap,
  Flame,
  Flag,
  Target,
  Newspaper,
  ChevronRight,
  Sparkles,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { timeAgo, type Spot } from '../lib/spots'
import { xpLevel } from '../lib/xp'
import { GP_2026 } from '../lib/f1'
import { Skeleton } from '../components/Skeleton'

type NewsLite = {
  id: string
  title: string
  category: string
  url: string
  image_url: string | null
}

const NEWS_BADGE: Record<string, string> = {
  F1: 'bg-accent text-fg',
  Supercar: 'bg-[#F59E0B] text-[#0A0A0A]',
  Hypercar: 'bg-[#8B5CF6] text-fg',
  Events: 'bg-[#3B82F6] text-fg',
}

const CHALLENGE_TARGET = 2
const CHALLENGE_XP = 20

function startOfTodayISO(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function SectionTitle({
  icon,
  label,
  action,
}: {
  icon: ReactNode
  label: string
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 font-display text-base font-bold text-fg">
        <span className="text-accent">{icon}</span>
        {label}
      </h2>
      {action}
    </div>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('Spotter')
  const [xp, setXp] = useState(0)
  const [totalSpots, setTotalSpots] = useState(0)
  const [uniqueBrands, setUniqueBrands] = useState(0)
  const [rank, setRank] = useState<number | null>(null)
  const [recent, setRecent] = useState<Spot[]>([])
  const [todayCount, setTodayCount] = useState(0)
  const [streak, setStreak] = useState(0)
  const [news, setNews] = useState<NewsLite[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return

      const [
        profRes,
        countRes,
        brandsRes,
        allUidsRes,
        recentRes,
        todayRes,
        xpRes,
        newsRes,
        streakRes,
      ] = await Promise.all([
        supabase
          .from('profiles')
          .select('pseudo')
          .eq('user_id', user.id)
          .maybeSingle(),
        supabase
          .from('spots')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id),
        supabase.from('spots').select('brand').eq('user_id', user.id),
        supabase.from('spots').select('user_id'),
        supabase
          .from('spots')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('spots')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .gte('created_at', startOfTodayISO()),
        supabase.rpc('my_xp'),
        supabase
          .from('news')
          .select('id, title, category, url, image_url')
          .order('published_at', { ascending: false, nullsFirst: false })
          .limit(6),
        supabase
          .from('spot_count_daily')
          .select('date, count')
          .eq('user_id', user.id)
          .gt('count', 0)
          .order('date', { ascending: false })
          .limit(90),
      ])

      if (!active) return

      const pseudo =
        (profRes.data?.pseudo as string | undefined)?.trim() ||
        (user.email ? user.email.split('@')[0] : 'Spotter')

      const total = countRes.count ?? 0
      const brands = brandsRes.data
        ? new Set(
            (brandsRes.data as { brand: string }[]).map((r) => r.brand),
          ).size
        : 0

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

      const days = new Set(
        ((streakRes.data ?? []) as { date: string }[]).map((r) => r.date),
      )
      const dayStr = (d: Date) => d.toISOString().slice(0, 10)
      const cursor = new Date()
      if (!days.has(dayStr(cursor)))
        cursor.setUTCDate(cursor.getUTCDate() - 1)
      let st = 0
      while (days.has(dayStr(cursor))) {
        st += 1
        cursor.setUTCDate(cursor.getUTCDate() - 1)
      }
      setStreak(st)

      setName(pseudo)
      setXp((xpRes.data as number | null) ?? 0)
      setTotalSpots(total)
      setUniqueBrands(brands)
      setRank(rk)
      setRecent((recentRes.data ?? []) as Spot[])
      setTodayCount(todayRes.count ?? 0)
      setNews(((newsRes.data ?? []) as NewsLite[]).slice(0, 3))
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [])

  const level = xpLevel(xp)
  const nextGp = GP_2026.find((g) => new Date(g.date).getTime() >= now)
  const gpDiff = nextGp ? new Date(nextGp.date).getTime() - now : 0
  const cd = {
    d: Math.max(0, Math.floor(gpDiff / 86400000)),
    h: Math.max(0, Math.floor((gpDiff % 86400000) / 3600000)),
    m: Math.max(0, Math.floor((gpDiff % 3600000) / 60000)),
    s: Math.max(0, Math.floor((gpDiff % 60000) / 1000)),
  }
  const challengeDone = Math.min(todayCount, CHALLENGE_TARGET)
  const challengePct = Math.round((challengeDone / CHALLENGE_TARGET) * 100)
  const challengeComplete = todayCount >= CHALLENGE_TARGET

  if (loading) {
    return (
      <div className="min-h-screen bg-bg px-5 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between py-5">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48 rounded" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
          <Skeleton className="h-9 w-9 rounded-full" />
        </div>
        <div className="space-y-7 pb-8">
          <Skeleton className="h-40 w-full rounded-3xl" />
          <div className="grid grid-cols-4 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-28 w-full rounded-2xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg px-5 pt-[max(1rem,env(safe-area-inset-top))] text-fg">
      {/* 1 — HEADER */}
      <header className="flex items-start justify-between py-5">
        <div>
          <h1 className="font-display text-3xl font-bold leading-tight text-fg">
            Bonjour {name}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="lvl-glow inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
              {level.name}
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            {streak > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#F59E0B]/15 px-3 py-1 text-xs font-bold text-[#F59E0B]">
                🔥 {streak} {streak > 1 ? 'jours' : 'jour'}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => navigate('/settings')}
          aria-label="Réglages"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-card text-fg/50 transition-colors hover:text-fg"
        >
          <Settings className="h-5 w-5" />
        </button>
      </header>

      <div className="space-y-8 pb-10">
        {/* 2 — HERO SPOTTER */}
        <button
          onClick={() => navigate('/new-spot')}
          className="relative w-full overflow-hidden rounded-3xl p-6 text-left ring-1 ring-accent/30"
          style={{
            background:
              'linear-gradient(135deg,#4a0f16 0%,#1c0709 48%,#0a0a0a 100%)',
          }}
        >
          <span className="shimmer-sweep" />
          <div className="relative">
            <p className="font-display text-2xl font-bold text-fg">
              Spotte maintenant
            </p>
            <p className="mt-1.5 max-w-[16rem] text-sm text-fg/60">
              L'IA reconnaît la voiture en quelques secondes
            </p>
            <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-fg shadow-lg shadow-accent/40">
              <Camera className="h-5 w-5" />
              Ouvrir la caméra
            </span>
          </div>
        </button>

        {/* 3 — STATS ROW */}
        <section className="grid grid-cols-4 gap-2.5">
          <StatCard
            icon={<Camera className="h-4 w-4" />}
            value={String(totalSpots)}
            label="Spots"
            onClick={() => navigate('/ma-galerie')}
          />
          <StatCard
            icon={<Tag className="h-4 w-4" />}
            value={String(uniqueBrands)}
            label="Marques"
            onClick={() => navigate('/mes-marques')}
          />
          <StatCard
            icon={<Trophy className="h-4 w-4" />}
            value={rank ? `#${rank}` : '—'}
            label="Rang"
            onClick={() => navigate('/classement')}
          />
          <StatCard
            icon={<Zap className="h-4 w-4" />}
            value={String(xp)}
            label="XP"
          />
        </section>

        {/* 4 — SPOTS RÉCENTS */}
        <section>
          <SectionTitle
            icon={<Flame className="h-[18px] w-[18px]" />}
            label="Spots récents"
            action={
              <button
                onClick={() => navigate('/feed')}
                aria-label="Voir le feed"
                className="text-fg/40 transition-colors hover:text-fg"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            }
          />
          {recent.length === 0 ? (
            <div className="flex flex-col items-center rounded-2xl border border-white/5 bg-card px-6 py-10 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
                <Car className="h-8 w-8 text-accent/70" />
              </div>
              <p className="mt-4 font-medium text-fg">
                Sois le premier à spotter ici
              </p>
              <button
                onClick={() => navigate('/new-spot')}
                className="mt-4 rounded-full bg-accent px-6 py-2.5 text-sm font-semibold text-fg"
              >
                Spotter
              </button>
            </div>
          ) : (
            <div className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
              {recent.map((s) => (
                <button
                  key={s.id}
                  onClick={() => navigate(`/spot/${s.id}`)}
                  className="relative h-40 w-40 flex-none overflow-hidden rounded-2xl bg-card text-left ring-1 ring-white/5"
                >
                  {s.photo_url ? (
                    <img
                      src={s.photo_url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Car className="h-9 w-9 text-fg/20" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3">
                    <p className="truncate text-sm font-semibold text-fg">
                      {s.brand} {s.model}
                    </p>
                    <p className="text-[11px] text-fg/50">
                      {timeAgo(s.created_at)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 5 — PROCHAIN GP */}
        {nextGp && (
          <section>
            <SectionTitle
              icon={<Flag className="h-[18px] w-[18px]" />}
              label="Prochain GP"
            />
            <div className="overflow-hidden rounded-2xl border-l-2 border-accent bg-card">
              <div className="bg-gradient-to-r from-accent/15 to-transparent p-4">
                <div className="flex items-center gap-3">
                  <span className="text-3xl leading-none">{nextGp.flag}</span>
                  <div className="min-w-0">
                    <p className="truncate font-display font-bold text-fg">
                      {nextGp.name}
                    </p>
                    <p className="truncate text-xs text-fg/50">
                      {nextGp.circuit}
                    </p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-4 gap-2">
                  {[
                    { v: cd.d, l: 'JOURS' },
                    { v: cd.h, l: 'HRS' },
                    { v: cd.m, l: 'MIN' },
                    { v: cd.s, l: 'SEC' },
                  ].map((u) => (
                    <div
                      key={u.l}
                      className="rounded-xl bg-black/40 py-2 text-center"
                    >
                      <div className="font-mono text-xl font-bold tabular-nums text-accent">
                        {String(u.v).padStart(2, '0')}
                      </div>
                      <div className="text-[9px] tracking-widest text-fg/40">
                        {u.l}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* 6 — CHALLENGE DU JOUR */}
        <section>
          <SectionTitle
            icon={<Target className="h-[18px] w-[18px]" />}
            label="Challenge du jour"
          />
          <div className="rounded-2xl border border-white/5 bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-fg">
                Spotte {CHALLENGE_TARGET} voitures aujourd'hui
              </p>
              <span className="flex-none rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-bold text-accent">
                +{CHALLENGE_XP} XP
              </span>
            </div>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{ width: `${challengePct}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-fg/40">
              {challengeDone}/{CHALLENGE_TARGET} aujourd'hui
            </p>
            <button
              onClick={() => navigate('/new-spot')}
              disabled={challengeComplete}
              className="mt-4 w-full rounded-full bg-accent py-3 text-sm font-semibold text-fg transition-opacity disabled:opacity-40"
            >
              {challengeComplete ? 'Défi relevé ✦' : 'Relever le défi'}
            </button>
          </div>
        </section>

        {/* 7 — ACTU DU MOMENT */}
        {news.length > 0 && (
          <section>
            <SectionTitle
              icon={<Newspaper className="h-[18px] w-[18px]" />}
              label="Actu du moment"
              action={
                <button
                  onClick={() => navigate('/discover')}
                  aria-label="Voir l'actu"
                  className="text-fg/40 transition-colors hover:text-fg"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              }
            />
            <div className="no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
              {news.map((n) => (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-56 flex-none overflow-hidden rounded-2xl border border-white/5 bg-card"
                >
                  {n.image_url && (
                    <img
                      src={n.image_url}
                      alt=""
                      className="aspect-video w-full object-cover"
                    />
                  )}
                  <div className="p-3">
                    <span
                      className={`inline-block rounded-full px-2.5 py-0.5 text-[9px] font-bold tracking-wide ${
                        NEWS_BADGE[n.category] ?? 'bg-white/15 text-fg'
                      }`}
                    >
                      {n.category.toUpperCase()}
                    </span>
                    <p className="clamp-2 mt-2 text-sm font-medium text-fg">
                      {n.title}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function StatCard({
  icon,
  value,
  label,
  onClick,
}: {
  icon: ReactNode
  value: string
  label: string
  onClick?: () => void
}) {
  const cls =
    'flex w-full flex-col items-center gap-1 rounded-2xl border border-white/5 bg-card py-3.5 shadow-[0_2px_10px_rgba(0,0,0,0.4)]'
  const inner = (
    <>
      <span className="text-accent/70">{icon}</span>
      <div className="font-display text-lg font-bold text-fg">{value}</div>
      <div className="text-[10px] tracking-wide text-fg/40">{label}</div>
    </>
  )
  return onClick ? (
    <button onClick={onClick} className={`${cls} transition-transform active:scale-95`}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  )
}
