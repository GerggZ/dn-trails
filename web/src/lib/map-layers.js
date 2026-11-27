// The maps a reader can choose from (config.js mapLayers) and the layer button
// on the hike map. The choice is remembered on the device. "Save for offline"
// always stores the map marked offline: true in config.js (see offline-store.js).

import L from 'leaflet';
// Leaflet's own CSS first, so our map styles below always come after it and win
// (in the build, CSS order follows the order files are first imported).
import 'leaflet/dist/leaflet.css';
import '../styles/map-styles.css';
import '../styles/map-controls.css';
import { APP_CONFIG } from '../config.js';

const LAYERS = APP_CONFIG.mapLayers;
const KEY = 'hb-map-layer';

export function currentLayer() {
    let id = null;
    try { id = localStorage.getItem(KEY); } catch { /* ignore */ }
    return LAYERS.find((layer) => layer.id === id) ?? LAYERS[0];
}

function rememberLayer(id) {
    try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
}

/** The address of one map tile, the way Leaflet would ask for it (first subdomain, no retina). */
export function tileUrl(layer, z, x, y) {
    return layer.url
        .replace('{s}', (layer.subdomains ?? 'abc')[0])
        .replace('{r}', '')
        .replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

// ---------- missing map pieces (offline): blurry instead of blank ----------
// Offline, a map piece that was never saved fails to load. Leaflet then drops
// the zoom level you were looking at, so the map goes blank. Instead we look in
// the saved map pieces for the same spot at another zoom level and draw those
// in its place:
//   - the 4 more detailed pieces one level down, shrunk (zooming out a little)
//   - a less detailed piece up to MAX_UP levels up, cropped and enlarged (zooming in)
//   - otherwise the saved pieces from the nearest more detailed level that has any,
//     however far down, shrunk. Zoomed far out you see the saved area as a small
//     patch with empty map around it, instead of nothing.
// Online nothing changes (pieces load normally).

const MAX_UP = 4;
const MAX_PARTS = 1024; // most small pieces drawn into one stand-in
const SIZE = 256; // every map in config.js has 256 px pieces

const tileKey = (url) => url.replace(/^https:\/\/[abc]\.tile\./, 'https://a.tile.');

/** Reads z/x/y back out of a saved piece's address, for one map. */
function urlPattern(layer) {
    const sample = tileKey(tileUrl(layer, '{z}', '{x}', '{y}'));
    const esc = sample.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${esc.replace('{z}', '(?<z>\\d+)')
        .replace('{x}', '(?<x>\\d+)').replace('{y}', '(?<y>\\d+)')}$`);
    return (url) => {
        const m = re.exec(url);
        return m ? { z: +m.groups.z, x: +m.groups.x, y: +m.groups.y } : null;
    };
}

// Which pieces are saved on this device (all caches), per map and zoom level:
// layer id -> z -> [{ x, y, url }]. Read once and refreshed every few seconds at most.
let savedIndex = null;
let savedAt = 0;
const INDEX_MAX_AGE = 5000;

async function loadSavedIndex() {
    if (savedIndex && Date.now() - savedAt < INDEX_MAX_AGE) return savedIndex;
    const index = new Map(LAYERS.map((layer) => [layer.id, new Map()]));
    if ('caches' in window) {
        const parsers = LAYERS.map((layer) => [layer.id, urlPattern(layer)]);
        try {
            for (const name of await caches.keys()) {
                if (!/^hb-(dl-)?tiles$/.test(name)) continue;
                for (const request of await (await caches.open(name)).keys()) {
                    for (const [id, parse] of parsers) {
                        const t = parse(request.url);
                        if (!t) continue;
                        const byZ = index.get(id);
                        if (!byZ.has(t.z)) byZ.set(t.z, []);
                        byZ.get(t.z).push({ x: t.x, y: t.y, url: request.url });
                        break;
                    }
                }
            }
        } catch { /* storage blocked: nothing saved */ }
    }
    savedIndex = index;
    savedAt = Date.now();
    return index;
}

/** The saved pieces to draw instead of piece z/x/y: [{ url, x, y, size }] in px inside the 256 px piece, or [] if none. */
async function findStandIns(layer, { x, y, z }) {
    const byZ = (await loadSavedIndex()).get(layer.id) ?? new Map();
    const has = (zz, xx, yy) => byZ.get(zz)?.find((t) => t.x === xx && t.y === yy);

    /** Saved pieces d levels down inside this spot. */
    const kids = (d) => {
        const n = 2 ** d;
        const size = SIZE / n;
        return (byZ.get(z + d) ?? [])
            .filter((t) => Math.floor(t.x / n) === x && Math.floor(t.y / n) === y)
            .map((t) => ({ url: t.url, x: (t.x - x * n) * size, y: (t.y - y * n) * size, size }));
    };

    const one = kids(1);
    if (one.length === 4) return one;
    for (let d = 1; d <= MAX_UP && z - d >= 0; d++) {
        const n = 2 ** d;
        const parent = has(z - d, Math.floor(x / n), Math.floor(y / n));
        if (parent) return [{ url: parent.url, x: -(x % n) * SIZE, y: -(y % n) * SIZE, size: SIZE * n }];
    }
    if (one.length) return one;
    // Further down: the nearest level that has anything here (pieces smaller than 1 px are skipped)
    for (let d = 2; z + d <= layer.maxZoom && SIZE / 2 ** d >= 1; d++) {
        const found = kids(d);
        if (found.length) return found.slice(0, MAX_PARTS);
    }
    return [];
}

/** A tile layer that, when a piece fails, shows saved pieces of other zoom levels in its place. */
const FallbackTileLayer = L.TileLayer.extend({
    createTile(coords, done) {
        const img = L.TileLayer.prototype.createTile.call(this, coords, () => {});
        const key = this._tileCoordsToKey(coords);
        const layer = this.options.hbLayer;
        img.onload = () => done(null, img);
        img.onerror = async (e) => {
            const standIns = layer ? await findStandIns(layer, coords) : [];
            const entry = this._tiles[key];
            if (!standIns.length || !entry || entry.el !== img) { done(e, img); return; }
            const box = document.createElement('div');
            box.style.cssText = img.style.cssText;
            box.className = `${img.className} leaflet-tile-fallback`;
            box.complete = true; // Leaflet drops "still loading" pieces when you zoom; this one is done
            for (const s of standIns) {
                const part = document.createElement('img');
                part.alt = '';
                part.src = s.url;
                part.style.cssText = `position:absolute;left:${s.x}px;top:${s.y}px;width:${s.size + 1}px;height:${s.size + 1}px;max-width:none`;
                box.append(part);
            }
            img.replaceWith(box);
            entry.el = box;
            done(null, box);
        };
        return img;
    },
});

/** Adds the selected map plus a layer button to switch; applies the map's tint (look). */
export function addMapLayers(map) {
    const container = map.getContainer();
    map.attributionControl?.setPrefix(false); // no "Leaflet" + flag in front of the map credits
    const tileLayers = new Map(LAYERS.map((layer) => [layer, new FallbackTileLayer(layer.url, {
        hbLayer: layer,
        maxZoom: layer.maxZoom,
        subdomains: layer.subdomains ?? 'abc',
        attribution: layer.attribution,
    })]));

    const applyLook = (layer) => {
        for (const other of LAYERS) if (other.look) container.classList.remove(`map-style-${other.look}`);
        if (layer.look) container.classList.add(`map-style-${layer.look}`);
    };

    const start = currentLayer();
    tileLayers.get(start).addTo(map);
    applyLook(start);

    if (LAYERS.length > 1) {
        const choices = Object.fromEntries(LAYERS.map((layer) => [layer.name, tileLayers.get(layer)]));
        L.control.layers(choices, null, { position: 'topright' }).addTo(map);
        map.on('baselayerchange', (event) => {
            const layer = LAYERS.find((l) => tileLayers.get(l) === event.layer);
            if (!layer) return;
            applyLook(layer);
            rememberLayer(layer.id);
        });
    }
}
