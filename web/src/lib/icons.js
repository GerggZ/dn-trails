// Small line icons for hike numbers (monochrome, drawn in the text color via CSS .fact-icon)

import { el } from './data.js';

const NS = 'http://www.w3.org/2000/svg';

const ICONS = {
    // trail length: arrow between two end bars
    distance: '<path d="M2 4v8M14 4v8M4.5 8h7M6.5 6l-2 2 2 2M9.5 6l2 2-2 2"/>',
    up: '<path d="M8 13V3M4 7l4-4 4 4"/>',
    down: '<path d="M8 3v10M4 9l4 4 4-4"/>',
    time: '<circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 1.5"/>',
    // how far from the searched place
    pin: '<path d="M8 14.5s4.5-4.2 4.5-8a4.5 4.5 0 0 0-9 0c0 3.8 4.5 8 4.5 8z"/><circle cx="8" cy="6.5" r="1.6"/>',
};

export function icon(name) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'fact-icon');
    svg.innerHTML = ICONS[name];
    return svg;
}

/** One number with its icon; the word is read out by screen readers and shown as a tooltip. */
export function fact(iconName, value, label) {
    return el('span', { className: 'fact', title: label },
        icon(iconName),
        el('span', { className: 'visually-hidden', textContent: `${label}: ` }),
        value,
    );
}
