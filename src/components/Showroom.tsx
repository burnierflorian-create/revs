import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Spot } from '../lib/spots'
import showroomBg from '../assets/showroom.webp'

// ─────────────────────────────────────────────────────────────────────
// "Mon Showroom" — an immersive private car gallery. The user's spots are
// exhibited like museum pieces on a reflective floor: the centre car sits
// in a living spotlight, the sides recede into the dark. Swipe to move the
// light. Gyroscope micro-parallax on the decor. All GPU (transform/opacity).
//
// Image system: realistic_render_url (per-spot) → car_renders library
// (shared, by make/model) → the user's raw photo. See migration 0056.
//
// TUNABLES: the constants below + CSS vars on the root.
// ─────────────────────────────────────────────────────────────────────

const SPACING_RATIO = 0.58 // gap between car centres, × container width
const MAX_VISIBLE = 3 // render this many cars each side of centre

type RenderRow = { make: string; model: string; url: string }

// Normalise pour matcher malgré casse/accents ("Huracán" ≡ "huracan").
const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

export default function Showroom({
  spots,
  onOpen,
}: {
  spots: Spot[]
  onOpen: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLImageElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const [width, setWidth] = useState(0)

  // Shared render library (detoured realistic renders, by make/model).
  const [renders, setRenders] = useState<RenderRow[]>([])
  useEffect(() => {
    let alive = true
    supabase
      .from('car_renders')
      .select('make, model, render_url')
      .then(({ data }) => {
        if (!alive || !data) return
        setRenders(
          (data as { make: string; model: string; render_url: string }[]).map((r) => ({
            make: norm(r.make),
            model: norm(r.model),
            url: r.render_url,
          })),
        )
      })
    return () => {
      alive = false
    }
  }, [])

  // Match a spot to a library render: exact make+model first, else the longest
  // library model that the spot model starts-with / contains (so a generic
  // "Huracán" render covers "Huracán Tecnica", "Huracán Spyder", …).
  function resolveRender(brand: string, model: string): string | null {
    const b = norm(brand)
    const m = norm(model)
    let best: string | null = null
    let bestLen = -1
    for (const r of renders) {
      if (r.make !== b) continue
      if (m === r.model) return r.url
      if ((m.startsWith(r.model) || m.includes(r.model)) && r.model.length > bestLen) {
        best = r.url
        bestLen = r.model.length
      }
    }
    return best
  }

  // Resolution order: per-spot override → shared render library → raw photo.
  // isRender = a detoured render (transparent PNG) → floats on the floor;
  // otherwise it's a rectangular photo → framed like an exhibit.
  function imageFor(s: Spot): { url: string; isRender: boolean } {
    if (s.realistic_render_url) return { url: s.realistic_render_url, isRender: true }
    const r = resolveRender(s.brand, s.model)
    if (r) return { url: r, isRender: true }
    return { url: s.photo_url || '', isRender: false }
  }

  // Measure the container so the spacing is in real px.
  useLayoutEffect(() => {
    const measure = () => setWidth(containerRef.current?.clientWidth ?? 0)
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [])
  const spacing = width * SPACING_RATIO

  // ── Swipe (pointer drag → snap to nearest) ──
  const dragRef = useRef<{ x: number; moved: boolean } | null>(null)
  function onPointerDown(e: React.PointerEvent) {
    dragRef.current = { x: e.clientX, moved: false }
    if (stageRef.current) stageRef.current.style.transition = 'none'
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true
      try {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }
    if (d.moved && stageRef.current) {
      stageRef.current.style.transform = `translate3d(${dx}px,0,0)`
    }
  }
  function onPointerUp(e: React.PointerEvent) {
    const d = dragRef.current
    dragRef.current = null
    if (stageRef.current) {
      stageRef.current.style.transition = 'transform 0.5s cubic-bezier(0.22,1,0.36,1)'
      stageRef.current.style.transform = 'translate3d(0,0,0)'
    }
    if (!d || !d.moved || spacing === 0) return
    const dx = e.clientX - d.x
    const delta = -Math.round(dx / spacing)
    setActive((a) => Math.max(0, Math.min(spots.length - 1, a + delta)))
  }

  // ── Gyroscope + pointer parallax on the decor ──
  useEffect(() => {
    const bg = bgRef.current
    const root = containerRef.current
    if (!bg || !root) return
    const apply = (nx: number, ny: number) => {
      bg.style.transform = `scale(1.12) translate3d(${(nx * -18).toFixed(1)}px, ${(ny * -12).toFixed(1)}px, 0)`
    }
    const onMove = (e: PointerEvent) => {
      const r = root.getBoundingClientRect()
      apply((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5)
    }
    const onOrient = (e: DeviceOrientationEvent) => {
      const g = Math.max(-40, Math.min(40, e.gamma ?? 0)) / 40
      const b = Math.max(-40, Math.min(40, (e.beta ?? 0) - 45)) / 40
      apply(g * 0.5, b * 0.5)
    }
    root.addEventListener('pointermove', onMove)
    window.addEventListener('deviceorientation', onOrient)
    return () => {
      root.removeEventListener('pointermove', onMove)
      window.removeEventListener('deviceorientation', onOrient)
    }
  }, [])

  const activeSpot = spots[active]

  return (
    <div
      ref={containerRef}
      className="relative select-none overflow-hidden"
      style={{
        height: 'min(66vh, 540px)',
        borderRadius: 22,
        background: '#050506',
        border: '1px solid rgba(255,255,255,0.06)',
        touchAction: 'pan-y',
        animation: 'showroom-enter 0.7s cubic-bezier(0.22,1,0.36,1) both',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Decor */}
      <img
        ref={bgRef}
        src={showroomBg}
        alt=""
        draggable={false}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scale(1.12)',
          transition: 'transform 0.25s ease-out',
          willChange: 'transform',
          pointerEvents: 'none',
        }}
      />
      {/* Depth vignette */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(120% 80% at 50% 30%, transparent 40%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Living spotlight over the centre car */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-6%',
          left: '50%',
          width: '58%',
          height: '86%',
          transform: 'translateX(-50%)',
          background:
            'radial-gradient(50% 42% at 50% 22%, rgba(255,255,255,0.30), rgba(255,255,255,0.06) 45%, transparent 66%)',
          mixBlendMode: 'screen',
          animation: 'showroom-flicker 4.2s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />

      {/* Counter */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          left: 0,
          right: 0,
          textAlign: 'center',
          color: 'rgba(255,255,255,0.85)',
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textShadow: '0 1px 8px rgba(0,0,0,0.8)',
          pointerEvents: 'none',
        }}
      >
        <span style={{ color: '#E8203A' }}>{spots.length}</span>{' '}
        {spots.length > 1 ? 'voitures dans votre showroom' : 'voiture dans votre showroom'}
      </div>

      {/* Stage — the cars */}
      <div
        ref={stageRef}
        style={{ position: 'absolute', inset: 0, willChange: 'transform' }}
      >
        {spots.map((s, i) => {
          const d = i - active
          const abs = Math.abs(d)
          if (abs > MAX_VISIBLE) return null
          const isCenter = d === 0
          const scale = isCenter ? 1 : Math.max(0.55, 0.78 - abs * 0.1)
          const opacity = isCenter ? 1 : Math.max(0.22, 0.62 - abs * 0.2)
          const brightness = isCenter ? 1 : Math.max(0.32, 0.6 - abs * 0.12)
          const blur = isCenter ? 0 : Math.min(2.2, 0.7 + abs * 0.5)
          const { url: img, isRender } = imageFor(s)
          return (
            <div
              key={s.id}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: '78%',
                maxWidth: 520,
                transform: `translate(-50%, -52%) translateX(${d * spacing}px) scale(${scale})`,
                transition:
                  'transform 0.52s cubic-bezier(0.22,1,0.36,1), opacity 0.52s ease, filter 0.52s ease',
                opacity,
                filter: `brightness(${brightness}) blur(${blur}px)`,
                zIndex: 20 - abs,
              }}
            >
              <button
                onClick={() => {
                  if (isCenter) onOpen(s.id)
                  else setActive(i)
                }}
                aria-label={`${s.brand} ${s.model}`}
                style={{
                  display: 'block',
                  width: '100%',
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  cursor: 'pointer',
                }}
              >
                {isRender ? (
                  /* Detoured render — the car floats on the floor, no frame */
                  <>
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        aspectRatio: '16 / 10',
                      }}
                    >
                      {/* Soft ground shadow anchoring the car */}
                      <div
                        aria-hidden
                        style={{
                          position: 'absolute',
                          bottom: '3%',
                          left: '14%',
                          right: '14%',
                          height: '11%',
                          borderRadius: '50%',
                          background:
                            'radial-gradient(ellipse at center, rgba(0,0,0,0.6), rgba(0,0,0,0.28) 45%, transparent 72%)',
                          filter: 'blur(7px)',
                        }}
                      />
                      <img
                        src={img}
                        alt=""
                        draggable={false}
                        style={{
                          position: 'relative',
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                          filter: isCenter
                            ? 'drop-shadow(0 18px 26px rgba(0,0,0,0.55))'
                            : 'drop-shadow(0 12px 20px rgba(0,0,0,0.5))',
                        }}
                      />
                    </div>
                    {/* Floor reflection (mirrored, faded) */}
                    <div
                      aria-hidden
                      style={{
                        width: '100%',
                        aspectRatio: '16 / 10',
                        marginTop: '-14%',
                        transform: 'scaleY(-1)',
                        opacity: 0.2,
                        WebkitMaskImage:
                          'linear-gradient(to top, rgba(0,0,0,0.9), transparent 55%)',
                        maskImage: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent 55%)',
                        filter: 'blur(1.5px)',
                      }}
                    >
                      <img
                        src={img}
                        alt=""
                        draggable={false}
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    </div>
                  </>
                ) : (
                  /* Raw photo — framed like a museum exhibit */
                  <>
                    <div
                      style={{
                        width: '100%',
                        aspectRatio: '16 / 10',
                        borderRadius: 12,
                        overflow: 'hidden',
                        boxShadow: isCenter
                          ? '0 24px 60px rgba(0,0,0,0.7), 0 0 40px rgba(255,255,255,0.10)'
                          : '0 16px 40px rgba(0,0,0,0.6)',
                      }}
                    >
                      {img ? (
                        <img
                          src={img}
                          alt=""
                          draggable={false}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '100%', background: '#141418' }} />
                      )}
                    </div>
                    <div
                      aria-hidden
                      style={{
                        width: '100%',
                        aspectRatio: '16 / 10',
                        marginTop: 2,
                        transform: 'scaleY(-1)',
                        opacity: 0.22,
                        borderRadius: 12,
                        overflow: 'hidden',
                        WebkitMaskImage:
                          'linear-gradient(to bottom, rgba(0,0,0,0.85), transparent 62%)',
                        maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.85), transparent 62%)',
                        filter: 'blur(1px)',
                      }}
                    >
                      {img && (
                        <img
                          src={img}
                          alt=""
                          draggable={false}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      )}
                    </div>
                  </>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Museum plaque (centre car) */}
      {activeSpot && (
        <div
          key={activeSpot.id}
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            minWidth: 200,
            maxWidth: '86%',
            padding: '9px 18px',
            borderRadius: 12,
            textAlign: 'center',
            background: 'rgba(10,10,12,0.62)',
            border: '1px solid rgba(255,255,255,0.12)',
            backdropFilter: 'blur(10px) saturate(160%)',
            WebkitBackdropFilter: 'blur(10px) saturate(160%)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            animation: 'cardv2-appear 0.4s ease both',
            zIndex: 30,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.14em',
              color: '#E8203A',
            }}
          >
            {activeSpot.brand.toUpperCase()}
            {activeSpot.year ? ` · ${activeSpot.year}` : ''}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display, inherit)',
              fontSize: 17,
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: '#fff',
              marginTop: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {activeSpot.model}
          </div>
        </div>
      )}

      {/* Progress dots */}
      {spots.length > 1 && (
        <div
          style={{
            position: 'absolute',
            bottom: 74,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            gap: 5,
            pointerEvents: 'none',
          }}
        >
          {spots.slice(0, 12).map((_, i) => (
            <span
              key={i}
              style={{
                width: i === active ? 14 : 5,
                height: 5,
                borderRadius: 9999,
                background: i === active ? '#E8203A' : 'rgba(255,255,255,0.35)',
                transition: 'width 0.3s ease, background 0.3s ease',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
