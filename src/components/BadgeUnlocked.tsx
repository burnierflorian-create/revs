import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { supabase } from '../lib/supabase'
import { emitUnreadChanged } from '../lib/notifications'
import { prefersReducedMotion } from '../lib/motion'

const CHANNEL = 'revs:badge-unlocked'

type BadgeNote = { emoji: string; name: string }

/** Queue a "badge unlocked" notification. Multiple calls stack and play
 *  one after the other. No-op under reduced motion (handled in the host). */
export function notifyBadgeUnlocked(badge: BadgeNote) {
  window.dispatchEvent(new CustomEvent<BadgeNote>(CHANNEL, { detail: badge }))
}

type WatchedBadge = { slug: string; emoji: string; name: string }

/** Render-as-child watcher (returns null). Compares the current unlocked
 *  set against a localStorage baseline and fires a notification for any
 *  genuinely new badge. Lives in its OWN component so its hooks are never
 *  conditional on the parent's loading/early-return state. Mount it only
 *  once the parent's badge data is ready. */
export function BadgeUnlockWatcher({ badges }: { badges: WatchedBadge[] }) {
  const key = badges
    .map((b) => b.slug)
    .sort()
    .join(',')
  useEffect(() => {
    let baseline = false
    let stored = new Set<string>()
    try {
      const raw = localStorage.getItem('revs_seen_badges')
      if (raw) {
        stored = new Set(JSON.parse(raw) as string[])
        baseline = true
      }
    } catch {
      /* storage unavailable */
    }
    const current = badges.map((b) => b.slug)
    if (baseline) {
      // ── L'ÉVÉNEMENT EST RÉCLAMÉ AU SERVEUR (30/09/2026) ──
      //
      // Avant, `localStorage` décidait seul : le même badge rejouait donc son
      // animation sur chaque appareil, et aucune notification n'était créée —
      // l'information disparaissait avec l'animation.
      //
      // `claim_badge_unlock` insère la notification et ne renvoie `true` qu'à
      // l'appelant qui l'a réellement créée (index unique sur
      // `user_id, dedupe_key`). L'animation ne se joue que dans ce cas : un
      // seul appareil l'obtient, et un rechargement ne la rejoue jamais.
      for (const b of badges) {
        if (stored.has(b.slug)) continue
        void supabase
          .rpc('claim_badge_unlock', {
            p_slug: b.slug,
            p_title: i18n.t('notif.badgeUnlocked'),
            p_body: b.name,
          })
          .then(({ data, error }) => {
            if (error) {
              // Le serveur est injoignable : on anime quand même, plutôt que
              // de priver quelqu'un de son déblocage pour une coupure réseau.
              // Le garde `localStorage` empêche le rejeu local.
              console.error('[badge] réclamation échouée:', error.message)
              notifyBadgeUnlocked({ emoji: b.emoji, name: b.name })
              return
            }
            if (data === true) {
              notifyBadgeUnlocked({ emoji: b.emoji, name: b.name })
              emitUnreadChanged()
            }
          })
      }
    }
    try {
      localStorage.setItem('revs_seen_badges', JSON.stringify(current))
    } catch {
      /* storage unavailable */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return null
}

/**
 * Hôte global (MainLayout). Une carte à la fois, la file se vide toute seule.
 *
 * DURÉE — le brief impose 0,8 à 1,2 s maximum. La CSS joue 0,30 s d'arrivée,
 * 0,55 s de lecture et 0,25 s de sortie : 1,10 s. Le démontage est calé
 * 40 ms après la fin de la sortie, pour ne pas couper l'image de fin.
 *
 * NON BLOQUANT — la carte porte `pointer-events: none` (design-system.css).
 * Elle flotte au-dessus de la barre de navigation ; si elle interceptait un
 * tap, elle interromprait exactement l'usage qu'elle récompense.
 *
 * FILE D'ATTENTE — cinq badges d'un coup donnent cinq cartes successives,
 * pas cinq cartes empilées. À 1,1 s pièce c'est 5,5 s au total, ce qui reste
 * regardable ; l'alternative « 3 nouveaux badges » évoquée par le brief
 * masquerait le nom de chacun, qui est précisément ce qu'on vient de gagner.
 */
const HOLD_MS = 1140
const HOLD_MS_REDUCED = 1700

export default function BadgeUnlocked() {
  const { t } = useTranslation()
  const [queue, setQueue] = useState<BadgeNote[]>([])

  useEffect(() => {
    const handler = (e: Event) => {
      setQueue((q) => [...q, (e as CustomEvent<BadgeNote>).detail])
    }
    window.addEventListener(CHANNEL, handler)
    return () => window.removeEventListener(CHANNEL, handler)
  }, [])

  const current = queue[0]

  useEffect(() => {
    if (!current) return
    // Sans mouvement, la carte est posée d'un coup : il faut un peu plus de
    // temps pour la lire, puisqu'aucune entrée ne la fait remarquer.
    const hold = prefersReducedMotion() ? HOLD_MS_REDUCED : HOLD_MS
    const timer = window.setTimeout(() => setQueue((q) => q.slice(1)), hold)
    return () => window.clearTimeout(timer)
    // Se réarme à chaque badge visible.
  }, [current?.name])

  if (!current) return null
  return (
    <div className="badge-unlocked" key={current.name} role="status" aria-live="polite">
      <span className="badge-unlocked-emoji" aria-hidden>
        {current.emoji}
      </span>
      <div className="badge-unlocked-text">
        <p
          style={{
            fontSize: 10,
            color: '#E8203A',
            fontWeight: 800,
            letterSpacing: '0.16em',
          }}
        >
          {t('notif.badgeEyebrow').toUpperCase()}
        </p>
        <p
          className="truncate"
          style={{ fontSize: 15.5, color: '#fff', fontWeight: 800, marginTop: 2 }}
        >
          {current.name}
        </p>
      </div>
    </div>
  )
}
