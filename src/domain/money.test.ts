import { describe, expect, it } from 'vitest';
import { formatPercent, parseMoneyInput, percent, roundMoney, sumMoney, toCents } from './money';

describe('money', () => {
  it('rounds to cents without floating point drift', () => {
    expect(toCents(1.005)).toBe(101);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
    expect(sumMoney([19.99, 19.99, 19.99])).toBe(59.97);
  });

  it('computes percentages only for positive denominators', () => {
    expect(percent(25, 100)).toBe(25);
    expect(percent(5, 0)).toBeNull();
    expect(percent(5, -10)).toBeNull();
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(12.345)).toBe('12.3%');
  });

  it('parses typed money', () => {
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('  ')).toBeNull();
    expect(parseMoneyInput('$1,234.50')).toBe(1234.5);
    expect(parseMoneyInput('12')).toBe(12);
    expect(parseMoneyInput('.5')).toBe(0.5);
    expect(parseMoneyInput('-3')).toBe(-3);
    expect(parseMoneyInput('abc')).toBeNaN();
    expect(parseMoneyInput('1.2.3')).toBeNaN();
  });
});
