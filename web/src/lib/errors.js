// Error reports (Sentry, EU region): when the book breaks on someone's phone or
// computer, the error and where it happened show up under Issues in Gregg's
// Sentry project "hiking-book".
//
// - Only in the built site (not npm run dev) and not in the automatic browser tests.
// - Only errors: no IP addresses or other user info, no session replays, no tracing.
// - Wedding book: reports made offline (on the trail) wait on the device and are sent
//   once there's signal. Public book: offline reports are dropped (see privacy.html).
// - Each report says which book (wedding / public), which version, and whether the
//   book runs as the installed app.
//
// The DSN isn't a secret: it only allows sending reports to this project, not reading them.

/* global __APP_VERSION__, __BOOK__ */
import * as Sentry from '@sentry/browser';
import { isInstalled } from './pwa.js';

const DSN = 'https://62f73bf94a1c9b57451822405bd78a38@o4512506046054400.ingest.de.sentry.io/4512506057457744';

export function setupErrorReports() {
    if (!import.meta.env.PROD || navigator.webdriver) return;
    try {
        Sentry.init({
            dsn: DSN,
            environment: __BOOK__,
            release: __APP_VERSION__,
            // No user info: also stops Sentry's server from filling in the sender's IP
            dataCollection: { userInfo: false },
            // Wedding book: reports made offline wait on the device and go out later.
            // Public book: no (storing them on visitors' devices would need consent).
            ...(__BOOK__ === 'wedding' ? { transport: Sentry.makeBrowserOfflineTransport(Sentry.makeFetchTransport) } : {}),
            // Only errors from the book's own code (not from browser extensions)
            allowUrls: [location.origin],
            // The steps before an error include the addresses the page fetched; a place
            // search's address holds what the reader typed. Keep only where it went.
            beforeBreadcrumb: withoutSearchText,
        });
        Sentry.setTag('installed', isInstalled());
    } catch { /* reporting must never break the book */ }
}

// Place search (src/directory/place-search.js) puts the search text in the address
const SEARCH_HOSTS = ['nominatim.openstreetmap.org'];

/** A fetch step to the place search: drop the address's query (the search text). */
function withoutSearchText(breadcrumb) {
    const data = breadcrumb.data;
    if (!data?.url) return breadcrumb;
    try {
        const url = new URL(data.url, location.href);
        if (SEARCH_HOSTS.includes(url.hostname)) {
            data.url = `${url.origin}${url.pathname}`;
            delete data['http.query'];
            delete data['http.fragment'];
        }
    } catch { /* not an address: leave it */ }
    return breadcrumb;
}
