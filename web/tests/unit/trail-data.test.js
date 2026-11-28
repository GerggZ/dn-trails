// What the hike page's map and profile are built from (src/hike/trail/trail-data.js)
// and the readout's words (src/hike/trail/readout.js).
import { describe, test, expect } from 'vitest';
import { readoutGrade, colorGrade, climbSoFar, trailData, ASCENT_NOISE_M } from '../../src/hike/trail/trail-data.js';
import { climbText, fromStartText, gradeText } from '../../src/hike/trail/readout.js';

/** A made-up track: one point every 10 m, height from `ele(km)` (m). */
function track(km, ele) {
    const dist_km = Array.from({ length: Math.round(km * 100) + 1 }, (_, i) => i / 100);
    return {
        dist_km,
        ele_m: dist_km.map(ele),
        lat: dist_km.map(() => 47.5),
        lon: dist_km.map((d) => 12.9 + d / 100),
    };
}

describe('readoutGrade', () => {
    test('an even 10 % climb reads 10 % everywhere', () => {
        const t = track(2, (d) => 1000 + d * 100);
        for (const g of readoutGrade(t.dist_km, t.ele_m)) expect(g).toBeCloseTo(10, 6);
    });

    test('downhill is negative, flat is 0', () => {
        const down = track(1, (d) => 2000 - d * 250);
        expect(readoutGrade(down.dist_km, down.ele_m)[50]).toBeCloseTo(-25, 6);
        const flat = track(1, () => 500);
        expect(readoutGrade(flat.dist_km, flat.ele_m).every((g) => g === 0)).toBe(true);
    });
});

describe('colorGrade', () => {
    test('an even slope keeps its steepness', () => {
        const t = track(2, (d) => 1000 + d * 80);
        const g = colorGrade(t.dist_km, readoutGrade(t.dist_km, t.ele_m));
        for (const v of g) expect(v).toBeCloseTo(8, 6);
    });

    test('a summit (steep up, steep down) stays steep instead of averaging out to flat', () => {
        const t = track(2, (d) => 1000 + 200 * (1 - Math.abs(d - 1)));
        const grade = readoutGrade(t.dist_km, t.ele_m);
        expect(grade[100]).toBeCloseTo(0, 6); // the readout at the top: flat
        expect(colorGrade(t.dist_km, grade)[100]).toBeGreaterThan(10); // the line color there: still warm (20 % flanks)
    });
});

describe('climbSoFar', () => {
    test('wiggles under the noise threshold are ignored', () => {
        expect(ASCENT_NOISE_M).toBe(3);
        const { upTo, downTo } = climbSoFar([100, 101, 102, 105, 103, 99, 99, 110]);
        expect([...upTo]).toEqual([0, 0, 0, 5, 5, 5, 5, 16]);
        expect([...downTo]).toEqual([0, 0, 0, 0, 0, 6, 6, 6]);
    });
});

describe('trailData', () => {
    const t = track(3, (d) => 800 + 300 * Math.sin(d));
    const hike = { track: t, waypoints: [{ name: 'Hut', index: 150 }] };
    const { data, waypoints, totalDistance, upTo, downTo } = trailData(hike);

    test('one point per track point, in display units (metric by default)', () => {
        expect(data).toHaveLength(t.dist_km.length);
        expect(totalDistance).toBeCloseTo(3, 9);
        expect(data[150]).toMatchObject({ index: 150, distance: 1.5, elevation: t.ele_m[150], lat: 47.5 });
        expect(typeof data[150].color).toBe('string');
    });

    test('waypoints sit on their track point', () => {
        expect(waypoints[0].name).toBe('Hut');
        expect(waypoints[0].point).toBe(data[150]);
    });

    test('climb and descent add up over the whole hike', () => {
        const last = data.length - 1;
        expect(upTo[last]).toBeGreaterThan(0);
        expect(upTo[last] - downTo[last]).toBeCloseTo(t.ele_m[last] - t.ele_m[0], -1); // within the noise threshold
    });
});

describe('readout words', () => {
    test('height from the start', () => {
        expect(fromStartText(0.3)).toBe('±0 m');
        expect(fromStartText(430.4)).toBe('+430 m');
        expect(fromStartText(-1200)).toBe('−1,200 m');
    });

    test('steepness without a sign', () => {
        expect(gradeText({ grade: 0.4 })).toBe('flat');
        expect(gradeText({ grade: -12.3 })).toBe('12%');
    });

    test('climb and descent', () => {
        expect(climbText(1610, 120)).toBe('↑ 1,610 m   ↓ 120 m');
    });
});
