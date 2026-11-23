// "Where am I?" on a hike page: a locate button on the map, a blue dot with
// an accuracy circle, the matching spot on the elevation profile and a line
// of text saying how far along the trail you are.
//
// Browsers only share the location over https (or on localhost) and only
// after the reader allows it. GPS works without mobile data; the map
// background only shows where tiles were saved before (see offline.js).

import L from 'leaflet';

import { fmtDist, fmtElev, fmtWalk } from '../lib/units.js';
import { onPaceChange } from '../lib/pace.js';
import { hasTimes, hoursToEnd } from '../lib/walking-time.js';

const REMEMBER_KEY = 'hb-locate-on';
const ON_TRAIL_M = 120;      // closer than this (plus GPS accuracy) counts as "on the trail"
const NEAR_TRAIL_M = 5000;   // closer than this: still show where you'd join the trail
const DOT_COLOR = '#2A7FFF';

function haversineM(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
        + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, a)));
}

function nearestIndex(track, lat, lon) {
    const k = Math.cos((lat * Math.PI) / 180);
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < track.lat.length; i++) {
        const dx = (track.lon[i] - lon) * k;
        const dy = track.lat[i] - lat;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/** Climbing done up to each point (same 3 m noise filter as the build script). */
function cumulativeAscent(ele) {
    const out = new Array(ele.length).fill(0);
    let total = 0;
    let ref = ele[0];
    for (let i = 1; i < ele.length; i++) {
        const diff = ele[i] - ref;
        if (diff >= 3) { total += diff; ref = ele[i]; } else if (diff <= -3) { ref = ele[i]; }
        out[i] = total;
    }
    return out;
}

const locateIcon = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="currentColor"/><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2"/></svg>';

/**
 * @param hike  the hike data
 * @param view  what renderMapAndElevation returned ({ map, showOnProfile })
 * @param statusEl  element for the "you're 4.2 km in" line
 */
export function setupLocate(hike, { map, showOnProfile }, statusEl) {
    if (!('geolocation' in navigator)) return;

    const track = hike.track;
    const totalKm = track.dist_km[track.dist_km.length - 1];
    const ascent = cumulativeAscent(track.ele_m);
    const trailBounds = L.latLngBounds(hike.bbox);

    let watchId = null;
    let dot = null;
    let ring = null;
    let firstFix = true;
    let button = null;
    let lastPos = null;

    const say = (text) => {
        statusEl.hidden = !text;
        statusEl.textContent = text ?? '';
    };

    function onPosition(pos) {
        lastPos = pos;
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        const here = [lat, lon];

        if (!dot) {
            ring = L.circle(here, { radius: accuracy, color: DOT_COLOR, weight: 1, fillColor: DOT_COLOR, fillOpacity: 0.12, interactive: false }).addTo(map);
            dot = L.circleMarker(here, { radius: 7, color: '#FFFFFF', weight: 3, fillColor: DOT_COLOR, fillOpacity: 1, interactive: false }).addTo(map);
        } else {
            dot.setLatLng(here);
            ring.setLatLng(here).setRadius(accuracy);
        }

        const i = nearestIndex(track, lat, lon);
        const offM = haversineM(lat, lon, track.lat[i], track.lon[i]);
        const alongKm = track.dist_km[i];

        if (offM <= ON_TRAIL_M + Math.min(accuracy, 200)) {
            const climbLeft = ascent[ascent.length - 1] - ascent[i];
            const hoursLeft = hasTimes(hike) ? hoursToEnd(hike, i) : null;
            const timeLeft = hoursLeft != null && hoursLeft * 60 >= 2 ? ` (about ${fmtWalk(hoursLeft)} of walking)` : '';
            say(`You're on the trail: ${fmtDist(alongKm)} in, ${fmtDist(totalKm - alongKm)} to go${timeLeft}`
                + (climbLeft >= 10 ? `, about ${fmtElev(climbLeft)} of climbing left.` : '.'));
            showOnProfile(i);
        } else if (offM <= NEAR_TRAIL_M) {
            say(`You're ${fmtDist(offM / 1000)} from the trail. The nearest point is ${fmtDist(alongKm)} along it.`);
            showOnProfile(i);
        } else {
            say(`You're ${fmtDist(offM / 1000, 0)} away from this trail.`);
            showOnProfile(null);
        }

        // Move the map to you once, but only if you're somewhere near the trail
        if (firstFix) {
            firstFix = false;
            if (offM <= NEAR_TRAIL_M) map.fitBounds(trailBounds.extend(here), { padding: [30, 30], maxZoom: 16 });
        }
    }

    function onError(err) {
        if (err.code === err.PERMISSION_DENIED) {
            stop();
            try { localStorage.removeItem(REMEMBER_KEY); } catch { /* ignore */ }
            say('Location is blocked for this page. Allow it in your browser\'s site settings to see where you are.');
            return;
        }
        // Weak or lost signal: keep listening and keep showing the last known spot
        if (!dot) say('Still looking for your location… (works best outside with location services on)');
    }

    function start() {
        if (!window.isSecureContext) {
            say('Your location can only be shown when the book is opened over https.');
            return;
        }
        firstFix = true;
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
        lastPos = null;
        dot?.remove(); ring?.remove();
        dot = ring = null;
        showOnProfile(null);
        say(null);
        button?.classList.remove('active');
        button?.setAttribute('aria-pressed', 'false');
    }

    // The button, under the zoom controls
    const LocateControl = L.Control.extend({
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
            L.DomEvent.on(wrap, 'mousemove', L.DomEvent.stopPropagation); // no trail readout while over the button
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
    });
    map.addControl(new LocateControl());

    // Pace slider moved: say the time left again
    onPaceChange(() => { if (watchId != null && lastPos) onPosition(lastPos); });

    // Turned on last time and still allowed? Start right away.
    let remembered = false;
    try { remembered = localStorage.getItem(REMEMBER_KEY) === '1'; } catch { /* ignore */ }
    if (remembered && navigator.permissions?.query) {
        navigator.permissions.query({ name: 'geolocation' })
            .then((p) => { if (p.state === 'granted') start(); })
            .catch(() => {});
    }
}
