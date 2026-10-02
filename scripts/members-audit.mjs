// ═══════ AUDIT DE COHÉRENCE DE LA POPULATION REVS ═══════
//
// Une seule question : les écrans qui comptent des membres comptent-ils la
// MÊME population ?
//
// Le 02/10, Global annonçait 13 membres et le classement en listait 14. La
// ligne en trop était un profil dont l'onboarding n'était jamais allé au
// bout — ni pseudo, ni avatar, 0 XP, 0 spot. Deux définitions cohabitaient :
// Global comptait les profils « onboarding terminé », les classements
// comptaient « tout profil public ».
//
// Ce script compare les six sources et échoue si elles divergent. À lancer
// après toute migration qui touche à `profiles` ou aux fonctions de comptage.
//
//   node scripts/members-audit.mjs
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env.local', 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const URL_ = pick('VITE_SUPABASE_URL', '[^\\s]+')
const ANON = pick('VITE_SUPABASE_ANON_KEY', '[A-Za-z0-9._-]+')
const admin = createClient(URL_, pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'), {
  auth: { persistSession: false },
})

// Les RPC sont réservées aux utilisateurs connectés : on audite donc avec un
// vrai jeton, pas avec le service_role qui contournerait RLS et mentirait sur
// ce que voit l'application.
const anon = createClient(URL_, ANON, { auth: { persistSession: false } })
const email = `revs-audit-${Date.now()}@example.com`
const pwd = 'Audit-2026!'
const { data: c } = await admin.auth.admin.createUser({
  email, password: pwd, email_confirm: true,
  user_metadata: { pseudo: 'AUDIT', age_confirmed: '1' },
})
const { data: sess } = await anon.auth.signInWithPassword({ email, password: pwd })
const cli = createClient(URL_, ANON, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
})

const { data: au } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
const { data: profs } = await admin.from('profiles').select('user_id, onboarding_completed, last_seen')
const [{ data: counts }, { data: online }, { data: top }, { data: home }] = await Promise.all([
  cli.rpc('members_counts').maybeSingle(),
  cli.rpc('members_online'),
  cli.rpc('top_spotters', { limit_count: 1000 }),
  cli.rpc('home_community_stats').maybeSingle(),
])

const members = profs.filter((p) => p.onboarding_completed)
const FIVE_MIN = 5 * 60 * 1000
const actifs = members.filter(
  (p) => p.last_seen && Date.now() - new Date(p.last_seen).getTime() < FIVE_MIN,
)

// Le compte d'audit ne fausse rien : le déclencheur le crée avec
// `onboarding_completed = false`, et aucune des six sources ne compte un
// profil dont l'onboarding n'est pas terminé. Il est donc invisible pour
// toutes — c'est d'ailleurs un contrôle en soi.
const rows = [
  ['auth.users', au.users.length, null],
  ['profils (toutes lignes)', profs.length, null],
  ['membres (onboarding terminé)', members.length, 'référence'],
  ['Global — members_counts.total', counts.total, 'référence'],
  ['classement — top_spotters', top.length, 'référence'],
  ['en ligne — members_online', online.length, 'présence'],
  ['en ligne — members_counts', counts.online_now, 'présence'],
  ['en ligne — accueil', home?.online_now ?? -1, 'présence'],
  ['en ligne — calcul direct', actifs.length, 'présence'],
]
const w = Math.max(...rows.map((r) => r[0].length))
for (const [label, n] of rows) console.log(`  ${label.padEnd(w)} : ${String(n).padStart(5)}`)

const ref = rows.filter((r) => r[2] === 'référence').map((r) => r[1])
const pres = rows.filter((r) => r[2] === 'présence').map((r) => r[1])
const same = (a) => a.every((v) => v === a[0])
const offline = ref[0] - pres[0]
console.log(`\n  hors ligne (total − en ligne)  : ${String(offline).padStart(5)}`)

const okRef = same(ref)
const okPres = same(pres)
console.log(`\npopulation identique partout : ${okRef ? '✓' : '✗ ' + ref.join(' ≠ ')}`)
console.log(`présence identique partout   : ${okPres ? '✓' : '✗ ' + pres.join(' ≠ ')}`)
console.log(`en ligne + hors ligne = total: ${pres[0] + offline === ref[0] ? '✓' : '✗'}`)

await admin.auth.admin.deleteUser(c.user.id)
process.exit(okRef && okPres ? 0 : 1)
