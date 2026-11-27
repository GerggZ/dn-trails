// "Save for offline": stores everything one hike needs so it works on the
// trail without signal: its data, photos and the map tiles around it.
//
// Stores into the "downloads" caches (hb-dl-photos, hb-dl-tiles), which the
// service worker (public/sw.js) reads first and never trims. Files already in
// the browsing caches are moved over instead of downloaded again. Only shown in
// the built, installed-able site (the service worker isn't active in `npm run dev`).
// A phone that runs out of space: the download stops, what this run added is
// taken off again, an older copy of the hike stays as it was.
// Always saves the map marked offline: true in config.js (Park), whatever map is on screen.
//
// "Remove offline copy" takes it off again (src/lib/offline-store.js, also used
// by the "Downloaded" list in the profile menu).

import { asset } from '../lib/data.js';
import {
    LEVELS, PARALLEL, TILE_KB, CHANGE_EVENT, DATA, PHOTOS, TILES, DL_PHOTOS, DL_TILES,
    offlineAvailable, offlineLayer, tileUrls, runLimited, readSaved, writeSaved, removeOffline,
    moveToDownloads, keepStorage, isQuotaError,
} from '../lib/offline-store.js';

class OutOfSpace extends Error {}

// Map servers that answer "cors" requests (then the saved piece has a real, visible size).
// Learned while downloading: hostname -> true | false.
const corsHosts = new Map();

/** One map piece, straight from the network (cache: 'no-store' = past the service worker). */
async function fetchTile(url) {
    const host = new URL(url).hostname;
    if (corsHosts.get(host) !== false) {
        try {
            const response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
            corsHosts.set(host, true);
            return response;
        } catch { /* this server doesn't allow it (or no signal): the plain way */ }
    }
    const response = await fetch(url, { mode: 'no-cors', cache: 'no-store' });
    corsHosts.set(host, false);
    return response;
}

const fmtMB = (tiles) => {
    const mb = (tiles * (TILE_KB[offlineLayer().id] ?? 30)) / 1024;
    return mb < 1 ? '< 1 MB' : `≈ ${Math.round(mb)} MB`;
};

export function setupOfflineSave(hike, button, statusEl) {
    if (!offlineAvailable()) return;

    const say = (text) => { statusEl.textContent = text; };

    // "Save for offline" opens the two choices, each with its size
    const choices = document.createElement('span');
    choices.className = 'offline-choices';
    choices.hidden = true;
    button.after(choices);

    // "Remove" only while this hike is saved
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'pill';
    removeButton.textContent = 'Remove offline copy';
    removeButton.hidden = true;
    choices.after(removeButton);
    removeButton.addEventListener('click', remove);

    function showChoices() {
        const plans = Object.entries(LEVELS).map(([id, level]) => ({ id, level, ...tileUrls(hike.bbox, level, offlineLayer()) }));
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
        removeButton.hidden = true;
        choices.hidden = false;
        say('');
    }

    function showSaved(saved) {
        choices.hidden = true;
        button.hidden = false;
        button.disabled = false;
        removeButton.hidden = !saved;
        removeButton.disabled = false;
        button.textContent = saved ? 'Update offline copy' : 'Save for offline';
        if (saved) say(`Saved on this device${saved.level === 'max' ? ' (max detail)' : ''}.`);
    }

    navigator.serviceWorker.ready.then(() => showSaved(readSaved(hike.id)));
    // Removed from the profile menu's "Downloaded" list while this page is open
    window.addEventListener(CHANGE_EVENT, (e) => {
        if (e.detail.ids.includes(hike.id) && !readSaved(hike.id)) { showSaved(null); say(''); }
    });
    button.addEventListener('click', showChoices);

    async function save({ id, level, urls, maxZ }) {
        for (const b of choices.querySelectorAll('button')) b.disabled = true;
        const added = []; // [cache, url] stored by this run: taken off again if the phone is full
        const store = async (cache, url, response) => {
            try {
                await cache.put(url, response);
            } catch (err) {
                if (isQuotaError(err)) throw new OutOfSpace();
                throw err;
            }
            added.push([cache, url]);
        };
        try {
            // The page itself (the service worker keeps a copy of any page it serves)
            await fetch(asset('hike.html')).catch(() => {});

            // Hike data (small, same site)
            const data = await caches.open(DATA);
            await data.add(asset(`data/hikes/${encodeURIComponent(hike.id)}.json`)).catch((err) => {
                if (isQuotaError(err)) throw new OutOfSpace();
            });

            // Photos: moved from what you looked at, or downloaded
            const photoUrls = [
                ...hike.photos.flatMap((p) => [p.src, p.thumb]),
                ...(hike.cover_src ? [hike.cover_src] : []),
            ].filter(Boolean).map((path) => new URL(asset(path), location.href).href);
            const browsePhotos = await caches.open(PHOTOS);
            const photos = await caches.open(DL_PHOTOS);
            let done = 0;
            await runLimited(photoUrls, PARALLEL, async (url) => {
                if (!(await photos.match(url)) && !(await moveToDownloads(browsePhotos, photos, url))) {
                    let response = null;
                    try { response = await fetch(url, { cache: 'no-store' }); } catch { /* skip */ }
                    if (response?.ok) await store(photos, url, response); // skip missing files
                }
                say(`Saving photos… ${++done} / ${photoUrls.length}`);
            });

            // Map tiles around the trail (ones already saved, e.g. from "Standard", are skipped)
            const browseTiles = await caches.open(TILES);
            const tiles = await caches.open(DL_TILES);
            let fetched = 0;
            let failed = 0;
            await runLimited(urls, PARALLEL, async (url) => {
                if (!(await tiles.match(url)) && !(await moveToDownloads(browseTiles, tiles, url))) {
                    let response = null;
                    try { response = await fetchTile(url); } catch { /* counted below */ }
                    if (response && (response.ok || response.type === 'opaque')) await store(tiles, url, response);
                    else failed++;
                }
                fetched++;
                if (fetched % 10 === 0 || fetched === urls.length) say(`Saving map… ${fetched} / ${urls.length}`);
            });

            const saved = { level: id, maxZ, layer: offlineLayer().id, bbox: hike.bbox, title: hike.title, at: new Date().toISOString() };
            writeSaved(hike.id, saved);
            showSaved(saved);
            keepStorage(); // ask the browser not to wipe it when the phone runs low
            if (failed) say(`Saved, but ${failed} map pieces failed. Try again with a better connection.`);
            else say(`Saved on this device: photos and the ${offlineLayer().name} (${level.label.toLowerCase()}).`);
        } catch (err) {
            if (err instanceof OutOfSpace) {
                // Take this run's files off again; an older copy (moved or saved before) stays
                await Promise.all(added.map(([cache, url]) => cache.delete(url).catch(() => {})));
                showSaved(readSaved(hike.id));
                say('Not enough space on this device.');
                return;
            }
            showSaved(readSaved(hike.id));
            say(`Couldn't save: ${err.message}`);
        }
    }

    async function remove() {
        if (!confirm(`Remove the offline copy of "${hike.title}" from this device? Its photos and map won't work without internet until you save it again.`)) return;
        button.disabled = true;
        removeButton.disabled = true;
        say('Removing…');
        try {
            await removeOffline([hike.id], { [hike.id]: hike });

            showSaved(null);
            say('Removed from this device.');
        } catch (err) {
            showSaved(readSaved(hike.id));
            say(`Couldn't remove: ${err.message}`);
        }
    }
}
