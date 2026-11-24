// The map on the index page: every hike's own trail, drawn in the book's red at
// its real size (zoomed out, a trail is just a small red mark).
// Click a trail to pick it out: the other trails turn light red (like the rest of
// the trail when you zoom into a hike's elevation profile) and onSelect(id) lets the
// list dull the other hikes. Click it again, or an empty bit of map, to clear.
//
// Behaves like the map on a hike page: on phones the map on the page is a
// preview (the page scrolls over it) and a tap opens it full screen, with
// pinch-zoom and dragging. Every device gets a full-screen button and a home
// button (all hikes). Esc and the phone's back button close full screen.

import L from 'leaflet';
import { addMapLayers } from './map-layers.js';
import { APP_CONFIG } from '../config.js';

const C = APP_CONFIG.colors;

const ICON_OPEN = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ICON_HOME = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.8V20h13V9.8"/><path d="M10 20v-5.5h4V20"/></svg>';

/**
 * @param mapBox   element for the map (it is moved into a full-screen layer and back)
 * @param hikes    entries of index.json (id, title, line, bbox)
 * @param onSelect (id or null) => called when a trail is picked out / cleared
 * @param onView   ({ center: [lat, lon], inView: Set of ids } or null) => called after
 *                 the reader pans or zooms; null when every hike is in view again
 * @param options  fullscreen: false = the map already fills the screen (no preview,
 *                   no full-screen button); insets: () => ({ top, bottom, left, right })
 *                   px of the map that something covers (e.g. a sheet), kept clear when fitting
 */
export function overviewMap(mapBox, hikes, onSelect = () => {}, onView = () => {}, options = {}) {
    const { fullscreen = true, insets = () => ({}) } = options;
    const compact = window.matchMedia('(hover: none) and (pointer: coarse)');
    let full = false;
    const peek = () => fullscreen && compact.matches && !full;

    // fitBounds padding that keeps clear of whatever covers the map
    const pad = (base) => {
        const i = insets();
        return { paddingTopLeft: [base + (i.left ?? 0), base + (i.top ?? 0)], paddingBottomRight: [base + (i.right ?? 0), base + (i.bottom ?? 0)] };
    };

    const map = L.map(mapBox, { scrollWheelZoom: true, wheelPxPerZoomLevel: 90, zoomSnap: 0.5, worldCopyJump: true });

    // Full-screen button first, so it sits above the layer button (like the hike map)
    const fullControl = fullscreen && new (L.Control.extend({
        options: { position: 'topright' },
        onAdd() {
            const bar = L.DomUtil.create('div', 'leaflet-bar full-control');
            const a = L.DomUtil.create('a', 'full-button', bar);
            a.href = '#';
            a.setAttribute('role', 'button');
            L.DomEvent.disableClickPropagation(bar);
            L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); toggleFull(); });
            this.button = a;
            return bar;
        },
    }))();
    if (fullControl) map.addControl(fullControl);

    map.addControl(new (L.Control.extend({
        options: { position: 'topleft' },
        onAdd() {
            const bar = L.DomUtil.create('div', 'leaflet-bar home-control');
            const a = L.DomUtil.create('a', 'home-button', bar);
            a.href = '#';
            a.title = 'All hikes';
            a.setAttribute('role', 'button');
            a.setAttribute('aria-label', 'Show all hikes');
            a.innerHTML = ICON_HOME;
            L.DomEvent.disableClickPropagation(bar);
            L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); showAll(); });
            return bar;
        },
    }))());

    addMapLayers(map);

    // --- the hikes ---
    const trails = new Map();
    const all = L.latLngBounds([]);
    for (const h of hikes) {
        const pts = h.line?.length ? h.line : [h.bbox[0], [h.bbox[0][0], h.bbox[1][1]], h.bbox[1], [h.bbox[1][0], h.bbox[0][1]], h.bbox[0]];
        const bounds = L.latLngBounds(pts);

        const line = L.polyline(pts, { color: C.trail, weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round' })
            .on('click', (e) => {
                if (peek()) return; // phones: the tap opens the full-screen map first
                L.DomEvent.stopPropagation(e); // not a click on the empty map
                select(selected === h.id ? null : h.id);
            })
            .bindTooltip(h.title, { sticky: true, className: 'overview-tip' });

        line.addTo(map);
        trails.set(h.id, { line, bounds });
        all.extend(bounds);
    }

    let nearYou = null;   // hikes you're at (location button)
    let selected = null;  // hike picked out by clicking its trail
    // Hovered = thicker; not near you (while you're near some hike) = light red
    function styleTrail(t) {
        t.line.setStyle({ weight: t.lit ? 7 : t.faded ? 3 : 4, opacity: t.faded && !t.lit ? 0.35 : 1 });
    }

    // A picked-out hike wins over "you're near"; with neither, every trail is normal
    function applyFocus() {
        const focus = selected ? new Set([selected]) : nearYou;
        for (const [id, t] of trails) {
            t.faded = focus ? !focus.has(id) : false;
            styleTrail(t);
            if (focus?.has(id)) t.line.bringToFront();
        }
    }
    function select(id) {
        if (id === selected) return;
        selected = id;
        applyFocus();
        onSelect(id);
    }
    map.on('click', () => { if (!peek()) select(null); });

    function showAll() {
        map.fitBounds(all, { ...pad(40), maxZoom: 12 });
        onView(null);
    }
    showAll();

    // The map's box can get its real size only after this runs (styles still
    // loading, a sheet sizing itself). Keep Leaflet in step, and until the reader
    // or a search/location moves the map, keep showing all hikes.
    let autoFit = true;
    const stopAutoFit = () => { autoFit = false; };
    new ResizeObserver(() => {
        map.invalidateSize({ animate: false });
        if (autoFit) map.fitBounds(all, { ...pad(40), maxZoom: 12, animate: false });
    }).observe(mapBox);

    // --- tell the list what's on screen, but only after the reader moved the map
    // (not when a search or the location button moves it) ---
    let touching = false;     // a finger / mouse button / wheel on the map just now
    let userMove = false;     // the current move was started by the reader
    let quiet = null;
    const touched = () => {
        stopAutoFit();
        touching = true;
        clearTimeout(quiet);
        quiet = setTimeout(() => { touching = false; }, 700);
    };
    for (const type of ['pointerdown', 'wheel', 'touchstart']) mapBox.addEventListener(type, touched, { passive: true });
    mapBox.addEventListener('pointerup', touched, { passive: true }); // keep it on for the glide after a drag
    map.on('movestart zoomstart', () => { if (touching) userMove = true; });
    map.on('moveend', () => {
        if (!userMove) return;
        userMove = false;
        const view = map.getBounds();
        const inView = new Set([...trails].filter(([, t]) => view.intersects(t.bounds)).map(([id]) => id));
        if (inView.size === trails.size && view.contains(all)) { onView(null); return; }
        const c = map.getCenter();
        onView({ center: [c.lat, c.lng], inView });
    });

    // --- full screen (same idea as the hike map; see src/hike/map-elevation.js section 6) ---
    let toggleFull = () => {}; // set up below when this map has a full-screen mode
    if (fullscreen) setupFullScreen();
    function setupFullScreen() {
        const home = mapBox.parentNode;
        const marker = document.createComment('overview-map');
        const overlay = document.createElement('div');
        overlay.className = 'map-full';
        overlay.hidden = true;
        document.body.append(overlay); // outside .sheet: its backdrop-filter breaks position: fixed

        function setInteractive(on) {
            for (const h of ['dragging', 'touchZoom', 'doubleClickZoom', 'scrollWheelZoom', 'boxZoom', 'keyboard']) {
                if (map[h]) map[h][on ? 'enable' : 'disable']();
            }
        }
        function refresh() {
            const btn = fullControl.button;
            btn.innerHTML = full ? ICON_CLOSE : ICON_OPEN;
            btn.title = full ? 'Close map' : 'Full-screen map';
            btn.setAttribute('aria-label', btn.title);
            mapBox.classList.toggle('map-peek', peek());
            if (!full) setInteractive(!compact.matches);
        }
        function relayout() {
            const center = map.getCenter(), zoom = map.getZoom();
            map.invalidateSize();
            map.setView(center, zoom, { animate: false });
        }
        function openFull() {
            if (full) return;
            full = true;
            home.insertBefore(marker, mapBox);
            overlay.append(mapBox);
            overlay.hidden = false;
            document.documentElement.classList.add('map-open');
            setInteractive(true);
            refresh();
            history.pushState({ hbMap: true }, ''); // so the back button closes the map
            relayout();
            fullControl.button.focus({ preventScroll: true });
        }
        function closeFull(fromBackButton = false) {
            if (!full) return;
            full = false;
            marker.replaceWith(mapBox);
            overlay.hidden = true;
            document.documentElement.classList.remove('map-open');
            refresh();
            relayout();
            if (!fromBackButton && history.state?.hbMap) history.back();
        }
        toggleFull = () => { if (full) closeFull(); else openFull(); };

        if (history.state?.hbMap) history.replaceState(null, ''); // page reloaded while the map was open
        window.addEventListener('popstate', () => closeFull(true));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFull(); });
        mapBox.addEventListener('click', (e) => {
            if (peek() && !e.target.closest('.leaflet-control')) openFull();
        });
        compact.addEventListener('change', refresh);
        refresh();
    }

    // --- searched place ---
    let placeMarker = null;
    function clearPlace() {
        placeMarker?.remove();
        placeMarker = null;
    }

    return {
        map,
        showAll,
        clearPlace,

        /** Pick out a hike (or null to clear), as if its trail was clicked. */
        select(id) { select(id); },

        /** Move the map only if this hike isn't on screen (e.g. swiped to on the cards). */
        keepInView(id) {
            const t = trails.get(id);
            if (!t || map.getBounds().contains(t.bounds)) return;
            stopAutoFit();
            const view = L.latLngBounds(t.bounds);
            // keep the previously shown area too when it's close, so the hop isn't jarring
            map.flyToBounds(view, { ...pad(40), maxZoom: Math.max(map.getZoom(), 9), duration: 0.6 });
        },

        /** Bring a hike into view (keeps clear of the insets). */
        showHike(id) {
            stopAutoFit();
            const t = trails.get(id);
            if (t) map.flyToBounds(t.bounds, { ...pad(40), maxZoom: 14, duration: 0.6 });
        },

        /** A row in the list is hovered: make its trail stand out. */
        highlight(id, on) {
            const t = trails.get(id);
            if (!t) return;
            t.lit = on;
            styleTrail(t);
            if (on) t.line.bringToFront();
        },

        /** You're near these hikes: they stay bright red, the others turn light red. null = all normal. */
        focusHikes(ids) {
            nearYou = ids?.length ? new Set(ids) : null;
            applyFocus();
        },

        /** Show these hikes (and a point, e.g. you) on the map. */
        fitTo(ids, point) {
            stopAutoFit();
            const view = L.latLngBounds(point ? [point] : []);
            for (const id of ids) view.extend(trails.get(id).bounds);
            map.flyToBounds(view, { ...pad(40), maxZoom: 15, duration: 0.8 });
        },

        /** Mark the searched place and show it together with the closest hike. */
        showPlace(place, nearest) {
            stopAutoFit();
            clearPlace();
            placeMarker = L.marker([place.lat, place.lon], {
                icon: L.divIcon({
                    className: 'overview-place',
                    html: '<svg width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" style="fill:var(--paper);stroke:var(--ink);stroke-width:2"/><circle cx="9" cy="9" r="2.5" style="fill:var(--ink)"/></svg>',
                    iconSize: [18, 18], iconAnchor: [9, 9],
                }),
                keyboard: false,
                interactive: false,
            }).addTo(map);
            placeMarker.bindTooltip(place.name, { permanent: true, direction: 'top', offset: [0, -10], className: 'overview-tip place-tip' });

            const view = L.latLngBounds([[place.lat, place.lon]]);
            const t = nearest && trails.get(nearest.id);
            if (t) view.extend(t.bounds);
            // extra room at the top for the name
            const p = pad(50);
            p.paddingTopLeft[1] += 20;
            map.flyToBounds(view, { ...p, maxZoom: 12, duration: 0.8 });
        },
    };
}
