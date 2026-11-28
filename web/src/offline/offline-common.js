// What the service worker (src/sw.js) and the page's offline code
// (src/offline/offline-store.js, src/hike/offline.js) must agree on: cache names,
// which hosts are map servers, one address per map piece, and how a map piece
// is fetched. The build bundles this into sw.js too (vite.config.js), so keep
// it free of anything page-only (window, document, localStorage, config.js).

// ---------- caches ----------
export const DATA = 'hb-data';           // hike JSON, icons
export const PHOTOS = 'hb-photos';       // browsing: photos you looked at (trimmed)
export const TILES = 'hb-tiles';         // browsing: map you looked at (trimmed)
export const DL_PHOTOS = 'hb-dl-photos'; // downloads: "Save for offline" (never trimmed)
export const DL_TILES = 'hb-dl-tiles';   // downloads

/** Written into DL_TILES once downloads made before the two piles existed were moved there
 *  (offline-store.js). Until then the service worker trims nothing. Relative to the site. */
export const MOVED_MARK = '__hb-downloads-moved';

// ---------- map pieces ----------

/** Map servers of every map in config.js mapLayers. A new map's host goes here too. */
export const TILE_HOSTS = /(^|\.)tile\.opentopomap\.org$|(^|\.)tile\.openstreetmap\.org$|(^|\.)arcgisonline\.com$/;

/** Same piece from a.tile / b.tile / c.tile -> one address (one cache entry). */
export const tileKey = (url) => url.replace(/^https:\/\/[abc]\.tile\./, 'https://a.tile.');

// Map servers that answer "cors" requests: then the saved piece is a normal file the
// browser can measure. Others only give opaque answers (size hidden, and Chrome counts
// each one as ~7 MB against the storage limit). Learned per server: once one cors
// request worked it stays cors-friendly (a later failure only falls back for that piece);
// "no cors" only after the first few tries all failed while the plain way worked.
// (The service worker and each page learn this separately.)
const corsHosts = new Map(); // hostname -> true | number of failed cors tries
const NO_CORS_AFTER = 3;

/** Has this server refused cors often enough that it counts as "no cors"? */
export const refusesCors = (url) => corsHosts.get(new URL(url).hostname) === NO_CORS_AFTER;

/**
 * One map piece from the network: as a cors request where the server allows it,
 * otherwise the plain (opaque) way.
 * @param {string} url
 * @param {{ cache?: RequestCache, fallback?: Request }} [options]
 *   cache: e.g. 'no-store' to go past the service worker (downloads);
 *   fallback: the request to send the plain way (service worker: the page's own request).
 */
export async function fetchTile(url, { cache = 'default', fallback } = {}) {
    const host = new URL(url).hostname;
    const plain = () => (fallback ? fetch(fallback) : fetch(url, { mode: 'no-cors', cache }));
    const known = corsHosts.get(host);
    if (known !== true && (known ?? 0) >= NO_CORS_AFTER) return plain();
    try {
        const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache });
        corsHosts.set(host, true);
        return response;
    } catch { /* no cors on this server, a hiccup, or offline: try the plain way */ }
    const response = await plain();
    // Only counts when the plain way worked (offline, both fail: says nothing about cors)
    if (response.type === 'opaque' && corsHosts.get(host) !== true) corsHosts.set(host, (corsHosts.get(host) ?? 0) + 1);
    return response;
}
