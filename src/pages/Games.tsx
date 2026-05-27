import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Flag, Gamepad2, Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Spot } from '../lib/spots'
import { Skeleton } from '../components/Skeleton'

/** Index page for in-app games. Hero spotlights the user's best spot
 *  (highest estimated_price with a photo); falls back to a gradient
 *  when the user has no spots yet. Only one game is wired today —
 *  REVS RACE — surfaced as a large card with a stylised top-down
 *  circuit SVG as the background. */
export default function Games() {
  const navigate = useNavigate()
  const [hero, setHero] = useState<Spot | null | undefined>(undefined)

  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        if (active) setHero(null)
        return
      }
      // Best-priced spot with a photo. NULLS LAST sorts undefined
      // prices to the bottom so we don't grab a placeholder.
      const { data } = await supabase
        .from('spots')
        .select('*')
        .eq('user_id', user.id)
        .not('photo_url', 'is', null)
        .order('estimated_price', { ascending: false, nullsFirst: false })
        .limit(1)
      if (active) {
        const arr = (data ?? []) as Spot[]
        setHero(arr[0] ?? null)
      }
    })()
    return () => {
      active = false
    }
  }, [])

  return (
    <div className="relative min-h-screen bg-bg text-fg">
      {/* ────── HERO ────── */}
      <section
        className="relative w-full"
        style={{ height: '60vh', minHeight: '380px' }}
      >
        {hero === undefined ? (
          <Skeleton className="absolute inset-0 rounded-none" />
        ) : (
          <>
            {hero?.photo_url ? (
              <img
                src={hero.photo_url}
                alt={`${hero.brand} ${hero.model}`}
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              // Cinematic fallback when the user has no spots yet
              <div
                className="absolute inset-0"
                style={{
                  background:
                    'radial-gradient(circle at 50% 30%, #2a0a10 0%, #0a0a0a 60%, #000 100%)',
                }}
              />
            )}

            {/* Bottom dark gradient for legibility */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.15) 35%, rgba(10,10,10,0.85) 78%, #0a0a0a 100%)',
              }}
            />

            {/* Top-left back button */}
            <button
              onClick={() => navigate(-1)}
              aria-label="Retour"
              className="tappable absolute left-3 z-20 flex h-9 w-9 items-center justify-center rounded-full"
              style={{
                top: 'max(12px, env(safe-area-inset-top))',
                background: 'rgba(0,0,0,0.45)',
                backdropFilter: 'blur(8px)',
                color: 'white',
              }}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>

            {/* Bottom-left title block */}
            <div className="absolute inset-x-0 bottom-0 z-10 px-5 pb-5">
              <p
                className="text-[10px] uppercase tracking-[0.3em] text-white/65"
              >
                Jeux REVS
              </p>
              <h1
                className="mt-1 font-display font-extrabold tracking-tighter text-white"
                style={{
                  fontSize: 'min(48px, 11vw)',
                  lineHeight: 0.95,
                  letterSpacing: '-0.03em',
                  textShadow: '0 6px 24px rgba(0,0,0,0.55)',
                }}
              >
                JEUX REVS
              </h1>
              <p className="mt-1.5 text-[13px] text-white/80">
                Affronte d'autres spotters
              </p>
              {hero?.brand && hero?.model && (
                <p
                  className="mt-2 text-[10px] uppercase tracking-widest text-white/45"
                >
                  Mis en avant : {hero.brand} {hero.model}
                </p>
              )}
            </div>
          </>
        )}
      </section>

      {/* ────── GAME CARDS ────── */}
      <section className="relative px-4 pt-5 pb-10">
        <button
          onClick={() => navigate('/race')}
          className="tappable relative block w-full overflow-hidden rounded-3xl text-left"
          style={{
            aspectRatio: '16 / 11',
            border: '1px solid rgba(232, 32, 58, 0.30)',
            boxShadow: '0 18px 38px rgba(232, 32, 58, 0.22)',
          }}
        >
          <RaceCardBackground />

          {/* Bottom gradient + content */}
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to bottom, rgba(10,10,10,0.20) 0%, rgba(10,10,10,0.65) 55%, rgba(10,10,10,0.96) 100%)',
            }}
          />
          <div className="absolute inset-x-0 bottom-0 p-5">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p
                  className="text-[10px] uppercase tracking-[0.3em] text-accent"
                >
                  Drag race
                </p>
                <p
                  className="mt-1 font-display font-extrabold tracking-tighter text-white"
                  style={{
                    fontSize: 'min(36px, 9.5vw)',
                    lineHeight: 0.95,
                    letterSpacing: '-0.03em',
                  }}
                >
                  REVS RACE
                </p>
                <p className="mt-1.5 max-w-[80%] text-[12px] text-white/75">
                  Choisis ta carte, vise le départ parfait, empoche
                  l'enjeu.
                </p>
                <div className="mt-3 flex items-center gap-1.5">
                  <span
                    className="rounded-full bg-accent/22 px-2.5 py-1 font-extrabold uppercase tracking-wider text-accent"
                    style={{ fontSize: '9.5px', letterSpacing: '0.08em' }}
                  >
                    Solo · IA
                  </span>
                  <span
                    className="flex items-center gap-1 rounded-full bg-white/[0.10] px-2.5 py-1 font-extrabold uppercase tracking-wider text-white/85"
                    style={{ fontSize: '9.5px', letterSpacing: '0.08em' }}
                  >
                    <Zap className="h-3 w-3" /> jusqu'à +1000 XP
                  </span>
                </div>
              </div>
              <span
                className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-accent text-white"
                style={{ boxShadow: '0 8px 22px rgba(232,32,58,0.55)' }}
              >
                <Flag className="h-5 w-5" />
              </span>
            </div>
          </div>
        </button>

        {/* Coming-soon hint */}
        <div
          className="mt-4 flex items-center gap-3 rounded-2xl px-4 py-3.5 text-[12px] text-fg2"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px dashed var(--color-border)',
          }}
        >
          <Gamepad2 className="h-4 w-4 flex-none" />
          <span>
            Multi-joueur, défi d'amis et matchmaking arrivent dans la
            prochaine mise à jour.
          </span>
          <ChevronRight className="h-4 w-4 flex-none text-fg2/50" />
        </div>
      </section>
    </div>
  )
}

/** Stylised top-down race circuit used as the REVS RACE card backdrop.
 *  Single oval-ish loop with grandstand blocks on the sides, start/
 *  finish straight at the bottom, kerbs alternating red/white. Pure
 *  SVG so it scales crisply at any card size. */
function RaceCardBackground() {
  return (
    <svg
      viewBox="0 0 320 220"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden
    >
      <defs>
        <radialGradient id="raceCardSky" cx="50%" cy="20%" r="65%">
          <stop offset="0%" stopColor="#241015" />
          <stop offset="60%" stopColor="#0e0708" />
          <stop offset="100%" stopColor="#050505" />
        </radialGradient>
        <linearGradient id="raceCardAsphalt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a2a2a" />
          <stop offset="100%" stopColor="#161616" />
        </linearGradient>
        <linearGradient id="raceCardStandShadow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.04)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
      </defs>

      <rect width="320" height="220" fill="url(#raceCardSky)" />

      {/* Grandstand strips */}
      <g opacity="0.35">
        <rect x="0" y="20" width="38" height="180" fill="#181818" />
        <rect x="282" y="20" width="38" height="180" fill="#181818" />
        <g fill="rgba(232,32,58,0.20)">
          {Array.from({ length: 9 }, (_, i) => (
            <rect
              key={`l-${i}`}
              x="4"
              y={28 + i * 20}
              width="30"
              height="3"
            />
          ))}
          {Array.from({ length: 9 }, (_, i) => (
            <rect
              key={`r-${i}`}
              x="286"
              y={28 + i * 20}
              width="30"
              height="3"
            />
          ))}
        </g>
      </g>

      {/* Track outer (asphalt) */}
      <path
        d="M 60 30 Q 30 30 30 70 L 30 150 Q 30 190 60 190 L 260 190 Q 290 190 290 150 L 290 70 Q 290 30 260 30 Z"
        fill="url(#raceCardAsphalt)"
        stroke="rgba(255,255,255,0.10)"
        strokeWidth="1"
      />

      {/* Grass infield */}
      <path
        d="M 80 60 Q 60 60 60 90 L 60 130 Q 60 160 80 160 L 240 160 Q 260 160 260 130 L 260 90 Q 260 60 240 60 Z"
        fill="#0c1410"
      />

      {/* Center yellow racing line */}
      <path
        d="M 70 45 Q 45 45 45 75 L 45 145 Q 45 175 70 175 L 250 175 Q 275 175 275 145 L 275 75 Q 275 45 250 45 Z"
        fill="none"
        stroke="rgba(255,200,50,0.55)"
        strokeWidth="1.2"
        strokeDasharray="6 8"
      />

      {/* Start/finish kerbs at bottom */}
      <g>
        {Array.from({ length: 18 }, (_, i) => (
          <rect
            key={`k-${i}`}
            x={68 + i * 10}
            y="186"
            width="5"
            height="8"
            fill={i % 2 === 0 ? '#E8203A' : '#ffffff'}
          />
        ))}
      </g>

      {/* Subtle grandstand shadow gradient at top */}
      <rect width="320" height="40" fill="url(#raceCardStandShadow)" />
    </svg>
  )
}
