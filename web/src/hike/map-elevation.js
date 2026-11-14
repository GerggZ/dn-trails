import * as d3 from 'd3';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { APP_CONFIG } from '../config.js';
import { dist, elev, distUnit, elevUnit } from '../lib/units.js';
import { el } from '../lib/data.js';
import { addMapLayers } from '../lib/map-layers.js';
import { stopsFor, stopSvg, stopSize } from '../lib/stops.js';

const C = APP_CONFIG.colors;

const slopeColor = (() => {
    const stops = APP_CONFIG.slopeColors;
    const scale = d3.scaleLinear()
        .domain(stops.map((s) => s[0]))
        .range(stops.map((s) => s[1]))
        .interpolate(d3.interpolateRgb)
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

    // --- 1. FORMAT DATA (converted to the display units once) ---
    const data = t.dist_km.map((d, i) => ({
        distance: dist(d),
        elevation: elev(t.ele_m[i]),
        lat: t.lat[i],
        lon: t.lon[i],
        grade: smoothGrade[i],
        color: slopeColor(smoothGrade[i]),
    }));

    // --- 2. WAYPOINTS (already snapped to a track point by the build script) ---
    const waypoints = hike.waypoints.map((wp) => ({ ...wp, point: data[wp.index] }));

    // --- 3. LEAFLET OVERHEAD MAP ---
    // Mouse wheel / trackpad over the map zooms the map instead of scrolling the page
    const map = L.map('map-container', { scrollWheelZoom: true, wheelPxPerZoomLevel: 90 }).fitBounds(hike.bbox, { padding: [30, 30] });

    addMapLayers(map); // Park map / Streets / Satellite / Topo, with a layer button (config.js mapLayers)

    // The trail: one solid line, like on a printed park map (optional light edge underneath)
    const latlngs = data.map((d) => [d.lat, d.lon]);
    if (C.trailCasing) {
        L.polyline(latlngs, { color: C.trailCasing, weight: 8, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);
    }
    L.polyline(latlngs, { color: C.trail, weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);

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
    const container = document.getElementById('elevation-container');
    const bisect = d3.bisector((d) => d.distance);
    const tooltip = document.getElementById('tooltip');
    let profile = null; // { x, y, height, hoverGroup, hoverDot, youGroup } of the current drawing
    let youIndex = null; // track point nearest to the reader's location, if known

    function drawProfile() {
        container.replaceChildren();
        // Fill under the profile: shaded-relief brown, like hillshading on a park map
        const terrain = C.terrain;
        const outerWidth = container.clientWidth || 900;
        const narrow = outerWidth < 560;
        const margin = { top: 12, right: 8, bottom: 30, left: narrow ? 46 : 56 };
        const width = outerWidth - margin.left - margin.right;
        const height = (narrow ? 190 : 230) - margin.top - margin.bottom;

        const svg = d3.select(container).append('svg')
            .attr('width', outerWidth)
            .attr('height', height + margin.top + margin.bottom)
            .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

        const x = d3.scaleLinear().domain([0, totalDistance]).range([0, width]);

        const [minElev, maxElev] = d3.extent(data, (d) => d.elevation);
        const pad = maxElev - minElev === 0 ? 50 : (maxElev - minElev) * 0.2;
        const y = d3.scaleLinear().domain([Math.max(0, minElev - pad), maxElev + pad]).range([height, 0]).nice();

        const slopeGradient = svg.append('defs').append('linearGradient').attr('id', 'slope-gradient')
            .attr('gradientUnits', 'userSpaceOnUse')
            .attr('x1', 0).attr('y1', 0).attr('x2', width).attr('y2', 0);
        data.forEach((d) => slopeGradient.append('stop')
            .attr('offset', `${(x(d.distance) / width) * 100}%`)
            .attr('stop-color', d.color));

        svg.append('g').attr('class', 'grid-line')
            .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSize(-width).tickFormat(''));

        svg.append('path').datum(data)
            .attr('fill', terrain)
            .attr('d', d3.area().x((d) => x(d.distance)).y0(height).y1((d) => y(d.elevation)).curve(d3.curveMonotoneX));

        svg.append('path').datum(data)
            .attr('fill', 'none').attr('stroke', 'url(#slope-gradient)')
            .attr('stroke-width', 3.5).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round')
            .attr('d', d3.line().x((d) => x(d.distance)).y((d) => y(d.elevation)).curve(d3.curveMonotoneX));

        // The same symbols as on the map, sitting on the profile line
        const marks = svg.append('g').attr('class', 'profile-stops');
        const k = narrow ? 1.3 : 1.5; // symbols a bit bigger here than on the map
        for (const s of stops) {
            const p = data[s.index];
            const size = stopSize(s.kind) * k;
            const g = marks.append('g')
                .attr('transform', `translate(${x(p.distance) - size / 2},${y(p.elevation) - size / 2}) scale(${k})`)
                .html(stopSvg(s.kind));
            g.append('title').text(s.name);
            if (s.kind === 'peak') {
                marks.append('text').attr('class', 'profile-peak-label')
                    .attr('x', Math.min(Math.max(x(p.distance), 60), width - 60)).attr('y', y(p.elevation) - 15)
                    .attr('text-anchor', 'middle').text(s.name);
            }
        }

        svg.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(x).ticks(narrow ? 4 : 8).tickSizeOuter(0).tickFormat((d) => `${d} ${distUnit()}`));
        svg.append('g')
            .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSizeOuter(0).tickFormat((d) => `${d} ${elevUnit()}`))
            .call((g) => g.select('.domain').remove());

        const hoverGroup = svg.append('g').style('display', 'none');
        hoverGroup.append('line').attr('y1', 0).attr('y2', height)
            .attr('stroke', C.hoverLine).attr('stroke-width', 1.5).attr('stroke-dasharray', '4 4');
        const hoverDot = hoverGroup.append('circle').attr('r', 6)
            .attr('fill', C.markerLight).attr('stroke', C.trail).attr('stroke-width', 2.5);

        const onMove = (event) => {
            const [px] = d3.pointer(event);
            const i = bisect.center(data, x.invert(px));
            const pt = event.touches?.[0] ?? event;
            syncHover(data[i], pt.pageX, pt.pageY, 'elevation');
        };
        // "You are here" on the profile (blue, like the dot on the map)
        const youGroup = svg.append('g').attr('class', 'you-marker').style('display', 'none');
        youGroup.append('line').attr('y1', 0).attr('y2', height);
        youGroup.append('circle').attr('r', 7);

        svg.append('rect').attr('width', width).attr('height', height).attr('fill', 'transparent')
            .on('mouseout touchend', () => syncHover(null))
            .on('mousemove touchmove', onMove);

        profile = { x, y, height, hoverGroup, hoverDot, youGroup };
        placeYou();
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

    drawProfile();
    let lastWidth = container.clientWidth;
    new ResizeObserver(() => {
        if (container.clientWidth !== lastWidth) {
            lastWidth = container.clientWidth;
            drawProfile();
        }
    }).observe(container);

    // --- 5. SYNCHRONIZED HOVER ---
    function syncHover(point, pageX, pageY, source) {
        const { x, y, hoverGroup, hoverDot } = profile;
        if (!point) {
            mapHoverDot.setStyle({ opacity: 0, fillOpacity: 0 });
            hoverGroup.style('display', 'none');
            tooltip.style.opacity = 0;
            return;
        }

        const snapRadius = totalDistance * APP_CONFIG.gravity[source];
        const nearby = waypoints.find((w) => Math.abs(w.point.distance - point.distance) <= snapRadius);
        if (nearby) point = nearby.point;

        mapHoverDot.setLatLng([point.lat, point.lon]).setStyle({ opacity: 1, fillOpacity: 1 });
        hoverGroup.style('display', null);
        hoverGroup.select('line').attr('x1', x(point.distance)).attr('x2', x(point.distance));
        hoverDot.attr('cx', x(point.distance)).attr('cy', y(point.elevation));

        tooltip.replaceChildren(
            ...(nearby ? [el('div', { className: 'tooltip-waypoint', textContent: nearby.name })] : []),
            el('div', { className: 'tooltip-elev', textContent: `${Math.round(point.elevation).toLocaleString('en')} ${elevUnit()}` }),
            el('div', { className: 'tooltip-meta', textContent: `${point.distance.toFixed(1)} ${distUnit()} · ${gradeText(point)}` }),
        );
        tooltip.style.opacity = 1;
        tooltip.style.left = `${pageX}px`;
        tooltip.style.top = `${pageY - 16}px`;
    }

    map.on('mousemove', (e) => {
        const closest = d3.least(data, (d) => Math.hypot(d.lat - e.latlng.lat, d.lon - e.latlng.lng));
        syncHover(closest, e.originalEvent.pageX, e.originalEvent.pageY, 'map');
    });
    map.on('mouseout', () => syncHover(null));

    return {
        map,
        /** Mark a track point as "you are here" on the profile (null hides it). */
        showOnProfile(index) {
            youIndex = index;
            placeYou();
        },
    };
}
