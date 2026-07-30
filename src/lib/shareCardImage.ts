// Renders the 1080×1920 story image for a collector card directly on a
// <canvas> — deterministic pixels, no html-to-image / foreignObject / tainted
// canvas fragility. The car photo is loaded with CORS; if it can't be loaded
// clean it degrades to a branded placeholder so the image is NEVER blank.
//
// The card here mirrors CollectorCardV2 as shipped: holo (rainbow) border for
// the top tiers, tier-coloured frame otherwise, rarity badge top-left, serial
// top-right, "1er sur REVS" badge, brand·year + model at the bottom. No stats.

import type { Rarity } from './spots'
import { cardBadge } from './cardLevels'

export type ShareStats = { power?: string; accel?: string; vmax?: string; torque?: string }
export type ShareCardData = {
  photoUrl: string | null
  brand: string
  model: string
  year: number | null
  rarity: Rarity
  serial?: number
  serialTotal?: number
  firstOnRevs?: boolean
  /** Card evolution — a mastery badge + "spotté ×N" when level ≥ 2 / count > 1. */
  level?: number
  count?: number
  stats?: ShareStats // kept for callers; no longer drawn on the share visual
  refUrl: string
}

type Tier = {
  frame: [string, string, string] // border gradient stops (non-holo tiers)
  holo: boolean // top tiers → rainbow border, matching the app
  glow: string // outer aura colour, per rarity
  label: string
  chipBg: string
  chipFg: string
  chipBorder: string
  chipGradient?: [string, string, string]
  star: string | null // star-field colour for the rare tiers
}
const TIER: Record<Rarity, Tier> = {
  standard: {
    frame: ['#3a3d42', '#6b6e74', '#26282c'],
    holo: false,
    glow: 'rgba(150,153,158,0.30)',
    label: 'COMMUN',
    chipBg: 'rgba(150,153,158,0.30)',
    chipFg: '#E5E7EB',
    chipBorder: 'rgba(200,203,208,0.45)',
    star: null,
  },
  premium: {
    frame: ['#1f5a4a', '#3fa588', '#123a30'],
    holo: false,
    glow: 'rgba(45,180,140,0.42)',
    label: 'PEU COMMUN',
    chipBg: 'rgba(45,180,140,0.32)',
    chipFg: '#C9F5E6',
    chipBorder: 'rgba(63,165,136,0.7)',
    star: null,
  },
  performance: {
    frame: ['#274a86', '#9fc3ee', '#16294d'],
    holo: false,
    glow: 'rgba(80,150,255,0.48)',
    label: 'RARE',
    chipBg: 'rgba(80,150,255,0.32)',
    chipFg: '#DBEAFE',
    chipBorder: 'rgba(120,180,255,0.8)',
    star: null,
  },
  exclusif: {
    frame: ['#8a5a20', '#E0A845', '#5c3a12'],
    holo: false,
    glow: 'rgba(224,168,69,0.48)',
    label: 'ÉPIQUE',
    chipBg: 'rgba(224,168,69,0.32)',
    chipFg: '#F7E4C0',
    chipBorder: 'rgba(224,168,69,0.85)',
    star: null,
  },
  supercar: {
    frame: ['#6d28a8', '#b06be6', '#4a1d78'],
    holo: true,
    glow: 'rgba(170,90,220,0.55)',
    label: 'ULTRA RARE',
    chipBg: 'rgba(170,90,220,0.38)',
    chipFg: '#F0E0FF',
    chipBorder: 'rgba(200,130,240,0.9)',
    star: '#c68bf0',
  },
  hypercar: {
    frame: ['#FFD700', '#FFF6C8', '#E8203A'],
    holo: true,
    glow: 'rgba(255,190,60,0.6)',
    label: 'LÉGENDAIRE',
    chipBg: 'rgba(255,215,0,0.30)',
    chipFg: '#1a1306',
    chipBorder: 'rgba(255,215,0,0.95)',
    chipGradient: ['#E0B341', '#FFD700', '#E8203A'],
    star: '#FFD54A',
  },
}

// The card's own holo border — the same rainbow the app paints, ~115°.
const HOLO_STOPS: [number, string][] = [
  [0.0, '#ff0096'],
  [0.16, '#00e1ff'],
  [0.32, '#b45aff'],
  [0.5, '#ffe646'],
  [0.66, '#00e1ff'],
  [0.82, '#b45aff'],
  [1.0, '#ff0096'],
]

const RED = '#E8203A'
const FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif"

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function loadImage(url: string, timeoutMs = 8000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    let done = false
    const finish = (v: HTMLImageElement | null) => {
      if (done) return
      done = true
      resolve(v)
    }
    img.onload = () => finish(img)
    img.onerror = () => finish(null)
    window.setTimeout(() => finish(null), timeoutMs)
    img.src = url
  })
}

// object-fit: cover into (dx,dy,dw,dh).
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, dx: number, dy: number, dw: number, dh: number, focusY = 0.42) {
  const ir = img.width / img.height
  const dr = dw / dh
  let sw: number, sh: number, sx: number, sy: number
  if (ir > dr) {
    sh = img.height
    sw = sh * dr
    sx = (img.width - sw) / 2
    sy = 0
  } else {
    sw = img.width
    sh = sw / dr
    sx = 0
    sy = (img.height - sh) * focusY
  }
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

function fitText(ctx: CanvasRenderingContext2D, text: string, max: number, start: number, weight = 900) {
  let size = start
  do {
    ctx.font = `${weight} ${size}px ${FONT}`
    if (ctx.measureText(text).width <= max) break
    size -= 4
  } while (size > 24)
  return size
}

export async function renderShareCard(d: ShareCardData): Promise<Blob> {
  const W = 1080
  const H = 1920
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')
  const t = TIER[d.rarity] ?? TIER.standard

  // ── Background: dark with a subtle red ambience ──
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0a0a0a')
  bg.addColorStop(1, '#120508')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const glowTop = ctx.createRadialGradient(W / 2, 120, 0, W / 2, 120, 860)
  glowTop.addColorStop(0, 'rgba(232,32,58,0.16)')
  glowTop.addColorStop(1, 'rgba(232,32,58,0)')
  ctx.fillStyle = glowTop
  ctx.fillRect(0, 0, W, 980)
  const glowBottom = ctx.createRadialGradient(W * 0.5, H - 220, 0, W * 0.5, H - 220, 760)
  glowBottom.addColorStop(0, 'rgba(232,32,58,0.14)')
  glowBottom.addColorStop(1, 'rgba(232,32,58,0)')
  ctx.fillStyle = glowBottom
  ctx.fillRect(0, H - 980, W, 980)

  // Star / particle field (kept — it's pretty). Denser + tinted for rare tiers.
  const starColor = t.star ?? 'rgba(255,255,255,0.9)'
  const starN = t.star ? 70 : 44
  ctx.fillStyle = starColor
  for (let i = 0; i < starN; i++) {
    const x = (((i * 71) % 100) / 100) * W
    const y = (((i * 137) % 100) / 100) * H
    const s = 1.5 + (i % 4)
    ctx.globalAlpha = (t.star ? 0.18 : 0.1) + (i % 5) * 0.08
    ctx.beginPath()
    ctx.arc(x, y, s, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1

  // ── Header: clean REVS wordmark, centered ──
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'center'
  ctx.font = `900 68px ${FONT}`
  const rWidth = ctx.measureText('R').width
  const evsWidth = ctx.measureText('EVS').width
  const totalW = rWidth + evsWidth
  const startX = W / 2 - totalW / 2
  ctx.textAlign = 'left'
  ctx.fillStyle = RED
  ctx.fillText('R', startX, 168)
  ctx.fillStyle = '#fff'
  ctx.fillText('EVS', startX + rWidth, 168)

  // ── The card (faithful to the app), big & centered, slight -3° tilt ──
  const CW = 800
  const CH = Math.round(CW * (4.2 / 3)) // 1120
  const cx = W / 2
  const cy = 300 + CH / 2
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((-3 * Math.PI) / 180)
  ctx.translate(-CW / 2, -CH / 2)

  const OUT_R = 40
  const IN_R = 30
  const pad = 12

  // Outer glow (per-rarity) — no extra frame, just the card's own bloom.
  ctx.save()
  ctx.shadowColor = t.glow
  ctx.shadowBlur = 110
  ctx.shadowOffsetY = 24
  ctx.fillStyle = '#000'
  roundRect(ctx, 0, 0, CW, CH, OUT_R)
  ctx.fill()
  ctx.restore()

  // Border: rainbow holo for top tiers, tier gradient otherwise.
  if (t.holo) {
    const g = ctx.createLinearGradient(0, CH * 0.12, CW, CH * 0.62)
    for (const [stop, col] of HOLO_STOPS) g.addColorStop(stop, col)
    ctx.fillStyle = g
  } else {
    const fr = ctx.createLinearGradient(0, 0, CW, CH)
    fr.addColorStop(0, t.frame[0])
    fr.addColorStop(0.45, t.frame[1])
    fr.addColorStop(1, t.frame[2])
    ctx.fillStyle = fr
  }
  roundRect(ctx, 0, 0, CW, CH, OUT_R)
  ctx.fill()

  // Inner (photo)
  const iw = CW - pad * 2
  const ih = CH - pad * 2
  ctx.save()
  roundRect(ctx, pad, pad, iw, ih, IN_R)
  ctx.clip()
  ctx.fillStyle = '#0e0e11'
  ctx.fillRect(pad, pad, iw, ih)
  const img = d.photoUrl ? await loadImage(d.photoUrl) : null
  if (img) {
    drawCover(ctx, img, pad, pad, iw, ih)
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.textAlign = 'center'
    ctx.font = `900 280px ${FONT}`
    ctx.fillText((d.brand || 'R').charAt(0).toUpperCase(), pad + iw / 2, pad + ih / 2 + 96)
    ctx.textAlign = 'left'
  }
  // Bottom scrim so text always reads
  const scrim = ctx.createLinearGradient(0, pad + ih - ih * 0.46, 0, pad + ih)
  scrim.addColorStop(0, 'rgba(5,5,7,0)')
  scrim.addColorStop(0.5, 'rgba(5,5,7,0.72)')
  scrim.addColorStop(1, 'rgba(5,5,7,0.98)')
  ctx.fillStyle = scrim
  ctx.fillRect(pad, pad + ih - ih * 0.46, iw, ih * 0.46)
  ctx.restore()

  // Rarity badge — top-left, on the photo.
  ctx.font = `800 27px ${FONT}`
  const chipPadX = 22
  const chipH = 52
  const chipW = ctx.measureText(t.label).width + chipPadX * 2
  const chipX = pad + 22
  const chipY = pad + 22
  if (t.chipGradient) {
    const cg = ctx.createLinearGradient(chipX, 0, chipX + chipW, 0)
    cg.addColorStop(0, t.chipGradient[0])
    cg.addColorStop(0.5, t.chipGradient[1])
    cg.addColorStop(1, t.chipGradient[2])
    ctx.fillStyle = cg
  } else {
    ctx.fillStyle = t.chipBg
  }
  roundRect(ctx, chipX, chipY, chipW, chipH, 14)
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = t.chipBorder
  roundRect(ctx, chipX, chipY, chipW, chipH, 14)
  ctx.stroke()
  ctx.fillStyle = t.chipFg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(t.label, chipX + chipW / 2, chipY + chipH / 2 + 1)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // Serial — top-right.
  if (d.serial != null && d.serialTotal != null) {
    ctx.font = `800 27px ${FONT}`
    const serial = `#${String(d.serial).padStart(3, '0')}/${d.serialTotal}`
    const sw = ctx.measureText(serial).width + 34
    const sx = CW - pad - 22 - sw
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    roundRect(ctx, sx, chipY, sw, chipH, 14)
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'
    roundRect(ctx, sx, chipY, sw, chipH, 14)
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(serial, sx + sw / 2, chipY + chipH / 2 + 1)
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
  }

  // "1er sur REVS" — just under the rarity badge.
  if (d.firstOnRevs) {
    ctx.font = `900 23px ${FONT}`
    const label = '1ᵉʳ SUR REVS'
    const bw = ctx.measureText(label).width + 40
    const byy = chipY + chipH + 12
    const g = ctx.createLinearGradient(chipX, 0, chipX + bw, 0)
    g.addColorStop(0, '#FFD700')
    g.addColorStop(1, '#E8203A')
    ctx.fillStyle = g
    roundRect(ctx, chipX, byy, bw, 44, 12)
    ctx.fill()
    ctx.fillStyle = '#0a0a0a'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, chipX + bw / 2, byy + 23)
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
  }

  // Evolution row — mastery badge (level ≥ 2) + "spotté ×N", above the name.
  const lvl = d.level ?? 1
  const badge = cardBadge(lvl)
  if (badge || (d.count ?? 1) > 1) {
    const ey = pad + ih - 208
    let ex = pad + 34
    if (badge) {
      ctx.font = `900 24px ${FONT}`
      const lbl = `NV${lvl} · ${badge.toUpperCase()}`
      const w = ctx.measureText(lbl).width + 36
      let fill: string | CanvasGradient = '#c9d8ef'
      let fg = '#0c0c0f'
      if (lvl === 3) fill = '#7fd0ff'
      else if (lvl === 4) {
        fill = '#c98bf0'
        fg = '#1a0a26'
      } else if (lvl >= 5) {
        const gg = ctx.createLinearGradient(ex, 0, ex + w, 0)
        gg.addColorStop(0, '#E0B341')
        gg.addColorStop(0.45, '#FFD700')
        gg.addColorStop(1, '#E8203A')
        fill = gg
        fg = '#1a1306'
      }
      ctx.fillStyle = fill
      roundRect(ctx, ex, ey, w, 44, 12)
      ctx.fill()
      ctx.fillStyle = fg
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(lbl, ex + 18, ey + 23)
      ex += w + 12
    }
    if ((d.count ?? 1) > 1) {
      ctx.font = `800 24px ${FONT}`
      ctx.fillStyle = 'rgba(255,255,255,0.82)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(`SPOTTÉ ×${d.count}`, ex, ey + 23)
    }
    ctx.textBaseline = 'alphabetic'
  }

  // Bottom block: brand·year + model. No stats.
  const bx = pad + 34
  let by = pad + ih - 118
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.font = `700 30px ${FONT}`
  ctx.fillText(`${(d.brand || '').toUpperCase()}${d.year ? ` · ${d.year}` : ''}`, bx, by)
  by += 66
  const modelSize = fitText(ctx, d.model || d.brand || 'Voiture', iw - 68, 62)
  ctx.fillStyle = '#fff'
  ctx.font = `900 ${modelSize}px ${FONT}`
  ctx.fillText(d.model || d.brand || 'Voiture', bx, by)

  ctx.restore() // end card transform

  // ── Footer CTA — strong, high-contrast, readable URL pill ──
  ctx.textAlign = 'center'

  // eyebrow
  ctx.fillStyle = RED
  ctx.font = `800 28px ${FONT}`
  ctx.fillText('S P O T T É   S U R   R E V S', W / 2, H - 268)

  // tagline (white, bold)
  ctx.fillStyle = '#fff'
  const tagline = 'Spotte. Collectionne. Deviens n°1.'
  const tagSize = fitText(ctx, tagline, W - 120, 56, 900)
  ctx.font = `900 ${tagSize}px ${FONT}`
  ctx.fillText(tagline, W / 2, H - 196)

  // URL pill (light background, dark text) — always legible.
  const urlText = d.refUrl.replace(/^https?:\/\//, '')
  ctx.font = `800 32px ${FONT}`
  const pillW = Math.min(W - 100, ctx.measureText(urlText).width + 72)
  const pillH = 74
  const pillX = W / 2 - pillW / 2
  const pillY = H - 150
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.4)'
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 8
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2)
  ctx.fill()
  ctx.restore()
  // little red dot as a "link" cue
  ctx.fillStyle = '#0a0a0a'
  ctx.textBaseline = 'middle'
  const uSize = fitText(ctx, urlText, pillW - 72, 32, 800)
  ctx.font = `800 ${uSize}px ${FONT}`
  ctx.fillText(urlText, W / 2, pillY + pillH / 2 + 1)
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'

  // JPEG @ 0.9 — the visual is a photo + gradients, so JPEG is far lighter
  // than PNG (~2.5 MB → typically 500–900 KB) with no visible loss. Lighter =
  // faster, more reliable native shares. Background is fully opaque so there's
  // no transparency to lose.
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob null'))), 'image/jpeg', 0.9)
  })
}
