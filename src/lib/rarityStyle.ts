import type { Rarity } from './spots'

// ═══════════════ RARETÉ — LA SEULE SOURCE DE VÉRITÉ ═══════════════
//
// CE QUI N'ALLAIT PAS (30/09/2026)
// Trois jeux de libellés cohabitaient pour les MÊMES six raretés :
//
//   spots.ts RARITY_LABEL   STANDARD · PREMIUM · PERFORMANCE · EXCLUSIF · SUPERCAR ✨ · HYPERCAR 👑
//   rarityStyle.ts          COMMUN   · PREMIUM · PERFORMANCE · EXCLUSIF · ULTRA RARE · LÉGENDAIRE
//   CollectorCardV2         COMMUN   · PEU COMMUN · RARE     · ÉPIQUE   · ULTRA RARE · LÉGENDAIRE
//
// Une même voiture s'annonçait donc « PERFORMANCE » dans le fil et « RARE »
// sur sa carte — et les couleurs suivaient : bleu ici, vert là. Impossible
// d'apprendre une échelle qui change de nom selon l'écran.
//
// Ce fichier porte désormais LES DEUX usages : la pastille (fil, photos) et
// le cadre (carte de collection). Un seul endroit à modifier, donc plus de
// dérive possible.
//
// LES COULEURS
// Chaque rareté vit dans SA teinte, du graphite au rouge REVS. Pas
// d'arc-en-ciel : l'ancien cadre holographique des deux plus hautes raretés
// virait au néon de borne d'arcade, là où REVS vise l'objet de collection.
// La progression se lit à la chaleur et à la densité du métal, pas au nombre
// de couleurs.

export type RarityBadge = {
  label: string
  bg: string
  fg: string
  border: string
  animated?: boolean
}

/** Habillage complet de la carte de collection pour une rareté. */
export type RarityFrame = {
  label: string
  /** Dégradé du liseré métallique qui entoure la carte. */
  frame: string
  /** Filet intérieur, très fin, qui détache le cadre de la photo. */
  edge: string
  /** Ombre portée + halo. Monte avec la rareté, sans jamais éblouir. */
  glow: string
  chipBg: string
  chipFg: string
  chipBorder: string
  /** Reflet métallique qui balaie le cadre au tilt. Faux = cadre mat. */
  sheen: boolean
  /** Halo diffus derrière la carte. Réservé au sommet de l'échelle. */
  aura: boolean
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

// Le cadre reprend EXACTEMENT le libellé de la pastille — il n'est pas
// recopié, il est lu, pour que les deux ne puissent plus diverger.
const RARITY_FRAME: Record<Rarity, RarityFrame> = {
  standard: {
    label: RARITY_BADGE.standard.label,
    frame: 'linear-gradient(145deg, #34373C, #5E6167 45%, #24262A)',
    edge: 'rgba(255,255,255,0.10)',
    glow: '0 14px 30px rgba(0,0,0,0.55)',
    chipBg: 'rgba(20,20,24,0.62)',
    chipFg: '#E5E7EB',
    chipBorder: 'rgba(200,203,208,0.35)',
    sheen: false,
    aura: false,
  },
  premium: {
    label: RARITY_BADGE.premium.label,
    frame: 'linear-gradient(145deg, #1B3A63, #4A9EFF 45%, #14294A)',
    edge: 'rgba(160,205,255,0.24)',
    glow: '0 16px 34px rgba(74,158,255,0.28)',
    chipBg: 'rgba(12,22,38,0.66)',
    chipFg: '#DBEAFE',
    chipBorder: 'rgba(74,158,255,0.7)',
    sheen: true,
    aura: false,
  },
  performance: {
    label: RARITY_BADGE.performance.label,
    frame: 'linear-gradient(145deg, #6E1520, #E8203A 45%, #4A0E17)',
    edge: 'rgba(255,175,185,0.26)',
    glow: '0 16px 38px rgba(232,32,58,0.34)',
    chipBg: 'rgba(32,10,14,0.66)',
    chipFg: '#FECACA',
    chipBorder: 'rgba(239,68,68,0.7)',
    sheen: true,
    aura: false,
  },
  exclusif: {
    label: RARITY_BADGE.exclusif.label,
    frame: 'linear-gradient(145deg, #6B4520, #D9A24E 45%, #4A2E12)',
    edge: 'rgba(255,225,170,0.28)',
    glow: '0 18px 42px rgba(200,150,70,0.36)',
    chipBg: 'rgba(30,20,8,0.66)',
    chipFg: '#F3D7B0',
    chipBorder: 'rgba(184,115,51,0.78)',
    sheen: true,
    aura: false,
  },
  supercar: {
    label: RARITY_BADGE.supercar.label,
    frame: 'linear-gradient(145deg, #4A2170, #9B59B6 45%, #331550)',
    edge: 'rgba(230,200,255,0.30)',
    glow: '0 18px 46px rgba(155,89,182,0.42)',
    chipBg: 'rgba(24,12,34,0.68)',
    chipFg: '#EDE0FF',
    chipBorder: 'rgba(155,89,182,0.82)',
    sheen: true,
    aura: false,
  },
  hypercar: {
    // Or → rouge REVS. La seule rareté bicolore, et la seule à porter un
    // halo : c'est ce qui la rend reconnaissable de loin dans une grille.
    label: RARITY_BADGE.hypercar.label,
    frame:
      'linear-gradient(145deg, #B8860B, #FFD700 32%, #E8203A 74%, #8A1220)',
    edge: 'rgba(255,240,190,0.46)',
    glow: '0 20px 54px rgba(255,190,60,0.44)',
    chipBg: 'linear-gradient(120deg, #E0B341, #FFD700 45%, #E8203A)',
    chipFg: '#1A1306',
    chipBorder: 'rgba(255,215,0,0.9)',
    sheen: true,
    aura: true,
  },
}

export function rarityBadge(r: Rarity | null | undefined): RarityBadge {
  return RARITY_BADGE[(r ?? 'standard') as Rarity] ?? RARITY_BADGE.standard
}

export function rarityFrame(r: Rarity | null | undefined): RarityFrame {
  return RARITY_FRAME[(r ?? 'standard') as Rarity] ?? RARITY_FRAME.standard
}
