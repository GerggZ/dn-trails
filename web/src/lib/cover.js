// The book's cover page (the wedding book: wedding_hikes/_cover/, made into
// data/cover.json by tools/build_hikes.py). Shown over the main page the first
// time the book is opened in a session, and again from the menu ("Cover page")
// or with index.html?cover. A book without a cover (the public one) has none.

import { asset, el } from './data.js';
import { BOOK_NAME } from './edition.js';

const SEEN_KEY = 'hb-cover-seen';
let coverPromise;

/** data/cover.json, or null when the book has no cover. */
export function loadCover() {
    coverPromise ??= fetch(asset('data/cover.json'))
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    return coverPromise;
}

/** Main page: show the cover if it wasn't seen yet this session (or ?cover is in the address). */
export async function setupCover() {
    const cover = await loadCover();
    if (!cover) return;
    const params = new URLSearchParams(window.location.search);
    const asked = params.has('cover');
    if (asked) {
        params.delete('cover');
        const query = params.toString();
        history.replaceState(history.state, '', window.location.pathname + (query ? `?${query}` : ''));
    }
    let seen = false;
    try { seen = sessionStorage.getItem(SEEN_KEY) === '1'; } catch { /* ignore */ }
    if (asked || !seen) showCover(cover);
}

/** Show the cover now (menu: "Cover page" on the main page). */
export async function openCover() {
    const cover = await loadCover();
    if (cover) showCover(cover);
}

function showCover(cover) {
    if (document.querySelector('.cover')) return;
    const logo = document.querySelector('.home-logo')?.getAttribute('src');
    const title = cover.title || BOOK_NAME;
    const open = el('button', { type: 'button', className: 'pill cover-open', textContent: 'Open the book' });
    const page = el('section', { className: 'cover', role: 'dialog', ariaLabel: title },
        el('div', { className: 'cover-page' },
            logo ? el('img', { className: 'cover-logo', src: logo, alt: '' }) : null,
            el('h1', { className: 'cover-title', textContent: title }),
            cover.subtitle ? el('p', { className: 'cover-subtitle', textContent: cover.subtitle }) : null,
            cover.photo
                ? el('img', { className: 'cover-photo', src: asset(cover.photo.src), alt: '', width: cover.photo.width, height: cover.photo.height })
                : null,
            (cover.message || '').split(/\n\s*\n/).filter(Boolean)
                .map((p) => el('p', { className: 'cover-message', textContent: p })),
            open,
        ));
    page.setAttribute('aria-modal', 'true');
    document.body.append(page);
    document.documentElement.classList.add('cover-showing');
    // Keyboard users start on the button; on touch screens that would only draw a focus ring
    if (window.matchMedia('(hover: hover)').matches) open.focus({ preventScroll: true });

    function close() {
        try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* ignore */ }
        document.removeEventListener('keydown', onKey);
        document.documentElement.classList.remove('cover-showing');
        page.classList.add('cover-leaving');
        setTimeout(() => page.remove(), 450);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    open.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
}
