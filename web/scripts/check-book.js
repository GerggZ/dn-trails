// Runs before a deploy: `node scripts/check-book.js public` (GitHub Pages)
// or `node scripts/check-book.js wedding` (Cloudflare). Stops the deploy if the
// generated data is the other book, i.e. BOOK in .env is wrong.
// For the public book it also makes sure no hike from wedding_hikes/ slipped in.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const expected = process.argv[2];
if (!['public', 'wedding'].includes(expected)) {
    console.error('  check-book.js: say which book, e.g. `node scripts/check-book.js public`');
    process.exit(1);
}

const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(web, 'public', 'data');
const stop = (msg) => {
    console.error(`\n  STOP: ${msg}`);
    console.error(`  Set BOOK=${expected} in the .env file and run it again.\n`);
    process.exit(1);
};

const editionFile = join(dataDir, 'edition.json');
const built = existsSync(editionFile) ? JSON.parse(readFileSync(editionFile, 'utf8')).book : 'public';
if (built !== expected) stop(`the data is the ${built} book, but this deploys the ${expected} book.`);

if (expected === 'public') {
    const dirs = (p) => (existsSync(p) ? readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : []);
    const wedding = new Set(dirs(join(web, '..', 'wedding_hikes')).filter((n) => !n.startsWith('_') && !n.startsWith('.')));
    const found = new Set();
    const indexFile = join(dataDir, 'index.json');
    if (existsSync(indexFile)) for (const card of JSON.parse(readFileSync(indexFile, 'utf8'))) if (wedding.has(card.id)) found.add(card.id);
    const hikesData = join(dataDir, 'hikes');
    if (existsSync(hikesData)) for (const f of readdirSync(hikesData)) if (wedding.has(f.replace(/\.json$/, ''))) found.add(f.replace(/\.json$/, ''));
    for (const d of dirs(join(web, 'public', 'photos'))) if (wedding.has(d)) found.add(d);
    if (found.size) stop(`the data contains wedding hikes (${[...found].join(', ')}).`);
}
console.log(`  Book check OK: deploying the ${expected} book.`);
