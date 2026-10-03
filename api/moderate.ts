// ═══════ LE BOT DE MODÉRATION — TRIER, PAS JUGER ═══════
//
// Appelé après un signalement. Son travail : classer un dossier, lui donner
// une priorité, et le remettre à un humain. Rien d'autre.
//
// ── CE QU'IL NE FAIT JAMAIS ──
// AUCUNE sanction. Ni suspension, ni bannissement, ni suppression de compte,
// ni même suppression d'un contenu — quelle que soit sa confiance, fût-elle
// de 0,99.
//
// La règle n'est pas tenue par ce fichier mais par la base (migration 0121) :
// `bot_verdict()` n'a plus aucune branche qui supprime ou sanctionne, et un
// déclencheur sur `user_sanctions` refuse toute ligne d'origine `auto`. Une
// erreur dans ce fichier ne peut donc pas produire de sanction automatique —
// c'est tout l'intérêt de l'écrire là-bas plutôt qu'ici.
//
// ── POURQUOI LES RÈGLES D'ABORD ──
// Appeler un modèle sur chaque signalement serait du gâchis. La plupart des
// dossiers se tranchent sans lire le texte :
//
//   · contenu déjà analysé            → on ne repaie pas la même réponse
//   · un seul signalement, pas de mot  → risque faible, revue humaine,
//     problématique                      zéro appel
//   · beaucoup de signalements         → revue humaine, inutile de demander
//     indépendants                       son avis à une machine
//   · motif « faux compte »,           → humain d'office : ce sont des
//     « usurpation », cible profil       accusations, pas du texte à classer
//
// L'IA n'intervient que sur ce qui reste : du texte ambigu signalé une ou
// deux fois. C'est là, et seulement là, qu'elle apporte quelque chose.
//
// ── COÛT ──
// Haiku 4.5, ~1 $/M jetons d'entrée et ~5 $/M en sortie. Un dossier =
// environ 450 jetons d'entrée et 120 en sortie, soit ≈ 0,001 $. Un dossier
// n'est analysé qu'UNE fois (`bot_at` fait office de verrou), donc le coût
// est borné par le nombre de contenus distincts signalés, pas par le nombre
// de signalements ni par le nombre d'affichages.

export const config = { runtime: 'edge' }

const MODEL = 'claude-haiku-4-5-20251001'

/** Mots dont la présence suffit à classer « à examiner » sans appeler
 *  personne. Volontairement court : une liste longue attrape des innocents,
 *  et ce n'est pas elle qui décide — elle oriente. */
const HARD_FLAGS = [
  'http://bit.ly', 'telegram.me', 't.me/', 'wa.me/',
  'crypto', 'bitcoin', 'investis', 'gain garanti', 'guaranteed profit',
]

type Target = 'spot' | 'comment' | 'story' | 'profile'

type CaseRow = {
  id: string
  target_type: Target
  target_id: string
  target_owner: string | null
  report_count: number
  bot_at: string | null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function rest(path: string, init?: RequestInit) {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('supabase env missing')
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`)
  return r.status === 204 ? null : await r.json()
}

/** Le texte à examiner, selon la nature de la cible. Une story n'a qu'une
 *  légende ; une image n'est pas analysée — cela demanderait un modèle de
 *  vision sur chaque signalement, pour un gain que rien ne démontre ici. */
async function fetchText(c: CaseRow): Promise<string> {
  if (c.target_type === 'spot') {
    const r = await rest(
      `spots?id=eq.${c.target_id}&select=brand,model,description`,
    )
    const s = r?.[0]
    return s ? [s.brand, s.model, s.description].filter(Boolean).join(' · ') : ''
  }
  if (c.target_type === 'comment') {
    const r = await rest(`comments?id=eq.${c.target_id}&select=content`)
    return r?.[0]?.content ?? ''
  }
  if (c.target_type === 'story') {
    const r = await rest(`stories?id=eq.${c.target_id}&select=caption`)
    return r?.[0]?.caption ?? ''
  }
  const r = await rest(
    `profiles?user_id=eq.${c.target_id}&select=pseudo,ville,dream_car`,
  )
  const p = r?.[0]
  return p ? [p.pseudo, p.ville, p.dream_car].filter(Boolean).join(' · ') : ''
}

type Verdict = {
  risk: 'low' | 'medium' | 'high'
  confidence: number
  verdict: string
  source: 'rules' | 'ai'
}

/** Première passe, sans modèle. Renvoie null quand elle n'a pas d'avis —
 *  c'est à ce moment-là, et seulement là, qu'on paie une analyse. */
function byRules(c: CaseRow, reasons: string[], text: string): Verdict | null {
  // Une accusation visant une personne n'est pas une question de
  // vocabulaire. Un modèle de langage n'a pas les éléments pour trancher
  // « ce compte usurpe une identité » : il ne connaît ni l'historique, ni
  // les autres comptes, ni le contexte hors de REVS.
  if (
    c.target_type === 'profile' ||
    reasons.includes('fake_account') ||
    reasons.includes('harassment')
  ) {
    return {
      risk: 'medium',
      confidence: 0.3,
      verdict: 'Accusation visant une personne — décision humaine requise.',
      source: 'rules',
    }
  }
  // Beaucoup de voix indépendantes : un humain regarde, point.
  if (c.report_count >= 3) {
    return {
      risk: 'high',
      confidence: 0.5,
      verdict: `${c.report_count} signalements indépendants — revue humaine.`,
      source: 'rules',
    }
  }
  const low = text.toLowerCase()
  const hit = HARD_FLAGS.find((f) => low.includes(f))
  if (hit) {
    return {
      risk: 'high',
      confidence: 0.75,
      verdict: `Motif de démarchage détecté (« ${hit} ») — revue humaine.`,
      source: 'rules',
    }
  }
  // Rien d'écrit à examiner : une photo seule signalée une fois ne se juge
  // pas sur du vide.
  if (text.trim().length < 3) {
    return {
      risk: 'low',
      confidence: 0.4,
      verdict: 'Aucun texte à analyser — revue humaine.',
      source: 'rules',
    }
  }
  return null
}

const PROMPT = `Tu classes un contenu signalé sur REVS, une application de
spotting automobile. Tu ne décides d'aucune sanction : tu donnes un niveau de
risque et ta confiance, pour qu'un humain sache quoi regarder en premier.

Réponds UNIQUEMENT par un objet JSON :
{"risk":"low|medium|high","confidence":0.0-1.0,"verdict":"une phrase en français"}

risk high      = le contenu enfreint clairement les règles (démarchage,
                 insultes, contenu sexuel, violence, arnaque).
risk medium    = douteux, ou tu manques d'éléments.
risk low       = contenu normal ; le signalement paraît infondé.

confidence     = ta certitude RÉELLE. Sois sévère avec toi-même : en dessous
                 de 0.9, un humain tranchera, et c'est très bien. Un contenu
                 simplement maladroit, grossier sans viser quelqu'un, ou que
                 tu ne comprends pas, n'est pas "high".`

async function byAI(text: string, reasons: string[]): Promise<Verdict> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    // Pas de clé : le dossier part chez un humain. Le défaut en cas de panne
    // doit être « quelqu'un regarde », jamais « on laisse passer ».
    return {
      risk: 'medium',
      confidence: 0,
      verdict: 'Analyse indisponible — revue humaine.',
      source: 'rules',
    }
  }
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: PROMPT,
      messages: [
        {
          role: 'user',
          content: `Motifs invoqués : ${reasons.join(', ')}\nContenu :\n${text.slice(0, 1500)}`,
        },
      ],
    }),
  })
  if (!r.ok) {
    return {
      risk: 'medium',
      confidence: 0,
      verdict: 'Analyse en échec — revue humaine.',
      source: 'rules',
    }
  }
  const data = await r.json()
  const raw: string = data?.content?.[0]?.text ?? ''
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) {
    return {
      risk: 'medium',
      confidence: 0,
      verdict: 'Réponse illisible — revue humaine.',
      source: 'rules',
    }
  }
  try {
    const p = JSON.parse(m[0])
    const risk = ['low', 'medium', 'high'].includes(p.risk) ? p.risk : 'medium'
    const conf = Math.max(0, Math.min(1, Number(p.confidence) || 0))
    return {
      risk,
      confidence: conf,
      verdict: String(p.verdict ?? '').slice(0, 300) || 'Analyse sans commentaire.',
      source: 'ai',
    }
  } catch {
    return {
      risk: 'medium',
      confidence: 0,
      verdict: 'Réponse illisible — revue humaine.',
      source: 'rules',
    }
  }
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  try {
    const body = await req.json().catch(() => ({}))
    const caseId: string | undefined = body?.case_id

    // Sans identifiant, on traite la file des dossiers jamais analysés. Ce
    // chemin sert au rattrapage ; le chemin normal passe un identifiant.
    const filter = caseId
      ? `id=eq.${caseId}`
      : 'bot_at=is.null&status=eq.open&order=report_count.desc&limit=10'
    const cases: CaseRow[] = await rest(
      `moderation_cases?${filter}&select=id,target_type,target_id,target_owner,report_count,bot_at`,
    )
    if (!cases?.length) return json({ analysed: 0 })

    const out: unknown[] = []
    let aiCalls = 0
    for (const c of cases) {
      // Verrou de coût : un dossier déjà analysé ne l'est pas deux fois,
      // même si dix nouvelles personnes le signalent.
      if (c.bot_at) {
        out.push({ case_id: c.id, skipped: 'déjà analysé' })
        continue
      }
      const reportRows = await rest(
        `content_reports?target_type=eq.${c.target_type}&target_id=eq.${c.target_id}&select=reason`,
      )
      const reasons = [
        ...new Set((reportRows ?? []).map((r: { reason: string }) => r.reason)),
      ] as string[]
      const text = await fetchText(c)

      let v = byRules(c, reasons, text)
      if (!v) {
        v = await byAI(text, reasons)
        if (v.source === 'ai') aiCalls++
      }

      const res = await rest('rpc/bot_verdict', {
        method: 'POST',
        body: JSON.stringify({
          p_case: c.id,
          p_risk: v.risk,
          p_confidence: v.confidence,
          p_verdict: v.verdict,
          p_source: v.source,
        }),
      })
      out.push({ case_id: c.id, ...v, applied: res })
    }
    return json({ analysed: out.length, ai_calls: aiCalls, results: out })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'unknown' }, 500)
  }
}
