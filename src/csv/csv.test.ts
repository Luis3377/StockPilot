import { describe, expect, it } from 'vitest';
import { parseCsv, toCsv } from './csv';

describe('csv', () => {
  it('parses quotes, escaped quotes, newlines, CRLF and BOM', () => {
    const text = '﻿name,notes\r\n"Widget, large","He said ""hi""\nline 2"\r\nPlain,\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'notes'],
      ['Widget, large', 'He said "hi"\nline 2'],
      ['Plain', ''],
    ]);
  });

  it('handles a final row without a newline', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('round-trips through toCsv', () => {
    const rows = [['Comma, inside', 'Quote "q"', 'multi\nline', 12.5, null]];
    const parsed = parseCsv(toCsv(['a', 'b', 'c', 'd', 'e'], rows));
    expect(parsed[1]).toEqual(['Comma, inside', 'Quote "q"', 'multi\nline', '12.5', '']);
  });

  it('neutralises spreadsheet formulas in text but not numbers', () => {
    const out = toCsv(['x', 'y'], [['=HYPERLINK("evil")', -5]]);
    expect(out).toContain(`"'=HYPERLINK(""evil"")"`);
    expect(out).toContain(',-5');
  });
});
