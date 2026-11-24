import './fonts.js';
import './styles/base.css';
import './styles/directory.css';

import { loadHikeIndex, asset, el } from './lib/data.js';
import { fmtDist, fmtElev, fmtWalk } from './lib/units.js';
import { cutOut } from './lib/silhouette.js';
import { renderBackdrop } from './lib/backdrop.js';
import { scenery } from './lib/scenery.js';
import { fact, icon } from './lib/icons.js';
import { overviewMap } from './lib/overview-map.js';
import { findPlace, distanceToHike } from './lib/place-search.js';
import { setupOverviewLocate } from './lib/overview-locate.js';
import { APP_CONFIG } from './config.js';
import { registerServiceWorker, setupInstallButton } from './lib/pwa.js';
import { watchForUpdates } from './lib/version.js';

registerServiceWorker();
watchForUpdates();
setupInstallButton(document.getElementById('install'), document.getElementById('install-hint'));

const list = document.getElementById('hike-list');
const hikeUrl = (h) => `./hike.html?id=${encodeURIComponent(h.id)}`;

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

function renderTotals(hikes) {
    const km = hikes.reduce((sum, h) => sum + h.stats.distance_km, 0);
    const up = hikes.reduce((sum, h) => sum + h.stats.ascent_m, 0);
    const count = NUMBER_WORDS[hikes.length] ?? String(hikes.length);
    document.getElementById('totals').textContent =
        `${count} hike${hikes.length === 1 ? '' : 's'}, ${fmtDist(km, 0)} on foot and ${fmtElev(up)} of climbing so far.`;
}

/** One hike: small picture on the left, name and numbers on the right. */
function hikeRow(h) {
    // The main photo if one was chosen, otherwise a landscape drawn from the hike's profile
    const art = el('div', { className: 'card-art' });
    art.append(h.cover ? el('img', { src: asset(h.cover), alt: '', loading: 'lazy' }) : scenery(h.profile, h.id));
    const ridge = cutOut(art, h.profile, { band: 0.55, relief: 0.85 });

    return el('a', { href: hikeUrl(h), className: 'hike-row' },
        el('div', { className: 'hike-visual' }, art, ridge),
        el('div', { className: 'hike-info' },
            el('h2', { className: 'hike-title', textContent: h.title }),
            // filled in when someone searches for a place: "38 km away"
            el('p', { className: 'hike-away', hidden: true }),
            h.location && el('p', { className: 'hike-place', textContent: h.location }),
            el('p', { className: 'hike-facts' },
                fact('distance', fmtDist(h.stats.distance_km), 'distance'),
                fact('up', fmtElev(h.stats.ascent_m), 'up'),
                fact('down', fmtElev(h.stats.descent_m), 'down'),
                fact('time', fmtWalk(h.stats.walking_time_h), 'walking time'),
            ),
        ),
    );
}

// --- Search for a place: hikes get sorted by how far away they are (none are hidden) ---
// --- Order of the list ---
// base order: newest first, or nearest first after a place search.
// While the reader has zoomed/panned the map, hikes on screen come first
// (closest to the middle of the map first), then the rest by distance.
let baseOrder = [];
let mapView = null;
let rowsById = new Map();
let hikesById = new Map();

function applyOrder() {
    let ids = baseOrder;
    if (mapView) {
        const { center, inView } = mapView;
        ids = baseOrder
            .map((id) => ({ id, on: inView.has(id), d: distanceToHike(hikesById.get(id), center) }))
            .sort((a, b) => (b.on - a.on) || (a.d - b.d))
            .map((x) => x.id);
    }
    // only touch the list if the order really changed (keeps hover / focus calm)
    const now = [...list.children].map((r) => r.dataset.id);
    if (now.join() !== ids.join()) list.append(...ids.map((id) => rowsById.get(id)));
}

function setBaseOrder(ids) {
    baseOrder = ids;
    applyOrder();
}

function setupFinder(hikes, rows, overview) {
    const form = document.getElementById('place-search');
    const input = document.getElementById('place-input');
    const status = document.getElementById('place-status');
    let busy = false;

    const say = (...parts) => {
        status.replaceChildren(...parts);
        status.hidden = parts.length === 0;
    };

    function reset() {
        input.value = '';
        say();
        overview.clearPlace();
        overview.showAll();
        for (const h of hikes) rows.get(h.id).querySelector('.hike-away').hidden = true;
        setBaseOrder(hikes.map((h) => h.id)); // back to newest first
    }
    const clearButton = () => el('button', { type: 'button', className: 'place-clear', textContent: 'Clear', onclick: reset });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const query = input.value.trim();
        if (!query) { reset(); return; }
        if (busy) return; // OpenStreetMap allows one search at a time
        busy = true;
        say('Looking for ', el('strong', { textContent: query }), '…');
        try {
            const place = await findPlace(query);
            if (!place) {
                say('Couldn\u2019t find ', el('strong', { textContent: query }), ' on the map. ', clearButton());
                return;
            }
            const point = [place.lat, place.lon];
            const sorted = hikes
                .map((h) => ({ h, d: distanceToHike(h, point) }))
                .sort((a, b) => a.d - b.d);
            for (const { h, d } of sorted) {
                const away = rows.get(h.id).querySelector('.hike-away');
                away.replaceChildren(icon('pin'), d < 1 ? 'right here' : `${fmtDist(d, d < 10 ? 1 : 0)} away`);
                away.hidden = false;
            }
            mapView = null; // the search decides the order again
            setBaseOrder(sorted.map(({ h }) => h.id));
            overview.showPlace(place, sorted[0].h);
            say('Closest to ', el('strong', { textContent: place.label }), ' first. ', clearButton());
        } catch {
            say('Searching needs internet \u2013 couldn\u2019t reach OpenStreetMap. ', clearButton());
        } finally {
            busy = false;
        }
    });

    // Emptying the box (or its little ×) puts everything back
    input.addEventListener('search', () => { if (!input.value.trim()) reset(); });
}

renderBackdrop(null, APP_CONFIG.indexBackground);

loadHikeIndex()
    .then((hikes) => {
        renderTotals(hikes);
        if (!hikes.length) {
            list.append(el('p', { className: 'error', textContent: 'No hikes yet. Add one with tools/new_hike.py, then run tools/build_hikes.py.' }));
            document.querySelector('.finder').hidden = true;
            return;
        }
        const rows = new Map(hikes.map((h) => [h.id, hikeRow(h)]));
        for (const [id, row] of rows) row.dataset.id = id;
        rowsById = rows;
        hikesById = new Map(hikes.map((h) => [h.id, h]));
        list.append(...rows.values());
        baseOrder = hikes.map((h) => h.id);

        // Clicking a trail on the map picks that hike out; the other rows go dull
        const overview = overviewMap(document.getElementById('overview-map'), hikes, (picked) => {
            for (const [id, row] of rows) row.classList.toggle('dull', picked != null && id !== picked);
        }, (view) => {
            // reader zoomed/panned: what's on the map comes first in the list
            mapView = view;
            applyOrder();
        });
        for (const [id, row] of rows) {
            row.addEventListener('pointerenter', () => overview.highlight(id, true));
            row.addEventListener('pointerleave', () => overview.highlight(id, false));
        }
        setupFinder(hikes, rows, overview);

        const youStatus = document.getElementById('you-status');
        setupOverviewLocate(overview, hikes, (text) => {
            youStatus.textContent = text ?? '';
            youStatus.hidden = !text;
        });
    })
    .catch((err) => list.append(el('p', { className: 'error', textContent: err.message })));
