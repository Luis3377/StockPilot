import { describe, expect, it } from 'vitest';
import { plural, pluralWord } from './format';

describe('plural', () => {
  it('uses the singular only for exactly 1', () => {
    expect(plural(1, 'sale')).toBe('1 sale');
    expect(plural(0, 'sale')).toBe('0 sales');
    expect(plural(2, 'unit')).toBe('2 units');
    expect(plural(1, 'category', 'categories')).toBe('1 category');
    expect(plural(3, 'category', 'categories')).toBe('3 categories');
    expect(plural(1204, 'unit')).toBe('1,204 units');
  });

  it('picks just the word', () => {
    expect(pluralWord(1, 'is', 'are')).toBe('is');
    expect(pluralWord(4, 'is', 'are')).toBe('are');
    expect(pluralWord(0, 'item')).toBe('items');
  });
});
