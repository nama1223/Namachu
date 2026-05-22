// バージョンを上げると古いキャッシュが破棄される
const VERSION = 'v26';
const CACHE_NAME = `namachu-cache-${VERSION}`;

const urlsToCache = [
  './index.html',
  './manifest.json',
  './manifest-en.json',
  './NamaChuLogo192.png',
  './NamaChuLogo512.png',
  './NamaTuneLogo192.png',
  './NamaTuneLogo512.png',
  './css/variables.css',
  './css/base.css',
  './css/tabs.css',
  './css/tuner.css',
  './css/record.css',
  './css/scale.css',
  './css/settings.css',
  './js/app.js',
  './js/audio.js',
  './js/calibration.js',
  './js/i18n.js',
  './js/record.js',
  './js/scale.js',
  './js/settings.js',
  './js/tuner.js',
  './js/utils.js',
  './js/extInput.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ネットワークファースト＋HTTPキャッシュバイパス。
// オンライン時は常に最新を取得するため `cache: 'no-cache'`（条件付きGETで検証）を使用。
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
