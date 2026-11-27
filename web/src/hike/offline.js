// "Save for offline": stores everything one hike needs so it works on the
// trail without signal: its data, photos and the map tiles around it.
//
// Uses the same caches as the service worker (public/sw.js), so the saved
// copies are picked up automatically. Only shown in the built, installed-able
// site (the service worker isn't active in `npm run dev`).
// Always saves the map marked offline: true in config.js (Park), whatever map is on screen.
//
// "Remove offline copy" takes it off again (src/lib/offline-store.js, also used
// by the "Downloaded" list in the profile menu).

import { asset } from '../lib/data.js';
import {
    LEVELS, PARALLEL, TILE_KB, CHANGE_EVENT, offlineAvailable, offlineLayer, tileUrls, runLimited, readSaved, writeSaved, removeOffline,
} from '../lib/offline-store.js';

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

            const saved = { level: id, maxZ, layer: offlineLayer().id, bbox: hike.bbox, title: hike.title, at: new Date().toISOString() };
            writeSaved(hike.id, saved);
            showSaved(saved);
            if (failed) say(`Saved, but ${failed} map pieces failed. Try again with a better connection.`);
            else say(`Saved on this device: photos and the ${offlineLayer().name} (${level.label.toLowerCase()}).`);
        } catch (err) {
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
