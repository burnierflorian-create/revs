// ═══════ CRÉER UNE STORY ═══════
//
// Photo → aperçu → légende facultative → publier. Quatre étapes dans une seule
// feuille, parce qu'une story est un geste rapide : la découper en écrans
// successifs transformerait trente secondes en parcours.
//
// ── POURQUOI resizeImageToJpeg ET PAS LE FICHIER BRUT ──
// La même fonction prépare les photos de spots. Elle ramène l'image à
// 1280 px, la réencode en JPEG — et au passage, parce qu'un canvas ne
// transporte aucune métadonnée, elle efface les EXIF. Déposer le fichier
// original publierait la position GPS de la prise de vue avec l'image.

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Loader2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { resizeImageToJpeg } from '../../lib/spots'

const MAX_CAPTION = 120

export default function StoryComposer({
  open,
  onClose,
  onPublished,
}: {
  open: boolean
  onClose: () => void
  onPublished: () => void
}) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [caption, setCaption] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    if (preview) URL.revokeObjectURL(preview)
    setPreview(null)
    setBlob(null)
    setCaption('')
    setError(null)
    setBusy(false)
  }

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    try {
      const resized = await resizeImageToJpeg(file)
      setBlob(resized.blob)
      if (preview) URL.revokeObjectURL(preview)
      setPreview(URL.createObjectURL(resized.blob))
    } catch {
      setError(t('stories.readError'))
    }
  }

  async function publish() {
    if (!blob || busy) return
    setBusy(true)
    setError(null)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('auth')
      // Le premier segment du chemin est l'identifiant du propriétaire : c'est
      // lui que les policies de stockage vérifient (migration 0112).
      const path = `${user.id}/${Date.now()}.jpg`
      const { error: upErr } = await supabase.storage
        .from('stories')
        .upload(path, blob, { contentType: 'image/jpeg' })
      if (upErr) throw upErr
      const url = supabase.storage.from('stories').getPublicUrl(path).data.publicUrl
      const { error: insErr } = await supabase.from('stories').insert({
        user_id: user.id,
        media_url: url,
        caption: caption.trim() || null,
      })
      if (insErr) {
        // La ligne n'existe pas : le fichier déposé ne serait référencé par
        // rien. On le retire plutôt que de laisser un orphelin dans le bucket.
        await supabase.storage.from('stories').remove([path])
        throw insErr
      }
      reset()
      onPublished()
      onClose()
    } catch {
      setError(t('stories.publishError'))
      setBusy(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-end"
      style={{ background: 'rgba(0,0,0,0.65)' }}
      onClick={() => {
        if (!busy) {
          reset()
          onClose()
        }
      }}
      data-swipe-x=""
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheet-rise w-full rounded-t-3xl"
        style={{
          background: 'rgb(var(--color-card))',
          borderTop: '1px solid var(--color-border)',
          paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
        }}
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-[17px] font-bold text-fg">{t('stories.composerTitle')}</h2>
          <button
            onClick={() => {
              reset()
              onClose()
            }}
            aria-label={t('common.close')}
            disabled={busy}
            className="tappable flex h-8 w-8 items-center justify-center rounded-full text-fg2 disabled:opacity-40"
            style={{ background: 'rgb(var(--color-fg) / 0.07)' }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-4">
          {preview ? (
            <div
              className="relative overflow-hidden rounded-2xl"
              style={{ aspectRatio: '3 / 4', background: '#0c0c0f' }}
            >
              <img src={preview} alt="" className="h-full w-full object-contain" />
              <button
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                className="tappable absolute bottom-3 right-3 rounded-full px-3.5 py-2 text-[12.5px] font-semibold text-white"
                style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
              >
                {t('stories.changePhoto')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => inputRef.current?.click()}
              className="tappable flex w-full flex-col items-center justify-center gap-3 rounded-2xl py-14"
              style={{
                background: 'rgb(var(--color-fg) / 0.04)',
                border: '1px dashed var(--color-border)',
              }}
            >
              <ImagePlus className="h-8 w-8 text-fg2" />
              <span className="text-[14px] font-semibold text-fg">{t('stories.choosePhoto')}</span>
              <span className="text-[12.5px] text-fg2">{t('stories.lifetime')}</span>
            </button>
          )}

          {preview && (
            <div className="mt-3">
              <input
                value={caption}
                onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION))}
                placeholder={t('stories.captionPlaceholder')}
                aria-label={t('stories.captionPlaceholder')}
                className="w-full rounded-xl px-4 py-3 text-fg outline-none placeholder:text-fg2"
                // Sans fond explicite, le champ hérite du blanc par défaut du
                // navigateur et troue la feuille sombre.
                style={{
                  fontSize: '16px',
                  background: 'rgb(var(--color-fg) / 0.06)',
                  border: '1px solid var(--color-border)',
                }}
                // Une légende n'est pas un article : la limite est dans le
                // champ plutôt que dans un message d'erreur après coup.
                maxLength={MAX_CAPTION}
              />
            </div>
          )}

          {error && <p className="mt-3 text-center text-[13px] text-accent">{error}</p>}

          {preview && (
            <button
              onClick={publish}
              disabled={busy}
              className="tappable mt-4 flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[15px] font-bold text-white disabled:opacity-60"
              style={{
                background: 'var(--revs-red)',
                boxShadow: '0 8px 24px rgb(var(--color-accent) / 0.4)',
              }}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? t('stories.publishing') : t('stories.publish')}
            </button>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          onChange={pick}
          className="hidden"
        />
      </div>
    </div>,
    document.body,
  )
}
