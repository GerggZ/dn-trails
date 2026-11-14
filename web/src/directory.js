import './fonts.js';
import './styles/base.css';
import './styles/directory.css';

import { loadHikeIndex, asset, el } from './lib/data.js';
import { fmtDist, fmtElev, fmtDate } from './lib/units.js';
import { cutOut } from './lib/silhouette.js';
import { renderBackdrop } from './lib/backdrop.js';
import { scenery } from './lib/scenery.js';
import { APP_CONFIG } from './config.js';
import { registerServiceWorker, setupInstallButton } from './lib/pwa.js';
import { watchForUpdates } from './lib/version.js';

registerServiceWorker();
watchForUpdates();
setupInstallButton(document.getElementById('install'), document.getElementById('install-hint'));

const grid = document.getElementById('hike-grid');

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];

function renderTotals(hikes) {
    const km = hikes.reduce((sum, h) => sum + h.stats.distance_km, 0);
    const up = hikes.reduce((sum, h) => sum + h.stats.ascent_m, 0);
    const count = NUMBER_WORDS[hikes.length] ?? String(hikes.length);
    document.getElementById('totals').textContent =
        `${count} hike${hikes.length === 1 ? '' : 's'}, ${fmtDist(km, 0)} on foot and ${fmtElev(up)} of climbing so far.`;
}

function stat(value, label) {
    return el('div', { className: 'card-stat' },
        el('dd', { textContent: value }),
        el('dt', { textContent: label }),
    );
}

function hikeCard(h) {
    // The main photo if one was chosen, otherwise a landscape drawn from the hike's profile
    const art = el('div', { className: 'card-art' });
    art.append(h.cover ? el('img', { src: asset(h.cover), alt: '', loading: 'lazy' }) : scenery(h.profile, h.id));
    const ridge = cutOut(art, h.profile, { band: 0.45, relief: 0.75 });
    const visual = el('div', { className: 'card-visual' }, art, ridge);

    const when = [fmtDate(h.date), h.location].filter(Boolean).join(', ');

    const card = el('a', { href: `./hike.html?id=${encodeURIComponent(h.id)}`, className: 'hike-card' },
        visual,
        el('div', { className: 'card-body' },
            el('h2', { className: 'card-title', textContent: h.title }),
            when && el('p', { className: 'card-meta', textContent: when }),
            el('dl', { className: 'card-stats' },
                stat(fmtDist(h.stats.distance_km), 'distance'),
                stat(fmtElev(h.stats.ascent_m), 'climb'),
                stat(fmtElev(h.stats.max_elevation_m), 'highest'),
            ),
        ),
    );
    return card;
}

renderBackdrop(null, APP_CONFIG.indexBackground);

loadHikeIndex()
    .then((hikes) => {
        renderTotals(hikes);
        if (!hikes.length) {
            grid.append(el('p', { className: 'error', textContent: 'No hikes yet. Add one with tools/new_hike.py, then run tools/build_hikes.py.' }));
        }
        grid.append(...hikes.map(hikeCard));
    })
    .catch((err) => grid.append(el('p', { className: 'error', textContent: err.message })));
