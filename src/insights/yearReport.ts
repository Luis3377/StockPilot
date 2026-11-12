// The accountant-ready year-end summary: plain language first, then the inventory movement, the
// ending inventory and count, record completeness, supporting detail, warnings and an optional
// tax-preparer worksheet. Built only from saved records; downloadable as HTML (printable to PDF)
// and with CSV files of the underlying movements, sales and year-end inventory.

import type { AppData, ReportSnapshot, Settings } from '../domain/types';
import { computeSale } from '../domain/calc';
import { formatDate } from '../domain/dates';
import { formatMoney, fromCents, toCents } from '../domain/money';
import { plural } from '../domain/format';
import { toCsv } from '../csv/csv';
import type { ReportLine, ReportLineKind, ReportSectionData } from './controllerReport';
import { MOVEMENT_LABELS, MOVEMENT_ORDER } from './monthly';
import { yearChecklist, type YearChecklist } from './yearChecklist';
import { COVERAGE_LABELS, inventoryAt, taxWorksheet, type Worksheet, type YearFigures } from './yearEnd';

export const YEAR_REPORT_DISCLAIMER =
  'Generated from user-maintained StockPilot records. This is not an audited financial statement or a tax return, and it is only as complete as the records it was made from.';

export interface YearReportData {
  key: string;
  title: string;
  generatedAt: string;
  disclaimer: string;
  sections: ReportSectionData[];
  checklist: YearChecklist;
  figures: YearFigures;
  worksheet: Worksheet;
}

const line = (text: string, kind: ReportLineKind = 'plain', links: { label: string; href: string }[] = []): ReportLine => ({ text, kind, links });

export function yearReport(data: AppData, settings: Settings, key: string, today: string, generatedAt: string = new Date().toISOString()): YearReportData {
  const money = (n: number) => formatMoney(n, settings.currency);
  const checklist = yearChecklist(data, settings, key, today);
  const y = checklist.figures;
  const rf = y.rf;
  const L = y.period.label;
  const ws = taxWorksheet(y, settings);
  const avail = rf.status !== 'not_available';
  const sections: ReportSectionData[] = [];
  const pos = (n: number) => money(Math.abs(n));

  // 1. Summary in plain words
  const summary: ReportLine[] = [];
  summary.push(
    avail && rf.beginning !== null
      ? line(`On ${formatDate(y.period.start)} your inventory cost ${money(rf.beginning)} (what you paid for the goods on hand).${y.beginning.status === 'verified' ? '' : ' This can’t be fully verified; see Record completeness.'}`, y.beginning.status === 'verified' ? 'verified' : 'limitation')
      : line(`Inventory on ${formatDate(y.period.start)} can’t be determined: ${y.beginning.text}`, 'limitation'),
  );
  if (avail) {
    summary.push(line(`During ${L} you bought ${money(y.purchases!)} of inventory${y.capitalizedCosts ? `, including ${money(y.capitalizedCosts)} of freight, buyer’s premiums and other buying costs added to bulk lots` : ''}.`, 'verified'));
    summary.push(line(`The goods you sold had cost you ${pos(y.line('cogs'))} (cost of goods sold, from ${plural(y.totals.salesCount, 'recorded sale')} bringing in ${money(y.totals.revenue)}).`, 'verified'));
    const parts = [
      y.line('decreases') ? `${pos(y.line('decreases'))} was written off as damaged, lost or otherwise removed` : '',
      y.line('withdrawals') ? `${pos(y.line('withdrawals'))} was taken for personal use` : '',
      y.line('removed') ? `${pos(y.line('removed'))} left with items deleted from the records` : '',
      y.line('returns') || y.line('increases') ? `${money(y.line('returns') + y.line('increases'))} came back as returns or units found` : '',
      y.line('corrections') ? `cost corrections changed inventory by ${money(y.line('corrections'))}` : '',
    ].filter(Boolean);
    if (parts.length) summary.push(line(`${parts.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()), 'verified'));
    summary.push(line(`That leaves ${money(rf.expectedEnding!)} of inventory expected at ${formatDate(y.period.end)}. ${y.count ? 'The year-end count' : 'The item records'} show ${money(y.independentEnding!)}: ${y.difference === 0 ? 'they agree to the cent' : `an unexplained difference of ${money(y.difference!)}`}.`, y.difference === 0 ? 'verified' : 'attention'));
  } else {
    summary.push(line(`Sales in ${L}: ${money(y.totals.revenue)} from ${plural(y.totals.salesCount, 'sale')}, with ${money(y.totals.costOfGoods)} cost of goods sold (from your sale records).`, 'verified'));
  }
  const sufficient = avail && y.beginning.status === 'verified' && y.difference === 0;
  summary.push(line(sufficient ? `The records support these balances: beginning inventory is documented, every movement is dated and linked to a record, and the ending balance agrees.` : `The records don’t fully support these balances yet: ${[y.beginning.status !== 'verified' ? 'beginning inventory isn’t documented' : '', y.difference ? 'there is an unexplained difference' : '', !avail ? 'there are no dated inventory records for the year' : ''].filter(Boolean).join('; ')}.`, sufficient ? 'verified' : 'limitation'));
  sections.push({ key: 'summary', title: 'Summary', lines: summary });

  // 2. Inventory movement (a table)
  if (avail) {
    sections.push({
      key: 'movement',
      title: 'Inventory movement for the year',
      lines: [line(`Beginning inventory: ${rf.beginningBasis}.`)],
      rows: [
        { label: `Inventory at ${formatDate(y.period.start)}`, current: money(rf.beginning!), previous: '', change: '' },
        ...MOVEMENT_ORDER.filter((k) => y.line(k) !== 0).map((k) => ({ label: MOVEMENT_LABELS[k], current: `${y.line(k) > 0 ? '+' : '−'}${pos(y.line(k))}`, previous: '', change: '' })),
        { label: `Expected inventory at ${formatDate(y.period.end)}`, current: money(rf.expectedEnding!), previous: '', change: '' },
        { label: 'Item records at year-end', current: money(rf.recordsEnding!), previous: '', change: '' },
        ...(y.count ? [{ label: 'Physical count at year-end', current: money(fromCents(y.count.countedEndingCents)), previous: '', change: '' }] : []),
        { label: 'Unexplained difference', current: money(y.difference!), previous: '', change: '' },
      ],
    });
  }

  // 3. Ending inventory and count
  const ending: ReportLine[] = [];
  if (avail) ending.push(line(`Item records at ${formatDate(y.period.end)}: ${money(rf.recordsEnding!)} (${rf.recordsBasis.charAt(0).toLowerCase()}${rf.recordsBasis.slice(1)}).`, 'verified'));
  if (y.count) {
    const c = y.count;
    const n = (s: string) => c.lines.filter((l) => l.status === s);
    ending.push(line(`${c.basis}: ${money(fromCents(c.countedEndingCents))}.`, 'verified'));
    ending.push(line(`${plural(c.lines.length, 'item')} counted: ${n('match').length} matched, ${n('missing_or_damaged').length} missing or damaged (${money(fromCents(n('missing_or_damaged').reduce((s, l) => s + toCents(l.valueDifference), 0)))}), ${n('found').length} found (${money(fromCents(n('found').reduce((s, l) => s + toCents(l.valueDifference), 0)))}), ${n('needs_recount').length} needing a recount.`, n('needs_recount').length ? 'attention' : 'plain'));
  } else {
    ending.push(line(`No physical year-end count: ending inventory comes from the item records, not a count.`, 'limitation'));
  }
  sections.push({ key: 'ending', title: 'Inventory at year-end', lines: ending });

  // 4. Record completeness
  const comp: ReportLine[] = [];
  comp.push(line(y.info.startDate ? `StockPilot’s dated inventory records ${y.info.complete ? 'cover your whole history' : `begin ${formatDate(y.info.startDate)}`}.` : 'No dated inventory records yet.', y.info.complete || (y.info.startDate ?? '9') <= y.period.start ? 'verified' : 'limitation'));
  comp.push(line(`Beginning inventory: ${y.beginning.text}${y.beginning.missing.length ? ` Missing evidence: ${y.beginning.missing.join('; ')}.` : ''}`, y.beginning.status === 'verified' ? 'verified' : 'limitation'));
  for (const m of y.coverage.months) comp.push(line(`${m.label}: ${COVERAGE_LABELS[m.status]} — ${m.statusText}.`, m.status === 'verified' ? 'verified' : m.status === 'exceptions' ? 'plain' : 'attention', [{ label: 'Monthly Close', href: `/sales/close?month=${m.month}` }]));
  for (const x of y.coverage.inconsistencies) comp.push(line(x.text, 'attention'));
  if (y.coverage.sums && !y.coverage.inconsistencies.some((x) => x.id.startsWith('sum:'))) comp.push(line(`The twelve monthly closes add up to the year’s figures: ${y.coverage.sums.map((s) => `${s.label.toLowerCase()} ${money(s.year)}`).join(', ')}.`, 'verified'));
  sections.push({ key: 'completeness', title: 'Record completeness', lines: comp });

  // 5. Supporting details
  const listing = avail ? inventoryAt(data, y.info, y.period.end) : [];
  const adjustments = rf.lines.filter((l) => ['decreases', 'withdrawals', 'removed', 'corrections', 'returns', 'increases', 'sale_corrections'].includes(l.key)).flatMap((l) => l.records.map((r) => ({ ...r, kind: l.label })));
  const details: ReportLine[] = [
    line(`${plural(y.totals.salesCount, 'sale')} (${plural(y.totals.unitsSold, 'unit')}) recorded in ${L}; revenue ${money(y.totals.revenue)}, cost of goods sold ${money(y.totals.costOfGoods)}, realized profit ${money(y.totals.netProfit)}.`, 'verified'),
  ];
  if (avail) {
    details.push(line(`${plural(listing.filter((i) => i.cost !== 0).length, 'item')} in inventory at ${formatDate(y.period.end)}, at a cost of ${money(fromCents(listing.reduce((c, i) => c + toCents(i.cost), 0)))}.`, 'verified'));
    for (const a of [...adjustments].sort((p, q) => Math.abs(q.amount) - Math.abs(p.amount)).slice(0, 5)) details.push(line(`${a.kind}: ${a.label}, ${formatDate(a.date)}, ${money(a.amount)} — ${a.detail}.`, 'plain', [{ label: a.label, href: a.href }]));
  }
  details.push(line('Every movement, sale and year-end item is in the CSV downloads.', 'plain'));
  sections.push({ key: 'details', title: 'Supporting details', lines: details });

  // 6. Warnings
  const warnings = [...checklist.flags.map((f) => line(f, 'attention')), ...checklist.steps.flatMap((s) => s.issues.filter((x) => x.severity === 'attention').map((x) => line(x.text, 'attention', x.links)))];
  sections.push({ key: 'warnings', title: 'Significant warnings', lines: warnings.length ? warnings : [line('None.')] });

  // 7. Worksheet
  sections.push({
    key: 'worksheet',
    title: 'Optional worksheet for a tax preparer (Schedule C, Part III layout)',
    lines: [
      line(ws.disclaimer, 'limitation'),
      ...ws.lines.map((w) => line(`Line ${w.line} — ${w.label}: ${w.amount === null ? '—' : money(w.amount)} [${w.status === 'recorded' ? 'recorded figure' : w.status === 'not_tracked' ? 'not tracked' : 'needs review'}]. ${w.note}`, w.status === 'recorded' ? 'verified' : 'limitation')),
      ...(ws.bridge.length ? [line(`Line 42 compared with your records: ${ws.bridge.map((b) => `${b.label.toLowerCase()} ${money(b.amount)}`).join(' + ')} = ${money(fromCents(ws.bridge.reduce((c, b) => c + toCents(b.amount), 0)))}.`, 'verified')] : []),
    ],
  });

  return { key, title: `Year-End Inventory Summary: ${L}`, generatedAt, disclaimer: YEAR_REPORT_DISCLAIMER, sections, checklist, figures: y, worksheet: ws };
}

const PREFIX: Record<ReportLineKind, string> = { verified: '', contributing: 'Contributing factor: ', possible: 'Possible explanation (not proven): ', attention: 'Needs attention: ', limitation: 'Limitation: ', plain: '' };

export function yearReportSnapshot(r: YearReportData): ReportSnapshot {
  return {
    title: r.title,
    generatedAt: r.generatedAt,
    sections: [
      { title: 'About this report', lines: [r.disclaimer] },
      ...r.sections.map((s) => ({ title: s.title, lines: [...(s.rows ?? []).map((row) => `${row.label}: ${row.current}`), ...s.lines.map((l) => `${PREFIX[l.kind]}${l.text}`)] })),
    ],
  };
}

// ---------------------------------------------------------------------------
// CSV downloads
// ---------------------------------------------------------------------------

/** Every dated inventory movement in the year (its amounts add up to each roll-forward line). */
export function movementsCsv(y: YearFigures): string {
  const rows = y.rf.lines.flatMap((l) => l.records.map((r) => [r.date, l.label, r.label, r.detail, r.amount])).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return toCsv(['date', 'movement', 'item', 'detail', 'inventory_cost_change'], rows);
}

/** The year's sales with their cost of goods sold. */
export function yearSalesCsv(data: AppData, y: YearFigures): string {
  const sales = data.sales.filter((s) => s.saleDate >= y.period.start && s.saleDate <= y.period.end).sort((a, b) => a.saleDate.localeCompare(b.saleDate));
  return toCsv(
    ['sale_date', 'item', 'sku', 'category', 'quantity', 'revenue', 'cost_of_goods_sold', 'fees', 'shipping', 'other_expenses', 'realized_profit', 'platform', 'order_number'],
    sales.map((s) => {
      const f = computeSale(s);
      return [s.saleDate, s.itemName, s.itemSku, s.itemCategory, s.quantity, f.revenue, f.costOfGoods, f.fees, f.shipping, f.otherExpenses, f.netProfit, s.platform, s.orderNumber];
    }),
  );
}

/** Inventory on hand at year-end, item by item (adds up to the item-records ending figure). */
export function yearInventoryCsv(data: AppData, y: YearFigures): string {
  const listing = y.rf.status === 'not_available' ? [] : inventoryAt(data, y.info, y.period.end);
  return toCsv(['item', 'sku', 'category', 'units_at_year_end', 'cost_at_year_end', 'still_in_records'], listing.map((i) => [i.name, i.sku, i.category, i.units, i.cost, i.exists ? 'yes' : 'no (deleted since)']));
}
