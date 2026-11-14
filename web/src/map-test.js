// Temporary dev page (npm run dev → /map-test.html): try trail + stop colors,
// map types, page looks and slope colors on a real hike. Not part of the built book.
import './fonts.js';
import './styles/base.css';
import './styles/map-styles.css';
import './styles/map-controls.css';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { loadHikeIndex, loadHike } from './lib/data.js';
import { APP_CONFIG } from './config.js';

const css = document.createElement('style');
css.textContent = `
  :root { --paper:#F0D6E0; --ink:#151A2D; --accent:#B93727; --soft:#B56384; }
  body { min-height:100vh; background:linear-gradient(#FFB892,#FA9F95 40%,#CF9096) fixed; }
  body.mt-photo::before { content:''; position:fixed; inset:-20px; z-index:-1; background:var(--mt-photo) center/cover; filter:blur(3px); }
  body.mt-photo { background:var(--paper); }
  .mt-bar select { font:inherit; }
  .mt-bar { display:flex; flex-wrap:wrap; align-items:baseline; gap:8px 20px; padding:20px var(--gutter) 12px; font-family:var(--font-sign); }
  .mt-bar h1 { margin:0; font-size:var(--step-2, 1.6rem); }
  .mt-hint { font-size:var(--step--1); opacity:.75; }
  .mt-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:18px; padding:0 var(--gutter) 40px; }
  .mt-card { background:var(--glass); backdrop-filter:blur(22px) saturate(1.4); border-radius:var(--radius-sheet); overflow:hidden;
             border:1px solid color-mix(in srgb, var(--ink) 14%, transparent); }
  .mt-map { height:320px; }
  .mt-card .leaflet-control-attribution { font-size:9px; }
  .leaflet-tooltip.mt-label { background:none; border:0; box-shadow:none; padding:0 0 0 1px; margin:0;
      font-family:var(--font-sign); font-size:12.5px; font-weight:600; letter-spacing:.01em; color:var(--ink);
      text-shadow:0 0 2px var(--paper),0 0 2px var(--paper),0 0 3px var(--paper),0 0 4px var(--paper); }
  .leaflet-tooltip.mt-label::before { display:none; }
  .leaflet-tooltip.mt-label.mt-label-summit { font-size:13px; }
  .mt-symbol { background:none; border:0; }
  .mt-section { margin:8px 0 12px; padding:0 var(--gutter); font-family:var(--font-sign); font-size:var(--step-1, 1.3rem); }
  .mt-slopes { display:grid; gap:18px; padding:0 var(--gutter) 60px; }
  .mt-slope { background:var(--glass); backdrop-filter:blur(22px) saturate(1.4); border-radius:var(--radius-sheet); padding:14px 18px 12px;
              border:1px solid color-mix(in srgb, var(--ink) 14%, transparent); }
  .mt-slope h2 { margin:0 0 8px; font-family:var(--font-sign); font-size:var(--step-0); }
  .mt-profile { position:relative; }
  .mt-profile > svg { display:block; width:100%; height:150px; }
  .mt-pmark svg { display:block; width:auto; height:auto; }
  .mt-pmark { position:absolute; transform:translate(-50%,-50%); line-height:0; cursor:default; }
  .mt-pmark b { position:absolute; left:50%; bottom:100%; transform:translateX(-50%); margin-bottom:3px; white-space:nowrap;
      font-family:var(--font-sign); font-size:12.5px; font-weight:600; line-height:1.2; color:var(--ink);
      text-shadow:0 0 2px var(--paper),0 0 3px var(--paper),0 0 4px var(--paper); }
  .mt-inline { margin-left:16px; font-size:var(--step--1); font-weight:500; }
  .mt-legend { display:flex; gap:14px; flex-wrap:wrap; margin-top:8px; font-family:var(--font-sign); font-size:var(--step--1); }
  .mt-legend i { display:inline-block; width:22px; height:6px; border-radius:3px; margin-right:6px; vertical-align:middle; }
  .mt-card h2 { margin:0; padding:10px 16px 12px; font-family:var(--font-sign); font-size:var(--step-0); }
`;
document.head.append(css);

const SLOPE_SCHEMES = Object.entries(APP_CONFIG.slopeSchemes).map(([id, stops]) => ({
    name: id === APP_CONFIG.slopeScheme ? `${id} (in use)` : id,
    stops,
}));

function colorAt(stops, pct) {
    const g = Math.abs(pct);
    if (g <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
        const [g1, c1] = stops[i - 1];
        const [g2, c2] = stops[i];
        if (g <= g2) {
            const f = (g - g1) / (g2 - g1);
            const a = c1.match(/\w\w/g).map((h) => parseInt(h, 16));
            const b = c2.match(/\w\w/g).map((h) => parseInt(h, 16));
            return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
        }
    }
    return stops[stops.length - 1][1];
}

const FILLS = {
    relief: { fill: '#7A6A55' },
    'relief-fade': { fill: 'url(#fade)', fade: '#7A6A55' },
    olive: { fill: '#5F6A4C' },
    khaki: { fill: '#A39274' },
    pale: { fill: 'color-mix(in srgb, var(--ink) 12%, var(--paper))', outline: true },
    ink: { fill: 'var(--ink)' },
};

function renderSlopes(hike) {
    const box = document.getElementById('slopes');
    box.replaceChildren();
    const { dist_km: d, ele_m: e, grade_pct: gr } = hike.track;
    const n = d.length;
    const win = Math.max(1, Math.round(n / 120)); // smoothed like the real profile
    const smooth = gr.map((_, i) => {
        let s = 0, c = 0;
        for (let j = Math.max(0, i - win); j <= Math.min(n - 1, i + win); j++) { s += gr[j]; c++; }
        return s / c;
    });
    const W = 1000, H = 150, top = 22;
    const minE = Math.min(...e), maxE = Math.max(...e), total = d[n - 1];
    const X = (i) => (d[i] / total) * W;
    const Y = (i) => top + (1 - (e[i] - minE) / (maxE - minE || 1)) * (H - top - 8);
    const step = Math.max(1, Math.floor(n / 400));
    const idx = [];
    for (let i = 0; i < n; i += step) idx.push(i);
    if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
    const line = idx.map((i, k) => `${k ? 'L' : 'M'}${X(i).toFixed(1)},${Y(i).toFixed(1)}`).join('');
    const area = `${line}L${W},${H}L0,${H}Z`;
    const fill = FILLS[$('fill').value] ?? FILLS.relief;
    const ink = cssVar('--ink'), paper = cssVar('--paper');

    // The same symbols as on the map, placed on the profile line
    const peakI = e.indexOf(maxE);
    const loop = Math.hypot(hike.track.lat[0] - hike.track.lat[n - 1], hike.track.lon[0] - hike.track.lon[n - 1]) < 0.0015;
    const near = (i) => hike.waypoints.find((wp) => Math.abs(wp.index - i) <= Math.max(3, n / 200));
    const marks = [{ i: 0, kind: 'head', name: near(0)?.name ?? 'Start' }];
    if (!loop) marks.push({ i: n - 1, kind: 'end', name: near(n - 1)?.name ?? 'End' });
    marks.push({ i: peakI, kind: 'peak', name: `${near(peakI) ? `${near(peakI).name} · ` : ''}${Math.round(maxE).toLocaleString('en')} m` });
    const taken = new Set(marks.map((m) => near(m.i)).filter(Boolean));
    for (const wp of hike.waypoints) if (!taken.has(wp)) marks.push({ i: wp.index, kind: 'stop', name: wp.name });
    const symbol = {
        head: `<svg width="13" height="13" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" fill="${ink}" stroke="${paper}" stroke-width="2"/></svg>`,
        end: `<svg width="13" height="13" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4.5" fill="${paper}" stroke="${ink}" stroke-width="2.5"/></svg>`,
        peak: `<svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1.5 13 12.5H1z" fill="${ink}" stroke="${paper}" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
        stop: `<svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.3" fill="${paper}" stroke="${ink}" stroke-width="1.6"/></svg>`,
    };
    const markHtml = marks.map((m) => `<span class="mt-pmark mt-pmark-${m.kind}" title="${m.name}"
        style="left:${(X(m.i) / W * 100).toFixed(2)}%; top:${Y(m.i).toFixed(1)}px">${symbol[m.kind]}${m.kind === 'peak' ? `<b>${m.name}</b>` : ''}</span>`).join('');

    SLOPE_SCHEMES.forEach((scheme, s) => {
        const gid = `slope-grad-${s}`;
        const gradStops = idx.map((i) => `<stop offset="${(X(i) / W).toFixed(4)}" stop-color="${colorAt(scheme.stops, smooth[i])}"/>`).join('');
        const card = document.createElement('section');
        card.className = 'mt-slope';
        card.innerHTML = `<h2>${scheme.name}</h2>
            <div class="mt-profile">
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
              <defs><linearGradient id="${gid}" x1="0" x2="${W}" y1="0" y2="0" gradientUnits="userSpaceOnUse">${gradStops}</linearGradient>
                <linearGradient id="fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${fill.fade ?? '#000'}" stop-opacity="0.95"/><stop offset="1" stop-color="${fill.fade ?? '#000'}" stop-opacity="0.15"/></linearGradient></defs>
              <path d="${area}" fill="${fill.fill}"/>
              ${fill.outline ? `<path d="${line}" fill="none" stroke="var(--ink)" stroke-width="8" stroke-linejoin="round" vector-effect="non-scaling-stroke" opacity="0.85"/>` : ''}
              <path d="${line}" fill="none" stroke="url(#${gid})" stroke-width="5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
            </svg>${markHtml}</div>
            <div class="mt-legend">${scheme.stops.map(([g, c]) => `<span><i style="background:${c}"></i>${g}%</span>`).join('')}</div>`;
        box.append(card);
    });
}


// --- Trail + marker looks on the Dusk map ---
// casing = edge under the line, wp = waypoint dot (fill + ring), hover = the dot that follows your finger

// --- Trail options: two colors only. Line = trail color, stops = page ink, finger dot = hollow ring ---
// line 'accent' = the accent color of the selected look.
const TRAILS = [
    { name: 'NPS red', line: '#B30000' },
    { name: 'Deep forest green', line: '#2F6B3A' },
    { name: 'NPS scenic-trail green', line: '#1F991F' },
];

const HAND_LOOKS = [
    { name: 'National park: parchment & brick', tint: 'park', park: true,
      palette: { paper: '#EFE6D2', ink: '#2B241C', accent: '#8C2F1B', soft: '#8A7B5E' } },
    { name: 'National park: parchment & forest green', tint: 'park', park: true,
      palette: { paper: '#ECE6D3', ink: '#24291F', accent: '#3E5B3A', soft: '#8A7B5E' } },
    { name: 'Alpine stone (neutral, burnt orange)', tint: 'stone',
      palette: { paper: '#ECE7E1', ink: '#1F2A2E', accent: '#C2562B', soft: '#8C7B6B' } },
    { name: 'Ember & charcoal', tint: 'stone',
      palette: { paper: '#E9E4DE', ink: '#23201E', accent: '#D9622B', soft: '#9A8F86' } },
    { name: 'Forest & rust', tint: 'stone',
      palette: { paper: '#E6E9E1', ink: '#1E2B24', accent: '#B5552B', soft: '#7E8B73' } },
    { name: 'Glacier (cool grey, teal)', tint: 'stone',
      palette: { paper: '#E4EBEE', ink: '#18242C', accent: '#1A7F8E', soft: '#7C93A0' } },
];


const $ = (id) => document.getElementById(id);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let hike = null;
let maps = [];
let tint = 'dusk';

/** Which map + tint the panels show (Map dropdown). */
function mapChoice() {
    const v = $('map').value;
    if (v === 'stone' || v === 'park') return { layer: APP_CONFIG.mapLayers[0], look: v };
    const layer = APP_CONFIG.mapLayers.find((l) => l.id === v) ?? APP_CONFIG.mapLayers[0];
    if (layer.id === APP_CONFIG.mapLayers[0].id) return { layer, look: tint };
    return { layer, look: layer.look };
}


// --- Stops, drawn the way printed maps do it ---
const svgIcon = (svg, size) => L.divIcon({ className: 'mt-symbol', html: svg, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });

function drawStops(map, latlngs, dotStyle, ink) {
    const mode = $('stops').value;
    const paper = cssVar('--paper') || '#EFE6D2';
    const { ele_m: ele } = hike.track;
    const n = latlngs.length;
    const top = ele.indexOf(Math.max(...ele));
    const loop = map.distance(latlngs[0], latlngs[n - 1]) < 150;
    const label = (marker, text, cls = '') => {
        if (mode === 'symbols' || mode === 'ticks') {
            marker.bindTooltip(text, { permanent: true, direction: 'right', offset: [6, 0], className: `mt-label ${cls}` });
        } else {
            marker.bindTooltip(text);
        }
        return marker.addTo(map);
    };

    if (mode === 'dots') {
        for (const wp of hike.waypoints) L.circleMarker([wp.lat, wp.lon], dotStyle).bindTooltip(wp.name).addTo(map);
        return;
    }

    // Trailhead (start; also the end on a loop): ink disc with a paper ring
    const head = `<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" fill="${ink}" stroke="${paper}" stroke-width="2"/></svg>`;
    // End of a one-way hike: ink ring
    const end = `<svg width="14" height="14" viewBox="0 0 14 14"><circle cx="7" cy="7" r="4.5" fill="${paper}" stroke="${ink}" stroke-width="2.5"/></svg>`;
    // Highest point: small solid triangle, like a summit on a topo map
    const peak = `<svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 1.5 13 12.5H1z" fill="${ink}" stroke="${paper}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
    // Other stops: small open circle (or a tiny tick)
    const stop = mode === 'ticks'
        ? `<svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="2.2" fill="${ink}"/></svg>`
        : `<svg width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3.3" fill="${paper}" stroke="${ink}" stroke-width="1.6"/></svg>`;

    const used = new Set();
    const nearIndex = (i) => hike.waypoints.find((wp) => Math.abs(wp.index - i) <= Math.max(3, n / 200));
    const startWp = nearIndex(0);
    if (startWp) used.add(startWp);
    label(L.marker(latlngs[0], { icon: svgIcon(head, 14), keyboard: false }), startWp?.name ?? 'Start');
    if (!loop) {
        const endWp = nearIndex(n - 1);
        if (endWp) used.add(endWp);
        label(L.marker(latlngs[n - 1], { icon: svgIcon(end, 14), keyboard: false }), endWp?.name ?? 'End');
    }
    const topWp = nearIndex(top);
    if (topWp) used.add(topWp);
    label(L.marker(latlngs[top], { icon: svgIcon(peak, 14), keyboard: false }),
        `${topWp ? `${topWp.name} · ` : ''}${Math.round(ele[top]).toLocaleString('en')} m`, 'mt-label-summit');
    for (const wp of hike.waypoints) {
        if (used.has(wp)) continue;
        label(L.marker([wp.lat, wp.lon], { icon: svgIcon(stop, mode === 'ticks' ? 8 : 10), keyboard: false }), wp.name);
    }
}

function renderTrails() {
    const grid = $('trails');
    maps.forEach((m) => m.remove());
    grid.replaceChildren();
    const { lat, lon } = hike.track;
    const latlngs = lat.map((la, i) => [la, lon[i]]);
    const n = latlngs.length;
    const { layer, look } = mapChoice();
    const ink = cssVar('--ink') || '#1F2A2E';
    const accent = cssVar('--accent') || '#C2562B';
    const lineEdge = $('line-edge').checked;
    const stopEdge = true;
    const extraStop = hike.waypoints.length ? null : latlngs[Math.floor(n / 2)];

    maps = TRAILS.map((t) => {
        const card = document.createElement('section');
        card.className = 'mt-card';
        const box = document.createElement('div');
        box.className = look ? `mt-map map-style-${look}` : 'mt-map';
        const title = document.createElement('h2');
        title.textContent = t.name;
        card.append(box, title);
        $('trails').append(card);

        const map = L.map(box, { scrollWheelZoom: true, wheelPxPerZoomLevel: 90 }).fitBounds(hike.bbox, { padding: [20, 20] });
        map.attributionControl.setPrefix(false);
        L.tileLayer(layer.url, { maxZoom: layer.maxZoom, subdomains: layer.subdomains ?? 'abc', attribution: layer.attribution }).addTo(map);

        let line, stop, edge, stopStyle, fingerStyle;
        if (t.before) {
            line = '#C8102E'; edge = '#FFFFFF';
            stopStyle = { radius: 6, color: '#F2C14E', weight: 3, fillColor: '#17261F', fillOpacity: 1 };
            fingerStyle = { radius: 6, color: '#FFFFFF', weight: 2, fillColor: '#17261F', fillOpacity: 1 };
        } else {
            line = t.line === 'accent' ? accent : t.line === 'ink' ? ink : t.line;
            stop = t.stops === 'accent' ? accent : ink;
            edge = cssVar('--paper') || '#FFF7F0';
            stopStyle = t.open
                ? { radius: 5, color: stop, weight: 2, fillColor: edge, fillOpacity: 1 }            // open circle, like a map symbol
                : { radius: 5, color: edge, weight: stopEdge ? 1.5 : 0, stroke: stopEdge, fillColor: stop, fillOpacity: 1 };
            fingerStyle = { radius: 7, color: line, weight: 2.5, fillColor: edge, fillOpacity: 0.6 };
        }
        if (lineEdge || t.before) {
            L.polyline(latlngs, { color: edge, weight: t.dash ? 7 : 8, opacity: t.dash ? 0.75 : 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(map);
        }
        L.polyline(latlngs, { color: line, weight: t.weight ?? (t.dash ? 3 : 4), dashArray: t.dash ?? null,
            lineCap: t.dash && t.dash !== '1 7' ? 'butt' : 'round', lineJoin: 'round' }).addTo(map);
        drawStops(map, latlngs, stopStyle, ink);
        // the dot that follows your finger, shown a third of the way along
        L.circleMarker(latlngs[Math.floor(n / 3)], fingerStyle).addTo(map);
        return map;
    });

    let syncing = false;
    maps.forEach((a) => a.on('move', () => {
        if (syncing) return;
        syncing = true;
        maps.forEach((b) => { if (b !== a) b.setView(a.getCenter(), a.getZoom(), { animate: false }); });
        syncing = false;
    }));
}

async function setupLooks() {
    const select = $('look');
    let photos = [];
    try { photos = await (await fetch('data/backgrounds.json')).json(); } catch { /* none */ }
    const looks = [
        ...photos.map((p) => ({ name: `Photo: ${p.file}${p.file === APP_CONFIG.indexBackground ? ' (current)' : ''}`,
            tint: p.file === 'DSC_3651_1.JPG' ? 'dusk' : 'stone', palette: p.palette.light, photo: p.src })),
        ...HAND_LOOKS,
    ];
    looks.forEach((look, i) => select.append(new Option(look.name, i)));
    const park = looks.findIndex((l) => l.park);
    select.value = String(Math.max(0, park));
    const apply = () => {
        const look = looks[Number(select.value)];
        for (const [k, v] of Object.entries(look.palette)) document.documentElement.style.setProperty(`--${k}`, v);
        document.body.classList.toggle('mt-photo', Boolean(look.photo));
        document.body.style.setProperty('--mt-photo', look.photo ? `url("${look.photo}")` : 'none');
        tint = look.tint;
    };
    select.addEventListener('change', () => { apply(); if (hike) { renderTrails(); renderSlopes(hike); } });
    apply();
}

function setupMapChoice() {
    const select = $('map');
    for (const layer of APP_CONFIG.mapLayers) select.append(new Option(layer.name, layer.id));
    select.append(new Option('Stone (neutral tint)', 'stone'));
    select.append(new Option('Park (printed-map tint)', 'park'));
    select.addEventListener('change', () => hike && renderTrails());
    for (const id of ['line-edge', 'stops']) $(id).addEventListener('change', () => hike && renderTrails());
    $('fill').addEventListener('change', () => hike && renderSlopes(hike));
}

async function show(id) {
    hike = await loadHike(id);
    renderSlopes(hike);
    renderTrails();
}

setupMapChoice();
await setupLooks();
const hikeSelect = $('hike');
const hikes = await loadHikeIndex();
for (const h of hikes) hikeSelect.append(new Option(h.title, h.id));
hikeSelect.addEventListener('change', () => show(hikeSelect.value));
show(hikes[0].id);
