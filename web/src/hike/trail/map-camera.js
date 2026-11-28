// The map in full screen follows the stretch shown on the zoomed elevation
// profile, like a calm camera (map-elevation.js tells it when the stretch moves).
// Also keeps map tiles loading while the map glides.

import L from 'leaflet';

/**
 * @param {L.Map} map
 * @param {object} o
 * @param {[[number, number], [number, number]]} o.bbox   the whole hike
 * @param {() => boolean} o.isFull        is the map open in full screen?
 * @param {() => boolean} o.isZoomed      is the profile zoomed in?
 * @param {() => {lat: number, lon: number}[]} o.visiblePoints  the track points shown on the profile
 * @param {() => number} o.dockCover      px of the map's bottom hidden by the docked profile
 */
export function createMapCamera(map, { bbox, isFull, isZoomed, visiblePoints, dockCover }) {
    // The map shows the part of the trail that's visible on the profile, like a calm camera:
    //  - lazy: it stays still while the stretch fits; when the stretch nears the edge
    //    it moves just as far as needed, and zooms out only if it doesn't fit any more
    //  - glide: every move eases into place (GLIDE_SPEED of the remaining way per 1/60 s
    //    for sliding, ZOOM_GLIDE_SPEED for zooming; the same on 60 and 120 Hz screens),
    //    with in-between zoom levels meanwhile
    //  - when the gesture ends the glide simply carries on to the final place: one
    //    movement, no separate flight (it stays put if the stretch already fits well)
    const FIT_PAD = 40;
    const GLIDE_SPEED = 0.09; // sliding: share of the remaining way per 1/60 s (lower = slower)
    const ZOOM_GLIDE_SPEED = 0.07; // zooming in / out: the same, on its own (lower = slower)
    const LAZY_REFIT = 0.35; // at the end, refit only if the stretch fills less than this share of the map
    const SNAP = map.options.zoomSnap;
    let cam = null; // where the glide is heading: { center, zoom }
    let glideFrame = null;
    let lastGlideT = 0;
    let settling = false; // the gesture is over and the glide is carrying the map to its final place

    // Moving the map frame by frame. map.setView without animation throws all
    // tiles away whenever the zoom changes (a blank flash, then everything loads
    // again). Leaflet's own flyTo avoids that by moving with the internal
    // _moveStart / _move / _moveEnd, which keep the old tiles (scaled) until the
    // new ones are in. We do the same. (Internal API: Leaflet 1.9.)
    let camMoving = false;
    function moveCam(center, zoom) {
        if (!camMoving) {
            map._stop();
            map._moveStart(true, false);
            camMoving = true;
        }
        // `pinch` makes the map announce every step as a zoom, also when only the
        // centre moves, so markers and tiles are repositioned each frame (not just at the end)
        map._move(center, zoom, { pinch: true });
        // The trail lines live in an SVG drawn for the old view; draw them again for
        // this one, otherwise they lag behind and the highlighted stretch drifts off
        map.eachLayer((layer) => { if (layer instanceof L.Renderer) layer._reset(); });
    }
    function endCam() {
        if (!camMoving) return;
        camMoving = false;
        map._moveEnd(true);
    }

    const fitOpts = (extra = {}) => (isFull()
        ? { paddingTopLeft: [FIT_PAD, FIT_PAD], paddingBottomRight: [FIT_PAD, FIT_PAD + dockCover()], ...extra }
        : { padding: [30, 30], ...extra });
    // Room for the trail, in px around the map's centre: the map minus the padding and the docked profile
    function safeBox() {
        const s = map.getSize();
        return { left: -s.x / 2 + FIT_PAD, right: s.x / 2 - FIT_PAD, top: -s.y / 2 + FIT_PAD, bottom: s.y / 2 - FIT_PAD - dockCover() };
    }
    // The trail shown on the profile (the whole hike when it isn't zoomed)
    function stretchBounds() {
        if (!isZoomed()) return L.latLngBounds(bbox);
        return L.latLngBounds(visiblePoints().map((d) => [d.lat, d.lon]));
    }
    // The stretch's box in px around a camera { center, zoom }
    function boxAt(bounds, c) {
        const mid = map.project(c.center, c.zoom);
        const ne = map.project(bounds.getNorthEast(), c.zoom).subtract(mid);
        const sw = map.project(bounds.getSouthWest(), c.zoom).subtract(mid);
        return { left: sw.x, right: ne.x, top: ne.y, bottom: sw.y };
    }
    // During a gesture: where the camera should go for this stretch, coming from `from`
    function target(bounds, from) {
        const b = safeBox();
        const s = map.getSize();
        const fitZ = Math.min(17, map.getBoundsZoom(bounds, false, L.point(s.x - (b.right - b.left), s.y - (b.bottom - b.top))));
        if (fitZ < from.zoom) {
            // Doesn't fit any more: zoom out, centred in the part of the map above the profile
            return { center: map.unproject(map.project(bounds.getCenter(), fitZ).add([0, dockCover() / 2]), fitZ), zoom: fitZ };
        }
        // Stay put, or shift just enough to bring the stretch back inside
        const box = boxAt(bounds, from);
        const dx = box.left < b.left ? box.left - b.left : box.right > b.right ? box.right - b.right : 0;
        const dy = box.top < b.top ? box.top - b.top : box.bottom > b.bottom ? box.bottom - b.bottom : 0;
        if (!dx && !dy) return from;
        return { center: map.unproject(map.project(from.center, from.zoom).add([dx, dy]), from.zoom), zoom: from.zoom };
    }
    function startGlide() {
        if (glideFrame != null) return;
        lastGlideT = performance.now();
        glideFrame = requestAnimationFrame(glideStep);
    }
    function glideStep(now) {
        glideFrame = null;
        if (!cam) return;
        const dt = Math.min(64, Math.max(0, now - lastGlideT));
        lastGlideT = now;
        const frames = dt / (1000 / 60);
        const k = 1 - (1 - GLIDE_SPEED) ** frames; // sliding
        const kz = 1 - (1 - ZOOM_GLIDE_SPEED) ** frames; // zooming
        const z0 = map.getZoom();
        const p0 = map.project(map.getCenter(), z0);
        const p1 = map.project(cam.center, z0);
        const dz = cam.zoom - z0;
        if (Math.abs(dz) < 0.003 && p0.distanceTo(p1) < 0.5) {
            moveCam(cam.center, cam.zoom);
            if (settling) finishSettle();
            return;
        }
        moveCam(map.unproject(p0.add(p1.subtract(p0).multiplyBy(k)), z0), z0 + dz * kz);
        glideFrame = requestAnimationFrame(glideStep);
    }
    function finishSettle() {
        settling = false;
        cam = null;
        endCam();
        map.options.zoomSnap = SNAP;
    }
    function followMap(final) {
        if (!isFull()) return;
        const bounds = stretchBounds();
        if (final) {
            settleMap(bounds);
            return;
        }
        settling = false; // a new gesture takes over from a settle in progress
        map.options.zoomSnap = 0; // in-between zoom levels while gliding
        const from = cam ?? { center: map.getCenter(), zoom: map.getZoom() };
        cam = target(bounds, from);
        startGlide();
    }
    // When the gesture is over: glide on to a good fit for the stretch, or stay
    // (on a whole zoom step) if it already fits well
    function settleMap(bounds) {
        map.options.zoomSnap = SNAP; // the final place is on a whole zoom step
        const here = cam ?? { center: map.getCenter(), zoom: map.getZoom() };
        let goal = null;
        if (isZoomed()) {
            const b = safeBox();
            const box = boxAt(bounds, here);
            const inside = box.left >= b.left - 1 && box.right <= b.right + 1 && box.top >= b.top - 1 && box.bottom <= b.bottom + 1;
            const fill = Math.max((box.right - box.left) / (b.right - b.left), (box.bottom - box.top) / (b.bottom - b.top));
            if (inside && fill >= LAZY_REFIT) goal = { center: here.center, zoom: Math.floor(here.zoom / SNAP + 1e-6) * SNAP };
        }
        // Leaflet internal: the centre and zoom fitBounds would use
        cam = goal ?? map._getBoundsCenterZoom(bounds, fitOpts(isZoomed() ? { maxZoom: 17 } : {}));
        settling = true;
        map.options.zoomSnap = 0;
        startGlide();
    }

    // Tiles also load while the map moves (on phones Leaflet normally waits until it
    // stops, so a glide showed blurry stretched tiles), with a few more kept around the
    // edges. Leaflet reads these options when a layer is added, so the layer is re-added.
    function liveTiles() {
        map.eachLayer((layer) => {
            if (!(layer instanceof L.GridLayer)) return;
            if (layer.options.updateWhenIdle === false && layer.options.keepBuffer === 4) return;
            layer.options.updateWhenIdle = false;
            layer.options.keepBuffer = 4;
            map.removeLayer(layer);
            map.addLayer(layer);
        });
    }
    liveTiles();
    map.on('baselayerchange', liveTiles);

    return {
        /** The profile's stretch changed: glide along (final = the gesture is over: settle). Full screen only. */
        follow: followMap,
        /** Glide to a good fit for the profile's stretch (e.g. after "Whole hike"). */
        settle: () => settleMap(stretchBounds()),
        /** fitBounds options that keep the trail clear of the edges (and of the docked profile in full screen). */
        fitOpts,
    };
}
