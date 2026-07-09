// PRÉREQUIS : facturation activée sur le projet Google Cloud lié à GEMINI_API_KEY.
// Aucun modèle image de l'API Gemini n'a de free tier (Lite compris).
// Le playground AI Studio est gratuit mais utilise un accès distinct de la clé API.
// (Vérifié 2026-07-09 : gemini-3.1-flash-lite/flash/2.5-flash-image → 429 free_tier
//  limit:0 ; imagen-4.0-* → 400 "only available on paid plans".)
//
// Generate an image with Google Gemini (Google AI Studio) and save it to
// public/generated/. Uses @google/genai's models.generateContent with an
// IMAGE response modality; the image comes back as inline base64 data.
//
//   node scripts/generate-image.mjs "<prompt>" <outfile.png> [--model <id>]
//
// e.g. node scripts/generate-image.mjs "pièce d'or brillante, fond transparent" test-coin.png
//
// Default model: gemini-2.5-flash-image (a.k.a. "Nano Banana"). Override with
// --model. Reads GEMINI_API_KEY from .env.local WITHOUT sourcing the file
// (safe regex parse — the key is never printed). Never commit the key.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { GoogleGenAI, Modality } from '@google/genai'

// ── Safe env parsing (no sourcing, no echo of the value) ──
function readEnvText(path) {
  try {
    return readFileSync(path, 'utf8').replace(/\\n/g, '\n')
  } catch {
    return ''
  }
}
function pick(txt, name, valueRe) {
  const re = new RegExp(`${name}\\s*=\\s*['"]?\\s*(${valueRe})`, 'g')
  let best = ''
  for (const m of txt.matchAll(re)) if (m[1].length > best.length) best = m[1]
  return best
}
const envText = readEnvText(new URL('../.env.local', import.meta.url))
const API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.GOOGLE_API_KEY ||
  pick(envText, 'GEMINI_API_KEY', '[A-Za-z0-9._-]+')

// ── Args ──
const args = process.argv.slice(2)
const modelIdx = args.indexOf('--model')
// Default: Nano Banana 2 Lite — free tier (no billing) on Google AI Studio.
const MODEL = modelIdx >= 0 && args[modelIdx + 1] ? args[modelIdx + 1] : 'gemini-3.1-flash-lite-image'
const positional = args.filter((a, i) => a !== '--model' && args[i - 1] !== '--model')
const PROMPT = positional[0]
const OUTNAME = positional[1]

if (!PROMPT || !OUTNAME) {
  console.error('Usage: node scripts/generate-image.mjs "<prompt>" <outfile.png> [--model <id>]')
  process.exit(1)
}
if (!API_KEY) {
  console.error(
    "GEMINI_API_KEY introuvable. Ajoute-la dans .env.local (GEMINI_API_KEY=…) — jamais commitée.",
  )
  process.exit(1)
}

// Resolve output path under public/generated/.
const outDir = new URL('../public/generated/', import.meta.url)
mkdirSync(outDir, { recursive: true })
const outPath = new URL(OUTNAME, outDir)

// ── Generate ──
const ai = new GoogleGenAI({ apiKey: API_KEY })
console.log(`Modèle : ${MODEL}`)
console.log(`Prompt : ${PROMPT}`)

// The free tier is rate-limited per minute; auto-retry on throttle with a
// short backoff so a burst of requests doesn't fail outright.
function isThrottle(e) {
  const msg = (e?.message ?? String(e ?? '')).toLowerCase()
  const code = e?.status ?? e?.code
  // `limit: 0` = the free tier grants ZERO requests for this model (permanent,
  // needs billing) — retrying is pointless, so don't treat it as a throttle.
  if (/limit:\s*0\b/.test(msg)) return false
  return (
    code === 429 ||
    code === 'RESOURCE_EXHAUSTED' ||
    /\b429\b|resource_exhausted|rate.?limit|quota|throttl|too many requests|per minute/i.test(
      msg,
    )
  )
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function generateWithRetry() {
  const MAX_ATTEMPTS = 4
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await ai.models.generateContent({
        model: MODEL,
        contents: PROMPT,
        config: { responseModalities: [Modality.IMAGE] },
      })
    } catch (e) {
      if (attempt < MAX_ATTEMPTS && isThrottle(e)) {
        const waitS = Math.min(60, 15 * attempt) // 15s, 30s, 45s
        console.log(
          `⏳ Throttle par minute (tentative ${attempt}/${MAX_ATTEMPTS}) — nouvel essai dans ${waitS}s…`,
        )
        await sleep(waitS * 1000)
        continue
      }
      throw e
    }
  }
}

let res
try {
  res = await generateWithRetry()
} catch (e) {
  const msg = e?.message ?? String(e ?? '')
  console.error('Échec de la génération :', msg)
  if (/resource_exhausted|\b429\b/i.test(msg) && /limit:\s*0\b|free_tier/i.test(msg)) {
    console.error(
      "\n⚠️  Le FREE TIER de l'API Gemini est à 0 pour les modèles image sur ce projet " +
        '— la génération marche dans le playground AI Studio mais PAS via la clé API tant que\n' +
        "   la FACTURATION n'est pas activée sur le projet Google Cloud lié à la clé.\n" +
        '   → https://aistudio.google.com/apikey  (associer un projet avec billing activé)\n' +
        '   → ou active la facturation : https://console.cloud.google.com/billing',
    )
  }
  process.exit(2)
}

// Find the first inline image part across all candidates.
let saved = false
const textOut = []
for (const c of res?.candidates ?? []) {
  for (const part of c?.content?.parts ?? []) {
    const inline = part.inlineData ?? part.inline_data
    if (inline?.data) {
      const buf = Buffer.from(inline.data, 'base64')
      writeFileSync(outPath, buf)
      const rel = `public/generated/${OUTNAME}`
      console.log(
        `\n✅ Image créée : ${rel}  (${inline.mimeType ?? 'image'}, ${buf.length.toLocaleString('fr-FR')} octets)`,
      )
      console.log(`Chemin absolu : ${outPath.pathname}`)
      saved = true
      break
    }
    if (typeof part.text === 'string' && part.text.trim()) textOut.push(part.text.trim())
  }
  if (saved) break
}

if (!saved) {
  console.error('\n❌ Aucune image dans la réponse.')
  if (textOut.length) console.error('Texte renvoyé par le modèle :', textOut.join(' '))
  console.error('Réponse brute (début) :', JSON.stringify(res).slice(0, 500))
  process.exit(3)
}
