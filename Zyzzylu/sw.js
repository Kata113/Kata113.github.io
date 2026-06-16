const CACHE_NAME = 'zyzzylu-v3';
const ASSETS = [
  './', './index.html', './core.js', './search.js',
  './quiz_bridge.js', './judge.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png',
  './zyzzylu_cpp_engine.js', './zyzzylu_cpp_engine.wasm', './CSW24.txt',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap'
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
