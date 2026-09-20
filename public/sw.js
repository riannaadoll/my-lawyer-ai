// sw.js — service worker: sayt oflayn ochilishi va "ilova sifatida o'rnatish" uchun kerak.
const CACHE = "advocate-v5";
const SHELL = ["/", "/style.css", "/app.js", "/i18n.js", "/manifest.json", "/icons/icon-192.png", "/icons/logo-mark.png"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// Avval internetdan olamiz (yangi versiya ko'rinsin), internet bo'lmasa keshdan beramiz.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;   // API keshlanmaydi
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request))
  );
});
