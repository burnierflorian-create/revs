// ═══════════════ RETOUR PAR GLISSEMENT ═══════════════
//
// Le geste : le doigt se pose sur une page secondaire et part VERS LA GAUCHE.
// La page suit le doigt, puis s'en va — ou revient en place si le geste est
// trop court.
//
// ── CE QUI N'EXISTAIT PAS, ET CE QUI N'EXISTAIT PAS NON PLUS ──
// Audit du 30/09/2026 : REVS n'avait AUCUN retour par glissement. Il n'avait
// pas non plus de changement d'onglet par glissement — `TabsContainer` ne
// porte aucun gestionnaire de toucher, les onglets ne bougent que par le
// routeur, et l'animation horizontale qu'on y voit est une entrée jouée une
// fois, pas un suivi du doigt. Il n'y avait donc rien à supprimer de ce
// côté-là ; seulement ceci à construire.
//
// ── LE CONFLIT AVEC LES CARROUSELS ──
// Un glissement horizontal dans le showroom, le rail des marques ou le
// carrousel de course doit faire défiler CE composant, pas quitter la page.
// La règle est déterminée à la pose du doigt, une fois pour toutes :
//   · la cible est-elle dans un élément marqué `data-swipe-x` ? → au composant
//   · la cible est-elle dans un conteneur qui défile horizontalement ?
//     (scrollWidth > clientWidth et overflow-x scrollable) → au composant
//   · sinon → le geste appartient à la navigation
// Aucune heuristique a posteriori : un geste qui commence dans un carrousel
// y reste, même s'il en sort.
//
// ── LE SCROLL VERTICAL RESTE INTACT ──
// L'axe n'est arbitré qu'au premier mouvement réel, et il faut que
// l'horizontale DOMINE nettement (facteur 1.4) au-delà de 12 px. En deçà, le
// geste est rendu au défilement vertical et ne pourra plus être repris.

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { prefersReducedMotion } from '../lib/motion'

/** Part du trajet à parcourir pour valider le retour. */
const DISTANCE_RATIO = 0.28
/** Ou, plus court mais vif : px/ms au relâchement. */
const VELOCITY = 0.45
/** En deçà, on ne tranche pas encore l'axe. */
const AXIS_THRESHOLD = 12
/** L'horizontale doit l'emporter franchement sur la verticale. */
const AXIS_DOMINANCE = 1.4

/** L'élément défile-t-il horizontalement ? */
function scrollsHorizontally(el: Element): boolean {
  if (el.scrollWidth <= el.clientWidth + 2) return false
  const ox = getComputedStyle(el).overflowX
  return ox === 'auto' || ox === 'scroll'
}

/** Le geste appartient-il à un composant plutôt qu'à la navigation ? */
function belongsToComponent(target: EventTarget | null, root: HTMLElement) {
  let el = target instanceof Element ? target : null
  while (el && el !== root) {
    if (el.hasAttribute('data-swipe-x')) return true
    if (scrollsHorizontally(el)) return true
    el = el.parentElement
  }
  return false
}

/**
 * Branche le retour par glissement sur un conteneur de page secondaire.
 *
 * @param ref      le conteneur défilant de la pile (`.stack-overlay`)
 * @param pageRef  la page à déplacer sous le doigt (`.stack-page`)
 * @param enabled  faux sur les onglets : seules les pages secondaires reviennent
 */
export function useSwipeBack(
  ref: React.RefObject<HTMLElement | null>,
  pageRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  const navigate = useNavigate()

  useEffect(() => {
    const root = ref.current
    if (!root || !enabled) return

    let startX = 0
    let startY = 0
    let startT = 0
    // null = axe non tranché ; false = rendu au défilement ; true = on pilote
    let owns: boolean | null = null
    let dx = 0

    const page = () => pageRef.current

    const paint = (x: number) => {
      const el = page()
      if (!el) return
      el.style.transition = 'none'
      el.style.transform = `translate3d(${x}px,0,0)`
      // L'ombre portée à gauche donne l'épaisseur : on voit que la page
      // GLISSE au-dessus de celle qui attend dessous.
      el.style.boxShadow = x < 0 ? '12px 0 34px rgba(0,0,0,0.45)' : 'none'
    }

    const release = (go: boolean) => {
      const el = page()
      if (el) {
        el.style.transition =
          'transform 260ms cubic-bezier(0.22,1,0.36,1), opacity 260ms ease'
        el.style.transform = go
          ? `translate3d(-${window.innerWidth}px,0,0)`
          : 'translate3d(0,0,0)'
        if (!go) el.style.boxShadow = 'none'
      }
      if (go) {
        // On laisse la page sortir du champ avant de changer de route :
        // naviguer tout de suite ferait disparaître le mouvement en cours.
        window.setTimeout(back, 180)
      } else if (el) {
        window.setTimeout(() => {
          el.style.transition = ''
          el.style.transform = ''
        }, 280)
      }
    }

    /**
     * Retour réel. `history.state.idx` est tenu à jour par React Router : à 0,
     * il n'y a pas de page précédente DANS l'application — reculer ferait
     * sortir de REVS. On rejoint alors l'accueil plutôt que de laisser
     * l'utilisateur dehors.
     */
    const back = () => {
      const idx = (window.history.state as { idx?: number } | null)?.idx
      if (typeof idx === 'number' && idx <= 0) navigate('/', { replace: true })
      else navigate(-1)
    }

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      owns = belongsToComponent(e.target, root) ? false : null
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      startT = e.timeStamp
      dx = 0
    }

    const onMove = (e: TouchEvent) => {
      if (owns === false || e.touches.length !== 1) return
      const t = e.touches[0]
      const ddx = t.clientX - startX
      const ddy = t.clientY - startY

      if (owns === null) {
        if (Math.abs(ddx) < AXIS_THRESHOLD && Math.abs(ddy) < AXIS_THRESHOLD) return
        // Vers la GAUCHE uniquement : un glissement vers la droite ne veut rien
        // dire ici et doit rendre la main au défilement.
        owns =
          ddx < 0 && Math.abs(ddx) > Math.abs(ddy) * AXIS_DOMINANCE
        if (!owns) return
      }

      dx = Math.min(0, ddx)
      // Le défilement vertical doit s'arrêter pendant qu'on pilote, sinon la
      // page part en diagonale.
      if (e.cancelable) e.preventDefault()
      if (!prefersReducedMotion()) paint(dx)
    }

    const onEnd = (e: TouchEvent) => {
      if (owns !== true) {
        owns = null
        return
      }
      owns = null
      const dist = Math.abs(dx)
      const speed = dist / Math.max(1, e.timeStamp - startT)
      const go = dist > window.innerWidth * DISTANCE_RATIO || speed > VELOCITY
      if (prefersReducedMotion()) {
        if (go) back()
        return
      }
      release(go)
    }

    // `passive: false` sur touchmove : c'est la seule façon de pouvoir
    // suspendre le défilement pendant le geste.
    root.addEventListener('touchstart', onStart, { passive: true })
    root.addEventListener('touchmove', onMove, { passive: false })
    root.addEventListener('touchend', onEnd, { passive: true })
    root.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      root.removeEventListener('touchstart', onStart)
      root.removeEventListener('touchmove', onMove)
      root.removeEventListener('touchend', onEnd)
      root.removeEventListener('touchcancel', onEnd)
    }
  }, [ref, pageRef, enabled, navigate])
}
