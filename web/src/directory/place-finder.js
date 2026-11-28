// "Where is Garmisch?" on the main page: the hikes get sorted by how far they
// are from the place (none are hidden), each row says how far, and the map
// shows the place. Clear (or an empty search) puts everything back.

import { el } from '../lib/data.js';
import { fmtDist } from '../lib/units.js';
import { icon } from './icons.js';
import { findPlace, distanceToHike } from './place-search.js';

/**
 * @param {object} o
 * @param {object[]} o.hikes  every hike on the page
 * @param {Map<string, HTMLElement>} o.rows  their list rows, by id
 * @param {object} o.overview  the overview map (overview-map.js)
 * @param {(id: string) => boolean} o.isVisible  is the hike in the current list?
 * @param {(ids: string[]) => void} o.setBaseOrder  order of the list
 * @param {() => void} o.forgetMapView  stop putting the hikes on screen first
 */
export function setupPlaceFinder({ hikes, rows, overview, isVisible, setBaseOrder, forgetMapView }) {
    // all of the hikes get sorted (rows not in the current list are hidden)
    const form = document.getElementById('place-search');
    const input = document.getElementById('place-input');
    const status = document.getElementById('place-status');
    let busy = false;

    // Narrow phones: the whole example doesn't fit next to the Search button
    const narrow = window.matchMedia('(max-width: 420px)');
    const hint = input.placeholder;
    const fitHint = () => { input.placeholder = narrow.matches ? 'A place, e.g. Garmisch' : hint; };
    narrow.addEventListener('change', fitHint);
    fitHint();

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
            forgetMapView();
            setBaseOrder(sorted.map(({ h }) => h.id));
            overview.showPlace(place, sorted.find(({ h }) => isVisible(h.id))?.h);
            say('Closest to ', el('strong', { textContent: place.label }), ' first. ', clearButton());
        } catch {
            say('Searching needs internet – couldn’t reach OpenStreetMap. ', clearButton());
        } finally {
            busy = false;
        }
    });
    input.addEventListener('search', () => { if (!input.value.trim()) reset(); });
}
