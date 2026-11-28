// The map full screen, like Komoot: on phones the map on the page is a still
// preview ("peek"), and tapping it (or the profile) opens the map full screen
// with the elevation profile docked underneath; × or the phone's back button
// closes it. Elsewhere the button top right does the same.
// The map and profile are moved into an overlay on <body>: inside the frosted
// sheet (backdrop-filter) position: fixed wouldn't cover the screen.
// The docked profile has a grab handle to make it taller (remembered).

import { APP_CONFIG } from '../../config.js';
import { el } from '../../lib/data.js';

const EXTRA_KEY = 'hb-profile-extra';
const ICON_OPEN = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ICON_RESET = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg><span>Whole hike</span>';

/**
 * @param {object} o
 * @param {object} o.hike
 * @param {L.Map} o.map
 * @param {{ full: boolean, dockExtra: number }} o.state  shared with the profile: written here
 * @param {{ button: HTMLElement }} o.fullControl  the map's full-screen button (top right)
 * @param {HTMLElement} o.container  the elevation profile
 * @param {HTMLElement} o.progress   the bar under the profile
 * @param {MediaQueryList} o.compact phone (no hover, coarse pointer)
 * @param {() => boolean} o.peek     is the map on the page only a preview?
 * @param {{ follow: Function, fitOpts: Function }} o.camera  map-camera.js
 * @param {() => void} o.redrawProfile  draw the profile again (new size)
 * @param {() => void} o.clearHover     take the finger / mouse readout away
 * @param {() => void} o.onReset        "Whole hike" button
 * @param {() => void} o.onClose        just before the map goes back into the page
 * @returns {{ open: () => void, close: () => void, toggle: () => void, dockCover: () => number }}
 */
export function setupFullScreenMap({ hike, map, state, fullControl, container, progress, compact, peek, camera, redrawProfile, clearHover, onReset, onClose }) {
    // On phones the map on the page is a still picture: the page scrolls past it,
    // and tapping it (or the profile) opens the map full screen with the
    // elevation profile docked underneath. × or the phone's back button closes it.
    // Elsewhere the button top right does the same.
    // The map and profile are moved into an overlay on <body>: inside the
    // frosted sheet (backdrop-filter) position: fixed wouldn't cover the screen.
    const mapBox = map.getContainer();
    const terrainBox = document.querySelector('.terrain');
    const statusEl = document.getElementById('you-status');
    const overlay = el('div', { className: 'map-full', hidden: true });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Map of ${hike.title}`);
    const dock = el('div', { className: 'map-full-profile' });
    const resetButton = el('button', { className: 'profile-reset', type: 'button', title: 'Show the whole hike' });
    resetButton.innerHTML = ICON_RESET;
    resetButton.hidden = true; // shown once the profile is zoomed in
    resetButton.addEventListener('click', onReset);
    dock.append(resetButton);
    overlay.append(dock);

    // In full screen the profile floats over the bottom of the map: px of the map it hides
    const dockCover = () => (state.full ? Math.max(0, overlay.clientHeight - dock.offsetTop) : 0);

    // Grab handle on top of the docked profile: drag up to make it taller, down
    // to shrink it again (never smaller than the starting size). Remembered.
    try { state.dockExtra = Math.max(0, Number(localStorage.getItem(EXTRA_KEY)) || 0); } catch { /* no storage */ }
    const handle = el('div', { className: 'dock-handle' });
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'horizontal');
    handle.setAttribute('aria-label', 'Drag to resize the elevation profile');
    dock.prepend(handle);
    const maxExtra = () => Math.max(0, Math.round(window.innerHeight * 0.6) - 180);
    let resize = null; // { y, extra } where the drag started
    let resizeFrame = null;
    const applyExtra = () => {
        resizeFrame = null;
        redrawProfile();
        updateCover();
    };
    handle.addEventListener('pointerdown', (event) => {
        resize = { y: event.clientY, extra: state.dockExtra };
        handle.setPointerCapture(event.pointerId);
        handle.classList.add('dragging');
        event.preventDefault();
    });
    handle.addEventListener('pointermove', (event) => {
        if (!resize) return;
        const next = Math.min(Math.max(resize.extra - (event.clientY - resize.y), 0), maxExtra());
        if (next === state.dockExtra) return;
        state.dockExtra = next;
        if (resizeFrame == null) resizeFrame = requestAnimationFrame(applyExtra);
    });
    const endResize = () => {
        if (!resize) return;
        resize = null;
        handle.classList.remove('dragging');
        try { localStorage.setItem(EXTRA_KEY, String(Math.round(state.dockExtra))); } catch { /* no storage */ }
        camera.follow(true);
    };
    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);
    document.body.append(overlay);


    function setInteractive(on) {
        for (const h of ['dragging', 'touchZoom', 'doubleClickZoom', 'boxZoom', 'keyboard']) {
            if (map[h]) map[h][on ? 'enable' : 'disable']();
        }
        // The wheel only zooms by itself in full screen; on the page after a click (trail-map.js)
        map.scrollWheelZoom[on && state.full ? 'enable' : 'disable']();
    }
    function refresh() {
        const btn = fullControl.button;
        btn.innerHTML = state.full ? ICON_CLOSE : ICON_OPEN;
        btn.title = state.full ? 'Close map' : 'Full-screen map';
        btn.setAttribute('aria-label', btn.title);
        const wasPeek = mapBox.classList.contains('map-peek');
        mapBox.classList.toggle('map-peek', peek());
        if (!state.full) setInteractive(!compact.matches);
        // The phone preview is shorter: re-fit when it changes size outside open/close
        if (!state.full && wasPeek !== peek()) { map.invalidateSize(); map.fitBounds(hike.bbox, camera.fitOpts()); }
    }
    function relayout() {
        clearHover();
        map.invalidateSize();
        redrawProfile();
        updateCover();
        map.fitBounds(hike.bbox, camera.fitOpts());
    }
    // Map credit line (bottom right) sits just above the floating profile
    function updateCover() {
        overlay.style.setProperty('--dock-cover', `${dockCover()}px`);
    }

    // Phones: the full-screen map also hides the phone's own status and navigation
    // bars where the browser allows it (Android), if config.js display.mapHidesBars. iPhones have no such API; there
    // the map runs behind the clock and the home bar instead (viewport-fit=cover
    // + black-translucent status bar in hike.html).
    let screenFull = false; // we put the page into browser full screen
    function enterScreenFull() {
        const root = document.documentElement;
        if (!APP_CONFIG.display.mapHidesBars) return;
        if (!compact.matches || !root.requestFullscreen || document.fullscreenElement) return;
        root.requestFullscreen({ navigationUI: 'hide' })
            .then(() => { screenFull = true; })
            .catch(() => { /* not allowed here: keep the bars */ });
    }
    function exitScreenFull() {
        if (!screenFull) return;
        screenFull = false;
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    }
    document.addEventListener('fullscreenchange', () => {
        if (document.fullscreenElement) {
            if (state.full) { map.invalidateSize(); updateCover(); }
            return;
        }
        // Left full screen by the phone's back gesture (no popstate then): that
        // closes the map too, whether the map or the page asked for full screen
        if (screenFull || state.full) { screenFull = false; closeFull(); }
    });

    function openFull() {
        if (state.full) return;
        state.full = true;
        enterScreenFull(); // first, while the tap still counts as a user gesture
        state.dockExtra = Math.min(state.dockExtra, maxExtra());
        overlay.prepend(mapBox);
        dock.append(container, progress);
        overlay.hidden = false;
        document.documentElement.classList.add('map-open');
        setInteractive(true);
        refresh();
        history.pushState({ hbMap: true }, ''); // so the back button closes the map
        relayout();
        fullControl.button.focus({ preventScroll: true });
    }
    function closeFull(fromBackButton = false) {
        if (!state.full) return;
        state.full = false;
        exitScreenFull();
        onClose(); // the page always shows the whole hike
        terrainBox.insertBefore(mapBox, statusEl);
        statusEl.after(container, progress);
        overlay.hidden = true;
        document.documentElement.classList.remove('map-open');
        refresh();
        relayout();
        if (!fromBackButton && history.state?.hbMap) history.back();
    }
    function toggleFull() { if (state.full) closeFull(); else openFull(); }

    if (history.state?.hbMap) history.replaceState(null, ''); // page reloaded while the map was open
    window.addEventListener('popstate', () => closeFull(true));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFull(); });
    // A DOM listener, so a tap on a stop symbol or name opens it too
    mapBox.addEventListener('click', (e) => {
        if (peek() && !e.target.closest('.leaflet-control')) openFull();
    });
    compact.addEventListener('change', refresh);
    refresh();

    return { open: openFull, close: closeFull, toggle: toggleFull, dockCover };
}
