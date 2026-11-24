// The ONE place the pages get hike data from, and the one place that decides
// who may see what. Pages never read the JSON files themselves.
//
// DEMO: there are no real logins. "Viewing as" (src/lib/viewing-as.js) picks
// a user from data/users.json, and the rules below filter the hikes in the
// browser. Everything is still public: anyone can open data/index.json.
// Later, the inside of this file talks to a real backend that applies the
// same rules on the server; the functions the pages call stay the same.

const USER_KEY = 'hb-demo-user';

async function getJson(path) {
    const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status}). Did you run "npm run data"?`);
    return res.json();
}

let indexPromise;
let usersPromise;
const loadIndex = () => (indexPromise ??= getJson('data/index.json'));
/** Demo users and groups: { users: [{id, name, admin}], groups: [{id, name, members}] } */
export const loadUsers = () => (usersPromise ??= getJson('data/users.json').catch(() => ({ users: [], groups: [] })));

// --- who is "logged in" (demo) ---

/** Id of the user we're viewing as; '' = guest (not logged in). */
export function currentUserId() {
    try { return localStorage.getItem(USER_KEY) || ''; } catch { return ''; }
}

export function setCurrentUser(id) {
    try {
        if (id) localStorage.setItem(USER_KEY, id);
        else localStorage.removeItem(USER_KEY);
    } catch { /* storage blocked: stays for this page only */ }
    window.dispatchEvent(new CustomEvent('hb-user-change', { detail: id || '' }));
}

/** The current user object, or null for a guest (or a stored id that no longer exists). */
export async function currentUser() {
    const id = currentUserId();
    if (!id) return null;
    const { users } = await loadUsers();
    return users.find((u) => u.id === id) ?? null;
}

// --- the rules ---

/** May `user` (null = guest) see `hike` (a card from index.json or a full hike)? */
export function canSee(user, hike, groups = []) {
    if (hike.public) return true;
    if (!user) return false;
    if (user.admin || hike.owner === user.id) return true;
    const shared = hike.shared_with ?? [];
    if (shared.includes(user.id)) return true;
    return groups.some((g) => shared.includes(g.id) && g.members.includes(user.id));
}

async function viewer() {
    const [user, { groups }] = await Promise.all([currentUser(), loadUsers()]);
    return { user, groups };
}

/** The cards of every hike the current user may see (newest first). */
export async function listHikes() {
    const [index, { user, groups }] = await Promise.all([loadIndex(), viewer()]);
    return index.filter((h) => canSee(user, h, groups));
}

export class NotFound extends Error {}

/** One full hike, if the current user may see it. A hidden hike looks exactly like a missing one. */
export async function getHike(id) {
    const [index, { user, groups }] = await Promise.all([loadIndex(), viewer()]);
    const card = index.find((h) => h.id === id);
    if (!card || !canSee(user, card, groups)) {
        throw new NotFound("This hike doesn't exist, or you're not allowed to see it.");
    }
    return getJson(`data/hikes/${encodeURIComponent(id)}.json`);
}

/** Photos from backgrounds/ (empty list if there are none or the file is missing). */
export const loadBackgrounds = () => getJson('data/backgrounds.json').catch(() => []);

/** Turn a site-relative path from the data (e.g. "photos/x/y.jpg") into a URL. */
export const asset = (path) => `${import.meta.env.BASE_URL}${path}`;

/** Tiny helper to build elements without innerHTML (keeps titles/captions safe). */
export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const c of children.flat()) if (c != null && c !== false) node.append(c);
    return node;
}
