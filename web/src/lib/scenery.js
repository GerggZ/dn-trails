// A generated landscape for hikes without a main photo.
//
// Layers of ridges made from the hike's own elevation profile (shifted,
// smoothed and roughened a little), fading into haze toward the back, under a
// sky in the page's colors. Seeded by the hike id, so every
// hike gets its own picture and it looks the same on every visit.

const NS = 'http://www.w3.org/2000/svg';

/** Small seeded random number generator (mulberry32). */
function rng(seedText) {
    let a = 0;
    for (const ch of seedText) a = (Math.imul(a ^ ch.charCodeAt(0), 2654435761) + 0x9e3779b9) >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function smooth(values, radius) {
    if (radius < 1) return values.slice();
    return values.map((_, i) => {
        let sum = 0, n = 0;
        for (let k = -radius; k <= radius; k++) {
            const v = values[i + k];
            if (v !== undefined) { sum += v; n++; }
        }
        return sum / n;
    });
}

function normalize(values) {
    const min = Math.min(...values);
    const range = Math.max(...values) - min || 1;
    return values.map((v) => (v - min) / range);
}

function el(tag, attrs = {}) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
}

/**
 * @param {number[]} profile  evenly spaced elevations of the hike
 * @param {string}   seed     the hike id
 * @returns {HTMLElement} a block that fills its (positioned) parent
 */
export function scenery(profile, seed) {
    const random = rng(seed);
    const wrap = document.createElement('div');
    wrap.className = 'scenery';

    const svg = el('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const n = 90;
    const base = normalize(profile.length > 1 ? profile : [0, 1, 0]);
    const sample = (i, shift) => {
        const x = ((i / (n - 1)) * (base.length - 1) + shift) % (base.length - 1);
        const j = Math.floor(x);
        return base[j] + (x - j) * ((base[j + 1] ?? base[j]) - base[j]);
    };

    // Back to front: farther ridges are higher, smoother and hazier
    const layers = [
        { top: 22, height: 26, smoothing: 6, rough: 0.10, mix: 22 },
        { top: 34, height: 24, smoothing: 4, rough: 0.14, mix: 40 },
        { top: 46, height: 22, smoothing: 2, rough: 0.18, mix: 62 },
        { top: 58, height: 20, smoothing: 1, rough: 0.22, mix: 84 },
    ];

    layers.forEach((layer, li) => {
        const shift = random() * (base.length - 1);
        const flip = random() < 0.5;
        let ys = Array.from({ length: n }, (_, i) => sample(flip ? n - 1 - i : i, shift));
        // a bit of jagged rock on top of the hike's own shape
        let wobble = 0;
        ys = ys.map((v) => {
            wobble = wobble * 0.6 + (random() - 0.5) * layer.rough;
            return v + wobble;
        });
        ys = normalize(smooth(ys, layer.smoothing));
        const pts = ys.map((v, i) => `${((i / (n - 1)) * 100).toFixed(2)},${(layer.top + (1 - v) * layer.height).toFixed(2)}`);
        const ridge = el('path', { d: `M0,100 L${pts.join(' L')} L100,100 Z` });
        // Nearer ridges are darker, farther ones melt into the sky
        ridge.style.fill = `color-mix(in srgb, var(--block) ${layer.mix}%, var(--sky-low))`;
        svg.append(ridge);

        // A soft band of mist in front of each far ridge
        if (li < layers.length - 1) {
            const mist = el('rect', { x: 0, y: layer.top + layer.height * 0.55, width: 100, height: 14, class: 'scenery-mist' });
            svg.append(mist);
        }
    });

    wrap.append(svg);
    return wrap;
}
