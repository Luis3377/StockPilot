// The Monthly Controller's Report: a plain-English comparison of a month with the one before,
// built only from saved records. Statements are labelled by how much the records prove:
//   verified      — arithmetic on the records (the profit change splits exactly into revenue,
//                   cost of goods sold, fees, shipping and other expenses);
//   contributing  — records that account for part of a change (categories, sources, losses);
//   possible      — patterns that may explain a change but that the records can't prove.
// Nothing is estimated, and incomplete records are listed as limitations.

import type { AppData, ReportSnapshot, Sale, Settings } from '../domain/types';
import { computeSale, daysWithoutSale, itemCostValue, totalSales } from '../domain/calc';
import { formatDate, formatDateTime } from '../domain/dates';
import { formatMoney, fromCents, toCents } from '../domain/money';
import { plural } from '../domain/format';
import { sourcingReport } from './sourcing';
import { closeChecklist, type Checklist } from './closeChecklist';
import { monthFigures, monthLabel, shiftMonth, type MonthFigures } from './monthly';

export type ReportLineKind = 'verified' | 'contributing' | 'possible' | 'attention' | 'limitation' | 'plain';

export interface ReportLink {
  label: string;
  href: string;
}

export interface ReportLine {
  text: string;
  kind: ReportLineKind;
  links: ReportLink[];
}

export interface ReportRow {
  label: string;
  current: string;
  previous: string;
  change: string;
}

export interface ReportSectionData {
  key: string;
  title: string;
  lines: ReportLine[];
  rows?: ReportRow[];
}

export interface ControllerReport {
  month: string;
  previous: string;
  title: string;
  generatedAt: string;
  disclaimer: string;
  current: MonthFigures;
  prior: MonthFigures;
  /** Profit change split exactly into its parts (cents add up). */
  decomposition: { key: string; label: string; amount: number }[];
  sections: ReportSectionData[];
  checklist: Checklist;
}

export const REPORT_DISCLAIMER = 'Generated from user-maintained StockPilot records. This is not an audited financial statement, and it is only as complete as the records it was made from.';

const KIND_PREFIX: Record<ReportLineKind, string> = {
  verified: 'Verified: ',
  contributing: 'Contributing factor: ',
  possible: 'Possible explanation (not proven by the records): ',
  attention: 'Needs attention: ',
  limitation: 'Limitation: ',
  plain: '',
};

const line = (text: string, kind: ReportLineKind = 'plain', links: ReportLink[] = []): ReportLine => ({ text, kind, links });
const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
const round2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
const catKey = (c: string) => c.trim() || 'Uncategorized';

function byCategory(sales: Sale[]) {
  const map = new Map<string, Sale[]>();
  for (const s of sales) map.set(catKey(s.itemCategory), [...(map.get(catKey(s.itemCategory)) ?? []), s]);
  return new Map([...map].map(([k, v]) => [k, totalSales(v)]));
}

export function controllerReport(data: AppData, settings: Settings, month: string, today: string, generatedAt: string = new Date().toISOString()): ControllerReport {
  const money = (n: number) => formatMoney(n, settings.currency);
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
  const previous = shiftMonth(month, -1);
  const cur = monthFigures(data, settings, month, today);
  const pri = monthFigures(data, settings, previous, today);
  const checklist = closeChecklist(data, settings, month, today);
  const L = monthLabel(month);
  const P = monthLabel(previous);
  const c = cur.totals;
  const p = pri.totals;
  const delta = (a: number, b: number) => fromCents(toCents(a) - toCents(b));
  const change = (a: number, b: number) => {
    const d = delta(a, b);
    const rel = b !== 0 ? ` (${d >= 0 ? '+' : '−'}${Math.abs(Math.round((d / Math.abs(b)) * 1000) / 10)}%)` : '';
    return `${signed(d)}${rel}`;
  };
  const sections: ReportSectionData[] = [];
  const limitations: ReportLine[] = [];

  // --- Decomposition (verified) -----------------------------------------------------
  const decomposition = [
    { key: 'revenue', label: 'Sales revenue', amount: delta(c.revenue, p.revenue) },
    { key: 'cogs', label: 'Cost of goods sold', amount: -delta(c.costOfGoods, p.costOfGoods) },
    { key: 'fees', label: 'Marketplace fees', amount: -delta(c.fees, p.fees) },
    { key: 'shipping', label: 'Shipping', amount: -delta(c.shipping, p.shipping) },
    { key: 'other', label: 'Other selling expenses', amount: -delta(c.otherExpenses, p.otherExpenses) },
  ].map((d) => ({ ...d, amount: d.amount === 0 ? 0 : d.amount }));
  const dProfit = delta(c.netProfit, p.netProfit);

  // --- Contributing factors -----------------------------------------------------------
  const cc = byCategory(cur.sales);
  const pc = byCategory(pri.sales);
  const cats = [...new Set([...cc.keys(), ...pc.keys()])].map((k) => {
    const a = cc.get(k);
    const b = pc.get(k);
    return { k, now: a?.netProfit ?? 0, before: b?.netProfit ?? 0, mNow: round2(a?.margin ?? null), mBefore: round2(b?.margin ?? null), revNow: a?.revenue ?? 0, revBefore: b?.revenue ?? 0, units: a?.unitsSold ?? 0 };
  });
  const movers = cats.filter((x) => delta(x.now, x.before) !== 0).sort((a, b) => Math.abs(delta(b.now, b.before)) - Math.abs(delta(a.now, a.before)));
  const contributing: ReportLine[] = [];
  for (const m of movers.slice(0, 3)) {
    const margins = m.revNow && m.revBefore && m.mNow !== null && m.mBefore !== null && m.mNow !== m.mBefore ? `; its margin ${m.mNow < m.mBefore ? 'decreased' : 'increased'} from ${m.mBefore}% to ${m.mNow}%` : '';
    contributing.push(line(`${m.k}: realized profit ${money(m.before)} in ${P} → ${money(m.now)} in ${L} (${signed(delta(m.now, m.before))})${margins}.`, 'contributing'));
  }
  const losses = cur.sales.filter((s) => computeSale(s).netProfit < 0);
  const lossGroups = [...byCategory(losses)].sort((a, b) => a[1].netProfit - b[1].netProfit);
  for (const [k, t] of lossGroups.slice(0, 3)) {
    const ls = losses.filter((s) => catKey(s.itemCategory) === k);
    contributing.push(line(`${plural(t.salesCount, `${k === 'Uncategorized' ? 'uncategorized' : k} sale`)} generated ${money(Math.abs(t.netProfit))} in recorded losses.`, 'contributing', ls.slice(0, 5).map((s) => ({ label: `${s.itemName} (${formatDate(s.saleDate)})`, href: itemHref(data, s.itemId) }))));
  }
  const srcNow = sourcingReport(data, settings, { range: cur.range, today }).sources;
  const srcBefore = sourcingReport(data, settings, { range: pri.range, today }).sources;
  const srcMoves = srcNow
    .map((s) => ({ s, before: srcBefore.find((b) => b.ref.key === s.ref.key)?.realizedProfit ?? 0 }))
    .filter((x) => delta(x.s.realizedProfit, x.before) !== 0)
    .sort((a, b) => Math.abs(delta(b.s.realizedProfit, b.before)) - Math.abs(delta(a.s.realizedProfit, a.before)));
  for (const { s, before } of srcMoves.slice(0, 2)) {
    contributing.push(line(`Source ${s.ref.name}: realized profit ${money(before)} → ${money(s.realizedProfit)} (${signed(delta(s.realizedProfit, before))}).`, 'contributing', [{ label: s.ref.name, href: `/insights/sourcing/source/${encodeURIComponent(s.ref.key)}` }]));
  }

  // --- Possible explanations ------------------------------------------------------------
  const possible: ReportLine[] = [];
  if (c.unitsSold !== p.unitsSold && p.unitsSold > 0) {
    const sameWay = c.unitsSold < p.unitsSold === dProfit < 0;
    possible.push(line(`Units sold went from ${p.unitsSold} to ${c.unitsSold}. ${sameWay ? `${c.unitsSold < p.unitsSold ? 'Selling fewer units' : 'Selling more units'} may account for part of the change.` : 'Profit moved the other way, so the number of units sold doesn’t explain the change.'}`, 'possible'));
  }
  if (c.unitsSold && p.unitsSold) {
    const a = fromCents(Math.round(toCents(c.revenue) / c.unitsSold));
    const b = fromCents(Math.round(toCents(p.revenue) / p.unitsSold));
    if (a !== b) possible.push(line(`Average revenue per unit sold was ${money(a)}, against ${money(b)} in ${P}. This may reflect prices or a different mix of products.`, 'possible'));
  }
  if (c.revenue && p.revenue) {
    const fa = Math.round((c.fees / c.revenue) * 1000) / 10;
    const fb = Math.round((p.fees / p.revenue) * 1000) / 10;
    if (Math.abs(fa - fb) >= 1) possible.push(line(`Fees took ${fa}% of revenue, against ${fb}% in ${P}: possibly a change in platforms, categories or fee rates.`, 'possible'));
    const sa = Math.round((c.shipping / c.revenue) * 1000) / 10;
    const sb = Math.round((p.shipping / p.revenue) * 1000) / 10;
    if (Math.abs(sa - sb) >= 1) possible.push(line(`Shipping you paid was ${sa}% of revenue, against ${sb}% in ${P}.`, 'possible'));
  }

  // --- Executive summary ------------------------------------------------------------------
  const summary: ReportLine[] = [];
  if (!c.salesCount && !p.salesCount) summary.push(line(`No sales were recorded in ${L} or ${P}.`));
  else {
    summary.push(line(dProfit === 0 ? `Realized profit was ${money(c.netProfit)}, the same as in ${P}.` : `Realized profit ${dProfit > 0 ? 'increased' : 'decreased'} by ${money(Math.abs(dProfit))} compared with ${P}: ${money(p.netProfit)} → ${money(c.netProfit)}.`, 'verified'));
    summary.push(line(`Revenue was ${money(c.revenue)} from ${plural(c.salesCount, 'sale')} (${P}: ${money(p.revenue)} from ${plural(p.salesCount, 'sale')}). Realized margin ${pct(pri.marginPct)} → ${pct(cur.marginPct)}; gross margin ${pct(pri.grossMarginPct)} → ${pct(cur.grossMarginPct)}.`, 'verified'));
    if (contributing[0]) summary.push(line(contributing[0].text, 'contributing', contributing[0].links));
    const lossLine = contributing.find((x) => x.text.includes('recorded losses'));
    if (lossLine && lossLine !== contributing[0]) summary.push(line(lossLine.text, 'contributing', lossLine.links));
  }

  // --- Inventory ---------------------------------------------------------------------------
  const rf = cur.rollForward;
  const slow = data.items
    .filter((i) => i.quantity > 0)
    .map((i) => ({ i, days: daysWithoutSale(i, data.sales, today) }))
    .filter((x) => x.days >= settings.slowMovingDays)
    .sort((a, b) => itemCostValue(b.i) - itemCostValue(a.i));
  const slowCost = fromCents(slow.reduce((n, x) => n + toCents(itemCostValue(x.i)), 0));
  const inventory: ReportLine[] = [
    line(`Purchases: ${cur.purchases === null ? 'not fully known (before the inventory ledger began)' : money(cur.purchases)} (${P}: ${pri.purchases === null ? 'not fully known' : money(pri.purchases)}). Buying stock isn’t a loss: its cost counts when it sells.`, 'verified'),
    line(rf.recordsEnding === null ? `Ending inventory cost for ${L} isn’t available: ${rf.statusText}.` : `Inventory cost: ${rf.beginning === null ? '—' : money(rf.beginning)} at the start, ${money(rf.recordsEnding)} at the end (${rf.recordsBasis.charAt(0).toLowerCase()}${rf.recordsBasis.slice(1)}).`, rf.recordsEnding === null ? 'limitation' : 'verified'),
    line(`Inventory roll-forward: ${rf.statusText}.`, rf.status === 'verified' ? 'verified' : 'attention'),
    line(slow.length ? `${plural(slow.length, 'item')} ${slow.length === 1 ? 'hasn’t' : 'haven’t'} sold in ${settings.slowMovingDays}+ days (as of ${formatDate(today)}), with ${money(slowCost)} of cash tied up at cost.` : `No stock has gone ${settings.slowMovingDays}+ days without a sale (as of ${formatDate(today)}).`, slow.length ? 'attention' : 'plain', slow.slice(0, 5).map((x) => ({ label: x.i.name, href: `/inventory/${x.i.id}` }))),
  ];

  // --- Categories --------------------------------------------------------------------------
  const ranked = cats.filter((x) => cc.has(x.k)).sort((a, b) => b.now - a.now);
  // Best and weakest never repeat a category.
  const bestCount = ranked.length > 1 ? Math.min(3, ranked.length - 1) : ranked.length;
  const categoryLines: ReportLine[] = ranked.length
    ? [
        line(`Best: ${ranked.slice(0, bestCount).map((x) => `${x.k} ${money(x.now)} (margin ${pct(x.mNow)})`).join('; ')}.`, 'verified'),
        ...(ranked.length > bestCount ? [line(`Weakest: ${ranked.slice(Math.max(bestCount, ranked.length - 2)).reverse().map((x) => `${x.k} ${money(x.now)} (margin ${pct(x.mNow)})`).join('; ')}.`, 'verified')] : []),
      ]
    : [line(`No sales in ${L}.`)];

  // --- Sourcing ----------------------------------------------------------------------------
  const sourcing: ReportLine[] = srcNow.filter((s) => s.sales.length).length
    ? srcNow
        .filter((s) => s.sales.length)
        .slice(0, 4)
        .map((s) => line(`${s.ref.name}: ${money(s.realizedProfit)} realized profit from ${plural(s.unitsSold, 'unit')}${s.marginPct !== null ? ` (margin ${s.marginPct}%)` : ''}; ${money(s.inventoryCost)} still in stock at cost.`, 'verified', [{ label: s.ref.name, href: `/insights/sourcing/source/${encodeURIComponent(s.ref.key)}` }]))
    : [line(`No sales in ${L} to attribute to sources.`)];

  // --- Reconciliation --------------------------------------------------------------------
  const recon = checklist.recon;
  const reconLines: ReportLine[] = [line(recon.statusText, recon.status === 'reconciled' ? 'verified' : recon.status === 'not_performed' ? 'limitation' : 'attention', [{ label: 'Payouts', href: '/sales/payouts' }])];
  for (const po of recon.openPayouts.slice(0, 5)) reconLines.push(line(`Payout ${po.ref}: ${po.statusReason}`, 'attention', [{ label: `Payout ${po.ref}`, href: `/sales/payouts/${encodeURIComponent(po.ref)}` }]));
  if (recon.unmatchedSales.length) reconLines.push(line(`${plural(recon.unmatchedSales.length, 'recorded sale')} in ${L} ${recon.unmatchedSales.length === 1 ? 'isn’t' : 'aren’t'} in the imported reports.`, 'attention'));

  // --- Exceptions and follow-ups -------------------------------------------------------
  const exceptions = checklist.steps.flatMap((s) => s.issues.filter((x) => x.severity === 'attention').map((x) => line(x.text, 'attention', x.links)));
  const followUps: ReportLine[] = [];
  if (slow.length) followUps.push(line(`Review pricing on ${plural(slow.length, 'slow-moving item')} (${money(slowCost)} at cost).`, 'plain', slow.slice(0, 5).map((x) => ({ label: x.i.name, href: `/inventory/${x.i.id}` }))));
  const noCostStock = data.items.filter((i) => i.quantity > 0 && i.unitCost === 0);
  if (noCostStock.length) followUps.push(line(`Add the cost to ${plural(noCostStock.length, 'item')} in stock that ${noCostStock.length === 1 ? 'has' : 'have'} none.`, 'plain', noCostStock.slice(0, 5).map((i) => ({ label: i.name, href: `/inventory/${i.id}` }))));
  if (recon.openPayouts.length) followUps.push(line(`Resolve ${plural(recon.openPayouts.length, 'unreconciled payout')}.`, 'plain', [{ label: 'Payouts', href: '/sales/payouts' }]));
  if (recon.status === 'not_performed') followUps.push(line(`Import ${L}’s marketplace reports to reconcile payouts.`, 'plain', [{ label: 'Payouts', href: '/sales/payouts' }]));
  if (rf.status === 'difference') followUps.push(line(`Investigate the unexplained inventory difference of ${money(rf.difference!)}, for example with a Count Check.`, 'plain', [{ label: 'Count Check', href: '/count' }]));
  if (!data.countHistory.some((ch) => ch.completedAt.slice(0, 7) === month)) followUps.push(line('Consider a Count Check to confirm quantities on hand.', 'plain', [{ label: 'Count Check', href: '/count' }]));

  // --- Limitations ----------------------------------------------------------------------
  if (rf.status === 'not_available' || rf.status === 'partial') limitations.push(line(`Inventory: ${rf.statusText}.`, 'limitation'));
  for (const n of rf.notes) limitations.push(line(n, 'limitation'));
  if (cur.noCostSales.length) limitations.push(line(`${plural(cur.noCostSales.length, 'sale')} in ${L} ${cur.noCostSales.length === 1 ? 'has' : 'have'} no recorded cost, so cost of goods sold may be understated and profit overstated.`, 'limitation'));
  if (recon.status === 'not_performed') limitations.push(line('Payouts weren’t reconciled, so recorded sales weren’t checked against what the marketplace paid.', 'limitation'));
  if (!p.salesCount && c.salesCount) limitations.push(line(`There were no sales in ${P} to compare with.`, 'limitation'));
  limitations.push(line('Bank transactions aren’t part of StockPilot, so cash in the bank isn’t verified here.', 'limitation'));
  if (cur.tripExpenses) limitations.push(line(`${money(cur.tripExpenses)} of sourcing trip expenses dated in ${L} are recorded separately and aren’t included in realized profit.`, 'limitation'));

  sections.push({ key: 'summary', title: 'Executive summary', lines: summary });
  sections.push({
    key: 'profitability',
    title: 'Revenue and profitability',
    lines: [],
    rows: [
      { label: 'Sales revenue', current: money(c.revenue), previous: money(p.revenue), change: change(c.revenue, p.revenue) },
      { label: 'Cost of goods sold', current: money(c.costOfGoods), previous: money(p.costOfGoods), change: change(c.costOfGoods, p.costOfGoods) },
      { label: 'Gross profit', current: money(cur.grossProfit), previous: money(pri.grossProfit), change: change(cur.grossProfit, pri.grossProfit) },
      { label: 'Gross margin', current: pct(cur.grossMarginPct), previous: pct(pri.grossMarginPct), change: marginChange(cur.grossMarginPct, pri.grossMarginPct) },
      { label: 'Marketplace fees', current: money(c.fees), previous: money(p.fees), change: change(c.fees, p.fees) },
      { label: 'Shipping', current: money(c.shipping), previous: money(p.shipping), change: change(c.shipping, p.shipping) },
      { label: 'Other selling expenses', current: money(c.otherExpenses), previous: money(p.otherExpenses), change: change(c.otherExpenses, p.otherExpenses) },
      { label: 'Realized profit', current: money(c.netProfit), previous: money(p.netProfit), change: change(c.netProfit, p.netProfit) },
      { label: 'Realized margin', current: pct(cur.marginPct), previous: pct(pri.marginPct), change: marginChange(cur.marginPct, pri.marginPct) },
      { label: 'Units sold', current: String(c.unitsSold), previous: String(p.unitsSold), change: `${c.unitsSold - p.unitsSold >= 0 ? '+' : '−'}${Math.abs(c.unitsSold - p.unitsSold)}` },
    ],
  });
  sections.push({
    key: 'changes',
    title: 'What changed compared with last month',
    lines: [
      line(`Realized profit changed by ${signed(dProfit)}. It splits exactly into: ${decomposition.filter((d) => d.amount !== 0).map((d) => `${d.label.toLowerCase()} ${signed(d.amount)}`).join(', ') || 'no changes'}.`, 'verified'),
      ...contributing,
      ...possible,
    ],
  });
  sections.push({ key: 'categories', title: 'Product categories', lines: categoryLines });
  sections.push({ key: 'inventory', title: 'Inventory movement', lines: inventory });
  sections.push({ key: 'sourcing', title: 'Sourcing performance', lines: sourcing });
  sections.push({ key: 'reconciliation', title: 'Marketplace reconciliation', lines: reconLines });
  sections.push({ key: 'exceptions', title: 'Important exceptions', lines: exceptions.length ? exceptions : [line('No open issues in the closing checklist.')] });
  sections.push({ key: 'followups', title: 'Recommended follow-up for next month', lines: followUps.length ? followUps : [line('Nothing specific.')] });
  sections.push({ key: 'limitations', title: 'Limitations of these figures', lines: limitations });

  return { month, previous, title: `Controller’s Report: ${L}`, generatedAt, disclaimer: REPORT_DISCLAIMER, current: cur, prior: pri, decomposition, sections, checklist };
}

function marginChange(a: number | null, b: number | null): string {
  if (a === null || b === null) return '—';
  const d = Math.round((a - b) * 100) / 100;
  return `${d >= 0 ? '+' : '−'}${Math.abs(d)} pts`;
}

function itemHref(data: AppData, itemId: string): string {
  return data.items.some((i) => i.id === itemId) ? `/inventory/${itemId}` : '/sales';
}

/** The report as kept with a close: plain text lines (links aren't stored). */
export function reportSnapshot(r: ControllerReport): ReportSnapshot {
  return {
    title: r.title,
    generatedAt: r.generatedAt,
    sections: [
      { title: 'About this report', lines: [r.disclaimer] },
      ...r.sections.map((s) => ({
        title: s.title,
        lines: [...(s.rows ?? []).map((row) => `${row.label}: ${row.current} (${monthLabel(r.previous)}: ${row.previous}; change ${row.change})`), ...s.lines.map((l) => `${KIND_PREFIX[l.kind]}${l.text}`)],
      })),
    ],
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A standalone HTML file of a report snapshot (for download; opens in any browser and prints to PDF). */
export function reportHtml(snap: ReportSnapshot, meta: { status: string }): string {
  const body = snap.sections
    .map((s) => `<section><h2>${esc(s.title)}</h2><ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></section>`)
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(snap.title)}</title>
<style>body{font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1f2328;max-width:760px;margin:24px auto;padding:0 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:20px 0 6px;border-bottom:1px solid #d0d7de;padding-bottom:4px}ul{padding-left:18px;margin:0}li{margin:3px 0}.meta{color:#57606a;font-size:13px}</style>
</head><body>
<h1>${esc(snap.title)}</h1>
<p class="meta">${esc(meta.status)} · generated ${esc(formatDateTime(snap.generatedAt))}</p>
${body}
</body></html>
`;
}
