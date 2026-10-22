// Bump CACHE_NAME when the PRECACHE list changes (a file added, renamed or
// removed), or when a font or the vendored d3 changes -- this is what tells
// browsers to fetch and install the new version. Pages, styles and scripts are
// network-first, so their edits reach people without a bump; the cached copies
// are only used offline, and every online load refreshes them.
// `npm run verify` (_dev/check-precache.mjs) checks that every file a page
// loads is listed here and that every listed file exists.
const CACHE_NAME = '2026-10-21f';

const PRECACHE = [
  // Pages
  '/',
  '/404.html',
  '/roth-conversion/',
  '/espp/',
  '/social-security-couples/',
  '/relocation/',
  '/medicare/',
  '/life-insurance/',
  // Styles
  '/core/page.css',
  '/core/tokens.css',
  '/core/components.css',
  '/core/fonts.css',
  // Scripts the pages load (without these, a cached page opens offline with no calculator)
  '/core/app.js',
  '/core/bootstrap.js',
  '/core/chart.js',
  '/core/contract.js',
  '/core/controls.js',
  '/core/finance.js',
  '/core/retirement-rules.js',
  '/core/share-link.js',
  '/core/summary.js',
  '/core/sw-init.js',
  '/core/theme.js',
  '/social-security-couples/social-security.js',
  '/relocation/relocation.js',
  '/relocation/relo-engine.mjs',
  '/medicare/medicare.js',
  '/medicare/medicare-engine.mjs',
  '/life-insurance/life-insurance.js',
  '/life-insurance/life-engine.mjs',
  // Vendor and fonts: cache-first (see below)
  '/core/vendor/d3.min.js',
  '/core/fonts/fraunces-latin-wght-normal.woff2',
  '/core/fonts/fraunces-latin-wght-italic.woff2',
  '/core/fonts/inter-latin-wght-normal.woff2',
  '/core/fonts/dm-sans-latin-wght-normal.woff2',
  '/core/fonts/playfair-display-latin-500-normal.woff2',
  '/core/fonts/playfair-display-latin-500-italic.woff2',
  '/core/fonts/playfair-display-latin-700-normal.woff2',
  '/core/fonts/playfair-display-latin-700-italic.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)));
  // No skipWaiting here: core/sw-init.js asks for it once the new SW is
  // installed, and reloads the page only if the person hasn't touched it.
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

// Sent by core/sw-init.js when a new SW has installed — activate immediately.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Fonts and the vendored d3 only change with a CACHE_NAME bump: cache-first.
const cacheFirst = path => path.startsWith('/core/fonts/') || path.startsWith('/core/vendor/');

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // don't intercept CDN or non-GET

  if (cacheFirst(url.pathname)) {
    e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
    return;
  }

  // Pages, styles and scripts: network-first, so people always get the latest
  // and a page never runs with older styles or scripts than its HTML. Each
  // successful response refreshes the cached copy, which is used only when the
  // network fails: the cached page if there is one, otherwise the cached 404
  // page for a navigation (better than a blank screen offline).
  const navigate = e.request.mode === 'navigate';
  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE_NAME).then(c => c.put(e.request, copy)));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: navigate })
          .then(r => r || (navigate ? caches.match('/404.html') : Response.error()))
      )
  );
});
