// Prépare l'image d'accueil à partir de la source fournie.
//
// La source est en PAYSAGE (1672 × 941). Le portrait 1440 × 3120 demandé
// aurait exigé une découpe de 434 px de large agrandie 3,3× — illisible. Le
// recadrage mobile vise donc le format réel du hero à l'écran (environ 3:4
// pour 65 vh sur un téléphone) et reste à un agrandissement de 1,7×.
import { existsSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC =
  process.env.HERO_SRC ??
  '/Users/florian/Downloads/ChatGPT Image 28 sept. 2026, 21_27_22.png'
if (!existsSync(SRC)) throw new Error(`Source introuvable : ${SRC}`)
const out = (p) => { const f = resolve(ROOT, p); mkdirSync(dirname(f), { recursive: true }); return f }

const meta = await sharp(SRC).metadata()
console.log(`source : ${meta.width} × ${meta.height}`)

// Paysage — servi aux écrans larges.
await sharp(SRC).resize({ width: 1600 }).webp({ quality: 82 }).toFile(out('public/images/hero-home.webp'))

// Portrait — la voiture est au centre-droit ; la découpe la garde cadrée.
const pw = Math.round(meta.height * 0.75)
await sharp(SRC)
  .extract({ left: Math.round(1050 - pw / 2), top: 0, width: pw, height: meta.height })
  .resize({ width: 1200, height: 1600, fit: 'cover' })
  .webp({ quality: 80 })
  .toFile(out('public/images/hero-home-mobile.webp'))

// Repli PNG. Un JPEG serait bien plus léger sur une photo, mais le PNG a été
// demandé explicitement ; il n'est servi qu'aux navigateurs sans WebP, ce qui
// ne concerne plus aucun navigateur maintenu.
await sharp(SRC).resize({ width: 1280 }).png({ compressionLevel: 9, quality: 80 }).toFile(out('public/images/hero-home.png'))

const { statSync } = await import('node:fs')
for (const f of ['hero-home.webp', 'hero-home-mobile.webp', 'hero-home.png']) {
  const m = await sharp(out(`public/images/${f}`)).metadata()
  console.log(`  ${f.padEnd(24)} ${m.width}×${m.height}  ${(statSync(out(`public/images/${f}`)).size / 1024).toFixed(0)} ko`)
}
