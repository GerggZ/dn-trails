// Which version of the book is running, and whether a newer one has been
// published (version.json is written by vite.config.js on every build).
// Same idea as Hitster's src/version.js.

/* global __APP_VERSION__ */
export const APP_VERSION = __APP_VERSION__;

/** Small "Version: 14 Nov 2026, 11:52 · 8c52141" line at the bottom of the sheet. */
export function showVersion() {
    const host = document.querySelector('.sheet') ?? document.body;
    const line = document.createElement('p');
    line.className = 'app-version';
    line.textContent = `Version: ${APP_VERSION}`;
    host.append(line);
}

/** Make sure the new service worker is in place, then reload onto the new version. */
async function reloadToNewVersion(button) {
    button.disabled = true;
    button.textContent = 'Updating…';
    try {
        const registration = await navigator.serviceWorker?.getRegistration();
        if (registration) {
            await registration.update();
            const worker = registration.installing ?? registration.waiting;
            if (worker) {
                await new Promise((done) => {
                    const timer = setTimeout(done, 10000);
                    worker.addEventListener('statechange', () => {
                        if (worker.state === 'activated' || worker.state === 'redundant') {
                            clearTimeout(timer);
                            done();
                        }
                    });
                });
            }
        }
    } catch {
        // Reload anyway: pages always come from the network first
    }
    window.location.reload();
}

let bannerShown = false;

function showUpdateBanner() {
    if (bannerShown) return;
    bannerShown = true;
    const banner = document.createElement('div');
    banner.className = 'update-banner';
    banner.setAttribute('role', 'status');
    banner.innerHTML = '<span>A new version of the book is out.</span><button type="button" class="update-reload">Update</button>';
    const button = banner.querySelector('button');
    button.addEventListener('click', () => reloadToNewVersion(button));
    document.body.append(banner);
}

async function checkForUpdate() {
    try {
        const response = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
        if (!response.ok) return;
        const { version } = await response.json();
        if (version && version !== APP_VERSION) showUpdateBanner();
    } catch {
        // Offline: nothing to compare against
    }
}

/** Shows the version, and checks for a newer one when the book opens and whenever you come back to it. */
export function watchForUpdates() {
    showVersion();
    if (APP_VERSION === 'dev') return;
    console.info(`Hiking Book version: ${APP_VERSION}`);
    setTimeout(checkForUpdate, 3000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate();
    });
}
