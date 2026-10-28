// Rule-based alerts and recommendations. Every rule reads only the user's recorded data and
// says plainly when there isn't enough information to judge.

import {
  daysWithoutSale,
  inventoryTotals,
  isLowStock,
  itemCostValue,
  projectedMargin,
  projectedUnitProfit,
  salesByCategory,
  salesByItem,
  sellingCostRate,
  totalSales,
  type GroupTotals,
  type SellingCostRate,
} from '../domain/calc';
import { addDays, todayISO } from '../domain/dates';
import { formatMoney, formatPercent } from '../domain/money';
import type { Adjustment, AppData, CountRecord, Item, Settings } from '../domain/types';

export type Severity = 'critical' | 'warning' | 'info' | 'good';

export interface ItemFinding {
  item: Item;
  /** One short line explaining why this item is listed. */
  detail: string;
}

export interface InsightSection<T = ItemFinding> {
  id: string;
  title: string;
  severity: Severity;
  /** Plain-language explanation of what the rule checks. */
  rule: string;
  findings: T[];
  /** Set when the rule couldn't run (e.g. no sales yet). */
  insufficient: string | null;
  /** Summary sentence when there are findings. */
  summary: string;
}

export interface InsightsReport {
  generatedFor: string;
  lowStock: InsightSection;
  slowMoving: InsightSection;
  lowMarginSales: InsightSection<{ group: GroupTotals; item: Item | null; detail: string }>;
  pricingRisks: InsightSection;
  topRevenue: InsightSection<{ group: GroupTotals; item: Item | null; detail: string }>;
  discrepancies: InsightSection<{ adjustment: Adjustment; detail: string }>;
  categories: InsightSection<{ group: GroupTotals; detail: string }>;
  dataGaps: string[];
  rate: SellingCostRate;
}

type RuleSettings = Pick<Settings, 'slowMovingDays' | 'lowMarginPercent' | 'sellingCostPercent' | 'currency'>;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function lowStockSection(items: Item[]): InsightSection {
  const tracked = items.filter((i) => i.lowStockThreshold !== null);
  const findings = tracked
    .filter(isLowStock)
    .sort((a, b) => a.quantity - (a.lowStockThreshold ?? 0) - (b.quantity - (b.lowStockThreshold ?? 0)))
    .map((item) => ({
      item,
      detail:
        item.quantity === 0
          ? `Out of stock (alert level ${item.lowStockThreshold}).`
          : `${item.quantity} left — at or below your alert level of ${item.lowStockThreshold}.`,
    }));
  const out = findings.filter((f) => f.item.quantity === 0).length;
  return {
    id: 'low-stock',
    title: 'Running low',
    severity: out > 0 ? 'critical' : 'warning',
    rule: 'Items whose quantity is at or below the low-stock alert level you set on them.',
    findings,
    insufficient: tracked.length === 0 ? 'No items have a low-stock alert level yet. Set one on an item (or a default in Settings) to get restock alerts.' : null,
    summary: findings.length
      ? `${plural(findings.length, 'item')} need restocking${out ? `, ${out} already out of stock` : ''}.`
      : `All ${plural(tracked.length, 'tracked item')} are above their alert levels.`,
  };
}

export function slowMovingSection(data: AppData, settings: RuleSettings, today: string): InsightSection {
  const inStock = data.items.filter((i) => i.quantity > 0);
  const findings = inStock
    .map((item) => ({ item, days: daysWithoutSale(item, data.sales, today) }))
    .filter((x) => x.days >= settings.slowMovingDays)
    .sort((a, b) => b.days - a.days)
    .map(({ item, days }) => ({
      item,
      detail: `${days} days without a sale · ${formatMoney(itemCostValue(item), settings.currency)} tied up.`,
    }));
  const tiedUp = findings.reduce((sum, f) => sum + itemCostValue(f.item), 0);
  return {
    id: 'slow-moving',
    title: 'Sitting the longest',
    severity: 'warning',
    rule: `In-stock items that haven't sold in ${settings.slowMovingDays}+ days (counted from the purchase date or last sale, whichever is later).`,
    findings,
    insufficient: inStock.length === 0 ? 'Nothing is in stock right now.' : null,
    summary: findings.length
      ? `${plural(findings.length, 'item')} haven't sold in ${settings.slowMovingDays}+ days, holding ${formatMoney(tiedUp, settings.currency)} at cost.`
      : `Everything in stock has moved within the last ${settings.slowMovingDays} days.`,
  };
}

export function lowMarginSection(data: AppData, settings: RuleSettings): InsightsReport['lowMarginSales'] {
  const groups = salesByItem(data.sales)
    .filter((g) => g.margin !== null && g.margin < settings.lowMarginPercent)
    .sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0));
  const findings = groups.map((group) => ({
    group,
    item: data.items.find((i) => i.id === group.key) ?? null,
    detail:
      group.netProfit < 0
        ? `Lost ${formatMoney(-group.netProfit, settings.currency)} across ${plural(group.unitsSold, 'unit')} (margin ${formatPercent(group.margin)}).`
        : `Margin ${formatPercent(group.margin)} on ${formatMoney(group.revenue, settings.currency)} of sales — below your ${settings.lowMarginPercent}% target.`,
  }));
  const losses = findings.filter((f) => f.group.netProfit < 0).length;
  return {
    id: 'low-margin',
    title: 'Low or negative profit',
    severity: losses ? 'critical' : 'warning',
    rule: `Items whose recorded sales earned less than a ${settings.lowMarginPercent}% profit margin after cost, fees, shipping and other expenses.`,
    findings,
    insufficient: data.sales.length === 0 ? 'No sales recorded yet. Record a sale to see which items earn the least.' : null,
    summary: findings.length
      ? `${plural(findings.length, 'item')} earned under ${settings.lowMarginPercent}% margin${losses ? `; ${losses} sold at a loss` : ''}.`
      : `Every item you've sold earned at least a ${settings.lowMarginPercent}% margin.`,
  };
}


export function pricingRiskSection(data: AppData, settings: RuleSettings, rate: SellingCostRate): InsightSection {
  const priced = data.items.filter((i) => i.quantity > 0 && i.askingPrice !== null);
  const findings = priced
    .map((item) => ({ item, unit: projectedUnitProfit(item, rate.percent)!, margin: projectedMargin(item, rate.percent) }))
    .filter((x) => x.unit < 0 || (x.margin !== null && x.margin < settings.lowMarginPercent))
    .sort((a, b) => a.unit - b.unit)
    .map(({ item, unit, margin }) => ({
      item,
      detail:
        item.askingPrice! < item.unitCost
          ? `Asking ${formatMoney(item.askingPrice!, settings.currency)} is below your cost of ${formatMoney(item.unitCost, settings.currency)}.`
          : unit < 0
            ? `After ~${formatPercent(rate.percent, 0)} selling costs you'd lose ${formatMoney(-unit, settings.currency)} per unit.`
            : `Projected margin ${formatPercent(margin)} per unit after ~${formatPercent(rate.percent, 0)} selling costs.`,
    }));
  const rateText =
    rate.source === 'history'
      ? `your average selling costs of ${formatPercent(rate.percent)} (learned from ${plural(rate.basedOnSales, 'sale')})`
      : rate.source === 'setting'
        ? `the ${formatPercent(rate.percent)} selling-cost estimate from Settings`
        : 'no selling costs (record sales with fees, or set an estimate in Settings, for a more realistic check)';
  return {
    id: 'pricing',
    title: 'Prices that may not be profitable',
    severity: 'warning',
    rule: `Unsold items whose asking price, minus ${rateText}, leaves less than a ${settings.lowMarginPercent}% margin over cost.`,
    findings,
    insufficient: priced.length === 0 ? 'No in-stock items have an asking price yet.' : null,
    summary: findings.length
      ? `${plural(findings.length, 'asking price')} may leave little or no profit.`
      : `All ${plural(priced.length, 'asking price')} clear your ${settings.lowMarginPercent}% margin target.`,
  };
}

export function topRevenueSection(data: AppData, settings: RuleSettings): InsightsReport['topRevenue'] {
  const groups = salesByItem(data.sales)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
  return {
    id: 'top-revenue',
    title: 'Top earners',
    severity: 'good',
    rule: 'Items ranked by total revenue from recorded sales, with their net profit.',
    findings: groups.map((group) => ({
      group,
      item: data.items.find((i) => i.id === group.key) ?? null,
      detail: `${formatMoney(group.revenue, settings.currency)} revenue · ${formatMoney(group.netProfit, settings.currency)} net profit · ${plural(group.unitsSold, 'unit')} sold.`,
    })),
    insufficient: data.sales.length === 0 ? 'No sales recorded yet.' : null,
    summary: groups.length ? `${groups[0].label} leads with ${formatMoney(groups[0].revenue, settings.currency)} in revenue.` : '',
  };
}

export function discrepancySection(data: AppData, settings: RuleSettings, today: string): InsightsReport['discrepancies'] {
  const since = addDays(today, -90);
  const recent = data.adjustments
    .filter((a) => (a.source === 'count_check' || a.source === 'manual') && a.difference !== 0 && a.date.slice(0, 10) >= since)
    .sort((a, b) => b.date.localeCompare(a.date));
  const lost = recent.filter((a) => a.difference < 0).reduce((s, a) => s + a.valueDifference, 0);
  const latest: CountRecord | undefined = data.countHistory[data.countHistory.length - 1];
  const unresolved = latest ? latest.lines.filter((l) => l.status !== 'match' && !l.applied).length : 0;
  return {
    id: 'discrepancies',
    title: 'Inventory discrepancies',
    severity: lost < 0 ? 'warning' : 'info',
    rule: 'Quantity corrections from Count Check and manual adjustments in the last 90 days.',
    findings: recent.map((adjustment) => ({
      adjustment,
      detail: `${adjustment.difference > 0 ? '+' : ''}${adjustment.difference} (${formatMoney(adjustment.valueDifference, settings.currency)}) — ${adjustment.reason || 'no reason given'}.`,
    })),
    insufficient:
      data.countHistory.length === 0 && recent.length === 0
        ? 'No physical counts yet. Use Count Check to compare what you have on the shelf with your records.'
        : null,
    summary: recent.length
      ? `${plural(recent.length, 'correction')} in 90 days; shortages cost ${formatMoney(-lost, settings.currency)} at cost.${unresolved ? ` ${unresolved} difference(s) from your last count were not applied.` : ''}`
      : `No quantity corrections in the last 90 days.${unresolved ? ` ${unresolved} difference(s) from your last count were not applied.` : ''}`,
  };
}

export function categorySection(data: AppData, settings: RuleSettings): InsightsReport['categories'] {
  const groups = salesByCategory(data.sales).sort((a, b) => b.netProfit - a.netProfit);
  return {
    id: 'categories',
    title: 'Category performance',
    severity: 'info',
    rule: 'Realized net profit by category from recorded sales.',
    findings: groups.map((group) => ({
      group,
      detail: `${formatMoney(group.netProfit, settings.currency)} profit on ${formatMoney(group.revenue, settings.currency)} (${formatPercent(group.margin)} margin).`,
    })),
    insufficient: data.sales.length === 0 ? 'No sales recorded yet.' : null,
    summary: groups.length ? `${groups[0].label} is your most profitable category.` : '',
  };
}

export function dataGaps(data: AppData): string[] {
  const gaps: string[] = [];
  const t = inventoryTotals(data.items);
  if (data.items.length === 0) gaps.push('Add your first items to unlock insights.');
  if (t.itemsMissingAsking > 0) gaps.push(`${plural(t.itemsMissingAsking, 'in-stock item')} ${t.itemsMissingAsking === 1 ? 'has' : 'have'} no asking price, so ${t.itemsMissingAsking === 1 ? "it isn't" : "they aren't"} included in projected profit or pricing checks.`);
  const noDate = data.items.filter((i) => i.quantity > 0 && !i.purchaseDate).length;
  if (noDate > 0) gaps.push(`${plural(noDate, 'item')} ${noDate === 1 ? 'has' : 'have'} no purchase date; ${noDate === 1 ? 'its' : 'their'} age is counted from when ${noDate === 1 ? 'it was' : 'they were'} added.`);
  if (data.sales.length > 0 && totalSales(data.sales).totalExpenses === 0) gaps.push('None of your sales include fees or shipping. If you paid any, add them for accurate profit.');
  return gaps;
}

export function buildInsights(data: AppData, settings: RuleSettings, today: string = todayISO()): InsightsReport {
  const rate = sellingCostRate(data.sales, settings);
  return {
    generatedFor: today,
    lowStock: lowStockSection(data.items),
    slowMoving: slowMovingSection(data, settings, today),
    lowMarginSales: lowMarginSection(data, settings),
    pricingRisks: pricingRiskSection(data, settings, rate),
    topRevenue: topRevenueSection(data, settings),
    discrepancies: discrepancySection(data, settings, today),
    categories: categorySection(data, settings),
    dataGaps: dataGaps(data),
    rate,
  };
}

/** Count of actionable alerts, for the nav badge. */
export function alertCount(report: InsightsReport): number {
  return report.lowStock.findings.length + report.pricingRisks.findings.length + report.slowMoving.findings.length;
}
