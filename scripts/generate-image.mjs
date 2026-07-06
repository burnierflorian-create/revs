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
const MODEL = modelIdx >= 0 && args[modelIdx + 1] ? args[modelIdx + 1] : 'gemini-2.5-flash-image'
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

let res
try {
  res = await ai.models.generateContent({
    model: MODEL,
    contents: PROMPT,
    config: { responseModalities: [Modality.IMAGE] },
  })
} catch (e) {
  console.error('Échec de la génération :', e?.message ?? e)
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
