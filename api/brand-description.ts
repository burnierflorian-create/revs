import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const MODEL = 'claude-sonnet-4-6'

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// Same shape as in src/lib/brands.ts — duplicated here because Vercel
// serverless functions can't import from the Vite client tree. Kept
// intentionally minimal (no logos / colors needed server-side).
// Catalogue serveur — GÉNÉRÉ depuis src/lib/brands.ts.
//
// Il était écrit à la main et avait dérivé : 36 entrées ici contre 69 côté
// client, donc 33 marques renvoyaient « Marque inconnue » dès qu'on ouvrait
// leur fiche. Régénéré avec :
//   node -e "…" (voir le rapport de la mission Automobile du 01/10/2026)
// Les fonctions serverless ne peuvent pas importer l'arbre Vite ; la copie
// est donc inévitable, mais elle n'a plus à être tenue à jour à la main.
const KNOWN: Record<string, { name: string; type: 'brand' | 'tuner' }> = {
  'bugatti': { name: 'Bugatti', type: 'brand' },
  'pagani': { name: 'Pagani', type: 'brand' },
  'koenigsegg': { name: 'Koenigsegg', type: 'brand' },
  'rimac': { name: 'Rimac', type: 'brand' },
  'ferrari': { name: 'Ferrari', type: 'brand' },
  'lamborghini': { name: 'Lamborghini', type: 'brand' },
  'mclaren': { name: 'McLaren', type: 'brand' },
  'aston-martin': { name: 'Aston Martin', type: 'brand' },
  'porsche': { name: 'Porsche', type: 'brand' },
  'lotus': { name: 'Lotus', type: 'brand' },
  'maserati': { name: 'Maserati', type: 'brand' },
  'bentley': { name: 'Bentley', type: 'brand' },
  'rolls-royce': { name: 'Rolls-Royce', type: 'brand' },
  'range-rover': { name: 'Range Rover', type: 'brand' },
  'mercedes-benz': { name: 'Mercedes-Benz', type: 'brand' },
  'bmw': { name: 'BMW', type: 'brand' },
  'audi': { name: 'Audi', type: 'brand' },
  'alpine': { name: 'Alpine', type: 'brand' },
  'cupra': { name: 'Cupra', type: 'brand' },
  'hyundai-n': { name: 'Hyundai N', type: 'brand' },
  'lexus': { name: 'Lexus', type: 'brand' },
  'alfa-romeo': { name: 'Alfa Romeo', type: 'brand' },
  'toyota': { name: 'Toyota', type: 'brand' },
  'nissan': { name: 'Nissan', type: 'brand' },
  'honda': { name: 'Honda', type: 'brand' },
  'subaru': { name: 'Subaru', type: 'brand' },
  'mazda': { name: 'Mazda', type: 'brand' },
  'mitsubishi': { name: 'Mitsubishi', type: 'brand' },
  'chevrolet': { name: 'Chevrolet', type: 'brand' },
  'dodge': { name: 'Dodge', type: 'brand' },
  'ford': { name: 'Ford', type: 'brand' },
  'shelby': { name: 'Shelby', type: 'brand' },
  'brabus': { name: 'Brabus', type: 'tuner' },
  'mansory': { name: 'Mansory', type: 'tuner' },
  'ruf': { name: 'RUF', type: 'tuner' },
  'abt': { name: 'ABT', type: 'tuner' },
  'hennessey': { name: 'Hennessey', type: 'brand' },
  'ssc': { name: 'SSC North America', type: 'brand' },
  'zenvo': { name: 'Zenvo', type: 'brand' },
  'pininfarina': { name: 'Pininfarina', type: 'brand' },
  'apollo': { name: 'Apollo', type: 'brand' },
  'w-motors': { name: 'W Motors', type: 'brand' },
  'noble': { name: 'Noble', type: 'brand' },
  'tvr': { name: 'TVR', type: 'brand' },
  'donkervoort': { name: 'Donkervoort', type: 'brand' },
  'radical': { name: 'Radical', type: 'brand' },
  'de-tomaso': { name: 'De Tomaso', type: 'brand' },
  'jaguar': { name: 'Jaguar', type: 'brand' },
  'land-rover': { name: 'Land Rover', type: 'brand' },
  'infiniti': { name: 'Infiniti', type: 'brand' },
  'genesis': { name: 'Genesis', type: 'brand' },
  'caterham': { name: 'Caterham', type: 'brand' },
  'ariel': { name: 'Ariel', type: 'brand' },
  'ktm': { name: 'KTM', type: 'brand' },
  'suzuki': { name: 'Suzuki', type: 'brand' },
  'kia': { name: 'Kia', type: 'brand' },
  'cadillac': { name: 'Cadillac', type: 'brand' },
  'gmc': { name: 'GMC', type: 'brand' },
  'jeep': { name: 'Jeep', type: 'brand' },
  'novitec': { name: 'Novitec', type: 'tuner' },
  'techart': { name: 'TechArt', type: 'tuner' },
  'singer': { name: 'Singer', type: 'tuner' },
  'g-power': { name: 'G-Power', type: 'tuner' },
  'ac-schnitzer': { name: 'AC Schnitzer', type: 'tuner' },
  'alpina': { name: 'Alpina', type: 'tuner' },
  'manhart': { name: 'Manhart', type: 'tuner' },
  'larte': { name: 'Larte Design', type: 'tuner' },
  'prior-design': { name: 'Prior Design', type: 'tuner' },
  'liberty-walk': { name: 'Liberty Walk', type: 'tuner' },
}

const BRAND_SYSTEM = `Tu es un journaliste automobile francophone. Décris la marque automobile demandée en français, dans un ton enthousiaste mais factuel. Tu dois renvoyer EXACTEMENT 2 à 3 phrases (40 à 70 mots au total), en texte brut, sans markdown, sans titre, sans listes. Mentionne brièvement son histoire, son ADN (sport, luxe, hypercar…) et un ou deux modèles iconiques. Pas de superlatifs creux du type "la meilleure marque du monde".`

const TUNER_SYSTEM = `Tu es un journaliste automobile francophone. Décris ce PRÉPARATEUR automobile en français, dans un ton enthousiaste mais factuel. Tu dois renvoyer EXACTEMENT 2 à 3 phrases (50 à 80 mots au total), en texte brut, sans markdown, sans titre, sans listes. Explique CLAIREMENT : (1) qu'il s'agit d'un préparateur (pas d'un constructeur), (2) son histoire / ses origines, (3) quelles marques de voitures il transforme et ce qui caractérise son style (puissance extrême, esthétique chargée, fidélité au châssis d'origine, etc.).`


// ═══════════ FICHE COMPLÈTE — GÉNÉRÉE UNE SEULE FOIS PAR MARQUE ET PAR LANGUE ═══════════
//
// Ce prompt remplace les deux précédents pour le CONTENU DE FICHE. Ils restent
// utilisés pour la description courte des 19 marques déjà en cache, qu'on ne
// régénère pas : elles sont payées, elles s'affichent toujours.
//
// Deux consignes portent tout le reste :
//   · « N'invente rien » — une fiche courte et sûre vaut mieux qu'une fiche
//     longue et fausse. Les champs incertains doivent être omis, pas devinés.
//   · La sortie est du JSON STRICT : du texte libre obligerait le client à
//     deviner où commence une période, et c'est exactement ce qu'on veut
//     éviter en stockant des tableaux structurés.
const CONTENT_SYSTEM = (lang: 'fr' | 'en', isTuner: boolean) => `You are an automotive historian writing a reference card for the REVS app.

Write in ${lang === 'fr' ? 'FRENCH' : 'ENGLISH'}. Return STRICT JSON only — no markdown, no code fence, no commentary.

${isTuner
  ? 'The subject is a TUNER / coachbuilder, NOT a car manufacturer. Make that distinction explicit, and say which marques it modifies and what characterises its style.'
  : 'The subject is a car MANUFACTURER.'}

Schema — omit any field you are not confident about rather than guessing:
{
  "summary": "2-3 sentences, 40-70 words. What this marque is and its DNA.",
  "founded_year": 1955,
  "founder": "Jean Rédélé",
  "origin_country": "France",
  "history": "4-8 sentences of continuous prose. Origins, how the marque evolved, what defines it today.",
  "key_moments": [{"year": "1955", "title": "Création", "text": "One or two sentences."}],
  "innovations": ["Short factual item", "..."],
  "iconic_models": [{"name": "A110", "years": "1961-1977", "text": "One sentence on why it matters."}],
  "facts": ["A genuinely interesting, verifiable fact.", "..."]
}

RULES — these matter more than completeness:
- Never invent a year, a name, a figure, a model or a palmarès. If unsure, omit the field or the entry entirely.
- 3 to 6 key_moments, 2 to 5 iconic_models, 2 to 5 facts, 0 to 5 innovations. Fewer is fine. Empty array is fine.
- Mention motorsport only where it genuinely matters to the marque.
- No hollow superlatives ("the best brand in the world").
- Plain text inside the JSON values: no markdown, no links.`

/** `content_version` attendue. L'incrémenter ici — et NULLE PART ailleurs —
 *  est le seul moyen de déclencher une réécriture éditoriale ; aucun geste
 *  utilisateur ne peut le faire.
 *
 *  Passée à 2 le 01/10/2026 : les 19 fiches d'avant la refonte sont en
 *  version 1 et n'ont qu'une description courte. La version 2 les fait
 *  régénérer au format structuré — UNE fois chacune, au premier visiteur,
 *  puis plus jamais. C'est précisément l'usage pour lequel ce compteur
 *  existe : une actualisation éditoriale décidée côté serveur, jamais
 *  déclenchée par un utilisateur qui ouvre une page. */
const CONTENT_VERSION = 2

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non autorisée.' })
    return
  }
  if (!SUPABASE_URL || !SERVICE_ROLE || !process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'Service indisponible — réessaie plus tard.' })
    return
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  })

  // Require a valid Supabase user — the call hits the paid Claude API.
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const { data: u } = token
    ? await admin.auth.getUser(token)
    : { data: { user: null } }
  if (!u?.user) {
    res.status(401).json({ error: 'Non autorisé. Reconnecte-toi.' })
    return
  }

  const body =
    typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  const slug = String((body as { brand?: string }).brand ?? '').toLowerCase()
  const meta = KNOWN[slug]
  if (!slug || !meta) {
    res.status(400).json({ error: 'Marque inconnue.' })
    return
  }

  const lang: 'fr' | 'en' =
    String((body as { lang?: string }).lang ?? 'fr').startsWith('en') ? 'en' : 'fr'
  // `full=1` → la fiche structurée. Sans lui, on garde le comportement
  // historique (description courte), pour ne rien casser chez les appelants
  // existants.
  const wantFull = (body as { full?: boolean }).full === true

  // ─────────── FICHE COMPLÈTE ───────────
  if (wantFull) {
    // 1. LE VERROU. `claim_brand_content` est atomique : si la fiche existe
    //    déjà à la bonne version il renvoie 'ready' et AUCUN appel payant
    //    n'est émis ; si une autre requête génère déjà, il renvoie 'pending'
    //    et on se contente d'attendre. Une seule génération par marque et par
    //    langue, quel que soit le nombre d'utilisateurs simultanés.
    const { data: claim } = await admin.rpc('claim_brand_content', {
      p_brand: slug,
      p_lang: lang,
      p_version: CONTENT_VERSION,
    })

    if (claim === 'ready' || claim === 'pending') {
      const { data: row } = await admin.rpc('brand_content', {
        p_brand: slug,
        p_lang: lang,
      })
      const content = Array.isArray(row) ? row[0] : row
      res.status(200).json({
        content: content ?? null,
        cached: true,
        generating: claim === 'pending' && !content,
      })
      return
    }

    // 2. On a gagné le verrou : à nous de générer. UN SEUL appel Claude.
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    try {
      const r = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: [
          {
            type: 'text',
            text: CONTENT_SYSTEM(lang, meta.type === 'tuner'),
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: `${meta.type === 'tuner' ? 'Tuner' : 'Marque'} : ${meta.name}.` }],
      })
      const block = r.content.find((b) => b.type === 'text')
      const raw = block && 'text' in block ? block.text.trim() : ''
      // Le modèle encadre parfois son JSON malgré la consigne.
      const json = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
      const parsed = JSON.parse(json) as Record<string, unknown>

      const arr = (v: unknown) => (Array.isArray(v) ? v : [])
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

      await admin.from('brand_descriptions').upsert(
        {
          brand: slug,
          lang,
          status: 'ready',
          content_version: CONTENT_VERSION,
          summary: str(parsed.summary),
          founded_year:
            typeof parsed.founded_year === 'number' ? parsed.founded_year : null,
          founder: str(parsed.founder),
          origin_country: str(parsed.origin_country),
          history: str(parsed.history),
          key_moments: arr(parsed.key_moments),
          innovations: arr(parsed.innovations),
          iconic_models: arr(parsed.iconic_models),
          facts: arr(parsed.facts),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'brand,lang' },
      )

      const { data: row } = await admin.rpc('brand_content', {
        p_brand: slug,
        p_lang: lang,
      })
      res.status(200).json({
        content: Array.isArray(row) ? row[0] : row,
        cached: false,
      })
    } catch (e) {
      console.error('[brand-content] génération échouée:', e)
      // On RELÂCHE le verrou : le laisser à `pending` condamnerait la marque
      // à n'être jamais générée. `failed` est reprenable au prochain appel.
      await admin
        .from('brand_descriptions')
        .update({ status: 'failed' })
        .eq('brand', slug)
        .eq('lang', lang)
      res.status(502).json({ error: 'Fiche indisponible — réessaie plus tard.' })
    }
    return
  }

  // ─────────── DESCRIPTION COURTE (comportement historique) ───────────
  // Cache hit: return immediately, skip Claude entirely.
  const { data: cached } = await admin
    .from('brand_descriptions')
    .select('description')
    .eq('brand', slug)
    .maybeSingle()
  if (cached?.description) {
    res.status(200).json({ description: cached.description, cached: true })
    return
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const system = meta.type === 'tuner' ? TUNER_SYSTEM : BRAND_SYSTEM
  try {
    const r = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 350,
      system: [
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        {
          role: 'user',
          content:
            meta.type === 'tuner'
              ? `Préparateur : ${meta.name}.`
              : `Marque : ${meta.name}.`,
        },
      ],
    })
    const block = r.content.find((b) => b.type === 'text')
    const text = block && 'text' in block ? block.text.trim() : ''
    if (!text) {
      res.status(502).json({ error: 'Description indisponible — réessaie plus tard.' })
      return
    }
    await admin
      .from('brand_descriptions')
      .upsert({ brand: slug, description: text }, { onConflict: 'brand' })
    res.status(200).json({ description: text, cached: false })
  } catch (e) {
    console.error('[brand-description] failed:', e)
    res.status(500).json({ error: 'Description indisponible — réessaie plus tard.' })
  }
}
