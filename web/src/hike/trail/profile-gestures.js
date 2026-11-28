// Mouse, pen and fingers on the elevation profile (profile-chart.js draws it).
// One finger / mouse: scrub along the hike. Two fingers (full screen): zoom and move.
// Zoomed in, a finger that lands on (or near) the dot drags the dot; anywhere
// else it slides the profile along, like dragging a map (a flick keeps it
// sliding). A tap moves the dot there. Held near an end while scrubbing, the
// view moves along. Mouse wheel / trackpad: zoom and move (full screen).
// On the page a sideways drag scrubs and an up/down swipe scrolls (touch-action: pan-y).
// After every change of the stretch the map is told to follow (map-camera.js).

import * as d3 from 'd3';

/**
 * @param {ReturnType<import('./profile-chart.js').drawProfileChart>} chart  the current drawing
 * @param {object} ctx  see map-elevation.js: state, data, bisect, setView, isZoomed, syncHover, follow, peek, openFull
 */
export function attachProfileGestures(chart, ctx) {
    const { x, width, height, render, overlay } = chart;
    const { state, data, bisect, setView, isZoomed, syncHover, follow, peek, openFull } = ctx;

    // One finger / mouse: scrub along the hike. Two fingers (full screen): zoom and move.
    // Zoomed in, a finger that lands on (or near) the dot drags the dot; anywhere
    // else it slides the profile along, like dragging a map. A tap moves the dot there.
    // On the page a sideways drag scrubs and an up/down swipe scrolls (touch-action: pan-y).
    const pointers = new Map(); // pointerId -> x in the plot
    let pinch = null; // the two distances under the fingers when the pinch started
    let afterPinch = false; // one finger still down after a pinch: ignore it until it lifts
    let pan = null; // { px, view, moved, samples } while sliding the profile
    // Momentum: a flick keeps the profile sliding, slowing down (like flicking a map)
    const FLICK_MS = 80; // the speed is measured over the last ~80 ms of the drag
    const MIN_FLICK = 0.25; // px per ms to count as a flick
    const STOP_SPEED = 0.02; // px per ms: slow enough to stop
    const FRICTION = 0.92; // speed kept per 1/60 s (lower = stops sooner; tuned by Gregg)
    let momentumFrame = null;
    function stopMomentum() {
        if (momentumFrame == null) return false;
        cancelAnimationFrame(momentumFrame);
        momentumFrame = null;
        return true;
    }
    function startMomentum(unitsPerMs) {
        let last = performance.now();
        const step = (now) => {
            const dt = Math.min(64, Math.max(0, now - last));
            last = now;
            const span = state.view[1] - state.view[0];
            const moved = setView(state.view[0] + unitsPerMs * dt, state.view[1] + unitsPerMs * dt);
            unitsPerMs *= FRICTION ** (dt / (1000 / 60));
            if (!moved || Math.abs(unitsPerMs) * (width / span) < STOP_SPEED) {
                momentumFrame = null;
                render();
                follow(true);
                return;
            }
            render(true);
            follow(false);
            momentumFrame = requestAnimationFrame(step);
        };
        momentumFrame = requestAnimationFrame(step);
    }
    const GRAB = 34; // px around the dot that count as "on the dot"
    const TAP_SLOP = 6; // px a finger may wobble and still count as a tap
    let scrub = null; // { px, pageX, pageY, touch } of the scrubbing finger
    let edgeFrame = null;
    let edgeMoved = false; // the view moved along during this scrub
    const EDGE = 28; // px from either end where the view starts moving along

    const hoverAt = (px) => {
        const i = bisect.center(data, x.invert(Math.min(Math.max(px, 0), width)));
        syncHover(data[i], scrub.pageX, scrub.pageY, 'elevation', scrub.touch);
    };

    // Held near (or past) an end while zoomed: move the view along, faster the further out
    function edgeStep() {
        edgeFrame = null;
        if (!scrub || !state.full || !isZoomed()) return;
        const depth = scrub.px < EDGE ? scrub.px - EDGE : scrub.px > width - EDGE ? scrub.px - (width - EDGE) : 0;
        if (!depth) return;
        const span = state.view[1] - state.view[0];
        const shift = Math.max(-1, Math.min(1, depth / EDGE)) * span * 0.025;
        if (!setView(state.view[0] + shift, state.view[1] + shift)) return; // reached the start/end of the hike
        edgeMoved = true;
        render(true);
        hoverAt(scrub.px);
        follow(false);
        edgeFrame = requestAnimationFrame(edgeStep);
    }

    function onScrub(event, px) {
        if (peek()) return; // phone, small map: a tap opens the full-screen map instead
        const pressed = event.pointerType !== 'mouse' || event.buttons > 0;
        scrub = { px, pageX: event.pageX, pageY: event.pageY, touch: event.pointerType === 'touch' };
        hoverAt(px);
        if (state.full && pressed && edgeFrame == null) edgeFrame = requestAnimationFrame(edgeStep);
    }

    function endGesture(event) {
        pointers.delete(event.pointerId);
        if (pinch && pointers.size < 2) {
            pinch = null;
            afterPinch = pointers.size > 0;
            follow(true);
        }
        if (pan && pointers.size === 0) {
            // A flick (still moving fast when the finger lifts): let it slide on
            const recent = pan.samples.filter((p) => event.timeStamp - p.t <= FLICK_MS);
            const first = recent[0], lastS = recent[recent.length - 1];
            const speed = first && lastS.t > first.t ? (lastS.v - first.v) / (lastS.t - first.t) : 0; // display units per ms
            const span = state.view[1] - state.view[0];
            if (pan.moved && event.type === 'pointerup'
                && Math.abs(speed) * (width / span) >= MIN_FLICK) startMomentum(speed);
            else if (pan.moved) follow(true);
            else if (event.type === 'pointerup') onScrub(event, pan.px); // a tap: put the dot there
            pan = null;
            if (edgeFrame != null) { cancelAnimationFrame(edgeFrame); edgeFrame = null; }
        }
        if (pointers.size === 0) {
            afterPinch = false;
            if (edgeFrame != null) { cancelAnimationFrame(edgeFrame); edgeFrame = null; }
            if (edgeMoved) { edgeMoved = false; follow(true); }
        }
    }

    overlay
        .style('touch-action', state.full ? 'none' : 'pan-y')
        .on('pointerdown', (event) => {
            if (peek()) return;
            if (stopMomentum()) follow(true); // a finger down catches a sliding profile (the map settles there)
            const [px] = d3.pointer(event);
            pointers.set(event.pointerId, px);
            if (state.full) event.currentTarget.setPointerCapture(event.pointerId);
            if (state.full && pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                pinch = { va: x.invert(a), vb: x.invert(b) };
                scrub = null;
                pan = null;
                return;
            }
            if (pointers.size !== 1) return;
            const dotPx = state.hover ? x(state.hover.point.distance) : null;
            const onDot = dotPx != null && dotPx >= 0 && dotPx <= width && Math.abs(px - dotPx) <= GRAB;
            if (state.full && isZoomed() && !onDot) {
                pan = { px, view: [...state.view], moved: false, samples: [] };
                return;
            }
            onScrub(event, px);
        })
        .on('pointermove', (event) => {
            const [px] = d3.pointer(event);
            if (pointers.has(event.pointerId)) pointers.set(event.pointerId, px);
            if (pinch) {
                const [a, b] = [...pointers.values()];
                const pxPerUnit = (b - a) / (pinch.vb - pinch.va);
                if (!(pxPerUnit > 0) || Math.abs(b - a) < 12) return; // fingers crossed / together
                const start = pinch.va - a / pxPerUnit;
                setView(start, start + width / pxPerUnit);
                render(true);
                follow(false);
                return;
            }
            if (afterPinch) return;
            if (pan) {
                const dx = px - pan.px;
                if (!pan.moved && Math.abs(dx) < TAP_SLOP) return;
                pan.moved = true;
                const span = pan.view[1] - pan.view[0];
                const start = pan.view[0] - (dx / width) * span;
                setView(start, start + span);
                pan.samples.push({ t: event.timeStamp, v: state.view[0] });
                if (pan.samples.length > 20) pan.samples.shift();
                render(true);
                follow(false);
                return;
            }
            if (pointers.size <= 1) onScrub(event, px);
        })
        .on('pointerup pointercancel', endGesture)
        .on('click', () => { if (peek()) openFull(); })
        .on('pointerleave', (event) => {
            if (event.pointerType === 'mouse' && !event.buttons) { scrub = null; syncHover(null); }
        });

    // Mouse wheel / trackpad in the full-screen view, zooming around the pointer:
    //   trackpad pinch (the browser sends it as wheel + ctrlKey) → zoom, fast enough to feel direct
    //   scroll up/down (mouse wheel or two fingers)            → zoom
    //   two fingers sideways (or shift + wheel)                → move along the hike
    // A trackpad swipe is locked to its main direction, so a slightly diagonal
    // swipe doesn't zoom and move at the same time.
    const PINCH_SPEED = 0.012;
    const SCROLL_SPEED = 0.0025;
    let wheelTimer = null;
    overlay.node().addEventListener('wheel', (event) => {
        if (!state.full) return;
        event.preventDefault();
        // Lines / pages (some mice, Firefox) → pixels
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
        let dx = event.deltaX * unit;
        let dy = event.deltaY * unit;
        if (event.shiftKey && !dx) { dx = dy; dy = 0; } // shift + wheel = sideways
        let zoomBy = 0;
        if (event.ctrlKey) {
            zoomBy = dy * PINCH_SPEED;
            dx = 0;
        } else if (Math.abs(dx) <= Math.abs(dy)) { // mostly up/down = zoom, else sideways = move
            zoomBy = dy * SCROLL_SPEED;
            dx = 0;
        }
        const [px] = d3.pointer(event);
        const span = state.view[1] - state.view[0];
        const at = x.invert(px);
        const newSpan = span * Math.exp(Math.max(-0.5, Math.min(0.5, zoomBy)));
        const start = at - (px / width) * newSpan + (dx / width) * span;
        setView(start, start + newSpan);
        render(true);
        follow(false);
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => follow(true), 250);
    }, { passive: false });
}
