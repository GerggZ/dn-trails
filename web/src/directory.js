// The main page (index.html):
// - desktop: the list in a panel on the left, the map filling the rest
// - phone: the map fills the screen, the list is a sheet you pull up from the bottom
// - tapping a trail picks it out (others light red, other rows dull) and shows a card;
//   swipe it for the hikes nearest to that one
// - search a place: hikes sorted nearest first; zoom/pan the map: hikes on screen first
// - location button: the hike(s) you're at stay bright red

import './fonts.js';
import './styles/base.css';
import './styles/directory.css';

import { listHikes, SCOPES, asset, el } from './lib/data.js';
import { setupProfileMenu, currentScope } from './lib/profile-menu.js';
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
import { keepFullScreen } from './lib/full-screen.js';

registerServiceWorker();
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
const hikeUrl = (h) => `./hike.html?id=${encodeURIComponent(h.id)}`;
const phone = window.matchMedia('(max-width: 899px)');

function renderTotals(hikes) {
    const km = hikes.reduce((sum, h) => sum + h.stats.distance_km, 0);
    const up = hikes.reduce((sum, h) => sum + h.stats.ascent_m, 0);
    document.getElementById('totals').textContent =
        `${hikes.length} hike${hikes.length === 1 ? '' : 's'} · ${fmtDist(km, 0)} · ${fmtElev(up)} up`;
}

/** The picture (or generated landscape) with the profile cut out of its bottom. */
function visual(h, className) {
    const art = el('div', { className: 'card-art' });
    art.append(h.cover ? el('img', { src: asset(h.cover), alt: '', loading: 'lazy' }) : scenery(h.profile, h.id));
    const ridge = cutOut(art, h.profile, { band: 0.55, relief: 0.85 });
    return el('div', { className }, art, ridge);
}

const facts = (h) => [
    fact('distance', fmtDist(h.stats.distance_km), 'distance'),
    fact('up', fmtElev(h.stats.ascent_m), 'up'),
    fact('down', fmtElev(h.stats.descent_m), 'down'),
    fact('time', fmtWalk(h.stats.walking_time_h), 'walking time'),
];

/** One compact row: small picture, name, one line of numbers. */
function hikeRow(h) {
    return el('a', { href: hikeUrl(h), className: 'hike-row' },
        visual(h, 'hike-visual'),
        el('div', { className: 'hike-info' },
            el('h2', { className: 'hike-title', textContent: h.title }),
            el('p', { className: 'hike-away', hidden: true }),
            el('p', { className: 'hike-facts' }, facts(h)),
        ),
    );
}

// ---------- phone: the list as a sheet pulled up from the bottom ----------
// Three heights: 'min' (just the title), 'mid' (about half), 'max' (nearly all).

const sheet = {
    state: 'mid',
    px: 0, // the height it is at (or moving to)
    heights() {
        const H = explore.clientHeight;
        return { min: 92, mid: Math.round(H * 0.45), max: H - 48 };
    },
    height() { return phone.matches ? this.px : 0; },
    set(state, { animate = true } = {}) {
        this.state = state;
        if (!phone.matches) { panel.style.height = ''; updateInsets(); return; }
        panel.classList.toggle('no-anim', !animate);
        this.px = this.heights()[state];
        panel.style.height = `${this.px}px`;
        panel.dataset.state = state;
        explore.classList.toggle('list-full', state === 'max');
        document.getElementById('panel-grip').setAttribute('aria-label', state === 'max' ? 'Show less of the list' : 'Show more of the list');
        updateInsets();
    },
};

function updateInsets() {
    // the card sits just above the sheet on phones
    explore.style.setProperty('--sheet-h', `${Math.round(sheet.height())}px`);
}

function setupSheetDrag() {
    const grip = document.getElementById('panel-grip');
    const head = panel.querySelector('.panel-head');
    let start = null;

    const down = (e) => {
        if (!phone.matches) return;
        start = { y: e.clientY, h: panel.getBoundingClientRect().height, moved: false };
        panel.classList.add('no-anim');
        e.currentTarget.setPointerCapture(e.pointerId);
    };
    const move = (e) => {
        if (!start) return;
        const dy = e.clientY - start.y;
        if (Math.abs(dy) > 6) start.moved = true;
        const { min, max } = sheet.heights();
        sheet.px = Math.min(max, Math.max(min, start.h - dy));
        panel.style.height = `${sheet.px}px`;
        updateInsets();
    };
    const up = () => {
        if (!start) return;
        const { moved } = start;
        start = null;
        panel.classList.remove('no-anim');
        if (!moved) { // a tap: one step up, from the top back to the middle
            sheet.set({ min: 'mid', mid: 'max', max: 'mid' }[sheet.state]);
            return;
        }
        const h = panel.getBoundingClientRect().height;
        const hs = sheet.heights();
        const nearest = Object.entries(hs).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0][0];
        sheet.set(nearest);
    };
    for (const target of [grip, head]) {
        target.addEventListener('pointerdown', down);
        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', up);
        target.addEventListener('pointercancel', up);
    }
    // The grip is a button for keyboards too
    grip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sheet.set(sheet.state === 'max' ? 'mid' : 'max'); }
    });
}

// ---------- order of the list ----------
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
    const now = [...list.children].map((r) => r.dataset.id);
    if (now.join() !== ids.join()) list.append(...ids.map((id) => rowsById.get(id)));
}

function setBaseOrder(ids) {
    baseOrder = ids;
    applyOrder();
}

// ---------- search a place: hikes get sorted by how far away they are (none are hidden) ----------
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
        setBaseOrder(hikes.map((h) => h.id));
    }
    const clearButton = () => el('button', { type: 'button', className: 'place-clear', textContent: 'Clear', onclick: reset });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const query = input.value.trim();
        if (!query) { reset(); return; }
        if (busy) return;
        busy = true;
        input.blur(); // phones: put the keyboard away so the map shows
        say('Looking for ', el('strong', { textContent: query }), '…');
        try {
            const place = await findPlace(query);
            if (!place) {
                say('Couldn’t find ', el('strong', { textContent: query }), ' on the map. ', clearButton());
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
            mapView = null;
            setBaseOrder(sorted.map(({ h }) => h.id));
            overview.showPlace(place, sorted[0].h);
            say('Closest to ', el('strong', { textContent: place.label }), ' first. ', clearButton());
        } catch {
            say('Searching needs internet – couldn’t reach OpenStreetMap. ', clearButton());
        } finally {
            busy = false;
        }
    });
    input.addEventListener('search', () => { if (!input.value.trim()) reset(); });
}

// ---------- cards for a tapped trail ----------
// The tapped hike first, then the hikes nearest to it; swiping to a card picks
// that hike out on the map. Tapping another trail starts a new row of cards.

const NEAR_CARDS = 5; // how many nearby hikes follow the tapped one
const CLOSE_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ARROW_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

let overview = null;
let sheetBeforePick = null;
let cardIds = [];       // hikes in the row of cards, in order
let fromSwipe = false;  // the current pick came from swiping the cards

const centreOf = (h) => [(h.bbox[0][0] + h.bbox[1][0]) / 2, (h.bbox[0][1] + h.bbox[1][1]) / 2];

function card(h) {
    const away = rowsById.get(h.id).querySelector('.hike-away');
    return el('article', { className: 'pick-card' },
        visual(h, 'pick-visual'),
        el('div', { className: 'pick-info' },
            el('h2', { className: 'pick-title', textContent: h.title }),
            !away.hidden && el('p', { className: 'hike-away' }, ...[...away.childNodes].map((n) => n.cloneNode(true))),
            el('p', { className: 'hike-facts' }, facts(h)),
            el('div', { className: 'pick-actions' },
                el('a', { className: 'pill pick-open', href: hikeUrl(h), textContent: 'Open hike' }),
                el('button', { type: 'button', className: 'pick-zoom', textContent: 'Zoom to trail', onclick: () => overview.showHike(h.id) }),
            ),
        ),
        el('button', { type: 'button', className: 'pick-close', ariaLabel: 'Close', title: 'Close', innerHTML: CLOSE_SVG, onclick: () => overview.select(null) }),
    );
}

function buildCards(id) {
    const from = hikesById.get(id);
    const centre = centreOf(from);
    const near = [...hikesById.values()]
        .filter((h) => h.id !== id)
        .map((h) => ({ h, d: distanceToHike(h, centre) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, NEAR_CARDS)
        .map(({ h }) => h);
    cardIds = [id, ...near.map((h) => h.id)];
    track.replaceChildren(...[from, ...near].map((h) => {
        const c = card(h);
        c.dataset.id = h.id;
        return c;
    }));
    strip.hidden = false;
    track.scrollLeft = 0;
    updateSteps();
}

/** Which card is showing (the one snapped to the left edge). */
function currentCard() {
    const cards = [...track.children];
    const left = track.getBoundingClientRect().left;
    return cards.reduce((best, c) =>
        Math.abs(c.getBoundingClientRect().left - left - 10) < Math.abs(best.getBoundingClientRect().left - left - 10) ? c : best, cards[0]);
}

function updateSteps() {
    const i = cardIds.indexOf(currentCard()?.dataset.id);
    strip.querySelector('.pick-prev').hidden = i <= 0;
    strip.querySelector('.pick-next').hidden = i < 0 || i >= cardIds.length - 1;
}

function step(dir) {
    const cards = [...track.children];
    const i = cards.indexOf(currentCard());
    cards[Math.max(0, Math.min(cards.length - 1, i + dir))]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
}

function setupCards() {
    for (const [cls, dir] of [['.pick-prev', -1], ['.pick-next', 1]]) {
        const b = strip.querySelector(cls);
        b.innerHTML = ARROW_SVG;
        b.addEventListener('click', () => step(dir));
    }
    // When a swipe settles, the card showing becomes the picked hike
    let settle = null;
    track.addEventListener('scroll', () => {
        clearTimeout(settle);
        settle = setTimeout(() => {
            updateSteps();
            const id = currentCard()?.dataset.id;
            if (id && cardIds.includes(id)) {
                fromSwipe = true;
                overview.select(id);
                fromSwipe = false;
            }
        }, 120);
    }, { passive: true });
}

function onPick(id) {
    for (const [rid, row] of rowsById) {
        row.classList.toggle('dull', id != null && rid !== id);
        row.classList.toggle('picked', rid === id);
    }
    if (id == null) {
        strip.hidden = true;
        cardIds = [];
        if (sheetBeforePick) { sheet.set(sheetBeforePick); sheetBeforePick = null; }
        return;
    }
    if (fromSwipe) {
        overview.keepInView(id); // a swiped-to hike off screen: bring it in
    } else {
        buildCards(id);
    }
    if (phone.matches) {
        // phones: tuck the list away so the cards and the map have room
        if (!sheetBeforePick) sheetBeforePick = sheet.state;
        sheet.set('min');
    } else {
        rowsById.get(id).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
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
setupSheetDrag();
setupCards();

setupProfileMenu(document.getElementById('site-bar'));

// Which list we're showing (profile menu: All hikes / My hikes / Shared with me)
const scope = currentScope();
const EMPTY = {
    all: 'No hikes yet. Add one with tools/new_hike.py, then run tools/build_hikes.py.',
    mine: "You don't have any hikes of your own yet.",
    shared: 'Nobody has shared a hike with you yet.',
};
if (scope !== 'all') {
    document.querySelector('.panel-head h1').textContent = SCOPES[scope].heading;
    document.title = `${SCOPES[scope].heading} · Hiking Book`;
    const clear = el('a', { className: 'scope-clear', href: './index.html' },
        el('span', { textContent: SCOPES[scope].title }),
        el('span', { className: 'scope-x', ariaHidden: 'true', textContent: '×' }));
    clear.title = 'Show all hikes';
    clear.setAttribute('aria-label', `${SCOPES[scope].title}: show all hikes instead`);
    document.querySelector('.panel-head').after(clear);
}

listHikes(scope)
    .then((hikes) => {
        renderTotals(hikes);
        if (!hikes.length) {
            list.append(el('p', { className: 'error', textContent: EMPTY[scope] }));
            return;
        }
        const rows = new Map(hikes.map((h) => [h.id, hikeRow(h)]));
        for (const [id, row] of rows) row.dataset.id = id;
        rowsById = rows;
        hikesById = new Map(hikes.map((h) => [h.id, h]));
        list.append(...rows.values());
        baseOrder = hikes.map((h) => h.id);

        overview = overviewMap(document.getElementById('overview-map'), hikes, onPick, (view) => {
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
