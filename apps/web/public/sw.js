// Renovacell · Service worker de AVISOS (Web Push). Solo muestra el aviso que manda el servidor y, al tocarlo, abre
// la conversación. No guarda caché ni intercepta páginas: el sistema funciona igual que sin él.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('push', (e) => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch (_) { d = { body: e.data ? e.data.text() : '' } }
  const titulo = typeof d.title === 'string' && d.title ? d.title : 'Renovacell'
  e.waitUntil(self.registration.showNotification(titulo, {
    body: typeof d.body === 'string' ? d.body : 'Tienes un mensaje nuevo.',
    icon: '/brand/app-192-v2.png',
    badge: '/brand/icon-192.png',
    tag: typeof d.tag === 'string' ? d.tag : 'rc-chat',
    renotify: true,
    data: { url: typeof d.url === 'string' ? d.url : '/sistema' },
  }))
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const destino = (e.notification.data && e.notification.data.url) || '/sistema'
  e.waitUntil((async () => {
    const abiertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of abiertas) {
      try { if (new URL(c.url).pathname === new URL(destino, self.location.origin).pathname && 'focus' in c) return c.focus() } catch (_) { /* sigue */ }
    }
    return self.clients.openWindow(destino)
  })())
})
