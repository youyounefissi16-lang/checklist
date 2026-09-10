// ---------------------------------------------------------------------------
// sw.js  —  Service Worker for PWA offline support
// Cache-version: bump to force cache update on new deployments
// ---------------------------------------------------------------------------
var CACHE_VERSION = "v21.1";
var CACHE_NAME = "checklist-audit-" + CACHE_VERSION;
var CORE_ASSETS = [
  "/",
  "/index.html",
  "/styles.css?v=21.1",
  "/i18n.js?v=21.1",
  "/storage.js?v=21.1",
  "/jspdf.umd.min.js?v=21",
  "/app.js?v=21.1",
  "/manifest.json",
  "/icons/icon-192.webp",
  "/icons/icon-512.webp"
];

// Install: pre-cache core assets
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Activate: clean up old caches
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (name) {
          return name !== CACHE_NAME;
        }).map(function (name) {
          return caches.delete(name);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Fetch: cache-first, fall back to network, cache the response
self.addEventListener("fetch", function (event) {
  // Skip non-GET and cross-origin requests
  if (event.request.method !== "GET") return;
  var url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        // Don't cache non-success responses
        if (!response || response.status !== 200) return response;
        // Don't cache opaque responses from CDNs
        if (response.type === "opaque") return response;
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, clone);
        });
        return response;
      }).catch(function () {
        // Offline fallback: return the cached index.html for navigation requests
        if (event.request.mode === "navigate") {
          return caches.match("/index.html");
        }
        return new Response("Offline", { status: 503, statusText: "Offline" });
      });
    })
  );
});
