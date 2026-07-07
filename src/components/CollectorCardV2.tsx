import { useEffect, useRef, useState } from 'react'
import type { Rarity } from '../lib/spots'

// ─────────────────────────────────────────────────────────────────────
// Collector card v2 — FUT/EA-FC energy × Pokémon-TCG collectibility, on
// the REVS dark + #E8203A identity. The rarity is readable in a glance
// from the FRAME alone (escalating richness), Ultra Rare + Legendary get a
// gyroscope holographic sheen. Everything animates on transform/opacity
// (GPU) for 120fps.
//
// TUNABLES: see RARITY_FRAME below (per-tier look) + the CSS vars set on
// the card root (--cv-float, --cv-holo, --cv-shine-dur, --cv-w).
// ─────────────────────────────────────────────────────────────────────

export type CardStats = {
  power?: string // ch
  accel?: string // 0-100
  vmax?: string // km/h
  torque?: string // Nm
}

type FrameLook = {
  label: string
  // Frame = the metallic border gradient (conic for a brushed-metal feel).
  frame: string
  // Inner hairline highlight colour.
  edge: string
  // Outer glow (box-shadow) — richer as rarity climbs.
  glow: string
  chipBg: string
  chipFg: string
  chipBorder: string
  holo: boolean // gyroscope rainbow sheen
  aura: boolean // pulsing outer aura (legendary)
  shine: boolean // looping light sweep
}

// The hierarchy. Common = flat steel, no effect → Legendary = gold/red,
// full holo + aura. Tune colours/intensities here.
const RARITY_FRAME: Record<Rarity, FrameLook> = {
  standard: {
    label: 'COMMUN',
    frame: 'linear-gradient(145deg, #3a3d42, #6b6e74 45%, #26282c)',
    edge: 'rgba(255,255,255,0.10)',
    glow: '0 16px 34px rgba(0,0,0,0.55)',
    chipBg: 'rgba(150,153,158,0.22)',
    chipFg: '#E5E7EB',
    chipBorder: 'rgba(200,203,208,0.35)',
    holo: false,
    aura: false,
    shine: false,
  },
  premium: {
    label: 'PEU COMMUN',
    frame: 'linear-gradient(145deg, #1f5a4a, #3fa588 45%, #123a30)',
    edge: 'rgba(120,255,210,0.18)',
    glow: '0 16px 36px rgba(45,180,140,0.30)',
    chipBg: 'rgba(45,180,140,0.22)',
    chipFg: '#C9F5E6',
    chipBorder: 'rgba(63,165,136,0.6)',
    holo: false,
    aura: false,
    shine: true,
  },
  performance: {
    label: 'RARE',
    frame: 'linear-gradient(145deg, #274a86, #9fc3ee 45%, #16294d)',
    edge: 'rgba(180,220,255,0.28)',
    glow: '0 16px 40px rgba(80,150,255,0.40)',
    chipBg: 'rgba(80,150,255,0.24)',
    chipFg: '#DBEAFE',
    chipBorder: 'rgba(120,180,255,0.75)',
    holo: false,
    aura: false,
    shine: true,
  },
  exclusif: {
    label: 'ÉPIQUE',
    frame: 'linear-gradient(145deg, #8a5a20, #E0A845 45%, #5c3a12)',
    edge: 'rgba(255,220,150,0.30)',
    glow: '0 18px 44px rgba(224,168,69,0.44)',
    chipBg: 'rgba(224,168,69,0.24)',
    chipFg: '#F7E4C0',
    chipBorder: 'rgba(224,168,69,0.8)',
    holo: false,
    aura: false,
    shine: true,
  },
  supercar: {
    label: 'ULTRA RARE',
    frame:
      'linear-gradient(145deg, #6d28a8, #b06be6 40%, #e05aa0 70%, #4a1d78)',
    edge: 'rgba(240,200,255,0.40)',
    glow: '0 18px 48px rgba(170,90,220,0.52)',
    chipBg: 'rgba(170,90,220,0.30)',
    chipFg: '#F0E0FF',
    chipBorder: 'rgba(200,130,240,0.85)',
    holo: true,
    aura: false,
    shine: true,
  },
  hypercar: {
    label: 'LÉGENDAIRE',
    frame:
      'linear-gradient(145deg, #E0B341, #FFF6C8 30%, #FFD700 50%, #E8203A 78%, #B8860B)',
    edge: 'rgba(255,240,190,0.6)',
    glow: '0 20px 60px rgba(255,190,60,0.6)',
    chipBg: 'linear-gradient(120deg,#E0B341,#FFD700 45%,#E8203A)',
    chipFg: '#1a1306',
    chipBorder: 'rgba(255,215,0,0.9)',
    holo: true,
    aura: true,
    shine: true,
  },
}

export default function CollectorCardV2({
  photo,
  brand,
  model,
  year,
  category,
  rarity,
  serial,
  serialTotal,
  stats,
  reveal = false,
  width = 300,
}: {
  photo: string
  brand: string
  model: string
  year: number | null
  category: string
  rarity: Rarity
  serial: number
  serialTotal: number
  stats?: CardStats
  reveal?: boolean
  width?: number
}) {
  const look = RARITY_FRAME[rarity] ?? RARITY_FRAME.standard
  const rootRef = useRef<HTMLDivElement>(null)
  const [flipped, setFlipped] = useState(false)

  // Holo tilt → drive --hx/--hy (-0.5..0.5) on the root. Pointer works
  // everywhere (desktop + touch-drag); DeviceOrientation adds the real
  // gyroscope tilt on phones that grant it.
  useEffect(() => {
    if (!look.holo) return
    const el = rootRef.current
    if (!el) return
    const set = (hx: number, hy: number) => {
      el.style.setProperty('--hx', hx.toFixed(3))
      el.style.setProperty('--hy', hy.toFixed(3))
    }
    const onPointer = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      set((e.clientX - r.left) / r.width - 0.5, (e.clientY - r.top) / r.height - 0.5)
    }
    const onOrient = (e: DeviceOrientationEvent) => {
      const g = Math.max(-45, Math.min(45, e.gamma ?? 0)) / 45 // left-right
      const b = Math.max(-45, Math.min(45, (e.beta ?? 0) - 45)) / 45 // front-back
      set(g * 0.5, b * 0.5)
    }
    el.addEventListener('pointermove', onPointer)
    window.addEventListener('deviceorientation', onOrient)
    return () => {
      el.removeEventListener('pointermove', onPointer)
      window.removeEventListener('deviceorientation', onOrient)
    }
  }, [look.holo])

  const catLabel = category && category !== 'other' ? category.toUpperCase() : ''

  return (
    <div
      ref={rootRef}
      className="cv2-root"
      style={
        {
          '--cv-w': `${width}px`,
          '--cv-float': '5px',
          '--cv-holo': '0.9',
          '--cv-shine-dur': '5.5s',
          '--frame': look.frame,
          '--edge': look.edge,
          '--glow': look.glow,
          width: 'var(--cv-w)',
          perspective: '1100px',
          animation: reveal ? 'cardv2-reveal 0.9s cubic-bezier(0.22,1,0.36,1) both' : undefined,
        } as React.CSSProperties
      }
    >
      {/* Idle float wrapper — the card "breathes". */}
      <div
        className="cv2-float"
        style={{
          animation: 'cardv2-float 6s ease-in-out infinite',
          willChange: 'transform',
          transformStyle: 'preserve-3d',
        }}
      >
        {/* Legendary aura. */}
        {look.aura && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: '-10%',
              borderRadius: '28px',
              background:
                'radial-gradient(closest-side, rgba(255,190,60,0.5), rgba(232,32,58,0.18) 60%, transparent 72%)',
              filter: 'blur(14px)',
              animation: 'cardv2-aura 3.4s ease-in-out infinite',
              zIndex: 0,
              pointerEvents: 'none',
            }}
          />
        )}

        <button
          onClick={() => setFlipped((f) => !f)}
          className="cv2-flip"
          aria-label={`${brand} ${model}`}
          style={{
            position: 'relative',
            zIndex: 1,
            display: 'block',
            width: '100%',
            aspectRatio: '3 / 4.2',
            border: 'none',
            background: 'transparent',
            padding: 0,
            cursor: 'pointer',
            transformStyle: 'preserve-3d',
            transition: 'transform 0.65s cubic-bezier(0.22,1,0.36,1)',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* ── FRONT ── */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              borderRadius: '20px',
              padding: '3px', // frame thickness
              background: 'var(--frame)',
              boxShadow: 'var(--glow)',
            }}
          >
            {/* Inner card surface. */}
            <div
              style={{
                position: 'relative',
                height: '100%',
                borderRadius: '17px',
                overflow: 'hidden',
                background: '#0e0e11',
                boxShadow: 'inset 0 0 0 1px var(--edge)',
              }}
            >
              {/* Photo */}
              <img
                src={photo}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center 42%',
                }}
              />
              {/* Bottom gradient for text legibility */}
              <div
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  background:
                    'linear-gradient(to top, rgba(6,6,8,0.96) 0%, rgba(6,6,8,0.55) 34%, transparent 56%), linear-gradient(to bottom, rgba(6,6,8,0.5) 0%, transparent 22%)',
                }}
              />

              {/* Holo sheen (Ultra Rare + Legendary) */}
              {look.holo && (
                <div
                  aria-hidden
                  className="cv2-holo"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    mixBlendMode: 'color-dodge',
                    opacity: 'var(--cv-holo)',
                    backgroundImage:
                      'repeating-linear-gradient(115deg, rgba(255,0,120,0.28) 0%, rgba(0,220,255,0.28) 12%, rgba(180,80,255,0.28) 24%, rgba(255,220,0,0.28) 36%, rgba(255,0,120,0.28) 48%), radial-gradient(60% 55% at calc(50% + var(--hx,0)*80%) calc(42% + var(--hy,0)*80%), rgba(255,255,255,0.55), transparent 60%)',
                    backgroundSize: '260% 260%, 100% 100%',
                    backgroundPosition:
                      'calc(50% + var(--hx,0) * 140%) calc(50% + var(--hy,0) * 140%), 0 0',
                    animation:
                      'cardv2-holo-drift 7s linear infinite alternate',
                    pointerEvents: 'none',
                  }}
                />
              )}

              {/* Looping shine on rare+ */}
              {look.shine && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    top: '-30%',
                    bottom: '-30%',
                    left: 0,
                    width: '32%',
                    background:
                      'linear-gradient(90deg, transparent, rgba(255,255,255,0.22), transparent)',
                    animation: `cardv2-shine var(--cv-shine-dur) ease-in-out infinite`,
                    pointerEvents: 'none',
                  }}
                />
              )}

              {/* Top row: rarity chip + serial */}
              <div
                style={{
                  position: 'absolute',
                  inset: '10px 10px auto 10px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span
                  style={{
                    padding: '4px 9px',
                    borderRadius: 9,
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    color: look.chipFg,
                    background: look.chipBg,
                    border: `1px solid ${look.chipBorder}`,
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                  }}
                >
                  {look.label}
                </span>
                <span
                  style={{
                    padding: '4px 8px',
                    borderRadius: 9,
                    fontSize: 10,
                    fontWeight: 800,
                    fontVariantNumeric: 'tabular-nums',
                    color: '#fff',
                    background: 'rgba(0,0,0,0.45)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    backdropFilter: 'blur(6px)',
                    WebkitBackdropFilter: 'blur(6px)',
                  }}
                >
                  #{String(serial).padStart(3, '0')}/{serialTotal}
                </span>
              </div>

              {/* Bottom block: name, category, REVS, stats */}
              <div
                style={{
                  position: 'absolute',
                  inset: 'auto 12px 12px 12px',
                  color: '#fff',
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    color: 'rgba(255,255,255,0.62)',
                  }}
                >
                  {brand.toUpperCase()}
                  {year ? ` · ${year}` : ''}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-display, inherit)',
                    fontSize: 20,
                    fontWeight: 800,
                    lineHeight: 1.05,
                    letterSpacing: '-0.02em',
                    marginTop: 1,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {model}
                </div>

                {/* FUT-style stats row */}
                <div
                  style={{
                    marginTop: 9,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 6,
                  }}
                >
                  {(
                    [
                      ['PWR', stats?.power],
                      ['0-100', stats?.accel],
                      ['VMAX', stats?.vmax],
                      ['CPL', stats?.torque],
                    ] as [string, string | undefined][]
                  ).map(([k, v]) => (
                    <div
                      key={k}
                      style={{
                        borderRadius: 8,
                        padding: '5px 2px 4px',
                        textAlign: 'center',
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.10)',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 900,
                          lineHeight: 1,
                          fontVariantNumeric: 'tabular-nums',
                          color: '#fff',
                        }}
                      >
                        {v ?? '—'}
                      </div>
                      <div
                        style={{
                          fontSize: 8,
                          fontWeight: 800,
                          letterSpacing: '0.08em',
                          color: '#E8203A',
                          marginTop: 2,
                        }}
                      >
                        {k}
                      </div>
                    </div>
                  ))}
                </div>

                {/* REVS wordmark + category */}
                <div
                  style={{
                    marginTop: 9,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-display, inherit)',
                      fontWeight: 900,
                      fontSize: 13,
                      letterSpacing: '-0.03em',
                    }}
                  >
                    <span style={{ color: '#E8203A' }}>R</span>
                    <span style={{ color: '#fff' }}>EVS</span>
                  </span>
                  {catLabel && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        letterSpacing: '0.1em',
                        color: 'rgba(255,255,255,0.5)',
                      }}
                    >
                      {catLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ── BACK (simple for the preview) ── */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
              borderRadius: '20px',
              padding: '3px',
              background: 'var(--frame)',
              boxShadow: 'var(--glow)',
            }}
          >
            <div
              style={{
                height: '100%',
                borderRadius: '17px',
                background: '#0e0e11',
                boxShadow: 'inset 0 0 0 1px var(--edge)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255,255,255,0.5)',
                fontSize: 12,
                padding: 16,
                textAlign: 'center',
              }}
            >
              Dos de carte — specs détaillées (à finaliser après validation
              de la direction).
            </div>
          </div>
        </button>
      </div>
    </div>
  )
}
