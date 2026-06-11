// Stylised circuit silhouettes for the 2026 calendar, keyed by round.
// Each path is a closed loop drawn in a 0 0 100 60 viewBox, tuned to evoke
// the real layout's characteristic shape (Monaco's inverted-U, Monza's
// long-straight triangle, Suzuka's figure-of-eight crossover, …). They are
// recognisable approximations, not survey-accurate maps — enough for the
// home GP card to read as "that track" at a glance.
//
// Render with stroke #E8203A, no fill, on a full-width 60px-tall SVG.

export const CIRCUIT_VIEWBOX = '0 0 100 60'

const PATHS: Record<number, string> = {
  // 1 — Australie · Albert Park (lakeside parkland, long flowing oval)
  1: 'M14 38 C8 26 18 16 32 16 L62 17 C78 17 88 22 90 31 C92 40 84 46 70 45 L40 43 C26 42 20 46 14 38 Z',
  // 2 — Chine · Shanghai (the 上 "snail" — tight in-field, long back straight)
  2: 'M16 22 C20 14 34 14 40 20 C46 26 40 32 46 36 C54 41 50 30 60 30 L86 31 C92 31 92 39 86 39 L52 44 C30 47 12 40 16 22 Z',
  // 3 — Japon · Suzuka (figure-of-eight with the crossover bridge)
  3: 'M14 24 C18 14 34 16 40 24 C47 33 56 20 70 22 C86 24 90 36 78 42 C66 47 60 36 50 34 C40 32 36 44 24 42 C10 40 10 34 14 24 Z',
  // 4 — Bahreïn · Sakhir (compact, angular desert layout)
  4: 'M16 20 L48 18 C58 18 60 26 52 30 L66 30 C78 30 86 36 80 42 L30 44 C16 44 12 36 18 32 C24 28 22 21 16 20 Z',
  // 5 — Arabie saoudite · Jeddah (very long, narrow, fast street circuit)
  5: 'M10 26 C12 18 22 20 30 22 C44 26 40 18 52 20 C66 22 60 32 72 32 C82 32 80 24 88 28 C94 31 90 40 80 40 C60 40 64 34 50 36 C34 38 38 44 26 42 C14 40 8 34 10 26 Z',
  // 6 — Miami (sweeping curves around the stadium)
  6: 'M16 30 C12 18 26 14 38 18 C50 22 48 30 60 28 C74 26 72 16 84 22 C94 27 88 42 74 40 C58 38 60 44 46 44 C30 44 20 42 16 30 Z',
  // 7 — Canada · Gilles-Villeneuve (long island ribbon with a hairpin)
  7: 'M12 26 L40 24 C50 24 50 18 60 20 L84 24 C92 26 92 34 84 36 L74 35 C66 34 66 40 58 39 L20 36 C10 35 8 28 12 26 Z',
  // 8 — Monaco (the iconic inverted-U: harbour straight, Loews hairpin)
  8: 'M20 46 L22 24 C22 14 32 12 40 16 C46 19 44 26 52 25 C60 24 58 16 66 16 C78 16 82 26 78 34 C75 40 66 38 64 44 L62 47 C62 50 56 50 56 46 L57 36 C57 31 50 31 50 36 L50 46 C50 50 44 50 44 46 L44 34 C44 30 38 30 38 34 L37 47 C37 50 30 50 30 47 L31 30 C31 26 26 26 26 30 L26 46 C26 50 20 50 20 46 Z',
  // 9 — Espagne · Barcelona-Catalunya (long straight, Repsol, final chicane)
  9: 'M14 34 C12 22 22 16 36 16 L70 16 C84 16 92 22 90 30 C88 37 80 40 70 38 C62 36 60 42 52 42 L40 42 C34 42 34 47 28 46 C20 45 16 42 14 34 Z',
  // 10 — Autriche · Red Bull Ring (short, three long straights, triangular)
  10: 'M16 24 C18 16 28 16 34 22 L58 40 C64 45 74 44 80 38 C86 32 80 24 72 26 L40 32 C30 34 24 30 24 24 C24 20 18 20 16 24 Z',
  // 11 — Grande-Bretagne · Silverstone (fast flowing, wide arena)
  11: 'M14 30 C12 18 24 14 36 18 C48 22 52 16 64 18 C80 20 90 28 84 38 C78 46 64 42 54 40 C44 38 44 44 32 44 C18 44 16 40 14 30 Z',
  // 12 — Belgique · Spa-Francorchamps (long triangle through the forest)
  12: 'M12 40 C8 30 16 22 28 22 C36 22 36 14 46 16 C60 19 56 28 68 28 C82 28 78 18 88 22 C96 25 92 36 82 38 C66 40 70 46 54 46 L26 46 C18 46 14 44 12 40 Z',
  // 13 — Hongrie · Hungaroring (tight, twisty, "Monaco without walls")
  13: 'M16 26 C18 18 28 20 32 26 C36 32 30 36 38 38 C46 40 44 32 52 32 C60 32 56 40 64 40 C74 40 72 30 80 32 C88 34 84 44 72 44 L30 44 C16 44 14 32 16 26 Z',
  // 14 — Pays-Bas · Zandvoort (banked, dune-side, compact oval)
  14: 'M16 28 C12 18 24 14 38 18 L70 26 C82 29 88 24 86 34 C84 42 72 42 62 40 L34 34 C24 32 26 40 20 38 C14 36 18 32 16 28 Z',
  // 15 — Italie · Monza (the "temple of speed" — long straights, chicanes)
  15: 'M14 22 L24 20 C30 19 30 24 36 26 L78 38 C90 41 92 33 88 28 C84 23 74 26 66 24 L26 16 C18 14 12 18 14 22 Z M20 30 C16 36 22 44 32 42 L70 42 C80 42 78 34 70 34 L36 34 C28 34 24 30 20 30 Z',
  // 16 — Madrid · Madring (new hybrid street/permanent, sweeping)
  16: 'M16 26 C16 18 26 16 36 20 C46 24 46 18 58 20 C72 22 70 30 80 30 C90 30 88 40 78 40 C62 40 64 44 50 44 C36 44 24 42 18 36 C14 32 16 30 16 26 Z',
  // 17 — Azerbaïdjan · Baku (huge main straight + tight old-town section)
  17: 'M10 30 L70 28 C78 28 78 22 70 22 L40 22 C34 22 34 16 42 16 L82 18 C92 18 92 40 82 40 L24 40 C12 40 6 32 10 30 Z',
  // 18 — Singapour · Marina Bay (rectangular night street circuit)
  18: 'M16 20 L74 18 C84 18 86 26 78 28 L40 30 C50 30 50 36 60 36 L80 36 C88 36 86 44 78 44 L22 44 C14 44 12 36 20 34 L46 32 C36 32 36 26 26 26 L18 26 C12 26 12 20 16 20 Z',
  // 19 — USA · COTA, Austin (steep T1 + Maggotts-style esses)
  19: 'M18 46 L20 24 C20 16 30 16 32 24 C34 32 28 30 34 34 C42 39 40 24 52 26 C66 28 62 18 74 20 C86 22 84 34 74 34 C64 34 68 42 56 42 L24 44 C20 45 18 46 18 46 Z',
  // 20 — Mexico · Hermanos Rodríguez (stadium hairpin, long straight)
  20: 'M12 30 L60 28 C70 28 70 22 62 22 L44 22 C38 22 38 16 46 16 L78 18 C90 18 92 30 82 32 C72 34 76 40 64 40 L26 40 C14 40 8 32 12 30 Z',
  // 21 — Brésil · Interlagos (compact, anti-clockwise, the "Senna S")
  21: 'M18 22 C22 14 34 16 38 24 L46 40 C50 47 60 46 66 40 C74 32 84 34 84 26 C84 18 74 18 70 24 C66 30 58 26 54 20 C50 14 40 14 36 18 C32 22 26 20 24 18 C20 16 16 18 18 22 Z',
  // 22 — Las Vegas · Strip (long Strip straight, L-shaped)
  22: 'M10 36 L82 34 C90 34 90 26 82 26 L60 26 C54 26 54 20 62 20 L84 22 C94 22 94 42 84 42 L22 42 C12 42 6 38 10 36 Z',
  // 23 — Qatar · Lusail (fast flowing, motorbike-smooth oval)
  23: 'M14 32 C10 20 24 14 40 18 C52 21 52 28 64 26 C78 24 78 16 88 22 C96 27 90 40 76 38 C60 36 62 42 48 42 C30 42 18 42 14 32 Z',
  // 24 — Abu Dhabi · Yas Marina (two long straights, marina hairpins)
  24: 'M12 24 L52 22 C60 22 60 16 52 16 L30 16 C24 16 24 22 12 24 Z M12 24 C8 30 14 38 26 38 L70 38 C82 38 90 32 88 24 C86 18 76 20 70 24 C62 29 60 32 50 32 L26 30 C18 29 16 26 12 24 Z',
}

// Generic fallback loop for any round without a bespoke path.
const FALLBACK =
  'M16 30 C14 20 24 16 36 18 C48 20 50 16 62 18 C76 20 86 24 84 32 C82 40 70 42 58 40 C46 38 46 44 34 44 C20 44 18 40 16 30 Z'

export function circuitPath(round: number): string {
  return PATHS[round] ?? FALLBACK
}
