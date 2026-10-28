// Money is stored as plain numbers in currency units (e.g. dollars) exactly as the user
// typed them. Every calculation result is rounded to whole cents so totals never drift
// (0.1 + 0.2 style errors) and what the user sees always adds up.

/** Converts an amount to integer cents, tolerating binary floating-point noise (1.005 -> 101). */
export function toCents(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(Number((amount * 100).toPrecision(12)));
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function roundMoney(amount: number): number {
  return fromCents(toCents(amount));
}

/** Sums money values at cent precision. */
export function sumMoney(values: Iterable<number>): number {
  let cents = 0;
  for (const v of values) cents += toCents(v);
  return fromCents(cents);
}

/** a × qty rounded to cents. */
export function multiplyMoney(amount: number, quantity: number): number {
  return roundMoney(amount * quantity);
}

/** Percentage (e.g. 25.0 for 25%) or null when the denominator is not positive. */
export function percent(numerator: number, denominator: number): number | null {
  if (!(denominator > 0)) return null;
  return (numerator / denominator) * 100;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function moneyFormatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}:${compact}`;
  let f = formatterCache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        ...(compact ? { notation: 'compact', minimumFractionDigits: 0, maximumFractionDigits: 1 } : {}),
      });
    } catch {
      f = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
    }
    formatterCache.set(key, f);
  }
  return f;
}

export function formatMoney(amount: number, currency = 'USD'): string {
  return moneyFormatter(currency, false).format(roundMoney(amount));
}

/** $1,284 → $1.3K style, for axis ticks and tight spaces. */
export function formatMoneyCompact(amount: number, currency = 'USD'): string {
  if (Math.abs(amount) < 1000 && !Number.isInteger(amount)) return formatMoney(amount, currency);
  return moneyFormatter(currency, true).format(amount);
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/**
 * Parses user-typed money ("$1,234.50", " 12 ") into a number.
 * Returns null for blank input and NaN for unparseable input.
 */
export function parseMoneyInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith('-');
  const cleaned = trimmed.replace(/[()\s$€£¥,]/g, '').replace(/^-/, '');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return Number.NaN;
  const value = Number(cleaned);
  return negative ? -value : value;
}
