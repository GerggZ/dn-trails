// Phones: the main page's list is a sheet pulled up from the bottom.
// Three heights: 'min' (just the title), 'mid' (about half), 'max' (nearly all).
// Drag the grip or the heading, or tap it (one step up; from the top back to the
// middle). On desktop the list is a column on the left and the sheet does nothing.

/**
 * @param {{ panel: HTMLElement, explore: HTMLElement, phone: MediaQueryList }} o
 * @returns {{ state: string, px: number, heights: () => object, height: () => number,
 *             set: (state: string, o?: { animate?: boolean }) => void }}
 *   height(): px of the map the sheet covers (0 on desktop)
 */
export function createSheet({ panel, explore, phone }) {
    const sheet = {
        state: 'mid',
        px: 0, // the height it is at (or moving to)
        heights() {
            const H = explore.clientHeight;
            return { min: 92, mid: Math.round(H * 0.45), max: H - 48 };
        },
        height() { return phone.matches ? this.px : 0; },
        set(state, { animate = true } = {}) {
            this.state = state;
            if (!phone.matches) { panel.style.height = ''; updateInsets(); return; }
            panel.classList.toggle('no-anim', !animate);
            this.px = this.heights()[state];
            panel.style.height = `${this.px}px`;
            panel.dataset.state = state;
            explore.classList.toggle('list-full', state === 'max');
            document.getElementById('panel-grip').setAttribute('aria-label', state === 'max' ? 'Show less of the list' : 'Show more of the list');
            updateInsets();
        },
    };

    function updateInsets() {
        // the card sits just above the sheet on phones
        explore.style.setProperty('--sheet-h', `${Math.round(sheet.height())}px`);
    }

    function setupSheetDrag() {
        const grip = document.getElementById('panel-grip');
        const head = panel.querySelector('.panel-head');
        let start = null;

        const down = (e) => {
            if (!phone.matches) return;
            start = { y: e.clientY, h: panel.getBoundingClientRect().height, moved: false };
            panel.classList.add('no-anim');
            e.currentTarget.setPointerCapture(e.pointerId);
        };
        const move = (e) => {
            if (!start) return;
            const dy = e.clientY - start.y;
            if (Math.abs(dy) > 6) start.moved = true;
            const { min, max } = sheet.heights();
            sheet.px = Math.min(max, Math.max(min, start.h - dy));
            panel.style.height = `${sheet.px}px`;
            updateInsets();
        };
        const up = () => {
            if (!start) return;
            const { moved } = start;
            start = null;
            panel.classList.remove('no-anim');
            if (!moved) { // a tap: one step up, from the top back to the middle
                sheet.set({ min: 'mid', mid: 'max', max: 'mid' }[sheet.state]);
                return;
            }
            const h = panel.getBoundingClientRect().height;
            const hs = sheet.heights();
            const nearest = Object.entries(hs).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0][0];
            sheet.set(nearest);
        };
        for (const target of [grip, head]) {
            target.addEventListener('pointerdown', down);
            target.addEventListener('pointermove', move);
            target.addEventListener('pointerup', up);
            target.addEventListener('pointercancel', up);
        }
        // The grip is a button for keyboards too
        grip.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sheet.set(sheet.state === 'max' ? 'mid' : 'max'); }
        });
    }

    setupSheetDrag();
    return sheet;
}
