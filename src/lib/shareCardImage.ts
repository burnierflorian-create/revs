// Renders the 1080×1920 story image for a collector card directly on a
// <canvas> — deterministic pixels, no html-to-image / foreignObject / tainted
// canvas fragility. The car photo is loaded with CORS; if it can't be loaded
// clean it degrades to a branded placeholder so the image is NEVER blank.

import type { Rarity } from './spots'

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
  stats?: ShareStats
  refUrl: string
}

type Tier = {
  c1: string // frame highlight
  c2: string // frame deep
  glow: string
  label: string
  chipFg: string
  star: string | null // star field colour for the rare tiers
}
const TIER: Record<Rarity, Tier> = {
  standard: { c1: '#6b6e74', c2: '#33363b', glow: 'rgba(150,153,158,0.30)', label: 'COMMUN', chipFg: '#E5E7EB', star: null },
  premium: { c1: '#3fa588', c2: '#1f5a4a', glow: 'rgba(45,180,140,0.42)', label: 'PEU COMMUN', chipFg: '#C9F5E6', star: null },
  performance: { c1: '#9fc3ee', c2: '#274a86', glow: 'rgba(80,150,255,0.48)', label: 'RARE', chipFg: '#DBEAFE', star: null },
  exclusif: { c1: '#E0A845', c2: '#8a5a20', glow: 'rgba(224,168,69,0.48)', label: 'ÉPIQUE', chipFg: '#F7E4C0', star: null },
  supercar: { c1: '#c07fe6', c2: '#6d28a8', glow: 'rgba(170,90,220,0.55)', label: 'ULTRA RARE', chipFg: '#F0E0FF', star: '#c68bf0' },
  hypercar: { c1: '#FFD700', c2: '#E8203A', glow: 'rgba(255,190,60,0.6)', label: 'LÉGENDAIRE', chipFg: '#1a1306', star: '#FFD54A' },
}

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
    // cache-bust safely: only add a param if the URL has none, to avoid
    // breaking signed URLs.
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

  // ── Background: dark with a red ambience ──
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0a0a0a')
  bg.addColorStop(1, '#140609')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)
  const glowTop = ctx.createRadialGradient(W / 2, 40, 0, W / 2, 40, 820)
  glowTop.addColorStop(0, 'rgba(232,32,58,0.20)')
  glowTop.addColorStop(1, 'rgba(232,32,58,0)')
  ctx.fillStyle = glowTop
  ctx.fillRect(0, 0, W, 900)
  const glowBottom = ctx.createRadialGradient(W * 0.85, H, 0, W * 0.85, H, 700)
  glowBottom.addColorStop(0, 'rgba(232,32,58,0.14)')
  glowBottom.addColorStop(1, 'rgba(232,32,58,0)')
  ctx.fillStyle = glowBottom
  ctx.fillRect(0, H - 900, W, 900)

  // Star field for rare tiers.
  if (t.star) {
    ctx.fillStyle = t.star
    for (let i = 0; i < 60; i++) {
      const x = ((i * 71) % 100) / 100 * W
      const y = ((i * 137) % 100) / 100 * H
      const s = 2 + (i % 4)
      ctx.globalAlpha = 0.2 + (i % 5) * 0.1
      ctx.beginPath()
      ctx.arc(x, y, s, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // ── Header: REVS + rarity chip ──
  ctx.textBaseline = 'alphabetic'
  ctx.font = `900 66px ${FONT}`
  ctx.fillStyle = RED
  ctx.fillText('R', 64, 150)
  const rw = ctx.measureText('R').width
  ctx.fillStyle = '#fff'
  ctx.fillText('EVS', 64 + rw, 150)

  ctx.font = `800 30px ${FONT}`
  const chipW = ctx.measureText(t.label).width + 52
  const chipX = W - 64 - chipW
  if (d.rarity === 'hypercar') {
    const g = ctx.createLinearGradient(chipX, 0, chipX + chipW, 0)
    g.addColorStop(0, '#E0B341')
    g.addColorStop(0.5, '#FFD700')
    g.addColorStop(1, '#E8203A')
    ctx.fillStyle = g
  } else {
    ctx.fillStyle = t.c2
  }
  roundRect(ctx, chipX, 108, chipW, 56, 28)
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = t.c1
  roundRect(ctx, chipX, 108, chipW, 56, 28)
  ctx.stroke()
  ctx.fillStyle = t.chipFg
  ctx.textAlign = 'center'
  ctx.fillText(t.label, chipX + chipW / 2, 147)
  ctx.textAlign = 'left'

  // ── The card (faithful front), tilted -3° ──
  const CW = 720
  const CH = Math.round(CW * (4.2 / 3)) // 1008
  const cx = W / 2
  const cy = 470 + CH / 2
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate((-3 * Math.PI) / 180)
  ctx.translate(-CW / 2, -CH / 2)

  // Outer glow
  ctx.save()
  ctx.shadowColor = t.glow
  ctx.shadowBlur = 90
  ctx.shadowOffsetY = 30
  ctx.fillStyle = '#000'
  roundRect(ctx, 0, 0, CW, CH, 34)
  ctx.fill()
  ctx.restore()

  // Frame (gradient border)
  const fr = ctx.createLinearGradient(0, 0, CW, CH)
  fr.addColorStop(0, t.c2)
  fr.addColorStop(0.45, t.c1)
  fr.addColorStop(1, t.c2)
  ctx.fillStyle = fr
  roundRect(ctx, 0, 0, CW, CH, 34)
  ctx.fill()

  // Inner (photo)
  const pad = 8
  const iw = CW - pad * 2
  const ih = CH - pad * 2
  ctx.save()
  roundRect(ctx, pad, pad, iw, ih, 28)
  ctx.clip()
  ctx.fillStyle = '#0e0e11'
  ctx.fillRect(pad, pad, iw, ih)
  const img = d.photoUrl ? await loadImage(d.photoUrl) : null
  if (img) {
    drawCover(ctx, img, pad, pad, iw, ih)
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    ctx.textAlign = 'center'
    ctx.font = `900 260px ${FONT}`
    ctx.fillText((d.brand || 'R').charAt(0).toUpperCase(), pad + iw / 2, pad + ih / 2 + 90)
    ctx.textAlign = 'left'
  }
  // Bottom scrim so text always reads
  const scrim = ctx.createLinearGradient(0, pad + ih - ih * 0.5, 0, pad + ih)
  scrim.addColorStop(0, 'rgba(6,6,8,0)')
  scrim.addColorStop(0.55, 'rgba(6,6,8,0.72)')
  scrim.addColorStop(1, 'rgba(6,6,8,0.97)')
  ctx.fillStyle = scrim
  ctx.fillRect(pad, pad + ih - ih * 0.5, iw, ih * 0.5)
  ctx.restore()

  // Top row on the card: serial (right)
  if (d.serial != null && d.serialTotal != null) {
    ctx.font = `800 26px ${FONT}`
    const serial = `#${String(d.serial).padStart(3, '0')}/${d.serialTotal}`
    const sw = ctx.measureText(serial).width + 30
    ctx.fillStyle = 'rgba(0,0,0,0.5)'
    roundRect(ctx, CW - pad - 16 - sw, pad + 16, sw, 46, 12)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.fillText(serial, CW - pad - 16 - sw / 2, pad + 46)
    ctx.textAlign = 'left'
  }
  if (d.firstOnRevs) {
    ctx.font = `900 22px ${FONT}`
    const label = '1ᵉʳ SUR REVS'
    const bw = ctx.measureText(label).width + 40
    const g = ctx.createLinearGradient(pad + 16, 0, pad + 16 + bw, 0)
    g.addColorStop(0, '#FFD700')
    g.addColorStop(1, '#E8203A')
    ctx.fillStyle = g
    roundRect(ctx, pad + 16, pad + 16, bw, 40, 10)
    ctx.fill()
    ctx.fillStyle = '#0a0a0a'
    ctx.textAlign = 'center'
    ctx.fillText(label, pad + 16 + bw / 2, pad + 44)
    ctx.textAlign = 'left'
  }

  // Bottom block: brand·year, model, stats
  const bx = pad + 26
  let by = pad + ih - 210
  ctx.fillStyle = 'rgba(255,255,255,0.66)'
  ctx.font = `700 26px ${FONT}`
  ctx.fillText(`${(d.brand || '').toUpperCase()}${d.year ? ` · ${d.year}` : ''}`, bx, by)
  by += 52
  const modelSize = fitText(ctx, d.model || d.brand || 'Voiture', iw - 52, 52)
  ctx.fillStyle = '#fff'
  ctx.font = `900 ${modelSize}px ${FONT}`
  ctx.fillText(d.model || d.brand || 'Voiture', bx, by)

  // Stats row (4 cells)
  const cells: [string, string][] = [
    ['PWR', d.stats?.power || '—'],
    ['0-100', d.stats?.accel || '—'],
    ['VMAX', d.stats?.vmax || '—'],
    ['CPL', d.stats?.torque || '—'],
  ]
  const gap = 12
  const cellW = (iw - 52 - gap * 3) / 4
  const cellY = pad + ih - 118
  const cellH = 78
  cells.forEach(([k, v], i) => {
    const x = bx + i * (cellW + gap)
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    roundRect(ctx, x, cellY, cellW, cellH, 12)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    const vs = fitText(ctx, v, cellW - 8, 30, 900)
    ctx.font = `900 ${vs}px ${FONT}`
    ctx.fillText(v, x + cellW / 2, cellY + 42)
    ctx.fillStyle = RED
    ctx.font = `800 17px ${FONT}`
    ctx.fillText(k, x + cellW / 2, cellY + 66)
    ctx.textAlign = 'left'
  })
  ctx.restore()

  // ── Footer: spotted-on-REVS + referral ──
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.font = `700 30px ${FONT}`
  ctx.fillText('Spotté sur REVS', W / 2, H - 168)
  ctx.font = `900 40px ${FONT}`
  ctx.fillStyle = '#fff'
  ctx.fillText('Télécharge REVS et spotte tes voitures', W / 2, H - 112)
  ctx.font = `700 30px ${FONT}`
  ctx.fillStyle = RED
  ctx.fillText(d.refUrl, W / 2, H - 64)
  ctx.textAlign = 'left'

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob null'))), 'image/png')
  })
}
