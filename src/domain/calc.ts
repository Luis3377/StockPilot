import type { AppData, Item, PriceMode, Sale, Settings } from './types';
import { multiplyMoney, percent, roundMoney, sumMoney, toCents, fromCents } from './money';
import { daysBetween, inRange, monthKey, todayISO, type DateRange } from './dates';

// ---------------------------------------------------------------------------
// Single sale
// ---------------------------------------------------------------------------

export interface SaleFigures {
  revenue: number;
  costOfGoods: number;
  fees: number;
  shipping: number;
  otherExpenses: number;
  totalExpenses: number;
  netProfit: number;
  /** Net profit ÷ revenue × 100; null when revenue is 0. */
  margin: number | null;
  /** Net profit ÷ cost of goods sold × 100; null when cost of goods is 0. */
  roi: number | null;
}

export interface SaleFigureInput {
  quantity: number;
  salePrice: number;
  priceMode: PriceMode;
  unitCost: number;
  fees: number;
  shipping: number;
  otherExpenses: number;
}

/** Revenue = price × quantity when the price is per unit, otherwise the entered total. */
export function saleRevenue(s: Pick<SaleFigureInput, 'quantity' | 'salePrice' | 'priceMode'>): number {
  return s.priceMode === 'per_unit' ? multiplyMoney(s.salePrice, s.quantity) : roundMoney(s.salePrice);
}

export function computeSale(s: SaleFigureInput): SaleFigures {
  const revenue = saleRevenue(s);
  const costOfGoods = multiplyMoney(s.unitCost, s.quantity);
  const fees = roundMoney(s.fees);
  const shipping = roundMoney(s.shipping);
  const otherExpenses = roundMoney(s.otherExpenses);
  const totalExpenses = sumMoney([fees, shipping, otherExpenses]);
  const netProfit = fromCents(toCents(revenue) - toCents(costOfGoods) - toCents(totalExpenses));
  return {
    revenue,
    costOfGoods,
    fees,
    shipping,
    otherExpenses,
    totalExpenses,
    netProfit,
    margin: percent(netProfit, revenue),
    roi: percent(netProfit, costOfGoods),
  };
}

// ---------------------------------------------------------------------------
// Totals across many sales
// ---------------------------------------------------------------------------

export interface SalesTotals extends SaleFigures {
  salesCount: number;
  unitsSold: number;
}

export function totalSales(sales: Sale[]): SalesTotals {
  const figs = sales.map(computeSale);
  const revenue = sumMoney(figs.map((f) => f.revenue));
  const costOfGoods = sumMoney(figs.map((f) => f.costOfGoods));
  const fees = sumMoney(figs.map((f) => f.fees));
  const shipping = sumMoney(figs.map((f) => f.shipping));
  const otherExpenses = sumMoney(figs.map((f) => f.otherExpenses));
  const totalExpenses = sumMoney([fees, shipping, otherExpenses]);
  const netProfit = sumMoney(figs.map((f) => f.netProfit));
  return {
    salesCount: sales.length,
    unitsSold: sales.reduce((n, s) => n + s.quantity, 0),
    revenue,
    costOfGoods,
    fees,
    shipping,
    otherExpenses,
    totalExpenses,
    netProfit,
    margin: percent(netProfit, revenue),
    roi: percent(netProfit, costOfGoods),
  };
}

export function salesInRange(sales: Sale[], range: DateRange): Sale[] {
  return sales.filter((s) => inRange(s.saleDate, range));
}

export interface GroupTotals extends SalesTotals {
  key: string;
  label: string;
}

function groupSales(sales: Sale[], keyOf: (s: Sale) => string, labelOf: (s: Sale) => string): GroupTotals[] {
  const groups = new Map<string, { label: string; sales: Sale[] }>();
  for (const s of sales) {
    const key = keyOf(s);
    const g = groups.get(key);
    if (g) g.sales.push(s);
    else groups.set(key, { label: labelOf(s), sales: [s] });
  }
  return [...groups.entries()].map(([key, g]) => ({ key, label: g.label, ...totalSales(g.sales) }));
}

export function salesByItem(sales: Sale[]): GroupTotals[] {
  return groupSales(sales, (s) => s.itemId, (s) => s.itemName);
}

export function salesByCategory(sales: Sale[]): GroupTotals[] {
  return groupSales(sales, (s) => s.itemCategory || 'Uncategorized', (s) => s.itemCategory || 'Uncategorized');
}

export function salesByPlatform(sales: Sale[]): GroupTotals[] {
  return groupSales(sales, (s) => s.platform || 'Unspecified', (s) => s.platform || 'Unspecified');
}

/** Monthly totals for the last `months` months ending at `today`'s month, oldest first, zero-filled. */
export function salesByMonth(sales: Sale[], months: number, today: string = todayISO()): GroupTotals[] {
  const keys: string[] = [];
  const [y, m] = today.split('-').map(Number);
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const byMonth = new Map(groupSales(sales, (s) => monthKey(s.saleDate), (s) => monthKey(s.saleDate)).map((g) => [g.key, g]));
  return keys.map((key) => byMonth.get(key) ?? { key, label: key, ...totalSales([]) });
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export function itemCostValue(item: Item): number {
  return multiplyMoney(item.unitCost, item.quantity);
}

export function itemAskingValue(item: Item): number | null {
  return item.askingPrice === null ? null : multiplyMoney(item.askingPrice, item.quantity);
}

export function itemEstimatedValue(item: Item): number | null {
  return item.estimatedValue === null ? null : multiplyMoney(item.estimatedValue, item.quantity);
}

export function isLowStock(item: Item): boolean {
  return item.lowStockThreshold !== null && item.quantity <= item.lowStockThreshold;
}

export type StockStatus = 'in_stock' | 'low' | 'out';

export function stockStatus(item: Item): StockStatus {
  if (item.quantity === 0) return 'out';
  if (isLowStock(item)) return 'low';
  return 'in_stock';
}

/** Date the item's clock started: purchase date, else the day it was added. */
export function acquiredDate(item: Item): string {
  return item.purchaseDate ?? item.createdAt.slice(0, 10);
}

export function lastSaleDate(itemId: string, sales: Sale[]): string | null {
  let latest: string | null = null;
  for (const s of sales) if (s.itemId === itemId && (latest === null || s.saleDate > latest)) latest = s.saleDate;
  return latest;
}

/** Days since the item last moved: the later of acquisition and its most recent sale. */
export function daysWithoutSale(item: Item, sales: Sale[], today: string = todayISO()): number {
  const acquired = acquiredDate(item);
  const sold = lastSaleDate(item.id, sales);
  const since = sold && sold > acquired ? sold : acquired;
  return Math.max(0, daysBetween(since, today));
}

export interface InventoryTotals {
  /** Distinct items with at least one unit on hand. */
  itemsInStock: number;
  unitsInStock: number;
  totalItems: number;
  /** Σ quantity × unit cost (money tied up in stock). */
  costValue: number;
  /** Σ quantity × asking price, over items that have an asking price. */
  askingValue: number;
  /** Cost of the same items counted in askingValue. */
  askingCostBasis: number;
  itemsWithAsking: number;
  itemsMissingAsking: number;
  /** Σ quantity × estimated value, over items that have an estimate. */
  estimatedValue: number;
  /** Cost of the same items counted in estimatedValue. */
  estimatedCostBasis: number;
  itemsWithEstimate: number;
  itemsMissingEstimate: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export function inventoryTotals(items: Item[]): InventoryTotals {
  const inStock = items.filter((i) => i.quantity > 0);
  const withAsking = inStock.filter((i) => i.askingPrice !== null);
  const withEstimate = inStock.filter((i) => i.estimatedValue !== null);
  return {
    itemsInStock: inStock.length,
    unitsInStock: inStock.reduce((n, i) => n + i.quantity, 0),
    totalItems: items.length,
    costValue: sumMoney(inStock.map(itemCostValue)),
    askingValue: sumMoney(withAsking.map((i) => itemAskingValue(i) ?? 0)),
    askingCostBasis: sumMoney(withAsking.map(itemCostValue)),
    itemsWithAsking: withAsking.length,
    itemsMissingAsking: inStock.length - withAsking.length,
    estimatedValue: sumMoney(withEstimate.map((i) => itemEstimatedValue(i) ?? 0)),
    estimatedCostBasis: sumMoney(withEstimate.map(itemCostValue)),
    itemsWithEstimate: withEstimate.length,
    itemsMissingEstimate: inStock.length - withEstimate.length,
    lowStockCount: items.filter((i) => i.quantity > 0 && isLowStock(i)).length,
    outOfStockCount: items.filter((i) => i.quantity === 0 && i.lowStockThreshold !== null).length,
  };
}

// ---------------------------------------------------------------------------
// Projections (never mixed with realized profit)
// ---------------------------------------------------------------------------

export interface SellingCostRate {
  /** Selling costs (fees + shipping + other) as a % of sale price. */
  percent: number;
  source: 'setting' | 'history' | 'none';
  /** Number of sales the history-based rate was learned from. */
  basedOnSales: number;
}

/** The selling-cost rate to assume for projections: user setting, else learned from sales. */
export function sellingCostRate(sales: Sale[], settings: Pick<Settings, 'sellingCostPercent'>): SellingCostRate {
  if (settings.sellingCostPercent !== null) {
    return { percent: settings.sellingCostPercent, source: 'setting', basedOnSales: 0 };
  }
  const totals = totalSales(sales);
  if (totals.revenue > 0) {
    return { percent: (totals.totalExpenses / totals.revenue) * 100, source: 'history', basedOnSales: sales.length };
  }
  return { percent: 0, source: 'none', basedOnSales: 0 };
}

/** Projected net profit for one unit sold at its asking price, after estimated selling costs. */
export function projectedUnitProfit(item: Item, ratePercent: number): number | null {
  if (item.askingPrice === null) return null;
  const costs = roundMoney((item.askingPrice * ratePercent) / 100);
  return fromCents(toCents(item.askingPrice) - toCents(costs) - toCents(item.unitCost));
}

export function projectedMargin(item: Item, ratePercent: number): number | null {
  const unit = projectedUnitProfit(item, ratePercent);
  if (unit === null || item.askingPrice === null) return null;
  return percent(unit, item.askingPrice);
}

export interface Projection {
  /** Revenue if every in-stock unit with an asking price sells at that price. */
  projectedRevenue: number;
  projectedSellingCosts: number;
  costBasis: number;
  projectedProfit: number;
  itemsIncluded: number;
  itemsExcluded: number;
  rate: SellingCostRate;
}

export function projectUnsold(items: Item[], sales: Sale[], settings: Pick<Settings, 'sellingCostPercent'>): Projection {
  const rate = sellingCostRate(sales, settings);
  const inStock = items.filter((i) => i.quantity > 0);
  const priced = inStock.filter((i) => i.askingPrice !== null);
  const projectedRevenue = sumMoney(priced.map((i) => itemAskingValue(i) ?? 0));
  const projectedSellingCosts = roundMoney((projectedRevenue * rate.percent) / 100);
  const costBasis = sumMoney(priced.map(itemCostValue));
  return {
    projectedRevenue,
    projectedSellingCosts,
    costBasis,
    projectedProfit: fromCents(toCents(projectedRevenue) - toCents(projectedSellingCosts) - toCents(costBasis)),
    itemsIncluded: priced.length,
    itemsExcluded: inStock.length - priced.length,
    rate,
  };
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

export function uniqueSorted(values: Iterable<string>): string[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const t = v.trim();
    if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function knownCategories(data: AppData): string[] {
  return uniqueSorted([...data.items.map((i) => i.category), ...data.sales.map((s) => s.itemCategory)]);
}

export function knownLocations(data: AppData): string[] {
  return uniqueSorted(data.items.map((i) => i.location));
}

export function knownPlatforms(data: AppData): string[] {
  return uniqueSorted(data.sales.map((s) => s.platform));
}
