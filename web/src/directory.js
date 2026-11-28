// The main page (index.html):
// - desktop: the list in a panel on the left, the map filling the rest
// - phone: the map fills the screen, the list is a sheet you pull up from the bottom
// - tapping a trail picks it out (others light red, other rows dull) and shows a card;
//   swipe it for the hikes nearest to that one
// - search a place: hikes sorted nearest first; zoom/pan the map: hikes on screen first
// - location button: the hike(s) you're at stay bright red
// - offline: a small mark on downloaded / cached hikes, the rest faded, and an
//   "Offline" chip that can narrow the list to the hikes on this device

import './fonts.js';
import './styles/base.css';
import './styles/directory.css';

import { listHikes, SCOPES, el } from './lib/data.js';
import { setupProfileMenu, currentScope, switchScope, SCOPE_EVENT } from './lib/profile-menu.js';
import { renderBackdrop } from './lib/backdrop.js';
import { overviewMap } from './directory/overview-map.js';
import { distanceToHike } from './directory/place-search.js';
import { setupOverviewLocate } from './directory/overview-locate.js';
import { renderTotals, hikeRow, updateWalkTimes } from './directory/hike-rows.js';
import { onPaceChange } from './lib/pace.js';
import { createSheet } from './directory/sheet.js';
import { createPickCards } from './directory/pick-cards.js';
import { setupPlaceFinder } from './directory/place-finder.js';
import { APP_CONFIG } from './config.js';
import { BOOK_NAME } from './lib/edition.js';
import { setupCover } from './lib/cover.js';
import { setupErrorReports } from './lib/errors.js';
import { registerServiceWorker, setupInstallButton } from './lib/pwa.js';
import { watchForUpdates } from './lib/version.js';
import { keepFullScreen } from './lib/full-screen.js';
import { prepareOfflineStore, tidyUp, offlineStates, stateOf, CHANGE_EVENT } from './offline/offline-store.js';

setupErrorReports();
registerServiceWorker();
navigator.serviceWorker?.ready.then(async () => { await prepareOfflineStore(); await tidyUp(); });
watchForUpdates();
keepFullScreen();
setupInstallButton(document.getElementById('install'), document.getElementById('install-hint'));
// The version line goes at the very end of the list (it's added to the panel)
{
    const version = document.querySelector('#panel > .app-version');
    if (version) document.getElementById('panel-inner').append(version);
}

const list = document.getElementById('hike-list');
const panel = document.getElementById('panel');
const explore = document.querySelector('.explore');
const strip = document.getElementById('pick-strip');
const track = document.getElementById('pick-track');
const phone = window.matchMedia('(max-width: 899px)');

// What the parts of the page share (pick-cards.js reads it when a trail is tapped)
const page = {
    allHikes: [], // every hike you may see, newest first
    hikesById: new Map(),
    rowsById: new Map(), // their rows in the list
    visible: new Set(), // ids of the hikes in the current list (scope, and "only on this device" when on)
    overview: null, // the map (overview-map.js)
};

const sheet = createSheet({ panel, explore, phone }); // phones: the list pulled up from the bottom

// ---------- order of the list ----------
// base order: newest first, or nearest first after a place search.
// While the reader has zoomed/panned the map, hikes on screen come first
// (closest to the middle of the map first), then the rest by distance.
let baseOrder = [];
let mapView = null;

function applyOrder() {
    let ids = baseOrder;
    if (mapView) {
        const { center, inView } = mapView;
        ids = baseOrder
            .map((id) => ({ id, on: inView.has(id), d: distanceToHike(page.hikesById.get(id), center) }))
            .sort((a, b) => (b.on - a.on) || (a.d - b.d))
            .map((x) => x.id);
    }
    const now = [...list.children].map((r) => r.dataset.id);
    if (now.join() !== ids.join()) list.append(...ids.map((id) => page.rowsById.get(id)));
}

function setBaseOrder(ids) {
    baseOrder = ids;
    applyOrder();
}

// ---------- page ----------
function setBarHeight() {
    document.documentElement.style.setProperty('--bar-h', `${document.getElementById('site-bar').offsetHeight}px`);
}
setBarHeight();
window.addEventListener('resize', () => { setBarHeight(); sheet.set(sheet.state, { animate: false }); });
phone.addEventListener('change', () => sheet.set('mid', { animate: false }));

renderBackdrop(null, APP_CONFIG.indexBackground);
sheet.set('mid', { animate: false });
const cards = createPickCards({ strip, track, sheet, phone, page });

setupProfileMenu(document.getElementById('site-bar'));
setupCover();

// ---------- which list we're showing (profile menu: All hikes / My hikes / Shared with me) ----------
// The page is built once with every hike you may see; switching lists only
// hides rows and trails (no reload: the map and the open menu stay put).
const EMPTY = {
    all: 'No hikes yet. Add one with tools/new_hike.py, then run tools/build_hikes.py.',
    mine: "You don't have any hikes of your own yet.",
    shared: 'Nobody has shared a hike with you yet.',
};
const baseTitle = document.title;
let scopeIds = new Set(); // ids in the current scope
const shownHikes = () => page.allHikes.filter((h) => page.visible.has(h.id));
const emptyNote = el('p', { className: 'error', hidden: true });
list.before(emptyNote);
let scopeChip = null;
let locate = null;

async function setScope(scope, { first = false } = {}) {
    scopeIds = new Set((await listHikes(scope)).map((h) => h.id));
    page.visible = filterOffline(scopeIds);

    const { heading, title } = SCOPES[scope];
    document.querySelector('.panel-head h1').textContent = heading;
    document.title = scope === 'all' ? baseTitle : `${heading} · ${BOOK_NAME}`;
    scopeChip?.remove();
    scopeChip = null;
    if (scope !== 'all') {
        scopeChip = el('a', { className: 'scope-clear', href: './index.html' },
            el('span', { textContent: title }),
            el('span', { className: 'scope-x', ariaHidden: 'true', textContent: '×' }));
        scopeChip.title = 'Show all hikes';
        scopeChip.setAttribute('aria-label', `${title}: show all hikes instead`);
        scopeChip.addEventListener('click', (e) => { e.preventDefault(); switchScope('all'); });
        document.querySelector('.panel-head').after(scopeChip);
    }

    for (const [id, row] of page.rowsById) row.hidden = !page.visible.has(id);
    emptyNote.textContent = EMPTY[scope];
    emptyNote.hidden = page.visible.size > 0;
    renderTotals(shownHikes());
    if (!first) list.scrollTop = 0;
    page.overview?.setVisible(page.visible, { animate: !first });
    locate?.refresh();
}

listHikes('all')
    .then(async (hikes) => {
        page.allHikes = hikes;
        if (!hikes.length) {
            renderTotals(hikes);
            emptyNote.textContent = EMPTY.all;
            emptyNote.hidden = false;
            return;
        }
        const rows = new Map(hikes.map((h) => [h.id, hikeRow(h)]));
        for (const [id, row] of rows) row.dataset.id = id;
        page.rowsById = rows;
        page.hikesById = new Map(hikes.map((h) => [h.id, h]));
        list.append(...rows.values());
        baseOrder = hikes.map((h) => h.id);

        const overview = overviewMap(document.getElementById('overview-map'), hikes, cards.onPick, (view) => {
            mapView = view;
            applyOrder();
        }, {
            fullscreen: false, // the map already fills the screen here
            // what covers the map: the sheet (phone) or the panel on the left (desktop)
            // (plus the card, when one is showing)
            insets: () => {
                const cardH = strip.hidden ? 0 : strip.offsetHeight + 20;
                return phone.matches ? { bottom: sheet.height() + cardH } : { left: panel.offsetWidth + 12, bottom: cardH };
            },
        });
        page.overview = overview;
        for (const [id, row] of rows) {
            row.addEventListener('pointerenter', () => overview.highlight(id, true));
            row.addEventListener('pointerleave', () => overview.highlight(id, false));
        }
        setupPlaceFinder({
            hikes, rows, overview,
            isVisible: (id) => page.visible.has(id),
            setBaseOrder,
            forgetMapView: () => { mapView = null; },
        });

        const youStatus = document.getElementById('you-status');
        locate = setupOverviewLocate(overview, shownHikes, (text) => {
            youStatus.textContent = text ?? '';
            youStatus.hidden = !text;
        });

        await setScope(currentScope(), { first: true });
        window.addEventListener(SCOPE_EVENT, (e) => setScope(e.detail));
        // Walking times follow the pace set on a hike page (also when coming back with the back button)
        onPaceChange(() => updateWalkTimes(page.hikesById));
        window.addEventListener('pageshow', (e) => { if (e.persisted) updateWalkTimes(page.hikesById); });
    })
    .then(setupOffline)
    .catch((err) => list.append(el('p', { className: 'error', textContent: err.message })));

// ---------- offline: what's on this device ----------
// Marks: downloaded hikes always get a small arrow; offline, hikes that need
// internet fade. Cached hikes (opened before) look normal: no mark, not faded. The "Offline" chip (only shown
// offline) narrows the list and map to the hikes on this device.
let states = { downloaded: new Set(), cached: new Set() };
let onlySaved = false;
const offline = () => !navigator.onLine;

function filterOffline(ids) {
    if (!onlySaved || !offline()) return ids;
    return new Set([...ids].filter((id) => stateOf(states, id) !== 'none'));
}

const offlineChip = el('button', { type: 'button', className: 'offline-chip', hidden: true });
offlineChip.setAttribute('aria-pressed', 'false');

function renderOfflineChip() {
    offlineChip.hidden = !offline() || !page.allHikes.length;
    offlineChip.setAttribute('aria-pressed', String(onlySaved));
    offlineChip.replaceChildren(
        el('span', { className: 'offline-dot', ariaHidden: 'true' }),
        el('span', { textContent: onlySaved ? 'Offline · on this device' : 'Offline' }),
        onlySaved ? el('span', { className: 'scope-x', ariaHidden: 'true', textContent: '×' }) : null,
    );
    offlineChip.title = onlySaved ? 'Show all hikes' : 'Show only the hikes on this device';
}

function applyOffline() {
    document.documentElement.classList.toggle('is-offline', offline());
    for (const [id, row] of page.rowsById) {
        const state = stateOf(states, id);
        row.dataset.offline = state;
        const mark = row.querySelector('.offline-mark');
        mark.title = state === 'downloaded' ? 'Downloaded' : '';
        mark.setAttribute('aria-label', mark.title);
        mark.setAttribute('role', mark.title ? 'img' : 'presentation');
    }
    renderOfflineChip();
    const next = filterOffline(scopeIds);
    if ([...next].join() !== [...page.visible].join()) {
        page.visible = next;
        for (const [id, row] of page.rowsById) row.hidden = !page.visible.has(id);
        renderTotals(shownHikes());
        page.overview?.setVisible(page.visible);
        locate?.refresh();
    }
}

async function refreshStates() {
    states = await offlineStates();
    applyOffline();
}

function setupOffline() {
    if (!page.allHikes.length) return;
    document.querySelector('.panel-head').after(offlineChip);
    offlineChip.addEventListener('click', () => { onlySaved = !onlySaved; applyOffline(); });
    window.addEventListener('online', applyOffline);
    window.addEventListener('offline', applyOffline);
    window.addEventListener(CHANGE_EVENT, refreshStates);
    refreshStates();
}
