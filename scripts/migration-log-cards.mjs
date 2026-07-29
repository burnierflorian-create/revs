// READ-ONLY dry-run log for the évolutive-cards migration (0065).
// Computes what card_progress WILL become, in JS, mirroring the SQL. Writes/
// applies NOTHING. Cross-checks src/lib/colorKey.ts logic.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
const env = readFileSync('.env.local', 'utf8').replace(/\\n/g, '\n')
const pick = (n) => { const m = env.match(new RegExp(`${n}\\s*=\\s*['"]?([^'"\\s]+)`)); return m ? m[1] : '' }
const sb = createClient(pick('VITE_SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

// --- mirrors of colorKey.ts / SQL ---
const MAP = [['noir',['noir','noire','noirs','black','nero','nera']],['blanc',['blanc','blanche','white','bianco','bianca','weiss']],['gris',['gris','grise','grey','gray','grigio','argent','argente','silver','anthracite','graphite','gunmetal']],['rouge',['rouge','red','rosso','rossa','rot']],['bleu',['bleu','bleue','blue','blu','azzurro','azur']],['vert',['vert','verte','green','verde']],['jaune',['jaune','yellow','giallo','gelb']],['orange',['orange','arancio','arancione','papaya']],['violet',['violet','violette','purple','viola','mauve','lila']],['marron',['marron','brun','brune','brown','marrone']],['beige',['beige','sable','tan','creme','cream']],['or',['or','dore','doree','gold','golden','oro']],['rose',['rose','pink','rosa']],['bronze',['bronze','cuivre','copper']]]
const W2B = new Map(); for (const [b,ss] of MAP) for (const s of ss) if(!W2B.has(s)) W2B.set(s,b)
const strip = (s)=>s.normalize('NFD').replace(/[̀-ͯ]/g,'')
const colorKey = (i)=>{ for(const w of strip((i??'').toLowerCase()).split(/[^a-z]+/).filter(Boolean)){const b=W2B.get(w); if(b) return b} return 'autre' }
const norm = (s)=>(s??'').toLowerCase().trim().replace(/\s+/g,' ')
const BASE = { hypercar:250, supercar:150, exclusif:90, performance:50, premium:25, standard:10 }
const baseXp = (r)=>BASE[(r||'standard').toLowerCase()] ?? 10
const factor = (o)=> o<=1?1 : o<=3?0.5 : o<=10?0.25 : 0.1
const levelFor = (n)=> n>=20?5 : n>=10?4 : n>=5?3 : n>=3?2 : 1
const BADGE = {1:'—',2:'Chasseur',3:'Traqueur',4:'Obsédé',5:'Légende'}

const { data: spots } = await sb.from('spots').select('user_id,brand,model,color,rarity,photo_url,created_at,id').order('created_at')
const { data: cp } = await sb.from('card_progress').select('*')

// group spots by new key
const groups = new Map()
for (const s of spots) {
  const bk = norm(s.brand), mk = norm(s.model)
  if (!bk || !mk) continue
  const ck = colorKey(s.color)
  const k = `${s.user_id}|${bk}|${mk}|${ck}`
  if (!groups.has(k)) groups.set(k, { bk, mk, ck, brand:s.brand, model:s.model, color:s.color, rows:[] })
  groups.get(k).rows.push(s)
}
let cards=0, splits=0
const perModel = new Map() // old key -> count of new cards, to detect splits
const lines=[]
for (const [,g] of groups) {
  g.rows.sort((a,b)=> (a.created_at<b.created_at?-1:1))
  const cnt = g.rows.length
  const lvl = levelFor(cnt)
  const cumXp = g.rows.reduce((acc,s,i)=> acc + Math.round(baseXp(s.rarity)*factor(i+1)), 0)
  cards++
  const om = `${g.bk}|${g.mk}`; perModel.set(om,(perModel.get(om)||0)+1)
  lines.push(`  ${g.brand} ${g.model} [${g.ck}] · ×${cnt} · Nv${lvl} ${BADGE[lvl]} · ${cumXp} XP · 1er ${g.rows[0].created_at.slice(0,10)}`)
}
for (const [,n] of perModel) if (n>1) splits += (n-1)

console.log('════════ MIGRATION 0065 — DRY-RUN (aucune écriture) ════════')
console.log(`AVANT : ${cp.length} lignes card_progress (clé marque+modèle, seuils 1/3/6/11/21)`)
console.log(`APRÈS : ${cards} cartes (clé marque+modèle+couleur, seuils 1/3/5/10/20)`)
console.log(`Écart de clé (couleur) : +${splits} carte(s) issues d'un même modèle en plusieurs couleurs`)
console.log(`Spots regroupés : ${spots.length} · aucune photo perdue (historique = table spots, intacte)`)
console.log('\nCartes après migration :')
for (const l of lines.sort()) console.log(l)
// XP ledger safety
const { data: xt } = await sb.from('xp_transactions').select('amount')
const total = xt.reduce((a,b)=>a+b.amount,0)
console.log(`\nLedger xp_transactions : ${xt.length} lignes, total ${total} XP — NON MODIFIÉ (forward-only).`)
