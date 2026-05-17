import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // The precaching service worker has repeatedly bricked clients
      // after deploys (stale SW serving an old index.html that points at
      // deleted hashed chunks -> "client-side exception"). Ship a
      // self-destroying SW: it unregisters any existing SW and clears all
      // caches on every client, so the app is always served fresh from
      // the network. Trade-off: no offline caching (acceptable — the app
      // is data-driven and reliability is the priority).
      selfDestroying: true,
      includeAssets: ['favicon.svg'],
      workbox: {
        // mapbox-gl pushes the main bundle past the 2 MiB default
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // No navigateFallback: serving the *precached* index.html after a
        // deploy points at deleted hashed JS and bricks the app. Fetch the
        // document network-first so asset hashes always match the deploy.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 10 },
            },
          },
          {
            urlPattern: /^https:\/\/api\.mapbox\.com\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'mapbox-cache',
              expiration: { maxEntries: 50, maxAgeSeconds: 3600 },
            },
          },
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\//,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-cache',
              expiration: { maxAgeSeconds: 60 },
            },
          },
        ],
      },
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
