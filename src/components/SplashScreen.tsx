import { useEffect, useState } from 'react'
import { prefersReducedMotion } from '../lib/motion'
import { RevsMark, RevsWordmark } from './Logo'

// Splash de lancement : le monogramme R+V arrive par la gauche avec une
// traînée de flou de mouvement, puis le mot REVS se révèle dans son sillage.
// ~2,3 s, 100 % GPU (transform/opacity). Ignoré si l'utilisateur a demandé
// moins d'animations. C'est un calque — il ne bloque jamais l'application.
//
// 28/09/2026 : le mot était composé en lettres HTML dans une police système
// (« Arial Black »), avec un S rouge. Il est désormais rendu par RevsWordmark,
// c'est-à-dire les mêmes tracés vectoriels que le reste de l'identité — même
// forme sur tous les appareils, et le rouge est porté par le V.

const DURATION = 2350

export default function SplashScreen() {
  const [gone, setGone] = useState(() => prefersReducedMotion())

  useEffect(() => {
    if (gone) return
    const t = window.setTimeout(() => setGone(true), DURATION)
    return () => window.clearTimeout(t)
  }, [gone])

  if (gone) return null

  return (
    <div className="rvsplash" aria-hidden>
      <div className="rvsplash-glow" />

      {/* rushing speed lines */}
      <div className="rvsplash-lines">
        {Array.from({ length: 8 }).map((_, i) => (
          <span
            key={i}
            className="rvsplash-line"
            style={{
              top: `${16 + i * 8.5}%`,
              animationDelay: `${0.05 + i * 0.04}s`,
              width: `${30 + ((i * 37) % 45)}%`,
              opacity: 0.12 + (i % 3) * 0.16,
            }}
          />
        ))}
      </div>

      {/* logo lockup: mark (with motion-blur trail) + REVS revealed */}
      <div className="rvsplash-logo">
        <span className="rvsplash-mark">
          <span className="rvsplash-ghost rvsplash-ghost-3">
            <RevsMark height={100} color="#FFFFFF" />
          </span>
          <span className="rvsplash-ghost rvsplash-ghost-2">
            <RevsMark height={100} color="#FFFFFF" />
          </span>
          <span className="rvsplash-ghost rvsplash-ghost-1">
            <RevsMark height={100} color="#FFFFFF" />
          </span>
          <span className="rvsplash-markmain">
            <RevsMark height={100} color="#FFFFFF" />
          </span>
        </span>
        <span className="rvsplash-word">
          <RevsWordmark height={84} color="#FFFFFF" />
          <span className="rvsplash-glint" />
        </span>
      </div>

      <div className="rvsplash-tag">CARS. SPOTS. PASSION.</div>
    </div>
  )
}
