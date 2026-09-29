// ───────────── docs/REVS_MASTER_TUTORIAL.md → server/tutorial-content.js ─────────────
//
//   node scripts/build-tutorial.mjs
//
// POURQUOI UNE GÉNÉRATION PLUTÔT QU'UNE LECTURE DE FICHIER À CHAUD
// La fonction serverless `api/tutorial.ts` doit servir le contenu du tutoriel.
// Elle pourrait lire le Markdown avec `fs`, mais Vercel ne trace que les
// fichiers effectivement *importés* : `docs/` ne serait pas embarqué dans le
// bundle de la fonction, et l'endpoint renverrait une erreur en production
// alors qu'il marche en local. On transforme donc le Markdown en un module JS
// que la fonction `import`e — tracé, embarqué, sans accès disque au runtime.
//
// POURQUOI LE FICHIER GÉNÉRÉ EST COMMITÉ
// L'ordre exact entre la commande de build et l'empaquetage des fonctions
// Vercel n'est pas garanti. Un fichier présent dans le dépôt est disponible
// quoi qu'il arrive. `npm run build` le régénère d'abord, donc il ne peut pas
// diverger silencieusement du Markdown.
//
// SOURCE DE VÉRITÉ : le Markdown. Ne jamais éditer server/tutorial-content.js
// à la main — il est écrasé au prochain build.

import { readFileSync, writeFileSync } from 'node:fs'

const SRC = new URL('../docs/REVS_MASTER_TUTORIAL.md', import.meta.url)
const OUT = new URL('../server/tutorial-content.js', import.meta.url)

const md = readFileSync(SRC, 'utf8')

// ── Métadonnées ──
// Bloc HTML commenté en tête du document : invisible à la lecture du Markdown
// sur GitHub, lisible ici. `clé: valeur`, une par ligne.
const metaBlock = /<!--\s*meta\s*([\s\S]*?)-->/.exec(md)
const meta = {}
if (metaBlock) {
  for (const line of metaBlock[1].split('\n')) {
    const m = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+?)\s*$/.exec(line)
    if (m) meta[m[1]] = m[2]
  }
}

// ── Découpage en chapitres ──
// Un chapitre = un titre de niveau 2. Le corps court jusqu'au `## ` suivant.
// La première ligne de citation (`> …`) qui suit immédiatement le titre est
// extraite comme résumé de chapitre (affiché dans la navigation) et retirée
// du corps pour ne pas être rendue deux fois.
const parts = md.split(/^## /m)
const chapters = []
for (let i = 1; i < parts.length; i++) {
  const block = parts[i]
  const nl = block.indexOf('\n')
  const heading = (nl === -1 ? block : block.slice(0, nl)).trim()
  let body = nl === -1 ? '' : block.slice(nl + 1)

  let blurb = ''
  const q = /^\s*>\s?(.+?)\s*$/m.exec(body.split(/\n\s*\n/)[0] ?? '')
  if (q) {
    blurb = q[1]
    body = body.replace(/^\s*>\s?.+\n?/, '')
  }

  // « 3. LE SYSTÈME SPOT » → num "3", title "LE SYSTÈME SPOT", id "ch-3"
  // « A. PAGES »          → num "A", title "PAGES",           id "ch-a"
  const h = /^([0-9]+|[A-Z])\.\s*(.+)$/.exec(heading)
  const num = h ? h[1] : String(i - 1)
  const title = h ? h[2] : heading
  chapters.push({
    id: `ch-${num.toLowerCase()}`,
    num,
    title,
    blurb,
    markdown: body.replace(/\s+$/, ''),
  })
}

if (chapters.length === 0) {
  console.error('[build-tutorial] aucun chapitre trouvé (titres `## ` absents)')
  process.exit(1)
}

const doc = {
  title: (/^#\s+(.+)$/m.exec(md)?.[1] ?? 'REVS MASTER TUTORIAL').trim(),
  version: meta.version ?? '1.0',
  referenceCommit: meta.referenceCommit ?? '',
  referenceDate: meta.referenceDate ?? '',
  lastVerified: meta.lastVerified ?? '',
  chapters,
}

const banner = `// ⚠️ FICHIER GÉNÉRÉ — NE PAS ÉDITER À LA MAIN.
// Source : docs/REVS_MASTER_TUTORIAL.md
// Régénérer : npm run tutorial   (aussi lancé automatiquement par npm run build)
`

writeFileSync(
  OUT,
  `${banner}\nexport const TUTORIAL = ${JSON.stringify(doc, null, 2)}\n`,
  'utf8',
)

const words = md.split(/\s+/).filter(Boolean).length
console.log(
  `[build-tutorial] ${chapters.length} chapitres, ${words} mots → server/tutorial-content.js`,
)
