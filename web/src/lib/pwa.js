// Registers the service worker (public/sw.js) so the book can be installed
// and read offline. Only in the built site: in `npm run dev` it would cache
// files that change on every save.

export function registerServiceWorker() {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => {
            console.warn('Offline support unavailable:', err);
        });
    });
}

/** True when the page runs as an installed app (home-screen icon). */
export const isInstalled = () =>
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

/**
 * An "Install" button: Chrome/Edge/Android offer a real install prompt;
 * iPhone/iPad Safari has no prompt, so the button shows how to do it by hand.
 */
export function setupInstallButton(button, hint) {
    if (!button || isInstalled()) return;

    let deferred = null;
    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        deferred = event;
        button.hidden = false;
    });
    window.addEventListener('appinstalled', () => { button.hidden = true; hint.hidden = true; });

    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (isIOS) button.hidden = false;

    button.addEventListener('click', async () => {
        if (deferred) {
            deferred.prompt();
            await deferred.userChoice;
            deferred = null;
            button.hidden = true;
        } else {
            hint.hidden = !hint.hidden;
        }
    });
}
