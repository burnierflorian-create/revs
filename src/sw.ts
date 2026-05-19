/// <reference lib="webworker" />
// Minimal, STABLE service worker. It deliberately does NOT precache or
// cache app JS/CSS — that is what repeatedly bricked clients after a
// deploy (a stale SW served an old index.html pointing at deleted
// hashed chunks → blank screen / "client-side exception"). This SW only
// handles Web Push + notification clicks, takes over immediately, and
// purges any leftover caches from previous SW versions.

declare const self: ServiceWorkerGlobalScope

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      // Nuke every cache a previous (precaching) SW may have left so we
      // can never serve stale hashed assets again.
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('push', (event: PushEvent) => {
  let p: { title?: string; body?: string; url?: string } = {}
  try {
    p = event.data ? event.data.json() : {}
  } catch {
    p = {}
  }
  event.waitUntil(
    self.registration.showNotification(p.title || 'REVS', {
      body: p.body || '',
      icon: '/icons/icon-192x192.png',
      badge: '/icons/icon-192x192.png',
      data: { url: p.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close()
  const url =
    (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const c of all) {
        const wc = c as WindowClient
        if ('focus' in wc) {
          try {
            await wc.navigate(url)
          } catch {
            /* navigate can throw cross-origin — ignore */
          }
          return wc.focus()
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})

export {}
