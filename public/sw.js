// POS Service Worker — caches the /pos shell and JS chunks for offline use.
// Bump CACHE_VER after a major deploy to evict old cached HTML.
const CACHE_VER = 'v3';
const PAGE_CACHE   = `pos-pages-${CACHE_VER}`;
const STATIC_CACHE = `pos-static-${CACHE_VER}`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e =>
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('pos-') && k !== PAGE_CACHE && k !== STATIC_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
);

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // Never intercept API calls — they go to the server (or queue offline via app logic)
  if (url.pathname.startsWith('/api/')) return;

  // ── Content-hashed Next.js static chunks ─────────────────────────────────
  // These never change for a given filename, so cache-first is safe forever.
  if (url.pathname.startsWith('/_next/static/')) {
    e.respondWith(
      caches.match(request).then(cached =>
        cached ||
        fetch(request).then(res => {
          if (res.ok) { const clone = res.clone(); caches.open(STATIC_CACHE).then(c => c.put(request, clone)); }
          return res;
        })
      )
    );
    return;
  }

  // ── Page navigations (HTML) ───────────────────────────────────────────────
  // Network-first so the page is always fresh when online.
  // Falls back to the cached shell when offline.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) { const clone = res.clone(); caches.open(PAGE_CACHE).then(c => c.put(request, clone)); }
          return res;
        })
        .catch(() =>
          caches.match(request)
            .then(cached => cached || caches.match('/pos'))
        )
    );
    return;
  }

  // ── Other Next.js runtime files (not content-hashed) ─────────────────────
  if (url.pathname.startsWith('/_next/')) {
    e.respondWith(
      caches.match(request).then(cached =>
        cached ||
        fetch(request).then(res => {
          if (res.ok) { const clone = res.clone(); caches.open(STATIC_CACHE).then(c => c.put(request, clone)); }
          return res;
        })
      )
    );
  }
});
