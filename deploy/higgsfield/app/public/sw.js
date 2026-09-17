/* Minimal offline shell cache. Game logic needs network; this only makes the PWA installable
   and lets the lobby load without connectivity. */
const CACHE = "mobilwar-20260917124042";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon.svg"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// The page asks the waiting worker to take over as soon as the player accepts
// (or on launch, where a reload costs nothing).
self.addEventListener("message", (e) => {
  if (e.data === "skip-waiting") self.skipWaiting();
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        // version.json must never come from the cache: it is how the app learns
        // a new build exists.
        if (url.pathname === "/version.json") return r;
        if (r.ok && (url.pathname === "/" || url.pathname.startsWith("/assets/"))) {
          const copy = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((m) => m ?? Response.error())),
  );
});
