// The maps a reader can choose from (config.js mapLayers) and the layer button
// on the hike map. The choice is remembered on the device; "Save for offline"
// stores the map that is selected.

import L from 'leaflet';
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

/** Adds the selected map plus a layer button to switch; applies the map's tint (look). */
export function addMapLayers(map) {
    const container = map.getContainer();
    const tileLayers = new Map(LAYERS.map((layer) => [layer, L.tileLayer(layer.url, {
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
