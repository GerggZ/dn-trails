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
// the saved map pieces for the same spot at another zoom level:
//   - the 4 more detailed pieces one level down (zooming out), shrunk
//   - a less detailed piece up to MAX_UP levels up (zooming in), cropped and enlarged
//   - whatever more detailed pieces exist 1–2 levels down (only part of the spot)
// and draw those in its place. Online nothing changes (pieces load normally).

const MAX_UP = 4;
const SIZE = 256; // every map in config.js has 256 px pieces

const tileKey = (url) => url.replace(/^https:\/\/[abc]\.tile\./, 'https://a.tile.');

async function isSaved(url) {
    if (!('caches' in window)) return false;
    try { return !!(await caches.match(tileKey(url))); } catch { return false; }
}

/** The saved pieces to draw instead of piece z/x/y: [{ url, x, y, size }] in px inside the 256 px piece, or [] if none. */
async function findStandIns(layer, { x, y, z }) {
    const kids = async (d) => {
        const n = 2 ** d;
        const size = SIZE / n;
        const found = [];
        await Promise.all(Array.from({ length: n * n }, async (_, i) => {
            const dx = i % n;
            const dy = Math.floor(i / n);
            const url = tileUrl(layer, z + d, x * n + dx, y * n + dy);
            if (await isSaved(url)) found.push({ url, x: dx * size, y: dy * size, size });
        }));
        return found;
    };
    const canGoDown = (d) => z + d <= layer.maxZoom;

    const one = canGoDown(1) ? await kids(1) : [];
    if (one.length === 4) return one;
    for (let d = 1; d <= MAX_UP && z - d >= 0; d++) {
        const n = 2 ** d;
        const url = tileUrl(layer, z - d, Math.floor(x / n), Math.floor(y / n));
        if (await isSaved(url)) {
            const size = SIZE * n;
            return [{ url, x: -(x % n) * SIZE, y: -(y % n) * SIZE, size }];
        }
    }
    if (one.length) return one;
    return canGoDown(2) ? kids(2) : [];
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
