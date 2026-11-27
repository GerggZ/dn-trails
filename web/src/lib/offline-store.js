// What "Save for offline" put on this device, and taking it off again.
// Used by the hike page (src/hike/offline.js) and the profile menu's
// "Downloaded" list (src/lib/profile-menu.js).
//
// Each saved hike has a record in localStorage (hb-saved-<id>); its data,
// photos and map tiles live in the service worker's caches (public/sw.js).
// Tiles are one shared pile (neighbouring hikes overlap), so removing a hike
// keeps the tiles another saved hike still needs.

import { APP_CONFIG } from '../config.js';
import { asset } from './data.js';
import { tileUrl } from './map-layers.js';

// Two choices for how much map to save. If a hike is too big for the tile
// limit, the deepest zoom levels are left out until it fits.
export const LEVELS = {
    standard: { label: 'Standard', topZoom: 16, maxTiles: 900 },   // paths and junctions
    max: { label: 'Max detail', topZoom: 17, maxTiles: 3000 },     // the most the Park map has
};
export const PARALLEL = 4;
// Rough size of one map picture per layer (KB). The browser hides the real size of
// map pictures from other sites, so map sizes are always estimates.
export const TILE_KB = { park: 35, streets: 20, satellite: 30, topo: 22 };

/** The map "Save for offline" stores: the first layer marked offline: true in config.js (else the first one). */
export function offlineLayer() {
    return APP_CONFIG.mapLayers.find((layer) => layer.offline) ?? APP_CONFIG.mapLayers[0];
}

/** "≈ 45 MB" / "< 1 MB" / "≈ 1.2 GB" */
export function fmtSize(bytes) {
    const mb = bytes / 1024 / 1024;
    if (mb < 1) return '< 1 MB';
    if (mb >= 1000) return `≈ ${(mb / 1024).toFixed(1)} GB`;
    return `≈ ${Math.round(mb)} MB`;
}

/** Fired on window whenever a hike is saved or removed (detail: { ids }). */
export const CHANGE_EVENT = 'hb-offline-change';
export const announceChange = (ids) => window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { ids } }));

const PREFIX = 'hb-saved-';
export const savedKey = (id) => `${PREFIX}${id}`;

/** Offline saving only exists in the built site, with a service worker. */
export const offlineAvailable = () => import.meta.env.PROD && 'caches' in window && 'serviceWorker' in navigator;

/** Same normalisation as tileKey() in sw.js: a./b./c.tile -> a.tile */
export const tileKey = (url) => url.replace(/^https:\/\/[abc]\.tile\./, 'https://a.tile.');

function tileXY(lat, lon, z) {
    const n = 2 ** z;
    const x = Math.floor(((lon + 180) / 360) * n);
    const r = (lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    return [x, y];
}

/** Tile URLs of one map (default: the one the reader has selected), covering the hike (with a margin), from a wide view down to topZoom. */
export function tileUrls(bbox, { topZoom, maxTiles }, layer = offlineLayer()) {
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

/** Every tile a hike could have saved: all maps, down to "Max detail" (Standard is a part of that). */
function allTileUrls(bbox) {
    const urls = new Set();
    if (!bbox) return urls;
    for (const layer of APP_CONFIG.mapLayers) for (const url of tileUrls(bbox, LEVELS.max, layer).urls) urls.add(url);
    return urls;
}

export async function runLimited(items, limit, work) {
    let next = 0;
    const workers = Array.from({ length: limit }, async () => {
        while (next < items.length) await work(items[next++]);
    });
    await Promise.all(workers);
}

/** What was saved for a hike: { level, maxZ, layer, bbox, title, at } (older saves have less; the oldest only a date). */
export function readSaved(id) {
    try {
        const raw = localStorage.getItem(savedKey(id));
        if (raw == null) return null;
        try { return JSON.parse(raw); } catch { return { level: 'standard' }; }
    } catch {
        return null;
    }
}

export function writeSaved(id, record) {
    try { localStorage.setItem(savedKey(id), JSON.stringify(record)); } catch { /* ignore */ }
    announceChange([id]);
}

/** Ids of all hikes saved on this device. */
export function savedIds() {
    const ids = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith(PREFIX)) ids.push(key.slice(PREFIX.length));
        }
    } catch { /* storage blocked */ }
    return ids;
}

/** A saved hike's full data, from the offline copy (null if it isn't there). */
async function cachedHike(id) {
    try {
        const hit = await caches.match(asset(`data/hikes/${encodeURIComponent(id)}.json`));
        return hit ? await hit.json() : null;
    } catch {
        return null;
    }
}

/** Same-site files of a hike that "Save for offline" keeps: photos, thumbnails, cover. */
function photoUrls(hike) {
    if (!hike) return [];
    return [
        ...(hike.photos ?? []).flatMap((p) => [p.src, p.thumb]),
        ...(hike.cover_src ? [hike.cover_src] : []),
    ].filter(Boolean).map((path) => new URL(asset(path), location.href).href);
}

/** Size of a saved file (0 if it isn't saved). */
async function cachedBytes(cache, url) {
    const hit = await cache.match(url);
    if (!hit) return 0;
    const length = Number(hit.headers.get('content-length'));
    return length > 0 ? length : (await hit.blob()).size;
}

/**
 * The hikes saved on this device, by title, with how much space each takes:
 * { hikes: [{ id, title, level, bytes }], total }. A map piece two hikes share
 * counts for both hikes, but only once in the total.
 */
export async function downloadedHikes() {
    const ids = savedIds();
    const tiles = await caches.open('hb-tiles');
    const photos = await caches.open('hb-photos');
    const cachedTiles = new Set((await tiles.keys()).map((r) => r.url));
    const tileKB = new Map(); // tile url -> KB, for the total

    const hikes = await Promise.all(ids.map(async (id) => {
        const saved = readSaved(id) ?? {};
        const data = await cachedHike(id);
        const bbox = saved.bbox ?? data?.bbox;
        let bytes = 0;
        if (bbox) {
            for (const layer of APP_CONFIG.mapLayers) {
                const kb = TILE_KB[layer.id] ?? 30;
                for (const url of tileUrls(bbox, LEVELS.max, layer).urls) {
                    if (!cachedTiles.has(url)) continue;
                    bytes += kb * 1024;
                    tileKB.set(url, kb);
                }
            }
        }
        for (const url of photoUrls(data)) bytes += await cachedBytes(photos, url);
        return { id, title: saved.title ?? data?.title ?? id, level: saved.level ?? 'standard', bytes, data };
    }));

    let total = 0;
    for (const kb of tileKB.values()) total += kb * 1024;
    for (const h of hikes) for (const url of photoUrls(h.data)) total += await cachedBytes(photos, url);
    hikes.sort((a, b) => a.title.localeCompare(b.title));
    return { hikes: hikes.map(({ id, title, level, bytes }) => ({ id, title, level, bytes })), total };
}

/**
 * Take hikes off this device: their photos and map tiles (except tiles another
 * saved hike still needs). `known`: full hike data you already have, by id.
 * The small hike data itself stays, so the page still opens offline.
 */
export async function removeOffline(ids, known = {}) {
    const hikes = await Promise.all(ids.map(async (id) => known[id] ?? (await cachedHike(id))));
    const bboxes = ids.map((id, i) => readSaved(id)?.bbox ?? hikes[i]?.bbox);
    try { for (const id of ids) localStorage.removeItem(savedKey(id)); } catch { /* ignore */ }

    // Map tiles
    const mine = new Set(bboxes.flatMap((bbox) => [...allTileUrls(bbox)]));
    const others = await Promise.all(savedIds().map(async (id) => readSaved(id)?.bbox ?? (await cachedHike(id))?.bbox));
    const keep = new Set(others.flatMap((bbox) => [...allTileUrls(bbox)]));
    const tiles = await caches.open('hb-tiles');
    const drop = (await tiles.keys()).filter((r) => mine.has(r.url) && !keep.has(r.url));
    await runLimited(drop, PARALLEL, (r) => tiles.delete(r));

    // Photos (each hike has its own)
    const photos = await caches.open('hb-photos');
    await runLimited(hikes.flatMap(photoUrls), PARALLEL, (url) => photos.delete(url));

    announceChange(ids);
}
