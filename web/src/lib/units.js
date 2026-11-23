import { APP_CONFIG } from '../config.js';

const KM_PER_MI = 1.609344;
const M_PER_FT = 0.3048;

const imperial = () => APP_CONFIG.units === 'imperial';

export const distUnit = () => (imperial() ? 'mi' : 'km');
export const elevUnit = () => (imperial() ? 'ft' : 'm');

/** km -> display unit (number) */
export const dist = (km) => (imperial() ? km / KM_PER_MI : km);
/** m -> display unit (number) */
export const elev = (m) => (imperial() ? m / M_PER_FT : m);

const nf = (digits) => new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const fmtDist = (km, digits = 1) => `${nf(digits).format(dist(km))} ${distUnit()}`;
export const fmtElev = (m) => `${nf(0).format(elev(m))} ${elevUnit()}`;

export function fmtDuration(hours) {
    if (hours == null) return null;
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return m === 60 ? `${h + 1}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

export function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime())
        ? iso
        : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** An estimate: rounded to 5 minutes ("45 min", "4h 05m"). */
export function fmtWalk(hours) {
    if (hours == null || !Number.isFinite(hours)) return null;
    const total = Math.max(5, Math.round((hours * 60) / 5) * 5);
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m} min`;
    return `${h}h ${String(m).padStart(2, '0')}m`;
}
