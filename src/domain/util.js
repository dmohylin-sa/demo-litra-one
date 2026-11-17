import dayjs from 'dayjs';

export const D = dayjs;
const F = 'YYYY-MM-DDTHH:mm';

export const addMin = (iso, m) => dayjs(iso).add(Math.round(m), 'minute').format(F);
export const diffMin = (a, b) => dayjs(a).diff(dayjs(b), 'minute'); // a - b
export const isBefore = (a, b) => dayjs(a).isBefore(dayjs(b));
export const maxIso = (a, b) => (dayjs(a).isAfter(dayjs(b)) ? a : b);
export const dateOf = (iso) => (iso ? iso.slice(0, 10) : '');
export const at = (date, hhmm) => `${date}T${hhmm}`;
export const hhmm = (iso) => (iso ? dayjs(iso).format('HH:mm') : '-');
export const fmtDate = (iso) => (iso ? dayjs(iso).format('D MMM YYYY') : '-');
export const fmtDay = (iso) => (iso ? dayjs(iso).format('ddd D MMM') : '-');
export const fmtDateTime = (iso) => (iso ? dayjs(iso).format('D MMM, HH:mm') : '-');

export function fmtNum(n, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return '-';
  return Number(n).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export const fmtQty = (n, unit) => `${fmtNum(n)} ${unit}`;
export function fmtMoney(n, currency = 'NOK') {
  return `${currency} ${fmtNum(n, 2)}`;
}
export function fmtDur(min) {
  if (min === null || min === undefined) return '-';
  const m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  const s = h ? `${h}h ${String(r).padStart(2, '0')}m` : `${r}m`;
  return min < 0 ? `-${s}` : s;
}
export const fmtPct = (x, digits = 0) => `${fmtNum(x * 100, digits)}%`;
export const round2 = (x) => Math.round(x * 100) / 100;

// Small deterministic PRNG so the mocked history is identical on every reset.
export function rng(seed = 42) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stable 0..1 hash of a string - used for "learned preference" figures so they stay constant.
export function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.replace(/[^\p{L}]/gu, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

export const uid = (prefix = 'id') => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
