// A hike's track turned into what the map and the profile draw: one point per
// track point (display units, smoothed steepness, line color), the waypoints on
// those points, and the climb / descent up to every point.
// No drawing here (and no browser needed), so it can be unit tested.

import * as d3 from 'd3';
import { APP_CONFIG } from '../../config.js';
import { dist, elev } from '../../lib/units.js';

/** Color of the profile line for a steepness in % (up and down alike), from config.js slopeColors. */
export const slopeColor = (() => {
    const stops = APP_CONFIG.slopeColors;
    const scale = d3.scaleLinear()
        .domain(stops.map((s) => s[0]))
        .range(stops.map((s) => s[1]))
        .interpolate(d3.interpolateLab) // even blends, no muddy in-betweens
        .clamp(true);
    return (gradePct) => scale(Math.abs(gradePct));
})();

/** Wiggles smaller than this (m) don't count as climb or descent (same as tools/hikebook/metrics.py). */
export const ASCENT_NOISE_M = 3;

/** Shortest stretch the steepness is measured over (km), however short the hike. */
const MIN_WINDOW_KM = 0.08;

/**
 * Steepness in % at each track point, averaged over ~1/120 of the hike so it
 * reads as sections of trail rather than GPS flicker (the readout uses this).
 */
export function readoutGrade(distKm, eleM, windowKm = gradeWindow(distKm)) {
    return distKm.map((d) => {
        const lo = d3.bisectLeft(distKm, d - windowKm / 2);
        const hi = d3.bisectRight(distKm, d + windowKm / 2) - 1;
        const run = (distKm[hi] - distKm[lo]) * 1000;
        return run > 0 ? (100 * (eleM[hi] - eleM[lo])) / run : 0;
    });
}

/** The stretch readoutGrade measures over (km). */
export const gradeWindow = (distKm) => Math.max(distKm[distKm.length - 1] / 120, MIN_WINDOW_KM);

/**
 * Steepness for the line color: smoothed again over a longer stretch
 * (`smoothing`, a fraction of the hike), so the colors flow into each other
 * instead of flickering. Two passes of a moving average ≈ a soft (triangular)
 * blur. Averaged as steepness without direction (abs), so a summit — steep up,
 * steep down — stays warm instead of averaging out to "flat".
 */
export function colorGrade(distKm, grade, smoothing = APP_CONFIG.slopeSmoothing ?? 0.03, minSpan = gradeWindow(distKm)) {
    const span = Math.max(distKm[distKm.length - 1] * smoothing, minSpan);
    let g = grade.map(Math.abs);
    for (let pass = 0; pass < 2; pass++) {
        const prefix = [0];
        for (const v of g) prefix.push(prefix[prefix.length - 1] + v);
        g = distKm.map((d) => {
            const lo = d3.bisectLeft(distKm, d - span / 2);
            const hi = d3.bisectRight(distKm, d + span / 2);
            return (prefix[hi] - prefix[lo]) / Math.max(1, hi - lo);
        });
    }
    return g;
}

/**
 * Climb and descent (m) from the start up to each point, counted like the
 * stats (wiggles under ASCENT_NOISE_M ignored), so at the end they add up to
 * the hike's ascent / descent.
 */
export function climbSoFar(eleM) {
    const upTo = new Float64Array(eleM.length);
    const downTo = new Float64Array(eleM.length);
    let ref = eleM[0], up = 0, down = 0;
    for (let i = 1; i < eleM.length; i++) {
        const diff = eleM[i] - ref;
        if (diff >= ASCENT_NOISE_M) { up += diff; ref = eleM[i]; }
        else if (diff <= -ASCENT_NOISE_M) { down -= diff; ref = eleM[i]; }
        upTo[i] = up;
        downTo[i] = down;
    }
    return { upTo, downTo };
}

/**
 * Everything the map and profile need from the hike's data.
 * @returns {{ data: object[], waypoints: object[], totalDistance: number, upTo: Float64Array, downTo: Float64Array }}
 *   data: one point per track point, distance / elevation in display units
 *   waypoints: hike.waypoints, each with the `point` it sits on (snapped by the build script)
 *   totalDistance: length of the hike in display units
 */
export function trailData(hike) {
    const t = hike.track;
    const windowKm = gradeWindow(t.dist_km);
    const grade = readoutGrade(t.dist_km, t.ele_m, windowKm);
    const lineGrade = colorGrade(t.dist_km, grade, APP_CONFIG.slopeSmoothing ?? 0.03, windowKm);
    const data = t.dist_km.map((d, i) => ({
        index: i,
        distance: dist(d),
        elevation: elev(t.ele_m[i]),
        lat: t.lat[i],
        lon: t.lon[i],
        grade: grade[i],
        colorGrade: lineGrade[i],
        color: slopeColor(lineGrade[i]),
    }));
    return {
        data,
        waypoints: hike.waypoints.map((wp) => ({ ...wp, point: data[wp.index] })),
        totalDistance: dist(t.dist_km[t.dist_km.length - 1]),
        ...climbSoFar(t.ele_m),
    };
}
