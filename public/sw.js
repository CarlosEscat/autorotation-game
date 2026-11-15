// Minimal offline support: cache the app shell on install, then serve same-origin GETs from the
// cache. Hashed bundles under assets/ never change, so they are fetched once; everything else is
// served cache-first and refreshed in the background.
const CACHE = 'autorotation-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const ASSET = /\/assets\/[^/]+$/;

/** Absolute URLs of the hashed files an index.html points at. */
const assetsOf = (html) => [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map((m) => new URL(m[1], self.registration.scope).href);

/**
 * Drops bundles of earlier builds once a newer index.html has replaced them. Those of the page
 * just served (`previous`) stay: it was answered from the cache and may not have loaded them yet.
 */
async function prune(cache, html, previous) {
  const keep = new Set([...assetsOf(html), ...assetsOf(previous)]);
  if (!keep.size) return;
  // Only scripts and stylesheets are pruned: fonts are not named in the HTML and rarely change.
  for (const req of await cache.keys()) {
    if (ASSET.test(new URL(req.url).pathname) && /\.(js|css)$/.test(req.url) && !keep.has(req.url)) await cache.delete(req);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      // Also precache the hashed bundles index.html points at, so the first visit works offline.
      const html = await (await cache.match('./index.html')).text();
      const assets = assetsOf(html);
      await cache.addAll(assets);
      // The stylesheet's fonts too: they are not named in the HTML.
      for (const url of assets.filter((u) => u.endsWith('.css'))) {
        const css = await (await cache.match(url)).text();
        const fonts = [...css.matchAll(/url\(([^)]+\.woff2)\)/g)].map((m) => new URL(m[1].replace(/["']/g, ''), url).href);
        await cache.addAll(fonts);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const navigate = req.mode === 'navigate';
      const cached = await cache.match(req, { ignoreSearch: navigate });
      // A hashed file's content never changes: no need to ask the network again.
      if (cached && ASSET.test(url.pathname)) return cached;
      const previous = navigate && cached ? await cached.clone().text() : '';
      const network = fetch(req)
        .then((res) => {
          if (!res.ok) return res;
          const copy = navigate ? res.clone() : null;
          const stored = cache.put(req, res.clone()).then(async () => copy && prune(cache, await copy.text(), previous));
          // Behind a cached answer nobody waits for this response, so the bookkeeping can finish first.
          return cached ? stored.then(() => res) : res;
        })
        .catch(() => cached || (navigate ? cache.match('./index.html') : undefined));
      // Keep the worker alive until the background refresh is stored.
      if (cached) event.waitUntil(network);
      return cached || network;
    }),
  );
});
