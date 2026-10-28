import { describe, expect, it } from 'vitest';
import { computeSale, inventoryTotals, projectUnsold, salesByMonth, sellingCostRate, totalSales, daysWithoutSale } from './calc';
import { recordSale } from './actions';
import { clock, withItem } from './testUtils';

describe('computeSale', () => {
  it('applies the spec formulas with a per-unit price', () => {
    const f = computeSale({ quantity: 2, salePrice: 50, priceMode: 'per_unit', unitCost: 20, fees: 13.25, shipping: 8.5, otherExpenses: 1.25 });
    expect(f.revenue).toBe(100);
    expect(f.costOfGoods).toBe(40);
    expect(f.totalExpenses).toBe(23);
    expect(f.netProfit).toBe(37);
    expect(f.margin).toBeCloseTo(37);
    expect(f.roi).toBeCloseTo(92.5);
  });

  it('treats a total price as the revenue for all units', () => {
    const f = computeSale({ quantity: 3, salePrice: 90, priceMode: 'total', unitCost: 10, fees: 0, shipping: 0, otherExpenses: 0 });
    expect(f.revenue).toBe(90);
    expect(f.netProfit).toBe(60);
  });

  it('returns null margin/ROI when the denominator is zero', () => {
    const free = computeSale({ quantity: 1, salePrice: 0, priceMode: 'per_unit', unitCost: 0, fees: 0, shipping: 5, otherExpenses: 0 });
    expect(free.netProfit).toBe(-5);
    expect(free.margin).toBeNull();
    expect(free.roi).toBeNull();
  });

  it('keeps cents exact on awkward numbers', () => {
    const f = computeSale({ quantity: 3, salePrice: 19.99, priceMode: 'per_unit', unitCost: 3.3333, fees: 7.77, shipping: 0.1, otherExpenses: 0.2 });
    expect(f.revenue).toBe(59.97);
    expect(f.costOfGoods).toBe(10);
    expect(f.netProfit).toBe(41.9);
  });
});

describe('aggregates', () => {
  it('totals sales and groups by month with zero-filled gaps', () => {
    let { data, item } = withItem({ quantity: 10, unitCost: 5 });
    data = recordSale(data, { itemId: item.id, quantity: 2, salePrice: 20, priceMode: 'per_unit', fees: 4, saleDate: '2026-10-02' }, clock()).data;
    data = recordSale(data, { itemId: item.id, quantity: 1, salePrice: 15, priceMode: 'per_unit', shipping: 3, saleDate: '2026-08-15' }, clock()).data;
    const t = totalSales(data.sales);
    expect(t.revenue).toBe(55);
    expect(t.costOfGoods).toBe(15);
    expect(t.netProfit).toBe(33);
    expect(t.unitsSold).toBe(3);
    const months = salesByMonth(data.sales, 3, '2026-10-28');
    expect(months.map((m) => m.key)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(months.map((m) => m.revenue)).toEqual([15, 0, 40]);
  });

  it('reports inventory totals and coverage of asking/estimated values', () => {
    let { data } = withItem({ quantity: 2, unitCost: 10, askingPrice: 25 });
    data = withItem({ name: 'B', quantity: 1, unitCost: 4, estimatedValue: 9, lowStockThreshold: 1 }, data).data;
    data = withItem({ name: 'C', quantity: 0, unitCost: 4, lowStockThreshold: 2 }, data).data;
    const t = inventoryTotals(data.items);
    expect(t.costValue).toBe(24);
    expect(t.askingValue).toBe(50);
    expect(t.itemsMissingAsking).toBe(1);
    expect(t.estimatedValue).toBe(9);
    expect(t.estimatedCostBasis).toBe(4);
    expect(t.lowStockCount).toBe(1);
    expect(t.outOfStockCount).toBe(1);
    expect(t.unitsInStock).toBe(3);
  });

  it('projects unsold profit using learned selling costs, separate from realized profit', () => {
    let { data, item } = withItem({ quantity: 3, unitCost: 10, askingPrice: 40 });
    data = recordSale(data, { itemId: item.id, quantity: 1, salePrice: 40, priceMode: 'per_unit', fees: 4, saleDate: '2026-10-01' }, clock()).data;
    const rate = sellingCostRate(data.sales, { sellingCostPercent: null });
    expect(rate.source).toBe('history');
    expect(rate.percent).toBeCloseTo(10);
    const p = projectUnsold(data.items, data.sales, { sellingCostPercent: null });
    expect(p.projectedRevenue).toBe(80);
    expect(p.projectedSellingCosts).toBe(8);
    expect(p.projectedProfit).toBe(52);
    expect(projectUnsold(data.items, data.sales, { sellingCostPercent: 0 }).projectedProfit).toBe(60);
  });

  it('measures days without a sale from the later of purchase and last sale', () => {
    let { data, item } = withItem({ quantity: 3, purchaseDate: '2026-01-01' });
    expect(daysWithoutSale(item, data.sales, '2026-01-31')).toBe(30);
    data = recordSale(data, { itemId: item.id, quantity: 1, salePrice: 1, priceMode: 'per_unit', saleDate: '2026-01-21' }, clock()).data;
    expect(daysWithoutSale(item, data.sales, '2026-01-31')).toBe(10);
  });
});
