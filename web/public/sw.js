// Hiking Book service worker: makes the book work offline.
//
//   pages (index.html, hike.html)   network first, saved copy when offline
//   assets/ (JS, CSS, fonts)        saved at install (file names change on every build)
//   data/ (hike JSON), icons/       saved copy shown at once, refreshed in the background
//   photos/, backgrounds/           saved on first use (browsing pile, see below)
//   map tiles                       saved on first use (browsing pile, see below)
//
// Two piles for photos and map tiles:
//   downloads (hb-dl-*)   what "Save for offline" stored. Kept until the reader removes it
//                         (src/lib/offline-store.js, src/hike/offline.js). Never trimmed here.
//   browsing (hb-photos, hb-tiles)  whatever the reader happened to look at. Rolling:
//                         past MAX_PHOTO_BYTES / MAX_TILES the least recently used goes first.
// Lookup: downloads -> browsing -> network.
//
// Requests made with cache: 'no-store' are left alone (straight to the network):
// the download code and version check use that to get fresh copies.
//
// VERSION is replaced with the build's version stamp on every `npm run build`
// (see vite.config.js), so each deploy installs a fresh service worker:
// new pages, and the saved hike data refreshed. The value here is only used
// if sw.js is served without building.

const VERSION = 'v5';
// This build's JS, CSS and fonts (assets/…), filled in on every `npm run build`
// (see vite.config.js). Saved at install, so the book opens offline even if a
// page was never opened online since the last update.
const BUILD_FILES = [];
const PAGES = `hb-pages-${VERSION}`;
const ASSETS = 'hb-assets';
const DATA = 'hb-data';
const PHOTOS = 'hb-photos';        // browsing
const TILES = 'hb-tiles';          // browsing
const DL_PHOTOS = 'hb-dl-photos';  // downloads
const DL_TILES = 'hb-dl-tiles';    // downloads
const MAX_TILES = 3000;                    // ≈ 75 MB of map you looked at
const MAX_PHOTO_BYTES = 100 * 1024 * 1024; // photos you looked at
const TRIM_EVERY = 25;                     // check the limits after this many new files

const SCOPE = self.registration.scope; // e.g. https://you.github.io/hiking-book/
const at = (p) => new URL(p, SCOPE).href;
// Written by the page (offline-store.js) once downloads made before the two piles
// existed were moved to hb-dl-*. Until then nothing is trimmed, so no download is lost.
const MOVED_MARK = at('__hb-downloads-moved');
// Must be saved at install (or the install fails and the previous version keeps working)
const PAGE_FILES = ['', 'index.html', 'hike.html'].map(at);
// Nice to have
const CORE = ['manifest.webmanifest', 'icons/dn-logo.svg', 'data/index.json', 'data/users.json', 'data/backgrounds.json', 'data/cover.json'].map(at);
// Online but no answer within this time (weak signal in the mountains): use the saved page
const PAGE_TIMEOUT_MS = 3000;
// Saved copies are looked up ignoring the server's Vary header: some hosts answer with
// "Vary: Origin", and a module script asks with an Origin header while the copy saved at
// install didn't, so the browser would think they differ and miss the saved copy offline.
const MATCH = { ignoreVary: true };

// Map pictures for every map in config.js mapLayers (OpenTopoMap, OpenStreetMap, Esri)
const TILE_HOSTS = /(^|\.)tile\.opentopomap\.org$|(^|\.)tile\.openstreetmap\.org$|(^|\.)arcgisonline\.com$/;

/** Same tile from a.tile / b.tile / c.tile -> one cache entry. */
function tileKey(url) {
    return url.replace(/^https:\/\/[abc]\.tile\./, 'https://a.tile.');
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(PAGES);
        // One failing extra file shouldn't stop the install
        await Promise.all(CORE.map((url) => cache.add(url).catch(() => {})));
        // The pages and the code they need must match: fetch the pages fresh (not from the
        // browser's HTTP cache, which may still hold the previous build's pages)
        await cache.addAll(PAGE_FILES.map((url) => new Request(url, { cache: 'reload' })));
        await (await caches.open(ASSETS)).addAll(BUILD_FILES.map(at));
        await refreshData();
        await self.skipWaiting();
    })());
});

/** New version: fetch fresh copies of the saved hike data (index.json, each saved hike).
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
        // Drop JS/CSS of older builds (not when sw.js runs unbuilt: the list is empty then)
        if (BUILD_FILES.length) {
            const keep = new Set(BUILD_FILES.map(at));
            const assets = await caches.open(ASSETS);
            for (const request of await assets.keys()) if (!keep.has(request.url)) await assets.delete(request);
        }
        // Icons used to live with the photos; they're in hb-data now
        const photos = await caches.open(PHOTOS);
        for (const request of await photos.keys()) if (request.url.startsWith(at('icons/'))) await photos.delete(request);
        await self.clients.claim();
        await trim();
    })());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || request.cache === 'no-store') return;
    const url = new URL(request.url);

    if (TILE_HOSTS.test(url.hostname)) {
        event.respondWith(tile(request, event));
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
        event.respondWith(staleWhileRevalidate(request, DATA, event));
    } else if (/^(photos|backgrounds)\//.test(path)) {
        event.respondWith(photo(request, event));
    }
});

async function page(request) {
    const cache = await caches.open(PAGES);
    const network = fetch(request).then((response) => {
        if (response.ok) cache.put(request.url.split('?')[0], response.clone());
        return response;
    });
    network.catch(() => {}); // a late failure after we already answered from the cache
    try {
        return await Promise.race([network, new Promise((_, reject) => setTimeout(reject, PAGE_TIMEOUT_MS))]);
    } catch {
        // Offline, or no answer in time. hike.html?id=x -> the saved hike.html (the page reads the id itself)
        const saved = (await cache.match(request, { ignoreSearch: true, ignoreVary: true }))
            ?? (await cache.match(at('index.html'), MATCH));
        return saved ?? network.catch(() => Response.error()); // nothing saved: keep waiting for the network
    }
}

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(request, MATCH);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
}

async function staleWhileRevalidate(request, cacheName, event) {
    const cache = await caches.open(cacheName);
    // (the site logo is also saved at install, with the pages)
    const hit = (await cache.match(request, MATCH)) ?? (await caches.match(request, MATCH));
    const refresh = fetch(request)
        .then((response) => { if (response.ok) cache.put(request, response.clone()); return response; })
        .catch(() => null);
    if (hit) {
        event.waitUntil(refresh);
        return hit;
    }
    return (await refresh) ?? Response.error();
}

// ---------- photos and map tiles: downloads -> browsing -> network ----------

// Using a browsing copy moves it to the back of the queue (re-saving it does that),
// once per service-worker run so a map full of pieces doesn't rewrite them all the time.
const touched = new Set();
function touch(cache, key, hit, event) {
    if (touched.has(key)) return;
    touched.add(key);
    event.waitUntil(cache.put(key, hit.clone()).catch(() => {}));
}

let newFiles = 0;
/** Keep a file in the browsing pile. A full phone: just don't keep it. */
function keep(cache, key, response, event) {
    event.waitUntil((async () => {
        try { await cache.put(key, response); } catch { return; }
        if (++newFiles % TRIM_EVERY === 0) await trim();
    })());
}

async function photo(request, event) {
    const key = request.url.split('?')[0];
    const dl = await (await caches.open(DL_PHOTOS)).match(key, MATCH);
    if (dl) return dl;
    const browse = await caches.open(PHOTOS);
    const hit = await browse.match(key, MATCH);
    if (hit) { touch(browse, key, hit, event); return hit; }
    const response = await fetch(request);
    if (response.ok) keep(browse, key, response.clone(), event);
    return response;
}

// Map servers that answer "cors" requests: then the saved piece is a normal file the
// browser can measure. Others only give opaque answers (size hidden, and Chrome counts
// each one as ~7 MB against the storage limit). Learned per server: once one cors
// request worked it stays cors-friendly (a later failure only falls back for that piece);
// "no cors" only after the first few tries all failed while the plain way worked.
const corsHosts = new Map(); // hostname -> true | number of failed cors tries
const NO_CORS_AFTER = 3;

/** A map piece from the network: as a cors request where the server allows it. */
async function fetchTile(request) {
    const host = new URL(request.url).hostname;
    const known = corsHosts.get(host);
    if (known === true || (known ?? 0) < NO_CORS_AFTER) {
        try {
            const response = await fetch(new Request(request.url, { mode: 'cors', credentials: 'omit' }));
            corsHosts.set(host, true);
            return response;
        } catch { /* no cors on this server, a hiccup, or offline: try the plain way */ }
        const response = await fetch(request);
        if (response.type === 'opaque' && corsHosts.get(host) !== true) corsHosts.set(host, (corsHosts.get(host) ?? 0) + 1);
        return response;
    }
    return fetch(request);
}

async function tile(request, event) {
    const key = tileKey(request.url);
    const dl = await (await caches.open(DL_TILES)).match(key, MATCH);
    if (dl) return dl;
    const browse = await caches.open(TILES);
    const hit = await browse.match(key, MATCH);
    if (hit) { touch(browse, key, hit, event); return hit; }
    try {
        const response = await fetchTile(request);
        if (response.ok || response.type === 'opaque') keep(browse, key, response.clone(), event);
        return response;
    } catch {
        return Response.error();
    }
}

/** Size of a saved file (the browser hides it for opaque map pieces: estimate). */
async function bytesOf(cache, request) {
    const hit = await cache.match(request, MATCH);
    if (!hit) return 0;
    const length = Number(hit.headers.get('content-length'));
    if (length > 0) return length;
    if (hit.type === 'opaque') return 30 * 1024;
    return (await hit.blob()).size;
}

let trimming = false;
/** Browsing piles over their limit: drop the least recently used (keys() lists oldest first). */
async function trim() {
    if (trimming) return;
    trimming = true;
    try {
        if (!(await (await caches.open(DL_TILES)).match(MOVED_MARK, MATCH))) return; // old downloads not moved yet
        const tiles = await caches.open(TILES);
        const tileKeys = await tiles.keys();
        for (let i = 0; i < tileKeys.length - MAX_TILES; i++) await tiles.delete(tileKeys[i]);

        const photos = await caches.open(PHOTOS);
        const photoKeys = await photos.keys();
        const sizes = [];
        let total = 0;
        for (const request of photoKeys) {
            const bytes = await bytesOf(photos, request);
            sizes.push(bytes);
            total += bytes;
        }
        for (let i = 0; i < photoKeys.length && total > MAX_PHOTO_BYTES; i++) {
            await photos.delete(photoKeys[i]);
            total -= sizes[i];
        }
    } finally {
        trimming = false;
    }
}
