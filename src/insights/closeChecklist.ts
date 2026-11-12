// The monthly closing checklist. Each step lists the month's records to review and any issues
// found in them. A step is done only when the user says so: "Reviewed", "Not applicable" (with
// an explanation), or "Acknowledged" (issues kept open, with a note). Nothing is marked done
// just because a month has no records, and a decision goes stale if the step's records change.

import type { AppData, CloseDecision, CloseStepKey, MonthClose, Settings } from '../domain/types';
import { computeSale, itemCostValue } from '../domain/calc';
import { formatDate } from '../domain/dates';
import { formatMoney, toCents } from '../domain/money';
import { plural } from '../domain/format';
import { localDate } from '../domain/ledger';
import { currentClose, ledgerInfo, monthEnded, monthFigures, monthLabel, monthRecon, type MonthFigures, type MonthRecon } from './monthly';

export interface CloseLink {
  label: string;
  href: string;
}

export interface CloseIssue {
  id: string;
  severity: 'attention' | 'info';
  text: string;
  links: CloseLink[];
}

export interface StepRecord {
  id: string;
  label: string;
  detail: string;
  href: string;
  amount: number | null;
}

export type StepState = 'completed' | 'na' | 'attention' | 'todo';

export interface CloseStep {
  step: CloseStepKey;
  number: number;
  title: string;
  description: string;
  facts: string[];
  records: StepRecord[];
  issues: CloseIssue[];
  /** "Reviewed" is possible (no open issues, and the check could be performed). */
  canReview: boolean;
  /** "Not applicable" is possible: nothing to review, or the check couldn't be performed. */
  canNA: boolean;
  naExplanation: string;
  fingerprint: string;
  decision: CloseDecision | null;
  /** A decision was made, but the step's records have changed since. */
  stale: boolean;
  state: StepState;
  stateText: string;
}

export interface Checklist {
  month: string;
  label: string;
  figures: MonthFigures;
  recon: MonthRecon;
  steps: CloseStep[];
  closed: MonthClose | null;
  ended: boolean;
  /** Every step is done and the month has ended. */
  ready: boolean;
  blockers: string[];
  /** Issues kept open (acknowledged) in the steps, recorded with the close. */
  unresolved: string[];
}

export const STEP_TITLES: Record<CloseStepKey, string> = {
  sales: 'Review recorded sales',
  purchases: 'Review inventory purchases',
  adjustments: 'Review adjustments and write-offs',
  counts: 'Confirm inventory counts',
  payouts: 'Review marketplace payouts',
  refunds: 'Check refunds and returns',
  costs: 'Review missing costs and low margins',
  summary: 'Review the month’s financial summary',
};

/** FNV-1a: a short, stable fingerprint of what a step showed. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const itemHref = (data: AppData, itemId: string) => (data.items.some((i) => i.id === itemId) ? `/inventory/${itemId}` : '/sales');

export function closeChecklist(data: AppData, settings: Settings, month: string, today: string): Checklist {
  const money = (n: number) => formatMoney(n, settings.currency);
  const label = monthLabel(month);
  const info = ledgerInfo(data);
  const figures = monthFigures(data, settings, month, today, info);
  const recon = monthRecon(data, settings, month);
  const rf = figures.rollForward;
  const decisions = data.monthlyClose.decisions[month] ?? [];
  const closed = currentClose(data, month);
  const ended = monthEnded(month, today);
  const inMonth = (d: string) => d.slice(0, 7) === month;

  type Draft = Omit<CloseStep, 'number' | 'fingerprint' | 'decision' | 'stale' | 'state' | 'stateText' | 'title'>;
  const drafts: Draft[] = [];

  // 1. Sales
  {
    const records = figures.sales.map((s): StepRecord => {
      const f = computeSale(s);
      return { id: s.id, label: `${s.itemName}${s.quantity > 1 ? ` × ${s.quantity}` : ''}`, detail: `${formatDate(s.saleDate)} · ${s.platform || 'no platform'} · revenue ${money(f.revenue)} · profit ${money(f.netProfit)}`, href: itemHref(data, s.itemId), amount: f.revenue };
    });
    const issues: CloseIssue[] = [];
    const groups = new Map<string, typeof figures.sales>();
    for (const s of figures.sales) {
      const key = [s.itemId, s.saleDate, s.quantity, toCents(computeSale(s).revenue), s.orderNumber.trim().toLowerCase()].join('|');
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    for (const [key, g] of groups) {
      if (g.length > 1) issues.push({ id: `dup:${key}`, severity: 'attention', text: `Possible duplicate: ${g.length} identical sales of ${g[0].itemName} on ${formatDate(g[0].saleDate)} for ${money(computeSale(g[0]).revenue)}. If one was entered twice, cancel it in Sales & Profit.`, links: [{ label: g[0].itemName, href: itemHref(data, g[0].itemId) }] });
    }
    for (const s of figures.sales.filter((x) => computeSale(x).revenue === 0)) {
      issues.push({ id: `zero:${s.id}`, severity: 'attention', text: `${s.itemName} was recorded as sold for ${money(0)} on ${formatDate(s.saleDate)}.`, links: [{ label: s.itemName, href: itemHref(data, s.itemId) }] });
    }
    const t = figures.totals;
    drafts.push({
      step: 'sales',
      description: 'Every sale dated in the month: is each one real, entered once, with the right amounts and date?',
      facts: [records.length ? `${plural(t.salesCount, 'sale')} · ${plural(t.unitsSold, 'unit')} · revenue ${money(t.revenue)} · realized profit ${money(t.netProfit)}` : `No sales were recorded for ${label}.`],
      records,
      issues,
      canReview: true,
      canNA: records.length === 0,
      naExplanation: `No sales were recorded for ${label}.`,
    });
  }

  // 2. Purchases
  {
    const notAvailable = rf.status === 'not_available';
    const lines = rf.lines.filter((l) => l.key === 'items' || l.key === 'lots' || l.key === 'restocks');
    const records: StepRecord[] = notAvailable
      ? [
          ...data.lots.filter((l) => inMonth(l.purchaseDate ?? localDate(l.createdAt))).map((l) => ({ id: l.id, label: `Bulk lot: ${l.name}`, detail: formatDate(l.purchaseDate ?? localDate(l.createdAt)), href: `/inventory/lots/${l.id}`, amount: null })),
          ...data.adjustments.filter((a) => a.source === 'restock' && inMonth(localDate(a.date))).map((a) => ({ id: a.id, label: `Restock: ${a.itemName}`, detail: `${formatDate(localDate(a.date))} · +${a.difference} units`, href: itemHref(data, a.itemId), amount: a.valueDifference })),
        ]
      : lines.flatMap((l) => l.records.map((r) => ({ id: r.id, label: r.label, detail: `${l.label} · ${formatDate(r.date)} · ${r.detail}`, href: r.href, amount: r.amount })));
    const issues: CloseIssue[] = [];
    if (notAvailable) issues.push({ id: 'purchases:pre-ledger', severity: 'attention', text: `Purchases before the inventory ledger began (${formatDate(info.startDate)}) weren’t recorded with dates, so ${label}’s purchases can’t be listed completely. Bulk lots and restocks are shown.`, links: [] });
    const noCost = data.items.filter((i) => i.unitCost === 0 && inMonth(i.purchaseDate ?? localDate(i.createdAt)));
    for (const i of noCost) issues.push({ id: `nocost:${i.id}`, severity: 'attention', text: `${i.name} was added with no cost per item. Its cost of goods sold will be $0 and its profit overstated.`, links: [{ label: i.name, href: `/inventory/${i.id}` }] });
    drafts.push({
      step: 'purchases',
      description: 'Items, bulk lots (with their freight and other buying costs) and restocks bought in the month. Buying stock isn’t an expense: its cost counts when it sells.',
      facts: [figures.purchases === null ? 'Purchases: not fully known for this month.' : records.length ? `${plural(records.length, 'purchase')} · ${money(figures.purchases)}` : `No purchases were recorded in ${label}.`],
      records,
      issues,
      canReview: true,
      canNA: records.length === 0 && !notAvailable,
      naExplanation: `No purchases were recorded in ${label}.`,
    });
  }

  // 3. Adjustments and write-offs
  {
    const keys = ['decreases', 'increases', 'corrections', 'removed', 'sale_corrections'];
    const notAvailable = rf.status === 'not_available';
    const records: StepRecord[] = notAvailable
      ? data.adjustments.filter((a) => a.source !== 'restock' && inMonth(localDate(a.date))).map((a) => ({ id: a.id, label: a.itemName, detail: `${formatDate(localDate(a.date))} · ${a.difference > 0 ? '+' : ''}${a.difference} units · ${a.reason}`, href: itemHref(data, a.itemId), amount: a.valueDifference }))
      : rf.lines.filter((l) => keys.includes(l.key)).flatMap((l) => l.records.map((r) => ({ id: r.id, label: r.label, detail: `${l.label} · ${formatDate(r.date)} · ${r.detail}`, href: r.href, amount: r.amount })));
    const issues: CloseIssue[] = [];
    for (const l of rf.lines.filter((x) => x.key === 'removed' || x.key === 'sale_corrections')) {
      for (const r of l.records) {
        issues.push({
          id: `${l.key}:${r.id}`,
          severity: 'attention',
          text: l.key === 'removed' ? `${r.label} was deleted with ${money(Math.abs(r.amount))} of stock at cost, on ${formatDate(r.date)}. If it was lost or damaged, that’s a write-off; if it was a mistake, re-add it.` : `${r.label}: a sale was edited or cancelled on ${formatDate(r.date)}, changing inventory cost by ${money(r.amount)}.`,
          links: [{ label: r.label, href: r.href }],
        });
      }
    }
    drafts.push({
      step: 'adjustments',
      description: 'Physical quantity changes (write-offs, units found, counts) and financial corrections (cost edits, deleted items, edited or cancelled sales).',
      facts: [records.length ? `${plural(records.length, 'adjustment')} · net ${money(records.reduce((c, r) => c + (r.amount ?? 0), 0))}` : `No adjustments, write-offs or corrections in ${label}.`],
      records,
      issues,
      canReview: true,
      canNA: records.length === 0,
      naExplanation: `No adjustments, write-offs or corrections were recorded in ${label}.`,
    });
  }

  // 4. Counts
  {
    const counts = data.countHistory.filter((c) => inMonth(localDate(c.completedAt)));
    const records: StepRecord[] = counts.flatMap((c) =>
      c.lines.filter((l) => l.difference !== 0).map((l) => ({ id: `${c.id}:${l.itemId}`, label: l.itemName, detail: `Counted ${formatDate(localDate(c.completedAt))}: recorded ${l.recordedQuantity}, counted ${l.countedQuantity}${l.applied ? ' (applied)' : ' (not applied)'}`, href: itemHref(data, l.itemId), amount: l.applied ? l.valueDifference : null })),
    );
    const issues: CloseIssue[] = counts.flatMap((c) =>
      c.lines.filter((l) => l.difference !== 0 && !l.applied).map((l) => ({ id: `count:${c.id}:${l.itemId}`, severity: 'attention' as const, text: `The count found ${l.countedQuantity} of ${l.itemName} but the records kept ${l.recordedQuantity}: the difference wasn’t applied.`, links: [{ label: l.itemName, href: itemHref(data, l.itemId) }] })),
    );
    if (data.countDraft && inMonth(localDate(data.countDraft.startedAt))) issues.push({ id: 'count:draft', severity: 'attention', text: 'A count started this month is still in progress. Finish or discard it in Count Check.', links: [{ label: 'Count Check', href: '/count' }] });
    drafts.push({
      step: 'counts',
      description: 'Physical counts done in the month (Count Check): do the counted quantities match the records?',
      facts: [counts.length ? `${plural(counts.length, 'count')} · ${plural(counts.reduce((n, c) => n + c.lines.length, 0), 'item')} counted · ${plural(records.length, 'difference')}` : `No physical count was done in ${label}.`],
      records,
      issues,
      canReview: counts.length > 0,
      canNA: counts.length === 0,
      naExplanation: `Not performed: no physical count was done in ${label}, so quantities weren’t confirmed by counting.`,
    });
  }

  // 5. Payouts
  {
    const records: StepRecord[] = recon.payouts.map((p) => ({ id: p.ref, label: `eBay payout ${p.ref}`, detail: `${formatDate(p.date ?? p.latestDate)} · ${p.statusText || p.status} · ${p.difference === null ? 'no amount yet' : `difference ${money(p.difference)}`}`, href: `/sales/payouts/${encodeURIComponent(p.ref)}`, amount: p.actual }));
    const issues: CloseIssue[] = [
      ...recon.openPayouts.map((p) => ({ id: `payout:${p.ref}:${p.status}`, severity: 'attention' as const, text: `Payout ${p.ref} ${p.status === 'needs_review' ? 'needs review' : `doesn’t reconcile${p.difference !== null ? ` (difference ${money(p.difference)})` : ''}`}: ${p.statusReason}`, links: [{ label: `Payout ${p.ref}`, href: `/sales/payouts/${encodeURIComponent(p.ref)}` }] })),
      ...recon.unmatchedSales.map((u) => ({ id: `unmatched:${u.sale.id}`, severity: 'attention' as const, text: `${u.sale.itemName} (${formatDate(u.sale.saleDate)}) isn’t in the imported reports: ${u.reason}`, links: [{ label: u.sale.itemName, href: itemHref(data, u.sale.itemId) }] })),
    ];
    if (recon.status === 'partial') issues.push({ id: 'payouts:partial', severity: 'info', text: recon.statusText, links: [{ label: 'Payouts', href: '/sales/payouts' }] });
    const performed = recon.status !== 'not_performed';
    drafts.push({
      step: 'payouts',
      description: 'Marketplace payouts are transfers of money, not revenue: compare them with your recorded sales and resolve differences.',
      facts: [recon.statusText],
      records,
      issues,
      canReview: performed,
      canNA: !performed,
      naExplanation: recon.statusText,
    });
  }

  // 6. Refunds and returns
  {
    const performed = recon.status !== 'not_performed';
    const records: StepRecord[] = [
      ...recon.refunds.map((r) => ({ id: r.txnId, label: `Refund on order ${r.orderNumber || '?'}`, detail: `${formatDate(r.date)} · ${money(r.amount)}${r.outstanding ? ' · not reviewed' : ' · reviewed'}`, href: r.saleIds[0] ? itemHref(data, data.sales.find((s) => s.id === r.saleIds[0])?.itemId ?? '') : '/sales/payouts', amount: -r.amount })),
      ...data.adjustments.filter((a) => a.difference > 0 && /return/i.test(a.reason) && inMonth(localDate(a.date))).map((a) => ({ id: a.id, label: `Returned: ${a.itemName}`, detail: `${formatDate(localDate(a.date))} · +${a.difference} units · ${a.reason}`, href: itemHref(data, a.itemId), amount: a.valueDifference })),
    ];
    const issues: CloseIssue[] = recon.refunds
      .filter((r) => r.outstanding)
      .map((r) => ({ id: `refund:${r.txnId}`, severity: 'attention' as const, text: `eBay’s report shows a ${money(r.amount)} refund on order ${r.orderNumber || '?'} (${formatDate(r.date)}). StockPilot doesn’t change your sale automatically: if the sale doesn’t reflect it, profit is overstated by up to ${money(r.amount)}.`, links: [{ label: 'Payouts', href: '/sales/payouts' }] }));
    drafts.push({
      step: 'refunds',
      description: 'Refunds in imported marketplace reports, and returned items you added back to stock.',
      facts: [records.length ? `${plural(recon.refunds.length, 'refund')} in the reports · ${plural(records.length - recon.refunds.length, 'return')} recorded` : performed ? `No refunds in the imported reports for ${label}.` : 'Refunds can only be checked against imported marketplace reports.'],
      records,
      issues,
      canReview: true,
      canNA: records.length === 0,
      naExplanation: performed ? `No refunds appear in the imported reports for ${label}, and no returns were recorded.` : `Not performed: no marketplace reports cover ${label}, so refunds couldn’t be checked.`,
    });
  }

  // 7. Missing costs and low margins
  {
    const low = figures.sales.filter((s) => {
      const f = computeSale(s);
      return s.unitCost > 0 && f.revenue > 0 && (f.margin ?? 0) < settings.lowMarginPercent;
    });
    const stockNoCost = data.items.filter((i) => i.quantity > 0 && i.unitCost === 0);
    const records: StepRecord[] = [
      ...figures.noCostSales.map((s) => ({ id: s.id, label: s.itemName, detail: `Sold ${formatDate(s.saleDate)} with no recorded cost`, href: itemHref(data, s.itemId), amount: computeSale(s).netProfit })),
      ...low.map((s) => {
        const f = computeSale(s);
        return { id: s.id, label: s.itemName, detail: `Sold ${formatDate(s.saleDate)} · margin ${f.margin}% (below ${settings.lowMarginPercent}%) · profit ${money(f.netProfit)}`, href: itemHref(data, s.itemId), amount: f.netProfit };
      }),
      ...stockNoCost.map((i) => ({ id: i.id, label: i.name, detail: `${plural(i.quantity, 'unit')} in stock with no cost`, href: `/inventory/${i.id}`, amount: itemCostValue(i) })),
    ];
    const issues: CloseIssue[] = [
      ...figures.noCostSales.map((s) => ({ id: `nocostsale:${s.id}`, severity: 'attention' as const, text: `${s.itemName} (${formatDate(s.saleDate)}) has no recorded cost, so its profit is overstated by whatever it cost.`, links: [{ label: s.itemName, href: itemHref(data, s.itemId) }] })),
      ...stockNoCost.map((i) => ({ id: `nocoststock:${i.id}`, severity: 'attention' as const, text: `${i.name} is in stock with no cost: inventory cost is understated.`, links: [{ label: i.name, href: `/inventory/${i.id}` }] })),
    ];
    if (low.length) {
      const losses = low.filter((s) => computeSale(s).netProfit < 0);
      issues.push({ id: `lowmargin:${low.map((s) => s.id).join(',')}`, severity: 'attention', text: `${plural(low.length, 'sale')} had a margin below ${settings.lowMarginPercent}%${losses.length ? `, ${losses.length} of them at a loss (${money(losses.reduce((c, s) => c + computeSale(s).netProfit, 0))})` : ''}. Check the amounts are right.`, links: low.slice(0, 5).map((s) => ({ label: s.itemName, href: itemHref(data, s.itemId) })) });
    }
    drafts.push({
      step: 'costs',
      description: `Sales with no cost recorded, sales with a margin below your ${settings.lowMarginPercent}% threshold, and stock with no cost.`,
      facts: [records.length ? `${plural(figures.noCostSales.length, 'sale')} without a cost · ${plural(low.length, 'low-margin sale')} · ${plural(stockNoCost.length, 'item')} in stock without a cost` : `No missing costs or low margins in ${label}.`],
      records,
      issues,
      canReview: true,
      canNA: false,
      naExplanation: '',
    });
  }

  // 8. Summary
  {
    const t = figures.totals;
    const issues: CloseIssue[] = [];
    if (rf.status === 'difference') issues.push({ id: `rf:difference:${rf.difference}`, severity: 'attention', text: `Inventory roll-forward: ${rf.statusText}. ${rf.notes.at(-1) ?? ''}`.trim(), links: [] });
    if (rf.status === 'not_available' || rf.status === 'partial') issues.push({ id: `rf:${rf.status}`, severity: 'attention', text: `Inventory roll-forward can’t be fully verified: ${rf.statusText}.`, links: [] });
    if (!ended) issues.push({ id: 'month:open', severity: 'attention', text: `${label} isn’t over yet. It can be closed from ${formatDate(nextDay(figures.range.end))}.`, links: [] });
    if (t.netProfit < 0) issues.push({ id: 'loss', severity: 'info', text: `Realized profit is negative: ${money(t.netProfit)}.`, links: [] });
    drafts.push({
      step: 'summary',
      description: 'The month’s figures and inventory roll-forward, as they’ll be kept when you close.',
      facts: [
        `Revenue ${money(t.revenue)} − cost of goods sold ${money(t.costOfGoods)} = gross profit ${money(figures.grossProfit)}`,
        `− fees ${money(t.fees)} − shipping ${money(t.shipping)} − other ${money(t.otherExpenses)} = realized profit ${money(t.netProfit)}`,
        `Inventory: ${rf.statusText}`,
        `Payouts: ${recon.statusText}`,
      ],
      records: [],
      issues,
      canReview: true,
      canNA: false,
      naExplanation: '',
    });
  }

  const steps: CloseStep[] = drafts.map((d, i) => {
    const fingerprint = hash(JSON.stringify([d.records.map((r) => [r.id, r.amount]), d.issues.map((x) => x.id), d.facts]));
    const found = decisions.find((x) => x.step === d.step) ?? null;
    const stale = found !== null && found.fingerprint !== fingerprint;
    const decision = found && !stale ? found : null;
    const attention = d.issues.filter((x) => x.severity === 'attention');
    let state: StepState = attention.length ? 'attention' : 'todo';
    let stateText = attention.length ? `Needs attention: ${plural(attention.length, 'issue')}` : 'To review';
    if (decision?.decision === 'na') {
      state = 'na';
      stateText = `Not applicable: ${decision.note}`;
    } else if (decision) {
      state = 'completed';
      stateText = decision.decision === 'acknowledged' ? `Completed with ${plural(attention.length, 'open issue')} acknowledged` : 'Completed: reviewed';
    }
    if (stale) stateText += ' (records changed since your last decision)';
    return { ...d, number: i + 1, title: STEP_TITLES[d.step], fingerprint, decision, stale, state, stateText };
  });

  const blockers: string[] = [];
  if (closed) blockers.push(`${label} is closed (version ${closed.version}).`);
  if (!ended) blockers.push(`${label} isn’t over yet.`);
  for (const s of steps) if (s.state === 'todo' || s.state === 'attention') blockers.push(`Step ${s.number}: ${s.title} — ${s.stateText}.`);
  const unresolved = steps.filter((s) => s.decision?.decision === 'acknowledged').flatMap((s) => s.issues.filter((x) => x.severity === 'attention').map((x) => `${s.title}: ${x.text}`));
  return { month, label, figures, recon, steps, closed, ended, ready: blockers.length === 0, blockers, unresolved };
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
