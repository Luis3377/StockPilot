// Marketplace payout reconciliation: a simplified bank reconciliation for resellers.
//
// For each payout (money the marketplace sent to the bank):
//
//   expected payout = what your StockPilot records say for the payout's sales
//                       (sale revenue − marketplace fees − shipping labels bought on the marketplace)
//                   + marketplace items StockPilot doesn't record as sales, taken from the report
//                       (tax you collected, refunds, claims, holds, account fees…)
//   difference      = actual payout − expected payout
//
// The difference is then split into findings, each traced to report rows and sales: a sale
// that isn't recorded, a fee or shipping label that differs, rows missing from the import,
// fees paid out in another payout… Whatever can't be attributed is shown as unexplained. It
// is never forced to zero, and nothing here changes a sale.
//
// A payout is money moved, not profit: inventory cost (cost of goods sold) never enters the
// payout calculation; it's shown separately as the accounting profit of the payout's sales.
//
// Everything is deterministic integer-cent arithmetic, so the same data always gives the same
// result — which is what lets an assistant explain it without inventing numbers.

import { computeSale, totalSales, type SalesTotals } from './calc';
import { daysBetween, formatDate } from './dates';
import { formatMoney, fromCents, toCents } from './money';
import type { AppData, MarketplacePayout, MarketplaceTxn, ReconciliationReview, Sale } from './types';

// ---------------------------------------------------------------------------
// Matching marketplace sales to StockPilot sales
// ---------------------------------------------------------------------------

export const orderKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '');

export interface MatchCandidate {
  saleId: string;
  score: number;
  reasons: string[];
}

export interface MatchInfo {
  saleId: string | null;
  /** How the match was made: the same order number (and SKU), or confirmed by the user. */
  method: 'order_number' | 'user' | null;
  /** Several sales or several order lines share the order number: the user must choose. */
  ambiguous: boolean;
  /** Suggested sales for an unmatched row, best first. Never matched without confirmation. */
  candidates: MatchCandidate[];
}

export interface Matching {
  byTxn: Map<string, MatchInfo>;
  txnBySale: Map<string, string>;
  /** Order numbers recorded on more than one StockPilot sale than the report has lines for. */
  extraSalesByOrder: Map<string, string[]>;
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1));

function similarity(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const w of x) if (y.has(w)) common++;
  return common / new Set([...x, ...y]).size;
}

const revenueCents = (s: Sale) => toCents(computeSale(s).revenue);
const saleAmountCents = (t: MarketplaceTxn) => (t.itemSubtotal === null ? null : toCents(t.itemSubtotal) + toCents(t.shippingAndHandling ?? 0));

function scoreCandidate(t: MarketplaceTxn, s: Sale): MatchCandidate | null {
  if (s.orderNumber && orderKey(s.orderNumber) !== orderKey(t.orderNumber) && orderKey(s.orderNumber) !== orderKey(t.legacyOrderId)) return null;
  const days = Math.abs(daysBetween(s.saleDate, t.date));
  if (days > 30) return null;
  let score = 0;
  const reasons: string[] = [];
  if (t.customLabel && s.itemSku && orderKey(t.customLabel) === orderKey(s.itemSku)) {
    score += 40;
    reasons.push(`Same SKU (${s.itemSku})`);
  }
  if (t.quantity !== null && t.quantity === s.quantity) {
    score += 10;
    reasons.push(`Same quantity (${s.quantity})`);
  }
  const amount = saleAmountCents(t);
  const rev = revenueCents(s);
  if (amount !== null && amount === rev) {
    score += 25;
    reasons.push('Same sale amount');
  } else if (t.itemSubtotal !== null && toCents(t.itemSubtotal) === rev) {
    score += 15;
    reasons.push('Same item price (without shipping)');
  }
  if (days <= 2) {
    score += 15;
    reasons.push(days === 0 ? 'Same day' : `${days} day${days === 1 ? '' : 's'} apart`);
  } else if (days <= 7) {
    score += 8;
    reasons.push(`${days} days apart`);
  }
  const sim = similarity(t.title, s.itemName);
  if (sim >= 0.5) {
    score += 15;
    reasons.push('Similar title');
  } else if (sim >= 0.25) {
    score += 8;
    reasons.push('Partly similar title');
  }
  const platform = s.platform.trim().toLowerCase();
  if (platform.includes('ebay')) score += 5;
  else if (platform) score -= 20;
  return score >= 30 ? { saleId: s.id, score, reasons } : null;
}

/**
 * Links marketplace sale rows to StockPilot sales. Only reliable identifiers match
 * automatically: a confirmed match, or the same order number (with the SKU deciding between
 * lines of a multi-item order). Anything else is a suggestion the user must confirm.
 */
export function matchSales(data: AppData): Matching {
  const saleRows = data.marketplace.transactions.filter((t) => t.kind === 'sale');
  const salesById = new Map(data.sales.map((s) => [s.id, s]));
  const byTxn = new Map<string, MatchInfo>();
  const txnBySale = new Map<string, string>();
  const extraSalesByOrder = new Map<string, string[]>();
  const link = (txnId: string, saleId: string, method: MatchInfo['method']) => {
    byTxn.set(txnId, { saleId, method, ambiguous: false, candidates: [] });
    txnBySale.set(saleId, txnId);
  };

  for (const m of data.marketplace.matches) {
    if (salesById.has(m.saleId) && saleRows.some((t) => t.id === m.txnId) && !byTxn.has(m.txnId) && !txnBySale.has(m.saleId)) link(m.txnId, m.saleId, 'user');
  }

  const rowsByOrder = new Map<string, MarketplaceTxn[]>();
  for (const t of saleRows) {
    for (const k of new Set([orderKey(t.orderNumber), orderKey(t.legacyOrderId)].filter(Boolean))) {
      rowsByOrder.set(k, [...(rowsByOrder.get(k) ?? []), t]);
    }
  }
  const salesByOrder = new Map<string, Sale[]>();
  for (const s of data.sales) {
    const k = orderKey(s.orderNumber);
    if (k && !txnBySale.has(s.id)) salesByOrder.set(k, [...(salesByOrder.get(k) ?? []), s]);
  }
  const ambiguous = new Map<string, Sale[]>();
  for (const [k, sales] of salesByOrder) {
    const rows = (rowsByOrder.get(k) ?? []).filter((t) => !byTxn.has(t.id));
    let openRows = rows;
    let openSales = sales.filter((s) => !txnBySale.has(s.id));
    if (openRows.length === 1 && openSales.length === 1) {
      link(openRows[0].id, openSales[0].id, 'order_number');
      continue;
    }
    // A multi-item order: pair lines and sales that share a unique SKU.
    for (const t of [...openRows]) {
      const bySku = openSales.filter((s) => t.customLabel && s.itemSku && orderKey(s.itemSku) === orderKey(t.customLabel));
      const rowsWithSku = openRows.filter((r) => r.customLabel && orderKey(r.customLabel) === orderKey(t.customLabel));
      if (bySku.length === 1 && rowsWithSku.length === 1) {
        link(t.id, bySku[0].id, 'order_number');
        openRows = openRows.filter((r) => r.id !== t.id);
        openSales = openSales.filter((s) => s.id !== bySku[0].id);
      }
    }
    if (openRows.length === 1 && openSales.length === 1) {
      link(openRows[0].id, openSales[0].id, 'order_number');
      continue;
    }
    for (const t of openRows) ambiguous.set(t.id, openSales);
    // Every line of this order already has its sale: the rest are possible duplicates.
    if (openRows.length === 0 && openSales.length > 0 && (rowsByOrder.get(k) ?? []).length > 0) extraSalesByOrder.set(k, openSales.map((s) => s.id));
  }

  const openSales = data.sales.filter((s) => !txnBySale.has(s.id));
  for (const t of saleRows) {
    if (byTxn.has(t.id)) continue;
    const pool = ambiguous.get(t.id) ?? openSales;
    const candidates = pool
      .map((s) => (ambiguous.has(t.id) ? { saleId: s.id, score: 100, reasons: ['Same order number'] } : scoreCandidate(t, s)))
      .filter((c): c is MatchCandidate => c !== null)
      .sort((a, b) => b.score - a.score || a.saleId.localeCompare(b.saleId))
      .slice(0, 3);
    byTxn.set(t.id, { saleId: null, method: null, ambiguous: ambiguous.has(t.id), candidates });
  }
  return { byTxn, txnBySale, extraSalesByOrder };
}

// ---------------------------------------------------------------------------
// Reconciling payouts
// ---------------------------------------------------------------------------

export type ReconStatus = 'reconciled' | 'unreconciled' | 'pending' | 'needs_review';

export const STATUS_LABELS: Record<ReconStatus, string> = {
  reconciled: 'Reconciled',
  unreconciled: 'Unreconciled',
  pending: 'Pending / timing difference',
  needs_review: 'Needs review',
};

export type FindingKind =
  | 'missing_sale'
  | 'ambiguous_match'
  | 'sale_amount'
  | 'fee_difference'
  | 'fees_other_payout'
  | 'label_difference'
  | 'labels_other_payout'
  | 'unlisted_deduction'
  | 'order_difference'
  | 'report_gap'
  | 'possible_duplicate'
  | 'unexplained';

/** Findings that net out against another payout. */
export const TIMING_KINDS: FindingKind[] = ['fees_other_payout', 'labels_other_payout'];

export interface Evidence {
  label: string;
  value: string;
}

export interface Finding {
  /** Stable within the payout, so a decision about it can be remembered. */
  key: string;
  kind: FindingKind;
  title: string;
  /** Effect on the difference (actual − expected), in currency units. */
  amount: number;
  /** 'confirmed': the data shows it. 'possible': a likely explanation that the data can't prove. */
  certainty: 'confirmed' | 'possible';
  explanation: string;
  evidence: Evidence[];
  txnIds: string[];
  saleIds: string[];
  /** The user's current decision about it, if any (and still for this amount). */
  review: ReconciliationReview | null;
}

export type ExpectedLineKey = 'sales' | 'fees' | 'labels' | 'seller_tax' | 'refunds' | 'other_fees' | 'other_labels' | 'holds' | 'other';

export interface ExpectedLine {
  key: ExpectedLineKey;
  label: string;
  amount: number;
  /** 'records': from your StockPilot sales. 'report': taken from the marketplace report. */
  source: 'records' | 'report';
  txnIds: string[];
  saleIds: string[];
}

export interface RowRecon {
  txn: MarketplaceTxn;
  /** What your records say this row should contribute (null for report-sourced rows). */
  expected: number;
  source: 'records' | 'report' | 'missing';
  saleIds: string[];
  match: MatchInfo | null;
  /** Report-sourced adjustments the user hasn't reviewed yet. */
  outstanding: boolean;
  note: string;
}

export interface PayoutRecon {
  ref: string;
  marketplace: 'ebay';
  payout: MarketplacePayout | null;
  date: string | null;
  statusText: string;
  rows: RowRecon[];
  expectedLines: ExpectedLine[];
  expected: number;
  actual: number | null;
  actualSource: 'payout_report' | 'transaction_report' | null;
  /** Σ net amounts of the report rows in this payout. */
  reportedTotal: number;
  difference: number | null;
  findings: Finding[];
  /** Part of the difference no finding accounts for. */
  unexplained: number | null;
  matchedCount: number;
  unmatchedCount: number;
  outstandingCount: number;
  outstandingAmount: number;
  status: ReconStatus;
  statusReason: string;
  /** A payout-level decision accepting the remaining difference, if current. */
  acceptedDifference: ReconciliationReview | null;
  /** Accounting profit of the matched sales (uses recorded cost of goods sold). Not part of the payout. */
  profit: SalesTotals;
  /** Tax collected and remitted by the marketplace: neither in the payout nor revenue. */
  marketplaceTax: number;
  earliestDate: string | null;
  latestDate: string | null;
}

export interface NotPaidOut {
  rows: RowRecon[];
  onHold: number;
  waiting: number;
  total: number;
}

export interface ReconciliationReport {
  payouts: PayoutRecon[];
  notPaidOut: NotPaidOut;
  /** Recorded marketplace sales within the imported dates that no report row matches. */
  unmatchedSales: { sale: Sale; reason: string }[];
  matching: Matching;
  counts: Record<ReconStatus, number>;
  /** Σ difference of unreconciled payouts. */
  unreconciledTotal: number;
  coverage: { start: string | null; end: string | null };
}

const PENDING_STATUS = /initiat|process|pending|schedul|progress|queued|in transit/i;
const FAILED_STATUS = /fail|revers|return|cancel|reject/i;
const HOLD_STATUS = /hold/i;

export const reviewTarget = {
  finding: (ref: string, key: string) => `finding:${ref}:${key}`,
  payout: (ref: string) => `payout:${ref}`,
  adjustment: (txnKey: string) => `adjustment:${txnKey}`,
};

/** The user's current decision for a target, if it was made for this same amount. */
export function currentReview(reviews: ReconciliationReview[], target: string, amount: number): ReconciliationReview | null {
  for (let i = reviews.length - 1; i >= 0; i--) {
    const r = reviews[i];
    if (r.target === target && r.undoneAt === null) return toCents(r.amount) === toCents(amount) ? r : null;
  }
  return null;
}

/** Fees eBay charged on a sale row (its fee columns). */
const feeColsCents = (t: MarketplaceTxn) => (t.fees === null ? null : toCents(t.fees));

interface OrderGroup {
  key: string;
  rows: MarketplaceTxn[];
  sales: Sale[];
  /** The label row whose payout carries the recorded shipping (the earliest). */
  labelAnchor: MarketplaceTxn | null;
}

export function reconcile(data: AppData, currency = 'USD'): ReconciliationReport {
  const money = (cents: number) => formatMoney(fromCents(cents), currency);
  const signed = (cents: number) => (cents > 0 ? `+${money(cents)}` : money(cents));
  const matching = matchSales(data);
  const txns = data.marketplace.transactions;
  const salesById = new Map(data.sales.map((s) => [s.id, s]));
  const reviews = data.marketplace.reviews;

  // Orders across every payout, with the StockPilot sales matched to their sale rows.
  const orders = new Map<string, OrderGroup>();
  const orderOf = (t: MarketplaceTxn) => orderKey(t.orderNumber) || orderKey(t.legacyOrderId);
  for (const t of txns) {
    const k = orderOf(t);
    if (!k) continue;
    const g = orders.get(k) ?? { key: k, rows: [], sales: [], labelAnchor: null };
    g.rows.push(t);
    orders.set(k, g);
  }
  for (const g of orders.values()) {
    for (const t of g.rows) {
      const saleId = t.kind === 'sale' ? matching.byTxn.get(t.id)?.saleId : null;
      if (saleId) g.sales.push(salesById.get(saleId)!);
    }
    g.labelAnchor =
      g.rows.filter((t) => t.kind === 'shipping_label').sort((a, b) => a.date.localeCompare(b.date) || a.sourceRow - b.sourceRow || a.id.localeCompare(b.id))[0] ?? null;
  }
  const groupOf = (t: MarketplaceTxn) => {
    const k = orderOf(t);
    return k ? (orders.get(k) ?? null) : null;
  };

  const rowRecon = (t: MarketplaceTxn): RowRecon => {
    const match = t.kind === 'sale' ? (matching.byTxn.get(t.id) ?? null) : null;
    const g = groupOf(t);
    const adjustment = (note: string): RowRecon => ({
      txn: t,
      expected: toCents(t.net),
      source: 'report',
      saleIds: g?.sales.map((s) => s.id) ?? [],
      match: null,
      outstanding: currentReview(reviews, reviewTarget.adjustment(t.key), t.net) === null,
      note,
    });
    switch (t.kind) {
      case 'sale': {
        const sale = match?.saleId ? salesById.get(match.saleId)! : null;
        if (!sale) return { txn: t, expected: 0, source: 'missing', saleIds: [], match, outstanding: false, note: match?.ambiguous ? 'Several sales share this order number' : 'Not matched to a recorded sale' };
        const f = computeSale(sale);
        return { txn: t, expected: toCents(f.revenue) - toCents(f.fees), source: 'records', saleIds: [sale.id], match, outstanding: false, note: 'Recorded sale − recorded fees' };
      }
      case 'fee':
        if (g?.sales.length) return { txn: t, expected: 0, source: 'records', saleIds: g.sales.map((s) => s.id), match: null, outstanding: false, note: 'Counted in the fees recorded on the sale' };
        return adjustment(t.orderNumber ? 'Fee on an order that isn’t matched to a recorded sale' : 'Account fee (not tied to an order)');
      case 'shipping_label':
        if (g?.sales.length) {
          const anchor = g.labelAnchor?.id === t.id;
          const shipping = g.sales.reduce((c, s) => c + toCents(s.shipping), 0);
          return {
            txn: t,
            expected: anchor ? -shipping : 0,
            source: 'records',
            saleIds: g.sales.map((s) => s.id),
            match: null,
            outstanding: false,
            note: anchor ? 'Shipping recorded on the sale' : 'Counted with the first label for this order',
          };
        }
        return adjustment('Label for an order that isn’t matched to a recorded sale');
      case 'refund':
        return adjustment(g?.sales.length ? 'Refund on a recorded sale: check the sale’s profit' : 'Refund');
      case 'hold':
        return adjustment('Funds held by eBay');
      case 'other':
        return adjustment(`eBay type “${t.rawType}” isn’t one StockPilot knows: counted as reported`);
      default:
        return adjustment(t.rawType);
    }
  };

  const byPayout = new Map<string, MarketplaceTxn[]>();
  for (const t of txns) {
    if (!t.payoutId) continue;
    byPayout.set(t.payoutId, [...(byPayout.get(t.payoutId) ?? []), t]);
  }
  const payoutRecords = new Map(data.marketplace.payouts.map((p) => [p.payoutId, p]));
  const refs = new Set([...byPayout.keys(), ...payoutRecords.keys()]);

  const payouts: PayoutRecon[] = [...refs].map((ref) => {
    const payout = payoutRecords.get(ref) ?? null;
    const all = byPayout.get(ref) ?? [];
    const transfer = all.filter((t) => t.kind === 'payout');
    const rowsTx = all.filter((t) => t.kind !== 'payout').sort((a, b) => a.date.localeCompare(b.date) || a.sourceRow - b.sourceRow);
    const rows = rowsTx.map(rowRecon);
    const reportedCents = rowsTx.reduce((c, t) => c + toCents(t.net), 0);
    let actualCents: number | null = null;
    let actualSource: PayoutRecon['actualSource'] = null;
    if (payout?.amount !== null && payout?.amount !== undefined) {
      actualCents = toCents(payout.amount);
      actualSource = 'payout_report';
    } else if (transfer.length) {
      actualCents = Math.abs(transfer.reduce((c, t) => c + toCents(t.net), 0));
      actualSource = 'transaction_report';
    }

    // Expected payout, line by line.
    const lines: ExpectedLine[] = [];
    const add = (key: ExpectedLineKey, label: string, source: ExpectedLine['source'], cents: number, txnIds: string[], saleIds: string[] = []) => {
      const existing = lines.find((l) => l.key === key);
      if (existing) {
        existing.amount = fromCents(toCents(existing.amount) + cents);
        existing.txnIds.push(...txnIds);
        existing.saleIds.push(...saleIds);
      } else lines.push({ key, label, source, amount: fromCents(cents), txnIds: [...txnIds], saleIds: [...saleIds] });
    };
    add('sales', 'Sales you recorded', 'records', 0, []);
    add('fees', 'Marketplace fees you recorded', 'records', 0, []);
    for (const r of rows) {
      const t = r.txn;
      if (t.kind === 'sale' && r.source === 'records') {
        const f = computeSale(salesById.get(r.saleIds[0])!);
        add('sales', 'Sales you recorded', 'records', toCents(f.revenue), [t.id], r.saleIds);
        add('fees', 'Marketplace fees you recorded', 'records', -toCents(f.fees), [t.id], r.saleIds);
        if (t.sellerCollectedTax) add('seller_tax', 'Tax you collected (owed to tax authorities, not revenue)', 'report', toCents(t.sellerCollectedTax), [t.id]);
        r.expected += toCents(t.sellerCollectedTax ?? 0);
      } else if (t.kind === 'shipping_label' && r.source === 'records') {
        if (r.expected !== 0) add('labels', 'Shipping labels you recorded', 'records', r.expected, [t.id], r.saleIds);
      } else if (r.source === 'report') {
        const key: ExpectedLineKey = t.kind === 'refund' ? 'refunds' : t.kind === 'fee' ? 'other_fees' : t.kind === 'shipping_label' ? 'other_labels' : t.kind === 'hold' ? 'holds' : 'other';
        const label = {
          refunds: 'Refunds and returns (from the report)',
          other_fees: 'Other marketplace fees (from the report)',
          other_labels: 'Shipping labels not linked to a recorded sale (from the report)',
          holds: 'Funds held by eBay (from the report)',
          other: 'Claims, disputes and other adjustments (from the report)',
        }[key as 'refunds'];
        add(key, label, 'report', toCents(t.net), [t.id], r.saleIds);
      }
    }
    const expectedTotal = rows.reduce((c, r) => c + r.expected, 0);

    // Findings: split the difference into causes, each traced to rows and sales.
    const findings: Finding[] = [];
    const finding = (f: Omit<Finding, 'review'>) => {
      if (toCents(f.amount) === 0 && f.kind !== 'ambiguous_match' && f.kind !== 'possible_duplicate') return;
      findings.push({ ...f, review: currentReview(reviews, reviewTarget.finding(ref, f.key), f.amount) });
    };
    const diffCents = actualCents === null ? null : actualCents - expectedTotal;
    if (actualCents !== null && actualCents !== reportedCents) {
      const gap = actualCents - reportedCents;
      const dates = rowsTx.map((t) => t.date).sort();
      finding({
        key: 'report_gap',
        kind: 'report_gap',
        title: gap > 0 ? 'Payout is larger than the transactions imported for it' : 'Payout is smaller than the transactions imported for it',
        amount: fromCents(gap),
        certainty: 'possible',
        explanation:
          gap > 0
            ? `eBay paid ${money(actualCents)}, but the imported rows with this payout ID add up to ${money(reportedCents)}. Possible explanation: some of this payout’s transactions are in a report you haven’t imported${dates[0] ? ` (for example from before ${formatDate(dates[0])})` : ''}.`
            : `eBay paid ${money(actualCents)}, but the imported rows with this payout ID add up to ${money(reportedCents)}. Possible explanations: funds held back from this payout, or a charge that isn’t in the imported report.`,
        evidence: [
          { label: 'Payout amount', value: money(actualCents) },
          { label: 'Imported rows for this payout', value: `${rowsTx.length}, totalling ${money(reportedCents)}` },
          ...(dates.length ? [{ label: 'Their dates', value: `${formatDate(dates[0])} – ${formatDate(dates[dates.length - 1])}` }] : []),
        ],
        txnIds: rowsTx.map((t) => t.id),
        saleIds: [],
      });
    }
    for (const r of rows.filter((x) => x.txn.kind === 'sale' && x.source === 'missing')) {
      const t = r.txn;
      const ambiguousMatch = r.match?.ambiguous ?? false;
      finding({
        key: `missing:${t.key}`,
        kind: ambiguousMatch ? 'ambiguous_match' : 'missing_sale',
        title: ambiguousMatch ? `Order ${t.orderNumber}: choose which recorded sale it is` : `Sale not recorded in StockPilot: order ${t.orderNumber || t.transactionRef || t.referenceId}`,
        amount: t.net,
        certainty: ambiguousMatch ? 'confirmed' : 'possible',
        explanation: ambiguousMatch
          ? `More than one StockPilot sale has order number ${t.orderNumber}. StockPilot won’t guess: choose the right one below. Until then, this order’s ${money(toCents(t.net))} counts as unmatched.`
          : `eBay paid ${money(toCents(t.net))} for “${t.title || 'this order'}”, but no recorded sale matches it.${r.match?.candidates.length ? ' Possible matches are listed below: confirm one if it’s the same sale.' : ' Possible explanation: the sale was never recorded, or it was recorded without an order number.'}`,
        evidence: [
          { label: 'Order', value: t.orderNumber || '—' },
          { label: 'Date', value: formatDate(t.date) },
          { label: 'Item', value: [t.title, t.customLabel && `SKU ${t.customLabel}`].filter(Boolean).join(' · ') || '—' },
          { label: 'eBay net amount', value: money(toCents(t.net)) },
        ],
        txnIds: [t.id],
        saleIds: r.match?.candidates.map((c) => c.saleId) ?? [],
      });
    }

    // Matched orders with rows in this payout.
    const groups = new Map<string, OrderGroup>();
    for (const r of rows) {
      const g = groupOf(r.txn);
      if (g?.sales.length && (r.txn.kind === 'sale' || r.txn.kind === 'fee' || r.txn.kind === 'shipping_label') && r.source === 'records') groups.set(g.key, g);
    }
    for (const g of groups.values()) {
      const here = (t: MarketplaceTxn) => t.payoutId === ref;
      const saleRows = g.rows.filter((t) => t.kind === 'sale' && matching.byTxn.get(t.id)?.saleId);
      const saleRowsHere = saleRows.filter(here);
      const feeRows = g.rows.filter((t) => t.kind === 'fee');
      const labelRows = g.rows.filter((t) => t.kind === 'shipping_label');
      const charge = (list: MarketplaceTxn[]) => -list.reduce((c, t) => c + toCents(t.net), 0);
      const orderLabel = g.rows[0].orderNumber || g.rows[0].legacyOrderId;
      const salesHere = saleRowsHere.map((t) => salesById.get(matching.byTxn.get(t.id)!.saleId!)!);
      const itemName = salesHere[0]?.itemName ?? g.sales[0].itemName;

      if (saleRowsHere.length) {
        const colsKnown = saleRowsHere.every((t) => t.itemSubtotal !== null && t.fees !== null);
        const recFees = salesHere.reduce((c, s) => c + toCents(s.fees), 0);
        const feeRowsHere = charge(feeRows.filter(here));
        const feeRowsElsewhere = charge(feeRows.filter((t) => !here(t)));
        if (colsKnown) {
          for (const t of saleRowsHere) {
            const sale = salesById.get(matching.byTxn.get(t.id)!.saleId!)!;
            const ebayAmount = saleAmountCents(t)!;
            const rev = revenueCents(sale);
            const refunds = g.rows.filter((x) => x.kind === 'refund');
            const refundTotal = -refunds.reduce((c, x) => c + toCents(x.net), 0);
            finding({
              key: `sale_amount:${t.key}`,
              kind: 'sale_amount',
              title: `Recorded sale amount differs: ${sale.itemName}`,
              amount: fromCents(ebayAmount - rev),
              certainty: 'confirmed',
              explanation:
                `The buyer paid ${money(ebayAmount)} on eBay (item ${money(toCents(t.itemSubtotal!))}${t.shippingAndHandling ? ` + shipping ${money(toCents(t.shippingAndHandling))}` : ''}), but the sale is recorded at ${money(rev)}.` +
                (rev === toCents(t.itemSubtotal!) && t.shippingAndHandling
                  ? ` Possible explanation: the shipping the buyer paid (${money(toCents(t.shippingAndHandling))}) wasn’t included in the recorded price.`
                  : refundTotal > 0 && ebayAmount - rev === refundTotal
                    ? ` Possible explanation: you recorded the sale net of its ${money(refundTotal)} refund, which the refund row in the report also deducts.`
                    : ' Possible explanation: the recorded sale price is incorrect.'),
              evidence: [
                { label: 'Order', value: orderLabel },
                { label: 'eBay item subtotal + shipping', value: money(ebayAmount) },
                { label: 'Recorded sale revenue', value: money(rev) },
              ],
              txnIds: [t.id],
              saleIds: [sale.id],
            });
            const cols = toCents(t.itemSubtotal!) + toCents(t.shippingAndHandling ?? 0) + toCents(t.sellerCollectedTax ?? 0) - feeColsCents(t)!;
            finding({
              key: `unlisted:${t.key}`,
              kind: 'unlisted_deduction',
              title: `eBay’s net for this order isn’t fully explained by the report’s columns`,
              amount: fromCents(toCents(t.net) - cols),
              certainty: 'possible',
              explanation: `eBay’s net amount is ${money(toCents(t.net))}, but the item, shipping, tax and fee columns in the imported report add up to ${money(cols)}. Possible explanation: a fee or deduction in a column your export doesn’t include.`,
              evidence: [
                { label: 'Order', value: orderLabel },
                { label: 'Net amount', value: money(toCents(t.net)) },
                { label: 'From the columns', value: money(cols) },
              ],
              txnIds: [t.id],
              saleIds: [sale.id],
            });
          }
          const ebayFees = saleRowsHere.reduce((c, t) => c + feeColsCents(t)!, 0) + feeRowsHere + feeRowsElsewhere;
          finding({
            key: `fees:${g.key}`,
            kind: 'fee_difference',
            title: `Marketplace fees differ: order ${orderLabel}`,
            amount: fromCents(recFees - ebayFees),
            certainty: 'confirmed',
            explanation: `eBay charged ${money(ebayFees)} in fees on this order${feeRows.length ? ` (${money(ebayFees - feeRowsHere - feeRowsElsewhere)} on the sale + ${money(feeRowsHere + feeRowsElsewhere)} in separate fee rows such as promoted listings)` : ''}, but ${money(recFees)} is recorded on the sale. Possible explanation: ${recFees < ebayFees ? 'a fee that wasn’t recorded (for example the fixed per-order fee or an ad fee).' : 'a fee was recorded that eBay didn’t charge, or eBay credited part of it back.'}`,
            evidence: [
              { label: 'Order', value: orderLabel },
              { label: 'eBay fees', value: money(ebayFees) },
              { label: 'Recorded fees', value: money(recFees) },
              ...feeRows.map((t) => ({ label: t.description || t.rawType, value: `${money(-toCents(t.net))}${here(t) ? '' : ` (in payout ${t.payoutId || 'not paid out yet'})`}` })),
            ],
            txnIds: [...saleRowsHere, ...feeRows].map((t) => t.id),
            saleIds: salesHere.map((s) => s.id),
          });
          finding({
            key: `fees_elsewhere:${g.key}`,
            kind: 'fees_other_payout',
            title: `Part of this order’s fees was deducted in another payout`,
            amount: fromCents(feeRowsElsewhere),
            certainty: 'confirmed',
            explanation: `${money(feeRowsElsewhere)} of the fees on order ${orderLabel} was deducted from a different payout, so this payout is higher by that amount and the other one lower. It evens out across the two.`,
            evidence: feeRows.filter((t) => !here(t)).map((t) => ({ label: t.description || t.rawType, value: `${money(-toCents(t.net))} in payout ${t.payoutId || '(not paid out yet)'}` })),
            txnIds: feeRows.filter((t) => !here(t)).map((t) => t.id),
            saleIds: salesHere.map((s) => s.id),
          });
        } else {
          const rowDiff = saleRowsHere.reduce((c, t) => c + toCents(t.net), 0) - feeRowsHere - (salesHere.reduce((c, s) => c + revenueCents(s), 0) - recFees + saleRowsHere.reduce((c, t) => c + toCents(t.sellerCollectedTax ?? 0), 0));
          finding({
            key: `order:${g.key}`,
            kind: 'order_difference',
            title: `Order ${orderLabel} doesn’t match your records`,
            amount: fromCents(rowDiff),
            certainty: 'confirmed',
            explanation: `eBay’s net for this order differs from the recorded sale minus recorded fees by ${signed(rowDiff)}. The imported report has no item subtotal or fee columns, so StockPilot can’t tell whether the price or the fees differ.`,
            evidence: [{ label: 'Order', value: orderLabel }],
            txnIds: saleRowsHere.map((t) => t.id),
            saleIds: salesHere.map((s) => s.id),
          });
        }
      } else {
        const feeRowsHere = charge(feeRows.filter(here));
        finding({
          key: `fees_elsewhere:${g.key}`,
          kind: 'fees_other_payout',
          title: `Fee for order ${orderLabel}, whose sale was paid out in another payout`,
          amount: fromCents(-feeRowsHere),
          certainty: 'confirmed',
          explanation: `eBay deducted ${money(feeRowsHere)} here for order ${orderLabel} (${itemName}). The fees you recorded for that sale are counted with the payout that contains the sale, so this payout is lower by that amount and that one higher.`,
          evidence: feeRows.filter(here).map((t) => ({ label: t.description || t.rawType, value: money(-toCents(t.net)) })),
          txnIds: feeRows.filter(here).map((t) => t.id),
          saleIds: g.sales.map((s) => s.id),
        });
      }

      const labelsHere = labelRows.filter(here);
      if (labelsHere.length) {
        const recShipping = g.sales.reduce((c, s) => c + toCents(s.shipping), 0);
        if (g.labelAnchor && here(g.labelAnchor)) {
          const ebayLabels = charge(labelRows);
          const labelsElsewhere = charge(labelRows.filter((t) => !here(t)));
          finding({
            key: `labels:${g.key}`,
            kind: 'label_difference',
            title: recShipping === 0 ? `Shipping label not recorded: order ${orderLabel}` : `Shipping label cost differs: order ${orderLabel}`,
            amount: fromCents(recShipping - ebayLabels),
            certainty: 'confirmed',
            explanation:
              recShipping === 0
                ? `eBay deducted ${money(ebayLabels)} for a shipping label on this order, but no shipping cost is recorded on the sale. Possible explanation: the label was bought on eBay and not entered.`
                : `eBay deducted ${money(ebayLabels)} for shipping labels on this order, but ${money(recShipping)} is recorded as shipping. Possible explanation: a label adjustment (re-weigh, void or upgrade), or a label bought partly elsewhere.`,
            evidence: [
              { label: 'Order', value: orderLabel },
              ...labelRows.map((t) => ({ label: `${t.rawType} · ${formatDate(t.date)}`, value: `${money(-toCents(t.net))}${here(t) ? '' : ` (in payout ${t.payoutId || 'not paid out yet'})`}` })),
              { label: 'Recorded shipping', value: money(recShipping) },
            ],
            txnIds: labelRows.map((t) => t.id),
            saleIds: g.sales.map((s) => s.id),
          });
          finding({
            key: `labels_elsewhere:${g.key}`,
            kind: 'labels_other_payout',
            title: 'Part of this order’s shipping labels was charged in another payout',
            amount: fromCents(labelsElsewhere),
            certainty: 'confirmed',
            explanation: `${money(labelsElsewhere)} of label charges for order ${orderLabel} was in a different payout. It evens out across the two.`,
            evidence: labelRows.filter((t) => !here(t)).map((t) => ({ label: t.rawType, value: `${money(-toCents(t.net))} in payout ${t.payoutId || '(not paid out yet)'}` })),
            txnIds: labelRows.filter((t) => !here(t)).map((t) => t.id),
            saleIds: g.sales.map((s) => s.id),
          });
        } else {
          const labelsHereCents = charge(labelsHere);
          finding({
            key: `labels_elsewhere:${g.key}`,
            kind: 'labels_other_payout',
            title: `Label adjustment for order ${orderLabel}, counted with an earlier payout`,
            amount: fromCents(-labelsHereCents),
            certainty: 'confirmed',
            explanation: `The shipping you recorded for order ${orderLabel} is counted with the payout of its first label. This later label charge or credit (${money(labelsHereCents)}) changes this payout instead.`,
            evidence: labelsHere.map((t) => ({ label: `${t.rawType} · ${formatDate(t.date)}`, value: money(-toCents(t.net)) })),
            txnIds: labelsHere.map((t) => t.id),
            saleIds: g.sales.map((s) => s.id),
          });
        }
      }
    }

    // Two identical rows (same type, order, amount and date) with different references.
    const seen = new Map<string, MarketplaceTxn>();
    for (const t of rowsTx) {
      const sig = [t.kind, orderOf(t), toCents(t.net), t.date, t.description].join('|');
      const first = seen.get(sig);
      if (first) {
        finding({
          key: `duplicate:${first.key}:${t.key}`,
          kind: 'possible_duplicate',
          title: `Possible duplicate: two identical ${t.rawType.toLowerCase()} rows`,
          amount: 0,
          certainty: 'possible',
          explanation: `Two rows have the same type, order, date and amount (${money(toCents(t.net))}) but different references. Both are counted, because eBay reported both. If you think one was charged twice, contact eBay.`,
          evidence: [first, t].map((x) => ({ label: `Row ${x.sourceRow}`, value: `${x.rawType} · ${x.orderNumber || '—'} · ${money(toCents(x.net))} · ref ${x.referenceId || '—'}` })),
          txnIds: [first.id, t.id],
          saleIds: [],
        });
      } else seen.set(sig, t);
    }

    const explainedCents = findings.reduce((c, f) => c + toCents(f.amount), 0);
    const unexplainedCents = diffCents === null ? null : diffCents - explainedCents;
    if (unexplainedCents !== null && unexplainedCents !== 0) {
      finding({
        key: 'unexplained',
        kind: 'unexplained',
        title: 'Difference StockPilot can’t explain',
        amount: fromCents(unexplainedCents),
        certainty: 'possible',
        explanation: `${money(Math.abs(unexplainedCents))} of the difference isn’t explained by the imported data. Check the payout in eBay’s Payments tab.`,
        evidence: [],
        txnIds: [],
        saleIds: [],
      });
    }

    const matched = rows.filter((r) => r.txn.kind === 'sale' && r.source === 'records');
    const unmatched = rows.filter((r) => r.source === 'missing');
    const outstanding = rows.filter((r) => r.outstanding);
    const acceptedDifference = diffCents === null || diffCents === 0 ? null : currentReview(reviews, reviewTarget.payout(ref), fromCents(diffCents));
    const statusText = payout?.status || rowsTx.find((t) => t.payoutStatus)?.payoutStatus || '';
    const amountFindings = findings.filter((f) => toCents(f.amount) !== 0);
    let status: ReconStatus;
    let statusReason: string;
    if (PENDING_STATUS.test(statusText)) {
      status = 'pending';
      statusReason = `eBay shows this payout as “${statusText}”: it hasn’t finished paying out.`;
    } else if (FAILED_STATUS.test(statusText)) {
      status = 'needs_review';
      statusReason = `eBay shows this payout as “${statusText}”.`;
    } else if (diffCents === null) {
      status = 'needs_review';
      statusReason = 'The amount eBay actually paid isn’t known yet. Import the payout report for these dates.';
    } else if (rowsTx.length === 0) {
      status = 'needs_review';
      statusReason = `eBay paid ${money(actualCents!)}, but none of this payout’s transactions are imported yet. Import the transaction report covering the days before ${payout?.date ? formatDate(payout.date) : 'this payout'}.`;
    } else if (diffCents !== 0) {
      const allResolved = amountFindings.every((f) => f.review !== null);
      if (acceptedDifference || allResolved) {
        status = 'reconciled';
        statusReason = acceptedDifference ? `Difference of ${signed(diffCents)} explained by you: “${acceptedDifference.reason}”.` : `Difference of ${signed(diffCents)} explained by you, item by item.`;
      } else if (amountFindings.every((f) => TIMING_KINDS.includes(f.kind) || f.review)) {
        status = 'pending';
        statusReason = 'Timing difference: part of an order was paid out in another payout. It evens out across the payouts.';
      } else {
        status = 'unreconciled';
        statusReason = `The payout is ${money(Math.abs(diffCents))} ${diffCents > 0 ? 'more' : 'less'} than your records lead to.`;
      }
    } else if (findings.some((f) => f.kind === 'ambiguous_match' && !f.review)) {
      status = 'needs_review';
      statusReason = 'An order matches more than one recorded sale. Choose the right one.';
    } else if (outstanding.length) {
      status = 'needs_review';
      statusReason = `The payout ties out. ${outstanding.length === 1 ? 'One adjustment from the report needs' : `${outstanding.length} adjustments from the report need`} a look (refunds, fees or holds that may affect your records).`;
    } else {
      status = 'reconciled';
      statusReason = 'Your records and the payout agree to the cent.';
    }
    const dates = rowsTx.map((t) => t.date).sort();
    const profitSales = matched.map((r) => salesById.get(r.saleIds[0])!);
    return {
      ref,
      marketplace: 'ebay',
      payout,
      date: payout?.date ?? rowsTx.find((t) => t.payoutDate)?.payoutDate ?? null,
      statusText,
      rows,
      expectedLines: lines.filter((l) => l.key === 'sales' || l.key === 'fees' || toCents(l.amount) !== 0),
      expected: fromCents(expectedTotal),
      actual: actualCents === null ? null : fromCents(actualCents),
      actualSource,
      reportedTotal: fromCents(reportedCents),
      difference: diffCents === null ? null : fromCents(diffCents),
      findings,
      unexplained: unexplainedCents === null ? null : fromCents(unexplainedCents),
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      outstandingCount: outstanding.length,
      outstandingAmount: fromCents(outstanding.reduce((c, r) => c + toCents(r.txn.net), 0)),
      status,
      statusReason,
      acceptedDifference,
      profit: totalSales(profitSales),
      marketplaceTax: fromCents(rowsTx.reduce((c, t) => c + toCents(t.marketplaceCollectedTax ?? 0), 0)),
      earliestDate: dates[0] ?? null,
      latestDate: dates[dates.length - 1] ?? null,
    };
  });
  payouts.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.ref.localeCompare(a.ref));

  const waitingRows = txns.filter((t) => !t.payoutId && t.kind !== 'payout').map(rowRecon);
  const isHeld = (t: MarketplaceTxn) => HOLD_STATUS.test(t.payoutStatus) || Boolean(t.holdReason);
  const notPaidOut: NotPaidOut = {
    rows: waitingRows,
    onHold: fromCents(waitingRows.filter((r) => isHeld(r.txn)).reduce((c, r) => c + toCents(r.txn.net), 0)),
    waiting: fromCents(waitingRows.filter((r) => !isHeld(r.txn)).reduce((c, r) => c + toCents(r.txn.net), 0)),
    total: fromCents(waitingRows.reduce((c, r) => c + toCents(r.txn.net), 0)),
  };

  const txnDates = txns.map((t) => t.date).sort();
  const coverage = { start: txnDates[0] ?? null, end: txnDates[txnDates.length - 1] ?? null };
  const unmatchedSales = data.sales
    .filter((s) => !matching.txnBySale.has(s.id))
    .filter((s) => s.orderNumber || s.platform.trim().toLowerCase().includes('ebay'))
    .filter((s) => coverage.start !== null && s.saleDate >= coverage.start && s.saleDate <= coverage.end!)
    .map((sale) => {
      const extra = [...matching.extraSalesByOrder.values()].some((ids) => ids.includes(sale.id));
      return {
        sale,
        reason: extra
          ? `Possible duplicate: another recorded sale already matches eBay order ${sale.orderNumber}.`
          : sale.orderNumber
            ? `No eBay report row has order number ${sale.orderNumber}. Possible explanations: it hasn’t been paid out yet, the order number has a typo, or it sold elsewhere.`
            : 'Recorded as an eBay sale without an order number, and no report row was matched to it. Add the order number, or confirm a match from a payout.',
      };
    });

  const counts: Record<ReconStatus, number> = { reconciled: 0, unreconciled: 0, pending: 0, needs_review: 0 };
  for (const p of payouts) counts[p.status]++;
  return {
    payouts,
    notPaidOut,
    unmatchedSales,
    matching,
    counts,
    unreconciledTotal: fromCents(payouts.filter((p) => p.status === 'unreconciled').reduce((c, p) => c + toCents(p.difference ?? 0), 0)),
    coverage,
  };
}

// ---------------------------------------------------------------------------
// Explanations (for people and, later, an AI assistant)
// ---------------------------------------------------------------------------

export interface PayoutFacts {
  payout: string;
  date: string | null;
  status: ReconStatus;
  expected: number;
  actual: number | null;
  difference: number | null;
  unexplained: number | null;
  expectedLines: { label: string; amount: number; source: 'records' | 'report' }[];
  findings: { kind: FindingKind; title: string; amount: number; certainty: 'confirmed' | 'possible'; resolvedBy: string | null; records: string[] }[];
}

/**
 * The exact figures behind a payout, as plain data. A future AI assistant gets these facts to
 * put into words; it never calculates or invents amounts itself.
 */
export function payoutFacts(p: PayoutRecon): PayoutFacts {
  return {
    payout: p.ref,
    date: p.date,
    status: p.status,
    expected: p.expected,
    actual: p.actual,
    difference: p.difference,
    unexplained: p.unexplained,
    expectedLines: p.expectedLines.map((l) => ({ label: l.label, amount: l.amount, source: l.source })),
    findings: p.findings.map((f) => ({
      kind: f.kind,
      title: f.title,
      amount: f.amount,
      certainty: f.certainty,
      resolvedBy: f.review?.reason ?? null,
      records: f.evidence.map((e) => `${e.label}: ${e.value}`),
    })),
  };
}

/** A plain-language explanation built only from the payout's computed figures. */
export function explainPayout(p: PayoutRecon, currency = 'USD'): string[] {
  const money = (n: number) => formatMoney(n, currency);
  const lines: string[] = [];
  const when = p.date ? ` on ${formatDate(p.date)}` : '';
  if (p.actual === null) {
    lines.push(`Payout ${p.ref}${when}: the amount eBay paid isn’t known yet, so it can’t be compared. Import the payout report.`);
    return lines;
  }
  lines.push(`Payout ${p.ref}${when}: eBay paid ${money(p.actual)}; your records lead to an expected ${money(p.expected)}.`);
  if (p.difference === 0) {
    lines.push('They match to the cent.');
    return lines;
  }
  lines.push(`Difference: ${p.difference! > 0 ? '+' : ''}${money(p.difference!)} (the payout is ${p.difference! > 0 ? 'higher' : 'lower'} than expected).`);
  for (const f of p.findings.filter((x) => toCents(x.amount) !== 0)) {
    lines.push(`${f.certainty === 'confirmed' ? 'Confirmed' : 'Possible'}: ${f.title} (${f.amount > 0 ? '+' : ''}${money(f.amount)}).${f.review ? ` You noted: “${f.review.reason}”.` : ''}`);
  }
  if (p.unexplained !== null && toCents(p.unexplained) !== 0) lines.push(`Unexplained: ${money(p.unexplained)}.`);
  return lines;
}
