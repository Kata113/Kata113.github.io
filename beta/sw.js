const CACHE_NAME = 'zyzzylu-v1';
const ASSETS = [
  './',
  './index.html',
  './core.js',
  './search.js',
  './zyzzylu_cpp_engine.js',
  './quiz_bridge.js',
  './judge.js',
  './CSW24.txt' // ยืนยันการดักจับพจนานุกรมลงแคชตัวเครื่อง
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
        return cachedResponse;
      }
      return fetch(e.request);
    })
  );
});
