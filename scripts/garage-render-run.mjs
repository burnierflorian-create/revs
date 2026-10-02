// ═══════ GARAGE VISUAL — GÉNÉRATION HORS LIGNE, MÊME LOGIQUE QUE L'EDGE ═══════
//
// ── POURQUOI CE SCRIPT EXISTE À CÔTÉ DE api/garage-render.ts ──
// Deux usages que la fonction edge ne couvre pas :
//   · le BACKFILL des véhicules déjà publiés, qui ne repasseront jamais par
//     le flux de publication ;
//   · la validation de la chaîne complète (verrou, génération, dépôt, cache,
//     rattachement) quand la clé Gemini n'est pas encore posée sur Vercel.
//
// Il suit EXACTEMENT les mêmes règles que la fonction edge — même verrou
// d'identité, même clé de cache, même verrou de concurrence, même bucket.
// Si les deux divergeaient, le backfill produirait un showroom différent de
// celui des nouvelles publications.
//
// ── CE QU'IL NE FAIT JAMAIS ──
// Il ne touche pas `photo_url`. Il n'écrase pas un `garage_render_url`
// existant. Il ne génère pas sur une identité non validée. Il ne génère pas
// deux fois la même voiture.
//
// USAGE
//   node scripts/garage-render-run.mjs --dry-run            # ce qui serait fait
//   node scripts/garage-render-run.mjs --apply --limit 5    # petit lot
//   node scripts/garage-render-run.mjs --apply --spot <id>  # un seul

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  GARAGE_VISUAL_VERSION,
  buildPrompt,
  cacheKey,
  canRender,
} from '../server/garage-visual.js'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const LIMIT = Number(args[args.indexOf('--limit') + 1]) || null
const ONE = args.includes('--spot') ? args[args.indexOf('--spot') + 1] : null

const MODEL = process.env.REVS_GARAGE_MODEL || 'gemini-3.1-flash-image'
const USD = 0.067
const BUCKET = 'garage-renders'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const GEMINI = pick('GEMINI_API_KEY', '[^\\s]+')
const db = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)
if (!GEMINI) {
  console.error('GEMINI_API_KEY absente — aucune génération possible, aucun coût engagé.')
  process.exit(2)
}

let spent = 0
let hits = 0
let misses = 0
let skipped = 0
let failed = 0

async function generate(spot) {
  const photoRes = await fetch(spot.photo_url)
  if (!photoRes.ok) throw new Error(`photo inaccessible (HTTP ${photoRes.status})`)
  const photo = Buffer.from(await photoRes.arrayBuffer())
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: photoRes.headers.get('content-type') || 'image/jpeg',
                  data: photo.toString('base64'),
                },
              },
              { text: buildPrompt(spot) },
            ],
          },
        ],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    },
  )
  const j = await res.json()
  const part = (j.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData)
  if (!res.ok || !part) {
    throw new Error(j.error?.message || `aucune image (${j.candidates?.[0]?.finishReason ?? '?'})`)
  }
  spent += USD
  return Buffer.from(part.inlineData.data, 'base64')
}

let q = db
  .from('spots')
  .select('id, user_id, brand, model, color, photo_url, garage_render_url, ident_locked, ai_verified')
  .is('garage_render_url', null)
  .order('created_at', { ascending: false })
if (ONE) q = db.from('spots').select('id, user_id, brand, model, color, photo_url, garage_render_url, ident_locked, ai_verified').like('id', `${ONE}%`)
const { data: all, error } = await q
if (error) throw error

// Le verrou d'identité D'ABORD : on ne veut même pas compter comme candidat
// un véhicule qu'on refusera de rendre.
const eligible = []
const refused = []
for (const s of all ?? []) {
  const g = canRender(s)
  if (g.ok) eligible.push(s)
  else refused.push({ s, reason: g.reason })
}

console.log(`\n═══ GARAGE VISUAL — ${APPLY ? 'GÉNÉRATION' : 'ESSAI À BLANC'} ═══`)
console.log(`modèle : ${MODEL} · ${USD} $/image · prompt v${GARAGE_VISUAL_VERSION}\n`)
console.log(`spots sans rendu            : ${(all ?? []).length}`)
console.log(`  identité validée          : ${eligible.length}`)
console.log(`  identité NON validée      : ${refused.length}  (aucune dépense)`)

// Regroupement par clé : c'est là que le cache fait son travail. Dix spots
// d'une même Model Y blanche ne valent qu'UNE génération.
const groups = new Map()
for (const s of eligible) {
  const k = `${cacheKey(s)}|v${GARAGE_VISUAL_VERSION}`
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(s)
}
console.log(`  véhicules DISTINCTS       : ${groups.size}  ← nombre de générations maximum`)
console.log(`  coût maximal de ce lot    : ${(groups.size * USD).toFixed(2)} $`)

const keys = LIMIT ? [...groups.keys()].slice(0, LIMIT) : [...groups.keys()]
if (LIMIT) console.log(`  limité à                  : ${keys.length} véhicule(s)`)

if (!APPLY) {
  console.log(`\n— ce qui serait généré —`)
  for (const k of keys) {
    const g = groups.get(k)
    console.log(`  ${k.padEnd(44)} ${g.length} spot(s) · ${(g[0].brand + ' ' + g[0].model).slice(0, 34)}`)
  }
  if (refused.length) {
    console.log(`\n— refusés, identité non validée —`)
    for (const r of refused.slice(0, 10)) console.log(`  ${(r.s.brand + ' ' + r.s.model).slice(0, 36).padEnd(38)} ${r.reason}`)
  }
  console.log(`\nRien n'a été généré. Relancer avec --apply.`)
  process.exit(0)
}

console.log()
for (const key of keys) {
  const group = groups.get(key)
  const head = group[0]
  const label = `${head.brand} ${head.model}`.slice(0, 32)

  const { data: verdict, error: cErr } = await db.rpc('claim_garage_render', {
    p_key: key,
    p_brand: head.brand,
    p_model: head.model,
    p_colour: head.color,
    p_version: GARAGE_VISUAL_VERSION,
  })
  if (cErr) {
    console.log(`  ✗ ${label.padEnd(34)} verrou indisponible : ${cErr.message.slice(0, 40)}`)
    failed += 1
    continue
  }

  let url = null
  if (verdict === 'ready') {
    const { data: row } = await db.from('garage_renders').select('render_url').eq('cache_key', key).maybeSingle()
    url = row?.render_url ?? null
    hits += 1
    console.log(`  ↺ ${label.padEnd(34)} cache — aucune dépense`)
  } else if (verdict === 'pending') {
    console.log(`  … ${label.padEnd(34)} réservé ailleurs, on passe`)
    skipped += 1
    continue
  } else {
    try {
      const bytes = await generate(head)
      const path = `${key.replace(/\|/g, '_')}.png`
      const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, { upsert: true, contentType: 'image/png' })
      if (upErr) throw upErr
      url = db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
      await db.from('garage_renders').update({ status: 'ready', render_url: url }).eq('cache_key', key)
      misses += 1
      console.log(`  ✓ ${label.padEnd(34)} généré (${(bytes.length / 1024) | 0} Ko)`)
    } catch (e) {
      // La réservation est libérée : la clé doit rester réessayable.
      await db.from('garage_renders').delete().eq('cache_key', key)
      console.log(`  ✗ ${label.padEnd(34)} ${String(e?.message ?? e).slice(0, 44)}`)
      failed += 1
      continue
    }
  }

  if (!url) continue
  // Rattachement à TOUS les spots du groupe — c'est le gain du cache.
  for (const s of group) {
    await db.from('spots').update({ garage_render_url: url }).eq('id', s.id)
  }
  if (group.length > 1) console.log(`      rattaché à ${group.length} spots`)
}

console.log(`\n═══ BILAN ═══`)
console.log(`générés (cache miss) : ${misses}`)
console.log(`réutilisés (cache hit): ${hits}`)
console.log(`passés (concurrence) : ${skipped}`)
console.log(`échecs               : ${failed}`)
console.log(`coût réel            : ${spent.toFixed(3)} $`)
console.log(`\nAucune photo_url n'a été touchée.`)
