// eBay Seller Hub reports (Payments → Reports). Two CSV formats are supported:
//
// • Transaction report: one row per transaction (order, refund, fee, shipping label…), with
//   its "Net amount" and the "Payout ID" it was paid out in.
// • Payout report: summary lines, then one row per payout with its "Amount".
//
// Column names come from eBay's help pages ("Reconciling your eBay sales transactions" and
// eBay's UK announcement of the report) — see docs/PAYOUT_RECONCILIATION.md. eBay lets sellers
// add and remove columns and names differ by site ("Shipping and handling" / "Postage and
// packaging"), so columns are found by name, never by position, and only a few are required.
// Nothing is guessed from columns StockPilot doesn't know: they're listed as ignored.

import { parseMoneyInput, toCents, fromCents } from '../domain/money';
import { isValidISODate } from '../domain/dates';
import type { MarketplaceFee, MarketplacePayout, MarketplaceTxn, MarketplaceTxnKind } from '../domain/types';
import type { ParseOutcome, ParsedPayout, ParsedReport, ParsedTxn, ReportAdapter, RowIssue } from './reports';

/** Lower-case, and dashes, slashes, quotes and brackets as spaces: "Final value fee – fixed" → "final value fee fixed". */
export function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/[‐-―\-/\\'"‘’“”()_:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type TxnField =
  | 'date'
  | 'type'
  | 'orderNumber'
  | 'legacyOrderId'
  | 'net'
  | 'payoutCurrency'
  | 'payoutDate'
  | 'payoutId'
  | 'payoutStatus'
  | 'holdReason'
  | 'itemId'
  | 'transactionRef'
  | 'title'
  | 'customLabel'
  | 'quantity'
  | 'itemSubtotal'
  | 'shipping'
  | 'sellerTax'
  | 'marketplaceTax'
  | 'gross'
  | 'transactionCurrency'
  | 'referenceId'
  | 'description';

const TXN_COLUMNS: Record<TxnField, string[]> = {
  date: ['Transaction creation date'],
  type: ['Type'],
  orderNumber: ['Order number', 'Order ID'],
  legacyOrderId: ['Legacy order ID'],
  net: ['Net amount'],
  payoutCurrency: ['Payout currency'],
  payoutDate: ['Payout date'],
  payoutId: ['Payout ID'],
  payoutStatus: ['Payout status'],
  holdReason: ['Reason for hold'],
  itemId: ['Item ID'],
  transactionRef: ['Transaction ID'],
  title: ['Item title'],
  customLabel: ['Custom label'],
  quantity: ['Quantity'],
  itemSubtotal: ['Item subtotal'],
  shipping: ['Shipping and handling', 'Postage and packaging', 'Shipping and handling / Postage and packaging'],
  // eBay renamed "Sales tax" to "Seller collected tax" on some sites.
  sellerTax: ['Seller collected tax', 'Sales tax'],
  marketplaceTax: ['eBay collected tax'],
  gross: ['Gross transaction amount'],
  transactionCurrency: ['Transaction currency'],
  referenceId: ['Reference ID'],
  description: ['Description'],
};

/** Fee columns on an order row, as eBay documents them. Each is a charge to the seller. */
const FEE_COLUMNS = [
  'Final value fee - fixed',
  'Final value fee - variable',
  'Very high "item not as described" fee',
  'Below standard performance fee',
  'International fee',
];

/** Documented columns StockPilot recognises but doesn't store (buyer details are personal data). */
const KNOWN_UNUSED = [
  'Buyer username',
  'Buyer name',
  'Ship to city',
  'Ship to province/region/state',
  'Ship to zip',
  'Ship to country',
  'Ship/post to city',
  'Ship/post to province/region/state',
  'Ship/post to zip/postcode',
  'Ship/post to country',
  'Payout method',
  'Exchange rate',
  'Seller specified VAT rate',
];

const PAYOUT_COLUMNS = {
  date: ['Payout date'],
  payoutId: ['Payout ID'],
  status: ['Status', 'Payout status'],
  method: ['Payout method'],
  amount: ['Amount'],
  currency: ['Currency', 'Payout currency'],
  payoutType: ['Payout type'],
  memo: ['Memo'],
} as const;

const REQUIRED_TXN: TxnField[] = ['date', 'type', 'net'];

/**
 * Normalises eBay's "Type" text. "Order" and "Refund" are the Type values eBay's help names;
 * the others follow the transaction categories its help page lists (shipping labels, other
 * fees, claims, payment disputes, holds, charges, adjustments). Anything else is kept as
 * "other" and flagged for review, never dropped.
 */
export function ebayKind(type: string): MarketplaceTxnKind {
  const t = normalizeHeader(type);
  if (t === 'order' || t === 'sale') return 'sale';
  if (t.includes('shipping label') || t.includes('postage label') || t === 'label') return 'shipping_label';
  if (t.includes('refund') || t.includes('return')) return 'refund';
  if (t.includes('claim')) return 'claim';
  if (t.includes('dispute')) return 'dispute';
  if (t.includes('hold')) return 'hold';
  if (t.includes('payout') || t.includes('transfer') || t.includes('withdrawal')) return 'payout';
  if (t.includes('fee')) return 'fee';
  if (t.includes('adjustment')) return 'adjustment';
  if (t.includes('credit')) return 'credit';
  if (t.includes('charge')) return 'charge';
  return 'other';
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/** eBay fills empty cells with "--". */
const blank = (raw: string | undefined) => {
  const t = (raw ?? '').trim();
  return t === '' || /^-+$/.test(t) ? '' : t;
};

function money(raw: string | undefined): { value: number | null; bad: boolean } {
  const t = blank(raw);
  if (!t) return { value: null, bad: false };
  // Currency codes some exports put next to amounts ("USD 12.50", "12.50 GBP").
  const v = parseMoneyInput(t.replace(/\b[A-Z]{3}\b/g, '').replace(/[^\d.,()\-$€£¥\s]/g, ''));
  if (v === null || Number.isNaN(v)) return { value: null, bad: true };
  return { value: fromCents(toCents(v)), bad: false };
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => {
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return isValidISODate(s) ? s : null;
};

export type NumericDateOrder = 'mdy' | 'dmy';

/**
 * Dates as eBay sites write them: "2026-01-15", "2026-01-15T10:22:01.000Z", "Jan 15, 2026",
 * "15 Jan 2026", "15-Jan-26", and numeric "01/15/2026" or "15/01/2026" (order decided per file).
 * A time or time zone after the date is ignored.
 */
export function parseReportDate(raw: string, order: NumericDateOrder = 'mdy'): string | null {
  const t = blank(raw).replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return iso(+m[1], +m[2], +m[3]);
  const year = (y: string) => (y.length === 2 ? 2000 + +y : +y);
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}) (\d{4})\b/.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return month < 0 ? null : iso(+m[3], month + 1, +m[2]);
  }
  m = /^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ -](\d{2}|\d{4})\b/.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return month < 0 ? null : iso(year(m[3]), month + 1, +m[1]);
  }
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})\b/.exec(t);
  if (m) return order === 'mdy' ? iso(year(m[3]), +m[1], +m[2]) : iso(year(m[3]), +m[2], +m[1]);
  return null;
}

/** Numeric dates are month-first unless the file has one that can only be day-first. */
function numericOrder(values: string[]): { order: NumericDateOrder; ambiguous: boolean } {
  let sawNumeric = false;
  for (const v of values) {
    const m = /^(\d{1,2})[/.](\d{1,2})[/.]/.exec(blank(v));
    if (!m) continue;
    sawNumeric = true;
    if (+m[1] > 12) return { order: 'dmy', ambiguous: false };
    if (+m[2] > 12) return { order: 'mdy', ambiguous: false };
  }
  return { order: 'mdy', ambiguous: sawNumeric };
}

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

function columnIndex<F extends string>(header: string[], columns: Record<F, readonly string[]>) {
  const normalized = header.map(normalizeHeader);
  const index: Partial<Record<F, number>> = {};
  for (const field of Object.keys(columns) as F[]) {
    const names = columns[field].map(normalizeHeader);
    const at = normalized.findIndex((h) => names.includes(h));
    if (at >= 0) index[field] = at;
  }
  return index;
}

const has = (row: string[], name: string) => row.some((c) => normalizeHeader(c) === normalizeHeader(name));

/** The first row (in the top 40) that looks like a header, skipping report titles and summaries. */
function findHeader(rows: string[][], test: (row: string[]) => boolean): number {
  for (let i = 0; i < Math.min(rows.length, 40); i++) if (test(rows[i])) return i;
  return -1;
}

const isTxnHeader = (r: string[]) => has(r, 'Net amount') && (has(r, 'Type') || has(r, 'Transaction creation date'));
const isPayoutHeader = (r: string[]) => has(r, 'Payout ID') && has(r, 'Amount') && !has(r, 'Net amount');

// ---------------------------------------------------------------------------
// Transaction report
// ---------------------------------------------------------------------------

function parseTransactions(rows: string[][], lines: number[], headerAt: number): ParseOutcome {
  const header = rows[headerAt];
  const index = columnIndex(header, TXN_COLUMNS);
  const found = header.map((h) => h.trim()).filter(Boolean);
  const missing = REQUIRED_TXN.filter((f) => index[f] === undefined).map((f) => TXN_COLUMNS[f][0]);
  if (missing.length) {
    return {
      ok: false,
      formatLabel: 'eBay transaction report',
      problem: `This looks like an eBay transaction report, but it's missing ${missing.length === 1 ? 'a column StockPilot needs' : 'columns StockPilot needs'}: ${missing.join(', ')}.`,
      missing,
      found,
    };
  }
  const feeIndex = FEE_COLUMNS.map((name) => ({ name, at: header.findIndex((h) => normalizeHeader(h) === normalizeHeader(name)) })).filter((f) => f.at >= 0);
  const recognised = new Set([
    ...Object.values(index as Record<string, number>),
    ...feeIndex.map((f) => f.at),
    ...header.map((h, i) => (KNOWN_UNUSED.some((k) => normalizeHeader(k) === normalizeHeader(h)) ? i : -1)).filter((i) => i >= 0),
  ]);
  const ignored = header.map((h, i) => (recognised.has(i) ? '' : h.trim())).filter(Boolean);

  const body = rows.slice(headerAt + 1);
  const cell = (row: string[], f: TxnField) => (index[f] === undefined ? '' : (row[index[f]!] ?? ''));
  const dates = numericOrder(body.flatMap((r) => [cell(r, 'date'), cell(r, 'payoutDate')]));
  const warnings: string[] = [];
  if (dates.ambiguous) warnings.push('Dates like 03/04/2026 could be read either way; StockPilot read them month first (March 4). Check a few against eBay.');
  if (index.payoutId === undefined) {
    warnings.push('There is no "Payout ID" column, so transactions can’t be grouped into payouts. In eBay’s report settings, include the Payout details columns.');
  }
  if (index.orderNumber === undefined) warnings.push('There is no "Order number" column, so sales can only be matched by hand.');
  if (feeIndex.length === 0) warnings.push('There are no fee columns (e.g. "Final value fee – variable"), so recorded fees can’t be checked order by order.');
  if (index.itemSubtotal === undefined) warnings.push('There is no "Item subtotal" column, so recorded sale prices can’t be checked order by order.');
  if (index.referenceId === undefined) warnings.push('There is no "Reference ID" column, so a transaction seen in two reports is recognised by its date, type, order and amount instead.');
  if (ignored.length) warnings.push(`Columns StockPilot doesn’t use were ignored: ${ignored.join(', ')}.`);

  const transactions: ParsedTxn[] = [];
  const rowErrors: RowIssue[] = [];
  let skipped = 0;
  const seen = new Map<string, number>();
  body.forEach((row, i) => {
    const rowNumber = lines[headerAt + 1 + i];
    const type = blank(cell(row, 'type'));
    const rawDate = cell(row, 'date');
    const net = money(cell(row, 'net'));
    // Totals or notes under the table: no type, no date and no amount.
    if (!type && !blank(rawDate) && net.value === null && !net.bad) {
      skipped++;
      return;
    }
    const problems: string[] = [];
    const date = parseReportDate(rawDate, dates.order);
    if (!date) problems.push(`"Transaction creation date" ${blank(rawDate) ? `“${rawDate.trim()}” isn’t a date StockPilot recognises` : 'is empty'}.`);
    if (!type) problems.push('"Type" is empty.');
    if (net.bad) problems.push(`"Net amount" “${cell(row, 'net').trim()}” isn’t an amount.`);
    else if (net.value === null) problems.push('"Net amount" is empty.');
    const amounts = {} as Record<'itemSubtotal' | 'shipping' | 'sellerTax' | 'marketplaceTax' | 'gross', number | null>;
    for (const f of ['itemSubtotal', 'shipping', 'sellerTax', 'marketplaceTax', 'gross'] as const) {
      const m = money(cell(row, f));
      if (m.bad) problems.push(`"${header[index[f]!].trim()}" “${cell(row, f).trim()}” isn’t an amount.`);
      amounts[f] = m.value;
    }
    const feeBreakdown: MarketplaceFee[] = [];
    for (const f of feeIndex) {
      const m = money(row[f.at]);
      if (m.bad) problems.push(`"${header[f.at].trim()}" “${(row[f.at] ?? '').trim()}” isn’t an amount.`);
      else if (m.value !== null && m.value !== 0) feeBreakdown.push({ label: header[f.at].trim(), amount: Math.abs(m.value) });
    }
    const rawPayoutDate = blank(cell(row, 'payoutDate'));
    const payoutDate = rawPayoutDate ? parseReportDate(rawPayoutDate, dates.order) : null;
    if (rawPayoutDate && !payoutDate) problems.push(`"Payout date" “${rawPayoutDate}” isn’t a date StockPilot recognises.`);
    const rawQty = blank(cell(row, 'quantity'));
    const quantity = rawQty && /^\d+$/.test(rawQty) ? Number(rawQty) : null;
    if (problems.length) {
      rowErrors.push({ rowNumber, messages: problems });
      return;
    }
    const kind = ebayKind(type);
    const txn: ParsedTxn = {
      marketplace: 'ebay',
      key: '',
      sourceRow: rowNumber,
      kind,
      rawType: type,
      date: date!,
      orderNumber: blank(cell(row, 'orderNumber')),
      legacyOrderId: blank(cell(row, 'legacyOrderId')),
      transactionRef: blank(cell(row, 'transactionRef')),
      referenceId: blank(cell(row, 'referenceId')),
      itemId: blank(cell(row, 'itemId')),
      title: blank(cell(row, 'title')),
      customLabel: blank(cell(row, 'customLabel')),
      quantity,
      description: blank(cell(row, 'description')),
      net: net.value!,
      gross: amounts.gross,
      itemSubtotal: amounts.itemSubtotal,
      shippingAndHandling: amounts.shipping,
      sellerCollectedTax: amounts.sellerTax,
      marketplaceCollectedTax: amounts.marketplaceTax,
      fees: feeIndex.length ? fromCents(feeBreakdown.reduce((c, f) => c + toCents(f.amount), 0)) : null,
      feeBreakdown,
      payoutId: blank(cell(row, 'payoutId')),
      payoutDate,
      payoutStatus: blank(cell(row, 'payoutStatus')),
      holdReason: blank(cell(row, 'holdReason')),
      currency: blank(cell(row, 'payoutCurrency')),
      transactionCurrency: blank(cell(row, 'transactionCurrency')),
    };
    // The same transaction in a later report gets the same key (payout details aren't part of
    // it, because they're filled in once the money is paid out).
    const base = txn.referenceId
      ? ['ebay', 'ref', txn.referenceId, normalizeHeader(type), txn.orderNumber, txn.transactionRef, txn.itemId].join('|')
      : ['ebay', txn.date, normalizeHeader(type), txn.orderNumber, txn.transactionRef, txn.itemId, toCents(txn.net), txn.description].join('|');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    txn.key = n === 0 ? base : `${base}#${n + 1}`;
    transactions.push(txn);
  });
  if (skipped) warnings.push(`${skipped} line${skipped === 1 ? '' : 's'} without a type, date or amount (totals or notes) ${skipped === 1 ? 'was' : 'were'} skipped.`);

  const sorted = transactions.map((t) => t.date).sort();
  const report: ParsedReport = {
    marketplace: 'ebay',
    format: 'ebay_transactions',
    formatLabel: 'eBay transaction report',
    transactions,
    payouts: [],
    periodStart: sorted[0] ?? null,
    periodEnd: sorted[sorted.length - 1] ?? null,
    warnings,
    rowErrors,
    columnsFound: found,
  };
  return { ok: true, report };
}

// ---------------------------------------------------------------------------
// Payout report
// ---------------------------------------------------------------------------

/** The report's own summary ("Payouts" count and total "Amount"), if StockPilot can read it. */
function readSummary(rows: string[][]): { count: number | null; total: number | null } {
  let count: number | null = null;
  let total: number | null = null;
  rows.forEach((row, i) => {
    const cells = row.map(normalizeHeader);
    // "Payouts,3" / "Amount,412.18" on their own lines…
    if (cells[0] === 'payouts' && /^\d+$/.test(blank(row[1]))) count = Number(blank(row[1]));
    if (cells[0] === 'amount' && money(row[1]).value !== null) total = money(row[1]).value;
    // …or a header line ("Seller,Start date,End date,Payouts,Amount") with values below it.
    const next = rows[i + 1];
    if (next && cells.includes('payouts') && cells.includes('amount')) {
      const c = blank(next[cells.indexOf('payouts')]);
      if (/^\d+$/.test(c)) count = Number(c);
      const a = money(next[cells.indexOf('amount')]);
      if (a.value !== null) total = a.value;
    }
  });
  return { count, total };
}

function parsePayouts(rows: string[][], lines: number[], headerAt: number): ParseOutcome {
  const header = rows[headerAt];
  const index = columnIndex(header, PAYOUT_COLUMNS);
  const found = header.map((h) => h.trim()).filter(Boolean);
  const missing = (['date', 'payoutId', 'amount'] as const).filter((f) => index[f] === undefined).map((f) => PAYOUT_COLUMNS[f][0]);
  if (missing.length) {
    return { ok: false, formatLabel: 'eBay payout report', problem: `This looks like an eBay payout report, but it's missing: ${missing.join(', ')}.`, missing, found };
  }
  const body = rows.slice(headerAt + 1);
  const cell = (row: string[], f: keyof typeof PAYOUT_COLUMNS) => (index[f] === undefined ? '' : (row[index[f]!] ?? ''));
  const dates = numericOrder(body.map((r) => cell(r, 'date')));
  const warnings: string[] = [];
  if (dates.ambiguous) warnings.push('Dates like 03/04/2026 could be read either way; StockPilot read them month first (March 4). Check a few against eBay.');
  const payouts: ParsedPayout[] = [];
  const rowErrors: RowIssue[] = [];
  body.forEach((row, i) => {
    const rowNumber = lines[headerAt + 1 + i];
    const id = blank(cell(row, 'payoutId'));
    const amount = money(cell(row, 'amount'));
    if (!id && amount.value === null && !amount.bad) return;
    const problems: string[] = [];
    if (!id) problems.push('"Payout ID" is empty.');
    const date = parseReportDate(cell(row, 'date'), dates.order);
    if (!date) problems.push(`"Payout date" “${cell(row, 'date').trim()}” isn’t a date StockPilot recognises.`);
    if (amount.bad || amount.value === null) problems.push(`"Amount" “${cell(row, 'amount').trim()}” isn’t an amount.`);
    if (problems.length) {
      rowErrors.push({ rowNumber, messages: problems });
      return;
    }
    payouts.push({
      marketplace: 'ebay',
      key: `ebay|payout|${id}`,
      payoutId: id,
      date,
      amount: amount.value,
      status: blank(cell(row, 'status')),
      method: blank(cell(row, 'method')),
      currency: blank(cell(row, 'currency')),
      payoutType: blank(cell(row, 'payoutType')),
      memo: blank(cell(row, 'memo')),
    });
  });
  const summary = readSummary(rows.slice(0, headerAt));
  const totalCents = payouts.reduce((c, p) => c + toCents(p.amount ?? 0), 0);
  if (summary.count !== null && summary.count !== payouts.length) {
    warnings.push(`The report’s summary says ${summary.count} payouts, but StockPilot read ${payouts.length}.`);
  }
  if (summary.total !== null && toCents(summary.total) !== totalCents && rowErrors.length === 0) {
    warnings.push(`The report’s summary total is ${summary.total.toFixed(2)}, but its payouts add up to ${fromCents(totalCents).toFixed(2)}.`);
  }
  const sorted = payouts.map((p) => p.date!).sort();
  return {
    ok: true,
    report: {
      marketplace: 'ebay',
      format: 'ebay_payouts',
      formatLabel: 'eBay payout report',
      transactions: [],
      payouts,
      periodStart: sorted[0] ?? null,
      periodEnd: sorted[sorted.length - 1] ?? null,
      warnings,
      rowErrors,
      columnsFound: found,
    },
  };
}

export const ebayAdapter: ReportAdapter = {
  marketplace: 'ebay',
  label: 'eBay',
  formats: [
    { id: 'ebay_transactions', label: 'Transaction report', where: 'Seller Hub → Payments → Reports → Transaction report (CSV)' },
    { id: 'ebay_payouts', label: 'Payout report', where: 'Seller Hub → Payments → Reports → Payout report (CSV)' },
  ],
  parse(rows, lines) {
    const txnAt = findHeader(rows, isTxnHeader);
    if (txnAt >= 0) return parseTransactions(rows, lines, txnAt);
    const payoutAt = findHeader(rows, isPayoutHeader);
    if (payoutAt >= 0) return parsePayouts(rows, lines, payoutAt);
    return null;
  },
};

export type { MarketplacePayout, MarketplaceTxn };
