// ═══════════════ ÉCRAN NOTIFICATIONS ═══════════════
//
// Deux onglets, deux natures :
//   · ACTIVITÉ   — ce qui vous est arrivé (like, badge, suivi…)
//   · NOUVEAUTÉS — ce que REVS a publié pour tout le monde
//
// La distinction compte : l'activité est personnelle et éphémère, le changelog
// est commun et durable. Les mêler produirait un fil où « Lucas a aimé votre
// spot » et « Nouveau Garage » se disputent la même place.
//
// Aucune donnée fabriquée : ce qui s'affiche vient de la base. Un fil vide
// affiche un état vide honnête plutôt que des exemples décoratifs.

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  BellOff,
  Check,
  Heart,
  MessageCircle,
  Megaphone,
  Sparkles,
  Target,
  Trophy,
  UserPlus,
} from 'lucide-react'
import {
  fetchNotifications,
  fetchProductUpdates,
  markAllRead,
  markRead,
  markUpdateRead,
  emitUnreadChanged,
  type Notification,
  type ProductUpdate,
} from '../lib/notifications'

/** Icône par type. Un type inconnu retombe sur le mégaphone plutôt que de
 *  casser le rendu — le catalogue de types est volontairement ouvert. */
const ICONS: Record<string, typeof Heart> = {
  like: Heart,
  comment: MessageCircle,
  follow: UserPlus,
  mention: Megaphone,
  badge_unlock: Trophy,
  challenge: Target,
  event: Sparkles,
  system: Megaphone,
  product_update: Sparkles,
}

/** « il y a 2 min », sans dépendance de formatage de dates. */
function ago(iso: string, en: boolean): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return en ? 'now' : "à l'instant"
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24)
  return en ? `${d}d` : `${d} j`
}

export default function NotificationsPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const en = (i18n.resolvedLanguage ?? 'fr').startsWith('en')

  // `?tab=updates` : c'est par là qu'arrive « Paramètres → À propos de REVS ».
  const [params] = useSearchParams()
  const [tab, setTab] = useState<'activity' | 'updates'>(
    params.get('tab') === 'updates' ? 'updates' : 'activity',
  )
  const [items, setItems] = useState<Notification[]>([])
  const [updates, setUpdates] = useState<ProductUpdate[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [n, u] = await Promise.all([fetchNotifications(), fetchProductUpdates()])
    setItems(n)
    setUpdates(u)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function onMarkAll() {
    await markAllRead()
    setItems((prev) =>
      prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })),
    )
    setUpdates((prev) => prev.map((u) => ({ ...u, unread: false })))
    emitUnreadChanged()
  }

  async function onOpenNotification(n: Notification) {
    if (!n.read_at) {
      await markRead(n.id)
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
      )
      emitUnreadChanged()
    }
    // Pas de destination → la notification est informative, on ne navigue pas
    // vers une page au hasard.
    if (n.link) navigate(n.link)
  }

  async function onOpenUpdate(u: ProductUpdate) {
    setOpen(open === u.id ? null : u.id)
    if (u.unread) {
      await markUpdateRead(u.id)
      setUpdates((prev) => prev.map((x) => (x.id === u.id ? { ...x, unread: false } : x)))
      emitUnreadChanged()
    }
  }

  const hasUnread =
    items.some((n) => !n.read_at) || updates.some((u) => u.unread)

  return (
    // `pb-32` : la barre de navigation flotte au-dessus du contenu (z-40). Avec
    // une marge plus courte, la dernière nouveauté passait dessous et son texte
    // devenait illisible — constaté en production le 30/09.
    <div className="px-4 pb-32 pt-[calc(max(0.75rem,env(safe-area-inset-top))+4px)]">
      {/* ── En-tête ── */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => navigate(-1)}
          aria-label={t('gamif.back')}
          className="tappable -ml-2 flex h-11 w-11 flex-none items-center justify-center rounded-full text-fg2"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="min-w-0 flex-1 truncate font-display text-[23px] font-black tracking-tight">
          {t('notif.title')}
        </h1>
        <button
          onClick={onMarkAll}
          disabled={!hasUnread}
          className="tappable flex-none whitespace-nowrap rounded-full px-3 py-2 text-[11.5px] font-semibold text-fg2 disabled:opacity-35"
          style={{ border: '1px solid var(--color-border)' }}
        >
          {t('notif.markAll')}
        </button>
      </div>

      {/* ── Onglets ── */}
      <div
        role="tablist"
        className="relative mt-4 flex rounded-full p-1"
        style={{ background: 'var(--color-glass-mid)', border: '1px solid var(--color-border)' }}
      >
        <span
          aria-hidden
          className="absolute bottom-1 top-1 rounded-full"
          style={{
            width: 'calc((100% - 0.5rem) / 2)',
            left: `calc(0.25rem + ${tab === 'updates' ? 1 : 0} * ((100% - 0.5rem) / 2))`,
            background: 'rgb(var(--color-accent))',
            transition: 'left 260ms cubic-bezier(0.22,1,0.36,1)',
          }}
        />
        {(['activity', 'updates'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className="tappable relative z-10 min-w-0 flex-1 truncate rounded-full py-[7px] text-[12.5px] font-bold"
            style={{ color: tab === k ? '#fff' : 'rgb(var(--color-fg-2))' }}
          >
            {t(k === 'activity' ? 'notif.tabActivity' : 'notif.tabUpdates')}
          </button>
        ))}
      </div>

      {/* ── ACTIVITÉ ── */}
      {tab === 'activity' && (
        <div className="mt-4">
          {loading ? null : items.length === 0 ? (
            <Empty
              title={t('notif.emptyTitle')}
              body={t('notif.emptyBody')}
            />
          ) : (
            <ul className="space-y-1.5">
              {items.map((n) => {
                const Icon = ICONS[n.type] ?? Megaphone
                return (
                  <li key={n.id}>
                    <button
                      onClick={() => void onOpenNotification(n)}
                      className="tappable flex w-full items-start gap-3 rounded-2xl px-3 py-3 text-left transition-transform active:scale-[0.99]"
                      style={{
                        // Le non-lu se signale par un fond légèrement plus
                        // clair et un filet rouge, pas par une pastille de
                        // plus : le fil reste calme.
                        background: n.read_at ? 'transparent' : 'var(--color-glass-mid)',
                        border: `1px solid ${n.read_at ? 'transparent' : 'rgba(232,32,58,0.22)'}`,
                      }}
                    >
                      <span
                        className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full"
                        style={{
                          background: 'rgba(232,32,58,0.12)',
                          border: '1px solid rgba(232,32,58,0.28)',
                        }}
                      >
                        <Icon className="h-4 w-4" style={{ color: '#E8203A' }} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-bold text-fg">
                          {n.title}
                        </span>
                        {n.body && (
                          <span className="mt-0.5 block truncate text-[12.5px] text-fg2">
                            {n.body}
                          </span>
                        )}
                        <span className="mt-1 block text-[11px] text-fg/35">
                          {ago(n.created_at, en)}
                        </span>
                      </span>
                      {n.image_url && (
                        <img
                          src={n.image_url}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-11 w-11 flex-none rounded-lg object-cover"
                        />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── NOUVEAUTÉS ── */}
      {tab === 'updates' && (
        <div className="mt-4 space-y-2.5">
          {loading ? null : updates.length === 0 ? (
            <Empty title={t('notif.emptyUpdates')} />
          ) : (
            updates.map((u) => (
              <button
                key={u.id}
                onClick={() => void onOpenUpdate(u)}
                className="tappable block w-full rounded-2xl px-4 py-4 text-left"
                style={{
                  background: 'var(--color-glass-mid)',
                  border: `1px solid ${u.unread ? 'rgba(232,32,58,0.3)' : 'var(--color-border)'}`,
                }}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {u.unread && (
                      <span
                        className="mb-1.5 inline-block rounded-full px-2 py-0.5 text-[9px] font-extrabold tracking-[0.12em] text-white"
                        style={{ background: 'rgb(var(--color-accent))' }}
                      >
                        {t('notif.new')}
                      </span>
                    )}
                    <h2 className="font-display text-[16px] font-black tracking-tight text-fg">
                      {u.title}
                    </h2>
                    <p className="mt-0.5 text-[11px] font-semibold text-fg/35">
                      {new Date(u.published_at).toLocaleDateString(en ? 'en-GB' : 'fr-FR', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </p>
                    <p className="mt-2 text-[13px] leading-snug text-fg2">{u.body}</p>
                  </div>
                </div>

                {/* Les points de détail ne se déplient qu'à la demande : cinq
                    nouveautés dépliées d'un coup feraient un mur. */}
                {open === u.id && u.points.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {u.points.map((p, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check
                          className="mt-[3px] h-3.5 w-3.5 flex-none"
                          style={{ color: '#E8203A' }}
                        />
                        <span className="text-[12.5px] leading-snug text-fg/85">{p}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div
      className="flex flex-col items-center rounded-2xl px-6 py-12 text-center"
      style={{ background: 'var(--color-glass-mid)', border: '1px solid var(--color-border)' }}
    >
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full"
        style={{ background: 'rgba(232,32,58,0.10)', border: '1px solid rgba(232,32,58,0.24)' }}
      >
        <BellOff className="h-6 w-6" style={{ color: 'rgba(232,32,58,0.75)' }} />
      </span>
      <p className="mt-4 font-display text-[15px] font-black tracking-tight text-fg">{title}</p>
      {body && <p className="mt-1.5 max-w-[17rem] text-[12.5px] leading-snug text-fg2">{body}</p>}
    </div>
  )
}
