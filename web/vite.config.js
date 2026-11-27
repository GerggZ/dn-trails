import { defineConfig, build } from 'vite';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { APP_CONFIG } from './src/config.js';

// Every build gets a version stamp: when it was built + the git commit
// (like Hitster). It's shown at the bottom of every page and written to
// version.json, which the book checks to tell you a newer version is out.
// The same stamp goes into dist/sw.js, so every deploy also refreshes the
// offline copy on phones (no more bumping VERSION by hand).

// The service worker (src/sw.js + the shared src/lib/offline-common.js) is bundled
// on its own into one plain script, dist/sw.js: a service worker can't load the
// site's module chunks. `version` and `files` (assets/… to save at install) are filled in.
async function buildServiceWorker(outDir, version, files) {
  await build({
    configFile: false,
    root: import.meta.dirname,
    publicDir: false,
    logLevel: 'warn',
    define: { __SW_VERSION__: JSON.stringify(version), __BUILD_FILES__: JSON.stringify(files) },
    build: {
      outDir,
      emptyOutDir: false,
      copyPublicDir: false,
      minify: false,
      sourcemap: false,
      lib: { entry: resolve(import.meta.dirname, 'src', 'sw.js'), formats: ['iife'], name: 'hbServiceWorker', fileName: () => 'sw.js' },
    },
  });
}
function buildVersion() {
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date());
  let commit = '';
  try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  return commit ? `${when} · ${commit}` : when;
}

// Which book: BOOK in the .env file at the top of the repo (the Python tools read the
// same file). The app is built to match it: name, logo, menu, output folder.
// After changing it: rebuild the data (npm run data) and restart `npm run dev`.
function readEnv(file) {
  if (!existsSync(file)) return {};
  const values = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const at = line.indexOf('=');
    values[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["']|["']$/g, '');
  }
  return values;
}

function currentBook(command) {
  const book = readEnv(resolve(import.meta.dirname, '..', '.env')).BOOK || 'public';
  if (!APP_CONFIG.editions[book]) throw new Error(`.env says BOOK=${book}, but config.js editions has no such book`);
  // The hike data must be the same book (build_hikes.py writes which one into edition.json)
  const file = resolve(import.meta.dirname, 'public', 'data', 'edition.json');
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).book : 'public';
  if (data !== book) {
    const msg = `.env says BOOK=${book}, but the hike data is the ${data} book. Run \`npm run data\` (or tools/build_hikes.py) first.`;
    if (command === 'build') throw new Error(msg);
    console.warn(`\n  ! ${msg}\n`);
  }
  return book;
}

// Source maps for Sentry (readable file + line in error reports): only when the
// .env file has SENTRY_AUTH_TOKEN (secret, never commit it). The build uploads
// the maps to Sentry and then deletes them, so they never go online.
function sentrySourceMaps(command, version, outDir) {
  const token = readEnv(resolve(import.meta.dirname, '..', '.env')).SENTRY_AUTH_TOKEN;
  if (command !== 'build' || !token) return null;
  return sentryVitePlugin({
    org: 'greggory-xo',
    project: 'hiking-book',
    url: 'https://de.sentry.io/', // EU region
    authToken: token,
    release: { name: version, inject: false }, // same name as `release` in src/lib/errors.js
    sourcemaps: { filesToDeleteAfterUpload: [`${outDir}/**/*.map`] },
    telemetry: false,
  });
}

export default defineConfig(({ command }) => {
  const version = command === 'build' ? buildVersion() : 'dev';
  const book = currentBook(command);
  const edition = APP_CONFIG.editions[book];
  let outDir = edition.outDir;
  const sourceMaps = sentrySourceMaps(command, version, edition.outDir);
  return {
    // Relative paths, so the built site in dist/ works from any folder or host
    base: './',
    define: { __APP_VERSION__: JSON.stringify(version), __BOOK__: JSON.stringify(book) },
    build: {
      outDir: edition.outDir,
      emptyOutDir: true,
      // 'hidden': maps are made (for Sentry) but the code doesn't point to them
      sourcemap: sourceMaps ? 'hidden' : false,
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'index.html'),
          hike: resolve(import.meta.dirname, 'hike.html'),
          privacy: resolve(import.meta.dirname, 'privacy.html'),
        },
      },
    },
    plugins: [
      {
        // The book's name and logo in the pages (site bar, tab title, tab icon, iPhone home screen).
        // The pages are written with "Hiking Book" and the icons/dn-… files.
        name: 'book-name',
        transformIndexHtml: (html) => html
          .replaceAll('Hiking Book', edition.name)
          .replaceAll('icons/dn-', `icons/${edition.logo}-`),
      },
      {
        name: 'version-stamp',
        apply: 'build',
        configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) });
        },
        async closeBundle() {
          // The service worker, with this build's version and the files the pages need,
          // so it saves them at install (fonts: only the latin sets, the others are
          // never downloaded for our text)
          const files = readdirSync(resolve(outDir, 'assets'))
            .filter((f) => /\.(js|css|png|svg)$/.test(f) || (/\.woff2$/.test(f) && /-latin-/.test(f)))
            .map((f) => `assets/${f}`);
          await buildServiceWorker(outDir, version, files);
          // The installed app's display mode comes from config.js (display.app), not public/
          const mode = APP_CONFIG.display?.app;
          if (!['standalone', 'fullscreen'].includes(mode)) throw new Error(`config.js display.app must be 'standalone' or 'fullscreen', not ${JSON.stringify(mode)}`);
          const manifestPath = resolve(outDir, 'manifest.webmanifest');
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
          manifest.display = mode;
          manifest.name = edition.name;
          manifest.short_name = edition.shortName ?? edition.name;
          manifest.icons = manifest.icons.map((i) => ({ ...i, src: i.src.replace('icons/dn-', `icons/${edition.logo}-`) }));
          writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
          // Compare this with "Version:" at the bottom of the book on your phone
          console.log(`\n  ${edition.name} (${book} book) -> ${edition.outDir}/  version: ${version}  (installed app: ${mode})\n`);
        },
      },
      sourceMaps,
    ].filter(Boolean),
  };
});
