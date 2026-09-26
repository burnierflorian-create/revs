// ─────────────────────── Portail calendrier F1 ───────────────────────
//
// Étape A du dispositif de réduction de coût : un test GRATUIT, sans aucun
// appel IA, qui décide si la synchronisation F1 coûteuse (étape B, ~30 appels
// Sonnet + web_search) a une raison de tourner aujourd'hui.
//
// ── Pourquoi PAS OpenF1 ──
// La spec initiale visait api.openf1.org. Testé le 26/09/2026, cette API
// renvoie 401 avec le message : « Live F1 session in progress. Global API
// access (including past sessions) is restricted to authenticated users until
// the session ends. » Autrement dit elle se ferme aux appels anonymes
// PENDANT les sessions live — précisément les moments où ce test doit
// fonctionner. Inutilisable ici sans clé payante.
//
// ── Source retenue : Jolpica / Ergast ──
// api.jolpi.ca est déjà utilisé par scripts/sync-f1-grid.mjs, répond 200,
// n'impose aucune restriction pendant les sessions, et livre le calendrier
// complet avec le détail de CHAQUE session (essais, qualifs, sprint, course).
//
// Ce fichier vit hors de api/ : tout fichier placé dans api/ deviendrait une
// fonction serverless Vercel de plus.

const SCHEDULE_URL = (year) =>
  `https://api.jolpi.ca/ergast/f1/${year}/?format=json&limit=40`

const FETCH_TIMEOUT_MS = 8000

/** Fenêtre par défaut, en heures, autour de maintenant.
 *
 *  `before: 30` couvre le LENDEMAIN d'une course : c'est le moment où les
 *  classements, points et « dernier GP » ont réellement changé, donc le seul
 *  où la synchronisation a de la valeur. Sans cette borne arrière, le dispositif
 *  serait cassé par construction — le garde-fou de fraîcheur à 7 jours
 *  rafraîchirait tout dès le vendredi (avant la course), puis sauterait le
 *  dimanche et le lundi comme « déjà frais », et les classements resteraient
 *  systématiquement une course en retard.
 *
 *  `after: 48` couvre « aujourd'hui ou demain » comme demandé. */
export const DEFAULT_WINDOW = { beforeHours: 30, afterHours: 48 }

function parseSession(dateStr, timeStr) {
  if (!dateStr) return null
  const iso = timeStr ? `${dateStr}T${timeStr}` : `${dateStr}T12:00:00Z`
  const t = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`)
  return Number.isFinite(t) ? t : null
}

/** Toutes les sessions d'un week-end, course comprise, en millisecondes. */
function sessionsOf(race) {
  const out = []
  const push = (label, node) => {
    const t = parseSession(node?.date, node?.time)
    if (t !== null) out.push({ label, at: t })
  }
  push('FP1', race.FirstPractice)
  push('FP2', race.SecondPractice)
  push('FP3', race.ThirdPractice)
  push('Sprint', race.Sprint)
  push('SprintQualifying', race.SprintQualifying)
  push('Qualifying', race.Qualifying)
  const raceAt = parseSession(race.date, race.time)
  if (raceAt !== null) out.push({ label: 'Race', at: raceAt })
  return out
}

async function fetchOnce(year) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const r = await fetch(SCHEDULE_URL(year), {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j = await r.json()
    const races = j?.MRData?.RaceTable?.Races
    if (!Array.isArray(races)) throw new Error('forme inattendue')
    return races
  } finally {
    clearTimeout(timer)
  }
}

// Mémo par année. Le calendrier d'une saison ne bouge pratiquement pas, et
// Jolpica limite le débit : un HTTP 429 a été observé en rafale le 26/09/2026.
// Le cache vit le temps de l'instance serverless, donc il ne remplace pas la
// reprise ci-dessous — il évite juste de refrapper l'API plusieurs fois dans
// une même invocation.
const CACHE_TTL_MS = 6 * 3600000
const _cache = new Map()

async function fetchSchedule(year) {
  const hit = _cache.get(year)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.races

  // Une seule reprise, après une courte pause : couvre le 429 et les coupures
  // réseau transitoires sans transformer le portail en source de latence.
  let lastErr
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500))
    try {
      const races = await fetchOnce(year)
      _cache.set(year, { at: Date.now(), races })
      return races
    } catch (e) {
      lastErr = e
      console.warn(
        `[f1-calendar] tentative ${attempt + 1}/2 échouée : ${e?.message ?? e}`,
      )
    }
  }
  throw lastErr
}

/**
 * Y a-t-il une session F1 dans la fenêtre autour de maintenant ?
 *
 * FAIL-CLOSED : si le calendrier est injoignable, on renvoie `active: false`.
 * Ne pas synchroniser un jour de plus ne coûte rien ; lancer 30 appels Sonnet
 * « au cas où » coûte ~1,80 $. Le doute se paie dans le bon sens.
 *
 * @param {{beforeHours?: number, afterHours?: number, now?: Date}} [opts]
 * @returns {Promise<{active: boolean, reason: string, detail?: string, sessions?: {label: string, at: string, race: string}[]}>}
 */
export async function hasF1SessionNear(opts = {}) {
  const beforeHours = opts.beforeHours ?? DEFAULT_WINDOW.beforeHours
  const afterHours = opts.afterHours ?? DEFAULT_WINDOW.afterHours
  const now = (opts.now ?? new Date()).getTime()
  const from = now - beforeHours * 3600000
  const to = now + afterHours * 3600000
  const year = new Date(now).getUTCFullYear()

  let races
  try {
    races = await fetchSchedule(year)
  } catch (e) {
    console.error(
      `[f1-calendar] calendrier ${year} injoignable (${e?.message ?? e}) — on ne synchronise pas`,
    )
    return { active: false, reason: 'calendar_unavailable', detail: String(e?.message ?? e) }
  }

  const hits = []
  for (const race of races) {
    for (const s of sessionsOf(race)) {
      if (s.at >= from && s.at <= to) {
        hits.push({
          label: s.label,
          at: new Date(s.at).toISOString(),
          race: race.raceName ?? `round ${race.round}`,
        })
      }
    }
  }

  if (hits.length === 0) {
    return { active: false, reason: 'no_f1_session' }
  }
  return { active: true, reason: 'f1_session_detected', sessions: hits }
}
