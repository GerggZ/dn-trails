// "Where is Garmisch?" – asks OpenStreetMap's place search (Nominatim) and
// measures how far each hike is from the answer.
//
// Nominatim's rules: at most one search a second, no search-as-you-type
// (we only search when the reader presses Enter / the button).
// Needs internet; offline the caller shows a short message instead.

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/**
 * @returns {Promise<{lat:number, lon:number, name:string, label:string, bbox:number[][]|null} | null>}
 *          null when nothing was found; throws when OpenStreetMap can't be reached.
 */
export async function findPlace(query) {
    const params = new URLSearchParams({
        q: query,
        format: 'jsonv2',
        limit: '1',
        'accept-language': navigator.language || 'en',
    });
    const res = await fetch(`${ENDPOINT}?${params}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`OpenStreetMap answered ${res.status}`);
    const [hit] = await res.json();
    if (!hit) return null;
    const [s, n, w, e] = (hit.boundingbox ?? []).map(Number);
    return {
        lat: Number(hit.lat),
        lon: Number(hit.lon),
        name: hit.name || hit.display_name.split(',')[0],
        // "Garmisch-Partenkirchen, Bavaria, Germany": first part + the last two
        label: shortLabel(hit.display_name),
        bbox: Number.isFinite(s) ? [[s, w], [n, e]] : null,
    };
}

function shortLabel(displayName) {
    const parts = displayName.split(',').map((p) => p.trim()).filter((p) => !/^\d/.test(p));
    return parts.length <= 3 ? parts.join(', ') : [parts[0], ...parts.slice(-2)].join(', ');
}

/** Great-circle distance in km. */
export function km(a, b) {
    const R = 6371, toRad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toRad, dLon = (b[1] - a[1]) * toRad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

/** How far the closest bit of a hike's trail is from a point (km). */
export function distanceToHike(hike, point) {
    const pts = hike.line?.length ? hike.line : hike.bbox;
    return Math.min(...pts.map((p) => km(point, p)));
}
