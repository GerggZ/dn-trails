// How a hike looks in the main page's list (and on the cards for a tapped
// trail): the picture with the profile cut out of it, the name and one line of
// numbers. Plus the totals line above the list.

import { asset, el } from '../lib/data.js';
import { fmtDist, fmtElev, fmtWalk } from '../lib/units.js';
import { cardHours } from '../lib/walking-time.js';
import { cutOut } from '../lib/silhouette.js';
import { scenery } from '../lib/scenery.js';
import { fact } from './icons.js';

export const hikeUrl = (h) => `./hike.html?id=${encodeURIComponent(h.id)}`;

export function renderTotals(hikes) {
    const km = hikes.reduce((sum, h) => sum + h.stats.distance_km, 0);
    const up = hikes.reduce((sum, h) => sum + h.stats.ascent_m, 0);
    document.getElementById('totals').textContent =
        `${hikes.length} hike${hikes.length === 1 ? '' : 's'} · ${fmtDist(km, 0)} · ${fmtElev(up)} up`;
}

/** The picture (or generated landscape) with the profile cut out of its bottom. */
export function visual(h, className) {
    const art = el('div', { className: 'card-art' });
    art.append(h.cover ? el('img', { src: asset(h.cover), alt: '', loading: 'lazy' }) : scenery(h.profile, h.id));
    const ridge = cutOut(art, h.profile, { band: 0.55, relief: 0.85 });
    return el('div', { className }, art, ridge);
}

export const facts = (h) => [
    fact('distance', fmtDist(h.stats.distance_km), 'distance'),
    fact('up', fmtElev(h.stats.ascent_m), 'up'),
    fact('down', fmtElev(h.stats.descent_m), 'down'),
    fact('time', walkTime(h), 'walking time'),
];

// Downloaded: an arrow into a tray (cached hikes get no mark).
const SAVED_SVG = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 2.5v7M4.8 6.6 8 9.8l3.2-3.2M3 12.8h10"/></svg>';
export const offlineMark = () => el('span', { className: 'offline-mark', innerHTML: SAVED_SVG });

/** One compact row: small picture, name, one line of numbers. */
export function hikeRow(h) {
    return el('a', { href: hikeUrl(h), className: 'hike-row' },
        visual(h, 'hike-visual'),
        el('div', { className: 'hike-info' },
            el('h2', { className: 'hike-title' }, h.title, offlineMark()),
            el('p', { className: 'hike-away', hidden: true }),
            el('p', { className: 'hike-facts' }, facts(h)),
        ),
    );
}

// Walking time at the reader's pace (the tortoise–hare slider on a hike page)
function walkTime(h) {
    const span = el('span', { className: 'walk-time', textContent: fmtWalk(cardHours(h)) });
    span.dataset.id = h.id;
    return span;
}

/** The pace changed (or the reader came back from a hike page): show the new times. */
export function updateWalkTimes(hikesById) {
    for (const span of document.querySelectorAll('.walk-time[data-id]')) {
        const h = hikesById.get(span.dataset.id);
        if (h) span.textContent = fmtWalk(cardHours(h));
    }
}
