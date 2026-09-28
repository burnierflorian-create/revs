import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'
import { useTheme } from '../lib/theme'
import '../styles/splash-animation.css'

// ═══════════════════════════════════════════════════════════════════════
//  Animation d'intro REVS — « REVS vient de démarrer »
// ═══════════════════════════════════════════════════════════════════════
//
//  0,00 → 0,15  un trait rouge très fin apparaît
//  0,15 → 0,55  il file vers la droite et dévoile les parties ROUGES du RV
//  0,55 → 0,90  second passage, plus rapide : les masses claires arrivent
//  0,90 → 1,15  le RV est complet, un reflet blanc le traverse
//  1,15 → 1,35  palier
//  1,35 → 1,45  fondu, puis l'accueil
//
// Le monogramme n'est pas redessiné : c'est le PNG de la référence, servi en
// deux calques (rouge / clair) et dévoilé au clip-path. Toute la chorégraphie
// vit dans splash-animation.css ; ce composant ne fait que choisir le mode et
// démonter au bon moment.
//
// Ni mot REVS ni tagline : l'état final est le monogramme seul, comme demandé.
//
// Monté dans main.tsx À CÔTÉ de <App />, pas autour : React monte
// l'application en parallèle, derrière le calque. L'intro ne retarde rien et
// il n'y a pas d'écran blanc à la sortie.

const FULL_MS = 1450
const BRIEF_MS = 450
const FADE_MS = 100

// Une intro complète est agréable une fois par jour, pénible à chaque
// ouverture. Au-delà de 24 h on la rejoue ; sinon, simple fondu.
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
    // plutôt que de rejouer l'intro à chaque ouverture.
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
  // clair, d'où une seconde série de fichiers. C'est la contrepartie d'une
  // image — un tracé en currentColor n'en aurait pas eu besoin.
  const light = theme === 'light'
  const mass = light
    ? '/brand/revs-monogram-mass-dark.png'
    : '/brand/revs-monogram-mass.png'
  const whole = light
    ? '/brand/revs-monogram-dark.png'
    : '/brand/revs-monogram.png'

  return (
    <div
      className={`revs-splash${phase === 'out' ? ' revs-splash--out' : ''}`}
      aria-hidden
      onAnimationEnd={(e) => {
        // Seule la sortie démonte ; les keyframes internes remontent aussi
        // ici et ne doivent pas interrompre l'intro.
        if (e.animationName === 'revs-fade-out') setPhase('gone')
      }}
    >
      <span className="revs-splash__stage">
        {full ? (
          <>
            {/* Le rouge se dévoile en premier, les masses claires suivent. */}
            <img
              className="revs-splash__layer revs-splash__layer--red"
              src="/brand/revs-monogram-red.png"
              alt=""
              decoding="async"
            />
            <img
              className="revs-splash__layer revs-splash__layer--mass"
              src={mass}
              alt=""
              decoding="async"
            />
            <span className="revs-splash__line revs-splash__line--1" />
            <span className="revs-splash__line revs-splash__line--2" />
            <span className="revs-splash__shine" />
          </>
        ) : (
          <img
            className="revs-splash__layer revs-splash__still"
            src={whole}
            alt=""
            decoding="async"
          />
        )}
      </span>
    </div>
  )
}
