import { describe, expect, it } from 'vitest';
import { addItem, adjustQuantity, deleteItem, deleteSale, recordSale, restockItem, saleUnitCost, updateItem, updateSale, type SaleInput } from './actions';
import { itemCostValue, totalSales } from './calc';
import { DomainError } from './errors';
import {
  allocate,
  applyLotEdit,
  createLot,
  lotEditErrors,
  lotForItem,
  lotInputErrors,
  lotSummary,
  lotTotal,
  planLotEdit,
  previewLot,
  splitCents,
  type LotEditInput,
  type LotInput,
  type LotLineInput,
} from './lots';
import { exactPerUnit, multiplyMoney, toCents, unitCentSplit } from './money';
import { emptyData, type AppData, type Lot } from './types';
import { clock } from './testUtils';

const line = (name: string, quantity: number, estimatedUnitValue: number | null, extra: Partial<LotLineInput> = {}): LotLineInput => ({
  name,
  quantity,
  estimatedUnitValue,
  ...extra,
});

const lotInput = (lines: LotLineInput[], extra: Partial<LotInput> = {}): LotInput => ({
  name: 'Estate sale box',
  purchasePrice: 100,
  extraCosts: [],
  purchaseDate: '2026-10-01',
  source: 'Estate sale',
  notes: '',
  method: 'relative_value',
  lines,
  ...extra,
});

const sell = (itemId: string, quantity: number, extra: Partial<SaleInput> = {}): SaleInput => ({
  itemId,
  quantity,
  salePrice: 40,
  priceMode: 'per_unit',
  fees: 0,
  shipping: 0,
  otherExpenses: 0,
  saleDate: '2026-10-20',
  ...extra,
});

const editOf = (lot: Lot, patch: Partial<LotEditInput> = {}): LotEditInput => ({
  name: lot.name,
  purchasePrice: lot.purchasePrice,
  extraCosts: lot.extraCosts.map((c) => ({ label: c.label, amount: c.amount })),
  purchaseDate: lot.purchaseDate,
  source: lot.source,
  notes: lot.notes,
  method: lot.method,
  estimates: Object.fromEntries(lot.lines.map((l) => [l.id, l.estimatedUnitValue])),
  ...patch,
});

const cents = (values: number[]) => values.reduce((c, v) => c + toCents(v), 0);

/** Σ cost of goods sold + written off + still in stock, for the lot's items (cents). */
function costAccountedFor(data: AppData, lot: Lot): number {
  const s = lotSummary(data, lot);
  return toCents(s.sales.costOfGoods) + toCents(s.writtenOff) + toCents(s.remainingCost) - toCents(s.addedLater);
}

const created = (input: LotInput, data: AppData = emptyData()) => createLot(data, input, clock());

describe('splitCents (largest remainder)', () => {
  it('always adds up to the total exactly', () => {
    expect(splitCents(10000, [100, 60, 40])).toEqual([5000, 3000, 2000]);
    expect(splitCents(10000, [1, 1, 1])).toEqual([3334, 3333, 3333]);
    expect(splitCents(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(splitCents(0, [5, 7])).toEqual([0, 0]);
    expect(splitCents(100, [0, 3, 0])).toEqual([0, 100, 0]);
  });

  it('gives the leftover cents to the largest remainders, then to the earlier line', () => {
    // 1000 × 1/6 = 166.67, × 2/6 = 333.33, × 3/6 = 500 → 166 + 333 + 500 = 999; the 1/6 share lost most.
    expect(splitCents(1000, [1, 2, 3])).toEqual([167, 333, 500]);
    // Equal remainders: the first line wins, every time.
    expect(splitCents(200, [1, 1, 1])).toEqual([67, 67, 66]);
    expect(splitCents(200, [1, 1, 1])).toEqual(splitCents(200, [1, 1, 1]));
  });

  it('handles amounts far beyond floating-point precision', () => {
    const shares = splitCents(100_000_000_000, [10n ** 16n, 3n, 10n ** 16n + 7n]);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(100_000_000_000);
  });

  it('rejects impossible inputs', () => {
    expect(() => splitCents(100, [0, 0])).toThrow();
    expect(() => splitCents(-1, [1])).toThrow();
    expect(() => splitCents(1.5, [1])).toThrow();
    expect(() => splitCents(100, [-1, 2])).toThrow();
  });
});

describe('allocate', () => {
  it('splits by relative sales value (the $100 example)', () => {
    const a = allocate(100, 'relative_value', [
      { quantity: 1, estimatedUnitValue: 100 },
      { quantity: 1, estimatedUnitValue: 60 },
      { quantity: 1, estimatedUnitValue: 40 },
    ]);
    expect(a.lines.map((l) => l.allocatedCost)).toEqual([50, 30, 20]);
    expect(a.lines.map((l) => l.share)).toEqual([0.5, 0.3, 0.2]);
    expect(a.allocatedTotal).toBe(100);
    expect(a.estimatedTotal).toBe(200);
  });

  it('never loses or creates a penny when the split is uneven', () => {
    const a = allocate(100, 'relative_value', [
      { quantity: 1, estimatedUnitValue: 10 },
      { quantity: 1, estimatedUnitValue: 10 },
      { quantity: 1, estimatedUnitValue: 10 },
    ]);
    expect(a.lines.map((l) => l.allocatedCost)).toEqual([33.34, 33.33, 33.33]);
    expect(cents(a.lines.map((l) => l.allocatedCost))).toBe(10000);
  });

  it('weights each line by estimate × quantity, and keeps line and unit cost apart', () => {
    const a = allocate(10, 'relative_value', [
      { quantity: 3, estimatedUnitValue: 10 }, // worth 30
      { quantity: 1, estimatedUnitValue: 30 }, // worth 30
    ]);
    expect(a.lines.map((l) => l.allocatedCost)).toEqual([5, 5]);
    expect(a.lines[0].unitCost).toBe(1.6667);
    expect(multiplyMoney(a.lines[0].unitCost, 3)).toBe(5);
    expect(unitCentSplit(5, 3)).toEqual({ low: 1.66, high: 1.67, highUnits: 2, lowUnits: 1 });
    expect(a.lines[1].unitCost).toBe(5);
  });

  it('splits equally per unit without estimates', () => {
    const a = allocate(10, 'equal', [
      { quantity: 2, estimatedUnitValue: null },
      { quantity: 1, estimatedUnitValue: null },
    ]);
    expect(a.lines.map((l) => l.allocatedCost)).toEqual([6.67, 3.33]);
    expect(a.linesWithoutEstimate).toBe(2);
  });

  it('asks for estimates (or the equal split) instead of guessing', () => {
    const missing = () => allocate(10, 'relative_value', [{ quantity: 1, estimatedUnitValue: 5 }, { quantity: 1, estimatedUnitValue: null }]);
    expect(missing).toThrow(DomainError);
    try {
      missing();
    } catch (e) {
      expect((e as DomainError).fields).toEqual({ 'line.1.estimate': 'Enter an estimated resale value, or split the cost equally.' });
    }
    expect(() => allocate(10, 'relative_value', [{ quantity: 1, estimatedUnitValue: 0 }, { quantity: 2, estimatedUnitValue: 0 }])).toThrow('nothing to split by');
    expect(() => allocate(10, 'relative_value', [])).toThrow('at least one item');
  });

  it('gives a $0 estimate a $0 share (and says so through the counts)', () => {
    const a = allocate(10, 'relative_value', [{ quantity: 1, estimatedUnitValue: 0 }, { quantity: 1, estimatedUnitValue: 20 }]);
    expect(a.lines.map((l) => l.allocatedCost)).toEqual([0, 10]);
    expect(a.linesWithZeroEstimate).toBe(1);
  });
});

describe('exactPerUnit', () => {
  it('uses the fewest decimals that multiply back to the total', () => {
    expect(exactPerUnit(10, 2)).toBe(5);
    expect(exactPerUnit(10, 3)).toBe(3.3333);
    expect(exactPerUnit(0.01, 300)).toBe(0.000033);
    for (const [total, qty] of [
      [10, 3],
      [0.01, 300],
      [999.99, 7],
      [1, 99_999],
      [123_456.78, 100_000],
    ]) {
      expect(toCents(multiplyMoney(exactPerUnit(total, qty), qty))).toBe(toCents(total));
    }
  });
});

describe('createLot', () => {
  it('creates one inventory item per line, costing its share', () => {
    const r = created(
      lotInput(
        [line('Sneakers', 1, 100, { category: 'Shoes', condition: 'Used' }), line('Headphones', 1, 60), line('Jacket', 1, 40, { notes: 'Size M' })],
        { purchasePrice: 90, extraCosts: [{ label: 'Shipping', amount: 7.5 }, { label: "Buyer's premium", amount: 2.5 }] },
      ),
    );
    expect(lotTotal(r.lot)).toBe(100);
    expect(r.items.map((i) => [i.name, i.unitCost, i.estimatedValue, i.purchaseDate])).toEqual([
      ['Sneakers', 50, 100, '2026-10-01'],
      ['Headphones', 30, 60, '2026-10-01'],
      ['Jacket', 20, 40, '2026-10-01'],
    ]);
    expect(r.items[0]).toMatchObject({ category: 'Shoes', condition: 'Used' });
    expect(r.items[2].notes).toBe('Size M');
    expect(r.lot.lines.map((l) => [l.itemId, l.allocatedCost])).toEqual(r.items.map((i, n) => [i.id, [50, 30, 20][n]]));
    expect(r.lot.extraCosts.map((c) => [c.label, c.amount])).toEqual([
      ['Shipping', 7.5],
      ["Buyer's premium", 2.5],
    ]);
    expect(r.lot.history).toHaveLength(1);
    expect(r.lot.history[0].kind).toBe('created');
    expect(lotForItem(r.data, r.items[1].id)?.line.itemName).toBe('Headphones');
    expect(lotForItem(r.data, 'nope')).toBeNull();
  });

  it('treats buying as inventory, not a loss: no adjustments, no sales, cost = total', () => {
    const r = created(lotInput([line('A', 3, 10), line('B', 1, 30)], { purchasePrice: 10 }));
    expect(r.data.adjustments).toEqual([]);
    expect(r.data.sales).toEqual([]);
    expect(cents(r.data.items.map(itemCostValue))).toBe(1000);
    const s = lotSummary(r.data, r.lot);
    expect(s).toMatchObject({ total: 10, allocatedTotal: 10, balanced: true, reconciled: true, unitsBought: 4, itemCount: 2, remainingCost: 10, otherChanges: 0 });
    expect(s.sales.netProfit).toBe(0);
  });

  it('keeps per-unit costs exact for awkward quantities', () => {
    const r = created(lotInput([line('Pins', 300, 1), line('Badge', 1, 0.5)], { purchasePrice: 0.07 }));
    expect(cents(r.lot.lines.map((l) => l.allocatedCost))).toBe(7);
    for (const [i, item] of r.items.entries()) expect(toCents(itemCostValue(item))).toBe(toCents(r.lot.lines[i].allocatedCost));
  });

  it('reports every problem at once', () => {
    const errors = lotInputErrors(
      lotInput([line('', 0, null), line('Ok', 1.5, -1)], { name: ' ', purchasePrice: null, extraCosts: [{ label: 'Freight', amount: -2 }], purchaseDate: '2026-02-30' }),
    );
    expect(Object.keys(errors).sort()).toEqual(['extra.0.amount', 'line.0.estimate', 'line.0.name', 'line.0.quantity', 'line.1.estimate', 'line.1.quantity', 'name', 'purchaseDate', 'purchasePrice']);
    expect(lotInputErrors(lotInput([]))).toEqual({ lines: 'Add at least one item to the lot.' });
    expect(lotInputErrors(lotInput([line('A', 1, 5)]))).toEqual({});
  });

  it('ignores empty extra-cost rows and names unnamed ones', () => {
    const r = created(lotInput([line('A', 1, 5)], { extraCosts: [{ label: '', amount: null }, { label: ' ', amount: 4 }] }));
    expect(r.lot.extraCosts.map((c) => [c.label, c.amount])).toEqual([['Additional cost', 4]]);
    expect(lotTotal(r.lot)).toBe(104);
  });

  it('previews the same split it saves', () => {
    const input = lotInput([line('A', 2, 7), line('B', 5, 3), line('C', 1, 11)], { purchasePrice: 47.11 });
    const preview = previewLot(input);
    const r = created(input);
    expect(r.lot.lines.map((l) => l.allocatedCost)).toEqual(preview.lines.map((l) => l.allocatedCost));
  });
});

describe('selling lot items', () => {
  it('cost of goods sold adds up to the line cost exactly, one unit at a time', () => {
    let { data, lot, items } = created(lotInput([line('Mugs', 3, 5)], { purchasePrice: 10 }));
    const mugs = items[0];
    expect(mugs.unitCost).toBe(3.3333);
    const costs: number[] = [];
    for (let n = 0; n < 3; n++) {
      const r = recordSale(data, sell(mugs.id, 1), clock());
      data = r.data;
      costs.push(totalSales([r.sale]).costOfGoods);
    }
    expect(costs).toEqual([3.33, 3.34, 3.33]);
    expect(cents(costs)).toBe(1000);
    const s = lotSummary(data, lot);
    expect(s).toMatchObject({ unitsOnHand: 0, remainingCost: 0, reconciled: true });
    expect(s.sales).toMatchObject({ unitsSold: 3, revenue: 120, costOfGoods: 10, netProfit: 110 });
  });

  it('partial sales keep realized and projected figures apart', () => {
    let { data, lot, items } = created(lotInput([line('Sneakers', 1, 100), line('Headphones', 1, 60), line('Jacket', 1, 40)]));
    data = recordSale(data, sell(items[0].id, 1, { salePrice: 95, fees: 12.35, shipping: 9.5 }), clock()).data;
    const s = lotSummary(data, lot);
    expect(s.sales).toMatchObject({ revenue: 95, costOfGoods: 50, netProfit: 23.15 });
    expect(s.remainingCost).toBe(50);
    expect(s.remainingEstimatedValue).toBe(100);
    expect(s.projectedGrossProfit).toBe(50);
    expect(s.potentialGrossProfit).toBe(100);
    expect(s.reconciled).toBe(true);
    expect(s.lines.map((l) => [l.name, l.unitsSold, l.unitsOnHand, l.realizedProfit])).toEqual([
      ['Sneakers', 1, 0, 23.15],
      ['Headphones', 0, 1, 0],
      ['Jacket', 0, 1, 0],
    ]);
  });

  it('accounts for losses, restocks, undone sales and edits without losing a cent', () => {
    let { data, lot, items } = created(lotInput([line('Cards', 7, 3), line('Binder', 1, 9)], { purchasePrice: 20, extraCosts: [{ label: 'Freight', amount: 3.33 }] }));
    const cards = items[0].id;
    data = recordSale(data, sell(cards, 2), clock()).data;
    data = adjustQuantity(data, cards, 4, 'Bent corner', clock()).data; // one written off
    const last = recordSale(data, sell(cards, 1), clock());
    data = deleteSale(last.data, last.sale.id, clock()).data; // undone right away
    data = restockItem(data, cards, 3, 1.1, clock()).data;
    data = recordSale(data, sell(cards, 5), clock()).data;
    const s = lotSummary(data, lot);
    expect(s.addedLater).toBe(3.3);
    expect(s.writtenOff).toBeGreaterThan(0);
    expect(s.otherChanges).toBe(0);
    expect(s.reconciled).toBe(true);
    expect(costAccountedFor(data, lot)).toBe(toCents(lotTotal(lot)));
  });

  it('shows changes made outside the lot instead of hiding them', () => {
    let { data, lot, items } = created(lotInput([line('A', 2, 10), line('B', 1, 10)], { purchasePrice: 30 }));
    data = deleteItem(data, items[1].id).data;
    const s = lotSummary(data, lot);
    expect(s.otherChanges).toBe(10);
    expect(s.reconciled).toBe(false);
    expect(s.lines[1]).toMatchObject({ item: null, name: 'B', unitsOnHand: 0 });

    // Editing an item's cost directly also shows up.
    ({ data, lot, items } = created(lotInput([line('A', 2, 10)], { purchasePrice: 30 })));
    data = updateItem(data, items[0].id, { name: 'A', quantity: 2, unitCost: 16 }, {}, clock()).data;
    expect(lotSummary(data, lot).otherChanges).toBe(-2);
  });

  it('keeps an exact lot cost when the item is edited without touching the cost', () => {
    let { data, items } = created(lotInput([line('Pins', 300, 1)], { purchasePrice: 0.01 }));
    const item = items[0];
    expect(item.unitCost).toBe(0.000033);
    data = updateItem(data, item.id, { name: 'Enamel pins', quantity: 300, unitCost: item.unitCost }, {}, clock()).data;
    expect(data.items[0].unitCost).toBe(0.000033);
    expect(itemCostValue(data.items[0])).toBe(0.01);
  });

  it('never loses or creates money across random lots and sales', () => {
    // mulberry32: a small seeded generator, so every run tests the same cases.
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (((t ^ (t >>> 14)) >>> 0) % n);
    };
    for (let round = 0; round < 60; round++) {
      const lines = Array.from({ length: 1 + rand(6) }, (_, i) => line(`L${i}`, 1 + rand(12), rand(5) === 0 ? 0 : (1 + rand(50_000)) / 100));
      if (lines.every((l) => l.estimatedUnitValue === 0)) lines[0].estimatedUnitValue = 1;
      const input = lotInput(lines, {
        purchasePrice: rand(100_000) / 100,
        extraCosts: rand(2) ? [{ label: 'Freight', amount: rand(5000) / 100 }] : [],
        method: rand(3) === 0 ? 'equal' : 'relative_value',
      });
      let { data, lot, items } = created(input);
      expect(cents(lot.lines.map((l) => l.allocatedCost))).toBe(toCents(lotTotal(lot)));
      for (let step = 0; step < 15; step++) {
        const pick = items[rand(items.length)].id;
        const item = data.items.find((i) => i.id === pick)!;
        if (item.quantity === 0) continue;
        const qty = 1 + rand(item.quantity);
        data = rand(5) === 0 ? adjustQuantity(data, item.id, item.quantity - qty, 'Lost', clock()).data : recordSale(data, sell(item.id, qty), clock()).data;
      }
      if (rand(2)) {
        const edit = editOf(lot, { purchasePrice: lot.purchasePrice + 1.01 });
        // Refused when everything has sold, or every unsold item is valued at 0.
        if (Object.keys(lotEditErrors(data, lot.id, edit)).length === 0) ({ data, lot } = applyLotEdit(data, lot.id, edit, '', clock()));
      }
      const s = lotSummary(data, lot);
      expect(s.otherChanges).toBe(0);
      expect(s.balanced).toBe(true);
      expect(costAccountedFor(data, lot)).toBe(toCents(lotTotal(lot)));
    }
  });
});

describe('editing a lot', () => {
  it('re-splits everything when nothing has sold yet', () => {
    const { data, lot } = created(lotInput([line('Sneakers', 1, 100), line('Headphones', 1, 60), line('Jacket', 1, 40)]));
    const r = applyLotEdit(data, lot.id, editOf(lot, { extraCosts: [{ label: 'Freight', amount: 20 }] }), 'Forgot the freight', clock());
    expect(r.data.items.map((i) => i.unitCost)).toEqual([60, 36, 24]);
    expect(r.lot.lines.map((l) => l.allocatedCost)).toEqual([60, 36, 24]);
    expect(lotTotal(r.lot)).toBe(120);
    const entry = r.lot.history.at(-1)!;
    expect(entry).toMatchObject({ kind: 'costs', note: 'Forgot the freight', previousTotal: 100, newTotal: 120, lockedCost: 0, changedFields: ['extraCosts'] });
    expect(entry.lines.map((l) => [l.itemName, l.previousUnitCost, l.newUnitCost])).toEqual([
      ['Sneakers', 50, 60],
      ['Headphones', 30, 36],
      ['Jacket', 20, 24],
    ]);
    expect(lotSummary(r.data, r.lot).reconciled).toBe(true);
  });

  it('never changes completed sales: the change goes to unsold units only', () => {
    let { data, lot, items } = created(lotInput([line('Sneakers', 1, 100), line('Headphones', 1, 60), line('Jacket', 1, 40)]));
    const sold = recordSale(data, sell(items[2].id, 1, { salePrice: 35 }), clock());
    data = sold.data;
    const before = totalSales(data.sales);
    const plan = planLotEdit(data, lot.id, editOf(lot, { purchasePrice: 108 }));
    expect(plan).toMatchObject({ mode: 'delta', costChange: true, lockedCost: 20, remainingBefore: 80, remainingAfter: 88 });
    expect(plan.lines.map((l) => [l.itemName, l.previousRemainingCost, l.newRemainingCost])).toEqual([
      ['Sneakers', 50, 55],
      ['Headphones', 30, 33],
    ]);
    const r = applyLotEdit(data, lot.id, editOf(lot, { purchasePrice: 108 }), '', clock());
    expect(r.data.sales).toEqual(data.sales);
    expect(totalSales(r.data.sales)).toEqual(before);
    expect(r.lot.lines.map((l) => l.allocatedCost)).toEqual([55, 33, 20]);
    expect(cents(r.lot.lines.map((l) => l.allocatedCost))).toBe(10800);
    expect(lotSummary(r.data, r.lot).reconciled).toBe(true);
  });

  it('re-splits the cost still in stock when estimates change', () => {
    let { data, lot, items } = created(lotInput([line('A', 2, 10), line('B', 2, 10), line('C', 1, 20)], { purchasePrice: 60 }));
    data = recordSale(data, sell(items[0].id, 1), clock()).data; // A: 1 sold at its cost of 10
    const estimates = { ...editOf(lot).estimates, [lot.lines[1].id]: 35 }; // B is worth more than thought
    const plan = planLotEdit(data, lot.id, editOf(lot, { estimates }));
    expect(plan.mode).toBe('redistribute');
    expect(plan.lockedCost).toBe(10);
    // 50 left in stock: A 1×10, B 2×35, C 1×20 → weights 10 : 70 : 20.
    expect(plan.lines.map((l) => l.newRemainingCost)).toEqual([5, 35, 10]);
    const r = applyLotEdit(data, lot.id, editOf(lot, { estimates }), '', clock());
    expect(r.data.items.find((i) => i.id === items[1].id)).toMatchObject({ unitCost: 17.5, estimatedValue: 35 });
    expect(r.data.sales).toEqual(data.sales);
    expect(lotSummary(r.data, r.lot).reconciled).toBe(true);
  });

  it('switching to an equal split moves only unsold cost', () => {
    let { data, lot, items } = created(lotInput([line('A', 1, 90), line('B', 1, 10), line('C', 1, 0)], { purchasePrice: 30 }));
    expect(items.map((i) => i.unitCost)).toEqual([27, 3, 0]);
    data = recordSale(data, sell(items[0].id, 1), clock()).data;
    const r = applyLotEdit(data, lot.id, editOf(lot, { method: 'equal' }), '', clock());
    expect(r.data.items.slice(1).map((i) => i.unitCost)).toEqual([1.5, 1.5]);
    expect(r.lot.history.at(-1)).toMatchObject({ previousMethod: 'relative_value', newMethod: 'equal' });
    expect(lotSummary(r.data, r.lot).reconciled).toBe(true);
  });

  it('refuses changes that would rewrite completed sales', () => {
    let { data, lot, items } = created(lotInput([line('A', 1, 10), line('B', 1, 10)], { purchasePrice: 20 }));
    data = recordSale(data, sell(items[0].id, 1), clock()).data;
    expect(() => planLotEdit(data, lot.id, editOf(lot, { purchasePrice: 5 }))).toThrow('at most that much');
    expect(lotEditErrors(data, lot.id, editOf(lot, { purchasePrice: 5 })).purchasePrice).toContain('10.00');
    data = recordSale(data, sell(items[1].id, 1), clock()).data;
    expect(() => planLotEdit(data, lot.id, editOf(lot, { purchasePrice: 25 }))).toThrow('Everything from this lot has been sold');
    // Details can still change, and nothing about costs moves.
    const r = applyLotEdit(data, lot.id, editOf(lot, { name: 'Garage sale', source: 'Neighbour' }), '', clock());
    expect(r.lot.history.at(-1)).toMatchObject({ kind: 'details', changedFields: ['name', 'source'], lines: [] });
    expect(r.data.sales).toEqual(data.sales);
  });

  it('requires an estimate for unsold items when splitting by value', () => {
    const { data, lot } = created(lotInput([line('A', 1, 10), line('B', 1, 10)]));
    const errors = lotEditErrors(data, lot.id, editOf(lot, { estimates: { [lot.lines[0].id]: null, [lot.lines[1].id]: 10 } }));
    expect(errors).toEqual({ 'line.0.estimate': 'Enter an estimated resale value, or split the cost equally.' });
  });

  it('moves item purchase dates with the lot date, and rejects an edit that changes nothing', () => {
    let { data, lot, items } = created(lotInput([line('A', 1, 10), line('B', 1, 10)]));
    data = updateItem(data, items[1].id, { name: 'B', quantity: 1, unitCost: 50, purchaseDate: '2026-09-01' }, {}, clock()).data;
    const r = applyLotEdit(data, lot.id, editOf(lot, { purchaseDate: '2026-10-05' }), '', clock());
    expect(r.data.items.map((i) => i.purchaseDate)).toEqual(['2026-10-05', '2026-09-01']);
    expect(() => applyLotEdit(r.data, lot.id, editOf(r.lot), '', clock())).toThrow('Nothing has changed');
  });

  it('a no-cost edit leaves every unit cost exactly as it was', () => {
    let { data, lot, items } = created(lotInput([line('A', 3, 10), line('B', 7, 3)], { purchasePrice: 33.33 }));
    data = recordSale(data, sell(items[0].id, 1), clock()).data;
    const r = applyLotEdit(data, lot.id, editOf(lot, { notes: 'Box 2 of 3' }), '', clock());
    expect(r.data.items.map((i) => i.unitCost)).toEqual(data.items.map((i) => i.unitCost));
  });
});

describe('sales edits on lot items', () => {
  it('the sale form preview uses the same cost the sale records', () => {
    let { data, items } = created(lotInput([line('Mugs', 3, 5)], { purchasePrice: 10 }));
    const mugs = items[0];
    data = recordSale(data, sell(mugs.id, 1), clock()).data;
    const now = data.items[0];
    const r = recordSale(data, sell(mugs.id, 1), clock());
    expect(r.sale.unitCost).toBe(saleUnitCost(now, 1));
    expect(totalSales([r.sale]).costOfGoods).toBe(3.34);
  });

  it('a sale moved onto a lot item takes the cost leaving that item', () => {
    let { data, items } = created(lotInput([line('Mugs', 3, 5)], { purchasePrice: 10 }));
    const other = addItem(data, { name: 'Plate', quantity: 2, unitCost: 4 }, clock());
    data = other.data;
    const r = recordSale(data, sell(other.item.id, 1), clock());
    const moved = updateSale(r.data, r.sale.id, sell(items[0].id, 2), clock());
    expect(totalSales([moved.sale]).costOfGoods).toBe(6.67);
    expect(moved.data.items.find((i) => i.id === other.item.id)?.quantity).toBe(2);
  });

  it('keeps the recorded cost when a sale is edited', () => {
    let { data, items } = created(lotInput([line('Mugs', 3, 5)], { purchasePrice: 10 }));
    const r = recordSale(data, sell(items[0].id, 1), clock());
    data = updateSale(r.data, r.sale.id, sell(items[0].id, 1, { salePrice: 50 }), clock()).data;
    expect(data.sales[0].unitCost).toBe(r.sale.unitCost);
  });
});
