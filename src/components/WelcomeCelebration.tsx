import { useMemo, useState } from 'react'

// Full-screen overlay that lands the user after a successful Stripe
// checkout. CSS-only confetti (no library) + a tiny carousel of perks
// they just unlocked. Colour palette swaps between Premium red and
// VIP gold based on the `tier` prop.

type Tier = 'premium' | 'vip'

type Slide = { emoji: string; title: string; body: string }

// ─────────────────────── Avantages annoncés ───────────────────────
// Réaligné le 26/09/2026. Cet écran s'affiche juste APRÈS un paiement
// réussi, en clés Stripe live : c'est l'endroit du produit où une promesse
// fausse coûte le plus cher. Deux y figuraient encore :
//   - « Spots illimités / Plus aucune limite journalière » : faux, le portail
//     IA applique des plafonds fermes (server/ai-gate.js).
//   - « Concours VIP / tirage du mois » : aucune contrepartie n'existe, ni
//     dans le logiciel ni en dehors.
//
// Règle : ne rien lister ici qui ne soit pas vérifiable dans le code.
// ─────────────────────── Avantages annoncés ───────────────────────
// Cet écran s'affiche juste APRÈS un paiement réussi, en clés Stripe live.
// C'est l'endroit du produit où une promesse fausse coûte le plus cher, donc la
// règle est stricte : on ne liste QUE ce qui est vérifiable dans le code.
//
// Retiré le 26/09/2026 : « Spots illimités », « Plus aucune limite
// journalière », « Concours VIP » et le tirage du mois — aucun n'existait.
//
// DÉLIBÉRÉMENT ABSENTS, bien que listés dans src/lib/plans.ts :
//   - « Statistiques avancées » : aucune implémentation (ni carte de chaleur,
//     ni stats conditionnées au tier).
//   - « Profil mis en avant dans le classement » : Leaderboard.tsx ne connaît
//     ni tier ni premium.
//   - « Support prioritaire » (VIP) : aucun canal dédié.
// Vérifié par recherche sur tout src/ le 26/09/2026 — isPremiumOrAbove() et
// isVip() ne gardent aucune fonctionnalité. À rajouter ici le jour où elles
// existent, pas avant.
//
// Les plafonds citent server/ai-gate.js, qui fait foi : free 5, premium 30,
// vip 300.
const PREMIUM_SLIDES: Slide[] = [
  {
    emoji: '⚡',
    title: '30 spots IA par jour',
    body: 'Tu passes de 5 à 30 reconnaissances par jour — de quoi couvrir un rassemblement entier.',
  },
  {
    emoji: '🎯',
    title: 'Mode Radar activé',
    body: 'Tu recevras une notif dès qu’une supercar est spottée près de toi.',
  },
  {
    emoji: '🏆',
    title: 'Ton badge Premium est actif',
    body: 'Il apparaît sur tous tes spots et sur ton profil.',
  },
]

// Le palier VIP garde ses propres diapositives pour une seule raison : son
// plafond est réellement différent (300/jour). Afficher « 30 spots » à un
// abonné VIP serait une nouvelle information fausse — l'inverse du but visé.
// Si VIP doit être fermé, cela se joue sur appConfig.SHOW_VIP_PLAN, pas ici.
const VIP_SLIDES: Slide[] = [
  {
    emoji: '⚡',
    title: '300 spots IA par jour',
    body: 'Le plafond le plus haut de REVS — 300 reconnaissances par jour.',
  },
  {
    emoji: '🎯',
    title: 'Mode Radar activé',
    body: 'Tu recevras une notif dès qu’une supercar est spottée près de toi.',
  },
  {
    emoji: '👑',
    title: 'Ton badge est actif',
    body: 'Le badge le plus rare de REVS, visible sur tes spots et ton profil.',
  },
]

// 30 confetti pieces — random horizontal start / duration / delay /
// drift / colour. Computed once with useMemo so they don't reshuffle
// on every render.
function useConfetti(palette: string[]) {
  return useMemo(() => {
    return Array.from({ length: 30 }).map(() => ({
      left: `${Math.random() * 100}%`,
      drift: `${Math.round(Math.random() * 120 - 60)}px`,
      dur: `${(2.6 + Math.random() * 2.4).toFixed(2)}s`,
      delay: `${(Math.random() * 1.6).toFixed(2)}s`,
      color: palette[Math.floor(Math.random() * palette.length)],
      // Some pieces taller, some squarer, for visual variety.
      h: `${10 + Math.round(Math.random() * 8)}px`,
    }))
  }, [palette])
}

export default function WelcomeCelebration({
  tier,
  onClose,
}: {
  tier: Tier
  onClose: () => void
}) {
  const isVip = tier === 'vip'
  const slides = isVip ? VIP_SLIDES : PREMIUM_SLIDES
  const palette = isVip
    ? ['#FFD700', '#D4AF37', '#FFC400', '#B8860B', '#FFE680']
    : ['#E63946', '#FF6B76', '#FF8A95', '#C82333', '#FFB3BA']
  const confetti = useConfetti(palette)

  const [step, setStep] = useState(0)
  const isLast = step >= slides.length - 1
  const slide = slides[step]

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-end overflow-hidden bg-black text-white"
      style={{
        background: isVip
          ? 'radial-gradient(circle at 50% 30%, rgba(212,175,55,0.35) 0%, rgba(212,175,55,0.10) 35%, #050505 75%)'
          : 'radial-gradient(circle at 50% 30%, rgba(230,57,70,0.45) 0%, rgba(230,57,70,0.10) 35%, #050505 75%)',
      }}
    >
      {/* Confetti layer */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        {confetti.map((c, i) => (
          <span
            key={i}
            className="confetti-piece"
            style={
              {
                left: c.left,
                height: c.h,
                background: c.color,
                '--drift': c.drift,
                '--dur': c.dur,
                '--delay': c.delay,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* Content */}
      <div className="relative flex w-full max-w-md flex-1 flex-col justify-center px-8 py-8 text-center">
        {/* Header — visible on all slides, animates the title */}
        <div className="space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-fg/60">
            {isVip ? 'Cercle VIP' : 'Premium'}
          </p>
          <h1
            className="font-display text-3xl font-black leading-tight"
            style={{ color: isVip ? '#FFD700' : '#FFFFFF' }}
          >
            {isVip
              ? 'Bienvenue dans le cercle VIP 👑'
              : 'Tu es maintenant Premium ⚡'}
          </h1>
        </div>

        {/* Current slide */}
        <div className="mt-10 flex flex-col items-center gap-4">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full text-4xl shadow-2xl"
            style={{
              background: isVip
                ? 'linear-gradient(135deg, #FFD700 0%, #B8860B 100%)'
                : 'linear-gradient(135deg, #E63946 0%, #FF6B76 100%)',
            }}
          >
            {slide.emoji}
          </div>
          <h2 className="font-display text-xl font-bold">{slide.title}</h2>
          <p className="max-w-[28ch] text-sm leading-relaxed text-fg/80">
            {slide.body}
          </p>
        </div>
      </div>

      {/* Footer: dots + CTA */}
      <footer className="relative w-full max-w-md space-y-5 px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
        <div className="flex justify-center gap-2">
          {slides.map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={`h-2 rounded-full transition-all duration-300 ${
                i === step
                  ? `w-6 ${isVip ? 'bg-[#FFD700]' : 'bg-accent'}`
                  : 'w-2 bg-fg/25'
              }`}
            />
          ))}
        </div>

        <button
          onClick={() => (isLast ? onClose() : setStep((s) => s + 1))}
          className={`w-full overflow-hidden rounded-full py-4 text-[15px] font-bold shadow-lg transition-transform active:scale-[0.98] ${
            isVip
              ? 'gold-shimmer relative text-black'
              : 'bg-accent text-white'
          }`}
          style={
            isVip
              ? {
                  background:
                    'linear-gradient(120deg, #d4af37 0%, #ffd700 45%, #b8860b 100%)',
                }
              : undefined
          }
        >
          <span className="relative z-10">
            {isLast ? "C'est parti !" : 'Suivant'}
          </span>
        </button>

        {!isLast && (
          <button
            onClick={onClose}
            className="block w-full text-center text-xs text-fg/45 transition-colors hover:text-fg/70"
          >
            Passer
          </button>
        )}
      </footer>
    </div>
  )
}
