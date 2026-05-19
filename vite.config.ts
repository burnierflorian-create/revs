import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Custom SW (src/sw.ts) via injectManifest. We do NOT precache
      // app assets — the prior generateSW precache repeatedly bricked
      // clients after deploys (stale index.html → deleted hashed chunks
      // → blank screen). injectionPoint:undefined disables the precache
      // manifest entirely; the SW only does Web Push + notifications and
      // wipes any leftover caches on activate.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectManifest: { injectionPoint: undefined },
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
