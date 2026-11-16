/* Só recursos públicos da tela offline. APIs, páginas de reservas e agenda nunca entram no cache. */
const CACHE = 'tomaz-hub-static-v1';
const STATIC = [
  '/offline-hub.html',
  '/offline-hub.css',
  '/icons/tomaz-barber-192.png',
  '/icons/tomaz-barber-512.png',
  '/icons/salao-aurora-192.png',
  '/icons/salao-aurora-512.png',
];
self.addEventListener('install', (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(STATIC))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('tomaz-hub-static-') && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (STATIC.includes(url.pathname)) {
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(event.request).then((hit) => hit || fetch(event.request))),
    );
    return;
  }
  if (event.request.mode === 'navigate' && /^\/s\/[^/]+\/hub\/?$/.test(url.pathname)) {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches
          .open(CACHE)
          .then((cache) => cache.match('/offline-hub.html'))
          .then(
            (response) =>
              (response
                ? new Response(response.body, { status: 200, headers: response.headers })
                : null) ||
              new Response('Sem conexão. Reconecte para abrir a agenda.', {
                status: 503,
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
              }),
          ),
      ),
    );
  }
});
