// ═══════ SCÉNARIO DE PRÉSENCE — SIX COMPTES, SIX ÉTATS ═══════
//
// `members-audit.mjs` vérifie que les surfaces s'accordent sur la population
// du moment. Ce script-ci vérifie autre chose : que le classement en ligne /
// hors ligne est juste, pour des durées d'inactivité choisies, y compris les
// cas limites qu'on ne rencontre jamais en regardant la base telle qu'elle
// est un mardi.
//
// Les six comptes sont créés, mesurés, puis supprimés. Lancer sur la base de
// production est sans danger : les comptes ne publient rien et n'existent que
// le temps du script.
//
//   node scripts/presence-test.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env.local', 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const URL_ = pick('VITE_SUPABASE_URL', '[^\\s]+')
const ANON = pick('VITE_SUPABASE_ANON_KEY', '[A-Za-z0-9._-]+')
const admin = createClient(URL_, pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'), {
  auth: { persistSession: false },
})
const anon = createClient(URL_, ANON, { auth: { persistSession: false } })

const stamp = Date.now()
const PWD = 'Presence-2026!'
const made = []

async function mk(tag, minutesAgo, finishOnboarding = true) {
  const { data: c, error } = await admin.auth.admin.createUser({
    email: `revs-pres-${tag}-${stamp}@example.com`,
    password: PWD,
    email_confirm: true,
    user_metadata: { pseudo: tag, age_confirmed: '1' },
  })
  if (error) throw error
  made.push(c.user.id)
  if (finishOnboarding) {
    await admin
      .from('profiles')
      .update({ onboarding_completed: true, is_public: true })
      .eq('user_id', c.user.id)
    if (minutesAgo !== null) {
      await admin
        .from('profiles')
        .update({ last_seen: new Date(Date.now() - minutesAgo * 60_000).toISOString() })
        .eq('user_id', c.user.id)
    }
  }
  return c.user.id
}

const base = (await admin.rpc('members_counts').single()).data
console.log(`départ : total=${base.total} en ligne=${base.online_now}`)

const ids = {
  A: await mk('A', 0),
  B: await mk('B', 7), //           juste au-delà du seuil de 5 min
  C: await mk('C', 60 * 5),
  D: await mk('D', 60 * 24 * 3),
  F: await mk('F', 60 * 24 * 400), // plus d'un an
}

// E ne reçoit JAMAIS de last_seen. On ne fait que basculer
// `onboarding_completed`, exactement comme le fait l'application à la fin de
// l'inscription, et on regarde si la base le déclare actif d'elle-même.
const eid = await mk('E', null, false)
const before = (await admin.from('profiles').select('last_seen').eq('user_id', eid).single()).data
await admin
  .from('profiles')
  .update({ onboarding_completed: true, is_public: true })
  .eq('user_id', eid)
const after = (await admin.from('profiles').select('last_seen').eq('user_id', eid).single()).data
ids.E = eid

// Lecture avec un VRAI jeton utilisateur : le service_role contournerait RLS
// et mentirait sur ce que voit l'application.
const { data: sess } = await anon.auth.signInWithPassword({
  email: `revs-pres-A-${stamp}@example.com`,
  password: PWD,
})
const cli = createClient(URL_, ANON, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
})
const list = (await cli.rpc('members_list')).data
const counts = (await cli.rpc('members_counts').single()).data

const byId = Object.fromEntries(list.map((r) => [r.user_id, r]))
const attendu = {
  A: 'EN LIGNE',
  B: 'HORS LIGNE',
  C: 'HORS LIGNE',
  D: 'HORS LIGNE',
  F: 'HORS LIGNE',
  E: 'EN LIGNE',
}
let ok = true
console.log('\ncompte  attendu      observé      minutes')
for (const [tag, id] of Object.entries(ids)) {
  const r = byId[id]
  const got = !r ? 'ABSENT' : r.online ? 'EN LIGNE' : 'HORS LIGNE'
  if (got !== attendu[tag]) ok = false
  console.log(
    `  ${tag}     ${attendu[tag].padEnd(12)} ${got.padEnd(12)} ` +
      `${r ? Math.round(r.minutes_ago) : '—'}  ${got === attendu[tag] ? '✓' : '✗'}`,
  )
}

console.log(`\nE avant onboarding : last_seen = ${before.last_seen ?? 'null'}`)
console.log(
  `E après onboarding : last_seen = ${after.last_seen ?? 'null'}  ` +
    `${after.last_seen ? '✓ posé par la base' : '✗ non posé'}`,
)
if (!after.last_seen) ok = false

const hors = counts.total - counts.online_now
console.log(`\ntotal=${counts.total}  en ligne=${counts.online_now}  hors ligne=${hors}`)
if (counts.total !== base.total + 6) {
  ok = false
  console.log(`✗ total attendu ${base.total + 6}`)
}

// ── FALSIFICATION ──
const futur = await cli
  .from('profiles')
  .update({ last_seen: new Date(Date.now() + 864e5 * 365).toISOString() })
  .eq('user_id', ids.A)
  .select('last_seen')
const clamped = futur.data?.[0]?.last_seen
const borne = clamped && new Date(clamped) <= new Date(Date.now() + 60_000)
console.log(`\nA se place dans le futur → ${borne ? '✓ ramené au présent' : '✗ ' + clamped}`)
if (!borne) ok = false

const autre = await cli
  .from('profiles')
  .update({ last_seen: new Date().toISOString() })
  .eq('user_id', ids.D)
  .select('user_id')
const refuse = !autre.data?.length
console.log(`A modifie le last_seen de D → ${refuse ? '✓ refusé' : '✗ ACCEPTÉ'}`)
if (!refuse) ok = false

for (const id of made) await admin.auth.admin.deleteUser(id)
const fin = (await admin.rpc('members_counts').single()).data
const propre = fin.total === base.total
console.log(
  `\naprès suppression : total=${fin.total}  ` +
    `${propre ? '✓ les comptes supprimés ne comptent plus' : '✗ ' + base.total + ' attendu'}`,
)
if (!propre) ok = false

process.exit(ok ? 0 : 1)
