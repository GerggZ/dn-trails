import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// Every build gets a version stamp: when it was built + the git commit
// (like Hitster). It's shown at the bottom of every page and written to
// version.json, which the book checks to tell you a newer version is out.
// The same stamp goes into dist/sw.js, so every deploy also refreshes the
// offline copy on phones (no more bumping VERSION by hand).
function buildVersion() {
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(new Date());
  let commit = '';
  try { commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
  return commit ? `${when} · ${commit}` : when;
}

export default defineConfig(({ command }) => {
  const version = command === 'build' ? buildVersion() : 'dev';
  let outDir = 'dist';
  return {
    // Relative paths, so the built site in dist/ works from any folder or host
    base: './',
    define: { __APP_VERSION__: JSON.stringify(version) },
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'index.html'),
          hike: resolve(import.meta.dirname, 'hike.html'),
        },
      },
    },
    plugins: [
      {
        name: 'version-stamp',
        apply: 'build',
        configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
        generateBundle() {
          this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) });
        },
        closeBundle() {
          // public/sw.js is copied as-is; stamp the build's version into the copy
          const sw = resolve(outDir, 'sw.js');
          const text = readFileSync(sw, 'utf8');
          const stamped = text.replace(/^const VERSION = .*$/m, `const VERSION = ${JSON.stringify(version)};`);
          if (stamped === text) throw new Error('version-stamp: no "const VERSION = …" line found in sw.js');
          writeFileSync(sw, stamped);
          // Compare this with "Version:" at the bottom of the book on your phone
          console.log(`\n  Hiking Book version: ${version}\n`);
        },
      },
    ],
  };
});
