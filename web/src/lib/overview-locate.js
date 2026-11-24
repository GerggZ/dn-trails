// "Where am I?" on the index map: the same locate button and blue dot as on a
// hike page. When you're close to a hike, that trail stays bright red, the
// others turn light red, and a line under the search box says which hike it is.
//
// Same on/off memory as the hike pages (localStorage hb-locate-on): turned on
// there, it's on here too. Needs https (or localhost) and the reader's OK.

import L from 'leaflet';
import { distanceToHike } from './place-search.js';
import { fmtDist } from './units.js';

const REMEMBER_KEY = 'hb-locate-on';
const NEAR_KM = 1;          // this close to a trail (plus GPS accuracy) = "you're at this hike"
const DOT_COLOR = '#2A7FFF';

const locateIcon = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/></svg>';

/**
 * @param overview  what overviewMap() returned
 * @param hikes     entries of hikes.json
 * @param say       (text or null) => show a line under the search box
 */
export function setupOverviewLocate(overview, hikes, say) {
    if (!('geolocation' in navigator)) return;
    const { map } = overview;

    let watchId = null;
    let dot = null;
    let ring = null;
    let firstFix = true;
    let button = null;
    let nearIds = '';

    function onPosition(pos) {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        const here = [lat, lon];
        if (!dot) {
            ring = L.circle(here, { radius: accuracy, color: DOT_COLOR, weight: 1, fillColor: DOT_COLOR, fillOpacity: 0.12, interactive: false }).addTo(map);
            dot = L.circleMarker(here, { radius: 7, color: '#FFFFFF', weight: 3, fillColor: DOT_COLOR, fillOpacity: 1, interactive: false }).addTo(map);
        } else {
            dot.setLatLng(here);
            ring.setLatLng(here).setRadius(accuracy);
        }

        const reach = NEAR_KM + Math.min(accuracy, 500) / 1000;
        const dists = hikes.map((h) => ({ h, d: distanceToHike(h, here) })).sort((a, b) => a.d - b.d);
        const near = dists.filter(({ d }) => d <= reach).map(({ h }) => h);
        const ids = near.map((h) => h.id).join(',');

        if (ids !== nearIds || firstFix) {
            nearIds = ids;
            overview.focusHikes(near.map((h) => h.id));
            if (near.length === 1) say(`You're at ${near[0].title}.`);
            else if (near.length > 1) say(`You're near ${near.length} hikes: ${near.map((h) => h.title).join(', ')}.`);
            else say(`The closest hike is ${dists[0].h.title}, ${fmtDist(dists[0].d, dists[0].d < 10 ? 1 : 0)} away.`);
        }

        // Move the map once: to the hike(s) you're at, otherwise to you and the closest one
        if (firstFix) {
            firstFix = false;
            overview.fitTo(near.length ? near.map((h) => h.id) : [dists[0].h.id], here);
        }
    }

    function onError(err) {
        if (err.code === err.PERMISSION_DENIED) {
            stop();
            try { localStorage.removeItem(REMEMBER_KEY); } catch { /* ignore */ }
            say('Location is blocked for this page. Allow it in your browser’s site settings to see where you are.');
            return;
        }
        if (!dot) say('Still looking for your location… (works best outside with location services on)');
    }

    function start() {
        if (!window.isSecureContext) {
            say('Your location can only be shown when the book is opened over https.');
            return;
        }
        firstFix = true;
        nearIds = '';
        say('Finding you…');
        watchId = navigator.geolocation.watchPosition(onPosition, onError, {
            enableHighAccuracy: true, maximumAge: 10000, timeout: 30000,
        });
        button?.classList.add('active');
        button?.setAttribute('aria-pressed', 'true');
        try { localStorage.setItem(REMEMBER_KEY, '1'); } catch { /* private mode */ }
    }

    function stop() {
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
        watchId = null;
        dot?.remove(); ring?.remove();
        dot = ring = null;
        overview.focusHikes(null);
        say(null);
        button?.classList.remove('active');
        button?.setAttribute('aria-pressed', 'false');
    }

    // The button, under the home button (same look as on the hike map)
    map.addControl(new (L.Control.extend({
        options: { position: 'topleft' },
        onAdd() {
            const wrap = L.DomUtil.create('div', 'leaflet-bar locate-control');
            button = L.DomUtil.create('button', 'locate-button', wrap);
            button.type = 'button';
            button.title = 'Show my location';
            button.setAttribute('aria-label', 'Show my location');
            button.setAttribute('aria-pressed', 'false');
            button.innerHTML = locateIcon;
            L.DomEvent.disableClickPropagation(wrap);
            L.DomEvent.on(button, 'click', () => {
                if (watchId == null) {
                    start();
                } else {
                    try { localStorage.removeItem(REMEMBER_KEY); } catch { /* ignore */ }
                    stop();
                }
            });
            return wrap;
        },
    }))());

    // Turned on last time and still allowed? Start right away.
    let remembered = false;
    try { remembered = localStorage.getItem(REMEMBER_KEY) === '1'; } catch { /* ignore */ }
    if (remembered && navigator.permissions?.query) {
        navigator.permissions.query({ name: 'geolocation' })
            .then((p) => { if (p.state === 'granted') start(); })
            .catch(() => {});
    }
}
