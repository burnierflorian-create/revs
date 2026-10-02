// ═══════ PANNEAU DES MEMBRES — QUI EST LÀ, ET QUI NE L'EST PAS ═══════
//
// L'accueil affichait « X en ligne » sans rien derrière : un nombre qu'on ne
// peut ni vérifier ni explorer. Ce panneau lui donne sa contrepartie — la
// population que ce nombre découpe.
//
// ── POURQUOI DEUX ONGLETS ET PAS UNE SEULE LISTE ──
// « En ligne » est une information périssable : dans cinq minutes elle sera
// fausse. « Membre » ne l'est pas. Les mélanger dans une liste unique
// obligerait à relire chaque pastille pour savoir qui est joignable
// maintenant. Séparés, les deux chiffres se lisent d'un coup — et leur somme
// est le total, par construction.
//
// ── SOURCE UNIQUE ──
// `members_list()` (migration 0110) renvoie TOUT LE MONDE avec un drapeau
// `online`, et `members_counts()` les compteurs. Les deux lisent la même
// colonne avec le même seuil de 5 minutes que le compteur de l'accueil. Le
// nombre annoncé et la liste affichée ne peuvent donc pas diverger — c'est
// précisément le défaut que ce panneau devait éviter.
//
// ── VIE PRIVÉE ──
// Aucun e-mail, aucun horodatage. La dernière activité arrive en MINUTES
// écoulées : « il y a 2 h » se compose ici sans jamais recevoir une date. Un
// compteur dit « untel est passé récemment » ; un horodatage dirait exactement
// quand, tous les jours, pour tout le monde.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { MapPin, Search, X } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Member = {
  user_id: string
  pseudo: string | null
  avatar: string | null
  ville: string | null
  role: string | null
  online: boolean
  minutes_ago: number | null
}
type Counts = { online_now: number; total: number }

/** « il y a 2 h » à partir de minutes, sans jamais manipuler de date.
 *  Renvoie la clé et ses variables plutôt qu'un texte : typer `t` en
 *  paramètre oblige à réécrire la signature de i18next, qui change entre
 *  versions. La traduction se fait au point d'affichage. */
function sinceKey(min: number | null): { key: string; n?: number } {
  if (min == null) return { key: 'members.never' }
  if (min < 60) return { key: 'members.agoMin', n: Math.max(1, Math.round(min)) }
  if (min < 60 * 24) return { key: 'members.agoHour', n: Math.round(min / 60) }
  return { key: 'members.agoDay', n: Math.round(min / 1440) }
}

export default function MembersSheet({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [tab, setTab] = useState<'online' | 'offline'>('online')
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!open) return
    let active = true
    const load = async () => {
      // Son propre battement d'abord : sans lui, celui qui ouvre le panneau
      // peut ne pas s'y voir pendant une minute, et le compteur paraît faux.
      await supabase.rpc('bump_last_seen')
      const [l, c] = await Promise.all([
        supabase.rpc('members_list'),
        supabase.rpc('members_counts').maybeSingle(),
      ])
      if (!active) return
      setMembers((l.data ?? []) as Member[])
      setCounts((c.data as Counts) ?? null)
    }
    void load()
    // Même rythme que le battement de présence : plus souvent ne montrerait
    // rien de nouveau, `last_seen` n'étant écrit que toutes les 60 s.
    const timer = setInterval(load, 60_000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [open])

  const online = useMemo(() => (members ?? []).filter((m) => m.online), [members])
  const offline = useMemo(() => (members ?? []).filter((m) => !m.online), [members])
  const shown = useMemo(() => {
    const base = tab === 'online' ? online : offline
    const needle = q.trim().toLowerCase()
    if (!needle) return base
    return base.filter(
      (m) =>
        (m.pseudo ?? '').toLowerCase().includes(needle) ||
        (m.ville ?? '').toLowerCase().includes(needle),
    )
  }, [tab, q, online, offline])

  if (!open) return null

  const total = counts?.total ?? members?.length ?? 0

  // ── RENDU EN PORTAIL ──
  // Posée dans l'arbre de l'accueil, la feuille passait SOUS le bouton
  // « SPOTTER » et sous la rangée de statistiques, qui portent leur propre
  // empilement. Un z-index plus élevé n'y suffit pas — un contexte
  // d'empilement parent enferme l'enfant quoi qu'il arrive. Montée sur
  // document.body, elle n'a plus de parent qui puisse la recouvrir.
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
      data-swipe-x=""
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet-rise flex w-full flex-col rounded-t-3xl"
        style={{
          background: 'rgb(var(--color-card))',
          borderTop: '1px solid var(--color-border)',
          maxHeight: '86vh',
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex flex-none items-center justify-between px-5 pb-1 pt-4">
          <h2 className="text-[17px] font-bold text-fg">{t('members.title')}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="tappable flex h-8 w-8 items-center justify-center rounded-full text-fg2"
            style={{ background: 'rgb(var(--color-fg) / 0.07)' }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Onglets — le compte vit DANS l'onglet, pas à côté : c'est ce qu'on
            vient y chercher. */}
        <div className="flex flex-none gap-2 px-5 pb-3 pt-2">
          <Tab
            on={tab === 'online'}
            dot="#22C55E"
            n={online.length}
            label={t('members.online')}
            onClick={() => setTab('online')}
          />
          <Tab
            on={tab === 'offline'}
            dot="rgb(var(--color-fg) / 0.3)"
            n={offline.length}
            label={t('members.offline')}
            onClick={() => setTab('offline')}
          />
        </div>

        {/* Recherche — n'apparaît qu'au-delà de six membres : sous ce seuil
            elle coûte une ligne d'écran pour rien. */}
        {(members?.length ?? 0) > 6 && (
          <div className="flex-none px-5 pb-2">
            <div
              className="flex items-center gap-2 rounded-full px-3.5 py-2.5"
              style={{ background: 'rgb(var(--color-fg) / 0.05)' }}
            >
              <Search className="h-4 w-4 flex-none text-fg2" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('members.search')}
                aria-label={t('members.search')}
                style={{ fontSize: '16px' }}
                className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg2"
              />
              {q && (
                <button
                  onClick={() => setQ('')}
                  aria-label={t('feedpage.clear')}
                  className="tappable flex-none text-fg2"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          {members === null ? (
            <p className="px-2 py-8 text-center text-[13px] text-fg2">{t('common.loading')}</p>
          ) : shown.length === 0 ? (
            <p className="px-2 py-8 text-center text-[13px] text-fg2">
              {q.trim()
                ? t('members.noMatch')
                : tab === 'online'
                  ? t('members.nobody')
                  : t('members.nobodyOffline')}
            </p>
          ) : (
            shown.map((m) => (
              <button
                key={m.user_id}
                onClick={() => {
                  onClose()
                  navigate(`/u/${m.user_id}`)
                }}
                aria-label={t('members.openProfile', { pseudo: m.pseudo ?? '' })}
                className="tappable flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left"
              >
                <span className="relative flex-none">
                  <span
                    className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-fg/10 text-[15px] font-extrabold text-fg"
                    style={{ opacity: m.online ? 1 : 0.65 }}
                  >
                    {m.avatar ? (
                      <img
                        src={m.avatar}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-full w-full object-cover"
                        style={{ objectPosition: 'top' }}
                      />
                    ) : (
                      (m.pseudo ?? '?').charAt(0).toUpperCase()
                    )}
                  </span>
                  {/* Vert et non rouge : un point rouge sur un avatar se lit
                      comme une alerte, jamais comme une présence. */}
                  {m.online && (
                    <span
                      aria-hidden
                      className="absolute bottom-0 right-0 h-3 w-3 rounded-full"
                      style={{ background: '#22C55E', border: '2px solid rgb(var(--color-card))' }}
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-fg">
                    {m.pseudo ?? t('members.anonymous')}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1 text-[12.5px] text-fg2">
                    {m.ville && (
                      <>
                        <MapPin className="h-3 w-3 flex-none" />
                        <span className="truncate">{m.ville}</span>
                        <span aria-hidden>·</span>
                      </>
                    )}
                    <span className="flex-none">
                      {m.online
                        ? t('members.onlineNow')
                        : (() => {
                            const k = sinceKey(m.minutes_ago)
                            return t(k.key, { n: k.n })
                          })()}
                    </span>
                  </span>
                </span>
              </button>
            ))
          )}
        </div>

        <p className="flex-none px-5 pt-2 text-center text-[12.5px] text-fg2">
          {t('members.total', { count: total })}
        </p>
      </div>
    </div>,
    document.body,
  )
}

function Tab({
  on,
  dot,
  n,
  label,
  onClick,
}: {
  on: boolean
  dot: string
  n: number
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className="tappable flex flex-1 items-center gap-2 rounded-xl px-3 py-2.5 transition-colors"
      style={{
        background: on ? 'rgb(var(--color-accent) / 0.14)' : 'rgb(var(--color-fg) / 0.05)',
        border: on ? '1px solid rgb(var(--color-accent) / 0.5)' : '1px solid transparent',
      }}
    >
      <span aria-hidden className="h-2 w-2 flex-none rounded-full" style={{ background: dot }} />
      <span className="text-[15px] font-bold tabular-nums text-fg">{n}</span>
      <span className="truncate text-[12.5px] text-fg2">{label}</span>
    </button>
  )
}
