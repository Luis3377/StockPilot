// The calculations manual beta testing confirmed, kept as regression tests. Each case has its
// own small dataset (the testers' cases come from different points in time; their totals are
// never mixed into one fixture).
import { describe, expect, it } from 'vitest';
import { addItem, completeCount, recordSale, setCount, startCount } from '../domain/actions';
import { itemCostValue, totalSales } from '../domain/calc';
import { createLot, lotSummary } from '../domain/lots';
import { assignSource, addTimeEntry, createSource } from '../domain/sourcing';
import { addEntry, setTaxPercent } from '../domain/planning';
import { defaultSettings, emptyData } from '../domain/types';
import { clock } from '../domain/testUtils';
import { createBackup, parseBackup } from '../data/backup';
import { lotPerformance } from './performance';
import { planningSummary, reserveCents } from './planning';
import { sourcingReport } from './sourcing';
import { periodRange } from '../domain/dates';

const settings = defaultSettings();
const sale = (itemId: string, salePrice: number, date: string, fees = 0, shipping = 0, quantity = 1) => ({ itemId, quantity, salePrice, priceMode: 'total' as const, fees, shipping, saleDate: date });

/** A $100 bulk lot of two items estimated at $60 and $40 (split by resale value). */
function lot100() {
  return createLot(emptyData(), { name: 'Garage lot', purchasePrice: 100, extraCosts: [], purchaseDate: '2026-11-01', source: '', notes: '', method: 'relative_value', lines: [{ name: 'Lamp', quantity: 1, estimatedUnitValue: 120, category: 'Home' }, { name: 'Radio', quantity: 1, estimatedUnitValue: 80, category: 'Electronics' }] }, clock('2026-11-01T12:00:00.000Z'));
}

describe('calculations confirmed by manual testing', () => {
  it('coffee mug: 3 × $8 = $24 inventory cost; sold for $20 − $8 − $2 fees − $3 shipping = $7 profit', () => {
    const mug = addItem(emptyData(), { name: 'Coffee mug', quantity: 3, unitCost: 8, purchaseDate: '2026-11-01' }, clock());
    expect(itemCostValue(mug.item)).toBe(24);
    const sold = recordSale(mug.data, sale(mug.item.id, 20, '2026-11-05', 2, 3));
    expect(totalSales(sold.data.sales).netProfit).toBe(7);
  });

  it('bulk lot: $100 split into $60 and $40; partly sold: $40 realized, $40 still in inventory', () => {
    const r = lot100();
    expect(r.items.map((i) => i.unitCost)).toEqual([60, 40]);
    const sold = recordSale(r.data, sale(r.items[0].id, 100, '2026-11-10'));
    const s = lotSummary(sold.data, sold.data.lots[0]);
    expect([s.sales.netProfit, s.remainingCost]).toEqual([40, 40]);
  });

  it('completed lot: $190 revenue − $15 expenses − $100 cost = $75 profit, 75% ROI', () => {
    const r = lot100();
    let data = recordSale(r.data, sale(r.items[0].id, 100, '2026-11-10')).data;
    data = recordSale(data, sale(r.items[1].id, 90, '2026-11-12', 10, 5)).data;
    const p = lotPerformance(data, settings, data.lots[0]);
    expect([p.actual.revenue, p.actual.sellingExpenses, p.actual.lotResult, p.actual.lotRoiPct]).toEqual([190, 15, 75, 75]);
  });

  it('source: $40 profit with $40 of inventory cost remaining; $40 ÷ 2 hours = $20 per hour', () => {
    const r = lot100();
    const src = createSource(r.data, { name: 'Saturday Garage Sale', type: 'garage_sale' }, clock());
    let data = assignSource(src.data, 'lot', r.lot.id, src.source.id, clock());
    data = recordSale(data, sale(r.items[0].id, 100, '2026-11-10')).data;
    data = addTimeEntry(data, { date: '2026-11-10', minutes: 120, activity: 'sourcing', links: [{ kind: 'source', id: src.source.id, sharePct: null }], split: 'equal' }, clock()).data;
    const s = sourcingReport(data, settings, { range: periodRange('all') }).sources.find((x) => x.ref.sourceId === src.source.id)!;
    expect([s.realizedProfit, s.inventoryCost, s.hours, s.profitPerHour]).toEqual([40, 40, 2, 20]);
  });

  it('tax planning: $293.71 × 25% = $73.43; recording $50 set aside leaves $23.43, profit unchanged', () => {
    expect(reserveCents(29371, 25)).toBe(7343);
    const item = addItem(emptyData(), { name: 'Camera', quantity: 1, unitCost: 100, purchaseDate: '2026-11-01' }, clock());
    let data = recordSale(item.data, sale(item.item.id, 393.71, '2026-11-08')).data; // $293.71 profit
    data = setTaxPercent(data, 25, clock('2026-11-09T12:00:00.000Z'));
    data = addEntry(data, { categoryId: data.planning.categories[0].id, date: '2026-11-09', kind: 'deposit', amount: 50, note: '' }, {}, clock('2026-11-09T12:00:00.000Z')).data;
    const s = planningSummary(data, settings, 'month', '2026-11', '2026-11-15');
    expect([s.profit.netProfit, s.tax!.target, s.setAsideTotal, s.tax!.remaining]).toEqual([293.71, 73.43, 50, 23.43]);
  });

  it('Count Check: one coffee mug missing records an $8 inventory loss; backup and restore keep everything', () => {
    let data = addItem(emptyData(), { name: 'Coffee mug', quantity: 2, unitCost: 8, purchaseDate: '2026-11-01' }, clock()).data;
    data = startCount(data, { category: null, location: null });
    data = setCount(data, data.items[0].id, 1);
    data = completeCount(data, [{ itemId: data.items[0].id, apply: true, reason: 'Lost' }]).data;
    expect(data.adjustments[0]).toMatchObject({ previousQuantity: 2, newQuantity: 1, valueDifference: -8, reason: 'Lost' });
    const restored = parseBackup(JSON.stringify(createBackup('real', settings, data, []))).data;
    expect(restored.items).toEqual(data.items);
    expect(restored.adjustments).toEqual(data.adjustments);
  });
});
