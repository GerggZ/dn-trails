// The reader's walking pace (tortoise–hare slider): a percentage of an
// average hiker, kept in localStorage and shared by all hikes.
// The time calculations that use it are in walking-time.js.

import { APP_CONFIG } from '../config.js';
import { el } from './data.js';

const KEY = 'hb-pace';
const EVENT = 'hb-pace-change';
const cfg = () => ({ default: 100, min: 70, max: 145, step: 5, ...APP_CONFIG.pace });

export function getPace() {
    const { default: def, min, max } = cfg();
    let v = def;
    try { v = Number(localStorage.getItem(KEY) ?? def); } catch { /* private mode */ }
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
}

export function setPace(value) {
    try { localStorage.setItem(KEY, String(value)); } catch { /* private mode */ }
    window.dispatchEvent(new CustomEvent(EVENT));
}

export function onPaceChange(callback) {
    window.addEventListener(EVENT, callback);
    // Another tab or page changed it
    window.addEventListener('storage', (e) => { if (e.key === KEY) callback(); });
}

// Slider position 0…1000 ↔ pace: the left half runs from min to the default,
// the right half from the default to max, so "average" sits in the middle.
const POS_MAX = 1000;
const SNAP = 25; // near the middle it clicks into place

function paceToPos(p) {
    const { default: def, min, max } = cfg();
    return p <= def
        ? ((p - min) / (def - min)) * (POS_MAX / 2)
        : POS_MAX / 2 + ((p - def) / (max - def)) * (POS_MAX / 2);
}

function posToPace(pos) {
    const { default: def, min, max } = cfg();
    if (Math.abs(pos - POS_MAX / 2) <= SNAP) return def;
    const p = pos <= POS_MAX / 2
        ? min + (def - min) * (pos / (POS_MAX / 2))
        : def + (max - def) * ((pos - POS_MAX / 2) / (POS_MAX / 2));
    return Math.round(p);
}

// Only for screen readers; sighted readers see the animals and the time change
function paceText(p) {
    const def = cfg().default;
    if (p === def) return 'average pace';
    const pct = Math.round(Math.abs(p / def - 1) * 100);
    return p > def ? `${pct}% faster than average` : `${pct}% slower than average`;
}

const tortoise = '<svg viewBox="0 0 34 20" aria-hidden="true"><path d="M5 14.5C5 8 10 4 16 4s11 4 11 10.5z"/><circle cx="29.5" cy="12" r="2.8"/><rect x="7.5" y="14" width="3.4" height="4.5" rx="1.2"/><rect x="19.5" y="14" width="3.4" height="4.5" rx="1.2"/><path d="M5.5 13 2 14.8l3.6.6z"/></svg>';
const hare = '<svg viewBox="0 0 34 20" aria-hidden="true"><ellipse cx="14" cy="13" rx="9" ry="5.2"/><circle cx="24.5" cy="9.5" r="3.6"/><path d="M23 7.2c-1.6-3.6-1-6.6.6-6.4 1.4.2 1.6 3.3 1.3 6.2z"/><path d="M25.4 7c.2-3.8 1.9-6.3 3.3-5.7 1.3.6.2 3.6-1.6 6.3z"/><circle cx="4.6" cy="10.6" r="2.3"/><rect x="18" y="16" width="7" height="2.6" rx="1.3"/><rect x="7" y="16" width="5" height="2.6" rx="1.3"/></svg>';

const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, typeof v === 'number' ? v.toFixed(1) : v);
    return node;
};

// A shoe print pointing right (heel + sole), about 10 × 4.4 at scale 1
const SOLE = 'M3.6 -2.1C6.5 -2.9 9.6 -2.4 10.4 -0.6 11 0.8 9.8 2.2 6.8 2.4 4.9 2.5 3.6 2.1 3.6 2.1Z'
    + 'M0.2 -1.5C1.4 -2.2 2.8 -2 3 -1.2V1.4C2.6 2.1 1.1 2.2 0.2 1.6-0.6 0.9-0.6-0.8 0.2-1.5Z';

/**
 * The little hiker, standing on the ground line at x. t = 0 (tortoise) … 1 (hare):
 * the stride opens up and the hiker leans forward the faster it goes.
 */
function drawHiker(group, x, ground, t) {
    const leg = 4 + 9 * t;            // stride width
    const lean = 4 + 8 * t;           // degrees forward
    const hip = ground - 9;
    const hx = x + lean * 0.35;       // head / shoulders
    const hy = ground - 21;
    group.replaceChildren(
        svg('line', { class: 'hiker-limb', x1: x, y1: hip, x2: x - leg / 2, y2: ground }),
        svg('line', { class: 'hiker-limb', x1: x, y1: hip, x2: x + leg / 2, y2: ground }),
        svg('line', { class: 'hiker-limb', x1: x, y1: hip, x2: hx - 0.6, y2: hy + 5 }),
        svg('line', { class: 'hiker-pole', x1: hx - 0.2, y1: hy + 7, x2: x + leg / 2 + 3, y2: ground }),
        svg('rect', { class: 'hiker-fill', x: hx - 6.5, y: hy + 5, width: 4.2, height: 6.5, rx: 1.5, transform: `rotate(${lean.toFixed(0)} ${hx.toFixed(1)} ${(hy + 8).toFixed(1)})` }),
        svg('circle', { class: 'hiker-fill', cx: hx + 0.5, cy: hy + 1.8, r: 2.6 }),
    );
}

/**
 * The tortoise–hare slider: a little hiker walks along a path between the
 * two animals. Towards the hare it leans in and takes longer strides, and the
 * footprints it leaves behind get longer too. No text: the walking time in
 * the stats changes as you drag.
 */
export function paceSlider() {
    const input = el('input', {
        type: 'range', min: 0, max: POS_MAX, step: 1,
        value: Math.round(paceToPos(getPace())),
        className: 'pace-range',
    });
    input.setAttribute('aria-label', 'Your walking pace, from tortoise to hare');

    const scene = svg('svg', { class: 'pace-scene', 'aria-hidden': 'true' });
    const path = svg('line', { class: 'pace-ground' });
    const post = svg('line', { class: 'pace-post' });     // "average" in the middle
    const prints = svg('g', { class: 'pace-prints' });
    const hiker = svg('g', { class: 'pace-hiker' });
    scene.append(path, post, prints, hiker);
    const track = el('div', { className: 'pace-track' }, scene, input);

    const slow = el('span', { className: 'pace-icon pace-slow', innerHTML: tortoise });
    const fast = el('span', { className: 'pace-icon pace-fast', innerHTML: hare });
    const box = el('div', { className: 'pace' }, slow, track, fast);

    const HANDLE = 30; // px, width of the (invisible) range handle, see .pace-range in hike.css

    function update() {
        const w = track.clientWidth;
        const h = track.clientHeight;
        if (!w) return;
        const t = Number(input.value) / POS_MAX; // 0 = tortoise, 1 = hare
        const x = HANDLE / 2 + t * (w - HANDLE);
        const ground = h - 4;

        scene.setAttribute('viewBox', `0 0 ${w} ${h}`);
        for (const [k, v] of Object.entries({ x1: 4, x2: w - 4, y1: ground + 1.5, y2: ground + 1.5 })) path.setAttribute(k, v);
        for (const [k, v] of Object.entries({ x1: w / 2, x2: w / 2, y1: ground - 5, y2: ground + 1.5 })) post.setAttribute(k, v);

        // Footprints behind the hiker: stride 6 px (tortoise) … 17 px (hare), older ones fade
        prints.replaceChildren();
        let px = 6;
        let left = true;
        while (px < x - 10) {
            const f = px / w;
            const scale = 0.5 + 0.3 * f;
            const y = ground - 2 + (left ? -2 : 2);
            prints.append(svg('path', {
                d: SOLE,
                transform: `translate(${px.toFixed(1)},${y.toFixed(1)}) scale(${scale.toFixed(2)}${left ? `,-${scale.toFixed(2)}` : ''}) translate(-5,0)`,
                opacity: (0.2 + 0.55 * (px / Math.max(x, 1))).toFixed(2),
            }));
            px += 6 + f * 11;
            left = !left;
        }
        drawHiker(hiker, x, ground, t);

        box.style.setProperty('--t', t.toFixed(3)); // the animal you're closer to stands out
        input.setAttribute('aria-valuetext', paceText(posToPace(Number(input.value))));
    }

    input.addEventListener('input', () => {
        const pace = posToPace(Number(input.value));
        if (pace === cfg().default) input.value = POS_MAX / 2; // click into the middle
        update();
        setPace(pace);
    });
    // Double-click / double-tap: back to average
    input.addEventListener('dblclick', () => {
        input.value = POS_MAX / 2;
        input.dispatchEvent(new Event('input'));
    });
    // Another hike page (or tab) changed the pace
    window.addEventListener('storage', (e) => {
        if (e.key === KEY) { input.value = Math.round(paceToPos(getPace())); update(); }
    });

    new ResizeObserver(update).observe(track);
    return box;
}
