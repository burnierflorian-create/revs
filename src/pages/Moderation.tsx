// ═══════ PANNEAU DE MODÉRATION ═══════
//
// Réservé aux rôles `moderator` et `admin`. L'accès n'est pas gardé par cette
// page : chaque fonction SQL vérifie le rôle elle-même (`current_role_is`),
// et les tables ne sont lisibles que par ces rôles. Quelqu'un qui atteindrait
// l'URL verrait donc des listes vides, pas des données. L'écran de refus
// ci-dessous est une politesse, pas une serrure.
//
// ── CE QUE L'ADMIN VOIT, ET CE QU'IL NE VOIT PAS ──
// Le contenu, son auteur, les motifs, l'historique, l'analyse automatique.
// JAMAIS l'identité de ceux qui ont signalé : on décide sur un contenu, pas
// sur qui s'en est plaint — et savoir qui signale transforme la modération en
// arbitrage entre personnes.

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Bot, Scale, ShieldAlert, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/spots'

type Tab = 'cases' | 'appeals' | 'sanctioned' | 'history'

type CaseRow = {
  case_id: string
  target_type: string
  target_id: string
  target_owner: string | null
  owner_pseudo: string | null
  owner_avatar: string | null
  report_count: number
  status: string
  risk: string | null
  bot_verdict: string | null
  bot_source: string | null
  reasons: string[] | null
  preview: string | null
  updated_at: string
  priority: string
}

type Appeal = {
  appeal_id: string
  user_id: string
  pseudo: string | null
  message: string
  status: string
  created_at: string
  sanction_kind: string
  sanction_reason: string
  sanction_until: string | null
  sanction_lifted: boolean
}

type Sanctioned = {
  sanction_id: string
  user_id: string
  pseudo: string | null
  kind: string
  reason: string
  until: string | null
  origin: string
  created_at: string
  has_appeal: boolean
}

type HistoryRow = {
  id: string
  action: string
  origin: string
  reason: string | null
  created_at: string
  actor: string | null
  target_pseudo: string | null
  target_type: string | null
}

/** Les actions, et qui peut les prendre. Les deux dernières sont
 *  irréversibles : la base les refuse à un simple modérateur, et l'interface
 *  demande en plus une confirmation explicite. */
const ACTIONS = [
  { key: 'dismiss', danger: false, confirm: false },
  { key: 'delete_content', danger: false, confirm: true },
  { key: 'warn', danger: false, confirm: false },
  { key: 'restrict', danger: false, confirm: true },
  { key: 'suspend', danger: true, confirm: true },
  { key: 'ban', danger: true, confirm: true },
  { key: 'escalate', danger: false, confirm: false },
] as const

export default function Moderation() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [role, setRole] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('cases')
  const [cases, setCases] = useState<CaseRow[] | null>(null)
  const [appeals, setAppeals] = useState<Appeal[] | null>(null)
  const [sanctioned, setSanctioned] = useState<Sanctioned[] | null>(null)
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  const [openCase, setOpenCase] = useState<Record<string, unknown> | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [counts, setCounts] = useState<Record<string, number> | null>(null)
  const [suspects, setSuspects] = useState<
    { user_id: string; pseudo: string | null; total: number; dismissed: number; reason: string }[]
  >([])
  /** Ne montrer que les dossiers urgents. Un filtre, pas un onglet de plus :
   *  l'urgence traverse la même file. */
  const [urgentOnly, setUrgentOnly] = useState(false)

  useEffect(() => {
    let active = true
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        if (active) setRole('none')
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('role')
        .eq('user_id', user.id)
        .maybeSingle()
      if (active) setRole((data?.role as string) ?? 'user')
    })()
    return () => {
      active = false
    }
  }, [])

  const load = useCallback(async () => {
    const [c, a, s, h, n, sr] = await Promise.all([
      supabase.rpc('moderation_queue', { p_status: 'all' }),
      supabase.rpc('moderation_appeals_queue'),
      supabase.rpc('moderation_sanctioned'),
      supabase.rpc('moderation_history'),
      supabase.rpc('moderation_counts'),
      supabase.rpc('suspicious_reporters'),
    ])
    setCases((c.data ?? []) as CaseRow[])
    setAppeals((a.data ?? []) as Appeal[])
    setSanctioned((s.data ?? []) as Sanctioned[])
    setHistory((h.data ?? []) as HistoryRow[])
    setCounts((n.data as Record<string, number>) ?? null)
    setSuspects(
      (sr.data ?? []) as {
        user_id: string
        pseudo: string | null
        total: number
        dismissed: number
        reason: string
      }[],
    )
  }, [])

  useEffect(() => {
    if (role !== 'moderator' && role !== 'admin') return
    // Le chargement vit dans un corps asynchrone : appeler `load()` en
    // synchrone depuis l'effet déclenche un rendu de plus avant même que la
    // requête soit partie.
    let active = true
    void (async () => {
      if (active) await load()
    })()
    return () => {
      active = false
    }
  }, [role, load])

  async function openDetail(id: string) {
    const { data } = await supabase.rpc('moderation_case_detail', { p_case: id })
    setOpenCase((data as Record<string, unknown>) ?? null)
    setReason('')
  }

  async function act(caseId: string, action: string, needsConfirm: boolean) {
    if (!reason.trim()) {
      setNotice(t('moderation.reasonRequired'))
      return
    }
    if (needsConfirm && !window.confirm(t(`moderation.confirm.${action}`))) return
    setBusy(true)
    const { error } = await supabase.rpc('moderation_act', {
      p_case: caseId,
      p_action: action,
      p_reason: reason.trim(),
      p_days: null,
    })
    setBusy(false)
    setNotice(error ? error.message : t('moderation.done'))
    if (!error) {
      setOpenCase(null)
      void load()
    }
    setTimeout(() => setNotice(null), 3000)
  }

  async function askExplanation(caseId: string) {
    const q = window.prompt(t('moderation.askPrompt'))
    if (!q || !q.trim()) return
    setBusy(true)
    const { error } = await supabase.rpc('moderation_ask', {
      p_case: caseId,
      p_question: q.trim(),
    })
    setBusy(false)
    setNotice(error ? error.message : t('moderation.asked'))
    if (!error) {
      setOpenCase(null)
      void load()
    }
    setTimeout(() => setNotice(null), 3000)
  }

  async function decideAppeal(id: string, accept: boolean) {
    const note = window.prompt(t('moderation.appealNote'))
    if (note === null) return
    setBusy(true)
    const { error } = await supabase.rpc('moderation_decide_appeal', {
      p_appeal: id,
      p_accept: accept,
      p_note: note,
    })
    setBusy(false)
    setNotice(error ? error.message : t('moderation.done'))
    if (!error) void load()
    setTimeout(() => setNotice(null), 3000)
  }

  async function lift(id: string) {
    const note = window.prompt(t('moderation.liftNote'))
    if (note === null) return
    setBusy(true)
    const { error } = await supabase.rpc('moderation_lift', {
      p_sanction: id,
      p_reason: note || '—',
    })
    setBusy(false)
    setNotice(error ? error.message : t('moderation.done'))
    if (!error) void load()
    setTimeout(() => setNotice(null), 3000)
  }

  if (role === null) {
    return <div className="min-h-screen bg-bg" />
  }
  if (role !== 'moderator' && role !== 'admin') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-8 text-center">
        <ShieldAlert className="h-10 w-10 text-fg2" />
        <p className="text-[16px] font-bold text-fg">{t('moderation.forbidden')}</p>
        <button
          onClick={() => navigate('/')}
          className="tappable mt-2 rounded-full px-5 py-2.5 text-[13px] font-bold text-white"
          style={{ background: 'var(--revs-red)' }}
        >
          {t('moderation.backHome')}
        </button>
      </div>
    )
  }

  const pendingAll = (cases ?? []).filter(
    (c) => c.status === 'open' || c.status === 'needs_review',
  )
  const pending = urgentOnly ? pendingAll.filter((c) => c.priority === 'urgent') : pendingAll
  const urgentCount = pendingAll.filter((c) => c.priority === 'urgent').length
  const pendingAppeals = (appeals ?? []).filter((a) => a.status === 'pending')

  const TABS: { key: Tab; n: number; icon: React.ReactNode }[] = [
    { key: 'cases', n: pendingAll.length, icon: <AlertTriangle className="h-4 w-4" /> },
    { key: 'appeals', n: pendingAppeals.length, icon: <Scale className="h-4 w-4" /> },
    { key: 'sanctioned', n: (sanctioned ?? []).length, icon: <Users className="h-4 w-4" /> },
    { key: 'history', n: (history ?? []).length, icon: <Bot className="h-4 w-4" /> },
  ]

  return (
    <div
      className="min-h-screen bg-bg px-4"
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))',
      }}
    >
      <div className="flex items-center gap-3 pb-4">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('moderation.back')}
          className="tappable flex h-9 w-9 flex-none items-center justify-center rounded-full text-fg2"
          style={{ background: 'rgb(var(--color-fg) / 0.07)' }}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="font-display text-[20px] font-extrabold tracking-tight text-fg">
          {t('moderation.title')}
        </h1>
        <span
          className="ml-auto rounded-full px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-wider"
          style={{ background: 'rgb(var(--color-accent) / 0.16)', color: 'var(--revs-red)' }}
        >
          {role}
        </span>
      </div>

      <div className="mb-4 flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {TABS.map(({ key, n, icon }) => {
          const on = tab === key
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-pressed={on}
              className="tappable flex flex-none items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px]"
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
              {icon}
              {t(`moderation.tab.${key}`)}
              <span className="font-bold tabular-nums">{n}</span>
            </button>
          )
        })}
      </div>

      {notice && (
        <p
          role="status"
          className="mb-3 rounded-xl px-3 py-2 text-center text-[12.5px] font-semibold text-fg"
          style={{ background: 'rgb(var(--color-accent) / 0.16)' }}
        >
          {notice}
        </p>
      )}

      {tab === 'cases' && (
        <div className="space-y-2">
          {/* La ligne que l'administration lit en arrivant. Les signalements
              sont des ALERTES : ce compteur dit ce qu'il reste à regarder,
              jamais ce qui est fautif. */}
          {counts && (
            <div
              className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl px-4 py-3"
              style={{ background: 'rgb(var(--color-fg) / 0.05)' }}
            >
              <Stat n={counts.to_review ?? 0} label={t('moderation.statToReview')} />
              <Stat n={counts.urgent ?? 0} label={t('moderation.statUrgent')} accent />
              <Stat n={counts.appeals ?? 0} label={t('moderation.statAppeals')} />
              <Stat n={counts.dismissed ?? 0} label={t('moderation.statDismissed')} />
              <Stat n={counts.sanctions_active ?? 0} label={t('moderation.statSanctions')} />
            </div>
          )}

          {urgentCount > 0 && (
            <button
              onClick={() => setUrgentOnly((v) => !v)}
              aria-pressed={urgentOnly}
              className="tappable mb-1 w-full rounded-xl py-2.5 text-[13px] font-bold"
              style={
                urgentOnly
                  ? { background: 'var(--revs-red)', color: '#fff' }
                  : { background: 'rgba(232,32,58,0.12)', color: 'var(--revs-red)' }
              }
            >
              {urgentOnly
                ? t('moderation.showAll')
                : t('moderation.showUrgent', { count: urgentCount })}
            </button>
          )}

          {suspects.length > 0 && (
            <div
              className="mb-1 rounded-2xl px-4 py-3"
              style={{ background: 'rgb(var(--color-fg) / 0.05)' }}
            >
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-fg2">
                {t('moderation.suspiciousReporters')}
              </p>
              {suspects.map((s) => (
                <p key={s.user_id} className="mt-1 text-[12.5px] text-fg">
                  {s.pseudo ?? '—'} —{' '}
                  <span className="text-fg2">
                    {s.reason} ({s.dismissed}/{s.total} {t('moderation.dismissedShort')})
                  </span>
                </p>
              ))}
              <p className="mt-1.5 text-[11.5px] italic text-fg2">
                {t('moderation.suspiciousHint')}
              </p>
            </div>
          )}

          {pending.length === 0 && (
            <p className="py-10 text-center text-[13px] text-fg2">{t('moderation.noCases')}</p>
          )}
          {pending.map((c) => (
            <button
              key={c.case_id}
              onClick={() => void openDetail(c.case_id)}
              className="tappable block w-full rounded-2xl px-4 py-3 text-left"
              style={{
                background: 'rgb(var(--color-card))',
                border: '1px solid var(--color-border)',
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider"
                  style={{
                    background: 'rgb(var(--color-fg) / 0.08)',
                    color: 'rgb(var(--color-fg-2))',
                  }}
                >
                  {t(`moderation.type.${c.target_type}`)}
                </span>
                {c.priority !== 'normal' && (
                  <span
                    className="rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider"
                    style={
                      c.priority === 'urgent'
                        ? { background: 'rgba(232,32,58,0.2)', color: 'var(--revs-red)' }
                        : { background: 'rgba(245,158,11,0.18)', color: '#F59E0B' }
                    }
                  >
                    {t(`moderation.priority.${c.priority}`)}
                  </span>
                )}
                {c.status === 'needs_review' && (
                  <span
                    className="rounded-md px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider"
                    style={{
                      background: 'rgb(var(--color-fg) / 0.1)',
                      color: 'rgb(var(--color-fg-2))',
                    }}
                  >
                    {t('moderation.needsReview')}
                  </span>
                )}
                <span className="ml-auto text-[11.5px] text-fg2">{timeAgo(c.updated_at)}</span>
              </div>
              <p className="mt-1.5 truncate text-[14.5px] font-bold text-fg">
                {c.preview || '—'}
              </p>
              <p className="mt-0.5 text-[12.5px] text-fg2">
                {t('moderation.by', { pseudo: c.owner_pseudo ?? '—' })} ·{' '}
                {t('moderation.reportCount', { count: c.report_count })}
                {c.reasons?.length ? ` · ${c.reasons.map((r) => t(`report.reason.${r}`)).join(', ')}` : ''}
              </p>
              {/* L'analyse automatique est montrée en toutes lettres, sans
                  pourcentage : un chiffre de confiance invite à se reposer
                  dessus, alors qu'il ne sert qu'à décider qui tranche. */}
              {c.bot_verdict && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] italic leading-snug text-fg2">
                  <Bot className="mt-0.5 h-3.5 w-3.5 flex-none" />
                  {c.bot_verdict}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {tab === 'appeals' && (
        <div className="space-y-2">
          {(appeals ?? []).length === 0 && (
            <p className="py-10 text-center text-[13px] text-fg2">{t('moderation.noAppeals')}</p>
          )}
          {(appeals ?? []).map((a) => (
            <div
              key={a.appeal_id}
              className="rounded-2xl px-4 py-3"
              style={{
                background: 'rgb(var(--color-card))',
                border: '1px solid var(--color-border)',
              }}
            >
              <p className="text-[14.5px] font-bold text-fg">{a.pseudo ?? '—'}</p>
              <p className="text-[12.5px] text-fg2">
                {t(`moderation.sanction.${a.sanction_kind}`)} · {a.sanction_reason}
              </p>
              <p className="mt-2 whitespace-pre-wrap rounded-xl px-3 py-2 text-[13px] leading-relaxed text-fg"
                 style={{ background: 'rgb(var(--color-fg) / 0.05)' }}>
                {a.message}
              </p>
              {a.status === 'pending' ? (
                <div className="mt-2.5 flex gap-2">
                  <button
                    onClick={() => void decideAppeal(a.appeal_id, true)}
                    disabled={busy}
                    className="tappable flex-1 rounded-full py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
                    style={{ background: '#22C55E' }}
                  >
                    {t('moderation.acceptAppeal')}
                  </button>
                  <button
                    onClick={() => void decideAppeal(a.appeal_id, false)}
                    disabled={busy}
                    className="tappable flex-1 rounded-full py-2.5 text-[13px] font-bold text-fg disabled:opacity-50"
                    style={{ background: 'rgb(var(--color-fg) / 0.08)' }}
                  >
                    {t('moderation.rejectAppeal')}
                  </button>
                </div>
              ) : (
                <p className="mt-2 text-[12px] font-semibold text-fg2">
                  {t(`moderation.appealStatus.${a.status}`)}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'sanctioned' && (
        <div className="space-y-2">
          {(sanctioned ?? []).length === 0 && (
            <p className="py-10 text-center text-[13px] text-fg2">
              {t('moderation.noSanctions')}
            </p>
          )}
          {(sanctioned ?? []).map((s) => (
            <div
              key={s.sanction_id}
              className="flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{
                background: 'rgb(var(--color-card))',
                border: '1px solid var(--color-border)',
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-bold text-fg">
                  {s.pseudo ?? '—'}
                </span>
                <span className="block text-[12.5px] text-fg2">
                  {t(`moderation.sanction.${s.kind}`)} · {s.reason}
                  {s.origin === 'auto' ? ` · ${t('moderation.auto')}` : ''}
                </span>
              </span>
              <button
                onClick={() => void lift(s.sanction_id)}
                disabled={busy}
                className="tappable flex-none rounded-full px-3.5 py-2 text-[12.5px] font-bold text-fg disabled:opacity-50"
                style={{ background: 'rgb(var(--color-fg) / 0.1)' }}
              >
                {t('moderation.lift')}
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-1.5">
          {(history ?? []).length === 0 && (
            <p className="py-10 text-center text-[13px] text-fg2">{t('moderation.noHistory')}</p>
          )}
          {(history ?? []).map((h) => (
            <div
              key={h.id}
              className="rounded-xl px-3.5 py-2.5"
              style={{ background: 'rgb(var(--color-fg) / 0.04)' }}
            >
              <p className="text-[13px] font-semibold text-fg">
                {t(`moderation.action.${h.action}`)}
                {h.target_pseudo ? ` — ${h.target_pseudo}` : ''}
              </p>
              <p className="text-[11.5px] text-fg2">
                {h.origin === 'auto' ? t('moderation.auto') : (h.actor ?? t('moderation.human'))} ·{' '}
                {timeAgo(h.created_at)}
                {h.reason ? ` · ${h.reason}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── FICHE ── */}
      {openCase && <CaseDetail
        data={openCase}
        reason={reason}
        setReason={setReason}
        busy={busy}
        isAdmin={role === 'admin'}
        onAct={act}
        onAsk={askExplanation}
        onClose={() => setOpenCase(null)}
      />}
    </div>
  )
}

function CaseDetail({
  data,
  reason,
  setReason,
  busy,
  isAdmin,
  onAct,
  onAsk,
  onClose,
}: {
  data: Record<string, unknown>
  reason: string
  setReason: (v: string) => void
  busy: boolean
  isAdmin: boolean
  onAct: (caseId: string, action: string, confirm: boolean) => void
  onAsk: (caseId: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const c = data.case as Record<string, unknown>
  const content = data.content as Record<string, unknown> | null
  const owner = data.owner as Record<string, unknown> | null
  const reports = (data.reports ?? []) as { reason: string; note: string | null; at: string }[]
  const history = (data.history ?? []) as {
    action: string
    origin: string
    reason: string | null
    at: string
  }[]
  const sanctions = (data.sanctions ?? []) as {
    kind: string
    reason: string
    lifted: boolean
    at: string
  }[]

  // Portail — quatrième fois que ce piège se présente dans REVS (panneau
  // Membres, commentaires, recadrage de photo, et maintenant cette fiche).
  // Les routes de ce groupe vivent sous un conteneur transformé : un
  // `position: fixed` s'y mesure sur l'ancêtre et non sur la fenêtre, et son
  // z-index reste enfermé sous celui de la barre de navigation. Monté sur
  // document.body, le problème ne se pose plus.
  return createPortal(
    <div
      className="fixed inset-0 z-[150] flex items-end"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet-rise w-full overflow-y-auto rounded-t-3xl px-4"
        style={{
          background: 'rgb(var(--color-card))',
          borderTop: '1px solid var(--color-border)',
          maxHeight: '92vh',
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="sticky top-0 z-10 -mx-4 px-4 pb-2 pt-4"
             style={{ background: 'rgb(var(--color-card))' }}>
          <h2 className="text-[17px] font-bold text-fg">{t('moderation.caseTitle')}</h2>
        </div>

        <Section title={t('moderation.content')}>
          {content ? (
            <>
              {typeof content.photo_url === 'string' && (
                <img
                  src={content.photo_url as string}
                  alt=""
                  className="mb-2 max-h-56 w-full rounded-xl object-cover"
                />
              )}
              {typeof content.media_url === 'string' && (
                <img
                  src={content.media_url as string}
                  alt=""
                  className="mb-2 max-h-56 w-full rounded-xl object-contain"
                  style={{ background: '#0c0c0f' }}
                />
              )}
              <pre className="whitespace-pre-wrap break-words text-[12.5px] leading-relaxed text-fg">
                {[content.brand, content.model, content.description, content.content, content.caption, content.pseudo, content.ville, content.dream_car]
                  .filter((x) => typeof x === 'string' && x)
                  .join('\n')}
              </pre>
            </>
          ) : (
            <p className="text-[13px] text-fg2">{t('moderation.contentGone')}</p>
          )}
        </Section>

        <Section title={t('moderation.author')}>
          <p className="text-[13px] text-fg">
            {(owner?.pseudo as string) ?? '—'}
            {owner?.ville ? ` · ${owner.ville}` : ''}
          </p>
        </Section>

        <Section title={t('moderation.reportsTitle', { count: reports.length })}>
          {reports.map((r, i) => (
            <p key={i} className="text-[12.5px] text-fg2">
              · {t(`report.reason.${r.reason}`)}
              {r.note ? ` — « ${r.note} »` : ''}
            </p>
          ))}
        </Section>

        {typeof c.bot_verdict === 'string' && (
          <Section title={t('moderation.botTitle')}>
            <p className="text-[12.5px] italic text-fg2">{c.bot_verdict as string}</p>
            <p className="mt-1 text-[11.5px] text-fg2">
              {c.bot_source === 'ai' ? t('moderation.botAi') : t('moderation.botRules')}
              {c.status === 'needs_review' ? ` · ${t('moderation.botUnsure')}` : ''}
            </p>
          </Section>
        )}

        {sanctions.length > 0 && (
          <Section title={t('moderation.priorSanctions')}>
            {sanctions.map((s, i) => (
              <p key={i} className="text-[12.5px] text-fg2">
                · {t(`moderation.sanction.${s.kind}`)} — {s.reason}
                {s.lifted ? ` (${t('moderation.lifted')})` : ''}
              </p>
            ))}
          </Section>
        )}

        {history.length > 0 && (
          <Section title={t('moderation.priorActions')}>
            {history.slice(0, 8).map((h, i) => (
              <p key={i} className="text-[12.5px] text-fg2">
                · {t(`moderation.action.${h.action}`)} (
                {h.origin === 'auto' ? t('moderation.auto') : t('moderation.human')})
              </p>
            ))}
          </Section>
        )}

        <div className="pt-3">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 300))}
            placeholder={t('moderation.reasonPlaceholder')}
            aria-label={t('moderation.reasonPlaceholder')}
            rows={2}
            className="w-full resize-none rounded-xl px-4 py-3 text-fg outline-none placeholder:text-fg2"
            style={{
              fontSize: '16px',
              background: 'rgb(var(--color-fg) / 0.06)',
              border: '1px solid var(--color-border)',
            }}
          />
          <div className="mt-3 grid grid-cols-2 gap-2">
            {/* `ban` est refusé à un modérateur par la base elle-même
                (migration 0120) ; on ne lui montre pas un bouton qui
                échouerait. La suppression de compte n'est pas proposée ici du
                tout — voir la note en fin de fichier. */}
            {ACTIONS.filter((a) => isAdmin || a.key !== 'ban').map(
              (a) => (
                <button
                  key={a.key}
                  onClick={() => onAct(c.id as string, a.key, a.confirm)}
                  disabled={busy}
                  className="tappable rounded-xl py-3 text-[13px] font-bold disabled:opacity-50"
                  style={
                    a.danger
                      ? { background: 'rgba(232,32,58,0.15)', color: 'var(--revs-red)', border: '1px solid rgba(232,32,58,0.4)' }
                      : { background: 'rgb(var(--color-fg) / 0.07)', color: 'rgb(var(--color-fg))' }
                  }
                >
                  {t(`moderation.action.${a.key}`)}
                </button>
              ),
            )}
          </div>
          {/* Demander le contexte AVANT de trancher. Un cas ambigu se règle
              plus souvent par une question que par une sanction. */}
          <button
            onClick={() => onAsk(c.id as string)}
            disabled={busy}
            className="tappable mt-2 w-full rounded-xl py-3 text-[13px] font-bold text-fg disabled:opacity-50"
            style={{ background: 'rgb(var(--color-fg) / 0.07)' }}
          >
            {t('moderation.action.ask')}
          </button>
          <button
            onClick={onClose}
            className="tappable mt-3 w-full rounded-full py-3 text-[14px] font-semibold text-fg2"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Un chiffre et son libellé. Un indicateur, pas un tableau de bord. */
function Stat({ n, label, accent }: { n: number; label: string; accent?: boolean }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span
        className="text-[15px] font-extrabold tabular-nums"
        style={{ color: accent && n > 0 ? 'var(--revs-red)' : undefined }}
      >
        {n}
      </span>
      <span className="text-[11.5px] text-fg2">{label}</span>
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
      <p className="pb-1.5 text-[11px] font-extrabold uppercase tracking-wider text-fg2">
        {title}
      </p>
      {children}
    </div>
  )
}

// ── POURQUOI « SUPPRIMER LE COMPTE » N'EST PAS DANS CETTE LISTE ──
// `moderation_act` connaît l'action `delete_account` et la réserve à
// l'administration, mais aucun bouton ne la déclenche. Supprimer un compte
// efface ses spots, ses commentaires, ses stories, son XP et ses badges, de
// façon irréversible et sans export préalable. Tant que REVS n'offre pas à
// l'administration un moyen de prévenir la personne et de conserver une
// trace de ce qui a été effacé, le bannissement — qui bloque l'accès sans
// rien détruire — fait le travail sans le risque. Le jour où ce moyen
// existera, le bouton se branchera sur une action qui est déjà là.
