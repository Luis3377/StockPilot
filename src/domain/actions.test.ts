import { describe, expect, it } from 'vitest';
import {
  addItem,
  adjustQuantity,
  completeCount,
  compareCount,
  deleteItem,
  deleteSale,
  nextSku,
  recordSale,
  restockItem,
  setCount,
  startCount,
  updateItem,
  updateSale,
  upsertSnapshot,
  type SaleInput,
} from './actions';
import { totalSales } from './calc';
import { emptyData } from './types';
import { clock, withItem } from './testUtils';

const sale = (itemId: string, quantity: number, extra: Partial<SaleInput> = {}): SaleInput => ({
  itemId,
  quantity,
  salePrice: 30,
  priceMode: 'per_unit',
  saleDate: '2026-10-20',
  ...extra,
});

describe('items', () => {
  it('adds an item with an auto SKU and validates required fields', () => {
    const { data, item } = withItem();
    expect(item.sku).toBe('SP-0001');
    expect(data.items).toHaveLength(1);
    expect(nextSku(data.items)).toBe('SP-0002');
    expect(() => addItem(data, { name: '  ', quantity: 1, unitCost: 1 })).toThrow('Item name is required');
    expect(() => addItem(data, { name: 'x', quantity: -1, unitCost: 1 })).toThrow("can't be negative");
    expect(() => addItem(data, { name: 'x', quantity: 1.5, unitCost: 1 })).toThrow('whole number');
    expect(() => addItem(data, { name: 'x', quantity: 1, unitCost: null })).toThrow('Cost per item is required');
    expect(() => addItem(data, { name: 'x', quantity: 1, unitCost: 1, purchaseDate: '2026-02-31' })).toThrow('valid date');
  });

  it('rejects duplicate SKUs case-insensitively', () => {
    const { data } = withItem({ sku: 'ABC-1' });
    expect(() => addItem(data, { name: 'Other', sku: 'abc-1', quantity: 1, unitCost: 1 })).toThrow('already used');
  });

  it('logs quantity edits and optionally rewrites sale costs', () => {
    let { data, item } = withItem({ quantity: 5, unitCost: 100 });
    data = recordSale(data, sale(item.id, 1)).data;
    const edited = updateItem(data, item.id, { name: 'Renamed', quantity: 6, unitCost: 10, category: 'Toys' }, {}, clock());
    expect(edited.item.quantity).toBe(6);
    expect(edited.data.adjustments).toHaveLength(1);
    expect(edited.data.adjustments[0]).toMatchObject({ previousQuantity: 4, newQuantity: 6, difference: 2, source: 'edit' });
    // Snapshot names follow the item, but cost only changes when asked.
    expect(edited.data.sales[0]).toMatchObject({ itemName: 'Renamed', itemCategory: 'Toys', unitCost: 100 });
    const corrected = updateItem(data, item.id, { name: 'Renamed', quantity: 4, unitCost: 10 }, { applyCostToSales: true });
    expect(corrected.data.sales[0].unitCost).toBe(10);
    expect(corrected.data.adjustments).toHaveLength(0);
  });

  it('tracks estimated value history', () => {
    let { data, item } = withItem({ estimatedValue: 50 });
    expect(item.valueHistory).toEqual([{ date: '2026-10-28', value: 50 }]);
    data = updateItem(data, item.id, { name: item.name, quantity: 5, unitCost: 10, estimatedValue: 60 }, {}, clock('2026-11-02T12:00:00Z')).data;
    expect(data.items[0].valueHistory.map((p) => p.value)).toEqual([50, 60]);
  });

  it('deletes an item but keeps its sales history', () => {
    let { data, item } = withItem({ photoIds: ['p1'] });
    data = recordSale(data, sale(item.id, 2)).data;
    const result = deleteItem(data, item.id);
    expect(result.data.items).toHaveLength(0);
    expect(result.data.sales).toHaveLength(1);
    expect(result.removedPhotoIds).toEqual(['p1']);
  });

  it('restocks using a weighted average cost', () => {
    const { data, item } = withItem({ quantity: 2, unitCost: 10 });
    const r = restockItem(data, item.id, 1, 0, clock());
    expect(r.item.quantity).toBe(3);
    expect(r.item.unitCost).toBe(6.6667);
    expect(r.data.adjustments[0]).toMatchObject({ source: 'restock', difference: 1 });
  });

  it('adjusts quantity manually with a required reason', () => {
    const { data, item } = withItem({ quantity: 5, unitCost: 2 });
    expect(() => adjustQuantity(data, item.id, 4, '')).toThrow('Reason is required');
    const r = adjustQuantity(data, item.id, 3, 'Damaged');
    expect(r.data.items[0].quantity).toBe(3);
    expect(r.adjustment).toMatchObject({ difference: -2, valueDifference: -4, reason: 'Damaged', source: 'manual' });
  });
});

describe('sales', () => {
  it('reduces inventory when a sale is recorded and snapshots cost', () => {
    const { data, item } = withItem({ quantity: 5, unitCost: 10 });
    const r = recordSale(data, sale(item.id, 2, { fees: 5 }));
    expect(r.data.items[0].quantity).toBe(3);
    expect(r.sale).toMatchObject({ unitCost: 10, itemName: 'Test item', quantity: 2 });
    expect(totalSales(r.data.sales).netProfit).toBe(35);
  });

  it('never allows selling more than is in stock', () => {
    const { data, item } = withItem({ quantity: 2 });
    expect(() => recordSale(data, sale(item.id, 3))).toThrow('Only 2 of "Test item" are available');
    const sold = recordSale(data, sale(item.id, 2)).data;
    expect(() => recordSale(sold, sale(item.id, 1))).toThrow('no units left');
    expect(() => recordSale(data, sale(item.id, 0))).toThrow('at least 1');
  });

  it('edits quantity without double-counting stock', () => {
    let { data, item } = withItem({ quantity: 5 });
    const first = recordSale(data, sale(item.id, 2));
    data = first.data;
    expect(data.items[0].quantity).toBe(3);
    data = updateSale(data, first.sale.id, sale(item.id, 4)).data;
    expect(data.items[0].quantity).toBe(1);
    data = updateSale(data, first.sale.id, sale(item.id, 1)).data;
    expect(data.items[0].quantity).toBe(4);
    // 1 sold, 4 on hand: editing up to 5 is fine, 6 is not.
    expect(() => updateSale(data, first.sale.id, sale(item.id, 6))).toThrow('Only 5');
    data = updateSale(data, first.sale.id, sale(item.id, 5)).data;
    expect(data.items[0].quantity).toBe(0);
  });

  it('moves stock correctly when a sale is reassigned to another item', () => {
    let { data, item: a } = withItem({ name: 'A', quantity: 5, unitCost: 10 });
    const b = addItem(data, { name: 'B', quantity: 3, unitCost: 20 });
    data = b.data;
    const s = recordSale(data, sale(a.id, 2));
    data = updateSale(s.data, s.sale.id, sale(b.item.id, 1)).data;
    const byName = Object.fromEntries(data.items.map((i) => [i.name, i.quantity]));
    expect(byName).toEqual({ A: 5, B: 2 });
    expect(data.sales[0]).toMatchObject({ itemName: 'B', unitCost: 20 });
  });

  it('cancelling a sale restores stock exactly once', () => {
    let { data, item } = withItem({ quantity: 5 });
    const s = recordSale(data, sale(item.id, 3));
    const r = deleteSale(s.data, s.sale.id);
    expect(r.restored).toBe(true);
    expect(r.data.items[0].quantity).toBe(5);
    expect(r.data.sales).toHaveLength(0);
    expect(() => deleteSale(r.data, s.sale.id)).toThrow('no longer exists');
  });

  it('handles sales whose item was deleted', () => {
    let { data, item } = withItem({ quantity: 5 });
    const s = recordSale(data, sale(item.id, 2));
    data = deleteItem(s.data, item.id).data;
    expect(() => updateSale(data, s.sale.id, sale(item.id, 3))).toThrow('was deleted');
    data = updateSale(data, s.sale.id, sale(item.id, 2, { salePrice: 99 })).data;
    expect(data.sales[0].salePrice).toBe(99);
    const r = deleteSale(data, s.sale.id);
    expect(r.restored).toBe(false);
    expect(r.data.sales).toHaveLength(0);
  });

  it('validates sale money fields', () => {
    const { data, item } = withItem();
    expect(() => recordSale(data, sale(item.id, 1, { fees: -1 }))).toThrow("Marketplace fees can't be negative");
    expect(() => recordSale(data, sale(item.id, 1, { salePrice: null }))).toThrow('Sale price is required');
    expect(() => recordSale(data, sale(item.id, 1, { saleDate: 'nope' }))).toThrow('valid sale date');
  });
});

describe('count check', () => {
  function setup() {
    let data = emptyData();
    const a = addItem(data, { name: 'A', quantity: 10, unitCost: 2, location: 'Shelf 1' });
    const b = addItem(a.data, { name: 'B', quantity: 4, unitCost: 5, location: 'Shelf 1' });
    const c = addItem(b.data, { name: 'C', quantity: 1, unitCost: 100, location: 'Bin 2' });
    data = c.data;
    return { data, a: a.item, b: b.item, c: c.item };
  }

  it('identifies missing, excess and matching items with value differences', () => {
    let { data, a, b, c } = setup();
    data = startCount(data, { category: null, location: null }, clock());
    data = setCount(data, a.id, 8);
    data = setCount(data, b.id, 6);
    data = setCount(data, c.id, 1);
    const cmp = compareCount(data.items, data.countDraft!);
    expect(cmp.matching).toBe(1);
    expect(cmp.missingUnits).toBe(2);
    expect(cmp.excessUnits).toBe(2);
    expect(cmp.missingValue).toBe(-4);
    expect(cmp.excessValue).toBe(10);
    expect(cmp.netValueDifference).toBe(6);
    expect(cmp.lines.find((l) => l.itemId === a.id)?.status).toBe('missing');
  });

  it('only applies approved adjustments and records history', () => {
    let { data, a, b } = setup();
    data = startCount(data, { category: null, location: 'shelf 1' });
    expect(() => startCount(data, { category: null, location: null })).toThrow('already in progress');
    expect(compareCount(data.items, data.countDraft!).totalInScope).toBe(2);
    data = setCount(data, a.id, 7);
    data = setCount(data, b.id, 5);
    const r = completeCount(data, [
      { itemId: a.id, apply: true, reason: 'Damaged' },
      { itemId: b.id, apply: false, reason: '' },
    ]);
    const qty = Object.fromEntries(r.data.items.map((i) => [i.name, i.quantity]));
    expect(qty).toEqual({ A: 7, B: 4, C: 1 });
    expect(r.appliedCount).toBe(1);
    expect(r.data.adjustments[0]).toMatchObject({ reason: 'Damaged', difference: -3, valueDifference: -6, source: 'count_check' });
    expect(r.data.countDraft).toBeNull();
    expect(r.record.lines.map((l) => l.applied)).toEqual([true, false]);
  });

  it('compares against live quantities if a sale happens mid-count', () => {
    let { data, a } = setup();
    data = startCount(data, { category: null, location: null });
    data = setCount(data, a.id, 8);
    data = recordSale(data, sale(a.id, 2)).data;
    expect(compareCount(data.items, data.countDraft!).lines[0].status).toBe('match');
  });

  it('requires at least one counted item to finish', () => {
    let { data } = setup();
    data = startCount(data, { category: null, location: null });
    expect(() => completeCount(data, [])).toThrow('at least one');
    expect(() => setCount(data, 'x', -2)).toThrow("can't be negative");
  });
});

describe('snapshots', () => {
  it('upserts a single point per day', () => {
    let { data } = withItem({ quantity: 2, unitCost: 10, estimatedValue: 15 });
    data = upsertSnapshot(data, '2026-10-27');
    data = upsertSnapshot(data, '2026-10-28');
    data = upsertSnapshot(data, '2026-10-28');
    expect(data.snapshots).toEqual([
      { date: '2026-10-27', units: 2, cost: 20, value: 30 },
      { date: '2026-10-28', units: 2, cost: 20, value: 30 },
    ]);
  });
});
