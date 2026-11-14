import { APP_CONFIG } from '../config.js';

const BANDS = APP_CONFIG.elevationTints;

/** Color of the altitude band an elevation (m) falls into. */
export function tintAt(meters) {
    let color = BANDS[0][1];
    for (const [from, c] of BANDS) if (meters >= from) color = c;
    return color;
}

/**
 * Hard-edged gradient stops for a vertical range of elevations.
 * toOffset(m) must turn an elevation in meters into a 0..1 offset (0 = bottom).
 * Returns [{ offset, color }] ready to become <stop>s.
 */
export function bandStops(minM, maxM, toOffset) {
    const stops = [];
    let current = tintAt(minM);
    stops.push({ offset: 0, color: current });
    for (const [from, color] of BANDS) {
        if (from <= minM || from >= maxM) continue;
        const o = Math.min(Math.max(toOffset(from), 0), 1);
        stops.push({ offset: o, color: current }, { offset: o, color });
        current = color;
    }
    stops.push({ offset: 1, color: current });
    return stops;
}
