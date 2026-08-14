// POS Service Worker — caches the /pos shell and JS chunks for offline use,
// plus product images from known external CDNs so they persist across days
// on the same device instead of re-fetching from Shopify/Drive every morning.
// Bump CACHE_VER after a major deploy to evict old cached HTML / JS bundles.
const CACHE_VER = 'v4';
const PAGE_CACHE   = `pos-pages-${CACHE_VER}`;
const STATIC_CACHE = `pos-static-${CACHE_VER}`;
const IMAGE_CACHE  = `pos-images-${CACHE_VER}`;

// Product-image hosts we're willing to cache-first. Anything else (other
// cross-origin requests — analytics, other APIs, etc.) is left untouched.
const IMAGE_HOSTS = [
  'cdn.shopify.com',
  'drive.google.com',
  'lh3.googleusercontent.com',
];

// Cache Storage has no automatic eviction — bound growth manually so the
// image cache can't grow unbounded on devices with very large catalogs.
const MAX_IMAGE_ENTRIES = 3000;

// A cold catalogue can populate hundreds of images at once. Scanning the
// entire cache after every put() turns that burst into hundreds of overlapping
// cache.keys() calls and heavy browser disk/CPU churn. Coalesce the burst into
// one prune after writes have settled.
let imagePruneTimer = null;

function scheduleImageCachePrune() {
  if (imagePruneTimer !== null) clearTimeout(imagePruneTimer);
  imagePruneTimer = setTimeout(() => {
    imagePruneTimer = null;
    pruneImageCache().catch(() => {});
  }, 2000);
}

async function pruneImageCache() {
  const cache = await caches.open(IMAGE_CACHE);
  const keys = await cache.keys();
  if (keys.length <= MAX_IMAGE_ENTRIES) return;
  // Oldest entries are earliest in insertion order (Cache API preserves put() order).
  const excess = keys.length - MAX_IMAGE_ENTRIES;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e =>
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith('pos-') && k !== PAGE_CACHE && k !== STATIC_CACHE && k !== IMAGE_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
);

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // ── Cross-origin product images (Shopify CDN / Google Drive) ─────────────
  // Cache-first: once fetched, an image is served from Cache Storage on every
  // subsequent day on this device rather than re-fetched from the origin.
  if (url.origin !== self.location.origin) {
    if (request.method === 'GET' && IMAGE_HOSTS.includes(url.hostname)) {
      e.respondWith(
        caches.match(request).then(cached =>
          cached ||
          fetch(request).then(res => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(IMAGE_CACHE).then(c => c.put(request, clone).then(scheduleImageCachePrune));
            }
            return res;
          })
        )
      );
    }
    return;
  }

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
