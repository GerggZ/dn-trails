// The softly blurred photo (or topo map) behind the page.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { APP_CONFIG } from '../config.js';
import { asset, el, loadBackgrounds } from './data.js';

function mount(child) {
    const layer = el('div', { className: 'backdrop', ariaHidden: 'true' }, child);
    layer.style.setProperty('--backdrop-blur', `${APP_CONFIG.backdropBlur ?? 3}px`);
    document.body.prepend(layer);
    return layer;
}

/** Recolor the page to match the background photo (CSS variables on <html>). */
function applyPalette(palette) {
    const root = document.documentElement;
    root.dataset.theme = APP_CONFIG.theme;
    root.style.setProperty('--glass-opacity', `${Math.round((APP_CONFIG.glassOpacity ?? 0.72) * 100)}%`);
    const colors = palette?.[APP_CONFIG.theme] ?? palette?.light ?? null;
    if (!colors) return;
    for (const [name, color] of Object.entries(colors)) root.style.setProperty(`--${name}`, color);
}

function photoBackdrop(src) {
    const img = el('img', { src: asset(src), alt: '' });
    const layer = mount(img);
    img.addEventListener('load', () => layer.classList.add('ready'));
}

function mapBackdrop(bbox) {
    const holder = el('div', { className: 'backdrop-map' });
    const layer = mount(holder);
    const tiles = APP_CONFIG.mapTiles;

    const map = L.map(holder, {
        zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
        doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, zoomSnap: 0.25,
    }).fitBounds(bbox, { padding: [40, 40] });
    map.setZoom(map.getZoom() - 0.75, { animate: false });

    L.tileLayer(tiles.url, { maxZoom: tiles.maxZoom }).addTo(map)
        .once('load', () => layer.classList.add('ready'));
    document.body.append(el('p', { className: 'backdrop-credit', textContent: `Background: ${tiles.attribution}` }));
}

/** Same hike -> same photo every time (simple string hash). */
export function pickFor(key, list) {
    if (!list.length) return null;
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return list[h % list.length];
}

/**
 * Shows the background and recolors the page to match it.
 * Returns the photo it used ({ src, palette }), or null.
 * @param item   a hike (or entry of the hike list) with id, cover_src, bbox; null on the index
 * @param prefer file name in backgrounds/ to use if present (the index page's choice)
 */
export async function renderBackdrop(item, prefer = '') {
    const mode = APP_CONFIG.backdrop;
    if (mode === 'none') { applyPalette(null); return null; }

    if (mode === 'map') {
        applyPalette(null);
        if (item?.bbox) mapBackdrop(item.bbox);
        return null;
    }
    if (mode === 'auto' && item?.cover_src) {
        applyPalette(item.palette);
        photoBackdrop(item.cover_src);
        return { src: item.cover_src, palette: item.palette };
    }

    const allowed = APP_CONFIG.backgroundChoices ?? [];
    const backgrounds = (await loadBackgrounds())
        .filter((b) => !allowed.length || allowed.includes(b.file) || b.file === prefer);
    if (!backgrounds.length) { applyPalette(null); return null; }
    const preferred = prefer ? backgrounds.find((b) => b.file === prefer) : null;
    const chosen = preferred || (item ? pickFor(item.id, backgrounds) : backgrounds[0]);
    applyPalette(chosen.palette);
    photoBackdrop(chosen.src);
    return chosen;
}
