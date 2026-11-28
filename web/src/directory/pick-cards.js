// Tapping a trail on the main page's map: that hike's card, then the hikes
// nearest to it (swipe, or the arrows); swiping to a card picks that hike out on
// the map. Tapping another trail starts a new row of cards. The list rows of the
// other hikes go dull; on phones the list is tucked away while cards show.

import { el } from '../lib/data.js';
import { distanceToHike } from './place-search.js';
import { visual, facts, hikeUrl } from './hike-rows.js';

const NEAR_CARDS = 5; // how many nearby hikes follow the tapped one
const CLOSE_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const ARROW_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

/**
 * @param {object} o
 * @param {HTMLElement} o.strip  #pick-strip (the cards and their arrows)
 * @param {HTMLElement} o.track  #pick-track (the row of cards)
 * @param {ReturnType<import('./sheet.js').createSheet>} o.sheet
 * @param {MediaQueryList} o.phone
 * @param {{ hikesById: Map, rowsById: Map, visible: Set, overview: object }} o.page  read when needed
 * @returns {{ onPick: (id: string|null) => void }}  for the overview map: a trail was picked (null = none)
 */
export function createPickCards({ strip, track, sheet, phone, page }) {
    let sheetBeforePick = null;
    let cardIds = [];       // hikes in the row of cards, in order
    let fromSwipe = false;  // the current pick came from swiping the cards

    const centreOf = (h) => [(h.bbox[0][0] + h.bbox[1][0]) / 2, (h.bbox[0][1] + h.bbox[1][1]) / 2];

    function card(h) {
        const away = page.rowsById.get(h.id).querySelector('.hike-away');
        return el('article', { className: 'pick-card' },
            visual(h, 'pick-visual'),
            el('div', { className: 'pick-info' },
                el('h2', { className: 'pick-title', textContent: h.title }),
                !away.hidden && el('p', { className: 'hike-away' }, ...[...away.childNodes].map((n) => n.cloneNode(true))),
                el('p', { className: 'hike-facts' }, facts(h)),
                el('div', { className: 'pick-actions' },
                    el('a', { className: 'pill pick-open', href: hikeUrl(h), textContent: 'Open hike' }),
                    el('button', { type: 'button', className: 'pick-zoom', textContent: 'Zoom to trail', onclick: () => page.overview.showHike(h.id) }),
                ),
            ),
            el('button', { type: 'button', className: 'pick-close', ariaLabel: 'Close', title: 'Close', innerHTML: CLOSE_SVG, onclick: () => page.overview.select(null) }),
        );
    }

    function buildCards(id) {
        const from = page.hikesById.get(id);
        const centre = centreOf(from);
        const near = [...page.hikesById.values()]
            .filter((h) => h.id !== id && page.visible.has(h.id))
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
                    page.overview.select(id);
                    fromSwipe = false;
                }
            }, 120);
        }, { passive: true });
    }

    function onPick(id) {
        for (const [rid, row] of page.rowsById) {
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
            page.overview.keepInView(id); // a swiped-to hike off screen: bring it in
        } else {
            buildCards(id);
        }
        if (phone.matches) {
            // phones: tuck the list away so the cards and the map have room
            if (!sheetBeforePick) sheetBeforePick = sheet.state;
            sheet.set('min');
        } else {
            page.rowsById.get(id).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }

    setupCards();
    return { onPick };
}
