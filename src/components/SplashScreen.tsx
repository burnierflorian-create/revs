import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { MONOGRAM } from '../lib/brand-paths'
import { RevsTagline, RevsWordmark } from './Logo'
import { prefersReducedMotion } from '../lib/motion'
import '../styles/splash-animation.css'

// ═══════════════════════════════════════════════════════════════════════
//  Animation d'intro REVS
// ═══════════════════════════════════════════════════════════════════════
//
//  0,00 → 0,30  un feu arrière rouge apparaît au centre, au loin
//  0,30 → 1,00  il trace le monogramme d'un seul geste continu
//  1,00 → 1,30  un reflet métallique balaie le mark
//  1,30 → 1,60  REVS puis la tagline se posent dessous
//  1,60 → 1,80  palier stable
//  1,80 → 2,00  fondu, puis démontage
//
// Le découpage R / V ne vient pas d'ici : chaque pièce du monogramme porte
// son `group` dans src/lib/brand-paths.ts, généré par scripts/build-brand.mjs.
// La dalle rouge est rattachée au R — elle occupe la place de sa hampe.
//
// Ce composant est monté dans main.tsx À CÔTÉ de <App />, pas autour : React
// monte l'application en parallèle, derrière le calque. Rien n'est retardé
// par l'animation, et il n'y a pas d'écran blanc à la sortie.
//
// Remplace l'intro précédente (le mark arrivait par la gauche avec une
// traînée de flou, et REVS s'égrenait lettre par lettre en police système).

// Fenêtre de tracé : de 0,30 s (fin de l'étincelle) à 1,00 s.
const TRACE_START = 300
const TRACE_MS = 700

const FULL_MS = 2000
const BRIEF_MS = 500
const FADE_MS = 200

// Une intro de 2 s est agréable une fois par jour, pénible à chaque
// ouverture. Au-delà de 24 h on rejoue la version complète ; sinon on se
// contente d'un fondu de 0,5 s sur le monogramme déjà rempli.
const STORAGE_KEY = 'revs-last-splash-full'
const FULL_EVERY_MS = 24 * 60 * 60 * 1000

type Mode = 'full' | 'brief'

// LECTURE SEULE, et c'est important : cette fonction sert d'initialiseur de
// useState, donc elle s'exécute pendant le rendu. Y écrire dans localStorage
// la rendrait impure — sous StrictMode l'initialiseur est appelé deux fois,
// le premier appel poserait l'horodatage et le second lirait une date toute
// fraîche et renverrait 'brief' : l'animation complète ne serait jamais vue
// en développement. L'écriture se fait donc dans un effet, plus bas.
function readMode(): Mode {
  try {
    const last = Number(localStorage.getItem(STORAGE_KEY) ?? '0')
    if (!Number.isFinite(last) || Date.now() - last > FULL_EVERY_MS) return 'full'
  } catch {
    // Navigation privée, quota plein, stockage bloqué : version courte,
    // plutôt que de rejouer 2 s à chaque ouverture.
    return 'brief'
  }
  return 'brief'
}

export default function SplashScreen() {
  const reduced = prefersReducedMotion()
  const [mode] = useState<Mode>(readMode)
  const [phase, setPhase] = useState<'run' | 'out' | 'gone'>('run')
  const svgRef = useRef<SVGSVGElement | null>(null)

  const full = mode === 'full' && !reduced

  // Mesure des tracés, puis séquencement du geste.
  //
  // Les cinq pièces sont parcourues À LA SUITE, chacune pendant une durée
  // proportionnelle à sa longueur : la pointe avance donc à vitesse
  // constante d'un bout à l'autre du monogramme. C'est ce qui manquait à la
  // version précédente, où les trois pièces du R partaient toutes en même
  // temps et où le R et le V avaient chacun leur propre courbe ease-in-out —
  // d'où un arrêt net, visible, à la jonction.
  //
  // Tout est dérivé de getTotalLength() : si le monogramme est redessiné, le
  // séquencement se recalcule seul, sans constante à corriger.
  //
  // useLayoutEffect et non useEffect : les valeurs doivent être écrites AVANT
  // la première peinture, sinon les contours apparaissent entiers pendant une
  // frame avant de se rétracter.
  useLayoutEffect(() => {
    if (!full) return
    const svg = svgRef.current
    if (!svg) return

    const traces = [
      ...svg.querySelectorAll<SVGPathElement>('.revs-splash__trace'),
    ]
    if (!traces.length) return

    // getTotalLength additionne les sous-tracés d'un même path — la panse et
    // son contrepoinçon se dessinent donc à la suite, ce qui est le geste
    // voulu.
    const lens = traces.map((el) => el.getTotalLength())
    const total = lens.reduce((a, b) => a + b, 0)
    if (!total) return

    // Fin de tracé par groupe — purement local à la mesure.
    const fillEnd: Record<string, number> = {}
    let acc = 0
    traces.forEach((el, i) => {
      const start = TRACE_START + (TRACE_MS * acc) / total
      const dur = (TRACE_MS * lens[i]) / total
      el.style.setProperty('--len', String(lens[i]))
      el.style.setProperty('--delay', `${start.toFixed(1)}ms`)
      el.style.setProperty('--dur', `${dur.toFixed(1)}ms`)
      acc += lens[i]
      // Le remplissage d'un groupe démarre quand sa dernière pièce est
      // tracée. On le pose ici parce que c'est le seul endroit qui connaît
      // la répartition réelle des durées.
      const g = el.dataset.group
      if (g) fillEnd[g] = TRACE_START + (TRACE_MS * acc) / total
    })

    for (const [g, end] of Object.entries(fillEnd)) {
      const el = svg.querySelector<SVGGElement>(`.revs-splash__fill--${g}`)
      el?.style.setProperty('--delay', `${end.toFixed(1)}ms`)
    }
  }, [full])

  // Horodatage de la dernière intro complète — écrit ici, pas pendant le
  // rendu (voir readMode).
  useEffect(() => {
    if (mode !== 'full') return
    try {
      localStorage.setItem(STORAGE_KEY, String(Date.now()))
    } catch {
      /* stockage indisponible : on rejouera l'intro complète, sans plus */
    }
  }, [mode])

  useEffect(() => {
    const hold = full ? FULL_MS : BRIEF_MS
    const t1 = window.setTimeout(() => setPhase('out'), hold - FADE_MS)
    // Filet de sécurité : si onAnimationEnd ne remonte jamais (onglet passé
    // en arrière-plan pendant le fondu, par exemple), on démonte quand même.
    const t2 = window.setTimeout(() => setPhase('gone'), hold + 400)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [full])

  if (phase === 'gone') return null

  const rParts = MONOGRAM.parts.filter((p) => p.group === 'R')
  const vParts = MONOGRAM.parts.filter((p) => p.group === 'V')
  // Le geste parcourt le R puis le V, dans l'ordre de la charte.
  const traceParts = [...rParts, ...vParts]
  // Le rouge REVS est invariant ; les masses claires suivent le thème via
  // currentColor, pour que le monogramme reste lisible sur fond clair.
  const colorOf = (role: 'light' | 'accent') =>
    role === 'accent' ? 'var(--revs-red)' : 'currentColor'

  return (
    <div
      className={`revs-splash${full ? '' : ' revs-splash--brief'}${
        phase === 'out' ? ' revs-splash--out' : ''
      }`}
      aria-hidden
      onAnimationEnd={(e) => {
        // Seule la sortie démonte ; les keyframes internes remontent aussi
        // ici et ne doivent pas interrompre l'intro.
        if (e.animationName === 'revs-splash-out') setPhase('gone')
      }}
    >
      {full && <span className="revs-splash__spark" />}

      <div className="relative">
        <svg
          ref={svgRef}
          className="revs-splash__mark"
          viewBox={`0 0 ${MONOGRAM.w} ${MONOGRAM.h}`}
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Contours — le geste qui dessine. Rendus uniquement en version
              complète : en version courte il n'y a rien à tracer. */}
          {full && (
            <g className="revs-splash__traces">
              {traceParts.map((p, i) => (
                <path
                  key={`t-${i}`}
                  data-group={p.group}
                  className={`revs-splash__trace${
                    i === 0 ? ' revs-splash__trace--first' : ''
                  }${i === traceParts.length - 1 ? ' revs-splash__trace--last' : ''}`}
                  d={p.d}
                  stroke={colorOf(p.role)}
                />
              ))}
            </g>
          )}

          {/* Remplissages — le logo définitif, dans ses couleurs de charte. */}
          <g className="revs-splash__fill revs-splash__fill--r">
            {rParts.map((p, i) => (
              <path
                key={`f-r-${i}`}
                d={p.d}
                fillRule={p.rule}
                fill={colorOf(p.role)}
              />
            ))}
          </g>
          <g className="revs-splash__fill revs-splash__fill--v">
            {vParts.map((p, i) => (
              <path
                key={`f-v-${i}`}
                d={p.d}
                fillRule={p.rule}
                fill={colorOf(p.role)}
              />
            ))}
          </g>
        </svg>

        {full && <span className="revs-splash__shine" />}
      </div>

      {full && (
        <div className="flex flex-col items-center gap-3">
          <span className="revs-splash__word">
            <RevsWordmark height={34} />
          </span>
          <span className="revs-splash__tag">
            <RevsTagline height={11} color="rgb(var(--color-fg-2))" />
          </span>
        </div>
      )}
    </div>
  )
}
