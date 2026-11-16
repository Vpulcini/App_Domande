/* Service worker: tutto in cache per l'uso offline, con aggiornamento in background. */
'use strict';

// Tenere allineato a VERSION in core.js (il test lo verifica). Cambiarlo forza l'aggiornamento dell'app.
var VERSION = '1.0.0';
var CACHE = 'carte-cdg-' + VERSION;
var FILES = [
  './',
  './index.html',
  './app.js',
  './core.js',
  './style.css',
  './manifest.webmanifest',
  './domande.csv',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(FILES.map(function (u) { return new Request(u, { cache: 'reload' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf('carte-cdg-') === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Chiave di cache senza parametri (?controllo, ?fresh=...).
function cacheKey(url) {
  return url.origin + url.pathname;
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Controllo esplicito di una nuova versione di domande.csv: prima la rete, poi la cache.
  if (url.pathname.endsWith('/domande.csv') && url.searchParams.has('fresh')) {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { return c.put(cacheKey(url), copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(cacheKey(url)).then(function (r) {
          if (!r) return Response.error();
          // segnala all'app che è la copia salvata, non quella appena scaricata
          var h = new Headers(r.headers);
          h.set('X-Carte-Offline', '1');
          return r.blob().then(function (b) { return new Response(b, { status: 200, headers: h }); });
        });
      })
    );
    return;
  }

  // Tutto il resto: stale-while-revalidate.
  var key = cacheKey(url);
  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(key).then(function (cached) {
        var network = fetch(req, { cache: 'no-cache' }).then(function (res) {
          if (res.ok && res.type === 'basic') cache.put(key, res.clone());
          return res;
        });
        if (cached) {
          event.waitUntil(network.catch(function () {}));
          return cached;
        }
        return network.catch(function () {
          if (req.mode === 'navigate') {
            return cache.match(new URL('./', self.location).href).then(function (r) { return r || Response.error(); });
          }
          return Response.error();
        });
      });
    })
  );
});
