// Browser tests (npm run test:e2e): a real Chrome against the BUILT site
// (npm run preview), because the service worker / offline only exist there.
// Run `npm run build` first. Files: tests/e2e/*.spec.js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 120_000,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:4180/',
        serviceWorkers: 'allow',
    },
    projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
    webServer: {
        command: 'npm run preview',
        url: 'http://127.0.0.1:4180/',
        reuseExistingServer: true,
        timeout: 60_000,
    },
});
