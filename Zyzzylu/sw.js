const CACHE_NAME = 'zyzylu-v1';
const ASSETS = [
  './',
  './index.html',
  './core.js',
  './search.js',
  './quiz_bridge.js',
  './judge.js',
  './zyzzylu_cpp_engine.js',
  './zyzzylu_cpp_engine.wasm',
  './CSW24.txt',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cachedResponse => {
      if (cachedResponse) {
        // Fetch fresh in background to update cache for next time (Stale-While-Revalidate)
        fetch(e.request).then(networkResponse => {
          if (networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(cache => cache.put(e.request, networkResponse));
          }
        }).catch(() => {/* Ignore network errors */});
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});
