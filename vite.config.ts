import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
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
