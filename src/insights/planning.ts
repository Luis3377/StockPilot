// Financial planning: how much of a period's recorded realized profit to earmark for taxes and
// other goals (at percentages the user chooses), how much the user says they have actually set
// aside, and upcoming obligations they've entered. A planning aid, not a tax calculator:
//
//   suggested reserve = recorded realized profit (if positive) × the user's percentage
//   profit remaining after planned reserves = recorded realized profit − Σ suggested reserves
//
// Recorded realized profit is the same figure as Sales & Profit (sale revenue − cost of goods
// sold − fees − shipping − other selling expenses). Reserve entries and obligations are planning
// records: they never change profit, expenses, inventory or sales. Cent-exact throughout.

import type { AppData, Obligation, ReserveCategory, ReserveEntry, Sale, Settings } from '../domain/types';
import { totalSales, type SalesTotals } from '../domain/calc';
import { addDays } from '../domain/dates';
import { formatMoney, fromCents, toCents } from '../domain/money';
import { plural } from '../domain/format';
import { calcContext, saleWarnings } from './calculations';
import { currentClose, monthLabel, monthPeriod, shiftMonth, type Period } from './monthly';
import { currentReview, periodMonths, yearPeriod } from './yearEnd';

export type PeriodType = 'month' | 'quarter' | 'year';

export const PERIOD_TYPE_LABELS: Record<PeriodType, string> = { month: 'Monthly', quarter: 'Quarterly', year: 'Annual' };

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export function quarterPeriod(key: string): Period {
  const [y, q] = key.split('-Q').map(Number);
  const first = `${y}-${String((q - 1) * 3 + 1).padStart(2, '0')}`;
  const last = shiftMonth(first, 2);
  return { key, start: `${first}-01`, end: monthPeriod(last).end, label: `Q${q} ${y}` };
}

export function planningPeriod(type: PeriodType, key: string): Period {
  if (type === 'month') return monthPeriod(key);
  if (type === 'quarter') return quarterPeriod(key);
  return yearPeriod(key);
}

export function periodKeyFor(type: PeriodType, date: string): string {
  if (type === 'month') return date.slice(0, 7);
  if (type === 'quarter') return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
  return date.slice(0, 4);
}

export function shiftPeriod(type: PeriodType, key: string, by: number): string {
  const start = planningPeriod(type, key).start;
  const months = type === 'month' ? by : type === 'quarter' ? by * 3 : by * 12;
  return periodKeyFor(type, `${shiftMonth(start.slice(0, 7), months)}-01`);
}

/** Periods with any record, newest first, up to the current one. */
export function periodOptions(type: PeriodType, data: AppData, today: string): string[] {
  const dates = [...data.sales.map((s) => s.saleDate), ...data.planning.entries.map((e) => e.date)].filter((d) => d <= today);
  const current = periodKeyFor(type, today);
  const first = dates.length ? periodKeyFor(type, dates.reduce((a, b) => (a < b ? a : b))) : current;
  const out: string[] = [];
  for (let k = current; out.length < 120; k = shiftPeriod(type, k, -1)) {
    out.push(k);
    if (k <= first) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reserve arithmetic
// ---------------------------------------------------------------------------

export function percentText(p: number): string {
  return `${Number(p.toFixed(2))}%`;
}

/**
 * The reserve, in cents, for a profit at a percentage: nothing on zero or negative profit (a loss
 * doesn't create a negative reserve). The percentage is taken in basis points so the result is
 * exact, rounded half up to the cent.
 */
export function reserveCents(profitCents: number, percent: number): number {
  if (profitCents <= 0) return 0;
  const bp = Math.round(percent * 100);
  return Math.round((profitCents * bp) / 10000);
}

export interface ScenarioRow {
  percent: number;
  reserve: number;
  remaining: number;
  explanation: string;
}

export function scenarioRows(profitCents: number, percents: number[], currency: string): ScenarioRow[] {
  const money = (c: number) => formatMoney(fromCents(c), currency);
  return percents.map((p) => {
    const r = reserveCents(profitCents, p);
    return {
      percent: p,
      reserve: fromCents(r),
      remaining: fromCents(profitCents - r),
      explanation: profitCents > 0 ? `${money(profitCents)} × ${percentText(p)} = ${money(r)}; ${money(profitCents)} − ${money(r)} = ${money(profitCents - r)}` : `No profit recorded (${money(profitCents)}), so nothing is earmarked at any percentage`,
    };
  });
}

// ---------------------------------------------------------------------------
// Reserve entries
// ---------------------------------------------------------------------------

/** An entry's effect on the amount set aside (cents): deposits add, withdrawals subtract, adjustments are signed. */
export function entryCents(e: ReserveEntry): number {
  return e.kind === 'withdrawal' ? -toCents(e.amount) : toCents(e.amount);
}

const live = (e: ReserveEntry) => e.voidedAt === null;

/** What the user has recorded as set aside for a category up to a date (cents). */
export function balanceCents(data: AppData, categoryId: string, upTo: string): number {
  return data.planning.entries.filter((e) => live(e) && e.categoryId === categoryId && e.date <= upTo).reduce((c, e) => c + entryCents(e), 0);
}

// ---------------------------------------------------------------------------
// Obligations
// ---------------------------------------------------------------------------

function addMonthsClamped(date: string, months: number, day: number): string {
  const m = shiftMonth(date.slice(0, 7), months);
  const last = Number(monthPeriod(m).end.slice(8));
  return `${m}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** The dates an obligation falls on between `from` and `to` (inclusive). */
export function occurrenceDates(o: Obligation, from: string, to: string): string[] {
  if (o.recurrence === 'none') return o.dueDate >= from && o.dueDate <= to ? [o.dueDate] : [];
  const step = o.recurrence === 'monthly' ? 1 : o.recurrence === 'quarterly' ? 3 : 12;
  const day = Number(o.dueDate.slice(8));
  const out: string[] = [];
  for (let i = 0; i < 600; i++) {
    const d = addMonthsClamped(o.dueDate, i * step, day);
    if (d > to || (o.endDate && d > o.endDate)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export interface Occurrence {
  obligation: Obligation;
  date: string;
  amount: number;
  done: boolean;
  overdue: boolean;
  /** Due within 14 days (an in-app reminder; nothing is sent). */
  dueSoon: boolean;
}

/** Obligation occurrences from `from` to `to`, oldest first. Cancelled obligations are left out. */
export function obligationOccurrences(data: AppData, today: string, from: string, to: string): Occurrence[] {
  return data.planning.obligations
    .filter((o) => !o.cancelled)
    .flatMap((o) =>
      occurrenceDates(o, from, to).map((date) => {
        const done = o.completed.includes(date);
        return { obligation: o, date, amount: o.amount, done, overdue: !done && date < today, dueSoon: !done && date >= today && date <= addDays(today, 14) };
      }),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.obligation.description.localeCompare(b.obligation.description));
}

// ---------------------------------------------------------------------------
// The period's plan
// ---------------------------------------------------------------------------

export interface CategoryLine {
  category: ReserveCategory;
  /** Percent mode: the suggested reserve for the period. Goal mode: the goal. */
  target: number | null;
  calculation: string;
  /** Recorded as set aside during the period (user-entered). */
  setAsideInPeriod: number;
  /** Recorded as set aside up to the period's end (user-entered). */
  balance: number;
  /** Still to set aside toward the target (0 when met). */
  remaining: number;
  /** Set aside beyond the target. */
  ahead: number;
  entries: ReserveEntry[];
}

export interface PlanningSummary {
  type: PeriodType;
  period: Period;
  today: string;
  ended: boolean;
  sales: Sale[];
  profit: SalesTotals;
  tax: CategoryLine | null;
  lines: CategoryLine[];
  /** Σ suggested reserves of percentage categories (estimated, from the user's percentages). */
  suggestedTotal: number;
  /** Recorded realized profit − Σ suggested reserves. */
  afterReserves: number;
  setAsideTotal: number;
  balanceTotal: number;
  remainingTarget: number;
  /** Obligations due in the next 90 days (and overdue ones), not done. */
  upcoming: Occurrence[];
  upcomingTotal: number;
  overdue: Occurrence[];
  warnings: string[];
  notIncluded: string[];
  periodStatus: string;
}

export function planningSummary(data: AppData, settings: Settings, type: PeriodType, key: string, today: string): PlanningSummary {
  const money = (n: number) => formatMoney(n, settings.currency);
  const period = planningPeriod(type, key);
  const sales = data.sales.filter((s) => s.saleDate >= period.start && s.saleDate <= period.end);
  const profit = totalSales(sales);
  const profitCents = toCents(profit.netProfit);
  const asOf = period.end < today ? period.end : today;
  const categories = data.planning.categories.filter((c) => !c.archived).sort((a, b) => (a.kind === 'tax' ? -1 : b.kind === 'tax' ? 1 : a.name.localeCompare(b.name)));
  const lines: CategoryLine[] = categories.map((c) => {
    const entries = data.planning.entries.filter((e) => e.categoryId === c.id && e.date >= period.start && e.date <= period.end).sort((a, b) => a.date.localeCompare(b.date));
    const inPeriod = entries.filter(live).reduce((n, e) => n + entryCents(e), 0);
    const balance = balanceCents(data, c.id, asOf);
    let target: number | null = null;
    let calculation: string;
    let remaining = 0;
    let ahead = 0;
    if (c.mode === 'percent' && c.percent !== null) {
      const t = reserveCents(profitCents, c.percent);
      target = fromCents(t);
      calculation = profitCents > 0 ? `${money(profit.netProfit)} × ${percentText(c.percent)} = ${money(target)}` : `No profit recorded for ${period.label} (${money(profit.netProfit)}), so nothing is suggested`;
      remaining = Math.max(0, t - inPeriod);
      ahead = Math.max(0, inPeriod - t);
    } else {
      const g = toCents(c.goal ?? 0);
      target = fromCents(g);
      calculation = `Goal ${money(target)}; ${money(fromCents(balance))} set aside so far`;
      remaining = Math.max(0, g - balance);
      ahead = Math.max(0, balance - g);
    }
    return { category: c, target, calculation, setAsideInPeriod: fromCents(inPeriod), balance: fromCents(balance), remaining: fromCents(remaining), ahead: fromCents(ahead), entries };
  });
  const suggested = lines.filter((l) => l.category.mode === 'percent').reduce((c, l) => c + toCents(l.target ?? 0), 0);
  const horizon = addDays(today, 90);
  const occ = obligationOccurrences(data, today, addDays(today, -365), horizon).filter((o) => !o.done);
  const upcoming = occ.filter((o) => o.date >= today);
  const overdue = occ.filter((o) => o.overdue);

  const warnings = sales.length ? saleWarnings(calcContext(data, settings, today), sales) : [];
  if (!sales.length) warnings.unshift(`No sales are recorded for ${period.label}, so recorded realized profit is ${money(0)}.`);
  const trips = data.sourcing.sessions.filter((s) => s.date >= period.start && s.date <= period.end).reduce((c, s) => c + s.expenses.reduce((n, e) => n + toCents(e.amount), 0), 0);
  const notIncluded = [
    'Business expenses you haven’t entered on a sale (rent, insurance, software, phone, vehicle and the like) aren’t recorded in StockPilot, so they aren’t subtracted from realized profit.',
    ...(trips ? [`${money(fromCents(trips))} of sourcing trip expenses recorded in ${period.label} is kept separately and isn’t subtracted from realized profit.`] : []),
    'Upcoming obligations are plans, not expenses: they aren’t subtracted from profit.',
    'Money you set aside is an allocation, not an expense: it doesn’t reduce profit.',
    'Buying inventory isn’t an expense here: its cost counts when the items sell. Marketplace payouts are transfers of money, not profit.',
  ];

  let periodStatus: string;
  if (type === 'month') {
    const c = currentClose(data, key);
    periodStatus = c ? `${monthLabel(key)} is closed (version ${c.version}): its recorded profit is final unless the month is reopened.` : period.end < today ? `${monthLabel(key)} isn’t closed: its profit can still change if records are corrected.` : `${monthLabel(key)} is in progress: figures to date.`;
  } else {
    const months = periodMonths(period);
    const closed = months.filter((m) => currentClose(data, m)).length;
    const review = type === 'year' ? currentReview(data, key) : null;
    periodStatus = `${plural(closed, 'month')} of ${months.length} closed${review ? `; the ${key} year-end review is finalized (version ${review.version})` : ''}.${period.end >= today ? ' The period is in progress: figures to date.' : ''}`;
  }

  return {
    type,
    period,
    today,
    ended: period.end < today,
    sales,
    profit,
    tax: lines.find((l) => l.category.kind === 'tax') ?? null,
    lines,
    suggestedTotal: fromCents(suggested),
    afterReserves: fromCents(profitCents - suggested),
    setAsideTotal: fromCents(lines.reduce((c, l) => c + toCents(l.setAsideInPeriod), 0)),
    balanceTotal: fromCents(lines.reduce((c, l) => c + toCents(l.balance), 0)),
    remainingTarget: fromCents(lines.reduce((c, l) => c + toCents(l.remaining), 0)),
    upcoming,
    upcomingTotal: fromCents(upcoming.reduce((c, o) => c + toCents(o.amount), 0)),
    overdue,
    warnings,
    notIncluded,
    periodStatus,
  };
}

export const PLANNING_DISCLAIMER =
  'A planning aid, not tax advice. StockPilot doesn’t work out what you owe: the percentages are yours, and a reserve based on them may not cover every tax or obligation. Recorded profit (from your sales) is not the same as taxable income (decided by tax rules and your accountant) or the cash you have (StockPilot doesn’t see your bank).';
