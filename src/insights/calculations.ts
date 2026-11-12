// The deterministic financial engine behind the assistant's answers.
//
// Every financial answer is a Calculation: the figure, the period it covers, the formula, the
// lines that make it up, and the saved records each line comes from. Each record carries its
// own part of each line ("parts"), so any number shown can be re-added from the records —
// verifyCalculation() does exactly that, and tests run it on every answer.
//
// Nothing here uses an AI model, estimates a missing amount or changes a record. An AI layer
// may only put these results into words (see src/ai/explainSchema.ts).

import { computeSale, daysWithoutSale, itemCostValue, itemAskingValue, itemEstimatedValue, salesByItem, sellingCostRate, totalSales, type GroupTotals } from '../domain/calc';
import { formatDate, type DateRange } from '../domain/dates';
import { formatMoney, formatPercent, fromCents, roundMoney, toCents } from '../domain/money';
import { lotForItem, lotSummary, lotTotal } from '../domain/lots';
import { FAILED_STATUS, PENDING_STATUS, reconcile, type PayoutRecon, type ReconciliationReport } from '../domain/reconcile';
import { plural } from '../domain/format';
import type { TermKey } from '../domain/terms';
import type { AppData, Item, Sale, Settings } from '../domain/types';

/** 'recorded': from your saved records. 'estimate': uses your own estimates or assumptions. 'reconciliation': from imported payout reports. */
export type Basis = 'recorded' | 'estimate' | 'reconciliation';

export interface CalcLine {
  key: string;
  label: string;
  /** Always shown as a positive amount; `op` says how it combines. */
  amount: number;
  /** '+' / '-': part of the total. '=': the total. 'sub': a subtotal shown for clarity. 'info': shown alongside, not summed. */
  op: '+' | '-' | '=' | 'sub' | 'info';
  /** The amount is the sum of the records' parts under this key. */
  fromRecords: boolean;
  /** The figure is negative (a loss, or less than expected); `amount` stays positive. */
  negative?: boolean;
  /** Records' parts carry a sign (e.g. net write-offs): they add up to −amount when the line is '-' or negative. */
  signedParts?: boolean;
  /** How it's worked out, when it isn't a plain sum of records. */
  note?: string;
  basis?: Basis;
  term?: TermKey;
}

export interface RecordLink {
  label: string;
  href: string;
}

export interface SourceRecord {
  kind: 'sale' | 'item' | 'lot' | 'payout' | 'finding';
  id: string;
  label: string;
  detail: string;
  date?: string;
  links: RecordLink[];
  /** This record's part of each line, by line key, in currency units. */
  parts: Record<string, number>;
}

export interface Calculation {
  metric: string;
  title: string;
  /** The headline figure (null when the answer is a list, not a single amount). */
  value: number | null;
  /** The dates the figure covers, or null for a snapshot "as of" today. */
  period: Pick<DateRange, 'start' | 'end' | 'label'> | null;
  asOf: string;
  formula: string;
  lines: CalcLine[];
  records: SourceRecord[];
  warnings: string[];
  basis: Basis;
}

export interface CalcContext {
  data: AppData;
  settings: Settings;
  today: string;
  /** Computed once per question, lazily. */
  recon: () => ReconciliationReport;
}

export function calcContext(data: AppData, settings: Settings, today: string): CalcContext {
  let cached: ReconciliationReport | null = null;
  return { data, settings, today, recon: () => (cached ??= reconcile(data, settings.currency)) };
}

const sum = (values: number[]) => fromCents(values.reduce((c, v) => c + toCents(v), 0));

/**
 * Re-adds every line from its records and checks the totals. Returns the problems found ([]
 * when the calculation is consistent). Used by tests on every answer, and by the app before it
 * shows a calculation as verified.
 */
export function verifyCalculation(calc: Calculation): string[] {
  const problems: string[] = [];
  for (const line of calc.lines) {
    if (line.amount < 0) problems.push(`${line.label}: amounts are shown as positive figures`);
    if (!line.fromRecords) continue;
    const fromParts = calc.records.reduce((c, r) => c + toCents(r.parts[line.key] ?? 0), 0);
    const expected = line.signedParts && (line.op === '-' || line.negative) ? -toCents(line.amount) : toCents(line.amount);
    if (fromParts !== expected) problems.push(`${line.label}: records add up to ${fromCents(fromParts)}, line says ${line.amount}`);
  }
  const chain = calc.lines.filter((l) => l.op === '+' || l.op === '-');
  const total = calc.lines.find((l) => l.op === '=');
  if (total && chain.length) {
    const cents = chain.reduce((c, l) => c + (l.op === '+' ? 1 : -1) * toCents(l.amount), 0);
    const stated = total.negative ? -toCents(total.amount) : toCents(total.amount);
    if (cents !== stated) problems.push(`${total.label}: lines add up to ${fromCents(cents)}, total says ${fromCents(stated)}`);
  }
  const sub = calc.lines.find((l) => l.op === 'sub');
  if (sub) {
    // A subtotal is the chain up to it.
    const before = calc.lines.slice(0, calc.lines.indexOf(sub)).filter((l) => l.op === '+' || l.op === '-');
    const cents = before.reduce((c, l) => c + (l.op === '+' ? 1 : -1) * toCents(l.amount), 0);
    if (cents !== (sub.negative ? -toCents(sub.amount) : toCents(sub.amount))) problems.push(`${sub.label}: lines add up to ${fromCents(cents)}, subtotal says ${sub.amount}`);
  }
  if (total && calc.value !== null && (total.negative ? -1 : 1) * toCents(total.amount) !== toCents(calc.value) && calc.metric !== 'payout') {
    problems.push(`value ${calc.value} differs from ${total.label}`);
  }
  return problems;
}

/** Every amount a calculation states, for checking an AI's wording against (see verifyNumbers). */
export function calculationAmounts(calc: Calculation): number[] {
  const out = new Set<number>();
  const add = (n: number | null | undefined) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return;
    out.add(roundMoney(Math.abs(n)));
  };
  add(calc.value);
  for (const l of calc.lines) add(l.amount);
  for (const r of calc.records) for (const v of Object.values(r.parts)) add(v);
  return [...out];
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export function saleRecord(ctx: CalcContext, sale: Sale): SourceRecord {
  const money = (n: number) => formatMoney(n, ctx.settings.currency);
  const f = computeSale(sale);
  const item = ctx.data.items.find((i) => i.id === sale.itemId);
  const lot = item ? lotForItem(ctx.data, item.id) : null;
  const txnId = ctx.data.marketplace.transactions.length ? ctx.recon().matching.txnBySale.get(sale.id) : undefined;
  const payoutId = txnId ? ctx.data.marketplace.transactions.find((t) => t.id === txnId)?.payoutId : undefined;
  const links: RecordLink[] = [];
  if (item) links.push({ label: item.name, href: `/inventory/${item.id}` });
  if (lot) links.push({ label: `Lot: ${lot.lot.name}`, href: `/inventory/lots/${lot.lot.id}` });
  if (payoutId) links.push({ label: `eBay payout ${payoutId}`, href: `/sales/payouts/${encodeURIComponent(payoutId)}` });
  if (!item) links.push({ label: 'Sales & Profit', href: '/sales' });
  const costNote = `cost ${sale.quantity} × ${money(sale.unitCost)}${lot ? ` (its share of lot “${lot.lot.name}”)` : ''}${item ? '' : ' (item since deleted)'}`;
  return {
    kind: 'sale',
    id: sale.id,
    label: `${sale.itemName}${sale.quantity > 1 ? ` × ${sale.quantity}` : ''}`,
    detail: [formatDate(sale.saleDate), sale.platform || 'no platform', sale.orderNumber && `order ${sale.orderNumber}`, costNote].filter(Boolean).join(' · '),
    date: sale.saleDate,
    links,
    parts: {
      revenue: f.revenue,
      cogs: f.costOfGoods,
      fees: f.fees,
      shipping: f.shipping,
      other: f.otherExpenses,
      profit: f.netProfit,
    },
  };
}

function itemLinks(ctx: CalcContext, item: Item): RecordLink[] {
  const lot = lotForItem(ctx.data, item.id);
  return [{ label: item.name, href: `/inventory/${item.id}` }, ...(lot ? [{ label: `Lot: ${lot.lot.name}`, href: `/inventory/lots/${lot.lot.id}` }] : [])];
}

/** Warnings that apply to any figure built from recorded sales. */
export function saleWarnings(ctx: CalcContext, sales: Sale[]): string[] {
  const money = (n: number) => formatMoney(n, ctx.settings.currency);
  const warnings: string[] = [];
  // Possible duplicates: same item, day, quantity, amount and order number.
  const groups = new Map<string, Sale[]>();
  for (const s of sales) {
    const key = [s.itemId, s.saleDate, s.quantity, toCents(computeSale(s).revenue), s.orderNumber.trim().toLowerCase()].join('|');
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  for (const g of groups.values()) {
    if (g.length > 1) {
      warnings.push(
        `Possible duplicate: ${g.length} sales of ${g[0].itemName} on ${formatDate(g[0].saleDate)} for ${money(computeSale(g[0]).revenue)} each${g[0].orderNumber ? ` (order ${g[0].orderNumber})` : ''}. All are counted; if one was entered twice, cancel it in Sales & Profit.`,
      );
    }
  }
  const noCost = sales.filter((s) => s.unitCost === 0);
  if (noCost.length) warnings.push(`${plural(noCost.length, 'sale')} ${noCost.length === 1 ? 'has' : 'have'} no recorded item cost, so ${noCost.length === 1 ? 'its' : 'their'} cost of goods sold is $0 and profit may be overstated.`);

  if (ctx.data.marketplace.transactions.length && sales.length) {
    const r = ctx.recon();
    const ids = new Set(sales.map((s) => s.id));
    const rows = [...r.payouts.flatMap((p) => p.rows), ...r.notPaidOut.rows];
    for (const row of rows) {
      if (row.txn.kind !== 'refund' || !row.saleIds.some((id) => ids.has(id))) continue;
      const sale = sales.find((s) => row.saleIds.includes(s.id))!;
      const reviewed = !row.outstanding;
      warnings.push(
        `eBay’s report shows a ${money(Math.abs(row.txn.net))} refund on order ${row.txn.orderNumber || '?'} (${sale.itemName}). StockPilot doesn’t change your sale automatically: if the sale doesn’t reflect the refund, this profit is overstated by up to ${money(Math.abs(row.txn.net))}.${reviewed ? ' You marked this refund as reviewed.' : ''}`,
      );
    }
    const open = r.payouts.filter((p) => (p.status === 'unreconciled' || p.status === 'needs_review') && p.rows.some((row) => row.saleIds.some((id) => ids.has(id)) && row.txn.kind === 'sale'));
    if (open.length) {
      warnings.push(`Some of these sales are in eBay payouts that don’t reconcile yet (${open.map((p) => p.ref).join(', ')}). These figures are your recorded sales, not what eBay paid.`);
    }
  }
  return warnings;
}

const periodOf = (range: DateRange) => ({ start: range.start, end: range.end, label: range.label });

// ---------------------------------------------------------------------------
// Sales: realized profit, revenue, selling expenses
// ---------------------------------------------------------------------------

export function profitCalculation(ctx: CalcContext, sales: Sale[], range: DateRange, scope = ''): Calculation {
  const t = totalSales(sales);
  const records = [...sales].sort((a, b) => a.saleDate.localeCompare(b.saleDate) || a.createdAt.localeCompare(b.createdAt)).map((s) => saleRecord(ctx, s));
  return {
    metric: 'realized_profit',
    title: `Realized profit${scope ? ` ${scope}` : ''}`,
    value: t.netProfit,
    period: periodOf(range),
    asOf: ctx.today,
    formula: 'Realized profit = sales revenue − cost of goods sold − marketplace fees − shipping you paid − other expenses, for sales dated in the period.',
    lines: [
      { key: 'revenue', label: 'Sales revenue', amount: t.revenue, op: '+', fromRecords: true },
      { key: 'cogs', label: 'Cost of goods sold', amount: t.costOfGoods, op: '-', fromRecords: true, note: 'What the sold units cost you (recorded with each sale)' },
      { key: 'gross', label: 'Gross profit', amount: Math.abs(fromCents(toCents(t.revenue) - toCents(t.costOfGoods))), op: 'sub', fromRecords: false, negative: t.revenue < t.costOfGoods },
      { key: 'fees', label: 'Marketplace fees', amount: t.fees, op: '-', fromRecords: true },
      { key: 'shipping', label: 'Shipping you paid', amount: t.shipping, op: '-', fromRecords: true },
      { key: 'other', label: 'Other expenses', amount: t.otherExpenses, op: '-', fromRecords: true },
      { key: 'profit', label: t.netProfit < 0 ? 'Realized loss' : 'Realized profit', amount: Math.abs(t.netProfit), op: '=', fromRecords: false, negative: t.netProfit < 0, term: 'realizedProfit' },
    ],
    records,
    warnings: saleWarnings(ctx, sales),
    basis: 'recorded',
  };
}

export function revenueCalculation(ctx: CalcContext, sales: Sale[], range: DateRange, scope = ''): Calculation {
  const t = totalSales(sales);
  return {
    metric: 'revenue',
    title: `Sales revenue${scope ? ` ${scope}` : ''}`,
    value: t.revenue,
    period: periodOf(range),
    asOf: ctx.today,
    formula: 'Sales revenue = sale price × quantity (or the total entered), for sales dated in the period. It is before any costs, so it isn’t profit.',
    lines: [{ key: 'revenue', label: 'Sales revenue', amount: t.revenue, op: '=', fromRecords: true }],
    records: [...sales].sort((a, b) => a.saleDate.localeCompare(b.saleDate)).map((s) => saleRecord(ctx, s)),
    warnings: saleWarnings(ctx, sales),
    basis: 'recorded',
  };
}

export function expensesCalculation(ctx: CalcContext, sales: Sale[], range: DateRange): Calculation {
  const t = totalSales(sales);
  return {
    metric: 'selling_expenses',
    title: 'Selling expenses',
    value: t.totalExpenses,
    period: periodOf(range),
    asOf: ctx.today,
    formula: 'Selling expenses = marketplace fees + shipping you paid + other expenses recorded on sales in the period. What the items cost you isn’t a selling expense (it’s cost of goods sold).',
    lines: [
      { key: 'fees', label: 'Marketplace fees', amount: t.fees, op: '+', fromRecords: true },
      { key: 'shipping', label: 'Shipping you paid', amount: t.shipping, op: '+', fromRecords: true },
      { key: 'other', label: 'Other expenses', amount: t.otherExpenses, op: '+', fromRecords: true },
      { key: 'total', label: 'Total selling expenses', amount: t.totalExpenses, op: '=', fromRecords: false },
    ],
    records: [...sales]
      .map((s) => saleRecord(ctx, s))
      .sort((a, b) => toCents(b.parts.fees + b.parts.shipping + b.parts.other) - toCents(a.parts.fees + a.parts.shipping + a.parts.other)),
    warnings: saleWarnings(ctx, sales),
    basis: 'recorded',
  };
}

// ---------------------------------------------------------------------------
// Rankings by item
// ---------------------------------------------------------------------------

function groupRecord(ctx: CalcContext, g: GroupTotals): SourceRecord {
  const item = ctx.data.items.find((i) => i.id === g.key);
  return {
    kind: 'item',
    id: g.key,
    label: g.label,
    detail: `${plural(g.salesCount, 'sale')}, ${plural(g.unitsSold, 'unit')} · margin ${formatPercent(g.margin)}${item ? '' : ' · item since deleted'}`,
    links: item ? itemLinks(ctx, item) : [{ label: 'Sales & Profit', href: '/sales' }],
    parts: { revenue: g.revenue, profit: g.netProfit, units: g.unitsSold },
  };
}

export function itemRankingCalculation(ctx: CalcContext, sales: Sale[], range: DateRange, by: 'profit' | 'revenue' | 'units' | 'margin'): Calculation {
  const groups = salesByItem(sales).sort((a, b) =>
    by === 'margin'
      ? (a.margin ?? 0) - (b.margin ?? 0)
      : by === 'units'
        ? b.unitsSold - a.unitsSold || b.revenue - a.revenue
        : by === 'revenue'
          ? b.revenue - a.revenue
          : b.netProfit - a.netProfit,
  );
  const t = totalSales(sales);
  const label = { profit: 'Items ranked by realized profit', revenue: 'Items ranked by sales revenue', units: 'Best-selling items (units sold)', margin: 'Items ranked by profit margin, lowest first' }[by];
  return {
    metric: `items_by_${by}`,
    title: label,
    value: null,
    period: periodOf(range),
    asOf: ctx.today,
    formula:
      by === 'margin'
        ? 'Profit margin = realized profit ÷ sales revenue for each item’s sales in the period.'
        : by === 'units'
          ? 'Units sold per item, from sales dated in the period (revenue breaks ties).'
          : `Each item’s ${by === 'revenue' ? 'sales revenue' : 'realized profit (revenue − cost of goods − fees − shipping − other)'} from sales dated in the period.`,
    lines: [
      { key: 'revenue', label: 'Sales revenue, all items', amount: t.revenue, op: 'info', fromRecords: true },
      { key: 'profit', label: t.netProfit < 0 ? 'Realized loss, all items' : 'Realized profit, all items', amount: Math.abs(t.netProfit), op: 'info', fromRecords: true, signedParts: true, negative: t.netProfit < 0 },
    ],
    records: groups.map((g) => groupRecord(ctx, g)),
    warnings: saleWarnings(ctx, sales),
    basis: 'recorded',
  };
}

// ---------------------------------------------------------------------------
// Inventory: cost, worth, slow-moving, purchases, projected profit
// ---------------------------------------------------------------------------

function itemRecord(ctx: CalcContext, item: Item, parts: Record<string, number>, extra = ''): SourceRecord {
  const money = (n: number) => formatMoney(n, ctx.settings.currency);
  const lot = lotForItem(ctx.data, item.id);
  return {
    kind: 'item',
    id: item.id,
    label: item.name,
    detail: [`${item.quantity} on hand × ${money(item.unitCost)} cost`, lot && `cost is its share of lot “${lot.lot.name}”`, extra].filter(Boolean).join(' · '),
    links: itemLinks(ctx, item),
    parts,
  };
}

function inventoryWarnings(ctx: CalcContext, items: Item[]): string[] {
  const warnings: string[] = [];
  const free = items.filter((i) => i.unitCost === 0);
  if (free.length) warnings.push(`${plural(free.length, 'item')} in stock ${free.length === 1 ? 'has' : 'have'} a cost of $0, so ${free.length === 1 ? 'it adds' : 'they add'} nothing to inventory cost.`);
  for (const lot of ctx.data.lots) {
    const s = lotSummary(ctx.data, lot);
    if (!s.reconciled && items.some((i) => lot.lines.some((l) => l.itemId === i.id))) {
      warnings.push(`Lot “${lot.name}” has ${formatMoney(Math.abs(s.otherChanges), ctx.settings.currency)} of cost changed outside the lot (an item edited or deleted directly).`);
    }
  }
  return warnings;
}

export function inventoryCostCalculation(ctx: CalcContext): Calculation {
  const items = ctx.data.items.filter((i) => i.quantity > 0).sort((a, b) => itemCostValue(b) - itemCostValue(a));
  const total = sum(items.map(itemCostValue));
  return {
    metric: 'inventory_cost',
    title: 'Inventory cost (money invested in unsold stock)',
    value: total,
    period: null,
    asOf: ctx.today,
    formula: 'Inventory cost = cost per item × quantity on hand, for every item in stock today. It’s what you paid, not what it may sell for.',
    lines: [{ key: 'cost', label: 'Inventory cost', amount: total, op: '=', fromRecords: true, term: 'inventoryCost' }],
    records: items.map((i) => itemRecord(ctx, i, { cost: itemCostValue(i) })),
    warnings: inventoryWarnings(ctx, items),
    basis: 'recorded',
  };
}

export function inventoryWorthCalculation(ctx: CalcContext): Calculation {
  const items = ctx.data.items.filter((i) => i.quantity > 0);
  const cost = sum(items.map(itemCostValue));
  const asking = sum(items.map((i) => itemAskingValue(i) ?? 0));
  const market = sum(items.map((i) => itemEstimatedValue(i) ?? 0));
  const noAsking = items.filter((i) => i.askingPrice === null).length;
  const noEstimate = items.filter((i) => i.estimatedValue === null).length;
  return {
    metric: 'inventory_worth',
    title: 'What your unsold inventory is worth, three ways',
    value: null,
    period: null,
    asOf: ctx.today,
    formula: 'Each figure is a per-item amount × quantity on hand, added up over items in stock. They answer different questions and are never added together.',
    lines: [
      { key: 'cost', label: 'Inventory cost (what you paid)', amount: cost, op: 'info', fromRecords: true, term: 'inventoryCost' },
      { key: 'asking', label: 'Total asking price (what it’s listed for)', amount: asking, op: 'info', fromRecords: true, term: 'totalAsking', basis: 'estimate' },
      { key: 'market', label: 'Est. market value (your own estimate)', amount: market, op: 'info', fromRecords: true, term: 'marketValue', basis: 'estimate' },
    ],
    records: items.map((i) => itemRecord(ctx, i, { cost: itemCostValue(i), asking: itemAskingValue(i) ?? 0, market: itemEstimatedValue(i) ?? 0 })),
    warnings: [
      ...(noAsking ? [`${plural(noAsking, 'item')} without an asking price ${noAsking === 1 ? 'isn’t' : 'aren’t'} in the total asking price.`] : []),
      ...(noEstimate ? [`${plural(noEstimate, 'item')} without an estimated value ${noEstimate === 1 ? 'isn’t' : 'aren’t'} in the est. market value.`] : []),
      ...inventoryWarnings(ctx, items),
    ],
    basis: 'recorded',
  };
}

export function slowMovingCalculation(ctx: CalcContext): Calculation {
  const days = ctx.settings.slowMovingDays;
  const slow = ctx.data.items
    .filter((i) => i.quantity > 0)
    .map((item) => ({ item, days: daysWithoutSale(item, ctx.data.sales, ctx.today) }))
    .filter((x) => x.days >= days)
    .sort((a, b) => itemCostValue(b.item) - itemCostValue(a.item));
  const total = sum(slow.map((x) => itemCostValue(x.item)));
  return {
    metric: 'slow_moving_cost',
    title: `Inventory cost tied up in slow-moving stock (${days}+ days without a sale)`,
    value: total,
    period: null,
    asOf: ctx.today,
    formula: `Inventory cost (cost × quantity on hand) of items that haven’t sold for ${days}+ days, counted from the purchase date or the last sale, whichever is later. The threshold is set in Settings.`,
    lines: [{ key: 'cost', label: 'Inventory cost in slow-moving items', amount: total, op: '=', fromRecords: true, term: 'inventoryCost' }],
    records: slow.map((x) => itemRecord(ctx, x.item, { cost: itemCostValue(x.item) }, `${plural(x.days, 'day')} without a sale`)),
    warnings: inventoryWarnings(
      ctx,
      slow.map((x) => x.item),
    ),
    basis: 'recorded',
  };
}

/**
 * What all recorded inventory cost: still in stock + already sold (cost of goods sold) +
 * written off or corrected. Buying inventory isn't an expense: its cost moves to cost of goods
 * sold when it sells.
 */
export function inventorySpendCalculation(ctx: CalcContext): Calculation {
  const { data } = ctx;
  const byItem = new Map<string, { label: string; item: Item | null; inStock: number; sold: number; writtenOff: number }>();
  const entry = (id: string, label: string) => {
    let e = byItem.get(id);
    if (!e) {
      const item = data.items.find((i) => i.id === id) ?? null;
      e = { label: item?.name ?? label, item, inStock: 0, sold: 0, writtenOff: 0 };
      byItem.set(id, e);
    }
    return e;
  };
  for (const i of data.items) entry(i.id, i.name).inStock = itemCostValue(i);
  for (const s of data.sales) {
    const e = entry(s.itemId, s.itemName);
    e.sold = fromCents(toCents(e.sold) + toCents(computeSale(s).costOfGoods));
  }
  for (const a of data.adjustments) {
    if (a.source === 'restock') continue;
    const e = entry(a.itemId, a.itemName);
    e.writtenOff = fromCents(toCents(e.writtenOff) - toCents(a.valueDifference));
  }
  const rows = [...byItem.entries()].filter(([, e]) => e.inStock || e.sold || e.writtenOff);
  const inStock = sum(rows.map(([, e]) => e.inStock));
  const sold = sum(rows.map(([, e]) => e.sold));
  const writtenOff = sum(rows.map(([, e]) => e.writtenOff));
  const total = fromCents(toCents(inStock) + toCents(sold) + toCents(writtenOff));
  const lotsTotal = sum(data.lots.map(lotTotal));
  const money = (n: number) => formatMoney(n, ctx.settings.currency);
  return {
    metric: 'inventory_spend',
    title: 'Recorded inventory purchases (all time)',
    value: total,
    period: null,
    asOf: ctx.today,
    formula:
      'Inventory purchases = cost of what you still have (inventory cost) + cost of what you’ve sold (cost of goods sold) + cost written off or corrected in counts and adjustments. Buying stock isn’t an expense: its cost becomes cost of goods sold when it sells.',
    lines: [
      { key: 'inStock', label: 'Still in stock (inventory cost)', amount: inStock, op: '+', fromRecords: true, term: 'inventoryCost' },
      { key: 'sold', label: 'Already sold (cost of goods sold)', amount: sold, op: '+', fromRecords: true },
      { key: 'writtenOff', label: writtenOff < 0 ? 'Found in counts (net)' : 'Written off or corrected (net)', amount: Math.abs(writtenOff), op: writtenOff < 0 ? '-' : '+', fromRecords: true, signedParts: true, note: 'Cost of units removed (or added back) by counts and adjustments' },
      { key: 'total', label: 'Recorded inventory purchases', amount: Math.abs(total), op: '=', fromRecords: false, negative: total < 0 },
    ],
    records: rows
      .map(([id, e]) => ({
        kind: 'item' as const,
        id,
        label: e.label,
        detail: [e.item ? `${e.item.quantity} on hand` : 'item since deleted', e.sold ? `${money(e.sold)} sold` : '', e.writtenOff ? `${money(e.writtenOff)} written off` : ''].filter(Boolean).join(' · '),
        links: e.item ? itemLinks(ctx, e.item) : [{ label: 'Sales & Profit', href: '/sales' }],
        parts: { inStock: e.inStock, sold: e.sold, writtenOff: e.writtenOff },
      }))
      .sort((a, b) => toCents(b.parts.inStock + b.parts.sold) - toCents(a.parts.inStock + a.parts.sold)),
    warnings: [
      ...(data.lots.length ? [`Includes ${plural(data.lots.length, 'bulk lot')} bought for ${money(lotsTotal)} in total (purchase prices plus additional costs), through their items.`] : []),
      'Items deleted before they sold aren’t included, because their cost is no longer recorded.',
    ],
    basis: 'recorded',
  };
}

export function projectedProfitCalculation(ctx: CalcContext): Calculation {
  const rate = sellingCostRate(ctx.data.sales, ctx.settings);
  const priced = ctx.data.items.filter((i) => i.quantity > 0 && i.askingPrice !== null);
  const unpriced = ctx.data.items.filter((i) => i.quantity > 0 && i.askingPrice === null);
  const revenue = sum(priced.map((i) => itemAskingValue(i)!));
  const costs = roundMoney((revenue * rate.percent) / 100);
  const cost = sum(priced.map(itemCostValue));
  const profit = fromCents(toCents(revenue) - toCents(costs) - toCents(cost));
  const rateNote =
    rate.source === 'setting'
      ? `${formatPercent(rate.percent)} of the asking prices (your setting)`
      : rate.source === 'history'
        ? `${formatPercent(rate.percent)} of the asking prices: your fees, shipping and other costs as a share of revenue over ${plural(rate.basedOnSales, 'sale')}`
        : '0%: no sales or setting to estimate selling costs from yet';
  return {
    metric: 'projected_profit',
    title: 'Projected profit if unsold stock sells at its asking prices',
    value: profit,
    period: null,
    asOf: ctx.today,
    formula: 'Projected profit = asking price × quantity − estimated selling costs − what those items cost you, for in-stock items with an asking price. It’s a projection, not money earned.',
    lines: [
      { key: 'revenue', label: 'Asking price × quantity', amount: revenue, op: '+', fromRecords: true, term: 'totalAsking', basis: 'estimate' },
      { key: 'sellingCosts', label: 'Estimated selling costs', amount: costs, op: '-', fromRecords: false, note: rateNote, basis: 'estimate' },
      { key: 'cost', label: 'What those items cost you', amount: cost, op: '-', fromRecords: true, term: 'inventoryCost' },
      { key: 'profit', label: profit < 0 ? 'Projected loss' : 'Projected profit', amount: Math.abs(profit), op: '=', fromRecords: false, negative: profit < 0, term: 'projectedProfit', basis: 'estimate' },
    ],
    records: priced.map((i) => itemRecord(ctx, i, { revenue: itemAskingValue(i)!, cost: itemCostValue(i) }, `asking ${formatMoney(i.askingPrice!, ctx.settings.currency)} each`)),
    warnings: [
      ...(unpriced.length ? [`${plural(unpriced.length, 'item')} in stock ${unpriced.length === 1 ? 'has' : 'have'} no asking price and ${unpriced.length === 1 ? 'isn’t' : 'aren’t'} included.`] : []),
      ...(rate.source === 'none' ? ['There are no recorded sales to estimate selling costs from, so none are deducted. Set a selling-cost % in Settings for a better projection.'] : []),
    ],
    basis: 'estimate',
  };
}

// ---------------------------------------------------------------------------
// Possible losses
// ---------------------------------------------------------------------------

export function lossReviewCalculation(ctx: CalcContext): Calculation {
  const money = (n: number) => formatMoney(n, ctx.settings.currency);
  const { data } = ctx;
  const records: SourceRecord[] = [];
  for (const s of [...data.sales].sort((a, b) => a.saleDate.localeCompare(b.saleDate))) {
    const f = computeSale(s);
    if (f.netProfit >= 0) continue;
    const item = data.items.find((i) => i.id === s.itemId);
    records.push({
      kind: 'sale',
      id: s.id,
      label: s.itemName,
      detail: `Sold ${formatDate(s.saleDate)} at a loss of ${money(-f.netProfit)}: ${money(f.revenue)} sale − ${money(f.costOfGoods)} cost − ${money(f.totalExpenses)} fees, shipping and other`,
      date: s.saleDate,
      links: item ? itemLinks(ctx, item) : [{ label: 'Sales & Profit', href: '/sales' }],
      parts: { realized: -f.netProfit },
    });
  }
  for (const item of data.items.filter((i) => i.quantity > 0)) {
    const shortfall = item.estimatedValue !== null && item.estimatedValue < item.unitCost ? fromCents((toCents(item.unitCost) - toCents(item.estimatedValue)) * item.quantity) : 0;
    const belowCost = item.askingPrice !== null && item.askingPrice < item.unitCost;
    if (!shortfall && !belowCost) continue;
    records.push({
      kind: 'item',
      id: `${item.id}:stock`,
      label: item.name,
      detail: [
        belowCost && `asking ${money(item.askingPrice!)} is below its cost of ${money(item.unitCost)}`,
        shortfall && `your est. market value ${money(item.estimatedValue!)} is below its cost of ${money(item.unitCost)} (${item.quantity} on hand)`,
      ]
        .filter(Boolean)
        .join('; '),
      links: itemLinks(ctx, item),
      parts: { estimated: shortfall },
    });
  }
  const losses = data.adjustments.filter((a) => a.source !== 'restock' && a.valueDifference < 0);
  for (const a of losses) {
    const item = data.items.find((i) => i.id === a.itemId);
    records.push({
      kind: 'item',
      id: `${a.id}:adj`,
      label: a.itemName,
      detail: `${formatDate(a.date.slice(0, 10))}: ${Math.abs(a.difference)} unit${Math.abs(a.difference) === 1 ? '' : 's'} removed${a.reason ? ` (“${a.reason}”)` : ''}`,
      links: item ? itemLinks(ctx, item) : [{ label: 'Count Check', href: '/count' }],
      parts: { writtenOff: -a.valueDifference },
    });
  }
  const realized = sum(records.map((r) => r.parts.realized ?? 0));
  const estimated = sum(records.map((r) => r.parts.estimated ?? 0));
  const writtenOff = sum(records.map((r) => r.parts.writtenOff ?? 0));
  return {
    metric: 'loss_review',
    title: 'Items to review for possible losses',
    value: null,
    period: null,
    asOf: ctx.today,
    formula: 'Three separate checks, never added together: sales that lost money after cost, fees and shipping (recorded), units written off at cost (recorded), and in-stock items whose asking price or your own value estimate is below their cost (estimate).',
    lines: [
      { key: 'realized', label: 'Lost on completed sales (recorded)', amount: realized, op: 'info', fromRecords: true, basis: 'recorded' },
      { key: 'writtenOff', label: 'Written off in counts and adjustments (recorded)', amount: writtenOff, op: 'info', fromRecords: true, basis: 'recorded' },
      { key: 'estimated', label: 'Est. value below cost on unsold stock (estimate)', amount: estimated, op: 'info', fromRecords: true, basis: 'estimate' },
    ],
    records,
    warnings: data.sales.length ? [] : ['No sales are recorded yet, so only unsold stock and write-offs are checked.'],
    basis: 'recorded',
  };
}

// ---------------------------------------------------------------------------
// Bulk lots
// ---------------------------------------------------------------------------

export function lotProfitCalculation(ctx: CalcContext): Calculation {
  const money = (n: number) => formatMoney(n, ctx.settings.currency);
  const summaries = ctx.data.lots.map((lot) => ({ lot, s: lotSummary(ctx.data, lot) }));
  const revenue = sum(summaries.map((x) => x.s.sales.revenue));
  const cogs = sum(summaries.map((x) => x.s.sales.costOfGoods));
  const expenses = sum(summaries.map((x) => x.s.sales.totalExpenses));
  const profit = fromCents(toCents(revenue) - toCents(cogs) - toCents(expenses));
  const totalCost = sum(summaries.map((x) => x.s.total));
  const remaining = sum(summaries.map((x) => x.s.remainingCost));
  return {
    metric: 'lot_profit',
    title: 'Realized profit from bulk lots',
    value: profit,
    period: null,
    asOf: ctx.today,
    formula: 'Realized profit from lots = revenue from selling lot items − their cost of goods sold (each item’s exact share of its lot) − fees, shipping and other expenses on those sales.',
    lines: [
      { key: 'revenue', label: 'Sales revenue from lot items', amount: revenue, op: '+', fromRecords: true },
      { key: 'cogs', label: 'Cost of goods sold (lot shares)', amount: cogs, op: '-', fromRecords: true },
      { key: 'expenses', label: 'Fees, shipping and other expenses', amount: expenses, op: '-', fromRecords: true },
      { key: 'profit', label: profit < 0 ? 'Realized loss' : 'Realized profit', amount: Math.abs(profit), op: '=', fromRecords: false, negative: profit < 0, term: 'realizedProfit' },
      { key: 'totalCost', label: 'Total paid for the lots', amount: totalCost, op: 'info', fromRecords: true },
      { key: 'remaining', label: 'Lot cost still in stock', amount: remaining, op: 'info', fromRecords: true, term: 'inventoryCost' },
    ],
    records: summaries.map(({ lot, s }) => ({
      kind: 'lot' as const,
      id: lot.id,
      label: lot.name,
      detail: `${money(s.total)} lot · ${s.sales.unitsSold} of ${s.unitsBought} units sold · ${money(s.remainingCost)} still in stock${s.reconciled ? '' : ' · not fully reconciled'}`,
      date: lot.purchaseDate ?? undefined,
      links: [{ label: lot.name, href: `/inventory/lots/${lot.id}` }],
      parts: { revenue: s.sales.revenue, cogs: s.sales.costOfGoods, expenses: s.sales.totalExpenses, totalCost: s.total, remaining: s.remainingCost },
    })),
    warnings: summaries.filter((x) => !x.s.reconciled).map((x) => `Lot “${x.lot.name}” has ${money(Math.abs(x.s.otherChanges))} of cost changed outside the lot, so its figures may be incomplete.`),
    basis: 'recorded',
  };
}

// ---------------------------------------------------------------------------
// Marketplace payouts (money moved, not profit)
// ---------------------------------------------------------------------------

export function payoutCalculation(ctx: CalcContext, p: PayoutRecon): Calculation {
  const money = (n: number) => formatMoney(n, ctx.settings.currency);
  const href = `/sales/payouts/${encodeURIComponent(p.ref)}`;
  const lines: CalcLine[] = p.expectedLines.map((l) => ({
    key: `exp_${l.key}`,
    label: l.label,
    amount: Math.abs(l.amount),
    op: l.amount < 0 ? '-' : '+',
    fromRecords: false,
    note: l.source === 'records' ? 'From your recorded sales' : 'From eBay’s report',
    basis: l.source === 'records' ? 'recorded' : 'reconciliation',
  }));
  lines.push({ key: 'expected', label: 'Expected payout', amount: Math.abs(p.expected), op: '=', fromRecords: false, negative: p.expected < 0 });
  if (p.actual !== null) lines.push({ key: 'actual', label: 'Actual payout (from eBay’s payout report)', amount: p.actual, op: 'info', fromRecords: false, basis: 'reconciliation' });
  if (p.difference !== null) {
    lines.push({
      key: 'difference',
      label: `Difference (${p.difference >= 0 ? 'more' : 'less'} than expected)`,
      amount: Math.abs(p.difference),
      op: 'info',
      negative: p.difference < 0,
      // The findings below add up to it exactly, unexplained remainder included.
      fromRecords: true,
      signedParts: true,
      basis: 'reconciliation',
    });
  }
  const records: SourceRecord[] = [
    { kind: 'payout', id: p.ref, label: `eBay payout ${p.ref}`, detail: `${p.date ? formatDate(p.date) : 'date unknown'} · ${p.rows.length} transactions · ${p.statusReason}`, date: p.date ?? undefined, links: [{ label: 'Open payout', href }], parts: {} },
    ...p.findings.map((f) => ({
      kind: 'finding' as const,
      id: f.key,
      label: `${f.certainty === 'confirmed' ? 'Confirmed' : 'Possible explanation'}: ${f.title}`,
      detail: f.explanation,
      links: [{ label: 'See the evidence', href }, ...f.saleIds.slice(0, 2).flatMap((id) => {
        const sale = ctx.data.sales.find((s) => s.id === id);
        return sale ? [{ label: sale.itemName, href: `/inventory/${sale.itemId}` }] : [];
      })],
      parts: { difference: f.amount },
    })),
  ];
  return {
    metric: 'payout',
    title: `eBay payout ${p.ref}${p.date ? ` (${formatDate(p.date)})` : ''}`,
    value: p.difference,
    period: null,
    asOf: ctx.today,
    formula: 'Expected payout = sales you recorded − fees and shipping labels you recorded + refunds, holds and other items in eBay’s report. Difference = actual payout − expected payout. A payout is money moved, not profit.',
    lines,
    records,
    warnings: [
      ...(p.status === 'reconciled' ? [] : [p.statusReason]),
      ...(p.unexplained !== null && toCents(p.unexplained) !== 0 ? [`${money(Math.abs(p.unexplained))} of the difference isn’t explained by the imported data.`] : []),
    ],
    basis: 'reconciliation',
  };
}

/**
 * Money eBay actually transferred, by payout date. Not revenue, and not profit. Payouts eBay
 * shows as still in progress, or as failed or returned, haven't reached the bank: they're
 * listed separately and not counted.
 */
export function payoutsReceivedCalculation(ctx: CalcContext, range: DateRange): Calculation {
  const r = ctx.recon();
  const inRange = r.payouts.filter((p) => p.actual !== null && p.date !== null && (range.start === null || p.date >= range.start) && (range.end === null || p.date <= range.end));
  const state = (p: PayoutRecon) => (PENDING_STATUS.test(p.statusText) ? 'inProgress' : FAILED_STATUS.test(p.statusText) ? 'failed' : 'amount');
  const total = (key: string) => sum(inRange.filter((p) => state(p) === key).map((p) => p.actual!));
  const inProgress = inRange.filter((p) => state(p) === 'inProgress');
  const failed = inRange.filter((p) => state(p) === 'failed');
  const lines: CalcLine[] = [{ key: 'amount', label: 'Paid out by eBay', amount: total('amount'), op: '=', fromRecords: true, basis: 'reconciliation' }];
  if (inProgress.length) lines.push({ key: 'inProgress', label: 'Still in progress at eBay (not received yet)', amount: total('inProgress'), op: 'info', fromRecords: true, basis: 'reconciliation' });
  if (failed.length) lines.push({ key: 'failed', label: 'Failed or returned payouts (not received)', amount: total('failed'), op: 'info', fromRecords: true, basis: 'reconciliation' });
  return {
    metric: 'payouts_received',
    title: 'Marketplace payouts received',
    value: total('amount'),
    period: periodOf(range),
    asOf: ctx.today,
    formula:
      'Payouts received = the amounts eBay’s payout report says it sent to your bank, by payout date, not counting payouts still in progress or failed. This is cash moved, not revenue or profit.',
    lines,
    records: inRange.map((p) => ({
      kind: 'payout' as const,
      id: p.ref,
      label: `eBay payout ${p.ref}`,
      detail: `${p.date ? formatDate(p.date) : ''} · ${p.statusText || 'status unknown'} · ${p.status === 'reconciled' ? 'reconciled' : 'not reconciled yet'}`,
      date: p.date ?? undefined,
      links: [{ label: 'Open payout', href: `/sales/payouts/${encodeURIComponent(p.ref)}` }],
      parts: { [state(p)]: p.actual! },
    })),
    warnings: [
      ...(inProgress.length ? [`${plural(inProgress.length, 'payout')} (${formatMoney(total('inProgress'), ctx.settings.currency)}) ${inProgress.length === 1 ? 'is' : 'are'} still in progress at eBay and not counted as received.`] : []),
      ...(failed.length ? [`${plural(failed.length, 'payout')} (${formatMoney(total('failed'), ctx.settings.currency)}) failed or ${failed.length === 1 ? 'was' : 'were'} returned and ${failed.length === 1 ? 'isn’t' : 'aren’t'} counted.`] : []),
      ...(r.notPaidOut.total ? [`${formatMoney(r.notPaidOut.total, ctx.settings.currency)} recorded by eBay hasn’t been paid out yet.`] : []),
    ],
    basis: 'reconciliation',
  };
}
