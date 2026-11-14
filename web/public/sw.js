// Hiking Book service worker: makes the book work offline.
//
//   pages (index.html, hike.html)   network first, saved copy when offline
//   assets/ (JS, CSS, fonts)        saved on first use (file names change on every build)
//   data/ (hike JSON)               saved copy shown at once, refreshed in the background
//   photos/, backgrounds/           saved on first use
//   icons/                          saved copy shown at once, refreshed in the background
//   map tiles                       saved on first use, oldest dropped past MAX_TILES
//
// VERSION is replaced with the build's version stamp on every `npm run build`
// (see vite.config.js), so each deploy installs a fresh service worker:
// new pages, and the saved hike data refreshed. The value here is only used
// if sw.js is served without building.

const VERSION = 'v4';
const PAGES = `hb-pages-${VERSION}`;
const ASSETS = 'hb-assets';
const DATA = 'hb-data';
const PHOTOS = 'hb-photos';
const TILES = 'hb-tiles';
const MAX_TILES = 6000;

const SCOPE = self.registration.scope; // e.g. https://you.github.io/hiking-book/
const CORE = ['', 'index.html', 'hike.html', 'manifest.webmanifest', 'data/hikes.json', 'data/backgrounds.json']
    .map((p) => new URL(p, SCOPE).href);

// Map pictures for every map in config.js mapLayers (OpenTopoMap, OpenStreetMap, Esri)
const TILE_HOSTS = /(^|\.)tile\.opentopomap\.org$|(^|\.)tile\.openstreetmap\.org$|(^|\.)arcgisonline\.com$/;

/** Same tile from a.tile / b.tile / c.tile -> one cache entry. */
function tileKey(url) {
    return url.replace(/^https:\/\/[abc]\.tile\./, 'https://a.tile.');
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(PAGES);
        // One failing file shouldn't stop the install
        await Promise.all(CORE.map((url) => cache.add(url).catch(() => {})));
        await refreshData();
        await self.skipWaiting();
    })());
});

/** New version: fetch fresh copies of the saved hike data (hikes.json, each saved hike).
 *  Offline or a hike that no longer exists: the old copy stays. */
async function refreshData() {
    const cache = await caches.open(DATA);
    const urls = new Set((await cache.keys()).map((r) => r.url));
    for (const url of CORE) if (url.includes('/data/')) urls.add(url);
    await Promise.all([...urls].map(async (url) => {
        try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (response.ok) await cache.put(url, response);
        } catch { /* keep the saved copy */ }
    }));
}

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        for (const name of await caches.keys()) {
            if (name.startsWith('hb-pages-') && name !== PAGES) await caches.delete(name);
        }
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);

    if (TILE_HOSTS.test(url.hostname)) {
        event.respondWith(tile(request));
        return;
    }
    if (!request.url.startsWith(SCOPE)) return; // other sites: leave alone

    const path = request.url.slice(SCOPE.length).split('?')[0];
    if (request.mode === 'navigate' || path === '' || path.endsWith('.html')) {
        event.respondWith(page(request));
    } else if (path.startsWith('assets/')) {
        event.respondWith(cacheFirst(request, ASSETS));
    } else if (path.startsWith('data/')) {
        event.respondWith(staleWhileRevalidate(request, DATA, event));
    } else if (path.startsWith('icons/')) {
        // small, and may be recolored (tools/make_icons.py): saved copy at once, refreshed in the background
        event.respondWith(staleWhileRevalidate(request, PHOTOS, event));
    } else if (/^(photos|backgrounds)\//.test(path)) {
        event.respondWith(cacheFirst(request, PHOTOS));
    }
});

async function page(request) {
    const cache = await caches.open(PAGES);
    try {
        const response = await fetch(request);
        if (response.ok) cache.put(request.url.split('?')[0], response.clone());
        return response;
    } catch {
        // hike.html?id=x -> the saved hike.html (the id is read by the page itself)
        return (await cache.match(request, { ignoreSearch: true }))
            ?? (await cache.match(new URL('index.html', SCOPE).href))
            ?? Response.error();
    }
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
}

async function staleWhileRevalidate(request, cacheName, event) {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(request);
    const refresh = fetch(request)
        .then((response) => { if (response.ok) cache.put(request, response.clone()); return response; })
        .catch(() => null);
    if (hit) {
        event.waitUntil(refresh);
        return hit;
    }
    return (await refresh) ?? Response.error();
}

async function tile(request) {
    const cache = await caches.open(TILES);
    const key = tileKey(request.url);
    const hit = await cache.match(key);
    if (hit) return hit;
    try {
        const response = await fetch(request);
        if (response.ok || response.type === 'opaque') {
            await cache.put(key, response.clone());
            trimTiles(cache);
        }
        return response;
    } catch {
        return Response.error();
    }
}

let trimming = false;
async function trimTiles(cache) {
    if (trimming) return;
    trimming = true;
    try {
        const keys = await cache.keys();
        const extra = keys.length - MAX_TILES;
        for (let i = 0; i < extra; i++) await cache.delete(keys[i]); // oldest first
    } finally {
        trimming = false;
    }
}
