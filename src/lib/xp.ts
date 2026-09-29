// ═══════════════════════ Progression REVS — 100 niveaux ═══════════════════════
//
// Refonte du 29/09/2026. L'ancienne échelle comptait 10 paliers nommés,
// définis DEUX fois côté client (ici et dans titles.ts) et nulle part côté
// serveur. Le dernier palier demandait 25 000 XP d'un coup, puis la
// progression s'arrêtait définitivement.
//
// ── LA COURBE ──
//   XP cumulée pour atteindre le niveau N  =  round(100 × (N−1)^1.5)
//   niveau 2 → 100 · niveau 10 → 2 700 · niveau 50 → 34 300 · niveau 100 → 98 504
//
// Un exposant 1,5 plutôt qu'un doublement : l'écart entre deux niveaux croît
// régulièrement — 100 XP au début, 1 489 à la fin — donc un niveau reste
// toujours un objectif atteignable, y compris au sommet.
//
// ── CE FICHIER EST UN MIROIR, PAS LA SOURCE ──
// La vérité vit dans `revs_xp_for_level` / `revs_level_for_xp` (migration
// 0076, corrigée en 0081). Les fonctions ci-dessous existent pour afficher
// sans aller-retour réseau et DOIVENT rester identiques au SQL. Pour un écran
// de progression, préférer `fetchProgress()` en bas de fichier : il interroge
// le serveur et ne peut pas diverger.

import { supabase } from './supabase'

export const MAX_LEVEL = 100

/** XP cumulée nécessaire pour atteindre `level`. Miroir de revs_xp_for_level. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0
  return Math.round(100 * Math.pow(Math.min(level, MAX_LEVEL) - 1, 1.5))
}

/**
 * Niveau atteint avec `xp`. Miroir de revs_level_for_xp.
 *
 * L'inverse analytique seul NE SUFFIT PAS : les seuils stockés sont arrondis,
 * si bien que (xp/100)^(2/3) tombe juste sous l'entier au niveau 6 (1 118 XP
 * → 4,99991). Sans la correction ±1 ci-dessous, un niveau sur deux était faux
 * — vérifié sur les 100 niveaux au banc d'essai SQL.
 */
export function levelForXp(xp: number): number {
  const safe = Math.max(0, Math.floor(xp))
  const guess = Math.min(
    MAX_LEVEL,
    Math.max(1, 1 + Math.floor(Math.pow(safe / 100, 1 / 1.5))),
  )
  if (guess < MAX_LEVEL && xpForLevel(guess + 1) <= safe) return guess + 1
  if (guess > 1 && xpForLevel(guess) > safe) return guess - 1
  return guess
}

// ─────────────────────── Titres de niveau ───────────────────────
//
// UNE seule échelle, dérivée du niveau. Elle ne se superpose plus au statut de
// compte (« Fondateur ») : voir titles.ts, où les deux sont désormais séparés.

export type TitleBand = { name: string; minLevel: number }

export const XP_LADDER: ReadonlyArray<TitleBand> = [
  { name: 'Rookie', minLevel: 1 },
  { name: 'Spotter', minLevel: 5 },
  { name: 'Explorer', minLevel: 10 },
  { name: 'Hunter', minLevel: 20 },
  { name: 'Collector', minLevel: 30 },
  { name: 'Pro Spotter', minLevel: 40 },
  { name: 'Master', minLevel: 50 },
  { name: 'Elite', minLevel: 60 },
  { name: 'Legend', minLevel: 75 },
  { name: 'Icon', minLevel: 90 },
  { name: 'REVS OG', minLevel: 100 },
]

/** Titre correspondant à un niveau. Miroir de revs_title_for_level. */
export function titleForLevel(level: number): string {
  let name = XP_LADDER[0].name
  for (const b of XP_LADDER) if (level >= b.minLevel) name = b.name
  return name
}

// ─────────────────────── Vue d'affichage ───────────────────────

export type XpLevel = {
  /** Titre du palier — « Rookie », « Collector », « REVS OG »… */
  name: string
  /** Numéro de niveau, 1 à 100. */
  level: number
  /** Progression DANS le niveau courant, 0-100. */
  pct: number
  /** XP restante avant le niveau suivant (0 au niveau 100). */
  toNext: number
  /** Niveau 100 atteint → le prestige est disponible. */
  isMax: boolean
  /** Titre du palier suivant, ou null au sommet. */
  next: string | null
  /** XP totale du joueur (hors décompte de prestige). */
  current: number
  /** Seuil d'entrée du niveau courant. */
  floor: number
  /** Seuil du niveau suivant, ou null au niveau 100. */
  ceiling: number | null
  /** Nombre de prestiges validés. 0 = jamais prestigé. */
  prestige: number
}

/**
 * Traduit une XP en vue d'affichage.
 *
 * `prestigeBase` est l'XP au moment du dernier prestige : le niveau se calcule
 * sur ce qui a été gagné DEPUIS, ce qui rouvre la courbe sans jamais toucher
 * au grand livre. L'XP totale, elle, reste monotone — les classements gardent
 * donc leur sens d'un prestige à l'autre.
 */
export function xpLevel(xp: number, prestige = 0, prestigeBase = 0): XpLevel {
  const total = Math.max(0, Math.floor(xp))
  const cycle = Math.max(0, total - prestigeBase)
  const level = levelForXp(cycle)
  const floor = xpForLevel(level)
  const isMax = level >= MAX_LEVEL
  const ceiling = isMax ? null : xpForLevel(level + 1)
  const span = isMax ? 1 : Math.max(1, (ceiling as number) - floor)
  const name = titleForLevel(level)
  const nextName = isMax ? null : titleForLevel(level + 1)

  return {
    name,
    level,
    pct: isMax ? 100 : Math.min(100, Math.max(0, Math.round(((cycle - floor) / span) * 100))),
    toNext: isMax ? 0 : (ceiling as number) - cycle,
    isMax,
    next: nextName === name ? null : nextName,
    current: total,
    floor,
    ceiling,
    prestige,
  }
}

// ─────────────────────── Source de vérité serveur ───────────────────────
//
// `my_progress()` renvoie en UNE requête tout ce qu'un écran de progression
// affiche, calculé par le serveur. C'est ce qui garantit que le client ne peut
// plus annoncer un niveau différent de celui que la base reconnaît — l'un des
// défauts relevés par l'audit du 29/09.

export type Progress = {
  xpTotal: number
  prestige: number
  level: number
  /** Titre dérivé du niveau. */
  title: string
  /** Statut de compte (« Fondateur »…), indépendant du niveau. */
  accountTitle: string | null
  levelXp: number
  levelSpan: number
  pct: number
  nextLevelAt: number
  isMax: boolean
}

export async function fetchProgress(): Promise<Progress | null> {
  const { data, error } = await supabase.rpc('my_progress').maybeSingle()
  if (error || !data) return null
  const r = data as Record<string, unknown>
  return {
    xpTotal: Number(r.xp_total ?? 0),
    prestige: Number(r.prestige ?? 0),
    level: Number(r.level ?? 1),
    title: String(r.title ?? 'Rookie'),
    accountTitle: (r.account_title as string | null) ?? null,
    levelXp: Number(r.level_xp ?? 0),
    levelSpan: Number(r.level_span ?? 1),
    pct: Number(r.pct ?? 0),
    nextLevelAt: Number(r.next_level_at ?? 0),
    isMax: Boolean(r.is_max),
  }
}

/** Passe un prestige. Le serveur revérifie le niveau 100 — le client ne peut
 *  pas l'obtenir en avance. */
export async function claimPrestige(): Promise<{ ok: boolean; prestige: number; level: number }> {
  const { data, error } = await supabase.rpc('claim_prestige').maybeSingle()
  if (error || !data) return { ok: false, prestige: 0, level: 1 }
  const r = data as Record<string, unknown>
  return {
    ok: Boolean(r.ok),
    prestige: Number(r.prestige ?? 0),
    level: Number(r.level ?? 1),
  }
}

// ─────────────────────── Prestige — ouverture et libellé ───────────────────────
//
// Ces deux helpers vivent ici plutôt que dans PrestigeSheet.tsx pour que le
// composant n'exporte QU'un composant : c'est ce que demande le rafraîchissement
// à chaud de Vite, et les autres overlays du projet paient encore ce défaut.

const PRESTIGE_CHANNEL = 'revs:prestige'

/** Ouvre la feuille de prestige depuis n'importe où dans l'application. */
export function openPrestige(): void {
  window.dispatchEvent(new CustomEvent(PRESTIGE_CHANNEL))
}

/** Canal écouté par PrestigeSheet. */
export const PRESTIGE_EVENT = PRESTIGE_CHANNEL

/** Chiffre romain jusqu'à X, puis repli sur le nombre. Un prestige se lit
 *  mieux en romain — c'est une distinction, pas une quantité. */
export function romanPrestige(n: number): string {
  const R = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
  return n >= 1 && n <= 10 ? R[n] : String(n)
}
