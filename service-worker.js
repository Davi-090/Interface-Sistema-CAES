const CACHE_NAME = 'caes-app-v1';
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './mobile-style.css',
  './script.js',
  './manifest.webmanifest',
  './Pictures/Mansueto_Logo.png',
  './Pictures/Mansueto_Logo_White.png',
  './Pictures/Mansueto_Logo_Black.png',
  './Pictures/caes-icon-192.png',
  './Pictures/caes-icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith('caes-app-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      url.pathname.endsWith('/service-worker.js')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(request, { cache: 'no-store' });
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (_) {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const appPage = await cache.match('./index.html');
        if (appPage) return appPage;
      }
      return Response.error();
    }
  })());
});
