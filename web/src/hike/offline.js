// "Save for offline": stores everything one hike needs so it works on the
// trail without signal: its data, photos and the map tiles around it.
//
// Uses the same caches as the service worker (public/sw.js), so the saved
// copies are picked up automatically. Only shown in the built, installed-able
// site (the service worker isn't active in `npm run dev`).

import { APP_CONFIG } from '../config.js';
import { asset } from '../lib/data.js';

const MAX_TILES = 900;        // per hike; plenty for a day hike up to zoom 16
const TOP_ZOOM = 16;
const PARALLEL = 4;

const savedKey = (id) => `hb-saved-${id}`;

/** Same normalisation as tileKey() in sw.js: a./b./c.tile -> a.tile */
const tileKey = (url) => url.replace(/^https:\/\/[abc]\.tile\./, 'https://a.tile.');

function tileXY(lat, lon, z) {
    const n = 2 ** z;
    const x = Math.floor(((lon + 180) / 360) * n);
    const r = (lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    return [x, y];
}

/** Tile URLs covering the hike (with a margin), from a wide view down to TOP_ZOOM. */
function tileUrls(bbox) {
    const [[s, w], [n, e]] = bbox;
    const padLat = (n - s) * 0.25 + 0.005;
    const padLon = (e - w) * 0.25 + 0.005;
    const [S, W, N, E] = [s - padLat, w - padLon, n + padLat, e + padLon];
    const top = Math.min(TOP_ZOOM, APP_CONFIG.mapTiles.maxZoom);

    for (let maxZ = top; maxZ >= 10; maxZ--) {
        const urls = [];
        for (let z = 9; z <= maxZ; z++) {
            const [x1, y1] = tileXY(N, W, z);
            const [x2, y2] = tileXY(S, E, z);
            for (let x = x1; x <= x2; x++) {
                for (let y = y1; y <= y2; y++) {
                    urls.push(tileKey(APP_CONFIG.mapTiles.url.replace('{s}', 'a').replace('{z}', z).replace('{x}', x).replace('{y}', y)));
                }
            }
        }
        if (urls.length <= MAX_TILES) return { urls, maxZ };
    }
    return { urls: [], maxZ: 0 };
}

async function runLimited(items, limit, work) {
    let next = 0;
    const workers = Array.from({ length: limit }, async () => {
        while (next < items.length) await work(items[next++]);
    });
    await Promise.all(workers);
}

export function setupOfflineSave(hike, button, statusEl) {
    if (!import.meta.env.PROD || !('caches' in window) || !('serviceWorker' in navigator)) return;

    const say = (text) => { statusEl.textContent = text; };

    navigator.serviceWorker.ready.then(() => {
        button.hidden = false;
        let saved = false;
        try { saved = localStorage.getItem(savedKey(hike.id)) != null; } catch { /* ignore */ }
        if (saved) {
            button.textContent = 'Update offline copy';
            say('Saved on this device.');
        }
    });

    button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            // The page itself (the service worker keeps a copy of any page it serves)
            await fetch(asset('hike.html')).catch(() => {});

            // Hike data and photos (small, same site)
            const data = await caches.open('hb-data');
            await data.add(asset(`data/hikes/${encodeURIComponent(hike.id)}.json`)).catch(() => {});
            const photoUrls = [
                ...hike.photos.flatMap((p) => [p.src, p.thumb]),
                ...(hike.cover_src ? [hike.cover_src] : []),
            ].map(asset);
            const photos = await caches.open('hb-photos');
            let done = 0;
            await runLimited(photoUrls, PARALLEL, async (url) => {
                await photos.add(url).catch(() => {}); // skip missing files
                say(`Saving photos… ${++done} / ${photoUrls.length}`);
            });

            // Map tiles around the trail
            const { urls, maxZ } = tileUrls(hike.bbox);
            const tiles = await caches.open('hb-tiles');
            let fetched = 0;
            let failed = 0;
            await runLimited(urls, PARALLEL, async (url) => {
                try {
                    if (!(await tiles.match(url))) {
                        const response = await fetch(url, { mode: 'no-cors' });
                        await tiles.put(url, response);
                    }
                } catch {
                    failed++;
                }
                fetched++;
                if (fetched % 10 === 0 || fetched === urls.length) say(`Saving map… ${fetched} / ${urls.length}`);
            });

            try { localStorage.setItem(savedKey(hike.id), new Date().toISOString()); } catch { /* ignore */ }
            button.textContent = 'Update offline copy';
            say(failed
                ? `Saved, but ${failed} map pieces failed. Try again with a better connection.`
                : `Saved on this device: photos and the map up to zoom level ${maxZ}.`);
        } catch (err) {
            say(`Couldn't save: ${err.message}`);
        } finally {
            button.disabled = false;
        }
    });
}
