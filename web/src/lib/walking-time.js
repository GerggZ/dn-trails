// Walking-time maths for the website.
//
// The build script (tools/hikebook/timing.py) works out how long the model's
// average walker takes for every stretch of the trail (track.time_s, cumulative
// seconds) and stores each stretch's slope and ground. Here that's adjusted to
// the reader's pace from the tortoise–hare slider (src/lib/pace.js):
//
//   speed = model speed × calibration × pace ^ strength(slope, ground)
//
//   pace         slider value / 100 (1 = average, 0.7 = tortoise, 1.45 = hare)
//   calibration  config pace.calibration: the model is a tinge fast, so the
//                average reader walks at e.g. 0.65 × its speed
//   strength     how much the reader's pace matters on this stretch (config
//                pace.strength by slope + pace.groundStrength by ground):
//                1 on climbs, about 0.5 on gentle descents, more again on steep ones
//
// So a tortoise loses most time on the climbs, a hare gains most there, and
// the middle of the slider is the same on every kind of trail.

import { APP_CONFIG } from '../config.js';
import { getPace } from './pace.js';

const cfg = () => ({
    calibration: 1,
    strength: [[0, 1]],
    groundStrength: {},
    ...APP_CONFIG.pace,
});

/** Does this hike have walking times? (data built before 2026-11-23 doesn't) */
export const hasTimes = (hike) => Array.isArray(hike.track?.time_s);

/** Blend between the [slope, strength] pairs (sorted by slope). */
function strengthAt(slopeDeg, table) {
    if (slopeDeg <= table[0][0]) return table[0][1];
    for (let k = 1; k < table.length; k++) {
        const [s1, w1] = table[k];
        if (slopeDeg <= s1) {
            const [s0, w0] = table[k - 1];
            return w0 + ((w1 - w0) * (slopeDeg - s0)) / (s1 - s0);
        }
    }
    return table[table.length - 1][1];
}

/** Ground type per stretch from [[first point, type], ...]. */
function groundPerStretch(runs, n) {
    const out = new Array(n).fill('path');
    (runs ?? []).forEach(([start, type], k) => {
        const end = k + 1 < runs.length ? runs[k + 1][0] : n;
        for (let i = start; i < Math.min(end, n); i++) out[i] = type;
    });
    return out;
}

// Per hike: how strongly the pace acts on each stretch (doesn't depend on the pace)
const strengths = new WeakMap();
function strengthsFor(hike) {
    if (!strengths.has(hike)) {
        const { strength, groundStrength } = cfg();
        const table = [...strength].sort((a, b) => a[0] - b[0]);
        const n = hike.track.time_s.length - 1; // stretches between points
        const slope = hike.track.slope_deg;     // missing in older data → full strength
        const ground = groundPerStretch(hike.track.ground, n);
        const w = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            w[i] = slope ? strengthAt(slope[i], table) + (groundStrength[ground[i]] ?? 0) : 1;
        }
        strengths.set(hike, w);
    }
    return strengths.get(hike);
}

// Per hike: hours from the start to each point at the last pace asked for
const cumulative = new WeakMap();
function hoursFromStart(hike) {
    const pace = getPace() / 100;
    const cached = cumulative.get(hike);
    if (cached?.pace === pace) return cached.hours;

    const { calibration } = cfg();
    const t = hike.track.time_s;
    const w = strengthsFor(hike);
    const hours = new Float64Array(t.length);
    for (let i = 1; i < t.length; i++) {
        const modelHours = (t[i] - t[i - 1]) / 3600;
        hours[i] = hours[i - 1] + modelHours / (calibration * pace ** w[i - 1]);
    }
    cumulative.set(hike, { pace, hours });
    return hours;
}

/** Hours of walking between two track points at the reader's pace. */
export function hoursBetween(hike, fromIndex, toIndex) {
    const h = hoursFromStart(hike);
    return h[toIndex] - h[fromIndex];
}

/** Hours from a track point to the end. */
export const hoursToEnd = (hike, index) => hoursBetween(hike, index, hike.track.time_s.length - 1);

/** The whole hike. */
export const totalHours = (hike) => hoursToEnd(hike, 0);
