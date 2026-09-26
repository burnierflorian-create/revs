// Déclarations pour server/ai-gate.js — permet à detect-plate.ts (TypeScript)
// d'importer le même module que identify-car.js (JavaScript) sans dupliquer la
// logique du portail.
import type { VercelRequest } from '@vercel/node'

export declare const AI_ENDPOINTS: {
  readonly IDENTIFY: 'identify-car'
  readonly DETECT_PLATE: 'detect-plate'
}

export type AiAccessGranted = {
  ok: true
  /** Toujours issu du jeton vérifié, jamais du corps de la requête. */
  userId: string
  tier: string
  used: number
  limit: number
}

export type AiAccessDenied = {
  ok: false
  /** 401 (auth), 429 (cooldown / quota) ou 503 (portail indisponible). */
  status: number
  reason:
    | 'missing_token'
    | 'invalid_token'
    | 'cooldown'
    | 'quota_exceeded'
    | 'gate_unavailable'
  body: { error: string; message: string }
}

export declare function requireAiAccess(
  req: VercelRequest,
  endpoint: string,
): Promise<AiAccessGranted | AiAccessDenied>
