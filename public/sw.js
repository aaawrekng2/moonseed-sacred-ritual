/* Tarot Seed minimal service worker.
 * Caches the app shell so the home screen icon launches even when offline.
 * We deliberately keep the cache small and use network-first for navigations
 * so deploys propagate without needing a manual "update" prompt.
 */
const CACHE = "tarotseed-shell-v3";
// Only cache truly static assets — never HTML or JS bundles. Caching JS
// (cache-first) caused hydration mismatches because the SW would serve a
// stale client bundle against a fresh SSR HTML response.
const SHELL = ["/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML navigations so updates ship promptly.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("/"))),
    );
    return;
  }

  // Never cache JS / CSS / hashed build assets — always go to the network so
  // the client bundle stays in lockstep with the SSR HTML. Only cache-first
  // truly static files (icons, manifest).
  if (
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".mjs") ||
    url.pathname.startsWith("/_build/") ||
    url.pathname.startsWith("/assets/")
  ) {
    return; // let the browser hit the network directly
  }

  // Cache-first for other same-origin GETs (icons, manifest).
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type === "basic") {
              const copy = res.clone();
              caches
                .open(CACHE)
                .then((cache) => cache.put(req, copy))
                .catch(() => undefined);
            }
            return res;
          })
          .catch(() => cached),
    ),
  );
});