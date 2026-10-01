// Déclarations pour server/plate-detect.js — permet à api/detect-plate.ts
// (TypeScript) d'importer le détecteur local écrit en JavaScript.

export declare const MODEL_SHA: string
export declare const CONF: number

export type DetectedPlate = {
  x: number
  y: number
  width: number
  height: number
  score: number
}

/** null = le modèle n'a pas pu être chargé (absent ou empreinte fausse). */
export declare function getSession(): Promise<unknown | null>

/**
 * null = DÉTECTION IMPOSSIBLE. À ne jamais confondre avec `plates: []`, qui
 * signifie « on a regardé, il n'y a rien ».
 */
export declare function detectPlates(
  buf: Buffer,
  sharpLib: unknown,
): Promise<{ plates: DetectedPlate[]; W: number; H: number } | null>
