// Unit tests (npm test): single functions, no browser. Files: tests/unit/*.test.js
// Kept apart from vite.config.js so a test run doesn't need the built hike data.
import { defineConfig } from 'vitest/config';

export default defineConfig({
    define: { __BOOK__: JSON.stringify('public'), __APP_VERSION__: JSON.stringify('test') },
    test: { include: ['tests/unit/**/*.test.js'] },
});
