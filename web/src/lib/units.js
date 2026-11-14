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
