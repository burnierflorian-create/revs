import { useEffect, useMemo, useState } from 'react'
import { Car, Check, Lock, Zap } from 'lucide-react'
import type { Spot } from '../lib/spots'
import {
  COLLECTIONS,
  claimCollection,
  computeProgress,
  fetchClaimedCollections,
  type CollectionProgress,
} from '../lib/collections'
import { floatXp } from './XpFloater'

/** Renders the user's collections grid. Eligibility + miniatures are
 *  derived from the `spots` prop (user's own spots, already fetched
 *  by Profile). Claim state comes from `collection_progress` and is
 *  reloaded after each successful claim. */
export default function CollectionsSection({ spots }: { spots: Spot[] }) {
  const [claimed, setClaimed] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetchClaimedCollections().then((m) => {
      if (active) setClaimed(m)
    })
    return () => {
      active = false
    }
  }, [])

  const progresses = useMemo<CollectionProgress[]>(
    () =>
      COLLECTIONS.map((c) =>
        computeProgress(c, spots, claimed[c.id] ?? null),
      ),
    [spots, claimed],
  )

  async function onClaim(id: string, xpReward: number) {
    if (busyId) return
    setBusyId(id)
    const { ok } = await claimCollection(id)
    setBusyId(null)
    if (ok) {
      floatXp(xpReward)
      setClaimed((c) => ({ ...c, [id]: new Date().toISOString() }))
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-display text-lg font-extrabold tracking-tighter text-fg">
          Défis Collections
        </h2>
        <span className="label-up text-[10px] text-fg2">
          {progresses.filter((p) => p.claimedAt).length}/{COLLECTIONS.length}
        </span>
      </div>
      <div className="space-y-3 pb-2">
        {progresses.map((p) => (
          <CollectionCard
            key={p.collection.id}
            progress={p}
            busy={busyId === p.collection.id}
            onClaim={() => onClaim(p.collection.id, p.collection.xpReward)}
          />
        ))}
      </div>
    </section>
  )
}

function CollectionCard({
  progress,
  busy,
  onClaim,
}: {
  progress: CollectionProgress
  busy: boolean
  onClaim: () => void
}) {
  const { collection, slots, matchedCount, target, claimedAt } = progress
  const complete = matchedCount >= target
  const claimed = claimedAt !== null
  const pct = Math.min(100, Math.round((matchedCount / target) * 100))

  return (
    <article
      className="overflow-hidden rounded-3xl bg-card"
      style={{
        border: claimed
          ? '1px solid rgba(34,197,94,0.45)'
          : complete
            ? '1px solid rgba(232,32,58,0.45)'
            : '1px solid var(--color-border)',
        boxShadow: claimed
          ? '0 8px 24px rgba(34,197,94,0.18)'
          : complete
            ? '0 8px 24px rgba(232,32,58,0.20)'
            : undefined,
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-3 px-4 pt-4">
        <span
          className="flex h-11 w-11 flex-none items-center justify-center rounded-2xl text-xl"
          style={{
            background: claimed
              ? 'rgba(34,197,94,0.18)'
              : 'rgba(232,32,58,0.14)',
            border: claimed
              ? '1px solid rgba(34,197,94,0.40)'
              : '1px solid rgba(232,32,58,0.35)',
          }}
          aria-hidden
        >
          {collection.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-base font-extrabold tracking-tighter text-fg">
            {collection.title}
          </h3>
          <p className="mt-0.5 text-[12px] text-fg2">{collection.description}</p>
        </div>
        <span
          className="flex flex-none items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold tracking-wider"
          style={
            claimed
              ? {
                  background: 'rgba(34,197,94,0.16)',
                  color: '#86EFAC',
                  border: '1px solid rgba(34,197,94,0.40)',
                }
              : {
                  background:
                    'linear-gradient(120deg, #E0B341 0%, #FFD700 45%, #B8860B 100%)',
                  color: '#1a1306',
                  boxShadow: '0 6px 18px rgba(224,179,65,0.35)',
                }
          }
        >
          <Zap className="h-3 w-3" />+{collection.xpReward}
        </span>
      </div>

      {/* Miniatures grid */}
      <div className="mt-3 px-4">
        <div
          className="grid gap-2"
          style={{
            gridTemplateColumns: `repeat(${Math.min(slots.length, 5)}, minmax(0, 1fr))`,
          }}
        >
          {slots.map((s) => (
            <div
              key={s.id}
              className="relative aspect-square overflow-hidden rounded-xl"
              style={{
                background: s.matched
                  ? 'rgb(var(--color-card))'
                  : 'rgb(var(--color-fg) / 0.03)',
                border: s.matched
                  ? '1px solid rgba(232,32,58,0.45)'
                  : '1px dashed rgb(var(--color-fg) / 0.10)',
              }}
            >
              {s.matched && s.spot?.photo_url ? (
                <img
                  src={s.spot.photo_url}
                  alt={s.label}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : s.matched ? (
                <div className="flex h-full w-full items-center justify-center">
                  <Car className="h-5 w-5 text-accent" />
                </div>
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Lock className="h-4 w-4 text-fg2/40" />
                </div>
              )}
              {/* Brand label on locked slots so the user knows what's missing */}
              {!s.matched && s.label !== '?' && (
                <div className="absolute inset-x-0 bottom-0 truncate bg-fg/[0.08] px-1.5 py-0.5 text-center text-[8.5px] font-bold uppercase tracking-wider text-fg/65">
                  {s.label}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Progress + CTA */}
      <div className="flex items-center gap-3 px-4 py-4">
        <div className="min-w-0 flex-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-fg/[0.07]">
            <div
              className={`h-full rounded-full transition-[width] duration-700 ease-out ${
                claimed ? 'bg-green-500' : 'bg-accent'
              }`}
              style={{
                width: `${pct}%`,
                boxShadow: claimed
                  ? undefined
                  : '0 0 10px rgba(232,32,58,0.55)',
              }}
            />
          </div>
          <p className="label-up mt-2 text-[10px] text-fg2">
            {matchedCount} / {target}
            {claimed ? ' · Badge débloqué' : complete ? ' · Prêt à réclamer' : ''}
          </p>
        </div>
        {claimed ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-green-500/15 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-green-300"
            style={{ border: '1px solid rgba(34,197,94,0.45)' }}>
            <Check className="h-3.5 w-3.5" /> Réclamé
          </span>
        ) : (
          <button
            onClick={onClaim}
            disabled={!complete || busy}
            className="tappable inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-wider text-fg disabled:opacity-40"
            style={
              complete
                ? { boxShadow: '0 6px 18px rgba(232,32,58,0.45)' }
                : undefined
            }
          >
            {busy ? '…' : 'RÉCLAMER'}
          </button>
        )}
      </div>
    </article>
  )
}
