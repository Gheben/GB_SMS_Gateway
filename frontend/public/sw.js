// Service Worker minimale — richiesto dai browser per attivare il prompt "Installa app"
// Non fa caching aggressivo: si limita a soddisfare il criterio PWA installabile.

const CACHE = 'smsgateway-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(['/']))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first: prova sempre la rete, fallback alla cache solo se offline
self.addEventListener('fetch', (event) => {
  // Non intercettare le chiamate API
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res.ok && event.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
