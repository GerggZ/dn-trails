// Profile button (top right of the site bar, where a login button would go)
// and the side menu it opens from the right:
//   who you are · All hikes / My hikes / Shared with me · (demo) Viewing as
// Picking a list opens the main page filtered to it (index.html?show=mine).
//
// DEMO: "Viewing as" switches the pretend user; the page reloads so everything
// is shown the way that person would see it. Later this is "Log in / Log out".

import { currentUser, currentUserId, setCurrentUser, loadUsers, scopeCounts, SCOPES, el } from './data.js';

const PERSON_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4s6.3 1.8 7.5 5.4"/></svg>';
const CLOSE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

/** The scope the main page is showing (from ?show=), 'all' if none/unknown. */
export function currentScope() {
    const show = new URLSearchParams(window.location.search).get('show');
    return show && SCOPES[show] ? show : 'all';
}

const scopeUrl = (scope) => (scope === 'all' ? './index.html' : `./index.html?show=${scope}`);

function avatar(user, className) {
    const a = el('span', { className: `avatar ${className}` });
    if (user) a.textContent = user.name.trim().charAt(0).toUpperCase();
    else a.innerHTML = PERSON_SVG;
    return a;
}

/** Add the profile button to `bar` and build the menu. `onMainPage`: links replace the scope in place. */
export async function setupProfileMenu(bar) {
    if (!bar) return;
    const [user, { users }, counts] = await Promise.all([currentUser(), loadUsers(), scopeCounts()]);
    const onMainPage = document.body.classList.contains('explore-page');
    const active = onMainPage ? currentScope() : null;

    // --- the button ---
    const button = el('button', {
        type: 'button',
        className: 'profile-button',
        ariaLabel: user ? `Profile: ${user.name}` : 'Profile (guest)',
        ariaExpanded: 'false',
        title: user ? user.name : 'Guest',
    }, avatar(user, 'avatar-small'));
    button.setAttribute('aria-controls', 'profile-menu');
    bar.append(button);

    // --- the menu ---
    const close = el('button', { type: 'button', className: 'profile-close', ariaLabel: 'Close menu' });
    close.innerHTML = CLOSE_SVG;

    const links = el('ul', { className: 'profile-links' });
    const scopes = user ? Object.keys(SCOPES) : ['all'];
    for (const key of scopes) {
        const a = el('a', { href: scopeUrl(key) },
            el('span', { textContent: SCOPES[key].title }),
            el('span', { className: 'profile-count', textContent: String(counts[key]) }));
        if (key === active) a.setAttribute('aria-current', 'page');
        a.addEventListener('click', (e) => {
            e.preventDefault();
            if (key === active) { closeMenu(); return; }
            // replace the menu's history entry: Back then goes to the page as it was before
            window.location.replace(a.href);
        });
        links.append(el('li', {}, a));
    }

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

    const menu = el('nav', { className: 'profile-menu', id: 'profile-menu', ariaLabel: 'Profile' },
        el('header', { className: 'profile-head' },
            avatar(user, 'avatar-large'),
            el('div', { className: 'profile-who' },
                el('strong', { textContent: user ? user.name : 'Guest' }),
                el('span', { textContent: user ? (user.admin ? 'Admin' : 'Member') : 'Not logged in' })),
            close),
        links,
        user ? null : el('p', { className: 'profile-hint', textContent: 'Pick someone below to see the hikes shared with them.' }),
        el('footer', { className: 'profile-demo' },
            el('label', { htmlFor: 'viewing-as', textContent: 'Viewing as' }),
            select,
            el('p', { className: 'demo-note', textContent: 'Demo: no real logins yet. Everything in this book is public for now.' })),
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
        close.focus({ preventScroll: true });
    }
    function closeMenu(fromBackButton = false) {
        if (!open) return;
        open = false;
        menu.inert = true;
        document.documentElement.classList.remove('menu-open');
        button.ariaExpanded = 'false';
        button.focus({ preventScroll: true });
        if (!fromBackButton && history.state?.hbMenu) history.back();
    }
    button.addEventListener('click', () => (open ? closeMenu() : openMenu()));
    close.addEventListener('click', () => closeMenu());
    scrim.addEventListener('click', () => closeMenu());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    if (history.state?.hbMenu) history.replaceState(null, ''); // page reloaded while the menu was open
    window.addEventListener('popstate', () => closeMenu(true));
}
