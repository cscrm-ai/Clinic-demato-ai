const CACHE_NAME = "allbele-v2";
const PRECACHE = ["/"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = e.request.url;

  // Skip non-http(s) schemes (chrome-extension, etc.)
  if (!url.startsWith("http")) return;

  // Skip API calls, analyze, auth, webhooks — let network handle directly
  if (url.includes("/api/") || url.includes("/analyze") || url.includes("/webhooks")) return;

  // Skip non-GET requests (HEAD, POST, etc.)
  if (e.request.method !== "GET") return;

  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.ok && resp.type === "basic") {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
