import { useEffect, useState } from 'react'
import { RevsTagline, RevsWordmark } from './Logo'
import { prefersReducedMotion } from '../lib/motion'
import { useTheme } from '../lib/theme'
import '../styles/splash-animation.css'

// ═══════════════════════════════════════════════════════════════════════
//  Animation d'intro REVS
// ═══════════════════════════════════════════════════════════════════════
//
//  0,00 → 0,30  un halo rouge diffus apparaît au centre — un feu arrière au loin
//  0,30 → 0,70  le halo se resserre pendant que le monogramme se révèle
//  0,70 → 1,00  un reflet métallique balaie le monogramme
//  1,00 → 1,30  REVS se pose dessous
//  1,30 → 1,50  la tagline suit
//  1,50 → 1,80  palier stable
//  1,80 → 2,00  fondu, puis démontage
//
// Le monogramme est le PNG de la planche de référence, affiché tel quel. Il
// n'est plus tracé : la version précédente animait un stroke-dashoffset sur
// des tracés SVG, ce qui n'a plus d'objet avec une image.
//
// Ce composant est monté dans main.tsx À CÔTÉ de <App />, pas autour : React
// monte l'application en parallèle, derrière le calque. Rien n'est retardé
// par l'animation, et il n'y a pas d'écran blanc à la sortie.

const FULL_MS = 2000
const BRIEF_MS = 500
const FADE_MS = 200

// Une intro de 2 s est agréable une fois par jour, pénible à chaque
// ouverture. Au-delà de 24 h on rejoue la version complète ; sinon simple
// fondu de 0,5 s sur le monogramme.
const STORAGE_KEY = 'revs-last-splash-full'
const FULL_EVERY_MS = 24 * 60 * 60 * 1000

type Mode = 'full' | 'brief'

// LECTURE SEULE : cette fonction sert d'initialiseur de useState, donc elle
// s'exécute pendant le rendu. Y écrire dans localStorage la rendrait impure —
// sous StrictMode l'initialiseur est appelé deux fois, le premier appel
// poserait l'horodatage et le second lirait une date toute fraîche : l'intro
// complète ne serait jamais visible en développement. L'écriture se fait dans
// un effet, plus bas.
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
  const { theme } = useTheme()
  const [mode] = useState<Mode>(readMode)
  const [phase, setPhase] = useState<'run' | 'out' | 'gone'>('run')

  const full = mode === 'full' && !reduced

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
    // en arrière-plan pendant le fondu), on démonte quand même.
    const t2 = window.setTimeout(() => setPhase('gone'), hold + 400)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [full])

  if (phase === 'gone') return null

  // Le monogramme de référence est blanc et rouge : illisible sur le thème
  // clair, d'où la variante sombre. C'est la contrepartie d'une image — un
  // tracé en currentColor n'aurait pas eu besoin de deux fichiers.
  const mark =
    theme === 'light'
      ? '/brand/revs-monogram-dark.png'
      : '/brand/revs-monogram.png'

  return (
    <div
      className={`revs-splash${full ? '' : ' revs-splash--brief'}${
        phase === 'out' ? ' revs-splash--out' : ''
      }`}
      aria-hidden
      onAnimationEnd={(e) => {
        // Seule la sortie démonte ; les keyframes internes remontent aussi
        // ici et ne doivent pas interrompre l'intro.
        if (e.animationName === 'revs-fade-out') setPhase('gone')
      }}
    >
      <span className="revs-splash__stage">
        {full && <span className="revs-splash__glow" />}
        <span className="revs-splash__markwrap">
          <img className="revs-splash__mark" src={mark} alt="" decoding="async" />
        </span>
      </span>

      {full && (
        <div className="flex flex-col items-center gap-2.5">
          <span className="revs-splash__word">
            <RevsWordmark height={30} />
          </span>
          <span className="revs-splash__tag">
            <RevsTagline height={10} color="rgb(var(--color-fg-2))" />
          </span>
        </div>
      )}
    </div>
  )
}
