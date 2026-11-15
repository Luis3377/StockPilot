// Manual beta finding: the Sony headphones were bought June 17, 2026, yet a sale dated
// January 30, 2026 was accepted without a word. A sale before the purchase is now explained
// before saving and recorded only with a reason; older records are flagged, never re-dated.
import { describe, expect, it } from 'vitest';
import { addItem, recordSale, recordedPurchaseDate, saleInputErrors, updateSale } from './actions';
import { createLot } from './lots';
import { emptyData, defaultSettings } from './types';
import { clock } from './testUtils';
import { createBackup, parseBackup } from '../data/backup';
import { calcContext, saleWarnings } from '../insights/calculations';
import { monthFigures } from '../insights/monthly';

const sony = () => addItem(emptyData(), { name: 'Sony headphones', quantity: 1, unitCost: 120, purchaseDate: '2026-06-17' }, clock());
const sale = (itemId: string, saleDate: string, dateException?: string) => ({ itemId, quantity: 1, salePrice: 165, priceMode: 'total' as const, saleDate, dateException });

describe('sales dated before the purchase', () => {
  it('are explained and refused without a reason', () => {
    const { data, item } = sony();
    expect(saleInputErrors(data, sale(item.id, '2026-01-30'), null)).toEqual({
      dateException: 'The sale date (Jan 30, 2026) is before “Sony headphones” was bought (Jun 17, 2026). Check both dates. If the sale really came first (a preorder, or you’re correcting an earlier record), say why to record it anyway: until then it would put a sale in a month before the item was in your inventory.',
    });
    expect(() => recordSale(data, sale(item.id, '2026-01-30'))).toThrow();
    expect(data.items[0].quantity).toBe(1); // nothing changed
  });

  it('are recorded with an explicit reason, which is kept, and the date is never changed', () => {
    const { data, item } = sony();
    const r = recordSale(data, sale(item.id, '2026-01-30', 'Preorder paid in January, shipped in June'));
    expect(r.sale.saleDate).toBe('2026-01-30');
    expect(r.sale.dateException).toBe('Preorder paid in January, shipped in June');
    // Kept in backups.
    const restored = parseBackup(JSON.stringify(createBackup('real', defaultSettings(), r.data, [])));
    expect(restored.data.sales[0].dateException).toBe('Preorder paid in January, shipped in June');
  });

  it('a sale on or after the purchase date, or for an item with no recorded purchase date, needs nothing', () => {
    const { data, item } = sony();
    expect(recordSale(data, sale(item.id, '2026-06-17')).sale.dateException).toBeUndefined();
    const undated = addItem(emptyData(), { name: 'Old lamp', quantity: 1, unitCost: 8 }, clock());
    expect(saleInputErrors(undated.data, sale(undated.item.id, '2020-01-01'), null)).toEqual({});
  });

  it('bulk-lot items use the lot’s purchase date', () => {
    const lot = createLot(emptyData(), { name: 'Pallet', purchasePrice: 100, extraCosts: [], purchaseDate: '2026-05-01', source: '', notes: '', method: 'equal', lines: [{ name: 'Drill', quantity: 2, estimatedUnitValue: 40, category: 'Tools' }] }, clock());
    const drill = lot.items[0];
    expect(recordedPurchaseDate(lot.data, drill)).toBe('2026-05-01');
    expect(Object.keys(saleInputErrors(lot.data, sale(drill.id, '2026-04-30'), null))).toEqual(['dateException']);
  });

  it('editing: moving the date before the purchase needs a reason; other edits of an older record don’t', () => {
    const { data, item } = sony();
    const ok = recordSale(data, sale(item.id, '2026-07-01'));
    expect(() => updateSale(ok.data, ok.sale.id, sale(item.id, '2026-01-30'))).toThrow();
    // A record already dated early (from before this check) can still have its notes edited.
    const legacy = { ...ok.data, sales: ok.data.sales.map((s) => ({ ...s, saleDate: '2026-01-30' })) };
    const edited = updateSale(legacy, ok.sale.id, { ...sale(item.id, '2026-01-30'), notes: 'Buyer: J.' });
    expect(edited.sale.notes).toBe('Buyer: J.');
    expect(edited.sale.saleDate).toBe('2026-01-30');
  });

  it('older records dated before the purchase are flagged wherever sale warnings appear; profit and dates are unchanged', () => {
    const { data, item } = sony();
    const ok = recordSale(data, sale(item.id, '2026-07-01'));
    const legacy = { ...ok.data, sales: ok.data.sales.map((s) => ({ ...s, saleDate: '2026-01-30' })) };
    const ctx = calcContext(legacy, defaultSettings(), '2026-11-15');
    expect(saleWarnings(ctx, legacy.sales)).toContain('Sony headphones was sold on Jan 30, 2026, before its recorded purchase date (Jun 17, 2026). Check both dates: as recorded, the sale’s cost of goods sold falls in a month before the item was in inventory.');
    // Consequence for monthly reporting: the sale (and its $120 cost) count in January, as dated.
    expect(monthFigures(legacy, defaultSettings(), '2026-01', '2026-11-15').totals.costOfGoods).toBe(120);
    // With a stated reason the warning is no longer raised.
    const explained = { ...legacy, sales: legacy.sales.map((s) => ({ ...s, dateException: 'Preorder' })) };
    expect(saleWarnings(calcContext(explained, defaultSettings(), '2026-11-15'), explained.sales).some((w) => w.includes('before its recorded purchase date'))).toBe(false);
  });
});
