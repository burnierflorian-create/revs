import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Loader2, Share2, X } from 'lucide-react'
import type { Rarity } from '../lib/spots'
import { myPseudo } from '../lib/push'
import { fetchMyReferralStats } from '../lib/referrals'

const CHANNEL = 'revs:share-card'
const APP_HOST = 'revs-ten.vercel.app'

export type ShareCardInput = {
  photoUrl: string | null
  brand: string
  model: string
  year: number | null
  rarity: Rarity
  /** Optional headline shown above the preview (wow-moment auto-shares). */
  autoMessage?: string
}

/** Open the share sheet for a collector card from anywhere (the card's
 *  Partager button, a legendary reveal, a level-up). */
export function openShareCard(input: ShareCardInput) {
  window.dispatchEvent(new CustomEvent<ShareCardInput>(CHANNEL, { detail: input }))
}

// 4-bucket rarity visual for the story image (grey / blue / violet / gold).
function storyRarity(r: Rarity): {
  label: string
  color: string
  glow: string
  particles: boolean
} {
  switch (r) {
    case 'hypercar':
      return { label: 'LÉGENDAIRE', color: '#FFD700', glow: 'rgba(255,215,0,0.55)', particles: true }
    case 'supercar':
    case 'exclusif':
      return { label: 'ULTRA RARE', color: '#9B59B6', glow: 'rgba(155,89,182,0.55)', particles: true }
    case 'performance':
    case 'premium':
      return { label: 'RARE', color: '#4A9EFF', glow: 'rgba(74,158,255,0.5)', particles: false }
    default:
      return { label: 'COMMUN', color: '#9aa0a6', glow: 'rgba(154,160,166,0.4)', particles: false }
  }
}

// Deterministic star field for legendary / ultra-rare backgrounds (no
// Math.random so the off-screen render stays stable).
const STARS = Array.from({ length: 46 }, (_, i) => ({
  left: ((i * 71) % 100) + (i % 3),
  top: ((i * 137) % 100),
  size: 2 + (i % 4),
  opacity: 0.25 + ((i % 5) * 0.12),
}))

type Resolved = ShareCardInput & { refCode: string; pseudo: string }

/** The 1080×1920 story design captured by html-to-image. Rendered
 *  off-screen (never visible to the user). */
function StoryCard({
  data,
  nodeRef,
}: {
  data: Resolved
  nodeRef: React.RefObject<HTMLDivElement | null>
}) {
  const sr = storyRarity(data.rarity)
  const carName = data.model?.trim() || data.brand?.trim() || 'Voiture'
  const refUrl = `${APP_HOST}?ref=${encodeURIComponent(data.refCode || data.pseudo)}`
  return (
    <div
      ref={nodeRef}
      style={{
        position: 'fixed',
        left: -99999,
        top: 0,
        width: 1080,
        height: 1920,
        background: 'linear-gradient(180deg, #0a0a0a 0%, #1a0a0a 100%)',
        overflow: 'hidden',
        fontFamily: 'Inter, system-ui, sans-serif',
        color: '#fff',
      }}
    >
      {/* Particle / star field for the rare tiers */}
      {sr.particles &&
        STARS.map((s, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              left: `${s.left}%`,
              top: `${s.top}%`,
              width: s.size,
              height: s.size,
              borderRadius: '50%',
              background: sr.color,
              opacity: s.opacity,
              boxShadow: `0 0 ${s.size * 3}px ${sr.color}`,
            }}
          />
        ))}

      {/* Header: REVS logo + rarity badge */}
      <div
        style={{
          position: 'absolute',
          top: 64,
          left: 64,
          right: 64,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontWeight: 900, fontSize: 64, letterSpacing: '-3px', color: '#fff' }}>
          REVS
        </span>
        <span
          style={{
            fontWeight: 800,
            fontSize: 30,
            letterSpacing: '2px',
            padding: '12px 24px',
            borderRadius: 999,
            color: data.rarity === 'hypercar' ? '#1a1306' : sr.color,
            background:
              data.rarity === 'hypercar'
                ? 'linear-gradient(120deg,#E0B341,#FFD700,#B8860B)'
                : `${sr.color}26`,
            border: `2px solid ${sr.color}`,
          }}
        >
          {sr.label}
        </span>
      </div>

      {/* Centered tilted photo with rarity frame + glow */}
      <div
        style={{
          position: 'absolute',
          top: 360,
          left: '50%',
          width: 820,
          height: 1025,
          transform: 'translateX(-50%) rotate(-3deg)',
          borderRadius: 28,
          overflow: 'hidden',
          border: `12px solid ${sr.color}`,
          boxShadow: `0 40px 90px rgba(0,0,0,0.7), 0 0 70px ${sr.glow}`,
          background: '#000',
        }}
      >
        {data.photoUrl ? (
          <img
            src={data.photoUrl}
            crossOrigin="anonymous"
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 200,
              fontWeight: 900,
              color: 'rgba(255,255,255,0.08)',
            }}
          >
            {data.brand?.charAt(0) || 'R'}
          </div>
        )}
      </div>

      {/* Car identity */}
      <div style={{ position: 'absolute', left: 64, right: 64, top: 1470, textAlign: 'center' }}>
        <div style={{ fontWeight: 900, fontSize: 64, lineHeight: 1.05, color: '#fff' }}>
          {carName}
        </div>
        <div style={{ marginTop: 10, fontWeight: 800, fontSize: 36, color: '#E8203A' }}>
          {data.brand?.trim()}
          {data.year ? <span style={{ color: '#9aa0a6', fontWeight: 600 }}> · {data.year}</span> : null}
        </div>
      </div>

      {/* Footer: branded referral link */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 72, textAlign: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 30, color: '#fff' }}>Télécharge REVS 🏎️</div>
        <div style={{ marginTop: 8, fontSize: 26, color: '#9aa0a6' }}>{refUrl}</div>
      </div>
    </div>
  )
}

type Phase = 'generating' | 'ready' | 'error'

export default function ShareCardSheet() {
  const [data, setData] = useState<Resolved | null>(null)
  const [phase, setPhase] = useState<Phase>('generating')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [autoMessage, setAutoMessage] = useState<string | undefined>(undefined)
  const fileRef = useRef<File | null>(null)
  const nodeRef = useRef<HTMLDivElement | null>(null)

  // Listen for openShareCard() — resolve pseudo + referral code, then mount
  // the off-screen design.
  useEffect(() => {
    const handler = (e: Event) => {
      const input = (e as CustomEvent<ShareCardInput>).detail
      setPhase('generating')
      setPreviewUrl(null)
      fileRef.current = null
      setAutoMessage(input.autoMessage)
      ;(async () => {
        const [pseudo, stats] = await Promise.all([
          myPseudo().catch(() => 'revs'),
          fetchMyReferralStats().catch(() => null),
        ])
        setData({ ...input, pseudo, refCode: stats?.invite_code ?? '' })
      })()
    }
    window.addEventListener(CHANNEL, handler)
    return () => window.removeEventListener(CHANNEL, handler)
  }, [])

  // Once the design node is mounted with data, capture it to a PNG.
  useEffect(() => {
    if (!data) return
    let alive = true
    const node = nodeRef.current
    if (!node) return
    // One frame so layout + the <img> settle before capture.
    const id = window.setTimeout(async () => {
      try {
        // Lazy-load html-to-image so it stays out of the initial bundle.
        const { toBlob } = await import('html-to-image')
        const blob = await toBlob(node, {
          width: 1080,
          height: 1920,
          pixelRatio: 1,
          cacheBust: true,
          backgroundColor: '#0a0a0a',
        })
        if (!alive) return
        if (!blob) throw new Error('toBlob returned null')
        fileRef.current = new File([blob], 'revs-card.png', { type: 'image/png' })
        setPreviewUrl(URL.createObjectURL(blob))
        setPhase('ready')
      } catch (err) {
        console.error('[share] image generation failed:', err)
        if (alive) setPhase('error')
      }
    }, 250)
    return () => {
      alive = false
      window.clearTimeout(id)
    }
  }, [data])

  // Revoke the preview object URL when it changes / unmounts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function close() {
    setData(null)
    setPreviewUrl(null)
    fileRef.current = null
  }

  function downloadImage() {
    if (!previewUrl) return
    const a = document.createElement('a')
    a.href = previewUrl
    a.download = `revs-${(data?.model || data?.brand || 'card').replace(/\s+/g, '-').toLowerCase()}.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function shareImage() {
    const file = fileRef.current
    if (!file) return
    const carName = (data?.model || data?.brand || 'voiture').trim()
    const nav = navigator as Navigator & {
      canShare?: (d?: { files?: File[] }) => boolean
    }
    try {
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({
          files: [file],
          title: `J'ai spotté une ${carName} sur REVS !`,
          text: 'Télécharge REVS et commence à spotter 🏎️',
        })
      } else {
        downloadImage()
      }
    } catch {
      /* user cancelled the share sheet — no-op */
    }
  }

  if (!data) return null

  return createPortal(
    <>
      {/* Off-screen design captured by html-to-image (never shown). */}
      <StoryCard data={data} nodeRef={nodeRef} />

      <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true">
        <button
          aria-label="Fermer"
          onClick={close}
          className="absolute inset-0"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }}
        />
        <div
          className="relative w-full max-w-md"
          style={{
            background: '#141414',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 20,
            paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
            animation: 'sheet-slide-up 280ms cubic-bezier(0.32,0.72,0,1) both',
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display font-bold text-white" style={{ fontSize: 18 }}>
              {autoMessage ?? 'Partager ta carte'}
            </h2>
            <button onClick={close} aria-label="Fermer" className="tappable text-white/50 hover:text-white">
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Preview (9:16) */}
          <div
            className="mx-auto overflow-hidden rounded-2xl"
            style={{ width: 200, aspectRatio: '9 / 16', background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            {phase === 'ready' && previewUrl ? (
              <img src={previewUrl} alt="Aperçu" className="h-full w-full object-cover" />
            ) : phase === 'error' ? (
              <div className="flex h-full w-full items-center justify-center px-4 text-center text-[13px] text-white/50">
                Impossible de générer l'image.
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-white/40" />
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={downloadImage}
              disabled={phase !== 'ready'}
              className="tappable flex flex-1 items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.08)', color: '#fff' }}
            >
              <Download className="h-[18px] w-[18px]" />
              Télécharger
            </button>
            <button
              onClick={shareImage}
              disabled={phase !== 'ready'}
              className="tappable flex flex-1 items-center justify-center gap-2 rounded-full py-3.5 text-sm font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
              style={{ background: '#E8203A' }}
            >
              <Share2 className="h-[18px] w-[18px]" />
              Partager
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
