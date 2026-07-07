import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchCardSpecs, type CardSpecs } from '../lib/cardSpecs'
import type { Spot } from '../lib/spots'
import showroomBg from '../assets/showroom.webp'

// ─────────────────────────────────────────────────────────────────────
// "Mon Showroom" — an immersive private car gallery. Each spot is exhibited
// like a museum piece on the reflective floor of a dark studio: the centre
// car sits in the spotlight, RESTING ON THE FLOOR (wheels on the baseline,
// contact shadow + mirror reflection), with a digital signage panel above it
// showing the car's specs. Sides recede into the dark. Swipe to move the
// light. Gyroscope micro-parallax on the decor. Everything is GPU-driven
// (transform / opacity only) so it stays at 120fps on ProMotion.
//
// Image system: realistic_render_url (per-spot) → car_renders library
// (shared, by make/model, detoured PNG) → the user's raw photo. See 0056.
//
// TUNABLES: the constants below.
// ─────────────────────────────────────────────────────────────────────

const SPACING_RATIO = 0.66 // gap between car centres, × container width
const MAX_VISIBLE = 3 // render this many cars each side of centre
const FLOOR_FROM_BOTTOM = '40%' // floor line = 60% from the top (on the decor floor)
const CAR_WIDTH = '90%' // bigger, imposing centrepiece
const CAR_MAX_WIDTH = 640

type RenderRow = { make: string; model: string; url: string }

// Normalise for matching despite case / accents ("Huracán" ≡ "huracan").
const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

// Aggressive match key: alphanumeric only, so separators don't matter —
// "Mercedes-AMG" ≡ "Mercedes AMG", "GT-R R35" ≡ "GTR R35", "911 GT3 RS" ≡
// "911GT3RS". Used to pair a spot with a library render.
const mkey = (s: string) => norm(s).replace(/[^a-z0-9]+/g, '')

const specsKey = (s: Spot) => `${norm(s.brand)}|${norm(s.model)}|${s.year ?? ''}`

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

  // ── Shared render library (detoured realistic renders, by make/model) ──
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
            make: mkey(r.make),
            model: mkey(r.model),
            url: r.render_url,
          })),
        )
      })
    return () => {
      alive = false
    }
  }, [])

  // Match a spot to a library render: exact make+model first, else the longest
  // library model the spot model starts-with / contains (a generic "Huracán"
  // render then covers "Huracán Tecnica", "Huracán Spyder", …).
  function resolveRender(brand: string, model: string): string | null {
    const b = mkey(brand)
    const m = mkey(model)
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

  // isRender = detoured render (transparent PNG) → rests on the floor;
  // otherwise a rectangular photo → framed exhibit.
  function imageFor(s: Spot): { url: string; isRender: boolean } {
    if (s.realistic_render_url) return { url: s.realistic_render_url, isRender: true }
    const r = resolveRender(s.brand, s.model)
    if (r) return { url: r, isRender: true }
    return { url: s.photo_url || '', isRender: false }
  }

  // ── Specs for the info panel (lazy, cached in car_specs server-side) ──
  // specsMap: loaded results (CardSpecs or null=failed). requestedRef: keys
  // already in flight, so we never double-fetch. A key absent from specsMap
  // renders the panel skeleton.
  const [specsMap, setSpecsMap] = useState<Map<string, CardSpecs | null>>(new Map())
  const requestedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    let alive = true
    // Fetch the centre car + its immediate neighbours (prefetch on swipe).
    const wanted = [active - 1, active, active + 1]
      .filter((i) => i >= 0 && i < spots.length)
      .map((i) => spots[i])
    wanted.forEach((s) => {
      const key = specsKey(s)
      if (requestedRef.current.has(key)) return
      requestedRef.current.add(key)
      fetchCardSpecs(s.brand, s.model, s.year ?? null).then((res) => {
        if (!alive) return
        setSpecsMap((prev) => new Map(prev).set(key, res))
      })
    })
    return () => {
      alive = false
    }
  }, [active, spots])

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

  const activeSpot = spots[active] as Spot | undefined
  const activeSpecs = activeSpot ? specsMap.get(specsKey(activeSpot)) : undefined

  return (
    <div
      ref={containerRef}
      className="relative select-none overflow-hidden"
      style={{
        height: 'min(68vh, 560px)',
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
            'radial-gradient(120% 80% at 50% 34%, transparent 42%, rgba(0,0,0,0.55) 100%)',
          pointerEvents: 'none',
        }}
      />

      {/* Living spotlight over the centre car */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-4%',
          left: '50%',
          width: '60%',
          height: '92%',
          transform: 'translateX(-50%)',
          background:
            'radial-gradient(48% 46% at 50% 30%, rgba(255,255,255,0.28), rgba(255,255,255,0.05) 46%, transparent 68%)',
          mixBlendMode: 'screen',
          animation: 'showroom-flicker 4.2s ease-in-out infinite',
          pointerEvents: 'none',
        }}
      />

      {/* Counter (top) */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 0,
          right: 0,
          textAlign: 'center',
          color: 'rgba(255,255,255,0.82)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.05em',
          textShadow: '0 1px 8px rgba(0,0,0,0.85)',
          pointerEvents: 'none',
          zIndex: 31,
        }}
      >
        <span style={{ color: '#E8203A' }}>{spots.length}</span>{' '}
        {spots.length > 1 ? 'voitures dans votre showroom' : 'voiture dans votre showroom'}
      </div>

      {/* Stage — the cars */}
      <div ref={stageRef} style={{ position: 'absolute', inset: 0, willChange: 'transform' }}>
        {spots.map((s, i) => {
          const d = i - active
          const abs = Math.abs(d)
          if (abs > MAX_VISIBLE) return null
          const isCenter = d === 0
          const scale = isCenter ? 1 : Math.max(0.5, 0.74 - abs * 0.1)
          const opacity = isCenter ? 1 : Math.max(0.2, 0.6 - abs * 0.2)
          const brightness = isCenter ? 1 : Math.max(0.3, 0.58 - abs * 0.12)
          const blur = isCenter ? 0 : Math.min(2.4, 0.8 + abs * 0.5)
          const { url: img, isRender } = imageFor(s)
          return (
            <div
              key={s.id}
              style={{
                position: 'absolute',
                left: '50%',
                bottom: FLOOR_FROM_BOTTOM, // the div's BOTTOM sits on the floor line
                width: CAR_WIDTH,
                maxWidth: CAR_MAX_WIDTH,
                transform: `translateX(-50%) translateX(${d * spacing}px) scale(${scale})`,
                transformOrigin: 'center bottom', // scaling keeps wheels on the floor
                transition:
                  'transform 0.52s cubic-bezier(0.22,1,0.36,1), opacity 0.52s ease, filter 0.52s ease',
                opacity,
                filter: `brightness(${brightness}) blur(${blur}px)`,
                zIndex: 20 - abs,
                willChange: 'transform, opacity',
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
                  /* Detoured render — RESTS on the floor. The <img> keeps its
                     natural ratio (height:auto) so the tightly-trimmed PNG has
                     its wheels exactly on the wrapper's bottom = the floor. */
                  <div style={{ position: 'relative', width: '100%' }}>
                    {/* Ambient + contact shadow, right under the wheels */}
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        left: '10%',
                        right: '10%',
                        bottom: '-3%',
                        height: '9%',
                        borderRadius: '50%',
                        background:
                          'radial-gradient(ellipse at center, rgba(0,0,0,0.5), rgba(0,0,0,0.22) 46%, transparent 72%)',
                        filter: 'blur(9px)',
                        zIndex: 0,
                      }}
                    />
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        left: '24%',
                        right: '24%',
                        bottom: '-1%',
                        height: '4.5%',
                        borderRadius: '50%',
                        background:
                          'radial-gradient(ellipse at center, rgba(0,0,0,0.85), rgba(0,0,0,0.5) 40%, transparent 74%)',
                        filter: 'blur(3px)',
                        zIndex: 0,
                      }}
                    />
                    {img ? (
                      <img
                        src={img}
                        alt=""
                        draggable={false}
                        style={{
                          position: 'relative',
                          zIndex: 1,
                          display: 'block',
                          width: '100%',
                          height: 'auto',
                          filter: isCenter
                            ? 'drop-shadow(0 4px 6px rgba(0,0,0,0.4))'
                            : 'drop-shadow(0 3px 5px rgba(0,0,0,0.35))',
                        }}
                      />
                    ) : (
                      <div style={{ width: '100%', paddingBottom: '42%', background: '#141418' }} />
                    )}
                    {/* Floor reflection — mirrored, faded, blurred */}
                    <div
                      aria-hidden
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        width: '100%',
                        transform: 'scaleY(-1)',
                        opacity: isCenter ? 0.26 : 0.15,
                        WebkitMaskImage:
                          'linear-gradient(to top, rgba(0,0,0,0.9), transparent 55%)',
                        maskImage: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent 55%)',
                        filter: 'blur(2px)',
                      }}
                    >
                      {img && (
                        <img
                          src={img}
                          alt=""
                          draggable={false}
                          style={{ display: 'block', width: '100%', height: 'auto' }}
                        />
                      )}
                    </div>
                  </div>
                ) : (
                  /* Raw photo — framed exhibit standing on the floor */
                  <div style={{ position: 'relative', width: '100%' }}>
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
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        width: '100%',
                        aspectRatio: '16 / 10',
                        transform: 'scaleY(-1)',
                        opacity: 0.2,
                        borderRadius: 12,
                        overflow: 'hidden',
                        WebkitMaskImage:
                          'linear-gradient(to top, rgba(0,0,0,0.85), transparent 60%)',
                        maskImage: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent 60%)',
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
                  </div>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Digital signage panel above the car (brand · year · model + specs).
          left/right insets guarantee it can NEVER overflow the screen edges;
          the inner panel is centred and capped so it stays a tidy screen. */}
      {activeSpot && (
        <div
          key={activeSpot.id}
          style={{
            position: 'absolute',
            top: 20,
            left: 12,
            right: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            zIndex: 30,
            pointerEvents: 'none',
            animation: 'cardv2-appear 0.45s cubic-bezier(0.22,1,0.36,1) both',
          }}
        >
          {/* Ceiling suspension wire */}
          <div
            aria-hidden
            style={{
              width: 1,
              height: 12,
              background: 'linear-gradient(to bottom, transparent, rgba(255,255,255,0.35))',
            }}
          />
          {/* Flat-screen bezel */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 340,
              padding: '9px 16px 11px',
              borderRadius: 14,
              background:
                'linear-gradient(180deg, rgba(20,22,28,0.92), rgba(8,9,12,0.94))',
              border: '1px solid rgba(255,255,255,0.10)',
              backdropFilter: 'blur(12px) saturate(150%)',
              WebkitBackdropFilter: 'blur(12px) saturate(150%)',
              boxShadow:
                '0 16px 40px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08), 0 0 22px rgba(232,32,58,0.10)',
            }}
          >
            {/* Red LED accent strip (screen "power" glow) */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                top: 0,
                left: '14%',
                right: '14%',
                height: 2,
                borderRadius: 2,
                background: 'linear-gradient(90deg, transparent, #E8203A, transparent)',
                boxShadow: '0 0 12px 1px rgba(232,32,58,0.75)',
              }}
            />
            <div
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.16em',
                color: '#E8203A',
                textAlign: 'center',
              }}
            >
              {activeSpot.brand.toUpperCase()}
              {activeSpot.year ? ` · ${activeSpot.year}` : ''}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display, inherit)',
                fontSize: 18,
                fontWeight: 800,
                letterSpacing: '-0.02em',
                color: '#fff',
                marginTop: 1,
                textAlign: 'center',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {activeSpot.model}
            </div>
            {/* Spec grid — 3 stats so everything fits without truncation */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 6,
                marginTop: 9,
                borderTop: '1px solid rgba(255,255,255,0.08)',
                paddingTop: 8,
              }}
            >
              <StatCell label="PUISSANCE" value={activeSpecs?.horsepower} loading={activeSpecs === undefined} />
              <StatCell label="0–100" value={activeSpecs?.zero_to_100} loading={activeSpecs === undefined} />
              <StatCell label="V.MAX" value={activeSpecs?.top_speed} loading={activeSpecs === undefined} />
            </div>
          </div>
          {/* Screen underglow spilling onto the car */}
          <div
            aria-hidden
            style={{
              width: '72%',
              height: 26,
              background:
                'radial-gradient(60% 100% at 50% 0%, rgba(232,32,58,0.13), transparent 72%)',
            }}
          />
        </div>
      )}

      {/* Progress dots */}
      {spots.length > 1 && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            gap: 5,
            pointerEvents: 'none',
            zIndex: 31,
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

// One spec on the digital panel. Shows a subtle skeleton while the specs
// request is in flight, "—" if unavailable.
function StatCell({
  label,
  value,
  loading,
}: {
  label: string
  value?: string
  loading: boolean
}) {
  return (
    <div style={{ textAlign: 'center', minWidth: 0 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          color: '#fff',
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          opacity: loading ? 0.5 : 1,
        }}
      >
        {loading ? '···' : value || '—'}
      </div>
      <div
        style={{
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: '0.08em',
          color: 'rgba(255,255,255,0.45)',
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  )
}
