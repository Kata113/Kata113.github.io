const CACHE_NAME = 'arctic-v6';

// Phase 1 — pre-cached during install (small, fast).
// Keeps SW install well under mobile timeout so PWA can be installed.
const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css?v=19',
  './core.js?v=16',
  './search.js?v=8',
  './quiz_bridge.js?v=15',
  './judge.js?v=7',
  './clock.js?v=3',
  './manifest.json?v=4',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/favicon-32x32.png',
  './icons/apple-touch-icon.png',
  './arctic_cpp_engine.js',
  './arctic_cpp_engine.wasm',
];

// Phase 2 — large assets cached in background after activation.
// Not in install so mobile never times out on a 9.9 MB fetch.
const HEAVY_ASSETS = [
  './CSW24.txt',
];

function cacheHeavyAssets() {
  caches.open(CACHE_NAME).then(cache =>
    HEAVY_ASSETS.forEach(url =>
      cache.match(url).then(hit => {
        if (!hit) {
          fetch(url)
            .then(res => { if (res && res.status === 200) cache.put(url, res); })
            .catch(() => {}); // silently skip if offline at install time
        }
      })
    )
  );
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => cacheHeavyAssets())  // fire background download after claiming
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) {
        // Stale-while-revalidate: serve cache instantly, refresh in background.
        fetch(e.request)
          .then(res => {
            if (res && res.status === 200)
              caches.open(CACHE_NAME).then(c => c.put(e.request, res));
          })
          .catch(() => {});
        return cached;
      }
      // Not cached yet: fetch from network and store for offline use.
      return fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => {
        // Offline and not cached — return a helpful offline fallback for HTML.
        if (e.request.headers.get('Accept')?.includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});
