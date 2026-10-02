// Déclarations pour server/garage-visual.js — permet à api/garage-render.ts
// (TypeScript, runtime edge) d'importer les helpers purs du module.
//
// Seuls les helpers SANS dépendance Node sont déclarés ici. `providers` et
// `pickProvider` utilisent `Buffer`, indisponible en edge : les omettre évite
// qu'un appel y soit écrit par mégarde depuis la fonction edge.

export declare const GARAGE_VISUAL_VERSION: number

export type GarageVehicle = {
  brand?: string | null
  model?: string | null
  color?: string | null
  confidence?: number | null
  ident_locked?: boolean | null
  verified?: boolean | null
}

/** Le prompt de génération, partagé par tous les moteurs. */
export declare function buildPrompt(vehicle: GarageVehicle): string

/** `marque|modèle|famille-de-couleur` — sans la version du prompt. */
export declare function cacheKey(vehicle: GarageVehicle): string

/** Famille de couleur normalisée ('blue', 'white', 'black'…). */
export declare function colourFamily(raw?: string | null): string

/**
 * Le Garage ne génère que sur une identité validée. Voir le long commentaire
 * du module : un beau rendu de la mauvaise voiture est pire que pas de rendu.
 */
export declare function canRender(
  vehicle: GarageVehicle,
): { ok: true } | { ok: false; reason: string }
