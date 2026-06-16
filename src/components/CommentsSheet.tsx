import { useEffect, useRef, useState } from 'react'
import { Send, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { timeAgo } from '../lib/spots'
import { myPseudo, notifyPush } from '../lib/push'

type Comment = {
  id: string
  user_id: string
  content: string
  created_at: string
}
type ComProfile = { pseudo: string | null; avatar: string | null }

type Props = {
  spotId: string
  ownerId: string
  spotLabel: string
  open: boolean
  onClose: () => void
  /** Bubble the live count back up so the feed tools row stays in sync. */
  onCountChange?: (n: number) => void
}

/** Instagram-style comments drawer: slides up from the bottom over a
 *  blurred dim backdrop. The panel surface is theme-aware (bg-card) so it
 *  reads as near-black at night and near-white in light mode. Loads the
 *  spot's comments + commenter avatars, and posts new ones inline. */
export default function CommentsSheet({
  spotId,
  ownerId,
  spotLabel,
  open,
  onClose,
  onCountChange,
}: Props) {
  const [comments, setComments] = useState<Comment[]>([])
  const [profs, setProfs] = useState<Record<string, ComProfile>>({})
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  async function load() {
    const { data } = await supabase
      .from('comments')
      .select('id, user_id, content, created_at')
      .eq('spot_id', spotId)
      .order('created_at', { ascending: true })
      .limit(200)
    const list = (data ?? []) as Comment[]
    setComments(list)
    setLoading(false)
    onCountChange?.(list.length)
    const ids = [...new Set(list.map((c) => c.user_id))]
    if (ids.length) {
      const { data: ps } = await supabase
        .from('profiles')
        .select('user_id, pseudo, avatar')
        .in('user_id', ids)
      const map: Record<string, ComProfile> = {}
      for (const p of (ps ?? []) as {
        user_id: string
        pseudo: string | null
        avatar: string | null
      }[]) {
        map[p.user_id] = { pseudo: p.pseudo, avatar: p.avatar }
      }
      setProfs(map)
    }
  }

  // (Re)load whenever the sheet opens. Closed → no work.
  useEffect(() => {
    if (!open) return
    setLoading(true)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, spotId])

  async function send() {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      setSending(false)
      return
    }
    const { error } = await supabase
      .from('comments')
      .insert({ spot_id: spotId, user_id: user.id, content: body.slice(0, 280) })
    setSending(false)
    if (error) return
    setText('')
    await load()
    // Scroll to the freshly posted comment.
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
    })
    if (ownerId !== user.id) {
      const who = await myPseudo()
      void notifyPush({
        user_id: ownerId,
        title: '💬 Nouveau commentaire',
        body: `${who} a commenté ton spot ${spotLabel}`,
        url: `/spot/${spotId}`,
        type: 'comments',
      })
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      {/* Dim, blurred backdrop */}
      <button
        aria-label="Fermer les commentaires"
        onClick={onClose}
        className="absolute inset-0"
        style={{
          background: 'rgba(0,0,0,0.60)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      />

      {/* Sheet panel — theme-aware surface, slides up */}
      <div
        className="animate-slide-up relative flex max-h-[80vh] flex-col rounded-t-3xl bg-card"
        style={{
          border: '1px solid var(--color-border)',
          borderBottom: 'none',
          boxShadow: '0 -16px 48px rgba(0,0,0,0.45)',
        }}
      >
        {/* Grab handle */}
        <div className="flex justify-center pt-2.5">
          <span className="h-1 w-10 rounded-full bg-fg/20" />
        </div>

        <div className="flex items-center justify-between px-5 pb-2 pt-3">
          <h3 className="font-display text-base font-extrabold tracking-tight text-fg">
            Commentaires
            <span className="ml-1.5 text-fg2">{comments.length}</span>
          </h3>
          <button
            onClick={onClose}
            aria-label="Fermer"
            className="tappable text-fg2 hover:text-fg"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Comment list */}
        <div
          ref={listRef}
          className="min-h-[120px] flex-1 space-y-4 overflow-y-auto px-5 py-3"
        >
          {loading ? (
            <p className="py-8 text-center text-sm text-fg2">Chargement…</p>
          ) : comments.length === 0 ? (
            <p className="py-8 text-center text-sm text-fg2">
              Sois le premier à commenter ce spot.
            </p>
          ) : (
            comments.map((c) => {
              const p = profs[c.user_id]
              const pseudo = p?.pseudo || 'Spotter'
              return (
                <div key={c.id} className="flex items-start gap-3">
                  <div className="flex h-8 w-8 flex-none items-center justify-center overflow-hidden rounded-full bg-fg/10 text-xs font-extrabold text-fg">
                    {p?.avatar ? (
                      <img
                        src={p.avatar}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      pseudo.charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-snug text-fg">
                      <span className="font-bold">{pseudo}</span>{' '}
                      <span className="text-fg/85">{c.content}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-fg2">
                      {timeAgo(c.created_at)}
                    </p>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Sticky composer */}
        <div
          className="flex items-center gap-2 px-4 py-3"
          style={{
            borderTop: '1px solid var(--color-border)',
            paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void send()
              }
            }}
            maxLength={280}
            placeholder="Ajouter un commentaire…"
            className="flex-1 rounded-full bg-fg/5 px-4 py-2.5 text-fg outline-none placeholder:text-fg2"
            style={{ fontSize: '16px', border: '1px solid var(--color-border)' }}
          />
          <button
            onClick={() => void send()}
            disabled={!text.trim() || sending}
            aria-label="Envoyer"
            className="tappable flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
          >
            <Send className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </div>
  )
}
