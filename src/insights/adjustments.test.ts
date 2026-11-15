// Manual beta finding: a count found one coffee mug missing (2 → 1, −$8). Realized sales profit
// rightly stayed $7, but the loss wasn't visible next to it.
import { describe, expect, it } from 'vitest';
import { addItem, adjustQuantity, recordSale } from '../domain/actions';
import { startLedger } from '../domain/ledger';
import { totalSales } from '../domain/calc';
import { emptyData, defaultSettings } from '../domain/types';
import { periodRange } from '../domain/dates';
import { adjustmentSummary } from './adjustments';
import { periodRollForward, monthPeriod } from './monthly';
import { at, tracked } from './closeFixture';

function mugs() {
  let data = startLedger(emptyData(), at('2026-11-01'));
  const mug = tracked(data, '2026-11-02', (d) => addItem(d, { name: 'Coffee mug', quantity: 3, unitCost: 8, purchaseDate: '2026-11-02' }, at('2026-11-02'))); // 3 × $8 = $24
  data = mug.data;
  data = tracked(data, '2026-11-05', (d) => recordSale(d, { itemId: mug.item.id, quantity: 1, salePrice: 20, priceMode: 'total', fees: 2, shipping: 3, saleDate: '2026-11-05' }, at('2026-11-05'))).data; // $20 − $8 − $2 − $3 = $7
  data = tracked(data, '2026-11-10', (d) => adjustQuantity(d, mug.item.id, 1, 'Count: missing', at('2026-11-10'))).data; // 2 → 1: −$8
  return { data, mugId: mug.item.id };
}

describe('inventory losses next to realized profit', () => {
  it('shows the documented loss apart, without changing realized profit or double-counting cost of goods sold', () => {
    const { data } = mugs();
    const range = periodRange('this_month', '2026-11-15');
    expect(totalSales(data.sales).netProfit).toBe(7);
    expect(totalSales(data.sales).costOfGoods).toBe(8); // only the sold mug
    const a = adjustmentSummary(data, range);
    expect([a.losses.amount, a.losses.units, a.losses.records.length]).toEqual([-8, -1, 1]);
    expect(a.netLoss).toBe(-8);
    // Same figure as the Monthly Close write-off line.
    const rf = periodRollForward(data, defaultSettings(), monthPeriod('2026-11'), '2026-11-15');
    expect(rf.lines.find((l) => l.key === 'decreases')!.amount).toBe(-8);
  });

  it('personal use, returns and units found are classified apart; restocks aren’t losses', () => {
    let { data, mugId } = mugs();
    data = tracked(data, '2026-11-11', (d) => adjustQuantity(d, mugId, 2, 'Found behind the shelf', at('2026-11-11'))).data; // +$8
    data = tracked(data, '2026-11-12', (d) => adjustQuantity(d, mugId, 1, 'Used personally', at('2026-11-12'))).data; // −$8 personal
    data = tracked(data, '2026-11-13', (d) => adjustQuantity(d, mugId, 2, 'Customer return', at('2026-11-13'))).data; // +$8 return
    const a = adjustmentSummary(data, periodRange('this_month', '2026-11-15'));
    expect([a.losses.amount, a.found.amount, a.personal.amount, a.returns.amount, a.netLoss]).toEqual([-8, 8, -8, 8, 0]);
    // Outside the period: nothing.
    expect(adjustmentSummary(data, periodRange('last_month', '2026-11-15')).losses.records).toHaveLength(0);
  });
});
