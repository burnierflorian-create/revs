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
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'revs',
        short_name: 'revs',
        description: 'Spotte les supercars autour de toi',
        theme_color: '#E63946',
        background_color: '#0A0A0A',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
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
