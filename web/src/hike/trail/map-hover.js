// The map's side of the hover: the mouse near the trail, or a finger put on the
// trail and dragged along it, moves the dot (on the map and the profile) and the
// readout. Everything else (moving, pinching the map) is left to Leaflet.

const TOUCH_REACH = 28; // px around the line that count as "on the trail"
const MOUSE_REACH = 40; // same for the mouse pointer

/**
 * @param {L.Map} map
 * @param {object} o
 * @param {object[]} o.data        the track points (trail-data.js)
 * @param {() => boolean} o.peek   is the map only a preview (phone page)? Then no hover.
 * @param {(point: object|null, pageX?: number, pageY?: number, source?: string, touch?: boolean) => void} o.syncHover
 *   show `point` everywhere (null = hide)
 */
export function setupMapHover(map, { data, peek, syncHover }) {
    const mapBox = map.getContainer();

    map.on('mousemove', (e) => {
        if (peek()) return;
        // Only near the trail; further away the dot and readout go away
        const { point, px } = nearestOnScreen(e.originalEvent.clientX, e.originalEvent.clientY);
        if (px > MOUSE_REACH) syncHover(null);
        else syncHover(point, e.originalEvent.pageX, e.originalEvent.pageY, 'map');
    });
    map.on('mouseout', () => syncHover(null));

    // Phones: put a finger on the trail and drag to follow it (the map stays put);
    // touching anywhere else moves the map as usual.
    let following = null; // pointerId of the finger following the trail
    const touchesDown = new Set(); // every finger on the map right now (a 2nd one = pinch, never follow)

    const nearestOnScreen = (clientX, clientY) => {
        const r = mapBox.getBoundingClientRect();
        const px = clientX - r.left, py = clientY - r.top;
        let best = null, bestD = Infinity;
        for (const d of data) {
            const p = map.latLngToContainerPoint([d.lat, d.lon]);
            const dist2 = (p.x - px) ** 2 + (p.y - py) ** 2;
            if (dist2 < bestD) { bestD = dist2; best = d; }
        }
        return { point: best, px: Math.sqrt(bestD) };
    };
    const follow = (event) => {
        const { point } = nearestOnScreen(event.clientX, event.clientY);
        syncHover(point, event.pageX, event.pageY, 'map', true);
    };
    const stopFollowing = () => {
        if (following == null) return;
        following = null;
        map.dragging.enable();
    };

    // Capture phase, so we decide before Leaflet starts dragging the map
    mapBox.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch') return;
        touchesDown.add(event.pointerId);
        if (touchesDown.size > 1) {
            // A second finger: this is a pinch. Hand the gesture back to Leaflet
            // (don't stop this event) so it zooms, even if a finger is on the trail.
            if (following != null) { stopFollowing(); syncHover(null); }
            return;
        }
        if (following != null || peek()) return;
        if (event.target.closest('.leaflet-control')) return; // buttons keep working
        const { px } = nearestOnScreen(event.clientX, event.clientY);
        if (px > TOUCH_REACH) {
            syncHover(null);
            return;
        }
        following = event.pointerId;
        map.dragging.disable();
        event.stopPropagation();
        follow(event);
    }, true);
    mapBox.addEventListener('pointermove', (event) => {
        if (event.pointerId !== following) return;
        event.stopPropagation();
        follow(event);
    }, true);
    for (const type of ['pointerup', 'pointercancel']) {
        mapBox.addEventListener(type, (event) => {
            touchesDown.delete(event.pointerId);
            if (event.pointerId === following) stopFollowing();
        }, true);
    }
    // Some phones also send touch events; keep them from panning while following the trail
    for (const type of ['touchstart', 'touchmove']) {
        mapBox.addEventListener(type, (event) => { if (following != null) event.stopPropagation(); }, { capture: true, passive: true });
    }
}
