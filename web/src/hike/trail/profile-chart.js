// The elevation profile of a hike page, drawn with d3 at the container's real
// pixel width (redrawn on resize, so the axis text stays readable on phones):
// the brown fill, the steepness-colored line, height lines, distance axis, the
// stop symbols, the finger / mouse dot and the blue "you are here" marker.
// render() redraws everything that depends on the visible stretch (state.view)
// and is cheap enough to run every frame while zooming or sliding.
// Gestures on the profile: profile-gestures.js.

import * as d3 from 'd3';

import { APP_CONFIG } from '../../config.js';
import { distUnit, elevUnit } from '../../lib/units.js';
import { stopSvg, stopSize } from './stops.js';
import { slopeColor } from './trail-data.js';

const C = APP_CONFIG.colors;

// Steepness line on the profile (see drawSlices / render)
const SLICE_STEP = 1.5; // px length of one slice
const SETTLE_MS = 150; // after the last zoom/slide frame, swap the quick line for the slices

/**
 * Draw the profile into `container` (replacing what was there). Call render() afterwards.
 * @param {HTMLElement} container
 * @param {HTMLElement} progress  the bar under the profile (lined up with the plot)
 * @param {object} ctx  see map-elevation.js: state, data, bisect, totalDistance, stops, isZoomed, syncHover, onRender
 * @returns {{ x, y, width, height, overlay, render: (moving?: boolean) => void, placeHover: () => void, placeYou: () => void }}
 *   overlay: the transparent rect on top that gets the pointer (profile-gestures.js)
 */
export function drawProfileChart(container, progress, ctx) {
    const { state, data, bisect, totalDistance, stops, isZoomed, syncHover, onRender } = ctx;
    const [minElev, maxElev] = d3.extent(data, (d) => d.elevation);
    const elevPad = maxElev - minElev === 0 ? 50 : (maxElev - minElev) * 0.2;

    container.replaceChildren();
    // Fill under the profile: shaded-relief brown, like hillshading on a park map
    const outerWidth = container.clientWidth || 900;
    const narrow = outerWidth < 560;
    const margin = { top: 12, right: 8, bottom: 30, left: narrow ? 46 : 56 };
    const width = outerWidth - margin.left - margin.right;
    progress.style.padding = `0 ${margin.right}px 0 ${margin.left}px`; // bar spans the plot, not the axis labels
    // Shorter when docked under the full-screen map, so the map gets the room
    // (the reader can drag it taller with the handle on top, full-screen-map.js)
    const outerHeight = state.full ? (narrow ? 150 : 180) + state.dockExtra : (narrow ? 190 : 230);
    const height = outerHeight - margin.top - margin.bottom;

    const svg = d3.select(container).append('svg')
        .attr('width', outerWidth)
        .attr('height', height + margin.top + margin.bottom)
        .append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleLinear().domain(state.view).range([0, width]);
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
    // The steepness line is drawn two ways:
    //  - at rest: thin slices cut square across the line, so the colors change
    //    along the line's own direction, also on steep climbs (drawSlices below)
    //  - while zooming / sliding: one path with a left-to-right gradient, much
    //    cheaper per frame; SETTLE_MS after the last frame it swaps back to slices
    const lineWidth = APP_CONFIG.profileLineWidth ?? 3.5;
    const linePath = plot.append('path')
        .attr('fill', 'none').attr('stroke', 'url(#slope-gradient)').style('display', 'none')
        .attr('stroke-width', lineWidth).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
    const sliceGroup = plot.append('g').attr('class', 'profile-slices')
        .attr('stroke-width', 0.6).attr('stroke-linejoin', 'round'); // hairline outline hides seams between slices
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
        // half its width, so the name can be kept inside the plot (not over the height labels)
        const half = label ? label.node().getComputedTextLength() / 2 + 2 : 0;
        return { s, g, label, half, size: stopSize(s.kind) * k };
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
    let settleTimer = null;
    function render(moving = false) {
        x.domain(state.view);
        const zoomed = isZoomed();
        // Not zoomed: let the trailhead symbols poke out a bit; zoomed: cut at the edges
        clipRect.attr('x', zoomed ? 0 : -24).attr('width', zoomed ? width : width + 48);
        slopeGradient.attr('x1', x(0)).attr('x2', x(totalDistance));

        // Only the visible points (plus one either side)
        const i0 = Math.max(0, bisect.left(data, state.view[0]) - 1);
        const i1 = Math.min(data.length, bisect.right(data, state.view[1]) + 1);
        const visible = data.slice(i0, i1);
        areaPath.attr('d', area(visible));
        clearTimeout(settleTimer);
        if (moving) {
            linePath.style('display', null).attr('d', line(visible));
            sliceGroup.style('display', 'none');
            settleTimer = setTimeout(() => render(), SETTLE_MS);
        } else {
            linePath.style('display', 'none');
            sliceGroup.style('display', null);
            drawSlices(visible);
        }

        for (const { s, g, label, half, size } of markEls) {
            const p = data[s.index];
            const px = x(p.distance);
            const show = px >= -size && px <= width + size;
            g.style('display', show ? null : 'none')
                .attr('transform', `translate(${px - size / 2},${y(p.elevation) - size / 2}) scale(${k})`);
            if (label) {
                label.style('display', px >= 0 && px <= width ? null : 'none')
                    .attr('x', Math.min(Math.max(px, half), width - half)).attr('y', y(p.elevation) - 15);
            }
        }

        // Distance: round numbers, plus the hike's total length when the end is in view
        // (round ticks too close to it are dropped so the labels don't overlap)
        const n = narrow ? 4 : 8;
        const fmt = x.tickFormat(n);
        let xTicks = x.ticks(n);
        const endInView = state.view[1] >= totalDistance - 1e-9;
        if (endInView) xTicks = [...xTicks.filter((d) => x(totalDistance) - x(d) >= endGapPx), totalDistance];
        xAxis.call(d3.axisBottom(x).tickValues(xTicks).tickSizeOuter(0)
            .tickFormat((d) => `${endInView && d === totalDistance ? endLabel : fmt(d)} ${distUnit()}`))
            .call((g) => g.selectAll('.tick').filter((d) => endInView && d === totalDistance)
                .classed('tick-end', true)
                .select('text').attr('text-anchor', 'end').attr('dx', '0.4em'));

        // "Whole hike" only when part of the hike is hidden
        document.querySelector('.profile-reset')?.toggleAttribute('hidden', !zoomed);
        onRender();
        keepDotInView();
        placeHover();
        placeYou();
    }

    // The line as thin slices (~SLICE_STEP px long) along the same smooth curve as
    // the fill, each cut square across the line and filled with the color of its
    // own steepness. d3's curve is traced into a recorder instead of a path
    // string, and its Bézier pieces are flattened into points.
    function drawSlices(visible) {
        const pts = [];
        let cx = 0, cy = 0;
        const rec = {
            moveTo(px, py) { pts.push([px, py]); cx = px; cy = py; },
            lineTo(px, py) {
                const n = Math.max(1, Math.ceil(Math.hypot(px - cx, py - cy) / SLICE_STEP));
                for (let j = 1; j <= n; j++) pts.push([cx + ((px - cx) * j) / n, cy + ((py - cy) * j) / n]);
                cx = px; cy = py;
            },
            bezierCurveTo(ax, ay, bx, by, px, py) {
                const len = Math.hypot(ax - cx, ay - cy) + Math.hypot(bx - ax, by - ay) + Math.hypot(px - bx, py - by);
                const n = Math.max(1, Math.ceil(len / SLICE_STEP));
                for (let j = 1; j <= n; j++) {
                    const t = j / n, u = 1 - t;
                    pts.push([
                        u * u * u * cx + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * px,
                        u * u * u * cy + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * py,
                    ]);
                }
                cx = px; cy = py;
            },
            closePath() {},
        };
        line.context(rec)(visible);
        line.context(null); // back to returning path strings (for linePath)
        if (pts.length < 2) { sliceGroup.html(''); return; }

        // Color at each point: the smoothed steepness at that distance, blended between track points
        const colors = pts.map(([px]) => {
            const d = x.invert(px);
            const i = Math.min(Math.max(bisect.right(data, d), 1), data.length - 1);
            const a = data[i - 1], b = data[i];
            const f = b.distance > a.distance ? Math.min(Math.max((d - a.distance) / (b.distance - a.distance), 0), 1) : 0;
            return slopeColor(a.colorGrade + (b.colorGrade - a.colorGrade) * f);
        });
        // Sideways offset at each point, from the direction on both sides, so neighbouring slices share an edge
        const half = lineWidth / 2;
        const off = pts.map((_, i) => {
            const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
            const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
            return [(-dy / len) * half, (dx / len) * half];
        });
        const r = (v) => v.toFixed(1);
        let html = '';
        for (let i = 0; i < pts.length - 1; i++) {
            const [ax, ay] = pts[i], [bx, by] = pts[i + 1], [nax, nay] = off[i], [nbx, nby] = off[i + 1];
            const c = colors[i];
            html += `<path d="M${r(ax + nax)},${r(ay + nay)}L${r(bx + nbx)},${r(by + nby)}L${r(bx - nbx)},${r(by - nby)}L${r(ax - nax)},${r(ay - nay)}Z" fill="${c}" stroke="${c}"/>`;
        }
        // Round ends, like the line's round caps
        const last = pts.length - 1;
        html += `<circle cx="${r(pts[0][0])}" cy="${r(pts[0][1])}" r="${half}" fill="${colors[0]}"/>`
            + `<circle cx="${r(pts[last][0])}" cy="${r(pts[last][1])}" r="${half}" fill="${colors[last - 1]}"/>`;
        sliceGroup.html(html);
    }

    // Zoomed in and the view moves past the dot: the dot is pushed along at the edge
    function keepDotInView() {
        if (!state.hover || !state.full || !isZoomed()) return;
        const inset = (6 / width) * (state.view[1] - state.view[0]);
        const lo = state.view[0] + inset;
        const hi = state.view[1] - inset;
        const d = state.hover.point.distance;
        if (d >= lo && d <= hi) return;
        const p = data[bisect.center(data, Math.min(Math.max(d, lo), hi))];
        const box = overlay.node().getBoundingClientRect();
        const pageX = box.left + window.scrollX + x(p.distance);
        const pageY = box.top + window.scrollY + y(p.elevation);
        syncHover(p, pageX, pageY, 'none', true);
    }

    function placeHover() {
        if (!state.hover) {
            hoverGroup.style('display', 'none');
            return;
        }
        const p = state.hover.point;
        hoverGroup.style('display', null);
        hoverGroup.select('line').attr('x1', x(p.distance)).attr('x2', x(p.distance));
        hoverDot.attr('cx', x(p.distance)).attr('cy', y(p.elevation));
    }

    function placeYou() {
        if (state.youIndex == null) {
            youGroup.style('display', 'none');
            return;
        }
        const p = data[state.youIndex];
        youGroup.style('display', null);
        youGroup.select('line').attr('x1', x(p.distance)).attr('x2', x(p.distance));
        youGroup.select('circle').attr('cx', x(p.distance)).attr('cy', y(p.elevation));
    }

    // On top of everything: catches the mouse and fingers (profile-gestures.js)
    const overlay = svg.append('rect').attr('width', width).attr('height', height).attr('fill', 'transparent');

    return { x, y, width, height, overlay, render, placeHover, placeYou };
}
