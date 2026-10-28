import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween, isValidISODate, parseFlexibleDate, periodRange, previousPeriodRange } from './dates';

describe('dates', () => {
  it('validates ISO dates including impossible days', () => {
    expect(isValidISODate('2026-02-28')).toBe(true);
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2026-2-3')).toBe(false);
  });

  it('parses flexible date formats', () => {
    expect(parseFlexibleDate('2026-03-05')).toBe('2026-03-05');
    expect(parseFlexibleDate('3/5/2026')).toBe('2026-03-05');
    expect(parseFlexibleDate('03/05/26')).toBe('2026-03-05');
    expect(parseFlexibleDate('2026-3-5')).toBe('2026-03-05');
    expect(parseFlexibleDate('13/45/2026')).toBeNull();
    expect(parseFlexibleDate('')).toBeNull();
  });

  it('computes day differences and month math', () => {
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('builds period ranges', () => {
    expect(periodRange('this_month', '2026-10-28')).toMatchObject({ start: '2026-10-01', end: '2026-10-28' });
    expect(periodRange('last_month', '2026-03-15')).toMatchObject({ start: '2026-02-01', end: '2026-02-28' });
    expect(periodRange('last_30', '2026-10-28')).toMatchObject({ start: '2026-09-29', end: '2026-10-28' });
    expect(periodRange('all', '2026-10-28')).toMatchObject({ start: null, end: null });
  });
});

describe('previousPeriodRange', () => {
  it('compares like-for-like spans', () => {
    expect(previousPeriodRange('this_month', '2026-10-28')).toMatchObject({ start: '2026-09-01', end: '2026-09-28' });
    expect(previousPeriodRange('this_month', '2026-03-31')).toMatchObject({ start: '2026-02-01', end: '2026-02-28' });
    expect(previousPeriodRange('last_30', '2026-10-28')).toMatchObject({ start: '2026-08-30', end: '2026-09-28' });
    expect(previousPeriodRange('this_year', '2026-10-28')).toMatchObject({ start: '2025-01-01', end: '2025-10-28' });
    expect(previousPeriodRange('all', '2026-10-28')).toBeNull();
  });
});
