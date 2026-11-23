import * as d3 from 'd3';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { APP_CONFIG } from '../config.js';
import { dist, elev, distUnit, elevUnit } from '../lib/units.js';
import { el } from '../lib/data.js';
import { fmtWalk } from '../lib/units.js';
import { hasTimes, hoursBetween, hoursToEnd } from '../lib/walking-time.js';
import { onPaceChange } from '../lib/pace.js';
import { addMapLayers } from '../lib/map-layers.js';
import { stopsFor, stopSvg, stopSize } from '../lib/stops.js';

const C = APP_CONFIG.colors;

const slopeColor = (() => {
    const stops = APP_CONFIG.slopeColors;
    const scale = d3.scaleLinear()
        .domain(stops.map((s) => s[0]))
        .range(stops.map((s) => s[1]))
        .interpolate(d3.interpolateLab) // even blends, no muddy in-betweens
        .clamp(true);
    return (gradePct) => scale(Math.abs(gradePct));
})();

/** Steepness at a point for the readout: "+12%", "−8%" or "flat". */
function gradeText(point) {
    const g = Math.round(point.grade);
    return Math.abs(g) < 1 ? 'flat' : `${g > 0 ? '+' : '−'}${Math.abs(g)}%`;
}

export function renderMapAndElevation(hike) {
    const t = hike.track;
    const totalDistance = dist(t.dist_km[t.dist_km.length - 1]);

    // Steepness for the line color, averaged over ~1/120 of the hike so it
    // reads as sections of trail rather than GPS flicker
    const windowKm = Math.max(t.dist_km[t.dist_km.length - 1] / 120, 0.08);
    const smoothGrade = t.dist_km.map((d) => {
        const lo = d3.bisectLeft(t.dist_km, d - windowKm / 2);
        const hi = d3.bisectRight(t.dist_km, d + windowKm / 2) - 1;
        const run = (t.dist_km[hi] - t.dist_km[lo]) * 1000;
        return run > 0 ? (100 * (t.ele_m[hi] - t.ele_m[lo])) / run : 0;
    });

    // The line color is smoothed again over a longer stretch (config slopeSmoothing,
    // a fraction of the hike), so the colors flow into each other instead of
    // flickering. The readout keeps the sharper value above.
    const colorGrade = (() => {
        const span = Math.max(t.dist_km[t.dist_km.length - 1] * (APP_CONFIG.slopeSmoothing ?? 0.03), windowKm);
        // Two passes of a moving average ≈ a soft (triangular) blur. Averaged as
        // steepness without direction (abs), so a summit — steep up, steep down —
        // stays warm instead of averaging out to "flat"
        let g = smoothGrade.map(Math.abs);
        for (let pass = 0; pass < 2; pass++) {
            const prefix = [0];
            for (const v of g) prefix.push(prefix[prefix.length - 1] + v);
            g = t.dist_km.map((d) => {
                const lo = d3.bisectLeft(t.dist_km, d - span / 2);
                const hi = d3.bisectRight(t.dist_km, d + span / 2);
                return (prefix[hi] - prefix[lo]) / Math.max(1, hi - lo);
            });
        }
        return g;
    })();

    // --- 1. FORMAT DATA (converted to the display units once) ---
    const data = t.dist_km.map((d, i) => ({
        index: i,
        distance: dist(d),
        elevation: elev(t.ele_m[i]),
        lat: t.lat[i],
        lon: t.lon[i],
        grade: smoothGrade[i],
        color: slopeColor(colorGrade[i]),
    }));

    // --- 2. WAYPOINTS (already snapped to a track point by the build script) ---
    const waypoints = hike.waypoints.map((wp) => ({ ...wp, point: data[wp.index] }));

    // Full-screen map state (section 6). On phones (no hover, coarse pointer)
    // the map on the page is only a preview: "peek" mode.
    const compact = window.matchMedia('(hover: none) and (pointer: coarse)');
    let full = false;
    const peek = () => compact.matches && !full;

    // --- 3. LEAFLET OVERHEAD MAP ---
    // Mouse wheel / trackpad over the map zooms the map instead of scrolling the page
    const map = L.map('map-container', { scrollWheelZoom: true, wheelPxPerZoomLevel: 90, zoomSnap: 0.5 }).fitBounds(hike.bbox, { padding: [30, 30] });

    // Full-screen button first, so it sits above the layer button (see section 6)
    const fullControl = new (L.Control.extend({
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
            L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); resetView(); });
            return bar;
        },
    }))());

    addMapLayers(map); // Park map / Streets / Satellite / Topo, with a layer button (config.js mapLayers)

    // The trail: one solid line, like on a printed park map (optional light edge underneath)
    const latlngs = data.map((d) => [d.lat, d.lon]);
    const casingLine = C.trailCasing
        ? L.polyline(latlngs, { color: C.trailCasing, weight: 8, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map)
        : null;
    const trailLine = L.polyline(latlngs, { color: C.trail, weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);
    // The stretch shown on the zoomed-in profile, drawn over the faded rest of the trail (section 4)
    const stretchLine = L.polyline([], { color: C.trail, weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);

    // Trailhead, end, highest point and stops as map symbols (src/lib/stops.js), with their names
    const stops = stopsFor(hike, (m) => `${Math.round(elev(m)).toLocaleString('en')} ${elevUnit()}`);
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

    // The dot that follows your finger: a hollow ring in the trail color
    const mapHoverDot = L.circleMarker([0, 0], {
        radius: 7, color: C.trail, weight: 2.5, fillColor: C.markerLight, fillOpacity: 0.85,
        interactive: false,
    }).addTo(map);
    mapHoverDot.setStyle({ opacity: 0, fillOpacity: 0 });

    // --- 4. D3 ELEVATION PROFILE ---
    // Drawn at the container's real pixel width (and redrawn on resize),
    // so the axis text stays readable on phones.
    // In the full-screen view it can be zoomed: pinch (or mouse wheel) to show
    // part of the hike, drag along it to scrub (at the edge the view moves with
    // you), and the map follows the part of the trail you're looking at.
    const container = document.getElementById('elevation-container');
    const bisect = d3.bisector((d) => d.distance);
    const tooltip = document.getElementById('tooltip');
    let profile = null; // { x, y, width, height, render, placeHover, hoverGroup, hoverDot, youGroup } of the current drawing
    let youIndex = null; // track point nearest to the reader's location, if known
    let hover = null; // { point, nearby } under the finger / mouse, kept across redraws

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
        const label = (distance, hours) => [
            el('b', { textContent: `${Math.max(0, distance).toFixed(1)} ${distUnit()}` }),
            hasTimes(hike) && hours * 60 >= 2.5 ? ` · ${fmtWalk(hours)}` : null,
        ];
        progDone.replaceChildren(...(point ? label(d, hasTimes(hike) ? hoursBetween(hike, 0, i) : 0) : []));
        progLeft.replaceChildren(...label(totalDistance - d, hasTimes(hike) ? hoursToEnd(hike, i) : 0));
        progFill.style.width = `${totalDistance > 0 ? (100 * d) / totalDistance : 0}%`;
    }
    updateProgress(null);
    onPaceChange(() => updateProgress(hover?.point));

    // The stretch of the hike that's visible, in display units
    let view = [0, totalDistance];
    let dockExtra = 0; // px the docked profile was dragged taller (section 6)
    const MIN_SPAN = Math.min(totalDistance, Math.max(totalDistance / 40, dist(0.15)));
    const isZoomed = () => view[0] > 1e-9 || view[1] < totalDistance - 1e-9;
    function setView(a, b) {
        let span = Math.min(Math.max(b - a, MIN_SPAN), totalDistance);
        let start = span === b - a ? a : (a + b) / 2 - span / 2;
        start = Math.min(Math.max(start, 0), totalDistance - span);
        const changed = start !== view[0] || start + span !== view[1];
        view = [start, start + span];
        return changed;
    }

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
            trailLine.setStyle({ opacity: zoomed ? DIM : 1 });
            casingLine?.setStyle({ opacity: zoomed ? 0.9 * DIM : 0.9 });
        }
        if (!zoomed) {
            if (stretchLine.getLatLngs().length) stretchLine.setLatLngs([]);
            return;
        }
        const i0 = bisect.right(data, view[0]);
        const i1 = bisect.left(data, view[1]);
        stretchLine.setLatLngs([latLngAt(view[0]), ...latlngs.slice(i0, i1), latLngAt(view[1])]);
    }

    const [minElev, maxElev] = d3.extent(data, (d) => d.elevation);
    const elevPad = maxElev - minElev === 0 ? 50 : (maxElev - minElev) * 0.2;

    function drawProfile() {
        container.replaceChildren();
        // Fill under the profile: shaded-relief brown, like hillshading on a park map
        const outerWidth = container.clientWidth || 900;
        const narrow = outerWidth < 560;
        const margin = { top: 12, right: 8, bottom: 30, left: narrow ? 46 : 56 };
        const width = outerWidth - margin.left - margin.right;
        progress.style.padding = `0 ${margin.right}px 0 ${margin.left}px`; // bar spans the plot, not the axis labels
        // Shorter when docked under the full-screen map, so the map gets the room
        // (the reader can drag it taller with the handle on top, section 6)
        const outerHeight = full ? (narrow ? 150 : 180) + dockExtra : (narrow ? 190 : 230);
        const height = outerHeight - margin.top - margin.bottom;

        const svg = d3.select(container).append('svg')
            .attr('width', outerWidth)
            .attr('height', height + margin.top + margin.bottom)
            .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const x = d3.scaleLinear().domain(view).range([0, width]);
        // Heights stay those of the whole hike while zoomed, so nothing jumps while you scroll
        const y = d3.scaleLinear().domain([Math.max(0, minElev - elevPad), maxElev + elevPad]).range([height, 0]).nice();

        const defs = svg.append('defs');
        const clipRect = defs.append('clipPath').attr('id', 'profile-clip').append('rect')
            .attr('y', -margin.top).attr('height', height + margin.top);
        // Steepness colors along the whole hike (thinned out: they're smooth anyway);
        // the gradient is stretched to wherever the whole hike sits on screen
        const slopeGradient = defs.append('linearGradient').attr('id', 'slope-gradient')
            .attr('gradientUnits', 'userSpaceOnUse').attr('y1', 0).attr('y2', 0);
        const every = Math.max(1, Math.floor(data.length / 500));
        data.forEach((d, i) => {
            if (i % every && i !== data.length - 1) return;
            slopeGradient.append('stop')
                .attr('offset', `${(d.distance / totalDistance) * 100}%`)
                .attr('stop-color', d.color);
        });

        // Height lines: all of them drawn, but only every 2nd/3rd one labeled
        // when they're close together (phones, the docked profile)
        const yTicks = y.ticks(narrow ? 5 : 6);
        const yStep = yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1;
        const yGapPx = yTicks.length > 1 ? Math.abs(y(yTicks[0]) - y(yTicks[1])) : height;
        const labelEvery = Math.max(1, Math.ceil((narrow ? 50 : 28) / yGapPx));
        const yLabels = yTicks.filter((v) => Math.round(v / yStep) % labelEvery === 0);

        svg.append('g').attr('class', 'grid-line')
            .call(d3.axisLeft(y).tickValues(yTicks).tickSize(-width).tickFormat(''));

        const plot = svg.append('g').attr('clip-path', 'url(#profile-clip)');
        const areaPath = plot.append('path').attr('fill', C.terrain);
        const linePath = plot.append('path')
            .attr('fill', 'none').attr('stroke', 'url(#slope-gradient)')
            .attr('stroke-width', 3.5).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
        const area = d3.area().x((d) => x(d.distance)).y0(height).y1((d) => y(d.elevation)).curve(d3.curveMonotoneX);
        const line = d3.line().x((d) => x(d.distance)).y((d) => y(d.elevation)).curve(d3.curveMonotoneX);

        // The same symbols as on the map, sitting on the profile line
        const marks = plot.append('g').attr('class', 'profile-stops');
        const k = narrow ? 1.3 : 1.5; // symbols a bit bigger here than on the map
        const markEls = stops.map((s) => {
            const g = marks.append('g').html(stopSvg(s.kind));
            g.append('title').text(s.name);
            const label = s.kind === 'peak'
                ? marks.append('text').attr('class', 'profile-peak-label').attr('text-anchor', 'middle').text(s.name)
                : null;
            return { s, g, label, size: stopSize(s.kind) * k };
        });

        const xAxis = svg.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${height})`);
        svg.append('g')
            .call(d3.axisLeft(y).tickValues(yLabels).tickSizeOuter(0).tickFormat((d) => `${d.toLocaleString('en')} ${elevUnit()}`))
            .call((g) => g.select('.domain').remove());

        // "You are here" on the profile (blue, like the dot on the map)
        const youGroup = plot.append('g').attr('class', 'you-marker').style('display', 'none');
        youGroup.append('line').attr('y1', 0).attr('y2', height);
        youGroup.append('circle').attr('r', 7);

        const hoverGroup = plot.append('g').style('display', 'none');
        hoverGroup.append('line').attr('y1', 0).attr('y2', height)
            .attr('stroke', C.hoverLine).attr('stroke-width', 1.5).attr('stroke-dasharray', '4 4');
        const hoverDot = hoverGroup.append('circle').attr('r', 6)
            .attr('fill', C.markerLight).attr('stroke', C.trail).attr('stroke-width', 2.5);

        // Everything that depends on the visible stretch; cheap enough to run every frame
        const endGapPx = narrow ? 48 : 60;
        const endLabel = (Math.round(totalDistance * 10) / 10).toLocaleString('en');
        function render() {
            x.domain(view);
            const zoomed = isZoomed();
            // Not zoomed: let the trailhead symbols poke out a bit; zoomed: cut at the edges
            clipRect.attr('x', zoomed ? 0 : -24).attr('width', zoomed ? width : width + 48);
            slopeGradient.attr('x1', x(0)).attr('x2', x(totalDistance));

            // Only the visible points (plus one either side)
            const i0 = Math.max(0, bisect.left(data, view[0]) - 1);
            const i1 = Math.min(data.length, bisect.right(data, view[1]) + 1);
            const visible = data.slice(i0, i1);
            areaPath.attr('d', area(visible));
            linePath.attr('d', line(visible));

            for (const { s, g, label, size } of markEls) {
                const p = data[s.index];
                const px = x(p.distance);
                const show = px >= -size && px <= width + size;
                g.style('display', show ? null : 'none')
                    .attr('transform', `translate(${px - size / 2},${y(p.elevation) - size / 2}) scale(${k})`);
                if (label) {
                    label.style('display', px >= 0 && px <= width ? null : 'none')
                        .attr('x', Math.min(Math.max(px, 60), width - 60)).attr('y', y(p.elevation) - 15);
                }
            }

            // Distance: round numbers, plus the hike's total length when the end is in view
            // (round ticks too close to it are dropped so the labels don't overlap)
            const n = narrow ? 4 : 8;
            const fmt = x.tickFormat(n);
            let xTicks = x.ticks(n);
            const endInView = view[1] >= totalDistance - 1e-9;
            if (endInView) xTicks = [...xTicks.filter((d) => x(totalDistance) - x(d) >= endGapPx), totalDistance];
            xAxis.call(d3.axisBottom(x).tickValues(xTicks).tickSizeOuter(0)
                .tickFormat((d) => `${endInView && d === totalDistance ? endLabel : fmt(d)} ${distUnit()}`))
                .call((g) => g.selectAll('.tick').filter((d) => endInView && d === totalDistance)
                    .classed('tick-end', true)
                    .select('text').attr('text-anchor', 'end').attr('dx', '0.4em'));

            // "Whole hike" only when part of the hike is hidden
            document.querySelector('.profile-reset')?.toggleAttribute('hidden', !zoomed);
            showStretch();
            keepDotInView();
            placeHover();
            placeYou();
        }

        // Zoomed in and the view moves past the dot: the dot is pushed along at the edge
        function keepDotInView() {
            if (!hover || !full || !isZoomed()) return;
            const inset = (6 / width) * (view[1] - view[0]);
            const lo = view[0] + inset;
            const hi = view[1] - inset;
            const d = hover.point.distance;
            if (d >= lo && d <= hi) return;
            const p = data[bisect.center(data, Math.min(Math.max(d, lo), hi))];
            const box = overlay.node().getBoundingClientRect();
            const pageX = box.left + window.scrollX + x(p.distance);
            const pageY = box.top + window.scrollY + y(p.elevation);
            syncHover(p, pageX, pageY, 'none', true);
        }

        function placeHover() {
            if (!hover) {
                hoverGroup.style('display', 'none');
                return;
            }
            const p = hover.point;
            hoverGroup.style('display', null);
            hoverGroup.select('line').attr('x1', x(p.distance)).attr('x2', x(p.distance));
            hoverDot.attr('cx', x(p.distance)).attr('cy', y(p.elevation));
        }

        // --- Pointer handling: mouse, pen and fingers ---
        // One finger / mouse: scrub along the hike. Two fingers (full screen): zoom and move.
        // Zoomed in, a finger that lands on (or near) the dot drags the dot; anywhere
        // else it slides the profile along, like dragging a map. A tap moves the dot there.
        // On the page a sideways drag scrubs and an up/down swipe scrolls (touch-action: pan-y).
        const pointers = new Map(); // pointerId -> x in the plot
        let pinch = null; // the two distances under the fingers when the pinch started
        let afterPinch = false; // one finger still down after a pinch: ignore it until it lifts
        let pan = null; // { px, view, moved } while sliding the profile
        const GRAB = 34; // px around the dot that count as "on the dot"
        const TAP_SLOP = 6; // px a finger may wobble and still count as a tap
        let scrub = null; // { px, pageX, pageY, touch } of the scrubbing finger
        let edgeFrame = null;
        let edgeMoved = false; // the view moved along during this scrub
        const EDGE = 28; // px from either end where the view starts moving along

        const hoverAt = (px) => {
            const i = bisect.center(data, x.invert(Math.min(Math.max(px, 0), width)));
            syncHover(data[i], scrub.pageX, scrub.pageY, 'elevation', scrub.touch);
        };

        // Held near (or past) an end while zoomed: move the view along, faster the further out
        function edgeStep() {
            edgeFrame = null;
            if (!scrub || !full || !isZoomed()) return;
            const depth = scrub.px < EDGE ? scrub.px - EDGE : scrub.px > width - EDGE ? scrub.px - (width - EDGE) : 0;
            if (!depth) return;
            const span = view[1] - view[0];
            const shift = Math.max(-1, Math.min(1, depth / EDGE)) * span * 0.025;
            if (!setView(view[0] + shift, view[1] + shift)) return; // reached the start/end of the hike
            edgeMoved = true;
            render();
            hoverAt(scrub.px);
            followMap(false);
            edgeFrame = requestAnimationFrame(edgeStep);
        }

        function onScrub(event, px) {
            if (peek()) return; // phone, small map: a tap opens the full-screen map instead
            const pressed = event.pointerType !== 'mouse' || event.buttons > 0;
            scrub = { px, pageX: event.pageX, pageY: event.pageY, touch: event.pointerType === 'touch' };
            hoverAt(px);
            if (full && pressed && edgeFrame == null) edgeFrame = requestAnimationFrame(edgeStep);
        }

        function endGesture(event) {
            pointers.delete(event.pointerId);
            if (pinch && pointers.size < 2) {
                pinch = null;
                afterPinch = pointers.size > 0;
                followMap(true);
            }
            if (pan && pointers.size === 0) {
                if (pan.moved) followMap(true);
                else if (event.type === 'pointerup') onScrub(event, pan.px); // a tap: put the dot there
                pan = null;
                if (edgeFrame != null) { cancelAnimationFrame(edgeFrame); edgeFrame = null; }
            }
            if (pointers.size === 0) {
                afterPinch = false;
                if (edgeFrame != null) { cancelAnimationFrame(edgeFrame); edgeFrame = null; }
                if (edgeMoved) { edgeMoved = false; followMap(true); }
            }
        }

        const overlay = svg.append('rect').attr('width', width).attr('height', height).attr('fill', 'transparent')
            .style('touch-action', full ? 'none' : 'pan-y')
            .on('pointerdown', (event) => {
                if (peek()) return;
                const [px] = d3.pointer(event);
                pointers.set(event.pointerId, px);
                if (full) event.currentTarget.setPointerCapture(event.pointerId);
                if (full && pointers.size === 2) {
                    const [a, b] = [...pointers.values()];
                    pinch = { va: x.invert(a), vb: x.invert(b) };
                    scrub = null;
                    pan = null;
                    return;
                }
                if (pointers.size !== 1) return;
                const dotPx = hover ? x(hover.point.distance) : null;
                const onDot = dotPx != null && dotPx >= 0 && dotPx <= width && Math.abs(px - dotPx) <= GRAB;
                if (full && isZoomed() && !onDot) {
                    pan = { px, view: [...view], moved: false };
                    return;
                }
                onScrub(event, px);
            })
            .on('pointermove', (event) => {
                const [px] = d3.pointer(event);
                if (pointers.has(event.pointerId)) pointers.set(event.pointerId, px);
                if (pinch) {
                    const [a, b] = [...pointers.values()];
                    const pxPerUnit = (b - a) / (pinch.vb - pinch.va);
                    if (!(pxPerUnit > 0) || Math.abs(b - a) < 12) return; // fingers crossed / together
                    const start = pinch.va - a / pxPerUnit;
                    setView(start, start + width / pxPerUnit);
                    render();
                    followMap(false);
                    return;
                }
                if (afterPinch) return;
                if (pan) {
                    const dx = px - pan.px;
                    if (!pan.moved && Math.abs(dx) < TAP_SLOP) return;
                    pan.moved = true;
                    const span = pan.view[1] - pan.view[0];
                    const start = pan.view[0] - (dx / width) * span;
                    setView(start, start + span);
                    render();
                    followMap(false);
                    return;
                }
                if (pointers.size <= 1) onScrub(event, px);
            })
            .on('pointerup pointercancel', endGesture)
            .on('click', () => { if (peek()) openFull(); })
            .on('pointerleave', (event) => {
                if (event.pointerType === 'mouse' && !event.buttons) { scrub = null; syncHover(null); }
            });

        // Mouse wheel / trackpad in the full-screen view, zooming around the pointer:
        //   trackpad pinch (the browser sends it as wheel + ctrlKey) → zoom, fast enough to feel direct
        //   scroll up/down (mouse wheel or two fingers)            → zoom
        //   two fingers sideways (or shift + wheel)                → move along the hike
        // A trackpad swipe is locked to its main direction, so a slightly diagonal
        // swipe doesn't zoom and move at the same time.
        const PINCH_SPEED = 0.012;
        const SCROLL_SPEED = 0.0025;
        let wheelTimer = null;
        overlay.node().addEventListener('wheel', (event) => {
            if (!full) return;
            event.preventDefault();
            // Lines / pages (some mice, Firefox) → pixels
            const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
            let dx = event.deltaX * unit;
            let dy = event.deltaY * unit;
            if (event.shiftKey && !dx) { dx = dy; dy = 0; } // shift + wheel = sideways
            let zoomBy = 0;
            if (event.ctrlKey) {
                zoomBy = dy * PINCH_SPEED;
                dx = 0;
            } else if (Math.abs(dx) > Math.abs(dy)) {
                dy = 0;
            } else {
                zoomBy = dy * SCROLL_SPEED;
                dx = 0;
            }
            const [px] = d3.pointer(event);
            const span = view[1] - view[0];
            const at = x.invert(px);
            const newSpan = span * Math.exp(Math.max(-0.5, Math.min(0.5, zoomBy)));
            const start = at - (px / width) * newSpan + (dx / width) * span;
            setView(start, start + newSpan);
            render();
            followMap(false);
            clearTimeout(wheelTimer);
            wheelTimer = setTimeout(() => followMap(true), 250);
        }, { passive: false });

        profile = { x, y, width, height, render, placeHover, youGroup };
        render();
    }

    function placeYou() {
        const { x, y, youGroup } = profile;
        if (youIndex == null) {
            youGroup.style('display', 'none');
            return;
        }
        const p = data[youIndex];
        youGroup.style('display', null);
        youGroup.select('line').attr('x1', x(p.distance)).attr('x2', x(p.distance));
        youGroup.select('circle').attr('cx', x(p.distance)).attr('cy', y(p.elevation));
    }

    // The map shows the part of the trail that's visible on the profile.
    // During a gesture it only pans (and zooms out if needed) so it doesn't
    // flicker between zoom levels; when the gesture ends it settles on a good fit.
    const FIT_PAD = 40;
    // In full screen the profile floats over the bottom of the map: keep the trail above it
    const dockCover = () => (full ? Math.max(0, overlay.clientHeight - dock.offsetTop) : 0);
    const fitOpts = (extra = {}) => (full
        ? { paddingTopLeft: [FIT_PAD, FIT_PAD], paddingBottomRight: [FIT_PAD, FIT_PAD + dockCover()], ...extra }
        : { padding: [30, 30], ...extra });
    function followMap(final) {
        if (!full) return;
        if (!isZoomed()) {
            if (final) map.fitBounds(hike.bbox, fitOpts());
            return;
        }
        const i0 = bisect.left(data, view[0]);
        const i1 = Math.max(bisect.right(data, view[1]), i0 + 1);
        const bounds = L.latLngBounds(data.slice(i0, i1).map((d) => [d.lat, d.lon]));
        if (final) {
            map.fitBounds(bounds, fitOpts({ maxZoom: 17 }));
        } else if (map.getBoundsZoom(bounds, false, L.point(2 * FIT_PAD, 2 * FIT_PAD + dockCover())) >= map.getZoom()) {
            // Centre the stretch in the part of the map above the profile
            const c = map.project(bounds.getCenter()).add([0, dockCover() / 2]);
            map.panTo(map.unproject(c), { animate: false });
        } else {
            map.fitBounds(bounds, fitOpts({ animate: false }));
        }
    }

    /** Back to the whole hike, on the profile and on the map. */
    function resetView() {
        view = [0, totalDistance];
        profile.render();
        map.fitBounds(hike.bbox, fitOpts());
    }

    drawProfile();
    let lastWidth = container.clientWidth;
    new ResizeObserver(() => {
        if (container.clientWidth !== lastWidth) {
            lastWidth = container.clientWidth;
            drawProfile();
        }
    }).observe(container);

    // --- 5. SYNCHRONIZED HOVER ---
    function syncHover(point, pageX, pageY, source, touch = false) {
        if (!point) {
            hover = null;
            mapHoverDot.setStyle({ opacity: 0, fillOpacity: 0 });
            profile.placeHover();
            tooltip.style.opacity = 0;
            updateProgress(null);
            return;
        }

        const snapRadius = (view[1] - view[0]) * (APP_CONFIG.gravity[source] ?? 0);
        const nearby = waypoints.find((w) => Math.abs(w.point.distance - point.distance) <= snapRadius);
        if (nearby) point = nearby.point;
        hover = { point, nearby };

        mapHoverDot.setLatLng([point.lat, point.lon]).setStyle({ opacity: 1, fillOpacity: 1 });
        profile.placeHover();

        tooltip.replaceChildren(
            ...(nearby ? [el('div', { className: 'tooltip-waypoint', textContent: nearby.name })] : []),
            el('div', { className: 'tooltip-line' },
                el('span', { className: 'tooltip-elev', textContent: `${Math.round(point.elevation).toLocaleString('en')} ${elevUnit()}` }),
                el('span', { className: 'tooltip-meta', textContent: ` · ${gradeText(point)}` }),
            ),
        );
        updateProgress(point);
        tooltip.style.opacity = 1;
        tooltip.style.left = `${pageX}px`;
        tooltip.style.top = `${pageY - (touch ? 48 : 16)}px`; // above the finger, not under it
    }

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
    const mapBox = map.getContainer();
    const TOUCH_REACH = 28; // px around the line that count as "on the trail"
    const MOUSE_REACH = 40; // same for the mouse pointer
    let following = null; // pointerId of the finger following the trail

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
        if (event.pointerType !== 'touch' || following != null || peek()) return;
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
        mapBox.addEventListener(type, (event) => { if (event.pointerId === following) stopFollowing(); }, true);
    }
    // Some phones also send touch events; keep them from panning while following the trail
    for (const type of ['touchstart', 'touchmove']) {
        mapBox.addEventListener(type, (event) => { if (following != null) event.stopPropagation(); }, { capture: true, passive: true });
    }

    // --- 6. FULL-SCREEN MAP (like Komoot) ---
    // On phones the map on the page is a still picture: the page scrolls past it,
    // and tapping it (or the profile) opens the map full screen with the
    // elevation profile docked underneath. × or the phone's back button closes it.
    // Elsewhere the button top right does the same.
    // The map and profile are moved into an overlay on <body>: inside the
    // frosted sheet (backdrop-filter) position: fixed wouldn't cover the screen.
    const terrainBox = document.querySelector('.terrain');
    const statusEl = document.getElementById('you-status');
    const overlay = el('div', { className: 'map-full', hidden: true });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Map of ${hike.title}`);
    const dock = el('div', { className: 'map-full-profile' });
    const resetButton = el('button', { className: 'profile-reset', type: 'button', title: 'Show the whole hike' });
    resetButton.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg><span>Whole hike</span>';
    resetButton.hidden = true; // shown once the profile is zoomed in
    resetButton.addEventListener('click', resetView);
    dock.append(resetButton);
    overlay.append(dock);

    // Grab handle on top of the docked profile: drag up to make it taller, down
    // to shrink it again (never smaller than the starting size). Remembered.
    const EXTRA_KEY = 'hb-profile-extra';
    try { dockExtra = Math.max(0, Number(localStorage.getItem(EXTRA_KEY)) || 0); } catch { /* no storage */ }
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
        drawProfile();
        lastWidth = container.clientWidth;
        updateCover();
    };
    handle.addEventListener('pointerdown', (event) => {
        resize = { y: event.clientY, extra: dockExtra };
        handle.setPointerCapture(event.pointerId);
        handle.classList.add('dragging');
        event.preventDefault();
    });
    handle.addEventListener('pointermove', (event) => {
        if (!resize) return;
        const next = Math.min(Math.max(resize.extra - (event.clientY - resize.y), 0), maxExtra());
        if (next === dockExtra) return;
        dockExtra = next;
        if (resizeFrame == null) resizeFrame = requestAnimationFrame(applyExtra);
    });
    const endResize = () => {
        if (!resize) return;
        resize = null;
        handle.classList.remove('dragging');
        try { localStorage.setItem(EXTRA_KEY, String(Math.round(dockExtra))); } catch { /* no storage */ }
        followMap(true);
    };
    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);
    document.body.append(overlay);


    const ICON_OPEN = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

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
        syncHover(null);
        map.invalidateSize();
        drawProfile();
        lastWidth = container.clientWidth;
        updateCover();
        map.fitBounds(hike.bbox, fitOpts());
    }
    // Map credit line (bottom right) sits just above the floating profile
    function updateCover() {
        overlay.style.setProperty('--dock-cover', `${dockCover()}px`);
    }

    function openFull() {
        if (full) return;
        full = true;
        dockExtra = Math.min(dockExtra, maxExtra());
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
        if (!full) return;
        full = false;
        view = [0, totalDistance]; // the page always shows the whole hike
        terrainBox.insertBefore(mapBox, statusEl);
        statusEl.after(container, progress);
        overlay.hidden = true;
        document.documentElement.classList.remove('map-open');
        refresh();
        relayout();
        if (!fromBackButton && history.state?.hbMap) history.back();
    }
    function toggleFull() { if (full) closeFull(); else openFull(); }

    if (history.state?.hbMap) history.replaceState(null, ''); // page reloaded while the map was open
    window.addEventListener('popstate', () => closeFull(true));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFull(); });
    // A DOM listener, so a tap on a stop symbol or name opens it too
    mapBox.addEventListener('click', (e) => {
        if (peek() && !e.target.closest('.leaflet-control')) openFull();
    });
    compact.addEventListener('change', refresh);
    refresh();

    return {
        map,
        /** Mark a track point as "you are here" on the profile (null hides it). */
        showOnProfile(index) {
            youIndex = index;
            placeYou();
        },
    };
}
