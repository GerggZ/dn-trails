import { test, expect } from 'vitest';
import { fmtDist, fmtElev } from '../../src/lib/units.js';

test('distances and heights (metric by default)', () => {
    expect(fmtDist(50.4)).toMatch(/^50[.,]4 km$/);
    expect(fmtElev(2566)).toMatch(/^2[,.]?566 m$/);
});
