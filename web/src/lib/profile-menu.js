// Profile button (top right of the site bar, where a login button would go)
// and the side menu it opens from the right:
//   who you are · All hikes / My hikes / Shared with me / Downloads › · (demo) Viewing as
// "Downloads" opens a sub-page inside the menu: the hikes saved for offline, their sizes, remove.
// Picking a list opens the main page filtered to it (index.html?show=mine).
//
// DEMO: "Viewing as" switches the pretend user; the page reloads so everything
// is shown the way that person would see it. Later this is "Log in / Log out".
//
// Wedding book (no accounts): it's as if Danna & Neil are always logged in. The
// button and the menu's header show two people and the book's name; the menu has
// only Downloads (not in npm run dev, where offline doesn't work).

import { currentUser, currentUserId, setCurrentUser, loadUsers, scopeCounts, SCOPES, el } from './data.js';
import { offlineAvailable, downloadedHikes, removeOffline, savedIds, fmtSize, LEVELS, CHANGE_EVENT } from './offline-store.js';
import { ACCOUNTS, BOOK_NAME } from './edition.js';
import { loadCover, openCover } from './cover.js';

const PERSON_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/></svg>';
// Wedding book: two people (Danna & Neil) instead of the one person
const COUPLE_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="7.2" cy="9" r="3"/><path d="M2.2 19.5c.7-3 2.6-4.6 5-4.6s4.3 1.6 5 4.6"/><circle cx="16.8" cy="9" r="3"/><path d="M11.8 19.5c.7-3 2.6-4.6 5-4.6s4.3 1.6 5 4.6"/></svg>';
const BACK_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const CLOSE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

/** The scope the main page is showing (from ?show=), 'all' if none/unknown. */
export function currentScope() {
    const show = new URLSearchParams(window.location.search).get('show');
    return show && SCOPES[show] ? show : 'all';
}

/** Main page: switch to another list without reloading (directory.js listens). */
export const SCOPE_EVENT = 'hb-scope';
export const switchScope = (scope) => window.dispatchEvent(new CustomEvent(SCOPE_EVENT, { detail: scope }));

const hikeUrl = (id) => `./hike.html?id=${encodeURIComponent(id)}`;
const scopeUrl = (scope) => (scope === 'all' ? './index.html' : `./index.html?show=${scope}`);

function avatar(user, className) {
    const a = el('span', { className: `avatar ${className}` });
    if (user) a.textContent = user.name.trim().charAt(0).toUpperCase();
    else a.innerHTML = PERSON_SVG;
    return a;
}

function couple(className) {
    const a = el('span', { className: `avatar ${className}` });
    a.innerHTML = COUPLE_SVG;
    return a;
}

/** Add the profile button to `bar` and build the menu. `onMainPage`: links replace the scope in place. */
export async function setupProfileMenu(bar) {
    if (!bar) return;
    const [user, { users }, counts, cover] = await Promise.all([currentUser(), loadUsers(), scopeCounts(), loadCover()]);
    const onMainPage = document.body.classList.contains('explore-page');
    let active = onMainPage ? currentScope() : null;

    // --- the button ---
    const button = el('button', {
        type: 'button',
        className: 'profile-button',
        ariaLabel: !ACCOUNTS ? `Profile: ${BOOK_NAME}` : user ? `Profile: ${user.name}` : 'Profile (guest)',
        ariaExpanded: 'false',
        title: !ACCOUNTS ? BOOK_NAME : user ? user.name : 'Guest',
    }, avatar(user, 'avatar-small'));
    if (!ACCOUNTS) button.querySelector('.avatar').innerHTML = COUPLE_SVG;
    button.setAttribute('aria-controls', 'profile-menu');
    bar.append(button);

    // --- the menu ---
    const close = el('button', { type: 'button', className: 'profile-close', ariaLabel: 'Close menu' });
    close.innerHTML = CLOSE_SVG;

    const links = el('ul', { className: 'profile-links' });
    const scopes = !ACCOUNTS ? [] : user ? Object.keys(SCOPES) : ['all'];
    for (const key of scopes) {
        const a = el('a', { href: scopeUrl(key) },
            el('span', { textContent: SCOPES[key].title }),
            el('span', { className: 'profile-count', textContent: String(counts[key]) }));
        a.dataset.scope = key;
        if (key === active) a.setAttribute('aria-current', 'page');
        a.addEventListener('click', (e) => {
            e.preventDefault();
            // Main page: the list and map change underneath, the menu stays open
            if (onMainPage) { if (key !== active) switchScope(key); return; }
            // replace the menu's history entry: Back then goes to the page as it was before
            window.location.replace(a.href);
        });
        links.append(el('li', {}, a));
    }

    // A list was picked (here or with the chip on the main page): mark it, and put it in the
    // address so a reload shows it too (the URL of the base entry is fixed when the menu closes)
    window.addEventListener(SCOPE_EVENT, (e) => {
        active = e.detail;
        for (const link of links.querySelectorAll('a[data-scope]')) {
            if (link.dataset.scope === active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        }
        history.replaceState(history.state, '', scopeUrl(active));
    });
    const syncUrl = () => {
        if (onMainPage && !history.state?.hbMenu && currentScope() !== active) history.replaceState(history.state, '', scopeUrl(active));
    };

    // Demo login: pick who you are
    const select = el('select', { id: 'viewing-as', className: 'viewing-as-select' },
        el('option', { value: '', textContent: 'Guest (not logged in)' }),
        users.map((u) => el('option', { value: u.id, textContent: u.admin ? `${u.name} (admin)` : u.name })),
    );
    select.value = user ? currentUserId() : '';
    select.addEventListener('change', () => {
        setCurrentUser(select.value);
        if (history.state?.hbMenu) {
            // step back over the menu's history entry first, so Back doesn't show this page twice
            window.addEventListener('popstate', () => window.location.reload(), { once: true });
            history.back();
        } else {
            window.location.reload();
        }
    });

    // Downloads: the hikes saved for offline on this device (not per user: it's the phone's storage).
    // A row in the list above (with the count) that opens a sub-page in the menu.
    // The book's cover page (wedding book), back from anywhere
    if (cover) {
        const a = el('a', { href: './index.html?cover' }, el('span', { textContent: 'Cover page' }));
        a.addEventListener('click', (e) => {
            e.preventDefault();
            if (onMainPage) { closeMenu(); openCover(); } else window.location.replace(a.href);
        });
        links.prepend(el('li', {}, a));
    }

    const downloads = offlineAvailable() ? el('section', { className: 'profile-downloads', ariaLabel: 'Downloaded hikes' }) : null;
    const downloadsCount = el('span', { className: 'profile-count' });
    const updateCount = () => { downloadsCount.textContent = String(savedIds().length); };
    if (downloads) {
        const row = el('button', { type: 'button', className: 'profile-sub-link' },
            el('span', { textContent: 'Downloads' }),
            el('span', { className: 'profile-row-end' }, downloadsCount, el('span', { className: 'profile-chevron', textContent: '›', ariaHidden: 'true' })));
        row.addEventListener('click', () => showDownloads());
        links.append(el('li', {}, row));
        updateCount();
    }
    const back = el('button', { type: 'button', className: 'profile-close', ariaLabel: 'Back to the menu' });
    back.innerHTML = BACK_SVG;
    back.addEventListener('click', () => showMain());
    let busy = false;
    async function renderDownloads(message = '') {
        if (!downloads || busy) return;
        const { hikes, total } = await downloadedHikes();
        const status = el('p', { className: 'profile-hint', role: 'status', textContent: message });

        const remove = async (ids, question) => {
            if (!confirm(question)) return;
            busy = true;
            for (const b of downloads.querySelectorAll('button')) b.disabled = true;
            status.textContent = 'Removing…';
            let done = 'Removed from this device.';
            try { await removeOffline(ids); } catch (err) { done = `Couldn't remove: ${err.message}`; }
            busy = false;
            renderDownloads(done);
        };

        const list = el('ul', { className: 'profile-download-list' }, hikes.map((h) => {
            const a = el('a', { href: hikeUrl(h.id) },
                el('span', { textContent: h.title }),
                el('small', { textContent: `${(LEVELS[h.level] ?? LEVELS.standard).label} · ${fmtSize(h.bytes)}` }));
            a.addEventListener('click', (e) => { e.preventDefault(); window.location.replace(a.href); });
            const x = el('button', { type: 'button', className: 'profile-remove', ariaLabel: `Remove ${h.title} from this device`, title: 'Remove from this device' });
            x.innerHTML = CLOSE_SVG;
            x.addEventListener('click', () => remove([h.id], `Remove the offline copy of "${h.title}" (${fmtSize(h.bytes)}) from this device?`));
            return el('li', {}, a, x);
        }));
        const all = hikes.length > 1 ? el('button', { type: 'button', className: 'pill', textContent: `Remove all · ${fmtSize(total)}` }) : null;
        all?.addEventListener('click', () => remove(hikes.map((h) => h.id), `Remove all ${hikes.length} downloaded hikes (${fmtSize(total)}) from this device?`));

        updateCount();
        downloads.replaceChildren(...[
            el('header', { className: 'profile-sub-head' }, back, el('h2', { textContent: 'Downloads' })),
            hikes.length
                ? el('p', { className: 'profile-hint', textContent: `${hikes.length === 1 ? '1 hike' : `${hikes.length} hikes`} · ${fmtSize(total)} on this device` })
                : null,
            hikes.length ? list : el('p', { className: 'profile-hint', textContent: 'No hikes saved for offline.' }),
            all,
            status,
        ].filter(Boolean)); // replaceChildren would write a missing button as the text "null"
    }
    window.addEventListener(CHANGE_EVENT, () => {
        updateCount();
        if (open && menu.dataset.view === 'downloads') renderDownloads();
    });

    // Sub-page on/off. No extra history entry: the phone's Back button closes the whole menu.
    function showDownloads() {
        menu.dataset.view = 'downloads';
        menu.scrollTop = 0;
        renderDownloads().then(() => back.focus({ preventScroll: true }));
    }
    function showMain() {
        if (menu.dataset.view !== 'downloads') return;
        delete menu.dataset.view;
        menu.querySelector('.profile-sub-link')?.focus({ preventScroll: true });
    }

    const menu = ACCOUNTS
        ? el('nav', { className: 'profile-menu', id: 'profile-menu', ariaLabel: 'Profile' },
            el('header', { className: 'profile-head' },
                avatar(user, 'avatar-large'),
                el('div', { className: 'profile-who' },
                    el('strong', { textContent: user ? user.name : 'Guest' }),
                    el('span', { textContent: user ? (user.admin ? 'Admin' : 'Member') : 'Not logged in' })),
                close),
            links,
            user ? null : el('p', { className: 'profile-hint', textContent: 'Pick someone below to see the hikes shared with them.' }),
            downloads,
            el('footer', { className: 'profile-demo' },
                el('label', { htmlFor: 'viewing-as', textContent: 'Viewing as' }),
                select,
                el('p', { className: 'demo-note', textContent: 'Demo: no real logins yet. Everything in this book is public for now.' })),
        )
        // Wedding book: Danna & Neil as the (always logged-in) user, then only Downloads
        : el('nav', { className: 'profile-menu', id: 'profile-menu', ariaLabel: 'Profile' },
            el('header', { className: 'profile-head' },
                couple('avatar-large'),
                el('div', { className: 'profile-who' }, el('strong', { textContent: BOOK_NAME })),
                close),
            links,
            downloads,
        );
    menu.inert = true;
    const scrim = el('div', { className: 'profile-scrim' });
    document.body.append(scrim, menu);

    // --- open / close (Back button and Esc close it, like the full-screen map) ---
    let open = false;
    function openMenu() {
        if (open) return;
        open = true;
        menu.inert = false;
        document.documentElement.classList.add('menu-open');
        button.ariaExpanded = 'true';
        history.pushState({ hbMenu: true }, '');
        updateCount();
        close.focus({ preventScroll: true });
    }
    function closeMenu(fromBackButton = false) {
        if (!open) return;
        open = false;
        menu.inert = true;
        delete menu.dataset.view;
        document.documentElement.classList.remove('menu-open');
        button.ariaExpanded = 'false';
        button.focus({ preventScroll: true });
        if (!fromBackButton && history.state?.hbMenu) history.back();
    }
    button.addEventListener('click', () => (open ? closeMenu() : openMenu()));
    close.addEventListener('click', () => closeMenu());
    scrim.addEventListener('click', () => closeMenu());
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (menu.dataset.view === 'downloads') showMain();
        else closeMenu();
    });
    if (history.state?.hbMenu) history.replaceState(null, ''); // page reloaded while the menu was open
    window.addEventListener('popstate', () => { closeMenu(true); syncUrl(); });
}
