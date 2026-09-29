import { defineConfig, loadEnv, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// ── /api/tutorial en développement ──
// Les fonctions de `api/` ne tournent pas sous le serveur de développement
// Vite : sans ce relais, la page /tutorial serait impossible à travailler en
// local (elle n'afficherait qu'une erreur de chargement). Le document étant
// destiné à être enrichi régulièrement, c'est une gêne durable.
//
// `apply: 'serve'` — ce plugin n'existe QUE sous `npm run dev`. Il n'est pas
// dans le bundle de production, et il ne touche pas la fonction déployée.
//
// Il applique EXACTEMENT le même contrôle que api/tutorial.ts : jeton
// Supabase vérifié, adresse comparée. Un compte non autorisé obtient 404 en
// local comme en production — on ne développe pas contre une porte ouverte.
function tutorialDevApi(): PluginOption {
  return {
    name: 'revs-tutorial-dev-api',
    apply: 'serve',
    configureServer(server) {
      // Vite expose .env.local via import.meta.env, pas via process.env :
      // on recopie les deux variables dont le handler a besoin.
      const env = loadEnv(server.config.mode, process.cwd(), '')
      for (const k of [
        'SUPABASE_URL',
        'VITE_SUPABASE_URL',
        'VITE_SUPABASE_ANON_KEY',
        'REVS_TUTORIAL_EMAIL',
      ]) {
        if (env[k] && !process.env[k]) process.env[k] = env[k]
      }

      server.middlewares.use('/api/tutorial', async (req, res) => {
        const { default: handler } = await server.ssrLoadModule(
          '/api/tutorial.ts',
        )
        const url = `http://localhost${req.url ?? '/'}`
        const auth = req.headers.authorization
        const response: Response = await handler(
          new Request(url, {
            method: req.method,
            headers: auth ? { authorization: auth } : {},
          }),
        )
        res.statusCode = response.status
        response.headers.forEach((v, k) => res.setHeader(k, v))
        res.end(await response.text())
      })
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tutorialDevApi(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Custom SW (src/sw.ts) via injectManifest. We do NOT precache or
      // serve app assets — the prior generateSW precache repeatedly bricked
      // clients after deploys (stale index.html → deleted hashed chunks →
      // blank screen). src/sw.ts has NO precacheAndRoute and NO fetch
      // handler, so nothing is ever served from cache.
      // We DO inject a tiny manifest (index.html only) so the compiled SW
      // bytes CHANGE on every deploy that changes the app. That is what lets
      // the browser detect a new SW; combined with registerType:'autoUpdate'
      // and the SW's skipWaiting/clients.claim, every client reloads onto
      // the fresh build automatically — no manual cache-clear needed.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: {
        injectionPoint: 'self.__WB_MANIFEST',
        globPatterns: ['**/*.html'],
      },
      includeAssets: ['brand/favicon-32.png', 'brand/favicon-16.png'],
      manifest: {
        name: 'REVS',
        short_name: 'REVS',
        description: 'Cars. Spots. Passion.',
        // theme_color teinte la barre système Android ; background_color est
        // la couleur peinte AVANT le premier rendu (écran de lancement PWA).
        // On aligne ce dernier sur --revs-black (#0B0B0B) de la charte.
        theme_color: '#E8203A',
        background_color: '#0B0B0B',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        // Toutes générées par scripts/build-brand.mjs depuis le même master.
        //
        // `maskable` : Android recadre l'icône dans la forme choisie par le
        // lanceur et peut rogner jusqu'à ~20 % sur chaque bord. Le master
        // laisse volontairement 12 % de marge autour du monogramme, donc le
        // même fichier tient les deux rôles sans être tronqué.
        icons: [
          {
            src: '/brand/revs-icon-128.png',
            sizes: '128x128',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/brand/revs-icon-256.png',
            sizes: '256x256',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
