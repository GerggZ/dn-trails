// Stops drawn the way printed park maps do it, used on both the map and the
// elevation profile so the two always match:
//   trailhead  solid ink disc with a paper ring (start; also the end on a loop)
//   end        open ring (end of a one-way hike)
//   peak       small solid triangle at the highest point, labelled with its height
//   stop       small open circle (every other waypoint)

const NEAR_M = 150; // start and end closer than this = a loop

function metres(a, b) {
    const R = 6371000, toRad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * toRad, dLon = (b.lon - a.lon) * toRad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * @param hike  hike data (track + waypoints)
 * @param fmtHeight  (metres) => "1,930 m" in the reader's units
 * @returns [{ index, kind: 'head'|'end'|'peak'|'stop', name }]
 */
export function stopsFor(hike, fmtHeight) {
    const { lat, lon, ele_m: ele } = hike.track;
    const n = lat.length;
    const reach = Math.max(3, n / 200);
    const near = (i) => hike.waypoints.find((wp) => Math.abs(wp.index - i) <= reach);
    const used = new Set();
    const take = (i) => { const wp = near(i); if (wp) used.add(wp); return wp; };

    const loop = metres({ lat: lat[0], lon: lon[0] }, { lat: lat[n - 1], lon: lon[n - 1] }) < NEAR_M;
    const top = ele.indexOf(Math.max(...ele));
    const marks = [{ index: 0, kind: 'head', name: take(0)?.name ?? 'Start' }];
    if (!loop) marks.push({ index: n - 1, kind: 'end', name: take(n - 1)?.name ?? 'End' });
    const topWp = take(top);
    marks.push({ index: top, kind: 'peak', name: `${topWp ? `${topWp.name} · ` : ''}${fmtHeight(ele[top])}` });
    for (const wp of hike.waypoints) if (!used.has(wp)) marks.push({ index: wp.index, kind: 'stop', name: wp.name });
    return marks;
}

/** The symbol as inline SVG (colors follow the page: --ink and --paper). */
export function stopSvg(kind) {
    const ink = 'fill:var(--ink)', paper = 'fill:var(--paper)';
    switch (kind) {
        case 'head': return `<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" style="${ink};stroke:var(--paper);stroke-width:2"/></svg>`;
        case 'end': return `<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4.5" style="${paper};stroke:var(--ink);stroke-width:2.5"/></svg>`;
        case 'peak': return `<svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1.5 13 12.5H1z" style="${ink};stroke:var(--paper);stroke-width:1.2;stroke-linejoin:round"/></svg>`;
        default: return `<svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.3" style="${paper};stroke:var(--ink);stroke-width:1.6"/></svg>`;
    }
}

export const stopSize = (kind) => (kind === 'stop' ? 10 : 14);
