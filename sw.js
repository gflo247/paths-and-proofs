// Bump CACHE_NAME on every meaningful deploy — this is what tells
// browsers to fetch and install the new version.
const CACHE_NAME = '2026-09-26e';

const PRECACHE = [
  '/',
  '/roth-conversion/',
  '/social-security-couples/',
  '/relocation/',
  // /medicare/ deliberately excluded — not yet a live-linked tool; a non-200
  // response from any single PRECACHE entry causes the entire install to fail.
  '/core/page.css',
  '/core/tokens.css',
  '/core/components.css',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)));
  // Do NOT skipWaiting here — new SW waits until user clicks Refresh
  // in the banner, preventing mid-session disruption.
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// User clicked "Refresh" in the update banner — activate immediately.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // don't intercept CDN

  // Navigation requests (HTML): network-first so users always get latest content.
  // Falls back to cache only when offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }

  // CSS and other same-origin assets: cache-first.
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
