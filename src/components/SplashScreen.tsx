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
//  0,30 → 0,70  il trace le R du monogramme (stroke-dashoffset)
//  0,70 → 1,00  il enchaîne sur le V, sans rupture
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

  // Longueur de chaque contour, mesurée sur le tracé réel. C'est ce qui rend
  // le tracé indépendant de la géométrie : si le monogramme est redessiné,
  // l'animation suit sans qu'aucune constante ne soit à corriger.
  //
  // useLayoutEffect et non useEffect : la mesure doit être écrite AVANT la
  // première peinture, sinon les contours apparaissent entiers pendant une
  // frame avant de se rétracter.
  useLayoutEffect(() => {
    if (!full) return
    const svg = svgRef.current
    if (!svg) return
    for (const el of svg.querySelectorAll<SVGPathElement>(
      '.revs-splash__trace',
    )) {
      // getTotalLength additionne tous les sous-tracés d'un même path — la
      // panse et son contrepoinçon se tracent donc à la suite, ce qui est
      // exactement le geste voulu.
      el.style.setProperty('--len', String(el.getTotalLength()))
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
  const colorOf = (role: 'light' | 'accent') =>
    role === 'accent' ? '#E8203A' : '#FFFFFF'

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
          {full &&
            (['R', 'V'] as const).map((g) =>
              (g === 'R' ? rParts : vParts).map((p, i) => (
                <path
                  key={`t-${g}-${i}`}
                  className={`revs-splash__trace revs-splash__trace--${g.toLowerCase()}`}
                  d={p.d}
                  stroke={colorOf(p.role)}
                />
              )),
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
            <RevsWordmark height={34} color="#FFFFFF" />
          </span>
          <span className="revs-splash__tag">
            <RevsTagline height={11} color="#9A9A9A" />
          </span>
        </div>
      )}
    </div>
  )
}
