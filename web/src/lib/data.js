// Loads the JSON written by tools/build_hikes.py into web/public/data/

async function getJson(path) {
    const res = await fetch(`${import.meta.env.BASE_URL}${path}`);
    if (!res.ok) throw new Error(`Could not load ${path} (${res.status}). Did you run "npm run data"?`);
    return res.json();
}

export const loadHikeIndex = () => getJson('data/index.json');
/** Photos from backgrounds/ (empty list if there are none or the file is missing). */
export const loadBackgrounds = () => getJson('data/backgrounds.json').catch(() => []);
export const loadHike = (id) => getJson(`data/hikes/${encodeURIComponent(id)}.json`);

/** Turn a site-relative path from the data (e.g. "photos/x/y.jpg") into a URL. */
export const asset = (path) => `${import.meta.env.BASE_URL}${path}`;

/** Tiny helper to build elements without innerHTML (keeps titles/captions safe). */
export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    for (const c of children.flat()) if (c != null && c !== false) node.append(c);
    return node;
}
