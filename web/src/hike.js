import './fonts.js';
import './styles/base.css';
import './styles/hike.css';
import './styles/gallery.css';

import { getHike, asset, el, NotFound } from './lib/data.js';
import { setupProfileMenu } from './lib/profile-menu.js';
import { fmtDist, fmtElev, fmtDuration, fmtWalk } from './lib/units.js';
import { onPaceChange, paceSlider } from './lib/pace.js';
import { hasTimes, totalHours } from './lib/walking-time.js';
import { cutOut, resample } from './lib/silhouette.js';
import { scenery } from './lib/scenery.js';
import { renderBackdrop } from './lib/backdrop.js';
import { BOOK_NAME } from './lib/edition.js';
import { setupErrorReports } from './lib/errors.js';
import { registerServiceWorker } from './lib/pwa.js';
import { renderMapAndElevation } from './hike/map-elevation.js';
import { renderGallery } from './hike/gallery.js';
import { setupLocate } from './hike/locate.js';
import { setupOfflineSave } from './hike/offline.js';
import { watchForUpdates } from './lib/version.js';
import { keepFullScreen } from './lib/full-screen.js';
import { prepareOfflineStore } from './lib/offline-store.js';

setupErrorReports();
registerServiceWorker();
navigator.serviceWorker?.ready.then(prepareOfflineStore);
watchForUpdates();
keepFullScreen();

function renderHero(hike) {
    const hero = document.getElementById('hero');
    const art = el('div', { className: 'hero-art' });
    const profile = resample(hike.track.dist_km, hike.track.ele_m, 160);
    // The main photo if one was chosen, otherwise a landscape drawn from the hike's profile
    art.append(hike.cover_src ? el('img', { src: asset(hike.cover_src), alt: '' }) : scenery(profile, hike.id));
    hero.classList.toggle('hero-scenery', !hike.cover_src);
    const ridge = cutOut(art, profile, { band: 0.42, relief: 0.7 });
    hero.append(art, ridge);
}

function renderHeader(hike) {
    document.title = `${hike.title} – ${BOOK_NAME}`;
    document.getElementById('title').textContent = hike.title;
    document.getElementById('subtitle').textContent =
        hike.location || '';

    const s = hike.stats;
    // Estimated walking time at the reader's pace; older data: the GPX's clock time
    const timeStat = hasTimes(hike)
        ? ['walking time', fmtWalk(totalHours(hike)), 'walk-time']
        : ['time', fmtDuration(s.duration_h)];
    // No words on screen: every number explains itself (km, arrows, the peak's ▲ as on
    // the map and profile, "5h 50m" above the walking hiker). The labels stay for
    // screen readers only.
    const stats = [
        ['distance', fmtDist(s.distance_km)],
        // Climb and descent share one spot; the unit comes once
        ['climb and descent', `↑${fmtElev(s.ascent_m).replace(/\s*\S+$/, '')} ↓${fmtElev(s.descent_m)}`],
        ['highest point', fmtElev(s.max_elevation_m), null, 'peak'],
        timeStat,
    ].filter(([, value]) => value);

    const peakIcon = () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'stat-peak');
        svg.setAttribute('viewBox', '0 0 14 14');
        svg.setAttribute('aria-hidden', 'true');
        svg.innerHTML = '<path d="M7 1.5 13 12.5H1z"/>';
        return svg;
    };
    const statsEl = document.getElementById('stats');
    statsEl.append(...stats.map(([label, value, id, icon]) =>
        el('div', { className: 'stat' },
            el('dt', { className: 'visually-hidden', textContent: label }),
            el('dd', { ...(id ? { id } : {}) }, icon === 'peak' ? peakIcon() : null, value),
        )));

    if (hasTimes(hike)) {
        statsEl.after(paceSlider());
        onPaceChange(() => {
            const dd = document.getElementById('walk-time');
            if (dd) dd.textContent = fmtWalk(totalHours(hike));
        });
    }

    if (hike.description || hike.companions.length) {
        const box = document.getElementById('description');
        box.hidden = false;
        // Blank lines in the description become separate paragraphs
        hike.description.split(/\n\s*\n/).filter(Boolean)
            .forEach((p) => box.append(el('p', { textContent: p })));
        if (hike.companions.length) {
            box.append(el('p', { className: 'companions', textContent: `With ${andList(hike.companions)}.` }));
        }
    }
}

/** "Danna", "Danna and Neil", "Danna, Neil and Gregg" */
function andList(names) {
    return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const id = new URLSearchParams(window.location.search).get('id');
setupProfileMenu(document.querySelector('.site-bar'));

if (!id) {
    window.location.replace('./index.html');
} else {
    getHike(id)
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
            // No signal and this hike was never opened on this device: its data isn't here
            const notHere = !(err instanceof NotFound) && (!navigator.onLine || err instanceof TypeError);
            document.getElementById('title').textContent = notHere ? 'Not available offline' : 'Hike not found';
            document.getElementById('subtitle').textContent = notHere
                ? 'This hike isn’t on this device yet.'
                : err.message;
        });
}
