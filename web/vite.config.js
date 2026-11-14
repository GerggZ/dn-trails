import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  // Relative paths, so the built site in dist/ works from any folder or host
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        hike: resolve(import.meta.dirname, 'hike.html'),
      },
    },
  },
});
