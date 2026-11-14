import * as d3 from 'd3';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { APP_CONFIG } from '../config.js';
import { dist, elev, distUnit, elevUnit } from '../lib/units.js';
import { el } from '../lib/data.js';

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
        color: slopeColor(smoothGrade[i]),
    }));

    // --- 2. WAYPOINTS (already snapped to a track point by the build script) ---
    const waypoints = hike.waypoints.map((wp) => ({ ...wp, point: data[wp.index] }));

    // --- 3. LEAFLET OVERHEAD MAP ---
    // Mouse wheel / trackpad over the map zooms the map instead of scrolling the page
    const map = L.map('map-container', { scrollWheelZoom: true, wheelPxPerZoomLevel: 90 }).fitBounds(hike.bbox, { padding: [30, 30] });

    const tiles = APP_CONFIG.mapTiles;
    L.tileLayer(tiles.url, { attribution: tiles.attribution, maxZoom: tiles.maxZoom }).addTo(map);

    // White casing under a red line, like a painted trail blaze
    const latlngs = data.map((d) => [d.lat, d.lon]);
    L.polyline(latlngs, { color: C.trailCasing, weight: 8, opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);
    L.polyline(latlngs, { color: C.trail, weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);

    waypoints.forEach((wp) => {
        L.circleMarker([wp.lat, wp.lon], {
            radius: 6, color: C.waypoint, weight: 3, fillColor: C.markerDark, fillOpacity: 1,
        }).bindTooltip(wp.name, { direction: 'top', offset: [0, -6] }).addTo(map);
    });

    const mapHoverDot = L.circleMarker([0, 0], {
        radius: 6, color: C.markerLight, weight: 2, fillColor: C.markerDark, fillOpacity: 1,
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
        // Colors follow the page palette (picked from the background photo)
        const css = getComputedStyle(document.documentElement);
        const terrain = css.getPropertyValue('--ink').trim() || C.terrain;
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

        svg.selectAll('.waypoint-marker').data(waypoints).enter().append('circle')
            .attr('class', 'waypoint-marker')
            .attr('cx', (wp) => x(wp.point.distance))
            .attr('cy', (wp) => y(wp.point.elevation))
            .attr('r', narrow ? 4 : 5)
            .attr('fill', terrain)
            .attr('stroke', C.waypoint)
            .attr('stroke-width', 2.5);

        svg.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(x).ticks(narrow ? 4 : 8).tickSizeOuter(0).tickFormat((d) => `${d} ${distUnit()}`));
        svg.append('g')
            .call(d3.axisLeft(y).ticks(narrow ? 4 : 5).tickSizeOuter(0).tickFormat((d) => `${d} ${elevUnit()}`))
            .call((g) => g.select('.domain').remove());

        const hoverGroup = svg.append('g').style('display', 'none');
        hoverGroup.append('line').attr('y1', 0).attr('y2', height)
            .attr('stroke', C.hoverLine).attr('stroke-width', 1.5).attr('stroke-dasharray', '4 4');
        const hoverDot = hoverGroup.append('circle').attr('r', 6)
            .attr('fill', C.markerLight).attr('stroke', C.markerDark).attr('stroke-width', 2);

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
            el('strong', { textContent: `${point.elevation.toFixed(0)} ${elevUnit()}` }),
            el('br'),
            `${point.distance.toFixed(2)} ${distUnit()}`,
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
