// The Leaflet map of a hike page: map layers, the trail, the stop symbols with
// their names, the dot that follows the finger, and the buttons (full screen,
// home). While the profile is zoomed in, the rest of the trail fades and the
// stretch shown on the profile stays solid (showStretch, called on every render).

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { APP_CONFIG } from '../../config.js';
import { addMapLayers } from '../../lib/map-layers.js';
import { stopSvg, stopSize } from './stops.js';

const C = APP_CONFIG.colors;

/**
 * @param {object} hike
 * @param {object} o
 * @param {object[]} o.data   the track points (trail-data.js)
 * @param {object[]} o.stops  stops.js stopsFor(): trailhead, end, peak, stops
 * @param {{ view: number[] }} o.state  the stretch shown on the profile
 * @param {d3.Bisector} o.bisect  finds a distance in `data`
 * @param {() => boolean} o.isZoomed
 * @param {() => void} o.onFullButton  the full-screen button (top right)
 * @param {() => void} o.onHome        the home button: back to the whole trail
 * @param {() => number[]} o.wholeTrailPadding  [x, y] px left around the whole trail when it's fitted
 * @returns {{ map: L.Map, fullControl: L.Control, mapHoverDot: L.CircleMarker, showStretch: () => void, updateNames: () => void }}
 */
export function createTrailMap(hike, { data, stops, state, bisect, isZoomed, onFullButton, onHome, wholeTrailPadding }) {
    const map = L.map('map-container', { scrollWheelZoom: false, wheelPxPerZoomLevel: 90, zoomSnap: 0.5 }).fitBounds(hike.bbox, { padding: [30, 30] });

    // Mouse wheel / trackpad: on the page it scrolls the page, also over the map, until
    // the reader clicks or drags the map; then it zooms the map until the pointer
    // leaves it. In full screen it always zooms (full-screen-map.js).
    map.getContainer().addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse') map.scrollWheelZoom.enable(); });
    map.getContainer().addEventListener('mouseleave', () => { if (!state.full) map.scrollWheelZoom.disable(); });

    // Full-screen button first, so it sits above the layer button (full-screen-map.js)
    const fullControl = new (L.Control.extend({
        options: { position: 'topright' },
        onAdd() {
            const bar = L.DomUtil.create('div', 'leaflet-bar full-control');
            const a = L.DomUtil.create('a', 'full-button', bar);
            a.href = '#';
            a.setAttribute('role', 'button');
            L.DomEvent.disableClickPropagation(bar);
            L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); onFullButton(); });
            this.button = a;
            return bar;
        },
    }))();
    map.addControl(fullControl);

    // Home: back to the whole trail (in full screen also the whole profile).
    // Sits under + / −, above the location button.
    map.addControl(new (L.Control.extend({
        options: { position: 'topleft' },
        onAdd() {
            const bar = L.DomUtil.create('div', 'leaflet-bar home-control');
            const a = L.DomUtil.create('a', 'home-button', bar);
            a.href = '#';
            a.title = 'Whole trail';
            a.setAttribute('role', 'button');
            a.setAttribute('aria-label', 'Show the whole trail');
            a.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.8V20h13V9.8"/><path d="M10 20v-5.5h4V20"/></svg>';
            L.DomEvent.disableClickPropagation(bar);
            L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); onHome(); });
            return bar;
        },
    }))());

    addMapLayers(map); // Default (park look) / Streets / Satellite / Topo, with a layer button (config.js mapLayers)

    // The trail: one solid line, like on a printed park map (optional light edge underneath)
    const latlngs = data.map((d) => [d.lat, d.lon]);
    const casingLine = C.trailCasing
        ? L.polyline(latlngs, { color: C.trailCasing, weight: 8, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map)
        : null;
    const trailLine = L.polyline(latlngs, { color: C.trail, weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);
    // The stretch shown on the zoomed-in profile, drawn over the faded rest of the trail (showStretch below)
    const stretchLine = L.polyline([], { color: C.trail, weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);

    // Trailhead, end, highest point and stops as map symbols (stops.js), with their names
    const namesAlways = APP_CONFIG.stopNames !== 'hover';
    for (const s of stops) {
        const size = stopSize(s.kind);
        const icon = L.divIcon({ className: 'stop-symbol', html: stopSvg(s.kind), iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
        L.marker(latlngs[s.index], { icon, keyboard: false, zIndexOffset: s.kind === 'stop' ? 0 : 100 })
            .bindTooltip(s.name, namesAlways
                ? { permanent: true, direction: 'right', offset: [5, 0], className: `map-label map-label-${s.kind}` }
                : { direction: 'top', offset: [0, -6] })
            .addTo(map);
    }
    // Zoomed out further than the whole trail (one zoom step or more), the names
    // would pile up on each other: hidden then (CSS .names-hidden in map-controls.css).
    // "The whole trail" uses the same padding as the camera (in full screen also the docked profile).
    function updateNames() {
        const [px, py] = wholeTrailPadding();
        const fit = map.getBoundsZoom(hike.bbox, false, L.point(px, py));
        map.getContainer().classList.toggle('names-hidden', map.getZoom() < fit - 0.75);
    }
    map.on('zoomend resize', updateNames);

    // The dot that follows your finger: a hollow ring in the trail color
    const mapHoverDot = L.circleMarker([0, 0], {
        radius: 7, color: C.trail, weight: 2.5, fillColor: C.markerLight, fillOpacity: 0.85,
        interactive: false,
    }).addTo(map);
    mapHoverDot.setStyle({ opacity: 0, fillOpacity: 0 });

    // On the map: zoomed in, the rest of the trail fades and the visible stretch
    // stays solid (cut exactly at the profile's edges). Not zoomed: one plain line.
    const DIM = APP_CONFIG.trailOutsideView ?? 0.3;
    let dimmed = false;
    const latLngAt = (d) => {
        const i = Math.min(Math.max(bisect.right(data, d), 1), data.length - 1);
        const a = data[i - 1], b = data[i];
        const f = b.distance > a.distance ? Math.min(Math.max((d - a.distance) / (b.distance - a.distance), 0), 1) : 0;
        return [a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f];
    };
    function showStretch() {
        const zoomed = isZoomed();
        if (zoomed !== dimmed) {
            dimmed = zoomed;
            fadeTrail(zoomed ? DIM : 1);
        }
        // Only redrawn when the visible stretch really changed
        const key = zoomed ? `${state.view[0]}|${state.view[1]}` : '';
        if (key === stretchKey) return;
        stretchKey = key;
        let pts = [];
        if (zoomed) {
            const i0 = bisect.right(data, state.view[0]);
            const i1 = bisect.left(data, state.view[1]);
            pts = [latLngAt(state.view[0]), ...latlngs.slice(i0, i1), latLngAt(state.view[1])];
        }
        if (!pts.length && fadeFrame != null) clearAfterFade = true; // un-dimming: keep the bold part until the fade is done
        else stretchLine.setLatLngs(pts);
    }
    // Dimming the rest of the trail: a short fade
    const FADE_MS = 220;
    let fadeFrame = null;
    let clearAfterFade = false;
    function setTrailOpacity(o) {
        trailLine.setStyle({ opacity: o });
        casingLine?.setStyle({ opacity: 0.9 * o });
    }
    function fadeTrail(to) {
        if (fadeFrame != null) cancelAnimationFrame(fadeFrame);
        fadeFrame = null;
        clearAfterFade = false; // (set again by showStretch when this fade un-dims)
        const from = trailLine.options.opacity;
        const t0 = performance.now();
        const step = (now) => {
            const t = Math.min(1, (now - t0) / FADE_MS);
            const e = t * t * (3 - 2 * t); // smoothstep
            setTrailOpacity(from + (to - from) * e);
            if (t < 1) { fadeFrame = requestAnimationFrame(step); return; }
            fadeFrame = null;
            if (clearAfterFade) { clearAfterFade = false; stretchLine.setLatLngs([]); }
        };
        fadeFrame = requestAnimationFrame(step);
    }
    let stretchKey = '';

    return { map, fullControl, mapHoverDot, showStretch, updateNames };
}
