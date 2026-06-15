import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

// First-launch onboarding — accelerated 3-slide, Apple-style flow built
// entirely from pure CSS/SVG geometry (no image assets). The SINGLE source
// of truth for whether to show it is profiles.onboarding_completed in
// Supabase: false (or a missing row) → show; true → skip. There is NO
// localStorage gate, so a server-side reset of the flag force-replays the
// tuto for everyone. Mounted once in App; renders null once past it.

const RED = '#E8203A'

// Spring-physics easing for the inter-slide glide (gentle overshoot).
const SPRING = 'transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1)'

// Fire the permission prompts in order — geolocation first (needed to
// spot), then notifications. Must run synchronously from the click (no
// await before) so iOS Safari / iOS PWA surface the geo prompt. Refusal is
// fine: the app keeps working, changeable later in Settings.
function kickoffPermissions() {
  try {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => {},
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 },
      )
    }
  } catch {
    /* ignore */
  }
  try {
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    ) {
      Notification.requestPermission().catch(() => {})
    }
  } catch {
    /* ignore */
  }
}

// ── Slide 1 · pulsing red beacon over a stylised CSS map grid ──
function MapBeacon() {
  return (
    <div
      className="relative h-56 w-56"
      style={{ animation: 'onb-slide-up 0.6s ease-out' }}
    >
      <div
        aria-hidden
        className="absolute inset-0 rounded-3xl"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
          maskImage:
            'radial-gradient(circle at center, black 38%, transparent 74%)',
          WebkitMaskImage:
            'radial-gradient(circle at center, black 38%, transparent 74%)',
        }}
      />
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full"
        style={{ background: 'rgba(232,32,58,0.20)' }}
      />
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full"
        style={{ background: 'rgba(232,32,58,0.30)', animationDelay: '0.4s' }}
      />
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ background: RED, boxShadow: '0 0 26px rgba(232,32,58,0.85)' }}
      />
      {/* Scattered spot pings — several red dots pulsing across the map. */}
      {[
        { top: '26%', left: '30%', d: '0s' },
        { top: '32%', left: '70%', d: '0.8s' },
        { top: '70%', left: '64%', d: '1.2s' },
        { top: '66%', left: '32%', d: '0.5s' },
      ].map((p, i) => (
        <span
          key={i}
          aria-hidden
          className="absolute"
          style={{ top: p.top, left: p.left, transform: 'translate(-50%,-50%)' }}
        >
          <span
            className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full"
            style={{ background: 'rgba(232,32,58,0.28)', animationDelay: p.d }}
          />
          <span
            className="block h-2 w-2 rounded-full"
            style={{ background: RED, boxShadow: '0 0 8px rgba(232,32,58,0.8)' }}
          />
        </span>
      ))}
    </div>
  )
}

// ── Slide 2 · three fanned collection cards (matte grey / sport blue /
//    neon violet) in CSS perspective, floating softly ──
function DeckFan() {
  const card = 'absolute inset-0 rounded-2xl'
  return (
    <div
      className="relative h-60 w-44"
      style={{
        perspective: '900px',
        animation: 'onb-float 4.5s ease-in-out infinite',
      }}
    >
      <div
        aria-hidden
        className={card}
        style={{
          transform: 'rotateZ(-11deg) translateY(-16px) scale(0.9)',
          border: '1.5px solid rgba(156,163,175,0.65)',
          background: 'rgba(255,255,255,0.03)',
        }}
      />
      <div
        aria-hidden
        className={card}
        style={{
          transform: 'rotateZ(-3deg) translateY(-6px) scale(0.95)',
          border: '1.5px solid rgba(59,130,246,0.8)',
          background: 'rgba(59,130,246,0.06)',
        }}
      />
      <div
        aria-hidden
        className={`${card} flex items-center justify-center overflow-hidden`}
        style={{
          transform: 'rotateZ(5deg)',
          border: '1.5px solid rgba(168,85,247,0.9)',
          background: 'rgba(168,85,247,0.08)',
          boxShadow: '0 0 34px rgba(168,85,247,0.28)',
        }}
      >
        {/* Holographic sheen — a shifting rainbow film over the rare card. */}
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(125deg, rgba(255,0,128,0.20) 0%, rgba(0,200,255,0.16) 35%, rgba(180,80,255,0.22) 65%, rgba(255,200,0,0.14) 100%)',
            mixBlendMode: 'screen',
          }}
        />
        <span
          className="relative font-display text-5xl font-extrabold tracking-tighter"
          style={{ color: 'rgba(216,180,254,0.95)' }}
        >
          R
        </span>
      </div>
    </div>
  )
}

// ── Slide 3 · minimalist white-line podium with three spotters + XP bars ──
function Podium() {
  const cols = [
    { name: 'Léa', rank: 2, h: 64, fill: 70 },
    { name: 'Marco', rank: 1, h: 92, fill: 96 },
    { name: 'Tom', rank: 3, h: 46, fill: 54 },
  ]
  return (
    <div className="flex items-end justify-center gap-3">
      {cols.map((c, i) => (
        <div key={c.name} className="flex w-16 flex-col items-center gap-2">
          <span
            className="text-xs font-semibold text-white"
            style={{ animation: `onb-slide-up 0.5s ease-out ${0.15 + i * 0.1}s both` }}
          >
            {c.name}
          </span>
          <div
            className="h-1 w-full overflow-hidden rounded-full bg-white/15"
            style={{ animation: `onb-slide-up 0.5s ease-out ${0.15 + i * 0.1}s both` }}
          >
            <div
              className="h-full rounded-full bg-white"
              style={{ width: `${c.fill}%` }}
            />
          </div>
          <div
            className="flex w-full items-start justify-center rounded-t-md pt-1.5"
            style={{
              height: c.h,
              border: '1px solid rgba(255,255,255,0.45)',
              borderBottom: 'none',
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 100%)',
              transformOrigin: 'bottom',
              animation: `onb-rise 0.55s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.1}s both`,
            }}
          >
            <span className="font-display text-sm font-extrabold text-white/80">
              {c.rank}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

type Slide = { title: string; subtitle: string; visual: React.ReactNode }

const SLIDES: Slide[] = [
  {
    title: 'Spotte les supercars',
    subtitle:
      "Prends une photo, l'IA identifie la voiture en secondes et elle apparaît sur la carte en temps réel. Gagne de l'XP selon la rareté.",
    visual: <MapBeacon />,
  },
  {
    title: 'Collectionne tes cartes',
    subtitle:
      'Chaque spot génère une carte unique. Commun, Rare, Ultra Rare ou Légendaire — plus la voiture est rare, plus ta carte est précieuse.',
    visual: <DeckFan />,
  },
  {
    title: 'Deviens le meilleur spotter',
    subtitle:
      'Enchaîne les streaks, complète les challenges hebdomadaires et affronte les spotters de ta ville pour atteindre le sommet.',
    visual: <Podium />,
  },
]

// Guided tour steps — each spotlights a bottom-nav tab by its aria-label
// (set in MainLayout). Runs right after the slides, before the flag flips.
const TOUR: { label: string; emoji: string; title: string; body: string }[] = [
  {
    label: 'Carte',
    emoji: '🗺️',
    title: 'La Carte',
    body: "Vois en temps réel tous les spots autour de toi. Les zones rouges s'enflamment quand l'action est intense.",
  },
  {
    label: 'Fil',
    emoji: '📸',
    title: 'Le Fil',
    body: 'Toute la communauté REVS en direct. Like et commente les spots des autres spotters.',
  },
  {
    label: 'Accueil',
    emoji: '🏠',
    title: "L'Accueil",
    body: "Tes défis de la semaine, ton XP et tout ce qu'il faut savoir d'un coup d'œil.",
  },
  {
    label: 'Explorer',
    emoji: '🔍',
    title: "L'Explorer",
    body: 'Toutes les marques, les actus CarSpotting et les événements près de toi.',
  },
  {
    label: 'Profil',
    emoji: '👤',
    title: 'Ton Profil',
    body: 'Tes spots, ta collection de cartes, tes badges et ton rang dans le classement.',
  },
]

type Rect = { top: number; left: number; width: number; height: number }

export default function Onboarding() {
  const navigate = useNavigate()
  // null = still deciding (no flash); false = hidden; true = show.
  const [show, setShow] = useState<boolean | null>(null)
  const [index, setIndex] = useState(0)
  const startX = useRef<number | null>(null)
  // Flow phase: the 3 slides, then the 5-step guided tour.
  const [phase, setPhase] = useState<'slides' | 'tour'>('slides')
  const [tourStep, setTourStep] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)

  // Single source of truth = the DB flag. Show whenever it isn't
  // explicitly true (false / null / missing row → first launch).
  useEffect(() => {
    let active = true
    ;(async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!active) return
      if (!user) {
        setShow(false)
        return
      }
      const { data } = await supabase
        .from('profiles')
        .select('onboarding_completed')
        .eq('user_id', user.id)
        .maybeSingle()
      if (!active) return
      const done =
        (data as { onboarding_completed?: boolean } | null)
          ?.onboarding_completed === true
      setShow(!done)
    })()
    return () => {
      active = false
    }
  }, [])

  // Measure the spotlighted nav tab whenever the tour step changes (and on
  // resize / orientation), reading its on-screen rect from the live navbar.
  useEffect(() => {
    if (phase !== 'tour') return
    function measure() {
      const el = document.querySelector(
        `nav.liquid-nav [aria-label="${TOUR[tourStep].label}"]`,
      )
      if (el) {
        const r = el.getBoundingClientRect()
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [phase, tourStep])

  function nextTour() {
    if (tourStep < TOUR.length - 1) setTourStep((s) => s + 1)
    else complete(true)
  }

  function complete(toMap: boolean) {
    // Permission prompts must fire inside the gesture, before any await.
    kickoffPermissions()
    setShow(false)
    // Persist completion — the DB flag is what gates the next launch.
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (user) {
        await supabase
          .from('profiles')
          .update({ onboarding_completed: true })
          .eq('user_id', user.id)
      }
    })()
    if (toMap) navigate('/map')
  }

  if (!show) return null

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (startX.current == null) return
    const dx = e.changedTouches[0].clientX - startX.current
    startX.current = null
    if (dx < -50 && index < SLIDES.length - 1) setIndex((i) => i + 1)
    else if (dx > 50 && index > 0) setIndex((i) => i - 1)
  }

  // ── Guided tour overlay (spotlight on each nav tab) ──
  if (phase === 'tour') {
    const t = TOUR[tourStep]
    const screenW = window.innerWidth
    const BUBBLE_W = 290
    const cx = rect ? rect.left + rect.width / 2 : screenW / 2
    const bubbleLeft = Math.min(
      Math.max(cx - BUBBLE_W / 2, 12),
      Math.max(12, screenW - BUBBLE_W - 12),
    )
    const bubbleBottom = rect ? window.innerHeight - rect.top + 16 : 140
    const arrowLeft = Math.min(Math.max(cx - bubbleLeft, 24), BUBBLE_W - 24)
    const lastStep = tourStep === TOUR.length - 1

    return (
      <div
        onClick={nextTour}
        className="fixed inset-0 z-[100]"
        style={{ fontFamily: 'var(--font-display, Inter, system-ui, sans-serif)' }}
      >
        {/* Spotlight — transparent hole; the rest of the screen is darkened
            by the huge box-shadow. Springs between steps; red halo pulse. */}
        {rect ? (
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-2xl"
            style={{
              top: rect.top - 8,
              left: rect.left - 8,
              width: rect.width + 16,
              height: rect.height + 16,
              boxShadow: '0 0 0 9999px rgba(0,0,0,0.75)',
              border: '2px solid rgba(232,32,58,0.9)',
              transition:
                'top .45s cubic-bezier(0.34,1.56,0.64,1), left .45s cubic-bezier(0.34,1.56,0.64,1), width .45s cubic-bezier(0.34,1.56,0.64,1), height .45s cubic-bezier(0.34,1.56,0.64,1)',
              animation: 'onb-spot 1.8s ease-in-out infinite',
            }}
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.75)' }}
          />
        )}

        {/* Progress 1/5 — discreet, top-right */}
        <div
          className="absolute right-5 text-sm font-semibold text-white/55"
          style={{ top: 'max(1.25rem, env(safe-area-inset-top))' }}
        >
          {tourStep + 1}/{TOUR.length}
        </div>

        {/* Bubble + down-arrow, anchored above the spotlighted tab */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute"
          style={{
            left: bubbleLeft,
            bottom: bubbleBottom,
            width: BUBBLE_W,
            transition:
              'left .45s cubic-bezier(0.34,1.56,0.64,1), bottom .45s cubic-bezier(0.34,1.56,0.64,1)',
          }}
        >
          <div
            className="rounded-2xl p-4"
            style={{
              background: '#141414',
              border: '1.5px solid #E8203A',
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            }}
          >
            <p className="text-[15px] font-bold text-white">
              {t.emoji} {t.title}
            </p>
            <p className="mt-1.5 text-[13px] leading-snug text-white/65">
              {t.body}
            </p>
            <button
              onClick={nextTour}
              className="tappable mt-3 w-full rounded-full py-2.5 text-sm font-bold text-white transition-transform active:scale-[0.98]"
              style={{ background: RED, boxShadow: '0 0 14px rgba(232,32,58,0.5)' }}
            >
              {lastStep ? 'Allons-y 🚀' : 'Suivant →'}
            </button>
          </div>
          {/* CSS arrow pointing down to the tab (red border + dark fill) */}
          <span
            aria-hidden
            className="absolute"
            style={{
              left: arrowLeft - 9,
              top: '100%',
              width: 0,
              height: 0,
              borderLeft: '9px solid transparent',
              borderRight: '9px solid transparent',
              borderTop: '9px solid #E8203A',
            }}
          />
          <span
            aria-hidden
            className="absolute"
            style={{
              left: arrowLeft - 7,
              top: 'calc(100% - 2px)',
              width: 0,
              height: 0,
              borderLeft: '7px solid transparent',
              borderRight: '7px solid transparent',
              borderTop: '7px solid #141414',
            }}
          />
        </div>
      </div>
    )
  }

  const last = index === SLIDES.length - 1

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col"
      style={{
        background: '#0a0a0a',
        color: '#fff',
        fontFamily: 'var(--font-display, Inter, system-ui, sans-serif)',
      }}
    >
      {/* Passer — discreet, top-right */}
      <button
        onClick={() => complete(false)}
        className="tappable absolute right-5 z-10 text-sm font-medium text-white/45 transition-colors hover:text-white/80"
        style={{ top: 'max(1.25rem, env(safe-area-inset-top))' }}
      >
        Passer
      </button>

      {/* Slides — horizontal spring track, swipeable */}
      <div
        className="flex-1 overflow-hidden"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="flex h-full"
          style={{
            transform: `translateX(-${index * 100}%)`,
            transition: SPRING,
          }}
        >
          {SLIDES.map((s) => (
            <section
              key={s.title}
              className="flex h-full w-full min-w-full flex-col items-center justify-center px-9 text-center"
            >
              <div className="mb-14 flex h-60 items-center justify-center">
                {s.visual}
              </div>
              <h1 className="font-display text-[30px] font-extrabold leading-tight tracking-tight">
                {s.title}
              </h1>
              <p className="mt-3 max-w-[20rem] text-[15px] leading-relaxed text-white/55">
                {s.subtitle}
              </p>
            </section>
          ))}
        </div>
      </div>

      {/* Footer — dots + final CTA */}
      <div className="px-8 pb-[max(2rem,env(safe-area-inset-bottom))] pt-2">
        <div className="mb-7 flex items-center justify-center gap-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setIndex(i)}
              aria-label={`Aller au slide ${i + 1}`}
              className="h-2 rounded-full transition-all duration-300"
              style={{
                width: i === index ? '22px' : '8px',
                background: i === index ? RED : 'rgba(255,255,255,0.25)',
              }}
            />
          ))}
        </div>

        {last && (
          <button
            onClick={() => setPhase('tour')}
            className="tappable w-full rounded-full py-4 text-base font-bold text-white transition-transform active:scale-[0.98]"
            style={{ background: RED, boxShadow: '0 0 20px rgba(232,32,58,0.5)' }}
          >
            C'est parti !
          </button>
        )}
      </div>
    </div>
  )
}
