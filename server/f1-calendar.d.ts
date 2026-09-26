// Déclarations pour server/f1-calendar.js — permet à api/f1.ts (TypeScript)
// d'importer le portail calendrier.

export declare const DEFAULT_WINDOW: {
  readonly beforeHours: number
  readonly afterHours: number
}

export type F1SessionHit = {
  /** FP1, FP2, FP3, Sprint, SprintQualifying, Qualifying ou Race. */
  label: string
  /** Horodatage ISO de la session. */
  at: string
  /** Nom du Grand Prix. */
  race: string
}

export type F1CalendarVerdict =
  | { active: true; reason: 'f1_session_detected'; sessions: F1SessionHit[] }
  | {
      active: false
      reason: 'no_f1_session' | 'calendar_unavailable'
      detail?: string
      sessions?: F1SessionHit[]
    }

/** Fail-closed : renvoie active=false si le calendrier est injoignable. */
export declare function hasF1SessionNear(opts?: {
  beforeHours?: number
  afterHours?: number
  now?: Date
}): Promise<F1CalendarVerdict>
