// The map and elevation profile of a hike page, and what ties them together:
// the dot under the finger / mouse shows on both (syncHover), the profile's
// zoomed stretch is shown on the map, and full screen holds both. The parts:
//   trail-data.js        track -> points (units, steepness, colors)
//   trail-map.js         the Leaflet map, trail, stop symbols, buttons
//   profile-chart.js     drawing the profile
//   profile-gestures.js  scrub, pinch, slide, wheel on the profile
//   map-hover.js         mouse / finger on the map's trail
//   map-camera.js        the map following the zoomed profile
//   full-screen-map.js   the full-screen view with the docked profile
//   readout.js           tooltip and progress-bar words

import * as d3 from 'd3';

import { APP_CONFIG } from '../../config.js';
import { dist, elev, distUnit, elevUnit, fmtWalk } from '../../lib/units.js';
import { el } from '../../lib/data.js';
import { hasTimes, hoursBetween, hoursToEnd } from '../../lib/walking-time.js';
import { onPaceChange } from '../../lib/pace.js';
import { stopsFor } from './stops.js';
import { trailData } from './trail-data.js';
import { climbText, tooltipContent } from './readout.js';
import { createTrailMap } from './trail-map.js';
import { drawProfileChart } from './profile-chart.js';
import { attachProfileGestures } from './profile-gestures.js';
import { setupMapHover } from './map-hover.js';
import { createMapCamera } from './map-camera.js';
import { setupFullScreenMap } from './full-screen-map.js';

export function renderMapAndElevation(hike) {
    // --- 1. DATA (display units, steepness, colors: trail-data.js) ---
    const { data, waypoints, totalDistance, upTo, downTo } = trailData(hike);
    const last = data.length - 1;
    const bisect = d3.bisector((d) => d.distance);
    // Trailhead, end, highest point and stops: on the map and the profile
    const stops = stopsFor(hike, (m) => `${Math.round(elev(m)).toLocaleString('en')} ${elevUnit()}`);

    // --- 2. SHARED STATE (read everywhere; changed here, by the gestures and full-screen-map.js) ---
    // On phones (no hover, coarse pointer) the map on the page is only a preview: "peek".
    const compact = window.matchMedia('(hover: none) and (pointer: coarse)');
    const state = {
        full: false, // the map is open full screen
        dockExtra: 0, // px the docked profile was dragged taller
        view: [0, totalDistance], // the stretch of the hike shown on the profile, in display units
        hover: null, // { point, nearby } under the finger / mouse, kept across redraws
        youIndex: null, // track point nearest to the reader's location, if known
    };
    const peek = () => compact.matches && !state.full;

    // Zooming the profile: the visible stretch, never shorter than MIN_SPAN
    const MIN_SPAN = Math.min(totalDistance, Math.max(totalDistance / 40, dist(0.15)));
    const isZoomed = () => state.view[0] > 1e-9 || state.view[1] < totalDistance - 1e-9;
    function setView(a, b) {
        let span = Math.min(Math.max(b - a, MIN_SPAN), totalDistance);
        let start = span === b - a ? a : (a + b) / 2 - span / 2;
        start = Math.min(Math.max(start, 0), totalDistance - span);
        const changed = start !== state.view[0] || start + span !== state.view[1];
        state.view = [start, start + span];
        return changed;
    }

    // --- 3. MAP (trail-map.js) ---
    const { map, fullControl, mapHoverDot, showStretch, updateNames } = createTrailMap(hike, {
        data, stops, state, bisect, isZoomed,
        onFullButton: () => fullScreen.toggle(),
        onHome: () => resetView(),
        wholeTrailPadding: () => {
            const o = camera.fitOpts();
            const tl = o.paddingTopLeft ?? o.padding, br = o.paddingBottomRight ?? o.padding;
            return [tl[0] + br[0], tl[1] + br[1]];
        },
    });

    // --- 4. ELEVATION PROFILE (profile-chart.js, profile-gestures.js) ---
    // Drawn at the container's real pixel width (and redrawn on resize),
    // so the axis text stays readable on phones.
    // In the full-screen view it can be zoomed: pinch (or mouse wheel) to show
    // part of the hike, drag along it to scrub (at the edge the view moves with
    // you), and the map follows the part of the trail you're looking at.
    const container = document.getElementById('elevation-container');
    const tooltip = document.getElementById('tooltip');
    let profile = null; // the current drawing (profile-chart.js)

    // Under the profile: how far in and how much is left, as a bar. No words –
    // the walked numbers (left) take the bar's fill color, the rest (right) the
    // soft color of its empty part. Without a hover: the whole hike still to go.
    const progDone = el('span', { className: 'progress-done' });
    const progLeft = el('span', { className: 'progress-left' });
    const progFill = el('div', { className: 'progress-fill' });
    const progress = el('div', { className: 'profile-progress' },
        el('div', { className: 'progress-labels' }, progDone, progLeft),
        el('div', { className: 'progress-track' }, progFill),
    );
    container.after(progress);
    function updateProgress(point) {
        const d = point ? point.distance : 0;
        const i = point ? point.index : 0;
        const label = (distance, hours, upM, downM) => [
            el('div', {},
                el('b', { textContent: `${Math.max(0, distance).toFixed(1)} ${distUnit()}` }),
                hasTimes(hike) && hours * 60 >= 2.5 ? ` · ${fmtWalk(hours)}` : null,
            ),
            el('div', { className: 'progress-climb', textContent: climbText(upM, downM) }),
        ];
        progDone.replaceChildren(...(point ? label(d, hasTimes(hike) ? hoursBetween(hike, 0, i) : 0, upTo[i], downTo[i]) : []));
        progLeft.replaceChildren(...label(totalDistance - d, hasTimes(hike) ? hoursToEnd(hike, i) : 0,
            upTo[last] - upTo[i], downTo[last] - downTo[i]));
        progFill.style.width = `${totalDistance > 0 ? (100 * d) / totalDistance : 0}%`;
    }
    updateProgress(null);
    onPaceChange(() => updateProgress(state.hover?.point));

    // Everything the profile's drawing and gestures need (late ones as functions:
    // the camera and full screen are made below)
    const profileCtx = {
        state, data, bisect, totalDistance, stops, setView, isZoomed, peek,
        syncHover: (...args) => syncHover(...args),
        onRender: () => showStretch(),
        follow: (final) => camera.follow(final),
        openFull: () => fullScreen.open(),
    };
    function drawProfile() {
        profile = drawProfileChart(container, progress, profileCtx);
        attachProfileGestures(profile, profileCtx);
        profile.render();
    }

    // The map following the zoomed profile (full screen)
    const camera = createMapCamera(map, {
        bbox: hike.bbox,
        isFull: () => state.full,
        isZoomed,
        visiblePoints: () => {
            const i0 = bisect.left(data, state.view[0]);
            return data.slice(i0, Math.max(bisect.right(data, state.view[1]), i0 + 1));
        },
        dockCover: () => fullScreen.dockCover(), // keep the trail above the docked profile
    });
    updateNames(); // (needs the camera's padding)

    /** Back to the whole hike, on the profile and on the map. */
    function resetView() {
        state.view = [0, totalDistance];
        profile.render();
        camera.settle();
    }

    let lastWidth = 0;
    function redrawProfile() {
        drawProfile();
        lastWidth = container.clientWidth;
    }
    redrawProfile();
    new ResizeObserver(() => {
        if (container.clientWidth !== lastWidth) {
            lastWidth = container.clientWidth;
            drawProfile();
        }
    }).observe(container);

    // --- 5. THE DOT UNDER THE FINGER / MOUSE, on the map, the profile, the tooltip and the bar ---
    function syncHover(point, pageX, pageY, source, touch = false) {
        if (!point) {
            state.hover = null;
            mapHoverDot.setStyle({ opacity: 0, fillOpacity: 0 });
            profile.placeHover();
            tooltip.style.opacity = 0;
            updateProgress(null);
            return;
        }

        const snapRadius = (state.view[1] - state.view[0]) * (APP_CONFIG.gravity[source] ?? 0);
        const nearby = waypoints.find((w) => Math.abs(w.point.distance - point.distance) <= snapRadius);
        if (nearby) point = nearby.point;
        state.hover = { point, nearby };

        mapHoverDot.setLatLng([point.lat, point.lon]).setStyle({ opacity: 1, fillOpacity: 1 });
        profile.placeHover();

        tooltip.replaceChildren(...tooltipContent(point, nearby, data[0].elevation));
        updateProgress(point);
        tooltip.style.opacity = 1;
        tooltip.style.left = `${pageX}px`;
        tooltip.style.top = `${pageY - (touch ? 48 : 16)}px`; // above the finger, not under it
    }

    setupMapHover(map, { data, peek, syncHover }); // mouse / finger on the map's trail (map-hover.js)

    // --- 6. FULL-SCREEN MAP (like Komoot: full-screen-map.js) ---
    const fullScreen = setupFullScreenMap({
        hike, map, state, fullControl, container, progress, compact, peek, camera, redrawProfile,
        clearHover: () => syncHover(null),
        onReset: resetView,
        onClose: () => { state.view = [0, totalDistance]; },
    });

    return {
        map,
        /** Mark a track point as "you are here" on the profile (null hides it). */
        showOnProfile(index) {
            state.youIndex = index;
            profile.placeYou();
        },
    };
}
