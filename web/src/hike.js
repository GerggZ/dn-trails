import './fonts.js';
import './styles/base.css';
import './styles/hike.css';
import './styles/gallery.css';

import { loadHike, asset, el } from './lib/data.js';
import { fmtDist, fmtElev, fmtDuration, fmtDate } from './lib/units.js';
import { cutOut, resample } from './lib/silhouette.js';
import { scenery } from './lib/scenery.js';
import { renderBackdrop } from './lib/backdrop.js';
import { APP_CONFIG } from './config.js';
import { registerServiceWorker } from './lib/pwa.js';
import { renderMapAndElevation } from './hike/map-elevation.js';
import { renderGallery } from './hike/gallery.js';
import { setupLocate } from './hike/locate.js';
import { setupOfflineSave } from './hike/offline.js';
import { watchForUpdates } from './lib/version.js';

registerServiceWorker();
watchForUpdates();

function renderHero(hike) {
    const hero = document.getElementById('hero');
    const art = el('div', { className: 'hero-art' });
    const profile = resample(hike.track.dist_km, hike.track.ele_m, 160);
    // The main photo if one was chosen, otherwise a landscape drawn from the hike's profile
    art.append(hike.cover_src ? el('img', { src: asset(hike.cover_src), alt: '' }) : scenery(profile, hike.id));
    const ridge = cutOut(art, profile, { band: 0.42, relief: 0.7 });
    hero.append(art, ridge);
}

function renderHeader(hike) {
    document.title = `${hike.title} – Hiking Book`;
    document.getElementById('title').textContent = hike.title;
    document.getElementById('subtitle').textContent =
        [fmtDate(hike.date), hike.location].filter(Boolean).join(', ');

    const s = hike.stats;
    const stats = [
        ['distance', fmtDist(s.distance_km)],
        ['climb', fmtElev(s.ascent_m)],
        ['descent', fmtElev(s.descent_m)],
        ['highest point', fmtElev(s.max_elevation_m)],
        ['time', fmtDuration(s.duration_h)],
        ['difficulty', hike.difficulty],
    ].filter(([, value]) => value);

    document.getElementById('stats').append(...stats.map(([label, value]) =>
        el('div', { className: 'stat' },
            el('dd', { textContent: value }),
            el('dt', { textContent: label }),
        )));

    if (hike.description || hike.companions.length) {
        const box = document.getElementById('description');
        box.hidden = false;
        // Blank lines in the description become separate paragraphs
        hike.description.split(/\n\s*\n/).filter(Boolean)
            .forEach((p) => box.append(el('p', { textContent: p })));
        if (hike.companions.length) {
            box.append(el('p', { className: 'companions', textContent: `With ${hike.companions.join(', ')}.` }));
        }
    }
}

const id = new URLSearchParams(window.location.search).get('id');

if (!id) {
    window.location.replace('./index.html');
} else {
    loadHike(id)
        .then(async (hike) => {
            await renderBackdrop(hike); // sets the page colors, so it goes first
            renderHero(hike);
            renderHeader(hike);
            const view = renderMapAndElevation(hike);
            setupLocate(hike, view, document.getElementById('you-status'));
            setupOfflineSave(hike, document.getElementById('save-offline'), document.getElementById('offline-status'));
            renderGallery(hike.photos);
        })
        .catch((err) => {
            document.getElementById('title').textContent = 'Hike not found';
            document.getElementById('subtitle').textContent = err.message;
        });
}
