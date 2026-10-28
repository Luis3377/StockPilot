// Calendar dates (purchase dates, sale dates) are stored as local "YYYY-MM-DD" strings so a
// sale entered at 11pm doesn't shift to the next day the way UTC timestamps would.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

export function isValidISODate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

/** Parses "YYYY-MM-DD" as a local date (midnight). */
export function parseISODate(value: string): Date {
  const m = ISO_DATE.exec(value);
  if (!m) return new Date(Number.NaN);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  const a = parseISODate(from);
  const b = parseISODate(to);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const d = parseISODate(date);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

export function addMonths(date: string, months: number): string {
  const d = parseISODate(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return toISODate(d);
}

/** "2026-10" for a YYYY-MM-DD date. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  const d = date.length === 10 ? parseISODate(date) : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatMonth(key: string): string {
  const d = parseISODate(`${key}-01`);
  return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Accepts YYYY-MM-DD, M/D/YYYY and M/D/YY (US order). Returns null if unparseable. */
export function parseFlexibleDate(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return null;
  if (isValidISODate(value)) return value;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(value);
  if (iso) {
    const candidate = `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
    return isValidISODate(candidate) ? candidate : null;
  }
  const us = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(value);
  if (us) {
    let year = Number(us[3]);
    if (us[3].length === 2) year += year >= 70 ? 1900 : 2000;
    const candidate = `${year}-${pad(Number(us[1]))}-${pad(Number(us[2]))}`;
    return isValidISODate(candidate) ? candidate : null;
  }
  return null;
}

export type PeriodKey = 'this_month' | 'last_month' | 'last_30' | 'last_90' | 'this_year' | 'last_year' | 'all';

export interface DateRange {
  start: string | null; // inclusive, null = unbounded
  end: string | null; // inclusive
  label: string;
}

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'this_month', label: 'This month' },
  { key: 'last_30', label: 'Last 30 days' },
  { key: 'last_90', label: 'Last 90 days' },
  { key: 'this_year', label: 'This year' },
  { key: 'all', label: 'All time' },
];

export function periodRange(key: PeriodKey, today: string = todayISO()): DateRange {
  switch (key) {
    case 'this_month':
      return { start: startOfMonth(today), end: today, label: 'this month' };
    case 'last_month': {
      const start = addMonths(startOfMonth(today), -1);
      return { start, end: addDays(startOfMonth(today), -1), label: 'last month' };
    }
    case 'last_30':
      return { start: addDays(today, -29), end: today, label: 'in the last 30 days' };
    case 'last_90':
      return { start: addDays(today, -89), end: today, label: 'in the last 90 days' };
    case 'this_year':
      return { start: `${today.slice(0, 4)}-01-01`, end: today, label: 'this year' };
    case 'last_year': {
      const y = Number(today.slice(0, 4)) - 1;
      return { start: `${y}-01-01`, end: `${y}-12-31`, label: 'last year' };
    }
    case 'all':
      return { start: null, end: null, label: 'all time' };
  }
}

/**
 * The comparable period just before `key` (e.g. Sep 1–28 for "this month" on Oct 28), so
 * month-to-date is compared with the same number of days. null for "all time".
 */
export function previousPeriodRange(key: PeriodKey, today: string = todayISO()): DateRange | null {
  const current = periodRange(key, today);
  if (!current.start || !current.end) return null;
  if (key === 'this_month' || key === 'this_year' || key === 'last_month' || key === 'last_year') {
    const months = key === 'this_month' || key === 'last_month' ? 1 : 12;
    const start = addMonths(current.start, -months);
    const end = addMonths(current.end, -months);
    const label = key === 'this_year' || key === 'last_year' ? `the same period in ${start.slice(0, 4)}` : 'the same days last month';
    return { start, end, label };
  }
  const span = daysBetween(current.start, current.end) + 1;
  return { start: addDays(current.start, -span), end: addDays(current.start, -1), label: `the previous ${span} days` };
}

export function inRange(date: string, range: DateRange): boolean {
  if (range.start && date < range.start) return false;
  if (range.end && date > range.end) return false;
  return true;
}
