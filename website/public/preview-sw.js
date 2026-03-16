const PREVIEW_IMAGE_CACHE_NAME = "mapart-preview-images-v1";
const PREVIEW_IMAGE_PATH_RE = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i;

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !PREVIEW_IMAGE_PATH_RE.test(url.pathname)) return;

  event.respondWith((async () => {
    const cache = await caches.open(PREVIEW_IMAGE_CACHE_NAME);
    const cached = await cache.match(request);
    return cached || fetch(request);
  })());
});
