import { describe, expect, it } from 'vitest';
import { buildDemoData } from './demo';
import { sanitizeAppData } from './sanitize';

describe('demo data', () => {
  it('builds a valid, internally consistent dataset', () => {
    const data = buildDemoData('2026-10-28');
    expect(data.items.length).toBeGreaterThan(20);
    expect(data.sales.length).toBeGreaterThan(20);
    expect(data.items.every((i) => i.quantity >= 0)).toBe(true);
    expect(data.items.every((i) => i.notes.includes('Sample'))).toBe(true);
    expect(data.countHistory).toHaveLength(1);
    expect(data.adjustments.filter((a) => a.source === 'count_check')).toHaveLength(1);
    expect(sanitizeAppData(JSON.parse(JSON.stringify(data)))).toEqual(data);
    expect(data.sales.every((s) => s.saleDate <= '2026-10-28')).toBe(true);
  });
});
