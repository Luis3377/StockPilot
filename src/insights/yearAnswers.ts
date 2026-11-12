// Assistant answers about a year's inventory: what it started with, what was bought, cost of
// goods sold, why it doesn't reconcile, what was written off, which months are missing, and
// whether the year-end summary is ready for an accountant. Amounts come from the year-end engine
// and carry calculations that re-add from item, sale and movement records.

import type { AppData, Settings } from '../domain/types';
import { addDays, formatDate, type DateRange } from '../domain/dates';
import { formatMoney, fromCents, toCents } from '../domain/money';
import { computeSale } from '../domain/calc';
import { plural } from '../domain/format';
import { calcContext, type CalcLine, type Calculation, type SourceRecord } from './calculations';
import { rollForwardCalculation } from './closeAnswers';
import { ledgerInfo, MOVEMENT_LABELS, periodRollForward, type MovementKey, type Period, type RollForward } from './monthly';
import { COVERAGE_LABELS, inventoryAt, taxWorksheet, yearFigures, yearPeriod } from './yearEnd';
import { yearChecklist } from './yearChecklist';

export type YearIntent = 'year-beginning' | 'year-purchases' | 'year-cogs' | 'year-reconcile' | 'year-writeoffs' | 'year-missing-months' | 'year-ready';

export interface YearAnswer {
  intent: YearIntent;
  text: string;
  details: string[];
  calculation?: Calculation;
  followUps: string[];
}

export function yearIntent(q: string): YearIntent | null {
  if (/\bready for (my |the |an )?(accountant|bookkeeper|cpa|tax preparer)\b|\b(year-?end|annual) (report|review|summary) ready\b/.test(q)) return 'year-ready';
  if (/\bwhich months\b.*\b(missing|incomplete|not closed|open|gaps?)\b|\bmissing (months|information)\b|\bmonths? (are |is )?missing\b/.test(q)) return 'year-missing-months';
  if (/\b(start(ed)?|began|begin) (the |this |last )?year with\b|\b(beginning|opening|starting) inventory\b|\binventory (at|on) (the )?(start|beginning) of\b/.test(q)) return 'year-beginning';
  if (/\b(doesn'?t|does not|won'?t|didn'?t|not) (my |the )?inventory reconcile\b|\binventory (doesn'?t|does not|didn'?t|not) (reconcile|match|add up|balance)\b|\bmy inventory (doesn'?t|does not) reconcile\b/.test(q)) return 'year-reconcile';
  if (/\bwrite-?offs?\b|\bwritten off\b|\b(write|wrote) off\b/.test(q)) return 'year-writeoffs';
  if (/\bcost of goods sold\b|\bcogs\b/.test(q)) return 'year-cogs';
  if (/\bhow much (inventory|stock|merchandise) did i (purchase|buy)\b|\bwhat (inventory|stock|merchandise) did i (buy|purchase)\b/.test(q)) return 'year-purchases';
  return null;
}

/** The year asked about: named ("2026", "last year"), else the year just ended in January–March, else this year. */
function pickYear(q: string, today: string): string {
  const named = /\b(20\d\d)\b/.exec(q);
  if (named) return named[1];
  const y = Number(today.slice(0, 4));
  if (/\blast year\b/.test(q)) return String(y - 1);
  if (/\bthis year\b/.test(q)) return String(y);
  return Number(today.slice(5, 7)) <= 3 ? String(y - 1) : String(y);
}

/** A period for questions that name a non-year range ("this month", "the last 30 days"). */
function rangePeriod(range: DateRange | null, q: string, today: string): Period {
  const isYear = !range || /\b(20\d\d|this year|last year)\b/.test(q) || (range.start?.endsWith('-01-01') && (range.end?.endsWith('-12-31') || range.end === today));
  if (isYear) return yearPeriod(pickYear(q, today));
  return { key: `${range!.start ?? '1900-01-01'}..${range!.end ?? today}`, start: range!.start ?? '1900-01-01', end: range!.end ?? today, label: range!.label.replace(/^in /, '') };
}

function linesCalculation(ctx: ReturnType<typeof calcContext>, rf: RollForward, keys: MovementKey[], metric: string, title: string, formula: string): Calculation {
  const lines: CalcLine[] = [];
  const records: SourceRecord[] = [];
  let total = 0;
  keys.forEach((k, i) => {
    const l = rf.lines.find((x) => x.key === k)!;
    const key = `l${i}`;
    // Shown as the amount it took from (or added to) inventory, in the direction named.
    const sign = k === 'cogs' || k === 'decreases' || k === 'withdrawals' || k === 'removed' ? -1 : 1;
    const v = toCents(l.amount) * sign;
    total += v;
    lines.push({ key, label: MOVEMENT_LABELS[k], amount: fromCents(Math.abs(v)), op: v < 0 ? '-' : '+', fromRecords: true, signedParts: true });
    for (const r of l.records) records.push({ kind: r.kind === 'adjustment' ? 'item' : r.kind, id: `${k}:${r.id}`, label: r.label, detail: `${l.label} · ${formatDate(r.date)} · ${r.detail}`, date: r.date, links: [{ label: r.label, href: r.href }], parts: { [key]: r.amount * sign } });
  });
  lines.push({ key: 'total', label: title, amount: fromCents(Math.abs(total)), op: '=', fromRecords: false, negative: total < 0 });
  return { metric, title: `${title}: ${rf.period.label}`, value: fromCents(total), period: { start: rf.period.start, end: rf.period.end, label: rf.period.label }, asOf: ctx.today, formula, lines, records, warnings: rf.notes, basis: 'recorded' };
}

export function yearAnswer(q: string, data: AppData, settings: Settings, today: string, range: DateRange | null): YearAnswer | null {
  const intent = yearIntent(q);
  if (!intent) return null;
  const money = (n: number) => formatMoney(n, settings.currency);
  const cc = calcContext(data, settings, today);
  const info = ledgerInfo(data);

  if (intent === 'year-purchases' || intent === 'year-cogs' || intent === 'year-writeoffs') {
    const period = rangePeriod(range, q, today);
    const rf = /^\d{4}$/.test(period.key) ? yearFigures(data, settings, period.key, today, info).rf : periodRollForward(data, settings, period, today, info);
    const L = period.label;
    const toDate = period.end >= today ? ' (to date)' : '';
    if (intent === 'year-cogs') {
      const sales = data.sales.filter((s) => s.saleDate >= period.start && s.saleDate <= period.end);
      const cogs = fromCents(sales.reduce((c, s) => c + toCents(computeSale(s).costOfGoods), 0));
      const records: SourceRecord[] = sales.map((s) => ({ kind: 'sale', id: s.id, label: `${s.itemName}${s.quantity > 1 ? ` × ${s.quantity}` : ''}`, detail: `${formatDate(s.saleDate)} · ${s.quantity} × ${money(s.unitCost)}`, date: s.saleDate, links: [{ label: s.itemName, href: data.items.some((i) => i.id === s.itemId) ? `/inventory/${s.itemId}` : '/sales' }], parts: { cogs: computeSale(s).costOfGoods } }));
      const ws = /^\d{4}$/.test(period.key) ? taxWorksheet(yearFigures(data, settings, period.key, today, info), settings) : null;
      const l42 = ws?.lines.find((l) => l.line === '42')?.amount ?? null;
      return {
        intent,
        text: `Cost of goods sold in ${L}${toDate} was ${money(cogs)}: what the ${plural(sales.reduce((n, s) => n + s.quantity, 0), 'unit')} you sold had cost you, from ${plural(sales.length, 'recorded sale')}.`,
        details: [
          'Each sale keeps the cost of the units it sold (for bulk-lot items, their exact share of the lot).',
          l42 !== null ? `The year-end worksheet’s “beginning + purchases − ending” comes to ${money(l42)}, because it also includes write-offs, deletions, returns and cost corrections. See Year-End Review.` : '',
        ].filter(Boolean),
        calculation: { metric: 'cost_of_goods_sold', title: `Cost of goods sold: ${L}`, value: cogs, period: { start: period.start, end: period.end, label: L }, asOf: today, formula: 'Cost of goods sold = Σ cost per unit × quantity, as recorded on each sale dated in the period.', lines: [{ key: 'cogs', label: 'Cost of goods sold', amount: cogs, op: '+', fromRecords: true }, { key: 'total', label: 'Total', amount: cogs, op: '=', fromRecords: false }], records, warnings: [], basis: 'recorded' },
        followUps: ['What inventory did I write off?', 'Why doesn’t my inventory reconcile?'],
      };
    }
    if (rf.status === 'not_available') return { intent, text: `StockPilot can’t list ${intent === 'year-purchases' ? 'purchases' : 'write-offs'} for ${L}: ${rf.statusText}.`, details: rf.notes, followUps: [] };
    if (intent === 'year-purchases') {
      const calc = linesCalculation(cc, rf, ['items', 'lots', 'restocks'], 'inventory_purchases_period', 'Inventory purchased', 'Inventory purchased = items added + bulk lots (purchase price plus freight, premiums and other buying costs, split across their items) + restocks, dated in the period.');
      const lots = rf.lines.find((l) => l.key === 'lots')!;
      return {
        intent,
        text: `You bought ${money(calc.value!)} of inventory in ${L}${toDate}: ${money(rf.lines.find((l) => l.key === 'items')!.amount)} of individual items, ${money(lots.amount)} in bulk lots and ${money(rf.lines.find((l) => l.key === 'restocks')!.amount)} of restocks.`,
        details: [rf.status === 'partial' ? `Only purchases recorded since StockPilot’s dated inventory records began (${formatDate(info.startDate)}) are included.` : '', 'Buying inventory isn’t an expense: its cost counts when the items sell.'].filter(Boolean),
        calculation: calc,
        followUps: ['What was my cost of goods sold?'],
      };
    }
    const calc = linesCalculation(cc, rf, ['decreases', 'withdrawals', 'removed'], 'inventory_write_offs', 'Inventory written off', 'Written off = documented decreases (damaged, lost, stolen, counted short) + personal use + items deleted with stock, at cost.');
    const top = rf.lines.filter((l) => ['decreases', 'withdrawals', 'removed'].includes(l.key)).flatMap((l) => l.records.map((r) => ({ ...r, kind: l.label }))).sort((a, b) => a.amount - b.amount);
    return {
      intent,
      text: calc.value ? `${money(Math.abs(calc.value))} of inventory (at cost) was written off or removed in ${L}${toDate}: ${money(-rf.lines.find((l) => l.key === 'decreases')!.amount)} damaged, lost or otherwise written off, ${money(-rf.lines.find((l) => l.key === 'withdrawals')!.amount)} used personally, and ${money(-rf.lines.find((l) => l.key === 'removed')!.amount)} in items deleted with stock.` : `Nothing was written off in ${L}${toDate}.`,
      details: top.slice(0, 5).map((r) => `${r.kind}: ${r.label}, ${formatDate(r.date)}, ${money(r.amount)} — ${r.detail}.`),
      calculation: calc,
      followUps: ['Why doesn’t my inventory reconcile?'],
    };
  }

  const key = pickYear(q, today);
  const list = yearChecklist(data, settings, key, today);
  const y = list.figures;
  const L = y.period.label;

  if (intent === 'year-beginning') {
    if (y.rf.status === 'not_available') return { intent, text: `Inventory at the start of ${L} can’t be determined: ${y.beginning.text}`, details: [`Missing evidence: ${y.beginning.missing.join('; ')}.`], followUps: ['Which months are missing information?'] };
    const date = addDays(y.period.start, -1);
    const listing = inventoryAt(data, y.info, date).filter((i) => i.cost !== 0);
    const total = listing.reduce((c, i) => c + toCents(i.cost), 0);
    const lines: CalcLine[] = [
      { key: 'items', label: `Inventory cost on hand at ${formatDate(date)}, item by item`, amount: fromCents(Math.abs(total)), op: total < 0 ? '-' : '+', fromRecords: true, signedParts: true },
      { key: 'total', label: `Inventory at the start of ${L}`, amount: fromCents(Math.abs(total)), op: '=', fromRecords: false, negative: total < 0 },
    ];
    if (toCents(y.rf.beginning!) !== total) lines.push({ key: 'used', label: 'Beginning inventory used in the year’s reconciliation', amount: Math.abs(y.rf.beginning!), op: 'info', fromRecords: false, note: y.rf.beginningBasis });
    return {
      intent,
      text: `You started ${L} with ${money(y.rf.beginning!)} of inventory at cost (what you paid for the goods on hand on ${formatDate(y.period.start)}).${y.beginning.status === 'verified' ? '' : ` ${y.beginning.text}`}`,
      details: [`Basis: ${y.rf.beginningBasis}.`, `${plural(listing.length, 'item')} on hand at ${formatDate(date)}.`, ...(y.beginning.missing.length ? [`Missing evidence: ${y.beginning.missing.join('; ')}.`] : [])],
      calculation: { metric: 'beginning_inventory', title: `Beginning inventory: ${L}`, value: fromCents(total), period: null, asOf: today, formula: `Each item’s cost on hand at ${formatDate(date)}: today’s item records less everything recorded since.`, lines, records: listing.map((i) => ({ kind: 'item' as const, id: i.itemId, label: i.name, detail: `${plural(i.units, 'unit')} · ${i.category}${i.exists ? '' : ' · deleted since'}`, links: [{ label: i.name, href: i.exists ? `/inventory/${i.itemId}` : '/inventory' }], parts: { items: i.cost } })), warnings: [], basis: 'recorded' },
      followUps: ['How much inventory did I purchase?'],
    };
  }

  if (intent === 'year-reconcile') {
    if (y.rf.status === 'not_available') return { intent, text: `${L} can’t be reconciled: ${y.beginning.text}`, details: [`Missing evidence: ${y.beginning.missing.join('; ')}.`], followUps: ['Which months are missing information?'] };
    const d = y.difference ?? 0;
    const reasons = [
      y.bookDifference ? `${money(y.bookDifference)} between the item records and the dated movements (a change made outside StockPilot’s recorded actions)` : '',
      y.countDifference ? `${money(y.countDifference)} between the year-end count and the item records` : '',
      y.beginning.status !== 'verified' ? `beginning inventory can’t be fully verified (${y.beginning.text})` : '',
    ].filter(Boolean);
    return {
      intent,
      text:
        d === 0 && y.beginning.status === 'verified'
          ? `Your ${L} inventory does reconcile: beginning ${money(y.rf.beginning!)} plus the year’s recorded movements gives ${money(y.rf.expectedEnding!)}, and ${y.count ? 'the year-end count shows' : 'the item records show'} ${money(y.independentEnding!)}.`
          : `${L} doesn’t fully reconcile.${d ? ` Unexplained difference: ${money(d)}.` : ''} ${reasons.join('; ').replace(/^./, (c) => c.toUpperCase())}.`,
      details: [`Expected ending inventory ${money(y.rf.expectedEnding!)}; ${y.independentBasis}: ${money(y.independentEnding!)}.`, ...y.rf.notes],
      calculation: rollForwardCalculation(cc, y.rf),
      followUps: ['What inventory did I write off?', 'Which months are missing information?'],
    };
  }

  if (intent === 'year-missing-months') {
    const gaps = y.coverage.months.filter((m) => m.status !== 'verified' && m.status !== 'future');
    return {
      intent,
      text: gaps.length ? `${plural(gaps.length, 'month')} of ${L} ${gaps.length === 1 ? 'isn’t' : 'aren’t'} closed and verified: ${gaps.map((m) => `${m.label} (${COVERAGE_LABELS[m.status].toLowerCase()})`).join(', ')}.` : `Every month of ${L} that has ended is closed and verified.`,
      details: [...gaps.map((m) => `${m.label}: ${m.statusText}.`), ...y.coverage.inconsistencies.map((x) => x.text)],
      followUps: ['Is my year-end report ready for my accountant?'],
    };
  }

  // year-ready
  if (list.review) {
    return {
      intent,
      text: list.flags.length ? `The ${L} year-end review was finalized (version ${list.review.version}, ${formatDate(list.review.finalizedAt)}) but needs re-review: ${list.flags[0]}` : `Yes: the ${L} year-end review is finalized (version ${list.review.version}, ${formatDate(list.review.finalizedAt)}). Download the summary from Year-End Review.`,
      details: [...list.flags.slice(1), ...list.review.unresolved.map((u) => `Acknowledged at finalizing: ${u}`)],
      followUps: [],
    };
  }
  const open = list.steps.filter((s) => s.state === 'todo' || s.state === 'attention');
  return {
    intent,
    text: open.length || !list.ended ? `Not yet: ${list.ended ? '' : `${L} isn’t over, and `}${plural(open.length, 'year-end step')} ${open.length === 1 ? 'is' : 'are'} still open.` : `The ${L} review is complete: finalize it in Year-End Review, then share the summary with your accountant.`,
    details: open.map((s) => `Step ${s.number}, ${s.title}: ${s.stateText}${s.issues[0] ? `. ${s.issues[0].text}` : ''}`),
    followUps: ['Which months are missing information?', 'Why doesn’t my inventory reconcile?'],
  };
}
