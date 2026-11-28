// The words and little icons of the readout: the tooltip while you scrub the
// profile, and the progress bar under it. Numbers come in as the profile has
// them (display units for heights on the profile, metres for climb totals).

import { elev, elevUnit } from '../../lib/units.js';
import { el } from '../../lib/data.js';
import { slopeColor } from './trail-data.js';

/** Climb and descent for the bar under the profile: "↑ 610 m  ↓ 120 m" (metres in). */
export function climbText(upM, downM) {
    const f = (m) => Math.round(elev(m)).toLocaleString('en');
    return `↑ ${f(upM)} ${elevUnit()}   ↓ ${f(downM)} ${elevUnit()}`;
}

/** Height difference to the start for the readout: "+430 m", "−120 m", "±0 m". */
export function fromStartText(diff) {
    const r = Math.round(diff);
    if (r === 0) return `±0 ${elevUnit()}`;
    return `${r > 0 ? '+' : '−'}${Math.abs(r).toLocaleString('en')} ${elevUnit()}`;
}

/** Steepness for the readout, without a sign ("12%" or "flat"): the wedge shows up or down. */
export function gradeText(point) {
    const g = Math.abs(Math.round(point.grade));
    return g < 1 ? 'flat' : `${g}%`;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgIcon(w, h, viewBox, inner) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', viewBox);
    svg.setAttribute('aria-hidden', 'true');
    svg.innerHTML = inner;
    return svg;
}

/**
 * Slope wedge for the readout: a small triangle rising (uphill) or falling
 * (downhill, high on the left) in the direction of walking, in the profile's
 * slope color. The angle is exaggerated ×3 (capped at 45°), so gentle trail
 * still shows a tilt; flat = a thin line.
 */
export function slopeWedge(gradePct) {
    const fill = slopeColor(gradePct);
    if (Math.abs(Math.round(gradePct)) < 1) {
        return svgIcon(14, 9, '0 0 18 10', `<path d="M1 8.2H17V9H1Z" fill="${fill}"/>`);
    }
    const angle = Math.min(Math.atan(Math.abs(gradePct) / 100) * 3, Math.PI / 4);
    const top = (9 - Math.min(Math.tan(angle) * 16, 8)).toFixed(2);
    const d = gradePct > 0 ? `M1 9H17V${top}Z` : `M1 ${top}L1 9H17Z`;
    return svgIcon(14, 9, '0 0 18 10', `<path d="${d}" fill="${fill}"/>`);
}

/** Height-from-start mark: the trailhead disc, a short line, then an arrow up or down. */
export function fromStartIcon(diff) {
    const up = diff >= 0;
    const base = up ? 9 : 3;
    return svgIcon(13, 11, '0 0 14 12',
        `<circle cx="3" cy="${base}" r="2.4" style="fill:var(--ink)"/>`
        + `<path d="M5.5 ${base}H8.5M10.5 ${base}V${up ? 2 : 10}" fill="none" stroke="currentColor" stroke-width="1.3"/>`
        + `<path d="M8.5 ${up ? 3.8 : 8.2}L10.5 ${up ? 1.6 : 10.4}L12.5 ${up ? 3.8 : 8.2}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>`);
}

/**
 * What the tooltip shows for a point: the waypoint's name (if the dot snapped to
 * one), the height, the steepness with its wedge and the height from the start.
 * @param {object} point     a track point (trail-data.js), heights in display units
 * @param {object|null} nearby  the waypoint the dot snapped to
 * @param {number} startElevation  height of the first point
 */
export function tooltipContent(point, nearby, startElevation) {
    const fromStart = point.elevation - startElevation;
    return [
        ...(nearby ? [el('div', { className: 'tooltip-waypoint', textContent: nearby.name })] : []),
        el('div', { className: 'tooltip-line' },
            el('span', { className: 'tooltip-elev', textContent: `${Math.round(point.elevation).toLocaleString('en')} ${elevUnit()}` }),
            el('div', { className: 'tooltip-meta' },
                el('div', {}, slopeWedge(point.grade), gradeText(point)),
                el('div', {}, fromStartIcon(fromStart), fromStartText(fromStart)),
            ),
        ),
    ];
}
