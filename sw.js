const CACHE_NAME = 'namachu-cache-auto';

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
  './js/i18n.js',
  './js/record.js',
  './js/scale.js',
  './js/settings.js',
  './js/tuner.js',
  './js/utils.js',
];

// インストール時: 必須ファイルをキャッシュし、即座に有効化
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

// 有効化時: 古いキャッシュを削除してすぐにクライアントを制御
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ネットワークファースト: オンライン時は最新版を取得してキャッシュ更新、オフライン時はキャッシュから返す
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith('http')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
