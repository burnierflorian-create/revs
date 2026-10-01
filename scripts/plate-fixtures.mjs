// ═══════ PLAQUES — FABRICATION DES CAS DE TEST ═══════
//
// Les cas listés au cahier des charges (plaque nette, inclinée, petite,
// partielle, multiple, absente) sont dérivés d'une photo RÉELLE du parc —
// la Toyota RAV4 du spot 358583a3, seul cas de régression avéré. Travailler
// sur des images de synthèse donnerait un détecteur validé sur des images de
// synthèse.
//
// Les fichiers produits ne contiennent que des plaques déjà publiques dans
// REVS ; rien de nouveau n'est exposé.
//
// USAGE
//   node scripts/plate-fixtures.mjs
//
// Écrit dans plate-tests/. N'écrit rien en base.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import sharp from 'sharp'

const OUT = 'plate-tests'
const SRC = '.plate-audit/toyota.jpg'
mkdirSync(OUT, { recursive: true })

if (!existsSync(SRC)) {
  console.error(`Source absente : ${SRC}\nLance d'abord scripts/plate-audit.mjs.`)
  process.exit(1)
}
const src = readFileSync(SRC)
const { width: W, height: H } = await sharp(src).metadata()

const made = []
const emit = async (name, buf, note) => {
  writeFileSync(`${OUT}/${name}.jpg`, buf)
  const m = await sharp(buf).metadata()
  made.push({ name, note, size: `${m.width}×${m.height}` })
}

// A — plaque clairement visible : la photo telle qu'elle est en ligne.
await emit('a-nette', src, 'plaque frontale nette, DM-107-SE lisible')

// B — plaque inclinée : rotation de 12°, fond gris pour ne pas introduire de
// transparence que le détecteur lirait comme un bord.
await emit(
  'b-inclinee',
  await sharp(src).rotate(12, { background: { r: 120, g: 120, b: 120 } }).jpeg({ quality: 92 }).toBuffer(),
  'même plaque, inclinée de 12°',
)

// C — plaque petite : l'image entière réduite à 40 %, donc la plaque aussi.
await emit(
  'c-petite',
  await sharp(src).resize({ width: Math.round(W * 0.4) }).jpeg({ quality: 92 }).toBuffer(),
  'image à 40 %, plaque ~4× plus petite',
)

// D — aucune plaque : moitié haute de la photo, la plaque est hors cadre.
await emit(
  'd-sans-plaque',
  await sharp(src).extract({ left: 0, top: 0, width: W, height: Math.round(H * 0.5) }).jpeg({ quality: 92 }).toBuffer(),
  'moitié haute : aucune plaque dans le cadre',
)

// E — plusieurs plaques : deux copies côte à côte, donc deux plaques.
const half = await sharp(src).resize({ width: Math.round(W * 0.6) }).jpeg({ quality: 92 }).toBuffer()
const hm = await sharp(half).metadata()
await emit(
  'e-multiple',
  await sharp({
    create: { width: hm.width * 2, height: hm.height, channels: 3, background: { r: 60, g: 60, b: 60 } },
  })
    .composite([
      { input: half, left: 0, top: 0 },
      { input: await sharp(half).flop().toBuffer(), left: hm.width, top: 0 },
    ])
    .jpeg({ quality: 92 })
    .toBuffer(),
  'deux plaques, dont une en miroir',
)

// F — plaque partiellement masquée : un bandeau opaque couvre le tiers droit
// de la plaque. Elle reste identifiable, donc elle doit rester détectée.
const plateBox = { x: 0.555, y: 0.648, w: 0.195, h: 0.028 } // relevé sur la photo
const bx = Math.round((plateBox.x + plateBox.w * 0.66) * W)
const by = Math.round(plateBox.y * H)
const bw = Math.round(plateBox.w * 0.34 * W)
const bh = Math.round(plateBox.h * H)
await emit(
  'f-partielle',
  await sharp(src)
    .composite([
      {
        input: Buffer.from(
          `<svg width="${W}" height="${H}"><rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="#303030"/></svg>`,
        ),
        top: 0,
        left: 0,
      },
    ])
    .jpeg({ quality: 92 })
    .toBuffer(),
  'tiers droit de la plaque masqué',
)

// G — plaque éloignée et dans l'ombre : réduction forte + assombrissement du
// bas de l'image, les deux conditions citées au cahier des charges.
await emit(
  'g-sombre-loin',
  await sharp(src)
    .resize({ width: Math.round(W * 0.5) })
    .modulate({ brightness: 0.45 })
    .jpeg({ quality: 92 })
    .toBuffer(),
  'moitié de taille + fortement sous-exposée',
)

console.log(`\n${made.length} cas écrits dans ${OUT}/\n`)
for (const m of made) console.log(`  ${m.name.padEnd(16)} ${m.size.padEnd(11)} ${m.note}`)
