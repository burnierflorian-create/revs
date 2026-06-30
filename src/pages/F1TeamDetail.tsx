import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Trophy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  adaptiveStatSize,
  driversByTeam,
  flagEmoji,
  formatStatNumber,
  getF1Team,
  newsIlikeOr,
  proxyImage,
  splitStatValue,
  type F1Driver,
} from '../lib/f1team'
import { timeAgo } from '../lib/spots'
import { Skeleton } from '../components/Skeleton'

type TeamData = {
  fullName: string
  shortName: string
  nationality: string
  base: string
  foundedYear: string
  championships: string
  totalWins: string
  totalPoles: string
  currentPosition: string
  currentPoints: string
  seasonWins?: string
  seasonPodiums?: string
  seasonPoles?: string
  lastRaceGp?: string
  lastRaceResults?: string
  carName: string
  engine: string
  specs: string
  history: string
  highlights: string
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

export default function F1TeamDetail() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const team = getF1Team(slug)
  const drivers = useMemo(() => (team ? driversByTeam(team.slug) : []), [team])

  const [data, setData] = useState<TeamData | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [news, setNews] = useState<NewsRow[]>([])

  // Fetch fact-sheet (server-cached 7d) + filtered news in parallel.
  useEffect(() => {
    if (!team) return
    let active = true
    setLoading(true)
    ;(async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const token = session?.access_token
        const factPromise = token
          ? fetch('/api/f1?type=team', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ slug: team.slug }),
            }).then((r) => r.json())
          : Promise.resolve({ data: null })
        const titleOr = newsIlikeOr('title', team.match)
        const summaryOr = newsIlikeOr('summary', team.match)
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
        if (factRes?.data) setData(factRes.data as TeamData)
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
  }, [team])

  if (!team) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg px-8 text-center text-fg">
        <p className="text-sm text-fg2">{t('f1people.teamNotFound')}</p>
        <button
          onClick={() => navigate('/discover')}
          className="tappable rounded-full bg-accent px-6 py-3 text-sm font-extrabold tracking-wider text-fg"
          style={{ boxShadow: '0 8px 24px rgba(232,32,58,0.45)' }}
        >
          {t('f1people.seeTeams')}
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* ─────────────── HERO ─────────────── */}
      <header
        className="relative overflow-hidden"
        style={{
          background: `radial-gradient(130% 90% at 50% 0%, ${team.color}cc 0%, ${team.color}55 40%, ${team.color}1A 70%, rgb(var(--color-bg)) 100%)`,
        }}
      >
        <button
          onClick={() => navigate(-1)}
          aria-label={t('f1people.back')}
          className="tappable absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/30 backdrop-blur"
          style={{ border: '1px solid rgb(var(--color-fg) / 0.08)' }}
        >
          <ArrowLeft className="h-5 w-5 text-fg" />
        </button>
        <div className="relative flex flex-col items-center px-6 pb-12 pt-[calc(env(safe-area-inset-top)+4rem)] text-center">
          <span className="label-up text-[11px] text-fg/65">
            {t('f1people.formula1Season')}
          </span>
          <h1 className="mt-3 font-display text-[34px] font-extrabold leading-none tracking-tighter text-white">
            {team.name}
          </h1>
          {data?.fullName && (
            <p className="mt-2 max-w-[28ch] text-xs text-fg/55">
              {data.fullName}
            </p>
          )}
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
              <Fact label={t('f1people.nationality')} value={data?.nationality} />
              <Fact label={t('f1people.base')} value={data?.base} />
              <Fact label={t('f1people.foundedIn')} value={data?.foundedYear} />
              <Fact
                label={t('f1people.ranking2026')}
                value={
                  data?.currentPosition && data.currentPosition !== 'N/A'
                    ? `${data.currentPosition}${ordinal(data.currentPosition)} · ${
                        data.currentPoints ?? '—'
                      } ${t('f1people.pts')}`
                    : '—'
                }
                highlight
              />
            </dl>
          )}
        </section>

        {/* Palmarès */}
        <section>
          <SectionTitle>{t('f1people.palmares')}</SectionTitle>
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
                label={t('f1people.constructorTitles')}
                icon={<Trophy className="h-4 w-4" />}
              />
              <KeyStat value={data?.totalWins ?? '—'} label={t('f1people.wins')} />
              <KeyStat value={data?.totalPoles ?? '—'} label={t('f1people.polePositions')} />
            </div>
          )}
        </section>

        {/* Saison 2026 — chiffres + dernier GP */}
        {data && hasSeasonStats(data) && (
          <section>
            <SectionTitle>{t('f1people.season2026')}</SectionTitle>
            <div
              className="rounded-3xl bg-card p-5"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div className="grid grid-cols-3 gap-4">
                <SeasonCell value={data.seasonWins} label={t('f1people.wins')} />
                <SeasonCell value={data.seasonPodiums} label={t('f1people.podiums')} />
                <SeasonCell value={data.seasonPoles} label={t('f1people.poles')} />
              </div>
              {data.lastRaceGp &&
                data.lastRaceGp !== 'N/A' &&
                data.lastRaceResults &&
                data.lastRaceResults !== 'N/A' && (
                  <div
                    className="mt-4 rounded-2xl px-4 py-3"
                    style={{
                      background: 'rgb(var(--color-fg) / 0.03)',
                      border: '1px solid var(--color-divider)',
                    }}
                  >
                    <p className="label-up text-[10px] text-fg2">
                      {t('f1people.lastGp', { name: data.lastRaceGp })}
                    </p>
                    <p className="mt-1.5 text-sm font-bold text-fg">
                      {data.lastRaceResults}
                    </p>
                  </div>
                )}
            </div>
          </section>
        )}

        {/* Voiture 2026 */}
        {data && (data.carName !== 'N/A' || data.engine !== 'N/A') && (
          <section>
            <SectionTitle>{t('f1people.car2026')}</SectionTitle>
            <div
              className="rounded-3xl bg-card p-5"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Fact label={t('f1people.designation')} value={data.carName} />
                <Fact label={t('f1people.engine')} value={data.engine} />
              </dl>
              {data.specs && data.specs !== 'N/A' && (
                <p
                  className="mt-4 text-sm text-fg/85"
                  style={{ lineHeight: 1.6 }}
                >
                  {data.specs}
                </p>
              )}
            </div>
          </section>
        )}

        {/* Pilotes 2026 */}
        {drivers.length > 0 && (
          <section>
            <SectionTitle>{t('f1people.drivers2026')}</SectionTitle>
            <div className="grid grid-cols-2 gap-2">
              {drivers.map((d) => (
                <DriverPill
                  key={d.slug}
                  driver={d}
                  color={team.color}
                  onClick={() => navigate(`/f1-driver/${d.slug}`)}
                />
              ))}
            </div>
          </section>
        )}

        {/* Histoire */}
        <section>
          <SectionTitle>{t('f1people.history')}</SectionTitle>
          {loading && !data ? (
            <Skeleton className="h-32 rounded-3xl" />
          ) : data?.history && data.history !== 'N/A' ? (
            <article
              className="space-y-3 rounded-3xl bg-card p-5"
              style={{ border: '1px solid var(--color-border)' }}
            >
              {data.history.split(/\n\n+/).map((p, i) => (
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
              {t('f1people.sheetInProgress')}
            </p>
          )}
        </section>

        {/* Moments marquants */}
        {data?.highlights && data.highlights !== 'N/A' && (
          <section>
            <SectionTitle>{t('f1people.highlights')}</SectionTitle>
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
            <SectionTitle>{t('f1people.newsAbout', { name: team.name })}</SectionTitle>
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
            {t('f1people.searchingWeb')}
          </p>
        )}

        {generatedAt && (
          <p className="label-up pt-2 text-center text-[10px] text-fg2/70">
            {t('f1people.updatedOn', { date: formatUpdated(generatedAt) })}
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
  // Claude sometimes wraps the count with parenthetical context
  // ("8 (Constructeurs : 2014…)"). Pin the count as the headline and
  // dump the rest on a small truncated line so the cards stay aligned
  // at a fixed height no matter how verbose the source.
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

function DriverPill({
  driver,
  color,
  onClick,
}: {
  driver: F1Driver
  color: string
  onClick: () => void
}) {
  const photoUrl = proxyImage(driver.photo)
  return (
    <button
      onClick={onClick}
      className="tappable flex items-center gap-3 overflow-hidden rounded-2xl bg-card p-3 text-left"
      style={{ border: '1px solid var(--color-border)' }}
    >
      <span
        className="relative flex h-11 w-11 flex-none items-center justify-center overflow-hidden rounded-full font-display text-sm font-extrabold tracking-tighter text-white"
        style={{
          background: color,
          boxShadow: `0 6px 18px ${color}55`,
        }}
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        ) : (
          driver.number ?? driver.name.charAt(0)
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p
          title={driver.name}
          className="truncate font-display text-sm font-extrabold tracking-tighter text-fg"
        >
          {driver.name}
        </p>
        <p className="mt-0.5 text-[11px] text-fg2">
          <span aria-hidden>{flagEmoji(driver.country)}</span>{' '}
          {driver.number !== null ? `#${driver.number}` : 'F1'}
        </p>
      </div>
    </button>
  )
}

function ordinal(pos: string): string {
  return pos === '1' ? 'ʳᵉ' : 'ᵉ'
}

function hasSeasonStats(d: TeamData): boolean {
  return [d.seasonWins, d.seasonPodiums, d.seasonPoles, d.lastRaceGp].some(
    (v) => v && v !== 'N/A',
  )
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
