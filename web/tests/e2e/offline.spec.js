// The book in a real (phone-sized) Chrome: pages open without errors, and a hike
// saved for offline still opens with no signal. Uses whichever book was built
// (BOOK in .env): it picks the smallest hike the guest may see.
import { test, expect } from '@playwright/test';

// Map pieces come from volunteer-run servers: the tests get a tiny fake piece instead
// (with the cors header, like OpenTopoMap sends), so a test run doesn't load hundreds.
const TILE_HOSTS = /tile\.opentopomap\.org|tile\.openstreetmap\.org|arcgisonline\.com/;
const FAKE_TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89+5dPQAH7gLvC/k2RQAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ context }) => {
    await context.route(TILE_HOSTS, (route) => route.fulfill({
        status: 200,
        contentType: 'image/png',
        headers: { 'access-control-allow-origin': '*' },
        body: FAKE_TILE,
    }));
});

/** Fails the test on any JavaScript error in the page (e.g. "fmtMB is not defined"). */
function watchErrors(page) {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    return errors;
}

/** The smallest hike a guest can open (fewest map pieces to download). */
async function smallHike(request) {
    const index = await (await request.get('data/index.json')).json();
    const area = (h) => (h.bbox[1][0] - h.bbox[0][0]) * (h.bbox[1][1] - h.bbox[0][1]);
    // Public book: guests see public hikes only. Wedding book: every hike.
    const visible = index.filter((h) => h.public !== false);
    return (visible.length ? visible : index).sort((a, b) => area(a) - area(b))[0];
}

test('main page lists the hikes', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('index.html');
    await expect(page.locator('.hike-row').first()).toBeVisible();
    expect(errors).toEqual([]);
});

test('a hike page opens', async ({ page, request }) => {
    const errors = watchErrors(page);
    const hike = await smallHike(request);
    await page.goto(`hike.html?id=${hike.id}`);
    await expect(page.locator('#title')).toHaveText(hike.title);
    expect(errors).toEqual([]);
});

test('a saved hike opens offline, a never-opened one says so', async ({ page, context, request }) => {
    const errors = watchErrors(page);
    const index = await (await request.get('data/index.json')).json();
    const hike = await smallHike(request);

    await page.goto(`hike.html?id=${hike.id}`);
    // The button appears once the service worker is ready
    const save = page.getByRole('button', { name: 'Save for offline' });
    await expect(save).toBeVisible({ timeout: 30_000 });
    await save.click();
    await page.getByRole('button', { name: /^Standard/ }).click();
    await expect(page.locator('#offline-status')).toContainText('Saved on this device', { timeout: 90_000 });

    // Offline only once the service worker runs this page (otherwise nothing can answer offline)
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 });

    // If the offline part fails: what didn't load, and what the page said
    const failed = [];
    page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText ?? 'failed'}  ${r.url()}`));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') failed.push(`console ${m.type()}: ${m.text()}`); });

    await context.setOffline(true);
    await page.reload();
    try {
        await expect(page.locator('#title')).toHaveText(hike.title, { timeout: 15_000 });
    } catch (err) {
        console.log(`Offline reload, what went wrong:\n  ${failed.join('\n  ') || '(no failed requests or console errors)'}`);
        throw err;
    }

    const other = index.find((h) => h.id !== hike.id && h.public !== false) ?? index.find((h) => h.id !== hike.id);
    if (other) {
        await page.goto(`hike.html?id=${other.id}`);
        await expect(page.locator('#title')).toHaveText('Not available offline');
    }
    await context.setOffline(false);
    expect(errors).toEqual([]);
});
