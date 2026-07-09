import type { Rarity } from './spots'

// Shared rarity chip — the SAME visual language as the Collection card
// (CollectorCard's RARITY_VISUAL): grey / blue / red / bronze / violet and
// an animated gold for the top tier. Used for the badge on Fil photos so
// the collection identity carries over to the feed.

export type RarityBadge = {
  label: string
  bg: string
  fg: string
  border: string
  animated?: boolean
}

const RARITY_BADGE: Record<Rarity, RarityBadge> = {
  standard: {
    label: 'COMMUN',
    bg: 'rgba(136,136,136,0.32)',
    fg: '#E5E7EB',
    border: 'rgba(200,200,200,0.45)',
  },
  premium: {
    label: 'PREMIUM',
    bg: 'rgba(74,158,255,0.32)',
    fg: '#DBEAFE',
    border: 'rgba(74,158,255,0.7)',
  },
  performance: {
    label: 'PERFORMANCE',
    bg: 'rgba(239,68,68,0.32)',
    fg: '#FECACA',
    border: 'rgba(239,68,68,0.7)',
  },
  exclusif: {
    label: 'EXCLUSIF',
    bg: 'rgba(184,115,51,0.34)',
    fg: '#F3D7B0',
    border: 'rgba(184,115,51,0.75)',
  },
  supercar: {
    label: 'ULTRA RARE',
    bg: 'rgba(155,89,182,0.38)',
    fg: '#EDE0FF',
    border: 'rgba(155,89,182,0.8)',
  },
  hypercar: {
    label: 'LÉGENDAIRE',
    bg: 'linear-gradient(120deg, #E0B341 0%, #FFD700 45%, #B8860B 100%)',
    fg: '#1a1306',
    border: 'rgba(255,215,0,0.85)',
    animated: true,
  },
}

export function rarityBadge(r: Rarity | null | undefined): RarityBadge {
  return RARITY_BADGE[(r ?? 'standard') as Rarity] ?? RARITY_BADGE.standard
}
