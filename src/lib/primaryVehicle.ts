// ═══════════════ LE VÉHICULE PRINCIPAL D'UN UTILISATEUR ═══════════════
//
// POURQUOI CE FICHIER EXISTE
// Deux surfaces montrent « la voiture » de quelqu'un : le hero du Profil et,
// depuis la refonte des Paramètres, le hero des Paramètres. Tant que chacune
// choisissait sa photo dans son coin, rien ne garantissait qu'elles montrent
// la même — et le jour où l'utilisateur pourra désigner lui-même sa voiture,
// il aurait fallu corriger les deux.
//
// Ce module est donc LA règle, à un seul endroit.
//
// ── CE QU'IL NE FAIT PAS ──
// Il ne crée aucune table, aucune colonne, aucun stockage. Il ne fait que
// choisir, parmi des données qui existent déjà :
//   · `spots`                — les voitures réellement photographiées ;
//   · `profiles.garage_brand`— la marque que l'utilisateur a déclarée.
//
// Le choix de SA voiture par l'utilisateur n'est volontairement pas implémenté
// ici : c'est une évolution à part. Quand elle arrivera, il suffira d'ajouter
// une préférence explicite au début de `pickPrimaryVehicle()` — les deux heros
// suivront sans être touchés. C'est précisément le but.

import type { Spot } from './spots'
import { rarityRank } from '../components/CollectorCard'

export type PrimaryVehicle = {
  /** Le spot retenu, s'il en existe un. */
  spot: Spot | null
  /** `true` quand l'utilisateur a DÉSIGNÉ cette voiture (et non déduite). */
  chosen?: boolean
  /** Sa photo — déjà floutée côté plaques, comme toute photo de spot. */
  photo: string | null
  /** « Porsche 911 GT3 », ou la marque déclarée à défaut de photo. */
  label: string | null
  /** La marque seule, utile pour une ligne courte. */
  brand: string | null
}

const EMPTY: PrimaryVehicle = { spot: null, photo: null, label: null, brand: null }

/**
 * Choisit le véhicule à mettre en avant.
 *
 * L'ordre de préférence :
 *   1. le plus rare des spots de la marque déclarée en garage — c'est la
 *      voiture que l'utilisateur dit être la sienne, et on en a une photo ;
 *   2. à défaut, le plus rare de tous ses spots — c'est la règle qu'appliquait
 *      déjà le hero du Profil, conservée à l'identique pour ne rien changer
 *      à ce que les gens voient aujourd'hui ;
 *   3. à défaut de photo, la marque déclarée seule, en texte.
 *
 * `garageBrand` peut être nul : dans ce cas le résultat est exactement celui
 * de l'ancien hero du Profil.
 */
export function pickPrimaryVehicle(
  spots: Spot[],
  garageBrand?: string | null,
  primarySpotId?: string | null,
): PrimaryVehicle {
  // ── LE CHOIX EXPLICITE PASSE AVANT TOUT (01/10/2026) ──
  // `profiles.primary_spot_id` est LA source de vérité : c'est la voiture que
  // l'utilisateur a désignée. Tout ce qui suit n'est qu'une déduction pour
  // ceux qui n'ont rien désigné — et une déduction ne doit jamais écraser une
  // décision.
  if (primarySpotId) {
    const chosen = spots.find((s) => s.id === primarySpotId)
    if (chosen) {
      const label = [chosen.brand, chosen.model].filter(Boolean).join(' ').trim()
      return {
        spot: chosen,
        photo: chosen.garage_render_url ?? chosen.photo_url,
        label: label || null,
        brand: chosen.brand ?? null,
        chosen: true,
      }
    }
  }

  const withPhoto = spots.filter((s) => s.photo_url)
  const byRarity = (list: Spot[]) =>
    [...list].sort((a, b) => rarityRank(b.rarity) - rarityRank(a.rarity))[0] ?? null

  const declared = (garageBrand ?? '').trim()
  const matching = declared
    ? withPhoto.filter((s) =>
        (s.brand ?? '').toLowerCase().includes(declared.toLowerCase()),
      )
    : []

  const spot = byRarity(matching.length ? matching : withPhoto)
  if (spot) {
    const label = [spot.brand, spot.model].filter(Boolean).join(' ').trim()
    return {
      spot,
      photo: spot.photo_url,
      label: label || declared || null,
      brand: spot.brand ?? declared ?? null,
    }
  }
  if (declared) {
    return { ...EMPTY, label: declared, brand: declared }
  }
  return EMPTY
}
