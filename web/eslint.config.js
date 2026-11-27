// Code check (npm run lint): finds mistakes without running the code, e.g. a name
// that's used but never defined ("fmtMB is not defined").
import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['dist/**', 'dist-wedding/**', 'node_modules/**', 'public/data/**', 'test-results/**', 'playwright-report/**'] },
    js.configs.recommended,
    {
        // The site itself (runs in the browser)
        files: ['src/**/*.js'],
        languageOptions: {
            globals: { ...globals.browser }, // __BOOK__ / __APP_VERSION__ (from vite.config.js): /* global */ comments in the files
        },
    },
    {
        // The service worker
        files: ['src/sw.js'],
        languageOptions: { globals: { ...globals.serviceworker } },
    },
    {
        // Build and test tools (run in Node)
        files: ['*.config.js', 'scripts/**/*.js', 'tests/**/*.js'],
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
    },
    {
        rules: {
            // Unused things are worth knowing about, but shouldn't stop a deploy
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
            'no-empty': ['error', { allowEmptyCatch: true }],
            'no-useless-assignment': 'warn',
        },
    },
];
