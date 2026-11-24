// Installed app on Android: hide the phone's status and navigation bars.
// The manifest asks for "display": "fullscreen", but Android only reads that
// when the app is installed, so older installs still open with the bars.
// For those, the first tap on a page asks for full screen (a browser only
// allows that during a tap). Each page load (main page <-> hike page) starts
// with the bars again until the next tap. iPhones have no such API: there the
// page already runs behind the clock (black-translucent status bar).
// In a normal browser tab this does nothing.

export function keepFullScreen() {
    const phone = window.matchMedia('(hover: none) and (pointer: coarse)');
    const installed = window.matchMedia('(display-mode: standalone)');
    const root = document.documentElement;
    if (!root.requestFullscreen) return;

    const ask = () => {
        if (!phone.matches || !installed.matches || document.fullscreenElement) return;
        root.requestFullscreen({ navigationUI: 'hide' }).catch(() => { /* not allowed: keep the bars */ });
    };
    // touchend / click count as a tap for the browser; a scroll doesn't, so try on both
    document.addEventListener('touchend', ask, { capture: true, passive: true });
    document.addEventListener('click', ask, { capture: true });
}
