import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Loader2, Share2, X } from 'lucide-react'
import type { Rarity } from '../lib/spots'
import { myPseudo } from '../lib/push'
import { fetchMyReferralStats } from '../lib/referrals'
import { renderShareCard, type ShareStats } from '../lib/shareCardImage'

const CHANNEL = 'revs:share-card'
const APP_HOST = 'revs-ten.vercel.app'

export type ShareCardInput = {
  photoUrl: string | null
  brand: string
  model: string
  year: number | null
  rarity: Rarity
  serial?: number
  serialTotal?: number
  firstOnRevs?: boolean
  stats?: ShareStats
  /** Optional headline shown above the preview (wow-moment auto-shares). */
  autoMessage?: string
}

/** Open the share sheet for a collector card from anywhere (the card's
 *  Partager button, a legendary reveal, a level-up). */
export function openShareCard(input: ShareCardInput) {
  window.dispatchEvent(new CustomEvent<ShareCardInput>(CHANNEL, { detail: input }))
}

type Resolved = ShareCardInput & { refCode: string; pseudo: string }
type Phase = 'generating' | 'ready' | 'error'

export default function ShareCardSheet() {
  const [data, setData] = useState<Resolved | null>(null)
  const [phase, setPhase] = useState<Phase>('generating')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [autoMessage, setAutoMessage] = useState<string | undefined>(undefined)
  const fileRef = useRef<File | null>(null)

  // Listen for openShareCard() — resolve pseudo + referral code, then render.
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

  // Render the 1080×1920 story on a canvas (deterministic, no tainting).
  useEffect(() => {
    if (!data) return
    let alive = true
    setPhase('generating')
    ;(async () => {
      try {
        const refUrl = `${APP_HOST}?ref=${encodeURIComponent(data.refCode || data.pseudo)}`
        const blob = await renderShareCard({
          photoUrl: data.photoUrl,
          brand: data.brand,
          model: data.model,
          year: data.year,
          rarity: data.rarity,
          serial: data.serial,
          serialTotal: data.serialTotal,
          firstOnRevs: data.firstOnRevs,
          stats: data.stats,
          refUrl,
        })
        if (!alive) return
        fileRef.current = new File([blob], 'revs-card.png', { type: 'image/png' })
        setPreviewUrl(URL.createObjectURL(blob))
        setPhase('ready')
      } catch (err) {
        console.error('[share] image generation failed:', err)
        if (alive) setPhase('error')
      }
    })()
    return () => {
      alive = false
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
    const code = (data?.refCode || data?.pseudo || '').trim()
    // Clickable referral link that rides along with the image. NOTE: when the
    // app ships, swap APP_HOST for the smart/store link (App Store + Play
    // Store) — only this line changes.
    const shareUrl = `https://${APP_HOST}/${code ? `?ref=${encodeURIComponent(code)}` : ''}`
    // The link goes in `text`: it's the field messaging apps (WhatsApp,
    // Messages, Telegram, Snapchat chat…) reliably keep and render as a
    // tappable link alongside the shared image.
    const title = `Ma carte ${carName} · REVS`
    const text = `J'ai spotté une ${carName} sur REVS 🏎️\nRejoins-moi et commence ta collection 👉 ${shareUrl}`
    const nav = navigator as Navigator & {
      canShare?: (d?: { files?: File[]; text?: string; title?: string; url?: string }) => boolean
    }
    try {
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        // Image + link-in-text (most reliable across social/messaging apps).
        await nav.share({ files: [file], title, text })
      } else if (nav.share) {
        // No file sharing on this platform → at least share the clickable link.
        await nav.share({ title, text: `J'ai spotté une ${carName} sur REVS 🏎️`, url: shareUrl })
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
