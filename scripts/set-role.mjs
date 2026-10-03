// ═══════ ATTRIBUER UN RÔLE REVS ═══════
//
// `profiles.role` n'est plus modifiable par le client depuis la migration
// 0119 : le droit UPDATE sur cette colonne a été retiré à `authenticated`.
// C'est précisément le but — un compte ne peut plus se nommer administrateur.
// Changer un rôle passe donc par ici, avec la clé de service.
//
//   node scripts/set-role.mjs <email> <user|beta_tester|moderator|admin>
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const [email, role] = process.argv.slice(2)
const ROLES = ['user', 'beta_tester', 'moderator', 'admin']
if (!email || !ROLES.includes(role)) {
  console.error(`usage : node scripts/set-role.mjs <email> <${ROLES.join('|')}>`)
  process.exit(1)
}
const env = readFileSync('.env.local', 'utf8')
const pick = (k, re) => (env.match(new RegExp('^' + k + '=("?)(' + re + ')\\1', 'm')) || [])[2]
const admin = createClient(
  pick('VITE_SUPABASE_URL', '[^\\s]+'),
  pick('SUPABASE_SERVICE_ROLE_KEY', '[A-Za-z0-9._-]+'),
  { auth: { persistSession: false } },
)
const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
const u = data.users.find((x) => (x.email ?? '').toLowerCase() === email.toLowerCase())
if (!u) {
  console.error(`aucun compte pour ${email}`)
  process.exit(1)
}
const { error } = await admin.from('profiles').update({ role }).eq('user_id', u.id)
if (error) {
  console.error(error.message)
  process.exit(1)
}
const { data: p } = await admin.from('profiles').select('pseudo, role').eq('user_id', u.id).single()
console.log(`${p.pseudo ?? email} → rôle « ${p.role} »`)
