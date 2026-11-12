// Month-end figures: the month's profit and loss from sale records, its purchases and
// adjustments, the inventory roll-forward, and the marketplace reconciliation status.
//
// Roll-forward:
//   beginning inventory cost (previous month's close, or the inventory ledger)
//   + purchases (items, bulk lots incl. their acquisition costs, restocks)
//   ± cost corrections   − cost of goods sold   − write-offs and other decreases   + increases
//   − items deleted with stock   ± sale corrections
//   = expected ending inventory cost,
// compared with the cost on hand from the item records (today's, less changes dated after the
// month). The two sides come from different records, so a difference shows a change no dated
// record explains. Before the ledger began there is no independent beginning balance: those
// months are reported as not verifiable rather than as a $0 difference.

import type { AppData, MonthClose, Sale, Settings } from '../domain/types';
import { computeSale, totalSales, type SalesTotals } from '../domain/calc';
import { formatDate, parseISODate, type DateRange } from '../domain/dates';
import { formatMoney, fromCents, multiplyMoney, toCents } from '../domain/money';
import { localDate, recordsBalanceCents } from '../domain/ledger';
import { reconcile, type PayoutRecon, type ReconciliationReport } from '../domain/reconcile';
import { plural } from '../domain/format';

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

export const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function monthLabel(month: string): string {
  return parseISODate(`${month}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function monthRange(month: string): DateRange & { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}`, label: `in ${monthLabel(month)}` };
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** A month can be closed once it has ended. */
export function monthEnded(month: string, today: string): boolean {
  return monthRange(month).end < today;
}

const inMonth = (date: string, month: string) => date.slice(0, 7) === month;

// ---------------------------------------------------------------------------
// Movements of inventory cost (from records made after the ledger began)
// ---------------------------------------------------------------------------

export type MovementKey = 'items' | 'lots' | 'restocks' | 'corrections' | 'cogs' | 'decreases' | 'withdrawals' | 'increases' | 'returns' | 'removed' | 'sale_corrections';

export const MOVEMENT_LABELS: Record<MovementKey, string> = {
  items: 'Items bought',
  lots: 'Bulk lots bought (incl. their acquisition costs)',
  restocks: 'Restocks',
  corrections: 'Cost corrections',
  cogs: 'Cost of goods sold',
  decreases: 'Write-offs and other documented decreases',
  withdrawals: 'Withdrawn for personal use',
  increases: 'Units found and other documented increases',
  returns: 'Returns added back to stock',
  removed: 'Items deleted with stock',
  sale_corrections: 'Sale edits and cancellations',
};

export const MOVEMENT_ORDER: MovementKey[] = ['items', 'lots', 'restocks', 'corrections', 'cogs', 'decreases', 'withdrawals', 'increases', 'returns', 'removed', 'sale_corrections'];

/** Adjustment reasons that mean merchandise taken for personal use, or returned by a customer. */
export const WITHDRAWAL_REASON = /\b(used personally|personal use|own use|withdr[ae]wn?|for myself)\b/i;
export const RETURN_REASON = /\breturn(ed|s)?\b/i;

export interface MovementRecord {
  kind: 'sale' | 'item' | 'lot' | 'adjustment';
  id: string;
  label: string;
  detail: string;
  date: string;
  href: string;
  /** Signed change in inventory cost. */
  amount: number;
}

export interface Movement {
  key: MovementKey;
  date: string;
  cents: number;
  /** The item it changed, and the change in its units on hand (0 for cost-only changes). */
  itemId: string;
  units: number;
  record: MovementRecord;
}

export interface LedgerInfo {
  startedAt: string | null;
  startDate: string | null;
  openingCents: number;
  /** No records predate the ledger, so it holds the whole history. */
  complete: boolean;
  movements: Movement[];
  /** Sales recorded before the ledger began (already reflected in its opening balance). */
  preLedgerSales: Sale[];
}

export function ledgerInfo(data: AppData): LedgerInfo {
  const startedAt = data.inventoryLedger.startedAt;
  const after = (iso: string) => startedAt !== null && iso >= startedAt;
  const openingCents = data.inventoryLedger.events.filter((e) => e.kind === 'opening').reduce((c, e) => c + toCents(e.amount), 0);
  const movements: Movement[] = [];
  for (const s of data.sales) {
    if (!after(s.createdAt)) continue;
    const cents = toCents(multiplyMoney(s.unitCost, s.quantity));
    movements.push({ key: 'cogs', date: s.saleDate, cents: -cents, itemId: s.itemId, units: -s.quantity, record: { kind: 'sale', id: s.id, label: `${s.itemName}${s.quantity > 1 ? ` × ${s.quantity}` : ''}`, detail: `Sold ${formatDate(s.saleDate)}`, date: s.saleDate, href: `/inventory/${s.itemId}`, amount: -fromCents(cents) } });
  }
  for (const a of data.adjustments) {
    if (!after(a.date)) continue;
    const cents = toCents(a.valueDifference);
    if (cents === 0) continue;
    const key: MovementKey = a.source === 'restock' ? 'restocks' : cents < 0 ? (WITHDRAWAL_REASON.test(a.reason) ? 'withdrawals' : 'decreases') : RETURN_REASON.test(a.reason) ? 'returns' : 'increases';
    const date = localDate(a.date);
    movements.push({ key, date, cents, itemId: a.itemId, units: a.difference, record: { kind: 'adjustment', id: a.id, label: a.itemName, detail: `${a.difference > 0 ? '+' : ''}${a.difference} units · ${a.reason}`, date, href: `/inventory/${a.itemId}`, amount: fromCents(cents) } });
  }
  for (const e of data.inventoryLedger.events) {
    if (e.kind === 'opening') continue;
    const key: MovementKey = e.kind === 'acquired' || e.kind === 'purchase_date' ? (e.lotId ? 'lots' : 'items') : e.kind === 'cost_correction' ? 'corrections' : e.kind === 'removed' ? 'removed' : 'sale_corrections';
    const exists = data.items.some((i) => i.id === e.itemId);
    const href = e.lotId && data.lots.some((l) => l.id === e.lotId) ? `/inventory/lots/${e.lotId}` : exists ? `/inventory/${e.itemId}` : '/inventory';
    movements.push({ key, date: e.date, cents: toCents(e.amount), itemId: e.itemId, units: e.units ?? 0, record: { kind: e.lotId ? 'lot' : 'item', id: e.id, label: e.itemName, detail: e.note, date: e.date, href, amount: e.amount } });
  }
  const preLedgerSales = startedAt ? data.sales.filter((s) => s.createdAt < startedAt) : data.sales;
  const complete =
    startedAt !== null && openingCents === 0 && !preLedgerSales.length && !data.adjustments.some((a) => a.date < startedAt) && !data.items.some((i) => i.createdAt < startedAt && toCents(multiplyMoney(i.unitCost, i.quantity)) !== 0);
  return { startedAt, startDate: startedAt ? localDate(startedAt) : null, openingCents, complete, movements, preLedgerSales };
}

// ---------------------------------------------------------------------------
// Roll-forward
// ---------------------------------------------------------------------------

export interface RollForwardLine {
  key: MovementKey;
  label: string;
  amount: number;
  records: MovementRecord[];
}

export type RollForwardStatus = 'verified' | 'difference' | 'partial' | 'not_available';

/** A reporting period: a month, a calendar year, or (later) a fiscal year. */
export interface Period {
  key: string;
  start: string;
  end: string;
  /** "October 2026", "2026" */
  label: string;
}

export function monthPeriod(month: string): Period {
  const r = monthRange(month);
  return { key: month, start: r.start, end: r.end, label: monthLabel(month) };
}

export interface RollForward {
  /** The period's key (YYYY-MM for a month). */
  month: string;
  period: Period;
  status: RollForwardStatus;
  statusText: string;
  beginning: number | null;
  beginningBasis: string;
  lines: RollForwardLine[];
  expectedEnding: number | null;
  recordsEnding: number | null;
  recordsBasis: string;
  difference: number | null;
  notes: string[];
}

/** The latest close of a month that hasn't been reopened. */
export function currentClose(data: AppData, month: string): MonthClose | null {
  return data.monthlyClose.closes.find((c) => c.month === month && c.status === 'closed') ?? null;
}

/** A beginning balance from a close or year-end review, instead of the ledger's. */
export interface OpeningOverride {
  cents: number;
  basis: string;
  /** What the other record's figure is called, for the note when it differs from the ledger. */
  source: string;
}

/** Ledger balance (cents) at the end of `date`, from the opening and every movement dated up to it. */
export function ledgerBalanceAt(info: LedgerInfo, date: string): number {
  return info.movements.filter((m) => m.date <= date).reduce((c, m) => c + m.cents, info.openingCents);
}

export function periodRollForward(data: AppData, settings: Pick<Settings, 'currency'>, period: Period, today: string, info: LedgerInfo = ledgerInfo(data), opening: OpeningOverride | null = null): RollForward {
  const money = (cents: number) => formatMoney(fromCents(cents), settings.currency);
  const r = period;
  const notes: string[] = [];
  const empty = (status: RollForwardStatus, statusText: string): RollForward => ({ month: period.key, period, status, statusText, beginning: null, beginningBasis: '', lines: [], expectedEnding: null, recordsEnding: null, recordsBasis: '', difference: null, notes });
  if (!info.startedAt || !info.startDate) return empty('not_available', 'The inventory ledger hasn’t started yet');
  if (!info.complete && r.end < info.startDate) {
    notes.push(`StockPilot began its dated inventory ledger on ${formatDate(info.startDate)}. Purchases, cost edits and deletions before then weren’t recorded with dates, so inventory balances for ${period.label} can’t be verified. Sales, fees and profit still come from your sale records.`);
    return empty('not_available', `Not available: before the inventory ledger began (${formatDate(info.startDate)})`);
  }
  const partial = !info.complete && r.start <= info.startDate;
  const before = info.movements.filter((m) => m.date < r.start).reduce((c, m) => c + m.cents, info.openingCents);
  const within = info.movements.filter((m) => m.date >= r.start && m.date <= r.end);
  const later = info.movements.filter((m) => m.date > r.end).reduce((c, m) => c + m.cents, 0);

  let beginning = before;
  let beginningBasis = info.complete ? 'From the inventory ledger (it covers your whole history)' : `From the inventory ledger, which began ${formatDate(info.startDate)}`;
  if (partial) beginningBasis = `Opening balance when the inventory ledger began (${formatDate(info.startDate)}), plus later-recorded changes dated earlier`;
  else if (opening) {
    beginning = opening.cents;
    beginningBasis = opening.basis;
    if (beginning !== before) notes.push(`The ledger’s balance at the start is ${money(before)}; ${opening.source} recorded ${money(beginning)}. That ${money(before - beginning)} is part of any difference below.`);
  }
  const lines: RollForwardLine[] = MOVEMENT_ORDER.map((key) => {
    const ms = within.filter((m) => m.key === key);
    return { key, label: MOVEMENT_LABELS[key], amount: fromCents(ms.reduce((c, m) => c + m.cents, 0)), records: ms.map((m) => m.record).sort((a, b) => a.date.localeCompare(b.date)) };
  });
  const expected = beginning + within.reduce((c, m) => c + m.cents, 0);
  const records = recordsBalanceCents(data) - later;
  const difference = records - expected;
  const kind = period.key.length === 7 ? 'month' : 'period';
  const recordsBasis = r.end >= today ? (later ? `Item records today, less changes dated after the ${kind}` : `Item records today (the ${kind} isn’t over yet)`) : later ? `Item records today, less ${money(-later)} of recorded changes dated after ${formatDate(r.end)}` : `Item records today (nothing recorded since ${formatDate(r.end)} changes them)`;

  if (partial) {
    notes.push(`The inventory ledger began on ${formatDate(info.startDate)}, during this ${kind}, so the roll-forward covers only what was recorded from then on.`);
    const pre = info.preLedgerSales.filter((s) => s.saleDate >= r.start && s.saleDate <= r.end);
    if (pre.length) notes.push(`${money(pre.reduce((c, s) => c + toCents(computeSale(s).costOfGoods), 0))} of this ${kind}’s cost of goods sold (${plural(pre.length, 'sale')}) was recorded before the ledger began and is already reflected in its opening balance, so it isn’t a line here.`);
  }
  if (r.end >= today) notes.push(`The ${kind} isn’t over: these are figures to date.`);
  if (difference !== 0) notes.push(`${money(Math.abs(difference))} of inventory cost on the item records isn’t explained by any dated record. It can come from changes made outside StockPilot’s recorded actions (for example data restored from an older copy).`);
  const status: RollForwardStatus = difference !== 0 ? 'difference' : partial ? 'partial' : 'verified';
  const statusText =
    status === 'difference'
      ? `Unexplained difference of ${money(difference)}`
      : status === 'partial'
        ? `Partly verified: from ${formatDate(info.startDate)}, when the inventory ledger began`
        : `Verified: the item records match beginning inventory plus the ${kind}’s recorded movements, to the cent`;
  return { month: period.key, period, status, statusText, beginning: fromCents(beginning), beginningBasis, lines, expectedEnding: fromCents(expected), recordsEnding: fromCents(records), recordsBasis, difference: fromCents(difference), notes };
}

export function rollForward(data: AppData, settings: Pick<Settings, 'currency'>, month: string, today: string, info: LedgerInfo = ledgerInfo(data)): RollForward {
  // Beginning: the previous month's closing figure when it's closed, otherwise the ledger's balance.
  const prev = currentClose(data, shiftMonth(month, -1));
  const opening: OpeningOverride | null =
    prev && prev.rollForward.recordsEnding !== null
      ? { cents: toCents(prev.rollForward.recordsEnding), basis: `Ending inventory cost when ${monthLabel(prev.month)} was closed (${formatDate(prev.closedAt)})`, source: `the ${monthLabel(prev.month)} close` }
      : null;
  return periodRollForward(data, settings, monthPeriod(month), today, info, opening);
}

// ---------------------------------------------------------------------------
// The month's figures
// ---------------------------------------------------------------------------

export interface MonthFigures {
  month: string;
  range: DateRange & { start: string; end: string };
  sales: Sale[];
  totals: SalesTotals;
  grossProfit: number;
  /** Gross profit ÷ revenue (%). */
  grossMarginPct: number | null;
  /** Realized profit ÷ revenue (%). */
  marginPct: number | null;
  /** Items, lots and restocks bought (null before the ledger began: not fully known). */
  purchases: number | null;
  /** Sourcing trip expenses dated in the month (not item costs; not in realized profit). */
  tripExpenses: number;
  rollForward: RollForward;
  /** Sales with no recorded item cost (cost of goods sold may be understated). */
  noCostSales: Sale[];
}

const pct = (num: number, den: number): number | null => (den === 0 ? null : Math.round((num / den) * 10000) / 100);

export function monthFigures(data: AppData, settings: Pick<Settings, 'currency'>, month: string, today: string, info: LedgerInfo = ledgerInfo(data)): MonthFigures {
  const range = monthRange(month);
  const sales = data.sales.filter((s) => inMonth(s.saleDate, month)).sort((a, b) => a.saleDate.localeCompare(b.saleDate) || a.createdAt.localeCompare(b.createdAt));
  const totals = totalSales(sales);
  const grossProfit = fromCents(toCents(totals.revenue) - toCents(totals.costOfGoods));
  const rf = rollForward(data, settings, month, today, info);
  const bought = rf.status === 'not_available' ? null : rf.lines.filter((l) => l.key === 'items' || l.key === 'lots' || l.key === 'restocks').reduce((c, l) => c + toCents(l.amount), 0);
  const tripExpenses = data.sourcing.sessions.filter((s) => inMonth(s.date, month)).reduce((c, s) => c + s.expenses.reduce((n, e) => n + toCents(e.amount), 0), 0);
  return {
    month,
    range,
    sales,
    totals,
    grossProfit,
    grossMarginPct: pct(grossProfit, totals.revenue),
    marginPct: pct(totals.netProfit, totals.revenue),
    purchases: bought === null ? null : fromCents(bought),
    tripExpenses: fromCents(tripExpenses),
    rollForward: rf,
    noCostSales: sales.filter((s) => s.unitCost === 0),
  };
}

/**
 * Everything a closed month's figures rest on, as one string: sale amounts, the month's
 * inventory movements and the beginning balance. Used to refuse changes to closed months.
 */
export function monthFingerprint(data: AppData, month: string, info: LedgerInfo = ledgerInfo(data)): string {
  const t = totalSales(data.sales.filter((s) => inMonth(s.saleDate, month)));
  const sums = new Map<MovementKey, number>();
  for (const m of info.movements) if (inMonth(m.date, month)) sums.set(m.key, (sums.get(m.key) ?? 0) + m.cents);
  const trips = data.sourcing.sessions.filter((s) => inMonth(s.date, month)).reduce((c, s) => c + s.expenses.reduce((n, e) => n + toCents(e.amount), 0), 0);
  return [t.salesCount, t.unitsSold, t.revenue, t.costOfGoods, t.fees, t.shipping, t.otherExpenses, trips, ...MOVEMENT_ORDER.map((k) => sums.get(k) ?? 0)].join('|');
}

// ---------------------------------------------------------------------------
// Marketplace reconciliation for the month
// ---------------------------------------------------------------------------

export interface MonthRecon {
  status: 'reconciled' | 'issues' | 'not_performed' | 'partial';
  statusText: string;
  payouts: PayoutRecon[];
  openPayouts: PayoutRecon[];
  unmatchedSales: { sale: Sale; reason: string }[];
  refunds: { txnId: string; date: string; orderNumber: string; amount: number; outstanding: boolean; saleIds: string[] }[];
  coverage: { start: string | null; end: string | null };
}

export function monthRecon(data: AppData, settings: Pick<Settings, 'currency'>, month: string, report?: ReconciliationReport): MonthRecon {
  const r = monthRange(month);
  const none = (text: string): MonthRecon => ({ status: 'not_performed', statusText: text, payouts: [], openPayouts: [], unmatchedSales: [], refunds: [], coverage: { start: null, end: null } });
  if (!data.marketplace.transactions.length && !data.marketplace.payouts.length) return none(`Not performed: no marketplace reports have been imported, so ${monthLabel(month)}’s payouts weren’t compared with your sales`);
  const rep = report ?? reconcile(data, settings.currency);
  const { start, end } = rep.coverage;
  if (!start || !end || end < r.start || start > r.end) {
    return { ...none(`Not performed: the imported reports cover ${start ? `${formatDate(start)} – ${formatDate(end)}` : 'no dates'}, not ${monthLabel(month)}`), coverage: rep.coverage };
  }
  const payouts = rep.payouts.filter((p) => {
    const d = p.date ?? p.latestDate;
    return d !== null && d >= r.start && d <= r.end;
  });
  const openPayouts = payouts.filter((p) => p.status === 'unreconciled' || p.status === 'needs_review');
  const unmatchedSales = rep.unmatchedSales.filter((u) => inMonth(u.sale.saleDate, month));
  const rows = [...rep.payouts.flatMap((p) => p.rows), ...rep.notPaidOut.rows];
  const refunds = rows
    .filter((row) => row.txn.kind === 'refund' && inMonth(row.txn.date, month))
    .map((row) => ({ txnId: row.txn.id, date: row.txn.date, orderNumber: row.txn.orderNumber, amount: Math.abs(row.txn.net), outstanding: row.outstanding, saleIds: row.saleIds }));
  const covered = start <= r.start && end >= r.end;
  const issues = openPayouts.length + unmatchedSales.length;
  const status: MonthRecon['status'] = issues ? 'issues' : covered ? 'reconciled' : 'partial';
  const statusText = issues
    ? `${plural(openPayouts.length, 'payout')} not reconciled and ${plural(unmatchedSales.length, 'sale')} not found in the reports`
    : covered
      ? `Reconciled: ${plural(payouts.length, 'payout')} in ${monthLabel(month)} match your records (or differ only by timing you’ve reviewed)`
      : `Partly covered: the imported reports run ${formatDate(start)} – ${formatDate(end)}; the rest of ${monthLabel(month)} wasn’t compared`;
  return { status, statusText, payouts, openPayouts, unmatchedSales, refunds, coverage: rep.coverage };
}

