// Year-end inventory review: the annual roll-forward (beginning + purchases ± corrections − cost
// of goods sold − write-offs … = expected ending), compared with an independently established
// ending inventory (the item records at year-end, or a physical year-end count), the monthly
// closes behind the year, a per-item inventory listing, and an optional worksheet for a tax
// preparer. Built on the inventory ledger and month-end closes; nothing is estimated, and
// periods the records don't cover are reported as such rather than as a $0 difference.
//
// Terminology is general on purpose (inventory, merchandise, items): it applies to any business
// that buys, holds and sells goods. Manufacturing (materials, labor, work in progress) and
// service businesses aren't modeled.

import type { AppData, CountLine, CountRecord, MonthClose, Settings, YearReview } from '../domain/types';
import { itemCostValue, totalSales, type SalesTotals } from '../domain/calc';
import { addDays, formatDate } from '../domain/dates';
import { formatMoney, fromCents, toCents } from '../domain/money';
import { plural } from '../domain/format';
import { localDate } from '../domain/ledger';
import { currentClose, ledgerInfo, monthLabel, periodRollForward, shiftMonth, type LedgerInfo, type MovementKey, type OpeningOverride, type Period, type RollForward } from './monthly';

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export const YEAR_KEY = /^\d{4}$/;

/** A calendar year. (Fiscal years would be another constructor returning the same shape.) */
export function yearPeriod(key: string | number): Period {
  const y = String(key);
  return { key: y, start: `${y}-01-01`, end: `${y}-12-31`, label: y };
}

export function previousYear(period: Period): Period {
  return yearPeriod(Number(period.key) - 1);
}

export function periodMonths(period: Period): string[] {
  const out: string[] = [];
  for (let m = period.start.slice(0, 7); m <= period.end.slice(0, 7); m = shiftMonth(m, 1)) out.push(m);
  return out;
}

export function periodEnded(period: Period, today: string): boolean {
  return period.end < today;
}

/** The current (not superseded) finalized review of a year, if any. */
export function currentReview(data: AppData, key: string): YearReview | null {
  return data.yearEnd.reviews.find((r) => r.periodKey === key && r.status === 'finalized') ?? null;
}

// ---------------------------------------------------------------------------
// Beginning inventory: the previous year's review, its December close, or the ledger
// ---------------------------------------------------------------------------

export function yearOpening(data: AppData, period: Period): OpeningOverride | null {
  const prev = previousYear(period);
  const review = currentReview(data, prev.key);
  if (review && review.figures.recordsEnding !== null) {
    return { cents: toCents(review.figures.recordsEnding), basis: `Ending inventory cost in the ${prev.label} year-end review (finalized ${formatDate(review.finalizedAt)}, version ${review.version})`, source: `the ${prev.label} year-end review` };
  }
  const dec = currentClose(data, prev.end.slice(0, 7));
  if (dec && dec.rollForward.recordsEnding !== null) {
    return { cents: toCents(dec.rollForward.recordsEnding), basis: `Ending inventory cost when ${monthLabel(dec.month)} was closed (${formatDate(dec.closedAt)})`, source: `the ${monthLabel(dec.month)} close` };
  }
  return null;
}

export interface BeginningEvidence {
  status: 'verified' | 'partial' | 'missing';
  text: string;
  /** What would be needed to verify it. */
  missing: string[];
}

function beginningEvidence(rf: RollForward, info: LedgerInfo, period: Period, opening: OpeningOverride | null): BeginningEvidence {
  if (rf.status === 'not_available') {
    return {
      status: 'missing',
      text: `Cannot fully verify: StockPilot’s dated inventory records begin ${formatDate(info.startDate)}, after ${period.label} ended.`,
      missing: [`Inventory cost on ${formatDate(period.start)} (no dated records exist before ${formatDate(info.startDate)})`, `Purchases, write-offs and cost changes during ${period.label}`],
    };
  }
  if (rf.status === 'partial') {
    return {
      status: 'partial',
      text: `Cannot fully verify: dated inventory records begin ${formatDate(info.startDate)}, during ${period.label}. The beginning figure is the inventory on hand then, not on ${formatDate(period.start)}.`,
      missing: [`Inventory cost on ${formatDate(period.start)} (for example a count, or a balance from your previous records)`, `Purchases, write-offs and cost changes between ${formatDate(period.start)} and ${formatDate(addDays(info.startDate!, -1))}`],
    };
  }
  return { status: 'verified', text: opening ? opening.basis : rf.beginningBasis, missing: [] };
}

// ---------------------------------------------------------------------------
// Monthly coverage
// ---------------------------------------------------------------------------

export type CoverageStatus = 'verified' | 'exceptions' | 'open' | 'missing' | 'not_verifiable' | 'future';

export const COVERAGE_LABELS: Record<CoverageStatus, string> = {
  verified: 'Closed and verified',
  exceptions: 'Closed with exceptions',
  open: 'Open (reopened)',
  missing: 'Not closed',
  not_verifiable: 'Not fully verifiable',
  future: 'Not over yet',
};

export interface MonthCoverage {
  month: string;
  label: string;
  status: CoverageStatus;
  statusText: string;
  close: MonthClose | null;
}

export interface Inconsistency {
  id: string;
  text: string;
}

export interface Coverage {
  months: MonthCoverage[];
  /** Every month is closed (verified or with exceptions). */
  complete: boolean;
  inconsistencies: Inconsistency[];
  /** When every month is closed: the closes' totals beside the year's, figure by figure. */
  sums: { label: string; closes: number; year: number }[] | null;
}

export function yearCoverage(data: AppData, settings: Pick<Settings, 'currency'>, period: Period, today: string, info: LedgerInfo, rf: RollForward, totals: SalesTotals, purchases: number | null): Coverage {
  const money = (n: number) => formatMoney(n, settings.currency);
  const months = periodMonths(period).map((m): MonthCoverage => {
    const label = monthLabel(m);
    const end = lastDay(m);
    const close = currentClose(data, m);
    const reopened = !close && data.monthlyClose.closes.some((c) => c.month === m);
    if (end >= today) return { month: m, label, status: 'future', statusText: 'The month isn’t over yet', close: null };
    if (!info.complete && info.startDate && end < info.startDate) return { month: m, label, status: 'not_verifiable', statusText: `Before StockPilot’s dated inventory records began (${formatDate(info.startDate)})`, close };
    if (close) {
      const ok = close.rollForward.status === 'verified' && !close.unresolved.length;
      return {
        month: m,
        label,
        status: ok ? 'verified' : 'exceptions',
        statusText: ok ? `Closed ${formatDate(close.closedAt)} (version ${close.version}); inventory verified` : `Closed ${formatDate(close.closedAt)} (version ${close.version}): ${[close.unresolved.length ? plural(close.unresolved.length, 'acknowledged issue') : '', close.rollForward.status !== 'verified' ? close.rollForward.statusText.toLowerCase() : ''].filter(Boolean).join('; ')}`,
        close,
      };
    }
    if (reopened) {
      const last = [...data.monthlyClose.closes].filter((c) => c.month === m).sort((a, b) => b.version - a.version)[0];
      return { month: m, label, status: 'open', statusText: `Reopened ${formatDate(last.supersededAt ?? last.closedAt)} (${last.reopenReason}) and not closed again`, close: null };
    }
    return { month: m, label, status: 'missing', statusText: 'Never closed', close: null };
  });

  const inconsistencies: Inconsistency[] = [];
  for (let i = 1; i < months.length; i++) {
    const a = months[i - 1].close;
    const b = months[i].close;
    if (a && b && a.figures.endingInventory !== null && b.figures.beginningInventory !== null && toCents(a.figures.endingInventory) !== toCents(b.figures.beginningInventory)) {
      inconsistencies.push({ id: `chain:${b.month}`, text: `${months[i].label} was closed starting from ${money(b.figures.beginningInventory)}, but ${months[i - 1].label} closed at ${money(a.figures.endingInventory)} (a ${money(b.figures.beginningInventory - a.figures.endingInventory)} gap).` });
    }
  }
  const first = months[0]?.close;
  if (first && first.figures.beginningInventory !== null && rf.beginning !== null && toCents(first.figures.beginningInventory) !== toCents(rf.beginning)) {
    inconsistencies.push({ id: 'chain:start', text: `${months[0].label} was closed starting from ${money(first.figures.beginningInventory)}; the year’s beginning inventory is ${money(rf.beginning)}.` });
  }
  const last = months.at(-1)?.close;
  if (last && last.figures.endingInventory !== null && rf.recordsEnding !== null && toCents(last.figures.endingInventory) !== toCents(rf.recordsEnding)) {
    inconsistencies.push({ id: 'chain:end', text: `${months.at(-1)!.label} closed at ${money(last.figures.endingInventory)}; the item records at year-end now give ${money(rf.recordsEnding)}.` });
  }
  const complete = months.every((m) => m.status === 'verified' || m.status === 'exceptions');
  let sums: Coverage['sums'] = null;
  if (complete) {
    const closes = months.map((m) => m.close!);
    const sum = (f: (c: MonthClose) => number) => fromCents(closes.reduce((n, c) => n + toCents(f(c)), 0));
    sums = [
      { label: 'Sales revenue', closes: sum((c) => c.figures.revenue), year: totals.revenue },
      { label: 'Cost of goods sold', closes: sum((c) => c.figures.costOfGoods), year: totals.costOfGoods },
      { label: 'Realized profit', closes: sum((c) => c.figures.realizedProfit), year: totals.netProfit },
      ...(purchases !== null ? [{ label: 'Inventory purchases', closes: sum((c) => c.figures.purchases), year: purchases }] : []),
    ];
    for (const s of sums) if (toCents(s.closes) !== toCents(s.year)) inconsistencies.push({ id: `sum:${s.label}`, text: `${s.label}: the monthly closes add up to ${money(s.closes)}, but the year’s records now give ${money(s.year)} (${money(s.year - s.closes)} changed since the months were closed).` });
  }
  return { months, complete, inconsistencies, sums };
}

function lastDay(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Physical year-end count
// ---------------------------------------------------------------------------

/** Counts completed from a month before to a month after the year-end: candidates for its physical count. */
export function yearEndCountCandidates(data: AppData, period: Period): CountRecord[] {
  const from = addDays(period.end, -30);
  const to = addDays(period.end, 31);
  return data.countHistory.filter((c) => {
    const d = localDate(c.completedAt);
    return d >= from && d <= to;
  });
}

export interface CountLineView extends Omit<CountLine, 'status'> {
  status: 'match' | 'needs_recount' | 'missing_or_damaged' | 'found';
}

export interface YearCount {
  record: CountRecord;
  date: string;
  timing: 'on' | 'before' | 'after';
  /** The count covered every item (no category or location filter). */
  full: boolean;
  lines: CountLineView[];
  /** Inventory cost at year-end per the count (records for anything not counted). */
  countedEndingCents: number;
  /** Counted − item records at year-end: differences the books don't show at year-end. */
  differenceCents: number;
  /** Recorded movements between the count and the year-end, taken from the records. */
  between: { count: number; cents: number };
  basis: string;
}

export function yearEndCount(data: AppData, settings: Pick<Settings, 'currency'>, period: Period, info: LedgerInfo, recordsEndingCents: number | null): YearCount | null {
  const id = data.yearEnd.counts[period.key];
  const record = id ? data.countHistory.find((c) => c.id === id) : undefined;
  if (!record || recordsEndingCents === null) return null;
  const money = (cents: number) => formatMoney(fromCents(cents), settings.currency);
  const date = localDate(record.completedAt);
  const timing = date === period.end ? 'on' : date < period.end ? 'before' : 'after';
  const own = new Set(data.adjustments.filter((a) => a.countId === record.id).map((a) => a.id));
  const between = info.movements.filter((m) => !own.has(m.record.id) && (timing === 'after' ? m.date > period.end && m.date <= date : timing === 'before' ? m.date > date && m.date <= period.end : false));
  // A difference is already in the year-end records only if it was applied on or before the year-end.
  let difference = 0;
  const lines: CountLineView[] = record.lines.map((l) => {
    if (l.difference !== 0 && !(l.applied && date <= period.end)) difference += toCents(l.valueDifference);
    const status: CountLineView['status'] = l.difference === 0 ? 'match' : !l.applied ? 'needs_recount' : l.difference < 0 ? 'missing_or_damaged' : 'found';
    return { ...l, status };
  });
  const full = record.scope.category === null && record.scope.location === null;
  const moved = between.reduce((c, m) => c + m.cents, 0);
  const span = timing === 'after' ? `between ${formatDate(period.end)} and the count` : `between the count and ${formatDate(period.end)}`;
  const taken = between.length ? `the ${plural(between.length, 'recorded movement')} ${span} (${money(moved)}) ${between.length === 1 ? 'is' : 'are'} taken from the records` : `nothing was recorded ${span}`;
  const basis =
    timing === 'on'
      ? `Physical count on ${formatDate(date)} (the year-end)`
      : timing === 'after'
        ? `Physical count on ${formatDate(date)}, after the year-end: ${taken}, and the differences found are assumed to have existed at year-end`
        : `Physical count on ${formatDate(date)}, before the year-end: ${taken}`;
  return { record, date, timing, full, lines, countedEndingCents: recordsEndingCents + difference, differenceCents: difference, between: { count: between.length, cents: between.reduce((c, m) => c + m.cents, 0) }, basis: full ? basis : `${basis}. The count covered only some items; the rest come from the item records` };
}

// ---------------------------------------------------------------------------
// Inventory on hand at a date, per item (records rolled back by later movements)
// ---------------------------------------------------------------------------

export interface ItemAtDate {
  itemId: string;
  name: string;
  sku: string;
  category: string;
  units: number;
  cost: number;
  /** The item still exists (false: deleted since). */
  exists: boolean;
}

export function inventoryAt(data: AppData, info: LedgerInfo, date: string): ItemAtDate[] {
  const later = info.movements.filter((m) => m.date > date);
  const ids = new Set([...data.items.map((i) => i.id), ...later.map((m) => m.itemId)]);
  const out: ItemAtDate[] = [];
  for (const id of ids) {
    const item = data.items.find((i) => i.id === id);
    const mine = later.filter((m) => m.itemId === id);
    const cents = (item ? toCents(itemCostValue(item)) : 0) - mine.reduce((c, m) => c + m.cents, 0);
    const units = (item?.quantity ?? 0) - mine.reduce((n, m) => n + m.units, 0);
    if (cents === 0 && units === 0) continue;
    const name = item?.name ?? mine[0]?.record.label ?? 'Deleted item';
    out.push({ itemId: id, name, sku: item?.sku ?? '', category: item?.category.trim() || 'Uncategorized', units, cost: fromCents(cents), exists: Boolean(item) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// The year's figures
// ---------------------------------------------------------------------------

export interface YearFigures {
  period: Period;
  info: LedgerInfo;
  rf: RollForward;
  totals: SalesTotals;
  grossProfit: number;
  opening: OpeningOverride | null;
  beginning: BeginningEvidence;
  /** Items + bulk lots + restocks bought (null when the ledger doesn't cover the year). */
  purchases: number | null;
  /** Freight, premiums, fees and other buying costs recorded on bulk lots bought in the year (part of purchases). */
  capitalizedCosts: number;
  line: (key: MovementKey) => number;
  count: YearCount | null;
  /** Ending inventory established independently of the expected figure: a year-end count, or the item records. */
  independentEnding: number | null;
  independentBasis: string;
  /** Independent ending − expected ending (null when not available). */
  difference: number | null;
  /** Of the difference: item records vs the ledger, and counted vs item records. */
  bookDifference: number | null;
  countDifference: number | null;
  coverage: Coverage;
  tripBuyingCosts: number;
  ended: boolean;
}

export function yearFigures(data: AppData, settings: Pick<Settings, 'currency'>, key: string, today: string, info: LedgerInfo = ledgerInfo(data)): YearFigures {
  const period = yearPeriod(key);
  const opening = yearOpening(data, period);
  const rf = periodRollForward(data, settings, period, today, info, opening);
  const sales = data.sales.filter((s) => s.saleDate >= period.start && s.saleDate <= period.end);
  const totals = totalSales(sales);
  const line = (k: MovementKey) => rf.lines.find((l) => l.key === k)?.amount ?? 0;
  const available = rf.status !== 'not_available';
  const purchases = available ? fromCents(toCents(line('items')) + toCents(line('lots')) + toCents(line('restocks'))) : null;
  // Bulk lots whose purchase counts in this year (net of purchase-date moves): their recorded buying costs.
  const lotNet = new Map<string, number>();
  for (const e of data.inventoryLedger.events) if (e.lotId && (e.kind === 'acquired' || e.kind === 'purchase_date') && e.date >= period.start && e.date <= period.end) lotNet.set(e.lotId, (lotNet.get(e.lotId) ?? 0) + toCents(e.amount));
  const capitalizedCosts = available ? fromCents(data.lots.filter((l) => (lotNet.get(l.id) ?? 0) > 0).reduce((c, l) => c + l.extraCosts.reduce((n, e) => n + toCents(e.amount), 0), 0)) : 0;
  const count = available ? yearEndCount(data, settings, period, info, rf.recordsEnding === null ? null : toCents(rf.recordsEnding)) : null;
  const independent = count ? count.countedEndingCents : rf.recordsEnding === null ? null : toCents(rf.recordsEnding);
  const expected = rf.expectedEnding === null ? null : toCents(rf.expectedEnding);
  const tripBuyingCosts = fromCents(data.sourcing.sessions.filter((s) => s.date >= period.start && s.date <= period.end).reduce((c, s) => c + s.expenses.filter((e) => e.kind === 'acquisition').reduce((n, e) => n + toCents(e.amount), 0), 0));
  return {
    period,
    info,
    rf,
    totals,
    grossProfit: fromCents(toCents(totals.revenue) - toCents(totals.costOfGoods)),
    opening,
    beginning: beginningEvidence(rf, info, period, opening),
    purchases,
    capitalizedCosts,
    line,
    count,
    independentEnding: independent === null ? null : fromCents(independent),
    independentBasis: count ? count.basis : rf.recordsBasis,
    difference: independent === null || expected === null ? null : fromCents(independent - expected),
    bookDifference: rf.difference,
    countDifference: count ? fromCents(count.differenceCents) : null,
    coverage: yearCoverage(data, settings, period, today, info, rf, totals, purchases),
    tripBuyingCosts,
    ended: periodEnded(period, today),
  };
}

// ---------------------------------------------------------------------------
// Optional tax-preparer worksheet (organized like Schedule C, Part III). Not tax advice.
// ---------------------------------------------------------------------------

export interface WorksheetLine {
  line: string;
  label: string;
  amount: number | null;
  status: 'recorded' | 'needs_review' | 'not_tracked';
  note: string;
}

export interface Worksheet {
  lines: WorksheetLine[];
  /** How line 42 relates to cost of goods sold from recorded sales (parts add up exactly). */
  bridge: { label: string; amount: number }[];
  disclaimer: string;
}

export const WORKSHEET_DISCLAIMER =
  'For a tax preparer to review, not tax advice. StockPilot doesn’t prepare or file returns or work out taxable income. Not every business files Schedule C (partnerships, corporations and others use different forms), and businesses don’t all use the same inventory method. Your accountant should confirm the method, every classification and every amount below.';

export function taxWorksheet(y: YearFigures, settings: Pick<Settings, 'currency'>): Worksheet {
  const money = (n: number) => formatMoney(n, settings.currency);
  const available = y.rf.status !== 'not_available';
  const withdrawals = -y.line('withdrawals');
  const verifiedBeginning = y.beginning.status === 'verified';
  const begin = available ? y.rf.beginning : null;
  const purchasesNet = y.purchases === null ? null : fromCents(toCents(y.purchases) - toCents(withdrawals));
  const ending = y.independentEnding;
  const sum = begin !== null && purchasesNet !== null ? fromCents(toCents(begin) + toCents(purchasesNet)) : null;
  const l42 = sum !== null && ending !== null ? fromCents(toCents(sum) - toCents(ending)) : null;
  const lines: WorksheetLine[] = [
    { line: '33', label: 'Method used to value closing inventory', amount: null, status: 'needs_review', note: 'StockPilot records each item at its own cost (bulk lots split by the method you chose; restocks average an item’s cost). Whether that is “cost”, “lower of cost or market” or another method for your return is for your accountant to decide.' },
    { line: '34', label: 'Change in determining quantities, costs or valuations', amount: null, status: 'needs_review', note: 'StockPilot can’t know how earlier years were valued. Needs review.' },
    { line: '35', label: 'Inventory at beginning of year', amount: begin, status: verifiedBeginning && begin !== null ? 'recorded' : 'needs_review', note: verifiedBeginning ? y.beginning.text : `${y.beginning.text} Needs review.` },
    {
      line: '36',
      label: 'Purchases, less cost of items withdrawn for personal use',
      amount: purchasesNet,
      status: purchasesNet === null ? 'needs_review' : y.beginning.status === 'verified' ? 'recorded' : 'needs_review',
      note: purchasesNet === null ? 'Purchases for this year weren’t recorded with dates.' : `Recorded purchases ${money(y.purchases!)} (including ${money(y.capitalizedCosts)} of freight, premiums and other buying costs recorded on bulk lots) less ${money(withdrawals)} recorded as used personally.${y.rf.status === 'partial' ? ' Only purchases recorded since the inventory ledger began are included.' : ''}`,
    },
    { line: '37', label: 'Cost of labor', amount: null, status: 'not_tracked', note: 'Not tracked by StockPilot. Enter only if it applies to your business; it isn’t assumed.' },
    { line: '38', label: 'Materials and supplies', amount: null, status: 'not_tracked', note: 'Not tracked by StockPilot. Enter only if it applies; it isn’t assumed.' },
    { line: '39', label: 'Other costs', amount: null, status: 'needs_review', note: y.tripBuyingCosts ? `${money(y.tripBuyingCosts)} of sourcing-trip buying costs (entry fees and similar) is recorded separately and isn’t in inventory. Whether it belongs here is for your accountant.` : 'Nothing is assumed. Needs review.' },
    { line: '40', label: 'Add lines 35 through 39', amount: sum, status: 'needs_review', note: 'Recorded lines 35 and 36 only; lines 37–39 need review.' },
    { line: '41', label: 'Inventory at end of year', amount: ending, status: ending !== null && y.difference === 0 && verifiedBeginning ? 'recorded' : 'needs_review', note: `${y.independentBasis}.${y.difference ? ` Unexplained difference ${money(y.difference)}: needs review.` : ''}` },
    { line: '42', label: 'Line 40 less line 41', amount: l42, status: 'needs_review', note: 'Arithmetic on the lines above; see how it compares with cost of goods sold from your recorded sales.' },
  ];
  // Line 42 = cost of goods sold + write-offs + deletions … (the roll-forward identity), exactly.
  const bridge: { label: string; amount: number }[] = [];
  if (l42 !== null) {
    const part = (label: string, cents: number) => cents !== 0 && bridge.push({ label, amount: fromCents(cents) });
    part('Cost of goods sold from recorded sales', -toCents(y.line('cogs')));
    part('Write-offs and other documented decreases', -toCents(y.line('decreases')));
    part('Items deleted with stock', -toCents(y.line('removed')));
    part('Units found and returns added back', -(toCents(y.line('increases')) + toCents(y.line('returns'))));
    part('Cost corrections', -toCents(y.line('corrections')));
    part('Sale edits and cancellations', -toCents(y.line('sale_corrections')));
    part('Unexplained difference (and count differences)', -toCents(y.difference ?? 0));
  }
  return { lines, bridge, disclaimer: WORKSHEET_DISCLAIMER };
}

