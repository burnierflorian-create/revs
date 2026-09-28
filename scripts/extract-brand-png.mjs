// ════════════════════════════════════════════════════════════════════════
//  REVS — extraction des PNG de marque depuis l'image de référence
// ════════════════════════════════════════════════════════════════════════
//
// Sur demande explicite : les icônes ne sont plus dessinées en SVG, elles
// sont DÉCOUPÉES dans l'image de référence fournie. Ce fichier est la seule
// source des PNG de public/brand/ ; on le relance avec `npm run brand:png`.
//
// ── CE QUE CETTE MÉTHODE COÛTE, ET QU'IL FAUT SAVOIR ──
//
// La référence est un rendu 3D, pas un fichier maître. Concrètement :
//   · la face de la tuile mesure 430 × 396 px utiles. Une icône 1024 est donc
//     AGRANDIE ~2,4× : elle sera visiblement moins nette qu'un tracé;
//   · le halo rouge, le reflet et le dégradé d'éclairage sont CUITS dans
//     l'image — impossible de les retirer, ils se retrouvent dans toutes les
//     tailles;
//   · la tuile est légèrement en perspective (ce n'est pas un carré parfait);
//   · un PNG ne suit pas le thème. Le monogramme blanc disparaîtrait sur le
//     thème clair, d'où la variante sombre générée plus bas par remplacement
//     de couleur.
//
// ── PROVENANCE ──
// brand-source/ conserve la découpe native, pour que ce script ne dépende
// plus du dossier Téléchargements et reste rejouable.
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = (p) => {
  const full = resolve(ROOT, p)
  mkdirSync(dirname(full), { recursive: true })
  return full
}

const TILE_SRC = resolve(ROOT, 'brand-source/revs-icon-tile.png')
const MONO_SRC = resolve(ROOT, 'brand-source/revs-monogram-cut.png')
const written = []

// ─────────────────── 1 · Découpe native (une seule fois) ───────────────────
if (!existsSync(TILE_SRC)) {
  const REF =
    process.env.REVS_REF ??
    '/Users/florian/Downloads/ChatGPT Image 28 sept. 2026, 18_58_49.png'
  if (!existsSync(REF))
    throw new Error(
      `Référence introuvable : ${REF}\n` +
        'brand-source/revs-icon-tile.png est absent ET la référence aussi.\n' +
        'Repasser le chemin via REVS_REF=... pour régénérer la découpe.',
    )
  // Découpe CARRÉE, centrée sur la face de la tuile (relevée à x 140..570,
  // y 268..664 dans la référence). Elle doit être carrée : une découpe
  // 512×478 redimensionnée en 1024×1024 étirait l'icône de 7 % en hauteur.
  await sharp(REF)
    .extract({ left: 107, top: 218, width: 496, height: 496 })
    .png()
    .toFile(TILE_SRC)
  written.push('brand-source/revs-icon-tile.png')
}

// ─────────────────── 2 · Détourage du monogramme ───────────────────
// Le fond de la tuile et le monogramme sont franchement séparés en
// luminance (mesuré : fond 0-70, monogramme 190-255, rien entre les deux),
// donc l'alpha se déduit directement de max(r,g,b). Le cadrage exclut le
// liseré spéculaire du bord de la tuile, qui sinon serait pris pour du trait.
if (!existsSync(MONO_SRC)) {
  const FACE = { left: 33, top: 50, width: 430, height: 396 }
  const { data, info } = await sharp(TILE_SRC)
    .extract(FACE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const W = info.width, H = info.height
  const buf = Buffer.alloc(data.length)
  const alpha = new Uint8Array(W * H)
  for (let k = 0; k < W * H; k++) {
    const i = k * 4
    const v = Math.max(data[i], data[i + 1], data[i + 2])
    const a = Math.round(Math.min(1, Math.max(0, (v - 90) / 80)) * 255)
    buf[i] = data[i]
    buf[i + 1] = data[i + 1]
    buf[i + 2] = data[i + 2]
    buf[i + 3] = a
    alpha[k] = a
  }

  // Filtrage par composantes connexes.
  // Le seuil de luminance retient aussi les éclats du liseré spéculaire, dans
  // les coins arrondis de la tuile : de petites taches rouges et blanches qui
  // se retrouvaient dans le PNG final et faussaient le cadrage. On ne garde
  // que les amas d'une taille significative — les cinq pièces du monogramme.
  const MIN_AREA = Math.round(W * H * 0.004)
  const seen = new Uint8Array(W * H)
  const keep = new Uint8Array(W * H)
  const stack = new Int32Array(W * H)
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || alpha[start] <= 200) continue
    let top = 0, area = 0
    const cells = []
    stack[top++] = start
    seen[start] = 1
    while (top > 0) {
      const k = stack[--top]
      cells.push(k)
      area++
      const x = k % W, y = (k / W) | 0
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const n = ny * W + nx
        if (seen[n] || alpha[n] <= 200) continue
        seen[n] = 1
        stack[top++] = n
      }
    }
    if (area >= MIN_AREA) for (const k of cells) keep[k] = 1
  }

  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let k = 0; k < W * H; k++) {
    if (!keep[k]) continue
    const x = k % W, y = (k / W) | 0
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  // Les pixels rejetés sont effacés ; ceux des bords adoucis d'une pièce
  // gardée sont conservés via un voisinage immédiat, pour ne pas créer un
  // contour dentelé.
  for (let k = 0; k < W * H; k++) {
    if (keep[k] || alpha[k] === 0) continue
    const x = k % W, y = (k / W) | 0
    let near = false
    for (let dy = -2; dy <= 2 && !near; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        if (keep[ny * W + nx]) { near = true; break }
      }
    if (!near) buf[k * 4 + 3] = 0
  }
  const pad = 3
  const left = Math.max(0, x0 - pad)
  const top = Math.max(0, y0 - pad)
  await sharp(buf, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract({
      left,
      top,
      width: Math.min(info.width - left, x1 - x0 + pad * 2),
      height: Math.min(info.height - top, y1 - y0 + pad * 2),
    })
    .png()
    .toFile(MONO_SRC)
  written.push('brand-source/revs-monogram-cut.png')
}

const monoMeta = await sharp(MONO_SRC).metadata()
console.log(`monogramme source : ${monoMeta.width}×${monoMeta.height} px natifs`)

// ─────────────────── 4 · Monogramme et ses calques ───────────────────
//
// Deux traitements sont appliqués au découpage brut :
//
// 1. RECOLORATION DU ROUGE. Mesuré sur la référence : ses rouges tournent
//    autour de #C80000–#D80008, un rouge pompier sans bleu, alors que
//    l'accent de l'interface est #E8203A (bleu = 58). Posés côte à côte —
//    intro, puis bouton SPOTTER — l'écart se voit. Le rouge est donc remappé
//    sur l'accent EN CONSERVANT le modelé : la luminance d'origine pilote un
//    dégradé entre une version assombrie et une version éclaircie de
//    l'accent, si bien que les reflets du rendu 3D survivent.
//
// 2. SÉPARATION EN CALQUES. L'intro révèle d'abord les parties rouges, puis
//    les blanches. Il faut donc pouvoir les afficher indépendamment.
const ACCENT = [0xe8, 0x20, 0x3a]
const isRed = (r, g, b) => r - g > 50 && r - b > 40

/**
 * @param mode  'full'   monogramme complet
 *              'red'    calque rouge seul
 *              'light'  calque clair seul
 * @param lightColor couleur des masses claires (blanc, ou noir pour fond clair)
 */
async function monoLayer(height, dest, mode = 'full', lightColor = null) {
  const { data, info } = await sharp(MONO_SRC)
    .resize({ height, kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const r = data[i], g = data[i + 1], b = data[i + 2]
    if (isRed(r, g, b)) {
      if (mode === 'light') {
        data[i + 3] = 0
        continue
      }
      // Le modelé d'origine (le canal rouge porte toute la dynamique) ne
      // pilote QUE la luminosité : l'accent est multiplié, jamais mélangé
      // vers le blanc. Un mélange vers le blanc remonte aussi le vert et le
      // bleu, et délave le rouge en rose — c'est ce qu'avait donné la
      // première tentative (#F07080 au lieu de #E8203A).
      // r = 205 (teinte médiane de la référence) tombe exactement sur
      // l'accent ; en dessous il s'assombrit, au-dessus il s'éclaircit.
      const m = Math.min(1.25, Math.max(0.62, 1 + (r - 205) * 0.0045))
      for (let c = 0; c < 3; c++)
        data[i + c] = Math.min(255, Math.round(ACCENT[c] * m))
    } else {
      if (mode === 'red') {
        data[i + 3] = 0
        continue
      }
      if (lightColor) {
        // Les masses claires sont reteintées en conservant leur modelé.
        const v = Math.max(r, g, b) / 255
        for (let c = 0; c < 3; c++)
          data[i + c] = Math.min(255, Math.round(lightColor[c] * (0.5 + v)))
      }
    }
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(out(dest))
  written.push(dest)
}

const BLACK_MASS = [0x0b, 0x0b, 0x0b]
// Monogramme complet, thème sombre puis thème clair.
await monoLayer(256, 'public/brand/revs-monogram.png')
await monoLayer(256, 'public/brand/revs-monogram-dark.png', 'full', BLACK_MASS)
await monoLayer(512, 'public/brand/revs-monogram-512.png')
// Calques pour l'animation d'intro.
await monoLayer(256, 'public/brand/revs-monogram-red.png', 'red')
await monoLayer(256, 'public/brand/revs-monogram-mass.png', 'light')
await monoLayer(256, 'public/brand/revs-monogram-mass-dark.png', 'light', BLACK_MASS)

// ─────────────────── 3 · Icônes ───────────────────
// Le monogramme découpé est reposé sur un carré #0B0B0B plein, plutôt que de
// reprendre la découpe de la tuile telle quelle. Raison : la référence est une
// photo de synthèse, et la tuile y baigne dans un décor (dégradé gris, traînées
// rouges à droite, reflet en bas). Recadrée au carré, ce décor entrait dans
// l'icône par les bords.
//
// Les coins arrondis ne sont volontairement PAS dessinés : iOS, Android et les
// lanceurs posent leur propre masque. Les dessiner donnerait un double arrondi,
// et le canal alpha correspondant fait refuser le binaire à l'upload App Store.
const BG = { r: 0x0b, g: 0x0b, b: 0x0b, alpha: 1 }
const RECOLORED = () => resolve(ROOT, 'public/brand/revs-monogram-512.png')
async function iconAt(size, dest, fill = 0.72) {
  const mark = await sharp(RECOLORED())
    .resize({ width: Math.round(size * fill), kernel: 'lanczos3' })
    .png()
    .toBuffer()
  const m = await sharp(mark).metadata()
  await sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([
      { input: mark, top: Math.round((size - m.height) / 2), left: Math.round((size - m.width) / 2) },
    ])
    .png({ compressionLevel: 9 })
    .toFile(out(dest))
  written.push(dest)
}
for (const s of [1024, 512, 256, 128]) await iconAt(s, `public/brand/revs-icon-${s}.png`)

// Icônes PWA et apple-touch-icon déjà référencées par index.html / le manifest.
for (const s of [152, 167, 180, 192, 512])
  await iconAt(s, `public/icons/icon-${s}x${s}.png`)

// ─────────────────── 5 · Favicons (monogramme seul, carré) ───────────────────
// Le monogramme est nettement plus large que haut : centré dans un carré, il
// n'occupe qu'une bande. C'est le prix du « monogramme seul » demandé pour le
// favicon — une tuile pleine serait plus lisible à 16 px.
for (const s of [32, 16]) {
  const inner = await sharp(MONO_SRC)
    .resize({ width: Math.round(s * 0.94), kernel: 'lanczos3' })
    .png()
    .toBuffer()
  const m = await sharp(inner).metadata()
  await sharp({
    create: { width: s, height: s, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: inner, top: Math.round((s - m.height) / 2), left: Math.round((s - m.width) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(out(`public/brand/favicon-${s}.png`))
  written.push(`public/brand/favicon-${s}.png`)
}

// ─────────────────── 6 · Splash ───────────────────
await sharp(MONO_SRC)
  .resize({ width: 1400, kernel: 'lanczos3' })
  .png({ compressionLevel: 9 })
  .toFile(out('public/brand/revs-splash-mark.png'))
written.push('public/brand/revs-splash-mark.png')

console.log('\nPNG générés :')
for (const w of written) console.log('  ' + w)

// ─────────────────── 7 · Assets natifs (Capacitor) ───────────────────
// Écrasent ceux que build-brand.mjs produisait depuis le tracé vectoriel.
// Rappel : ils survivent à `cap sync` mais pas à un `cap add` qui recrée la
// plateforme — dans ce cas, relancer ce script.
const ANDROID = 'android/app/src/main/res'
const IOS = 'ios/App/App/Assets.xcassets'
const DPI = [['mdpi', 48, 108], ['hdpi', 72, 162], ['xhdpi', 96, 216], ['xxhdpi', 144, 324], ['xxxhdpi', 192, 432]]

for (const [dpi, legacy, adaptive] of DPI) {
  await iconAt(legacy, `${ANDROID}/mipmap-${dpi}/ic_launcher.png`)

  const round = await sharp(out(`${ANDROID}/mipmap-${dpi}/ic_launcher.png`))
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}" fill="#fff"/></svg>`,
        ),
        blend: 'dest-in',
      },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer()
  const { writeFileSync } = await import('node:fs')
  writeFileSync(out(`${ANDROID}/mipmap-${dpi}/ic_launcher_round.png`), round)
  written.push(`${ANDROID}/mipmap-${dpi}/ic_launcher_round.png`)

  // Avant-plan adaptatif : FOND TRANSPARENT, dessin contenu dans la zone sûre
  // centrale (66 % du côté), le lanceur pouvant rogner tout le reste.
  const fg = await sharp(MONO_SRC)
    .resize({ width: Math.round(adaptive * 0.5), kernel: 'lanczos3' })
    .png()
    .toBuffer()
  const fm = await sharp(fg).metadata()
  await sharp({
    create: { width: adaptive, height: adaptive, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: fg, top: Math.round((adaptive - fm.height) / 2), left: Math.round((adaptive - fm.width) / 2) }])
    .png({ compressionLevel: 9 })
    .toFile(out(`${ANDROID}/mipmap-${dpi}/ic_launcher_foreground.png`))
  written.push(`${ANDROID}/mipmap-${dpi}/ic_launcher_foreground.png`)
}

// Splash Android + iOS : monogramme centré sur fond noir.
async function splashAt(w, h, dest) {
  const mark = await sharp(MONO_SRC)
    .resize({ width: Math.round(Math.min(w, h) * 0.56), kernel: 'lanczos3' })
    .png()
    .toBuffer()
  const m = await sharp(mark).metadata()
  await sharp({ create: { width: w, height: h, channels: 4, background: BG } })
    .composite([{ input: mark, top: Math.round((h - m.height) / 2), left: Math.round((w - m.width) / 2) }])
    .flatten({ background: BG })
    .png({ compressionLevel: 9 })
    .toFile(out(dest))
  written.push(dest)
}
for (const [dpi, w, h] of [['mdpi', 320, 480], ['hdpi', 480, 800], ['xhdpi', 720, 1280], ['xxhdpi', 960, 1600], ['xxxhdpi', 1280, 1920]]) {
  await splashAt(w, h, `${ANDROID}/drawable-port-${dpi}/splash.png`)
  await splashAt(h, w, `${ANDROID}/drawable-land-${dpi}/splash.png`)
}
await splashAt(1280, 1920, `${ANDROID}/drawable/splash.png`)

// iOS — l'icône App Store doit être OPAQUE : un canal alpha fait rejeter le
// binaire à l'upload.
{
  const src = await sharp(out('public/brand/revs-icon-1024.png')).flatten({ background: BG }).png({ compressionLevel: 9 }).toBuffer()
  const { writeFileSync } = await import('node:fs')
  writeFileSync(out(`${IOS}/AppIcon.appiconset/AppIcon-512@2x.png`), src)
  written.push(`${IOS}/AppIcon.appiconset/AppIcon-512@2x.png`)
}
for (const n of ['', '-1', '-2']) await splashAt(2732, 2732, `${IOS}/Splash.imageset/splash-2732x2732${n}.png`)

// Splash iOS hérité, référencé par index.html.
await splashAt(1170, 2532, 'public/splashscreens/iphone14.png')

console.log(`\nAssets natifs mis à jour (Android + iOS).`)
