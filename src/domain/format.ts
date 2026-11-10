import { formatNumber } from './money';

/** "1 sale", "3 sales", "1,204 units". Pass the plural form when it isn't the singular + "s". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatNumber(count)} ${pluralWord(count, one, many)}`;
}

/** Just the word for a count: pluralWord(1, 'is', 'are') → "is". */
export function pluralWord(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}
