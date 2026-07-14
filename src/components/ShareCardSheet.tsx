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
  /** Spot id — builds the /s/:id share link with an Open Graph preview. */
  id?: string
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
        fileRef.current = new File([blob], 'revs-card.jpg', { type: 'image/jpeg' })
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

  // Pure file download (desktop / Android / ultimate fallback).
  function blobDownload() {
    if (!previewUrl) return
    const a = document.createElement('a')
    a.href = previewUrl
    a.download = `revs-${(data?.model || data?.brand || 'card').replace(/\s+/g, '-').toLowerCase()}.jpg`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  // Save to the photo gallery. On iOS (and Android) the only reliable route to
  // the Photos gallery from the web is the native sheet's "Enregistrer l'image"
  // — a plain <a download> lands in Files, not Photos. So we share the file
  // ALONE (no link) so "Save Image" is front-and-centre; desktop / no-share
  // falls back to a direct file download.
  async function saveImage() {
    const file = fileRef.current
    const nav = navigator as Navigator & { canShare?: (d?: { files?: File[] }) => boolean }
    if (file && nav.canShare?.({ files: [file] }) && nav.share) {
      try {
        await nav.share({ files: [file] })
        return
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return // user cancelled
        // real failure → fall through to a direct download
      }
    }
    blobDownload()
  }

  async function shareImage() {
    const file = fileRef.current
    if (!file) return
    const carName = (data?.model || data?.brand || 'voiture').trim()
    const code = (data?.refCode || data?.pseudo || '').trim()
    // Per-card link → /s/:id renders an Open Graph preview so the recipient
    // sees the card AND can click through into REVS. Falls back to the home
    // link if the card has no id. NOTE: at launch, swap APP_HOST for the
    // smart/store link (App Store + Play Store) — only this line changes.
    const cardPath = data?.id ? `/s/${encodeURIComponent(data.id)}` : '/'
    const query = code ? `?ref=${encodeURIComponent(code)}` : ''
    const cardLink = `https://${APP_HOST}${cardPath}${query}`
    const title = `Ma carte ${carName} · REVS`
    const text = `J'ai spotté une ${carName} sur REVS 🏎️ Spotte les tiennes 👇`
    const nav = navigator as Navigator & {
      canShare?: (d?: { files?: File[]; text?: string; title?: string; url?: string }) => boolean
    }
    // No Web Share at all → download instead of an empty action.
    if (!nav.share) {
      blobDownload()
      return
    }
    try {
      if (nav.canShare?.({ files: [file] })) {
        // Image + clickable card link together (Messages / WhatsApp / Discord…).
        await nav.share({ files: [file], title, text, url: cardLink })
      } else {
        // No file sharing on this platform → at least share the clickable link.
        await nav.share({ title, text, url: cardLink })
      }
    } catch (err) {
      // AbortError = user tapped cancel → do nothing. Any real failure (share
      // sheet errored / target rejected the payload) → fall back to download
      // so the user is never left with an empty/black screen.
      if ((err as Error)?.name !== 'AbortError') blobDownload()
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

          {/* Actions — Download is primary (most reliable path to a story),
              Share is secondary. */}
          <div className="mt-5 flex flex-col gap-3">
            <button
              onClick={saveImage}
              disabled={phase !== 'ready'}
              className="tappable flex w-full items-center justify-center gap-2 rounded-full py-4 text-[15px] font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
              style={{ background: '#E8203A', boxShadow: '0 8px 22px rgba(232,32,58,0.4)' }}
            >
              <Download className="h-5 w-5" />
              Télécharger ma carte
            </button>
            <button
              onClick={shareImage}
              disabled={phase !== 'ready'}
              className="tappable flex w-full items-center justify-center gap-2 rounded-full py-3 text-sm font-bold disabled:opacity-40"
              style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.85)' }}
            >
              <Share2 className="h-[18px] w-[18px]" />
              Partager le lien
            </button>
            <p className="px-2 text-center text-[12.5px] leading-snug text-white/50">
              Télécharge ta carte puis ajoute-la à ta story Instagram ou Snap ✨
            </p>
          </div>
        </div>
      </div>
    </>,
    document.body,
  )
}
