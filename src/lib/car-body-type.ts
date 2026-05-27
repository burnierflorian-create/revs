import type { BodyType } from '../components/CarSilhouettes'
import type { SpotCategory } from './spots'

// ─────────────────────── Brand+model → body type ───────────────────────
// First we try MODEL-SPECIFIC overrides (matches the more detailed
// silhouettes), then generic body-type rules. Last-resort fallbacks
// derive from category / brand-class / keyword cues.

const MODEL_RULES: { match: RegExp; type: BodyType }[] = [
  // Model-specific silhouettes (highest priority). Order matters —
  // most specific patterns first (e.g. GT Roadster before any other
  // Mercedes-AMG GT match).
  { match: /\bmercedes\b.*\bamg gt\b.*(roadster|cabriolet|spider)\b/i, type: 'mercedes-amg-gt-roadster' },
  { match: /\bporsche\b.*\bcayenne (coupe|coupé)\b/i, type: 'porsche-cayenne-coupe' },
  { match: /\bporsche\b.*\b(911|carrera|targa|gt2|gt3)\b/i, type: 'porsche-911' },
  { match: /\bferrari\b/i, type: 'ferrari-berlinetta' },
  { match: /\blamborghini\b|\blambo\b/i, type: 'lambo-wedge' },
  { match: /\bmclaren\b/i, type: 'mclaren' },
  { match: /\bbugatti\b/i, type: 'bugatti' },
  { match: /\bmercedes\b.*\bgle (coupe|coupé)\b/i, type: 'mercedes-gle-coupe' },
  { match: /\bbmw\b.*\bi4\b/i, type: 'bmw-i4' },
  { match: /\bbmw\b.*\b(3 series|série 3|serie 3|4 series|série 4|m3\b|m4\b|330|340|420|430|440)\b/i, type: 'bmw-3-series' },
  { match: /\brange rover\b|\bland rover\b/i, type: 'range-rover' },
  { match: /\brolls[- ]?royce\b|\brolls\b/i, type: 'rolls-royce' },
  { match: /\bbentley\b/i, type: 'bentley' },
  { match: /\baudi\b.*\btt\b/i, type: 'audi-tt-rs' },
  { match: /\btoyota\b.*\b(gt|gr)[- ]?86\b|\b(gt|gr)[- ]?86\b|\bbrz\b/i, type: 'toyota-gt86' },
  { match: /\bnissan\b.*\bjuke\b/i, type: 'nissan-juke' },
]

const BODY_RULES: { match: RegExp; type: BodyType }[] = [
  // Generic body types
  { match: /\b(cayenne coupe|cayenne coupé|gle coupe|gle coupé|glc coupe|x4|x6|q3 sportback|q5 sportback|q8\b|range rover sport)/i, type: 'suv-coupe' },
  { match: /\b(pagani|koenigsegg|rimac|hennessey|gma t\.50|valkyrie|jesko|chiron|veyron|huayra|zonda|one[- ]?1|regera|ccx|ccr|tuatara)\b/i, type: 'hypercar' },
  { match: /\b(488|458|f8|f12|sf90|812|296|roma|portofino|enzo|laferrari|aventador|huracan|huracán|gallardo|murcielago|murciélago|countach|revuelto|temerario|720s|765lt|750s|p1|senna|elva|gtc4|carrera gt|918|gt2 rs|gt3|gt4|nsx|r8|i8|c8|corvette z06)\b/i, type: 'supercar' },
  { match: /\b(gt[- ]?r|gt86|brz|supra|silvia|s2000|civic type r|wrx|sti|evo|lancer evo|rx[- ]?7|rx[- ]?8|skyline|fairlady|mx[- ]?5|mr2)\b/i, type: 'jdm-sport' },
  { match: /\b(cayenne|macan|x5\b|x3\b|x7|q5|q7|gle\b|gls|glc\b|defender|discovery|cullinan|urus|dbx|levante|stelvio|grecale|purosangue|bentayga|gv80|gv70|x[ -]trail|xc60|xc90|qashqai|tucson|santa fe|cx-5|cx-30|cx-60|rav4|cr-v|tiguan|touareg|kodiaq)\b/i, type: 'suv' },
  { match: /\b(countryman|t[- ]?roc|t[- ]?cross|gla|q2|x1|2008|3008|kona|niro|hr[- ]?v|c[- ]?hr|crossland)\b/i, type: 'mini-suv' },
  { match: /\b(m5\b|m340|m440|m550|rs[3-7]\b|rs e[- ]?tron|c63|c43|e63|e53|cls|s63|s65|amg gt[ -]?4door|cts[- ]?v|ats[- ]?v|giulia (quadrifoglio|qv)|panamera|taycan|model s|polestar 2)\b/i, type: 'sport-sedan' },
  { match: /\b(5 series|série 5|7 series|série 7|a3 berline|a4\b|a5 sportback|a6\b|a7|a8|c[- ]?class|classe c|e[- ]?class|classe e|s[- ]?class|classe s|giulia|stelvio|model 3|camry|accord|altima|sentra|jetta|passat|civic sedan|corolla berline|focus berline|fusion|impala|crown|legacy)\b/i, type: 'sedan' },
]

const HYPERCAR_BRANDS = new Set(['pagani', 'koenigsegg', 'rimac', 'hennessey'])
const SUPERCAR_BRANDS = new Set(['aston martin', 'porsche', 'lotus'])

/** Pick the best silhouette for a spot. Returns either a model-specific
 *  type (highest fidelity) or a generic body type. */
export function bodyTypeFor(
  brand: string,
  model: string,
  category?: SpotCategory | string,
): BodyType {
  const full = `${brand} ${model}`.trim().toLowerCase()

  // 1. Model-specific overrides win (most detailed silhouettes).
  for (const rule of MODEL_RULES) {
    if (rule.match.test(full)) return rule.type
  }

  // 2. Generic body-type rules.
  for (const rule of BODY_RULES) {
    if (rule.match.test(full)) return rule.type
  }

  // 3. Category-based fallback.
  if (category === 'hypercar') return 'hypercar'
  if (category === 'supercar') return 'supercar'
  if (category === 'JDM') return 'jdm-sport'

  // 4. Brand-class fallbacks.
  const b = brand.trim().toLowerCase()
  if (HYPERCAR_BRANDS.has(b)) return 'hypercar'
  if (SUPERCAR_BRANDS.has(b)) return 'supercar'

  // 5. Last-resort textual heuristics on the model name.
  if (/\bcoupe\b|\bcoupé\b/i.test(model)) {
    return /\bsuv\b|x[46]\b|gle|q[58]\b|cayenne/i.test(full)
      ? 'suv-coupe'
      : 'sport-sedan'
  }
  if (/\bsuv\b|crossover/i.test(model)) return 'suv'

  // 6. Safe default.
  return 'sedan'
}
