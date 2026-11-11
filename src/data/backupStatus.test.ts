import { describe, expect, it } from 'vitest';
import { BACKUP_STALE_DAYS, backupAgeText, backupStatus, latestChange } from './backupStatus';
import { recordSale } from '../domain/actions';
import { clock, withItem } from '../domain/testUtils';
import { emptyData } from '../domain/types';

const NOW = Date.parse('2026-10-28T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('backup reminder', () => {
  it('stays quiet while there is nothing to protect', () => {
    expect(backupStatus(emptyData(), null, NOW)).toMatchObject({ due: false, records: 0 });
  });

  it('is due as soon as something is recorded and there has never been a backup', () => {
    const { data } = withItem();
    expect(backupStatus(data, null, NOW)).toMatchObject({ due: true, reason: 'never', daysSinceBackup: null, records: 1 });
  });

  it('is not due right after a backup, even with later changes, until a week has passed', () => {
    const { data } = withItem(); // created 2026-10-28T12:00
    expect(backupStatus(data, daysAgo(0), NOW)).toMatchObject({ due: false, changedSinceBackup: false });
    expect(backupStatus(data, daysAgo(3), NOW)).toMatchObject({ due: false, changedSinceBackup: true, daysSinceBackup: 3 });
    expect(backupStatus(data, daysAgo(BACKUP_STALE_DAYS), NOW)).toMatchObject({ due: true, reason: 'stale', daysSinceBackup: BACKUP_STALE_DAYS });
  });

  it('is not due for an old backup when nothing changed since', () => {
    const { data } = withItem();
    const after = new Date(Date.parse(latestChange(data)!) + 1000).toISOString();
    expect(backupStatus(data, after, NOW + 30 * 86_400_000)).toMatchObject({ due: false, changedSinceBackup: false });
  });

  it('counts sales, adjustments and counts as changes', () => {
    const { data, item } = withItem();
    const later = recordSale(data, { itemId: item.id, quantity: 1, salePrice: 20, priceMode: 'per_unit', fees: 0, shipping: 0, otherExpenses: 0, platform: '', saleDate: '2026-10-29', notes: '' }, clock('2026-10-29T09:00:00.000Z'));
    expect(latestChange(later.data)! > latestChange(data)!).toBe(true);
  });

  it('describes the age of the last backup in plain words', () => {
    expect(backupAgeText(null, NOW)).toBe('never');
    expect(backupAgeText(daysAgo(0), NOW)).toBe('today');
    expect(backupAgeText(daysAgo(1), NOW)).toBe('yesterday');
    expect(backupAgeText(daysAgo(12), NOW)).toBe('12 days ago');
  });
});
