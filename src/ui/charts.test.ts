import { describe, expect, it } from 'vitest';
import { niceTicks } from './charts';

describe('niceTicks', () => {
  it('always contains the data range', () => {
    for (const [lo, hi, zero] of [[2983, 4107, false], [-32, 1015, true], [0, 0, true], [5, 5, false], [0.1, 0.7, true]] as const) {
      const t = niceTicks(lo, hi, 4, zero);
      expect(t[0]).toBeLessThanOrEqual(lo);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(hi);
      expect(t.length).toBeGreaterThanOrEqual(2);
    }
    expect(niceTicks(2983, 4107, 4, false)).toEqual([2500, 3000, 3500, 4000, 4500]);
    expect(niceTicks(0, 1157)).toEqual([0, 500, 1000, 1500]);
  });
});
