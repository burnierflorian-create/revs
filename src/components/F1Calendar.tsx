import { useEffect, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { GP_2026, fmtGpDate, type GrandPrix } from '../lib/f1'
import { F1_TEAMS } from '../lib/f1team'
import { supabase } from '../lib/supabase'

type Podium = { driver: string; team: string; position?: number }
type RaceData = { podium?: Podium[]; summary?: string }
type RaceRow = { round: number; data: RaceData | null }

// Team livery colour from the podium's short team name (best-effort match
// against the static catalogue) — used to tint the podium rows.
function teamColor(name: string): string {
  const n = (name ?? '').toLowerCase()
  const t = F1_TEAMS.find(
    (x) => x.match.some((m) => n.includes(m)) || n.includes(x.name.toLowerCase()),
  )
  return t?.color ?? '#888'
}

// Rich GP calendar: a #141414 card per Grand Prix. Finished races open a
// podium + AI-summary modal; the next race is highlighted (red border,
// animated "PROCHAIN" badge, live countdown); future races stay muted.
export default function F1Calendar() {
  const navigate = useNavigate()
  const [now, setNow] = useState(() => Date.now())
  const [results, setResults] = useState<Record<number, RaceData>>({})
  const [openRound, setOpenRound] = useState<number | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('f1_race_results')
        .select('round, data')
      if (!active) return
      const m: Record<number, RaceData> = {}
      for (const r of (data ?? []) as RaceRow[]) {
        if (r.data) m[r.round] = r.data
      }
      setResults(m)
    })()
    return () => {
      active = false
    }
  }, [])

  const nextIndex = GP_2026.findIndex((g) => new Date(g.date).getTime() >= now)
  const openGp =
    openRound != null ? GP_2026.find((g) => g.round === openRound) ?? null : null

  return (
    <section className="space-y-2.5 pt-1">
      {GP_2026.map((g, i) => {
        const ts = new Date(g.date).getTime()
        const isPast = ts < now
        const isNext = i === nextIndex
        if (isNext) {
          return (
            <NextGpCard
              key={g.round}
              gp={g}
              diff={ts - now}
              onTap={() => navigate(`/f1/${g.round}`)}
            />
          )
        }
        if (isPast) {
          return (
            <PastGpCard
              key={g.round}
              gp={g}
              onTap={() => setOpenRound(g.round)}
            />
          )
        }
        return <FutureGpCard key={g.round} gp={g} />
      })}

      {openGp &&
        createPortal(
          <RaceModal
            gp={openGp}
            data={results[openGp.round] ?? null}
            onClose={() => setOpenRound(null)}
          />,
          document.body,
        )}
    </section>
  )
}

// ─────────────────────────── cards ───────────────────────────

const CARD: CSSProperties = {
  background: '#141414',
  border: '1px solid rgba(255,255,255,0.06)',
}

function Flag({ flag }: { flag: string }) {
  return (
    <span
      className="flex h-10 w-10 flex-none items-center justify-center overflow-hidden rounded-lg text-xl leading-none"
      style={{ background: 'rgba(255,255,255,0.05)' }}
    >
      {flag}
    </span>
  )
}

function PastGpCard({ gp, onTap }: { gp: GrandPrix; onTap: () => void }) {
  return (
    <button
      onClick={onTap}
      className="tappable flex w-full items-center gap-3 rounded-2xl p-3 text-left transition-transform active:scale-[0.99]"
      style={CARD}
    >
      <Flag flag={gp.flag} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold text-white">{gp.name}</p>
        <p className="truncate text-[12px] text-white/45">{gp.circuit}</p>
      </div>
      <span
        className="flex-none rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
        style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.5)' }}
      >
        Terminé
      </span>
    </button>
  )
}

function FutureGpCard({ gp }: { gp: GrandPrix }) {
  return (
    <div
      className="flex w-full items-center gap-3 rounded-2xl p-3"
      style={{ background: '#0d0d0d', border: '1px solid rgba(255,255,255,0.04)' }}
    >
      <Flag flag={gp.flag} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-white/80">
          {gp.name}
        </p>
        <p className="truncate text-[12px] text-white/35">{gp.circuit}</p>
      </div>
      <span className="flex-none text-[12px] tabular-nums text-white/40">
        {fmtGpDate(gp.date)}
      </span>
    </div>
  )
}

function NextGpCard({
  gp,
  diff,
  onTap,
}: {
  gp: GrandPrix
  diff: number
  onTap: () => void
}) {
  const d = Math.max(0, Math.floor(diff / 86_400_000))
  const h = Math.max(0, Math.floor((diff % 86_400_000) / 3_600_000))
  return (
    <button
      onClick={onTap}
      className="tappable relative block w-full overflow-hidden rounded-2xl p-4 text-left transition-transform active:scale-[0.99]"
      style={{
        background: '#141414',
        border: '2px solid #E8203A',
        boxShadow: '0 8px 26px rgba(232,32,58,0.20)',
      }}
    >
      <div className="flex items-center gap-3">
        <Flag flag={gp.flag} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-extrabold text-white">
            {gp.name}
          </p>
          <p className="truncate text-[12px] italic" style={{ color: '#FF6B7A' }}>
            {gp.circuit}
          </p>
        </div>
        <span
          className="flex-none rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white"
          style={{ background: '#E8203A', animation: 'pulse 1.8s ease-in-out infinite' }}
        >
          Prochain
        </span>
      </div>
      <p className="mt-3 font-display font-extrabold tabular-nums text-white">
        {diff > 0 ? (
          <>
            <span style={{ fontSize: '22px' }}>Dans {d}j {h}h</span>
          </>
        ) : (
          <span style={{ fontSize: '20px', color: '#E8203A' }}>En cours !</span>
        )}
      </p>
    </button>
  )
}

// ─────────────────────────── modal ───────────────────────────

function RaceModal({
  gp,
  data,
  onClose,
}: {
  gp: GrandPrix
  data: RaceData | null
  onClose: () => void
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  const podium = (data?.podium ?? [])
    .slice()
    .sort((a, b) => (a.position ?? 9) - (b.position ?? 9))
    .slice(0, 3)
  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <button
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0"
        style={{
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          animation: 'sheet-backdrop-in 200ms ease-out both',
        }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 px-5 pt-3"
        style={{
          background: '#141414',
          borderTopLeftRadius: '28px',
          borderTopRightRadius: '28px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          paddingBottom: 'max(env(safe-area-inset-bottom), 24px)',
          maxHeight: '85vh',
          overflowY: 'auto',
          boxShadow: '0 -24px 60px rgba(0,0,0,0.65)',
          animation: 'sheet-slide-up 280ms cubic-bezier(0.32,0.72,0,1) both',
        }}
      >
        <div className="flex justify-center pt-1">
          <span
            aria-hidden
            className="rounded-full"
            style={{ width: 40, height: 4, background: 'rgba(255,255,255,0.18)' }}
          />
        </div>

        <div className="mt-4 flex items-start gap-3">
          <span style={{ fontSize: '30px', lineHeight: 1 }}>{gp.flag}</span>
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-[20px] font-extrabold tracking-tight text-white">
              {gp.name}
            </h3>
            <p className="truncate text-[12px] italic text-white/45">
              {gp.circuit}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="tappable flex h-9 w-9 flex-none items-center justify-center rounded-full text-white/60"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {podium.length > 0 ? (
          <div className="mt-5 space-y-2">
            {podium.map((p, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{
                  background: '#0d0d0d',
                  borderLeft: `3px solid ${teamColor(p.team)}`,
                }}
              >
                <span style={{ fontSize: '20px' }}>{medals[i]}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-white">
                  {p.driver}
                </span>
                <span className="flex-none text-[12px] font-medium text-white/45">
                  {p.team}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-xl bg-[#0d0d0d] px-4 py-3 text-center text-[13px] text-white/40">
            Résultats bientôt disponibles.
          </p>
        )}

        {data?.summary && data.summary !== 'N/A' && (
          <div className="mt-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">
              Résumé de la course
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-white/80">
              {data.summary}
            </p>
          </div>
        )}

        <button
          onClick={onClose}
          className="tappable mt-6 w-full rounded-full py-3 text-[14px] font-semibold text-white"
          style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          Fermer
        </button>
      </div>
    </div>
  )
}
