/* The Integrated Plan — service worker.
   Bump CACHE on every deploy. skipWaiting + clients.claim so the phone
   never keeps serving yesterday's build. */

var CACHE = 'plan-v1.13.0-m14';

var PRECACHE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'data/plan.json',
  'data/rules.json',
  'data/legacy.json',
  'data/areas/index.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) {
        /* Deliberately NOT cache.addAll: that rejects the whole install if a
           single file 404s, and a failed install means no active worker —
           which in turn means Chrome silently refuses to offer "Install app".
           One missing icon must not cost us installability. */
        return Promise.all(PRECACHE.map(function (url) {
          return cache.add(url).catch(function (err) {
            console.warn('[sw] could not precache', url, err);
          });
        })).then(function () {
          /* The areas are listed in their own index, so adding one never
             means editing this file. */
          return cache.match('data/areas/index.json')
            .then(function (res) { return res ? res.json() : { areas: [] }; })
            .then(function (index) {
              return Promise.all((index.areas || []).map(function (id) {
                var url = 'data/areas/' + id + '.json';
                return cache.add(url).catch(function (err) {
                  console.warn('[sw] could not precache', url, err);
                });
              }));
            })
            .catch(function (err) { console.warn('[sw] area index unreadable', err); });
        });
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* Network first, cache as the offline fallback. The cache is a safety net,
   not the source of truth — that way a fix ships the moment you reload. */
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(function (res) {
        /* 200 only — Cache.put rejects on a 206, and res.ok covers it. */
        if (res && res.status === 200) {
          var copy = res.clone();
          event.waitUntil(caches.open(CACHE).then(function (c) { return c.put(req, copy); }));
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          /* A deep link like #/plan/W6 is still index.html to the network. */
          if (req.mode === 'navigate') return caches.match('index.html');
          return Response.error();
        });
      })
  );
});
