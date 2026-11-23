// "Save for offline": stores everything one hike needs so it works on the
// trail without signal: its data, photos and the map tiles around it.
//
// Uses the same caches as the service worker (public/sw.js), so the saved
// copies are picked up automatically. Only shown in the built, installed-able
// site (the service worker isn't active in `npm run dev`).
//
// "Remove" takes a hike's photos and map tiles off the device again. Tiles are
// one shared pile (neighbouring hikes overlap), so tiles another saved hike
// still needs are kept.

import { APP_CONFIG } from '../config.js';
import { asset } from '../lib/data.js';
import { currentLayer, tileUrl } from '../lib/map-layers.js';

// Two choices for how much map to save. If a hike is too big for the tile
// limit, the deepest zoom levels are left out until it fits.
const LEVELS = {
    standard: { label: 'Standard', topZoom: 16, maxTiles: 900 },   // paths and junctions
    max: { label: 'Max detail', topZoom: 17, maxTiles: 3000 },     // the most the Park map has
};
// Rough size of one map picture per layer (KB), only for the size shown on the buttons
const TILE_KB = { park: 35, streets: 20, satellite: 30, topo: 22 };
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

/** Tile URLs of the map the reader has selected, covering the hike (with a margin), from a wide view down to topZoom. */
function tileUrls(bbox, { topZoom, maxTiles }) {
    const layer = currentLayer();
    const [[s, w], [n, e]] = bbox;
    const padLat = (n - s) * 0.25 + 0.005;
    const padLon = (e - w) * 0.25 + 0.005;
    const [S, W, N, E] = [s - padLat, w - padLon, n + padLat, e + padLon];
    const top = Math.min(topZoom, layer.maxZoom);

    for (let maxZ = top; maxZ >= 10; maxZ--) {
        const urls = [];
        for (let z = 9; z <= maxZ; z++) {
            const [x1, y1] = tileXY(N, W, z);
            const [x2, y2] = tileXY(S, E, z);
            for (let x = x1; x <= x2; x++) {
                for (let y = y1; y <= y2; y++) {
                    urls.push(tileKey(tileUrl(layer, z, x, y)));
                }
            }
        }
        if (urls.length <= maxTiles) return { urls, maxZ };
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

const fmtMB = (tiles) => {
    const mb = (tiles * (TILE_KB[currentLayer().id] ?? 30)) / 1024;
    return mb < 1 ? '< 1 MB' : `≈ ${Math.round(mb)} MB`;
};

/** What was saved for a hike: { level, maxZ } (older saves only stored a date). */
function readSaved(id) {
    try {
        const raw = localStorage.getItem(savedKey(id));
        if (raw == null) return null;
        try { return JSON.parse(raw); } catch { return { level: 'standard' }; }
    } catch {
        return null;
    }
}

export function setupOfflineSave(hike, button, statusEl) {
    if (!import.meta.env.PROD || !('caches' in window) || !('serviceWorker' in navigator)) return;

    const say = (text) => { statusEl.textContent = text; };

    // "Save for offline" opens the two choices, each with its size
    const choices = document.createElement('span');
    choices.className = 'offline-choices';
    choices.hidden = true;
    button.after(choices);

    function showChoices() {
        const plans = Object.entries(LEVELS).map(([id, level]) => ({ id, level, ...tileUrls(hike.bbox, level) }));
        // No point offering "Max detail" if it comes out the same (big hike, or a map that stops at 16)
        const distinct = plans.filter((p, i) => i === 0 || p.maxZ > plans[0].maxZ);
        choices.replaceChildren(...distinct.map((plan) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'pill';
            b.textContent = `${plan.level.label} · ${fmtMB(plan.urls.length)}`;
            b.addEventListener('click', () => save(plan));
            return b;
        }));
        button.hidden = true;
        choices.hidden = false;
        say('');
    }

    function showSaved(saved) {
        choices.hidden = true;
        button.hidden = false;
        button.textContent = saved ? 'Update offline copy' : 'Save for offline';
        if (saved) say(`Saved on this device${saved.level === 'max' ? ' (max detail)' : ''}.`);
    }

    navigator.serviceWorker.ready.then(() => showSaved(readSaved(hike.id)));
    button.addEventListener('click', showChoices);

    async function save({ id, level, urls, maxZ }) {
        for (const b of choices.querySelectorAll('button')) b.disabled = true;
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

            // Map tiles around the trail (ones already saved, e.g. from "Standard", are skipped)
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

            const saved = { level: id, maxZ, at: new Date().toISOString() };
            try { localStorage.setItem(savedKey(hike.id), JSON.stringify(saved)); } catch { /* ignore */ }
            showSaved(saved);
            if (failed) say(`Saved, but ${failed} map pieces failed. Try again with a better connection.`);
            else say(`Saved on this device: photos and the map (${level.label.toLowerCase()}).`);
        } catch (err) {
            showSaved(readSaved(hike.id));
            say(`Couldn't save: ${err.message}`);
        }
    }
}
