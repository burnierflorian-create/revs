// ═══════ PANNEAU DES MEMBRES — QUI EST LÀ, MAINTENANT ═══════
//
// L'accueil affichait « X en ligne » sans rien derrière : un nombre qu'on ne
// peut ni vérifier ni explorer. Ce panneau lui donne sa contrepartie — la
// liste des personnes que ce nombre compte.
//
// ── CE QU'IL N'EST PAS ──
// Ce n'est pas une page : c'est une feuille, ouverte et refermée en un geste
// depuis le compteur lui-même. Ajouter un écran pour afficher trois lignes
// aurait alourdi la navigation pour une information qu'on consulte en passant.
//
// ── SOURCE UNIQUE ──
// `members_counts()` et `members_online()` (migration 0104) lisent la MÊME
// colonne avec le MÊME seuil que le compteur de l'accueil. Le nombre annoncé
// et la liste affichée ne peuvent donc pas diverger — c'est le défaut que
// cette fonctionnalité devait éviter avant tout.
//
// ── VIE PRIVÉE ──
// La RPC ne renvoie que l'identifiant, le pseudo et l'avatar. Pas d'e-mail,
// pas d'horodatage de dernière activité, pas de position. Un compteur dit
// « trois personnes sont là » ; une liste d'horodatages dirait quand chacun
// est passé pour la dernière fois, ce qui n'a aucune raison d'être exposé.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Member = { user_id: string; pseudo: string | null; avatar: string | null }
type Counts = { online_now: number; total: number }

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

  useEffect(() => {
    if (!open) return
    let active = true
    const load = async () => {
      // Son propre battement d'abord : sans lui, celui qui ouvre le panneau
      // peut ne pas s'y voir pendant une minute, et le compteur paraît faux.
      await supabase.rpc('bump_last_seen')
      const [l, c] = await Promise.all([
        supabase.rpc('members_online'),
        supabase.rpc('members_counts').maybeSingle(),
      ])
      if (!active) return
      setMembers((l.data ?? []) as Member[])
      setCounts((c.data as Counts) ?? null)
    }
    void load()
    // Rafraîchi au même rythme que le battement de présence : plus souvent ne
    // montrerait rien de nouveau, `last_seen` n'étant écrit que toutes les 60 s.
    const timer = setInterval(load, 60_000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [open])

  if (!open) return null

  const online = counts?.online_now ?? members?.length ?? 0
  const total = counts?.total ?? 0
  const offline = Math.max(0, total - online)

  // ── RENDU EN PORTAIL ──
  // Mesuré à l'écran : posée dans l'arbre de l'accueil, la feuille passait
  // SOUS le bouton « SPOTTER » et sous la rangée de statistiques, qui portent
  // leur propre empilement. Un z-index plus élevé n'y suffit pas — un contexte
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
        className="sheet-rise w-full rounded-t-3xl"
        style={{
          background: 'rgb(var(--color-card))',
          borderTop: '1px solid var(--color-border)',
          maxHeight: '80vh',
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex items-center justify-between px-5 pb-1 pt-4">
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

        {/* Compteurs — en ligne, hors ligne, total. */}
        <div className="flex gap-2 px-5 pb-3 pt-2">
          {/* Vert, et non le rouge REVS : la pastille de présence sur les
              avatars est verte, et deux couleurs pour la même notion dans le
              même panneau se lisent comme deux notions différentes. */}
          <Pill dot="#22C55E" n={online} label={t('members.online')} />
          <Pill dot="rgb(var(--color-fg) / 0.3)" n={offline} label={t('members.offline')} />
        </div>

        <div className="overflow-y-auto px-3" style={{ maxHeight: '48vh' }}>
          {members === null ? (
            <p className="px-2 py-8 text-center text-[13px] text-fg2">
              {t('common.loading')}
            </p>
          ) : members.length === 0 ? (
            <p className="px-2 py-8 text-center text-[13px] text-fg2">
              {t('members.nobody')}
            </p>
          ) : (
            members.map((m) => (
              <button
                key={m.user_id}
                onClick={() => {
                  onClose()
                  navigate(`/u/${m.user_id}`)
                }}
                className="tappable flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left"
              >
                <span className="relative flex-none">
                  <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-fg/10 text-[15px] font-extrabold text-fg">
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
                  {/* Pastille verte : le seul endroit où REVS n'utilise pas son
                      rouge — un point rouge sur un avatar se lit comme une
                      alerte, jamais comme une présence. */}
                  <span
                    aria-hidden
                    className="absolute bottom-0 right-0 h-3 w-3 rounded-full"
                    style={{ background: '#22C55E', border: '2px solid rgb(var(--color-card))' }}
                  />
                </span>
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-fg">
                  {m.pseudo ?? t('members.anonymous')}
                </span>
              </button>
            ))
          )}
        </div>

        <p className="px-5 pt-3 text-center text-[12.5px] text-fg2">
          {t('members.total', { count: total })}
        </p>
      </div>
    </div>,
    document.body,
  )
}

function Pill({ dot, n, label }: { dot: string; n: number; label: string }) {
  return (
    <span
      className="flex flex-1 items-center gap-2 rounded-xl px-3 py-2.5"
      style={{ background: 'rgb(var(--color-fg) / 0.05)' }}
    >
      <span aria-hidden className="h-2 w-2 flex-none rounded-full" style={{ background: dot }} />
      <span className="text-[15px] font-bold tabular-nums text-fg">{n}</span>
      <span className="truncate text-[12.5px] text-fg2">{label}</span>
    </span>
  )
}
