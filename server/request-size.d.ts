// Déclarations pour server/request-size.js — permet à detect-plate.ts
// (TypeScript) d'importer le même module que identify-car.js (JavaScript).
import type { VercelRequest } from '@vercel/node'

export declare const MAX_REQUEST_BYTES: number

export type RequestTooLarge = {
  status: 413
  body: { error: string }
}

/** null = la requête passe ; sinon le refus 413 à renvoyer tel quel. */
export declare function checkRequestSize(
  req: VercelRequest,
): RequestTooLarge | null
