// ═══════ LE DOSSIER api/ N'ÉTAIT VÉRIFIÉ PAR RIEN ═══════
//
// Le 02/10/2026, `api/car-info.ts` est parti en production avec trois corps de
// fonction dont les DÉCLARATIONS avaient été supprimées. Le module ne se
// chargeait plus : l'endpoint répondait 500 FUNCTION_INVOCATION_FAILED en
// 0,3 s sur toutes ses actions, y compris sans jeton et sur une action
// inconnue. Côté utilisateur, le verso des cartes restait sans
// caractéristiques et la cote marché ne se calculait plus.
//
// Rien ne pouvait l'attraper : le tsconfig racine est `{"files": [], ...}` et
// ne couvre que `src/` par références, `npm run build` ne regarde pas `api/`,
// et ESLint ne signale pas une erreur de syntaxe TypeScript de ce type.
//
// ── POURQUOI SEULEMENT LA SYNTAXE ──
// Un contrôle de TYPES complet sur `api/` échouerait aujourd'hui sur des
// écarts bénins de génériques Supabase, et ferait échouer le build pour des
// raisons sans rapport avec un fichier cassé. Ce garde ne retient donc que
// les erreurs de GRAMMAIRE (TS1xxx) : celles qui empêchent le module de se
// charger, c'est-à-dire exactement la classe de panne observée.
//
// Lancé par `npm run build`. Un fichier qui ne se parse pas ne part plus.

import { execFileSync } from 'node:child_process'
import { readdirSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const API = new URL('../api/', import.meta.url).pathname
const files = readdirSync(API).filter((f) => f.endsWith('.ts') || f.endsWith('.js'))

// tsconfig jetable : on ne touche pas à celui du projet, et on n'hérite pas de
// ses références, qui ne pointent que vers `src/`.
const dir = mkdtempSync(join(tmpdir(), 'revs-api-'))
writeFileSync(
  join(dir, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'es2022',
      module: 'esnext',
      moduleResolution: 'bundler',
      allowJs: true,
      checkJs: false,
      noEmit: true,
      skipLibCheck: true,
      strict: false,
      noResolve: true, // les imports ne sont pas suivis : seule la grammaire compte
      types: [],
    },
    include: files.map((f) => join(API, f)),
  }),
)

let out = ''
try {
  execFileSync('npx', ['tsc', '-p', dir], { encoding: 'utf8', stdio: 'pipe' })
} catch (e) {
  out = `${e.stdout ?? ''}${e.stderr ?? ''}`
}

// Seules les TS1xxx comptent — voir l'en-tête.
const syntax = out
  .split('\n')
  .filter((l) => /error TS1\d{3}:/.test(l))
  .map((l) => l.replace(API, ''))

if (syntax.length) {
  console.error(`\n✗ ${syntax.length} erreur(s) de syntaxe dans api/ :\n`)
  for (const l of syntax.slice(0, 20)) console.error('   ' + l)
  console.error(
    '\nCes fichiers ne se chargeront pas en production (500 FUNCTION_INVOCATION_FAILED).\n',
  )
  process.exit(1)
}
console.log(`[check-api-syntax] ${files.length} fichiers api/ — syntaxe correcte`)
