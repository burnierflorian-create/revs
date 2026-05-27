import { supabase } from './supabase'
import type { Spot } from './spots'

// ───────────────────────── Catalogue ─────────────────────────
// 5 hand-picked collections. The `id` strings must match the
// `claim_collection` SQL case statement — never rename one without a
// migration. XP values live ONLY in SQL (locked server-side); the
// numbers here are display-only.

type Slot = { id: string; label: string; emoji?: string; match: RegExp }

type Rule =
  // N distinct models within a single brand pattern.
  | { type: 'distinct-models'; brandMatch: RegExp; target: number }
  // One spot per brand in the list — all required.
  | { type: 'one-per-brand'; brands: Slot[] }
  // One spot in any of the listed brands — just one is enough.
  | { type: 'any-of'; brands: Slot[] }

export type Collection = {
  id: string
  title: string
  description: string
  emoji: string
  xpReward: number
  rule: Rule
}

export const COLLECTIONS: Collection[] = [
  {
    id: 'amg-collection',
    title: 'La Collection AMG',
    description: 'Spotte 5 Mercedes-AMG différentes',
    emoji: '⚡',
    xpReward: 300,
    rule: {
      type: 'distinct-models',
      brandMatch: /(mercedes[- ]?amg|amg gt|amg\b)/i,
      target: 5,
    },
  },
  {
    id: 'british-trio',
    title: 'Le Trio Britannique',
    description: 'Une McLaren, une Aston Martin et une Bentley',
    emoji: '🇬🇧',
    xpReward: 250,
    rule: {
      type: 'one-per-brand',
      brands: [
        { id: 'mclaren', label: 'McLaren', match: /\bmclaren\b/i },
        { id: 'aston-martin', label: 'Aston Martin', match: /aston[- ]?martin/i },
        { id: 'bentley', label: 'Bentley', match: /\bbentley\b/i },
      ],
    },
  },
  {
    id: 'jdm-legend',
    title: 'JDM Legend',
    description: 'Toyota, Nissan, Honda, Mazda et Subaru',
    emoji: '🇯🇵',
    xpReward: 200,
    rule: {
      type: 'one-per-brand',
      brands: [
        { id: 'toyota', label: 'Toyota', match: /\btoyota\b/i },
        { id: 'nissan', label: 'Nissan', match: /\bnissan\b|\bnismo\b/i },
        { id: 'honda', label: 'Honda', match: /\bhonda\b|\backura\b/i },
        { id: 'mazda', label: 'Mazda', match: /\bmazda\b|\bmazdaspeed\b/i },
        { id: 'subaru', label: 'Subaru', match: /\bsubaru\b/i },
      ],
    },
  },
  {
    id: 'italian-big-3',
    title: 'Big 3 Italiens',
    description: 'Ferrari, Lamborghini et Maserati',
    emoji: '🇮🇹',
    xpReward: 350,
    rule: {
      type: 'one-per-brand',
      brands: [
        { id: 'ferrari', label: 'Ferrari', match: /\bferrari\b/i },
        {
          id: 'lamborghini',
          label: 'Lamborghini',
          match: /\blamborghini\b|\blambo\b/i,
        },
        { id: 'maserati', label: 'Maserati', match: /\bmaserati\b/i },
      ],
    },
  },
  {
    id: 'hypercar-club',
    title: 'Hypercar Club',
    description: 'Bugatti, Koenigsegg, Pagani ou Rimac',
    emoji: '👑',
    xpReward: 500,
    rule: {
      type: 'any-of',
      brands: [
        { id: 'bugatti', label: 'Bugatti', match: /\bbugatti\b/i },
        { id: 'koenigsegg', label: 'Koenigsegg', match: /\bkoenigsegg\b/i },
        { id: 'pagani', label: 'Pagani', match: /\bpagani\b/i },
        { id: 'rimac', label: 'Rimac', match: /\brimac\b/i },
      ],
    },
  },
]

// ───────────────────────── Progress ─────────────────────────

export type SlotState = {
  id: string
  label: string
  matched: boolean
  /** Up to one matching spot used for the miniature tile. */
  spot?: Spot
}

export type CollectionProgress = {
  collection: Collection
  /** Stable slots for "one-per-brand" / "any-of" / "distinct-models"
   *  shapes. For `distinct-models` the slots are populated lazily from
   *  the user's distinct models (up to `target`). */
  slots: SlotState[]
  matchedCount: number
  target: number
  /** Server-stored claim row — if present, the collection has been
   *  redeemed. Used to drive the "Réclamer" vs "✓ Réclamé" UI. */
  claimedAt: string | null
}

function slotsFromRule(rule: Rule): SlotState[] {
  if (rule.type === 'distinct-models') {
    return Array.from({ length: rule.target }, (_, i) => ({
      id: `slot-${i + 1}`,
      label: '?',
      matched: false,
    }))
  }
  return rule.brands.map((b) => ({
    id: b.id,
    label: b.label,
    matched: false,
  }))
}

export function computeProgress(
  collection: Collection,
  spots: Spot[],
  claimedAt: string | null,
): CollectionProgress {
  const rule = collection.rule
  const slots = slotsFromRule(rule)
  const ordered = spots
    .slice()
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )

  if (rule.type === 'distinct-models') {
    const seen = new Map<string, Spot>()
    for (const sp of ordered) {
      const full = `${sp.brand ?? ''} ${sp.model ?? ''}`
      if (!rule.brandMatch.test(full)) continue
      const key = (sp.model ?? '').trim().toLowerCase()
      if (!key) continue
      if (!seen.has(key)) seen.set(key, sp)
      if (seen.size >= rule.target) break
    }
    const matches = [...seen.values()]
    matches.forEach((sp, i) => {
      if (slots[i]) {
        slots[i] = {
          id: `slot-${i + 1}`,
          label: `${sp.brand ?? ''} ${sp.model ?? ''}`.trim() || 'AMG',
          matched: true,
          spot: sp,
        }
      }
    })
    return {
      collection,
      slots,
      matchedCount: matches.length,
      target: rule.target,
      claimedAt,
    }
  }

  // one-per-brand / any-of share the slot-walk logic.
  for (const slot of slots) {
    const brand = rule.brands.find((b) => b.id === slot.id)
    if (!brand) continue
    for (const sp of ordered) {
      const full = `${sp.brand ?? ''} ${sp.model ?? ''}`
      if (brand.match.test(full)) {
        slot.matched = true
        slot.spot = sp
        break
      }
    }
  }
  const matchedCount = slots.filter((s) => s.matched).length
  const target = rule.type === 'any-of' ? 1 : rule.brands.length
  return { collection, slots, matchedCount, target, claimedAt }
}

// ───────────────────────── DB helpers ─────────────────────────

export async function fetchClaimedCollections(): Promise<
  Record<string, string>
> {
  const { data } = await supabase
    .from('collection_progress')
    .select('collection_id, completed_at')
  const map: Record<string, string> = {}
  for (const r of (data ?? []) as {
    collection_id: string
    completed_at: string
  }[]) {
    map[r.collection_id] = r.completed_at
  }
  return map
}

/** Single-shot claim. Returns `{ok, xp}` — ok=false when already
 *  claimed or RPC rejected (e.g., unknown id). */
export async function claimCollection(
  collectionId: string,
): Promise<{ ok: boolean; xp: number }> {
  const { data, error } = await supabase
    .rpc('claim_collection', { p_collection_id: collectionId })
    .maybeSingle()
  if (error || !data) {
    console.warn('[collections] claim failed:', error?.message)
    return { ok: false, xp: 0 }
  }
  const row = data as { ok: boolean; xp: number }
  return { ok: !!row.ok, xp: row.xp ?? 0 }
}
