import type { Adjustment, CountLine, Item, Sale } from '../domain/types';
import { computeSale, itemAskingValue, itemCostValue, itemEstimatedValue, salesByMonth, totalSales } from '../domain/calc';
import { TEMPLATE_HEADER } from './inventoryImport';
import { toCsv } from './csv';

const pct = (v: number | null) => (v === null ? '' : Math.round(v * 10) / 10);

export function inventoryCsv(items: Item[]): string {
  const header = [...TEMPLATE_HEADER, 'total_cost', 'total_asking_value', 'total_estimated_value', 'photo_count', 'created_at', 'updated_at'];
  const rows = items.map((i) => [
    i.name,
    i.sku,
    i.category,
    i.quantity,
    i.unitCost,
    i.askingPrice,
    i.estimatedValue,
    i.purchaseDate,
    i.condition,
    i.location,
    i.lowStockThreshold,
    i.notes,
    itemCostValue(i),
    itemAskingValue(i),
    itemEstimatedValue(i),
    i.photoIds.length,
    i.createdAt,
    i.updatedAt,
  ]);
  return toCsv(header, rows);
}

export function salesCsv(sales: Sale[]): string {
  const header = [
    'sale_date', 'item_name', 'sku', 'category', 'platform', 'quantity', 'price_entered', 'price_type',
    'revenue', 'unit_cost', 'cost_of_goods_sold', 'marketplace_fees', 'seller_shipping', 'other_expenses',
    'net_profit', 'profit_margin_percent', 'roi_percent', 'notes',
  ];
  const sorted = [...sales].sort((a, b) => a.saleDate.localeCompare(b.saleDate));
  const rows = sorted.map((s) => {
    const f = computeSale(s);
    return [
      s.saleDate, s.itemName, s.itemSku, s.itemCategory, s.platform, s.quantity, s.salePrice,
      s.priceMode === 'per_unit' ? 'per item' : 'total', f.revenue, s.unitCost, f.costOfGoods, f.fees,
      f.shipping, f.otherExpenses, f.netProfit, pct(f.margin), pct(f.roi), s.notes,
    ];
  });
  return toCsv(header, rows);
}

/** Month-by-month realized profit, plus an all-time total row. */
export function profitSummaryCsv(sales: Sale[], today: string): string {
  const header = ['month', 'sales', 'units_sold', 'revenue', 'cost_of_goods_sold', 'marketplace_fees', 'seller_shipping', 'other_expenses', 'net_profit', 'profit_margin_percent', 'roi_percent'];
  if (sales.length === 0) return toCsv(header, []);
  const first = sales.reduce((min, s) => (s.saleDate < min ? s.saleDate : min), sales[0].saleDate);
  const [fy, fm] = first.split('-').map(Number);
  const [ty, tm] = today.split('-').map(Number);
  const months = Math.max(1, (ty - fy) * 12 + (tm - fm) + 1);
  const row = (label: string, t: ReturnType<typeof totalSales>) => [
    label, t.salesCount, t.unitsSold, t.revenue, t.costOfGoods, t.fees, t.shipping, t.otherExpenses, t.netProfit, pct(t.margin), pct(t.roi),
  ];
  const monthly = salesByMonth(sales, months, today).map((m) => row(m.key, m));
  return toCsv(header, [...monthly, row('TOTAL', totalSales(sales))]);
}

export function discrepancyCsv(lines: CountLine[], countDate: string): string {
  const header = ['count_date', 'item_name', 'sku', 'recorded_quantity', 'counted_quantity', 'difference', 'unit_cost', 'value_difference', 'result', 'adjustment_applied', 'reason'];
  const label = { match: 'Match', missing: 'Missing', excess: 'Excess' } as const;
  const rows = lines.map((l) => [
    countDate, l.itemName, l.itemSku, l.recordedQuantity, l.countedQuantity, l.difference, l.unitCost,
    l.valueDifference, label[l.status], l.applied ? 'yes' : 'no', l.reason,
  ]);
  return toCsv(header, rows);
}

export function adjustmentsCsv(adjustments: Adjustment[]): string {
  const header = ['date', 'item_name', 'sku', 'source', 'previous_quantity', 'new_quantity', 'difference', 'unit_cost', 'value_difference', 'reason'];
  const source = { count_check: 'Count Check', manual: 'Manual adjustment', edit: 'Item edit', restock: 'Restock', import: 'CSV import' } as const;
  const rows = [...adjustments]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((a) => [a.date, a.itemName, a.itemSku, source[a.source], a.previousQuantity, a.newQuantity, a.difference, a.unitCost, a.valueDifference, a.reason]);
  return toCsv(header, rows);
}
