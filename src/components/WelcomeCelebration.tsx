import { useMemo, useState } from 'react'

// Full-screen overlay that lands the user after a successful Stripe
// checkout. CSS-only confetti (no library) + a tiny carousel of perks
// they just unlocked. Colour palette swaps between Premium red and
// VIP gold based on the `tier` prop.

type Tier = 'premium' | 'vip'

type Slide = { emoji: string; title: string; body: string }

const PREMIUM_SLIDES: Slide[] = [
  {
    emoji: '🎯',
    title: 'Mode Radar activé',
    body: 'Tu recevras une notif dès qu’une supercar est spottée près de toi.',
  },
  {
    emoji: '✅',
    title: 'Spots illimités',
    body: 'Plus aucune limite journalière — spotte autant que tu veux.',
  },
  {
    emoji: '🏆',
    title: 'Ton badge est actif',
    body: 'Il apparaît sur tous tes spots et sur ton profil.',
  },
]

const VIP_SLIDES: Slide[] = [
  ...PREMIUM_SLIDES,
  {
    emoji: '🎰',
    title: 'Concours VIP',
    body: 'Tu participes automatiquement au tirage du mois pour des expériences uniques.',
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
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/60">
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
          <p className="max-w-[28ch] text-sm leading-relaxed text-white/80">
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
                  : 'w-2 bg-white/25'
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
            className="block w-full text-center text-xs text-white/45 transition-colors hover:text-white/70"
          >
            Passer
          </button>
        )}
      </footer>
    </div>
  )
}
