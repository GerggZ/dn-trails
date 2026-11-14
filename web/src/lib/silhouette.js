// A hike's elevation profile, cut out of the bottom of a picture.
//
// The picture layer gets a CSS mask shaped like the sky above the profile,
// so everything below the ridge is truly see-through (it shows the frosted
// page behind it), and a thin ridge line is drawn on top.

const NS = 'http://www.w3.org/2000/svg';

/**
 * @param {HTMLElement} art        the layer to cut (photo or dark block)
 * @param {number[]}    elevations evenly spaced elevation samples (m)
 * @param {object}      opts
 *   band    – fraction of the picture's height the mountain area may use (0..1)
 *   relief  – how much of that band the highest point reaches (0..1)
 * @returns {SVGElement} the ridge line, to place on top of `art`
 */
export function cutOut(art, elevations, { band = 0.45, relief = 0.85 } = {}) {
    const ridge = document.createElementNS(NS, 'svg');
    ridge.setAttribute('viewBox', '0 0 100 100');
    ridge.setAttribute('preserveAspectRatio', 'none');
    ridge.setAttribute('aria-hidden', 'true');
    ridge.setAttribute('class', 'ridge');
    if (!elevations?.length) return ridge;

    const min = Math.min(...elevations);
    const max = Math.max(...elevations);
    const range = Math.max(max - min, 250); // flat hikes stay flat-ish
    const bandHeight = 100 * band;
    const step = 100 / (elevations.length - 1);
    const pts = elevations.map((e, i) => {
        const y = 100 - ((e - min) / range) * bandHeight * relief - 0.8;
        return `${(i * step).toFixed(2)},${y.toFixed(2)}`;
    });

    // Mask = the sky: top edge, down the right side, along the ridge, up the left side
    const sky = `M0,0 L100,0 L${[...pts].reverse().join(' L')} Z`;
    const mask = `url("data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='${sky}' fill='black'/></svg>`,
    )}")`;
    for (const prop of ['maskImage', 'webkitMaskImage']) art.style[prop] = mask;

    const line = document.createElementNS(NS, 'path');
    line.setAttribute('d', `M${pts.join(' L')}`);
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    ridge.append(line);
    return ridge;
}

/** Evenly resample a track (distance, elevation arrays) to n points. */
export function resample(dist, ele, n = 120) {
    const total = dist[dist.length - 1];
    const out = [];
    let j = 0;
    for (let i = 0; i < n; i++) {
        const d = (total * i) / (n - 1);
        while (j < dist.length - 2 && dist[j + 1] < d) j++;
        const span = dist[j + 1] - dist[j] || 1;
        const t = Math.min(Math.max((d - dist[j]) / span, 0), 1);
        out.push(ele[j] + t * (ele[j + 1] - ele[j]));
    }
    return out;
}
