// ═══════ CARROUSEL DES STORIES ═══════
//
// Rangée horizontale sous les filtres du Fil : « Ajouter » d'abord, puis un
// cercle par auteur ayant une story active.
//
// ── L'ANNEAU ──
// Rouge REVS tant qu'il reste une story non vue chez cet auteur, gris une fois
// toutes regardées. C'est le seul signal : un badge chiffré en plus dirait la
// même chose deux fois.
//
// Sa propre story n'a JAMAIS l'anneau rouge, même si l'on n'a pas « vu » sa
// propre publication. On sait ce qu'on a posté ; un anneau d'alerte sur son
// propre avatar ne signale rien.
//
// ── UNE SEULE REQUÊTE ──
// `stories_feed()` (migration 0111) renvoie déjà, par auteur : pseudo, avatar,
// présence, nombre de stories et présence d'une non vue. Les stories elles-
// mêmes ne sont chargées qu'à l'ouverture d'un auteur — payer leur contenu
// pour afficher un cercle serait absurde.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import StoryComposer from './StoryComposer'
import StoryViewer, { type Story, type StoryAuthor } from './StoryViewer'

type FeedRow = {
  user_id: string
  pseudo: string | null
  avatar: string | null
  online: boolean
  story_count: number
  has_unseen: boolean
  latest_at: string
  is_me: boolean
}

export default function StoriesRow() {
  const { t } = useTranslation()
  const [rows, setRows] = useState<FeedRow[] | null>(null)
  const [composerOpen, setComposerOpen] = useState(false)
  const [open, setOpen] = useState<{ author: StoryAuthor; stories: Story[] } | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.rpc('stories_feed')
    setRows((data ?? []) as FeedRow[])
  }, [])

  useEffect(() => {
    // La garde `active` n'est pas décorative : le Fil monte et démonte ce
    // composant au changement d'onglet, et une réponse qui revient après coup
    // écrirait dans un composant disparu.
    let active = true
    void (async () => {
      const { data } = await supabase.rpc('stories_feed')
      if (active) setRows((data ?? []) as FeedRow[])
    })()
    return () => {
      active = false
    }
  }, [])

  async function openAuthor(r: FeedRow) {
    const { data } = await supabase
      .from('stories')
      .select('id, user_id, media_url, caption, created_at')
      .eq('user_id', r.user_id)
      .order('created_at', { ascending: true })
    const stories = (data ?? []) as Story[]
    // La policy a déjà écarté les expirées et les non autorisées : une liste
    // vide signifie qu'elles viennent d'expirer entre le carrousel et le clic.
    if (!stories.length) {
      void load()
      return
    }
    setOpen({
      author: { user_id: r.user_id, pseudo: r.pseudo, avatar: r.avatar, is_me: r.is_me },
      stories,
    })
  }

  // Rien à montrer et rien à ajouter n'arrive jamais : le bouton « Ajouter »
  // est toujours là. On masque la rangée uniquement pendant le tout premier
  // chargement, pour ne pas faire sauter la mise en page du Fil.
  if (rows === null) return null

  return (
    <>
      <div
        className="mb-3 flex gap-3 overflow-x-auto px-4 pb-1"
        style={{ scrollbarWidth: 'none' }}
        data-swipe-x=""
      >
        {/* Ajouter — ou rouvrir la sienne si elle existe déjà. */}
        <button
          onClick={() => setComposerOpen(true)}
          aria-label={t('stories.add')}
          className="tappable flex w-[68px] flex-none flex-col items-center gap-1.5"
        >
          <span
            className="relative flex h-[62px] w-[62px] items-center justify-center rounded-full"
            style={{
              background: 'rgb(var(--color-fg) / 0.06)',
              border: '1px dashed var(--color-border)',
            }}
          >
            <Plus className="h-6 w-6 text-fg2" />
            <span
              aria-hidden
              className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full"
              style={{ background: 'var(--revs-red)', border: '2px solid rgb(var(--color-bg))' }}
            >
              <Plus className="h-3 w-3 text-white" strokeWidth={3} />
            </span>
          </span>
          {/* Toujours « Ajouter », même quand on a déjà une story : le cercle
              voisin porte déjà « Votre story », et afficher le même libellé
              deux fois de suite laisse croire à un doublon. */}
          <span className="w-full truncate text-center text-[11px] font-medium text-fg2">
            {t('stories.add')}
          </span>
        </button>

        {rows.map((r) => (
          <button
            key={r.user_id}
            onClick={() => void openAuthor(r)}
            aria-label={t('stories.openOf', { pseudo: r.pseudo ?? '' })}
            className="tappable flex w-[68px] flex-none flex-col items-center gap-1.5"
          >
            <span className="relative flex h-[62px] w-[62px] items-center justify-center">
              {/* L'anneau est un élément À PART et non une bordure de
                  l'avatar : une bordure rognerait l'image de 2 px à chaque
                  changement d'état, et le visage sauterait. */}
              <span
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{
                  border:
                    r.has_unseen && !r.is_me
                      ? '2.5px solid var(--revs-red)'
                      : '2px solid rgb(var(--color-fg) / 0.18)',
                  boxShadow:
                    r.has_unseen && !r.is_me
                      ? '0 0 12px rgb(var(--color-accent) / 0.45)'
                      : undefined,
                }}
              />
              <span className="flex h-[52px] w-[52px] items-center justify-center overflow-hidden rounded-full bg-fg/10 text-[17px] font-extrabold text-fg">
                {r.avatar ? (
                  <img
                    src={r.avatar}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                    style={{ objectPosition: 'top' }}
                  />
                ) : (
                  (r.pseudo ?? '?').charAt(0).toUpperCase()
                )}
              </span>
              {r.online && (
                <span
                  aria-hidden
                  className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full"
                  style={{ background: '#22C55E', border: '2px solid rgb(var(--color-bg))' }}
                />
              )}
            </span>
            <span className="w-full truncate text-center text-[11px] font-medium text-fg">
              {r.is_me ? t('stories.yours') : (r.pseudo ?? '—')}
            </span>
          </button>
        ))}
      </div>

      <StoryComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onPublished={() => void load()}
      />
      {open && (
        <StoryViewer
          author={open.author}
          stories={open.stories}
          onClose={() => {
            setOpen(null)
            void load()
          }}
          onDeleted={() => void load()}
        />
      )}
    </>
  )
}
