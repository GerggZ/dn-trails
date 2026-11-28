// What "Save for offline" decides before it downloads anything: which map pieces
// belong to a hike, how sizes read, and the three offline states.
import { describe, test, expect, vi } from 'vitest';

// The map library needs a browser; these tests only need the map addresses
vi.mock('leaflet', () => ({ default: { TileLayer: { extend: () => class {} }, tileLayer: () => ({}) } }));

const { fmtSize, tileUrls, tileKey, stateOf, LEVELS, offlineLayer } = await import('../../src/offline/offline-store.js');

// Uliari-Bira's outline (small hike) and Watzmann's (big one)
const SMALL = [[43.326223, -1.970841], [43.335162, -1.958087]];
const BIG = [[47.494105, 12.883422], [47.596672, 12.988018]];

describe('fmtSize', () => {
    test('reads like the Downloads page', () => {
        expect(fmtSize(200 * 1024)).toBe('< 1 MB');
        expect(fmtSize(68 * 1024 * 1024)).toBe('≈ 68 MB');
        expect(fmtSize(1.5 * 1024 * 1024 * 1024)).toBe('≈ 1.5 GB');
    });
});

describe('tileUrls', () => {
    test('stays under the piece limit of each level', () => {
        for (const bbox of [SMALL, BIG]) {
            for (const level of Object.values(LEVELS)) {
                const { urls, maxZ } = tileUrls(bbox, level);
                expect(urls.length).toBeGreaterThan(0);
                expect(urls.length).toBeLessThanOrEqual(level.maxTiles);
                expect(maxZ).toBeLessThanOrEqual(Math.min(level.topZoom, offlineLayer().maxZoom));
            }
        }
    });

    test('Max detail goes at least as deep as Standard', () => {
        for (const bbox of [SMALL, BIG]) {
            expect(tileUrls(bbox, LEVELS.max).maxZ).toBeGreaterThanOrEqual(tileUrls(bbox, LEVELS.standard).maxZ);
        }
    });

    test('starts at zoom 9 and has no duplicates', () => {
        const { urls } = tileUrls(SMALL, LEVELS.standard);
        expect(new Set(urls).size).toBe(urls.length);
        expect(urls.some((u) => u.includes('/9/'))).toBe(true);
        expect(urls.some((u) => u.includes('/8/'))).toBe(false);
    });
});

describe('tileKey', () => {
    test('a., b. and c. servers are one saved piece', () => {
        const a = tileKey('https://a.tile.opentopomap.org/9/1/2.png');
        expect(tileKey('https://b.tile.opentopomap.org/9/1/2.png')).toBe(a);
        expect(tileKey('https://c.tile.opentopomap.org/9/1/2.png')).toBe(a);
    });
});

describe('stateOf', () => {
    const states = { downloaded: new Set(['d']), cached: new Set(['c']) };
    test('downloaded / cached / none', () => {
        expect(stateOf(states, 'd')).toBe('downloaded');
        expect(stateOf(states, 'c')).toBe('cached');
        expect(stateOf(states, 'x')).toBe('none');
    });
});
