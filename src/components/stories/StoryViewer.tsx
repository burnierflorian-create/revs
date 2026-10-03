// ═══════ LECTEUR DE STORIES ═══════
//
// Plein écran, une barre de progression par story, passage automatique.
//
// ── CE QU'IL NE FAIT PAS ──
// Pas de réponse, pas de réaction, pas de partage, pas de mise en pause par
// appui long. Chacune de ces fonctions demanderait sa propre surface et son
// propre backend ; aucune n'est nécessaire pour que des stories existent.
//
// ── MARQUAGE « VU » ──
// Posé À L'OUVERTURE de chaque story, pas à la fermeture du lecteur : quelqu'un
// qui regarde trois stories puis ferme l'application en a bien vu trois. La
// contrainte de clé primaire (story_id, user_id) rend l'écriture idempotente,
// donc rouvrir ne compte pas deux fois et il n'y a rien à vérifier avant.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { timeAgo } from '../../lib/spots'

export type Story = {
  id: string
  user_id: string
  media_url: string
  caption: string | null
  created_at: string
}
export type StoryAuthor = {
  user_id: string
  pseudo: string | null
  avatar: string | null
  is_me: boolean
}

/** Durée d'affichage d'une story, en millisecondes. */
const STORY_MS = 5000

export default function StoryViewer({
  author,
  stories,
  onClose,
  onDeleted,
}: {
  author: StoryAuthor
  stories: Story[]
  onClose: () => void
  onDeleted?: (id: string) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [index, setIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  const startRef = useRef<number>(0)
  const rafRef = useRef<number>(0)

  const story = stories[index]

  const next = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= stories.length) {
        onClose()
        return i
      }
      return i + 1
    })
  }, [stories.length, onClose])

  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Marquage « vu » — une écriture par story ouverte, sans attendre sa réponse.
  useEffect(() => {
    if (!story) return
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return
      await supabase
        .from('story_views')
        .insert({ story_id: story.id, user_id: user.id })
        // Déjà vue : la clé primaire refuse, et c'est le résultat voulu.
        .select()
        .maybeSingle()
    })()
  }, [story])

  // Progression + passage automatique. `requestAnimationFrame` plutôt qu'un
  // intervalle : la barre suit alors le rafraîchissement de l'écran, et elle
  // se fige d'elle-même quand l'onglet passe en arrière-plan — ce qu'un
  // `setInterval` ne fait pas, laissant la story défiler sans personne.
  useEffect(() => {
    if (!story) return
    // La remise à zéro vit DANS la première image d'animation et non au corps
    // de l'effet : appelée en synchrone, elle provoque un second rendu
    // immédiat alors que la frame suivante va de toute façon réécrire la
    // valeur.
    startRef.current = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - startRef.current) / STORY_MS)
      setProgress(p)
      if (p >= 1) next()
      else rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [story, next])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') next()
      if (e.key === 'ArrowLeft') prev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, next, prev])

  async function remove() {
    if (!story) return
    await supabase.from('stories').delete().eq('id', story.id)
    onDeleted?.(story.id)
    onClose()
  }

  if (!story) return null

  return createPortal(
    <div className="fixed inset-0 z-[120] flex flex-col" style={{ background: '#000' }}>
      {/* Barres de progression — une par story, remplies, en cours, ou vides. */}
      <div
        className="flex flex-none gap-1 px-3"
        style={{ paddingTop: 'max(0.6rem, env(safe-area-inset-top))' }}
      >
        {stories.map((s, i) => (
          <span
            key={s.id}
            className="h-[3px] flex-1 overflow-hidden rounded-full"
            style={{ background: 'rgba(255,255,255,0.28)' }}
          >
            <span
              className="block h-full rounded-full bg-white"
              style={{
                width: i < index ? '100%' : i === index ? `${progress * 100}%` : '0%',
                transition: i === index ? 'none' : 'width 180ms linear',
              }}
            />
          </span>
        ))}
      </div>

      <div className="flex flex-none items-center gap-2.5 px-4 py-3">
        <button
          onClick={() => {
            onClose()
            navigate(`/u/${author.user_id}`)
          }}
          className="tappable flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-full bg-white/10 text-[13px] font-extrabold text-white"
        >
          {author.avatar ? (
            <img src={author.avatar} alt="" className="h-full w-full object-cover" />
          ) : (
            (author.pseudo ?? '?').charAt(0).toUpperCase()
          )}
        </button>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-bold text-white">
            {author.pseudo ?? t('members.anonymous')}
          </span>
          <span className="block text-[11.5px] text-white/55">{timeAgo(story.created_at)}</span>
        </span>
        {author.is_me && (
          <button
            onClick={remove}
            aria-label={t('stories.delete')}
            className="tappable flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/10 text-white/80"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
        )}
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="tappable flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/10 text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* L'image, et les deux zones de navigation par-dessus. `contain` :
          recadrer la photo de quelqu'un pour remplir l'écran reviendrait à
          décider à sa place de ce qui compte dedans. */}
      <div className="relative min-h-0 flex-1">
        <img
          src={story.media_url}
          alt={story.caption ?? ''}
          className="absolute inset-0 h-full w-full object-contain"
        />
        <button
          onClick={prev}
          aria-label={t('stories.previous')}
          className="absolute inset-y-0 left-0 w-1/3"
          style={{ background: 'transparent' }}
        />
        <button
          onClick={next}
          aria-label={t('stories.next')}
          className="absolute inset-y-0 right-0 w-2/3"
          style={{ background: 'transparent' }}
        />
        {story.caption && (
          <p
            className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-6 text-center text-[15px] font-semibold leading-snug text-white"
            style={{ textShadow: '0 2px 12px rgba(0,0,0,0.85)' }}
          >
            {story.caption}
          </p>
        )}
      </div>
    </div>,
    document.body,
  )
}
