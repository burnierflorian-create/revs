import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Trophy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  adaptiveStatSize,
  flagEmoji,
  formatStatNumber,
  getF1Driver,
  getF1Team,
  nationality,
  newsIlikeOr,
  proxyImage,
  splitStatValue,
} from '../lib/f1team'
import { timeAgo } from '../lib/spots'
import { Skeleton } from '../components/Skeleton'

type DriverGp = { name: string; position: string; points: string }
type DriverData = {
  fullName: string
  birthDate: string
  birthPlace: string
  nationality: string
  number: string
  team: string
  championships: string
  wins: string
  poles: string
  podiums: string
  careerPoints: string
  currentPosition: string
  currentPoints: string
  seasonWins?: string
  seasonPodiums?: string
  seasonPoles?: string
  lastFiveGps?: DriverGp[]
  bio: string
  highlights: string
  drivingStyle: string
}

type NewsRow = {
  id: string
  title: string
  summary: string | null
  source: string | null
  url: string
  image_url: string | null
  published_at: string | null
  created_at: string
}

export default function F1DriverDetail() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const driver = getF1Driver(slug)
  const team = driver ? getF1Team(driver.team) : undefined
  const color = team?.color ?? '#333333'

  const [data, setData] = useState<DriverData | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [news, setNews] = useState<NewsRow[]>([])

  useEffect(() => {
    if (!driver) return
    let active = true
    setLoading(true)
    ;(async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const token = session?.access_token
        const factPromise = token
          ? fetch('/api/f1?type=driver', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ slug: driver.slug }),
            }).then((r) => r.json())
          : Promise.resolve({ data: null })
        const titleOr = newsIlikeOr('title', driver.match)
        const summaryOr = newsIlikeOr('summary', driver.match)
        const newsPromise = supabase
          .from('news')
          .select(
            'id, title, summary, source, url, image_url, published_at, created_at',
          )
          .eq('category', 'F1')
          .gt('expires_at', new Date().toISOString())
          .or(`${titleOr},${summaryOr}`)
          .order('published_at', { ascending: false, nullsFirst: false })
          .limit(5)
        const [factRes, newsRes] = await Promise.all([factPromise, newsPromise])
        if (!active) return
        if (factRes?.data) setData(factRes.data as DriverData)
        if (factRes?.generated_at)
          setGeneratedAt(factRes.generated_at as string)
        setNews((newsRes.data ?? []) as NewsRow[])
      } catch {
        /* keep skeleton */
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [driver])

  const age = useMemo(() => {
    if (!data?.birthDate || data.birthDate === 'N/A') return null
    const d = new Date(data.birthDate)
    if (isNaN(d.getTime())) return null
    const ms = Date.now() - d.getTime()
    return Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25))
  }, [data])

  if (!driver) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-8 text-center text-fg">
        <p className="text-sm text-fg2">Pilote introuvable.</p>
        <button
          onClick={() => navigate('/discover')}
          className="tappable rounded-full bg-accent px-6 py-3 text-sm font-extrabold tracking-wider text-fg"
          style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
        >
          VOIR LES PILOTES
        </button>
      </div>
    )
  }

  const initials = driver.name
    .split(' ')
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* ─────────────── HERO ─────────────── */}
      <header
        className="relative overflow-hidden"
        style={{
          background: `radial-gradient(130% 90% at 50% 0%, ${color}cc 0%, ${color}55 40%, ${color}1A 70%, #0a0a0a 100%)`,
        }}
      >
        <button
          onClick={() => navigate(-1)}
          aria-label="Retour"
          className="tappable absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 backdrop-blur"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <ArrowLeft className="h-5 w-5 text-fg" />
        </button>

        <div className="relative flex flex-col items-center px-6 pb-12 pt-[calc(env(safe-area-inset-top)+4rem)] text-center">
          {/* Faded race-number watermark behind the portrait. */}
          {driver.number !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute right-2 top-[calc(env(safe-area-inset-top)+3rem)] font-display text-[180px] font-extrabold leading-none tracking-tighter text-white/[0.08]"
            >
              {driver.number}
            </div>
          )}
          <DriverHeroPortrait
            photo={proxyImage(driver.photo)}
            initials={initials}
            color={color}
          />
          <h1 className="relative mt-5 font-display text-[34px] font-extrabold leading-none tracking-tighter text-white">
            {driver.name}
          </h1>
          <div className="relative mt-3 flex items-center gap-3 text-xs text-white/75">
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="text-base leading-none">
                {flagEmoji(driver.country)}
              </span>
              {nationality(driver.country)}
            </span>
            {driver.number !== null && (
              <>
                <span aria-hidden>·</span>
                <span className="font-extrabold tracking-wider">
                  #{driver.number}
                </span>
              </>
            )}
            {team && (
              <>
                <span aria-hidden>·</span>
                <button
                  onClick={() => navigate(`/f1-team/${team.slug}`)}
                  className="tappable underline-offset-2 hover:underline"
                >
                  {team.name}
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="space-y-8 px-4 pb-8 pt-6">
        {/* Identité card */}
        <section
          className="rounded-3xl bg-card p-5"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {loading && !data ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-1/2 rounded" />
              <Skeleton className="h-4 w-2/3 rounded" />
            </div>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Fact label="Né le" value={formatBirth(data?.birthDate)} />
              <Fact
                label="Âge"
                value={age != null ? `${age} ans` : undefined}
              />
              <Fact label="Lieu" value={data?.birthPlace} />
              <Fact
                label="Classement 2026"
                value={
                  data?.currentPosition && data.currentPosition !== 'N/A'
                    ? `${data.currentPosition}${ordinal(data.currentPosition)} · ${
                        data.currentPoints ?? '—'
                      } pts`
                    : '—'
                }
                highlight
              />
            </dl>
          )}
        </section>

        {/* Palmarès — 5 chiffres clés */}
        <section>
          <SectionTitle>Palmarès</SectionTitle>
          {loading && !data ? (
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <KeyStat
                value={data?.championships ?? '—'}
                label="Titres mondiaux"
                icon={<Trophy className="h-4 w-4" />}
              />
              <KeyStat value={data?.wins ?? '—'} label="Victoires" />
              <KeyStat value={data?.podiums ?? '—'} label="Podiums" />
              <KeyStat value={data?.poles ?? '—'} label="Pole positions" />
              <KeyStat value={data?.careerPoints ?? '—'} label="Points carrière" />
            </div>
          )}
        </section>

        {/* Saison 2026 — chiffres + 5 derniers GPs */}
        {data && hasSeasonStats(data) && (
          <section>
            <SectionTitle>Saison 2026</SectionTitle>
            <div
              className="rounded-3xl bg-card p-5"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div className="grid grid-cols-3 gap-4">
                <SeasonCell value={data.seasonWins} label="Victoires" />
                <SeasonCell value={data.seasonPodiums} label="Podiums" />
                <SeasonCell value={data.seasonPoles} label="Poles" />
              </div>
              {data.lastFiveGps && data.lastFiveGps.length > 0 && (
                <div className="mt-5">
                  <p className="label-up text-[10px] text-fg2">5 derniers GPs</p>
                  <div
                    className="mt-2 overflow-hidden rounded-2xl"
                    style={{ border: '1px solid var(--color-divider)' }}
                  >
                    <div
                      className="grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2 text-[10px] uppercase tracking-wider text-fg2/70"
                      style={{ background: 'rgba(255,255,255,0.02)' }}
                    >
                      <span>Grand Prix</span>
                      <span className="text-right">Pos.</span>
                      <span className="w-12 text-right">Points</span>
                    </div>
                    {data.lastFiveGps.map((gp, i) => (
                      <div
                        key={`${gp.name}-${i}`}
                        className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2.5 text-sm ${
                          i < (data.lastFiveGps?.length ?? 0) - 1
                            ? 'border-b border-white/[0.05]'
                            : ''
                        }`}
                      >
                        <span className="truncate text-fg">
                          {gp.name !== 'N/A' ? gp.name : '—'}
                        </span>
                        <span
                          className={`text-right font-display font-extrabold tracking-tighter ${
                            gp.position === '1'
                              ? 'text-[#FFD700]'
                              : gp.position === '2' || gp.position === '3'
                                ? 'text-accent'
                                : 'text-fg'
                          }`}
                        >
                          {gp.position !== 'N/A' ? gp.position : '—'}
                        </span>
                        <span className="w-12 text-right text-fg2">
                          {gp.points !== 'N/A' ? gp.points : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Biographie */}
        <section>
          <SectionTitle>Biographie</SectionTitle>
          {loading && !data ? (
            <Skeleton className="h-32 rounded-3xl" />
          ) : data?.bio && data.bio !== 'N/A' ? (
            <article
              className="space-y-3 rounded-3xl bg-card p-5"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {data.bio.split(/\n\n+/).map((p, i) => (
                <p
                  key={i}
                  className="font-serif text-[15px] leading-relaxed text-fg/85"
                >
                  {p}
                </p>
              ))}
            </article>
          ) : (
            <p
              className="rounded-3xl bg-card p-5 text-sm text-fg2"
              style={{ border: '1px solid var(--color-border)' }}
            >
              Fiche en cours de rédaction…
            </p>
          )}
        </section>

        {/* Style de pilotage */}
        {data?.drivingStyle && data.drivingStyle !== 'N/A' && (
          <section>
            <SectionTitle>Style de pilotage</SectionTitle>
            <p
              className="rounded-3xl bg-card p-5 font-serif text-[15px] leading-relaxed text-fg/85"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {data.drivingStyle}
            </p>
          </section>
        )}

        {/* Moments marquants */}
        {data?.highlights && data.highlights !== 'N/A' && (
          <section>
            <SectionTitle>Moments marquants</SectionTitle>
            <p
              className="rounded-3xl bg-card p-5 font-serif text-[15px] leading-relaxed text-fg/85"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {data.highlights}
            </p>
          </section>
        )}

        {/* News */}
        {news.length > 0 && (
          <section>
            <SectionTitle>Actu {driver.name}</SectionTitle>
            <div className="space-y-3">
              {news.slice(0, 4).map((n) => (
                <a
                  key={n.id}
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tappable flex gap-3 rounded-3xl bg-card p-3"
                  style={{ border: '1px solid var(--color-border)' }}
                >
                  {n.image_url && (
                    <img
                      src={n.image_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-20 w-20 flex-none rounded-2xl object-cover"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-display text-sm font-extrabold leading-snug tracking-tighter text-fg">
                      {n.title}
                    </p>
                    {n.summary && (
                      <p className="mt-1 line-clamp-2 text-xs text-fg2">
                        {n.summary}
                      </p>
                    )}
                    <p className="label-up mt-1.5 text-[10px] text-fg2">
                      {[n.source, timeAgo(n.published_at ?? n.created_at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        )}

        {loading && data == null && (
          <p className="flex items-center justify-center gap-2 pt-4 text-sm text-fg2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Recherche en cours sur le web…
          </p>
        )}

        {generatedAt && (
          <p className="label-up pt-2 text-center text-[10px] text-fg2/70">
            Mis à jour le {formatUpdated(generatedAt)}
          </p>
        )}
      </main>
    </div>
  )
}

function formatUpdated(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
}

// ─────────────────────── Sub-components ───────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 px-1 font-display text-lg font-extrabold tracking-tighter text-fg">
      {children}
    </h2>
  )
}

function Fact({
  label,
  value,
  highlight,
}: {
  label: string
  value?: string
  highlight?: boolean
}) {
  const shown = value && value !== 'N/A' ? value : '—'
  return (
    <div className="min-w-0">
      <dt className="label-up text-[10px] text-fg2">{label}</dt>
      <dd
        title={shown !== '—' ? shown : undefined}
        className={`mt-1 truncate font-display font-extrabold tracking-tighter ${
          highlight ? 'text-accent' : 'text-fg'
        }`}
      >
        {shown}
      </dd>
    </div>
  )
}

function KeyStat({
  value,
  label,
  icon,
}: {
  value: string
  label: string
  icon?: React.ReactNode
}) {
  const { number, extra } = splitStatValue(value)
  const formatted = formatStatNumber(number)
  return (
    <div
      className="flex h-[112px] flex-col overflow-hidden rounded-2xl bg-card p-3 text-left"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <div className="flex items-baseline gap-1.5">
        {icon && <span className="flex-none text-accent">{icon}</span>}
        <div
          className={`min-w-0 truncate font-display font-extrabold leading-none tracking-tighter text-fg ${adaptiveStatSize(formatted)}`}
          title={formatted !== '—' ? formatted : undefined}
        >
          {formatted}
        </div>
      </div>
      <div className="label-up mt-1.5 text-[10px] leading-snug text-fg2">
        {label}
      </div>
      {extra && (
        <div
          title={extra}
          className="mt-auto truncate pt-1 text-[10px] leading-snug text-fg2/70"
        >
          {extra}
        </div>
      )}
    </div>
  )
}

function DriverHeroPortrait({
  photo,
  initials,
  color,
}: {
  photo?: string
  initials: string
  color: string
}) {
  const [failed, setFailed] = useState(false)
  const showPhoto = photo && !failed
  return (
    <div
      className="relative flex h-28 w-28 items-center justify-center overflow-hidden rounded-full font-display text-3xl font-extrabold tracking-tighter text-white"
      style={{
        background: `linear-gradient(135deg, ${color}, ${color}99)`,
        border: '2px solid rgba(255,255,255,0.18)',
        boxShadow: `0 12px 36px ${color}55`,
      }}
    >
      {showPhoto ? (
        <img
          src={photo}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover object-top"
        />
      ) : (
        initials
      )}
    </div>
  )
}

function hasSeasonStats(d: DriverData): boolean {
  const hasNumbers = [d.seasonWins, d.seasonPodiums, d.seasonPoles].some(
    (v) => v && v !== 'N/A',
  )
  const hasGps = Array.isArray(d.lastFiveGps) && d.lastFiveGps.length > 0
  return hasNumbers || hasGps
}

function SeasonCell({ value, label }: { value?: string; label: string }) {
  const { number } = splitStatValue(value)
  const formatted = formatStatNumber(number)
  return (
    <div className="min-w-0">
      <p
        className={`min-w-0 truncate font-display font-extrabold leading-none tracking-tighter text-fg ${adaptiveStatSize(formatted)}`}
        title={formatted !== '—' ? formatted : undefined}
      >
        {formatted}
      </p>
      <p className="label-up mt-1.5 text-[10px] leading-snug text-fg2">
        {label}
      </p>
    </div>
  )
}

function formatBirth(iso: string | undefined): string | undefined {
  if (!iso || iso === 'N/A') return undefined
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d)
}

function ordinal(pos: string): string {
  return pos === '1' ? 'ʳᵉ' : 'ᵉ'
}
