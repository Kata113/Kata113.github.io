const CACHE_NAME = 'arctic-v1';
const ASSETS = [
  './', './index.html', './styles.css?v=18', './core.js?v=16', './search.js?v=8',
  './quiz_bridge.js?v=13', './judge.js?v=7', './clock.js?v=4', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './favicon.ico',
  './arctic_cpp_engine.js', './arctic_cpp_engine.wasm', './CSW24.txt'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        fetch(e.request).then(res => {
          if (res.status === 200) caches.open(CACHE_NAME).then(c => c.put(e.request, res));
        }).catch(() => {});
        return cached;
      }
      return fetch(e.request);
    })
  );
});
