const CACHE_NAME = 'zyzzylu-v2';
const ASSETS = [
  './', './index.html', './core.js', './search.js',
  './quiz_bridge.js', './judge.js', './CSW24.txt',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&display=swap'
];

// Optional assets (cache if available, skip if 404)
const OPTIONAL_ASSETS = [
  './zyzzylu_cpp_engine.js',
  './zyzzylu_cpp_engine.wasm',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Cache required assets — must all succeed
      await cache.addAll(ASSETS);

      // Cache optional assets individually — skip on failure
      await Promise.allSettled(
        OPTIONAL_ASSETS.map(url =>
          cache.add(url).catch(() => console.log(`[SW] Optional asset skipped: ${url}`))
        )
      );
    }).then(() => self.skipWaiting())
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
