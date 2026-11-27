// Error reports (Sentry, EU region): when the book breaks on someone's phone or
// computer, the error and where it happened arrive in Gregg's Sentry project
// "hiking-book", with an email for each new kind of error.
//
// - Only in the built site (not npm run dev) and not in the automatic browser tests.
// - No IP addresses (dataCollection.userInfo: false), no names, no session replays,
//   no performance tracing: only errors. Second lock in Sentry: Project Settings →
//   hiking-book → Security & Privacy → "Prevent Storing of IP Addresses".
// - Offline (on the trail), reports wait on the device and are sent once there's signal.
// - Each report says which book (wedding / public) and which version.
//
// The DSN isn't a secret: it only allows sending reports to this project, not reading them.

/* global __APP_VERSION__, __BOOK__ */
import * as Sentry from '@sentry/browser';

const DSN = 'https://62f73bf94a1c9b57451822405bd78a38@o4512506046054400.ingest.de.sentry.io/4512506057457744';

export function setupErrorReports() {
    if (!import.meta.env.PROD || navigator.webdriver) return;
    try {
        Sentry.init({
            dsn: DSN,
            environment: __BOOK__,
            release: __APP_VERSION__,
            // No IP address or other user info. In Sentry 11 this is the switch that counts
            // (the old sendDefaultPii no longer does it): with userInfo on (the default) the
            // SDK asks Sentry's server to fill in the sender's IP ("infer_ip": "auto").
            dataCollection: { userInfo: false },
            // Saved on the device while offline, sent later
            transport: Sentry.makeBrowserOfflineTransport(Sentry.makeFetchTransport),
            // Errors from browser extensions etc. aren't the book's
            allowUrls: [location.origin],
            beforeSend(event) {
                delete event.user; // nothing about who it was (no ip_address field either)
                return event;
            },
        });
        Sentry.setTag('installed', window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true);
    } catch { /* reporting must never break the book */ }
}
