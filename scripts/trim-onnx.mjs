// ═══════ ALLÈGEMENT D'onnxruntime-node POUR LE DÉPLOIEMENT ═══════
//
// ── LE PROBLÈME ──
// `onnxruntime-node` publie les binaires natifs des TROIS plateformes dans un
// seul paquet : 133 Mo installés, dont 49 Mo de darwin et 53 Mo de win32 qui
// ne serviront jamais sur Vercel. Il n'existe pas de variante par plateforme
// (vérifié : aucune `optionalDependencies` jusqu'à la 1.31-dev, et la dernière
// version pèse 301 Mo décompressée).
//
// Une fonction serverless Vercel est plafonnée à 250 Mo décompressés. Avec le
// SDK Anthropic, sharp, supabase-js et le runtime, 133 Mo de binaires inutiles
// suffisent à faire échouer la construction — ce qu'a fait le déploiement
// dpl_CWLSyDuy du 01/10.
//
// ── CE QUE FAIT CE SCRIPT ──
// Sur Vercel UNIQUEMENT, il supprime les binaires des plateformes qui ne sont
// pas celle de la construction. 133 Mo → ~31 Mo. En local il ne touche à rien :
// supprimer les binaires darwin casserait le poste de développement, et les
// scripts d'audit tournent sur la machine.
//
// Il est délibérément NON FATAL : si le paquet est absent ou déjà allégé, il
// se tait et rend la main. Un échec ici ne doit pas empêcher une construction
// qui, par ailleurs, n'a pas besoin de lui.

import { rmSync, existsSync, readdirSync } from 'node:fs'
import { platform } from 'node:process'

const ROOT = new URL('../node_modules/onnxruntime-node/bin/', import.meta.url).pathname

if (!process.env.VERCEL) {
  console.log('[trim-onnx] hors Vercel — aucun binaire retiré (le poste de dev en a besoin)')
  process.exit(0)
}
if (!existsSync(ROOT)) {
  console.log('[trim-onnx] onnxruntime-node absent — rien à faire')
  process.exit(0)
}

let removed = 0
for (const napi of readdirSync(ROOT)) {
  const dir = `${ROOT}${napi}/`
  if (!existsSync(dir)) continue
  for (const plat of readdirSync(dir)) {
    if (plat === platform) continue
    try {
      rmSync(`${dir}${plat}`, { recursive: true, force: true })
      console.log(`[trim-onnx] retiré ${napi}/${plat}`)
      removed += 1
    } catch (e) {
      console.warn(`[trim-onnx] ${napi}/${plat} non retiré :`, e?.message ?? e)
    }
  }
}
console.log(`[trim-onnx] ${removed} plateforme(s) retirée(s), ${platform} conservée`)
