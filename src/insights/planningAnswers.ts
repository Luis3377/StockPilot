// Assistant answers about reserve planning: what to consider setting aside (at the user's own
// percentages), what they've recorded as set aside, what's left to reach their targets, upcoming
// obligations they entered, profit remaining after planned reserves, and how the target changed
// from last month. Amounts come from recorded sales or the user's own planning records, with
// calculations re-added from those records. Not tax advice; no rate is ever assumed.

import type { AppData, Sale, Settings } from '../domain/types';
import { computeSale } from '../domain/calc';
import { formatDate, type DateRange } from '../domain/dates';
import { formatMoney, fromCents, toCents } from '../domain/money';
import { plural } from '../domain/format';
import { calcContext, saleRecord, type CalcLine, type Calculation, type SourceRecord } from './calculations';
import { entryCents, percentText, periodKeyFor, planningSummary, reserveCents, shiftPeriod, type PeriodType, type PlanningSummary } from './planning';

export type PlanningIntent = 'reserve-suggested' | 'reserve-set-aside' | 'reserve-remaining' | 'obligations' | 'after-reserves' | 'reserve-change';

export interface PlanningAnswer {
  intent: PlanningIntent;
  text: string;
  details: string[];
  calculation?: Calculation;
  followUps: string[];
}

export function planningIntent(q: string): PlanningIntent | null {
  if (/\b(reserve|set-?aside) (target|goal)\b.*\bchange|\bchange\b.*\breserve (target|goal)\b/.test(q)) return 'reserve-change';
  if (/\b(obligations?|upcoming (expenses|bills|payments|costs))\b/.test(q)) return 'obligations';
  if (/\bremain\w*\b.*\bafter\b.*\breserves?\b|\bprofit (left|remaining) after\b/.test(q)) return 'after-reserves';
  if (/\bremaining (reserve|savings) (goal|target)s?\b|\b(how far|how much) (am i )?behind\b.*\b(reserve|savings|target)\b|\bleft to (set aside|reserve|save)\b/.test(q)) return 'reserve-remaining';
  if (/\bhow much (have i|did i) (set aside|reserved?|saved)\b|\b(amount|money) (i('ve)? )?(set aside|reserved)\b/.test(q)) return 'reserve-set-aside';
  if (/\b(should|could) i (consider )?(reserv|set aside|save)\w*\b|\b(tax )?reserve (should|for taxes)\b|\bset aside for (taxes|tax)\b/.test(q)) return 'reserve-suggested';
  return null;
}

function periodFor(q: string, range: DateRange | null, today: string): { type: PeriodType; key: string } {
  if (/\blast quarter\b/.test(q)) return { type: 'quarter', key: shiftPeriod('quarter', periodKeyFor('quarter', today), -1) };
  if (/\bquarter\b/.test(q)) return { type: 'quarter', key: periodKeyFor('quarter', today) };
  if (range?.start && range.end) {
    if (range.start.slice(0, 7) === range.end.slice(0, 7)) return { type: 'month', key: range.start.slice(0, 7) };
    if (range.start.endsWith('-01-01') && range.start.slice(0, 4) === range.end.slice(0, 4)) return { type: 'year', key: range.start.slice(0, 4) };
  }
  return { type: 'month', key: today.slice(0, 7) };
}

/** Recorded realized profit for a period, re-added from its sales. */
function profitLines(ctx: ReturnType<typeof calcContext>, sales: Sale[], key: string, label: string): { line: CalcLine; records: SourceRecord[]; cents: number } {
  const cents = sales.reduce((c, s) => c + toCents(computeSale(s).netProfit), 0);
  return {
    line: { key, label, amount: fromCents(Math.abs(cents)), op: cents < 0 ? '-' : '+', fromRecords: true, signedParts: true },
    records: sales.map((s) => ({ ...saleRecord(ctx, s), parts: { [key]: computeSale(s).netProfit } })),
    cents,
  };
}

export function planningAnswer(q: string, data: AppData, settings: Settings, today: string, range: DateRange | null): PlanningAnswer | null {
  const intent = planningIntent(q);
  if (!intent) return null;
  const money = (n: number) => formatMoney(n, settings.currency);
  const cc = calcContext(data, settings, today);
  // "Change from last month" compares this month with last month (not last month with the one before).
  const { type, key } = intent === 'reserve-change' && /\b(from|since|compared (to|with)|versus|vs\.?) last month\b/.test(q) ? { type: 'month' as const, key: today.slice(0, 7) } : periodFor(q, range, today);
  const s: PlanningSummary = planningSummary(data, settings, type, key, today);
  const L = s.period.label;
  const toDate = s.ended ? '' : ' (to date)';
  const percentLines = s.lines.filter((l) => l.category.mode === 'percent');
  const noPlan = 'You haven’t chosen a reserve percentage yet. StockPilot doesn’t assume a tax rate: set the percentage you want to use in Sales & Profit → Financial Planning.';
  const caveat = 'A planning estimate from your own percentage, not tax advice or what you actually owe; recorded profit isn’t taxable income or cash.';

  if (intent === 'obligations') {
    const up = s.upcoming;
    const records: SourceRecord[] = up.map((o) => ({ kind: 'planning', id: `${o.obligation.id}:${o.date}`, label: o.obligation.description, detail: `${formatDate(o.date)}${o.obligation.recurrence === 'none' ? '' : ` · repeats ${o.obligation.recurrence}`} · entered by you`, date: o.date, links: [{ label: 'Financial Planning', href: '/sales/planning' }], parts: { total: o.amount } }));
    return {
      intent,
      text: up.length ? `You’ve planned ${plural(up.length, 'payment')} in the next 90 days, ${money(s.upcomingTotal)} in total. The next is ${up[0].obligation.description}: ${money(up[0].amount)} on ${formatDate(up[0].date)}.` : 'You haven’t planned any obligations for the next 90 days.',
      details: [...up.slice(0, 6).map((o) => `${formatDate(o.date)}: ${o.obligation.description}, ${money(o.amount)}${o.dueSoon ? ' (due soon)' : ''}.`), ...(s.overdue.length ? [`${plural(s.overdue.length, 'planned payment')} past its date and not marked done.`] : []), 'These are your own planning entries: they aren’t recorded as expenses and don’t change profit.'],
      calculation: up.length ? { metric: 'planned_obligations', title: 'Planned obligations, next 90 days', value: s.upcomingTotal, period: null, asOf: today, formula: 'Σ the estimated amounts you entered for obligations falling in the next 90 days (recurring ones repeat on their schedule).', lines: [{ key: 'total', label: 'Planned obligations (entered by you)', amount: s.upcomingTotal, op: '+', fromRecords: true }, { key: 'sum', label: 'Total', amount: s.upcomingTotal, op: '=', fromRecords: false }], records, warnings: [], basis: 'estimate' } : undefined,
      followUps: ['How much have I set aside?'],
    };
  }

  if (intent === 'reserve-set-aside') {
    if (!s.lines.length) return { intent, text: 'You haven’t set up any reserves yet, so nothing is recorded as set aside.', details: ['Add a reserve in Financial Planning, then record what you move into it.'], followUps: [] };
    const lines: CalcLine[] = [];
    const records: SourceRecord[] = [];
    let total = 0;
    s.lines.forEach((l, i) => {
      const k = `c${i}`;
      const entries = data.planning.entries.filter((e) => e.voidedAt === null && e.categoryId === l.category.id && e.date <= today);
      const cents = entries.reduce((c, e) => c + entryCents(e), 0);
      total += cents;
      lines.push({ key: k, label: `${l.category.name} (recorded by you)`, amount: fromCents(Math.abs(cents)), op: cents < 0 ? '-' : '+', fromRecords: true, signedParts: true });
      for (const e of entries) records.push({ kind: 'planning', id: e.id, label: `${l.category.name}: ${e.kind}`, detail: `${formatDate(e.date)}${e.note ? ` · ${e.note}` : ''}`, date: e.date, links: [{ label: 'Financial Planning', href: '/sales/planning' }], parts: { [k]: fromCents(entryCents(e)) } });
    });
    lines.push({ key: 'total', label: 'Recorded as set aside', amount: fromCents(Math.abs(total)), op: '=', fromRecords: false, negative: total < 0 });
    return {
      intent,
      text: `You’ve recorded ${money(fromCents(total))} as set aside: ${s.lines.map((l) => `${l.category.name} ${money(fromCents(data.planning.entries.filter((e) => e.voidedAt === null && e.categoryId === l.category.id && e.date <= today).reduce((c, e) => c + entryCents(e), 0)))}`).join(', ')}.`,
      details: ['These are the amounts you entered. StockPilot doesn’t see your bank, so it can’t confirm the money is there.', 'Setting money aside doesn’t reduce profit: it’s an allocation, not an expense.'],
      calculation: { metric: 'reserved', title: 'Recorded as set aside', value: fromCents(total), period: null, asOf: today, formula: 'Σ deposits − withdrawals ± adjustments you recorded, per reserve (voided entries don’t count).', lines, records, warnings: [], basis: 'recorded' },
      followUps: ['What is my remaining reserve goal?'],
    };
  }

  if (!percentLines.length && intent !== 'reserve-remaining') return { intent, text: noPlan, details: [], followUps: [] };

  if (intent === 'reserve-change') {
    const prevKey = shiftPeriod('month', key, -1);
    const prev = planningSummary(data, settings, 'month', prevKey, today);
    const now = profitLines(cc, s.sales, 'now', `Recorded realized profit in ${L}`);
    const before = profitLines(cc, prev.sales, 'before', `Recorded realized profit in ${prev.period.label}`);
    const tax = percentLines[0];
    const p = tax.category.percent!;
    const changed = data.planning.audit.filter((a) => a.kind === 'percent' && a.at.slice(0, 10) >= prev.period.start);
    return {
      intent,
      text: `At your ${percentText(p)} setting for ${tax.category.name}, the suggested reserve is ${money(fromCents(reserveCents(now.cents, p)))} for ${L}${toDate} (${percentText(p)} of ${money(fromCents(now.cents))}), against ${money(fromCents(reserveCents(before.cents, p)))} for ${prev.period.label} (${percentText(p)} of ${money(fromCents(before.cents))}). It follows your recorded profit.`,
      details: [...changed.map((a) => `You changed a percentage on ${formatDate(a.at.slice(0, 10))}: ${a.detail}. Both months are shown at today’s setting.`), caveat],
      calculation: {
        metric: 'profit_change_for_reserve',
        title: `Recorded profit behind the reserve: ${prev.period.label} and ${L}`,
        value: null,
        period: { start: prev.period.start, end: s.period.end, label: `${prev.period.label} and ${L}` },
        asOf: today,
        formula: `Suggested reserve = recorded realized profit (if positive) × ${percentText(p)} (your setting), rounded to the cent.`,
        lines: [{ ...before.line, op: 'info' }, { ...now.line, op: 'info' }],
        records: [...before.records, ...now.records],
        warnings: [],
        basis: 'recorded',
      },
      followUps: ['How much profit remains after my planned reserves?'],
    };
  }

  // Suggested reserve / remaining / profit after reserves: profit re-added from sales.
  const pr = profitLines(cc, s.sales, 'profit', `Recorded realized profit, ${L}`);
  if (intent === 'reserve-suggested' || intent === 'after-reserves') {
    const lines: CalcLine[] = [pr.line, ...percentLines.map((l, i): CalcLine => ({ key: `r${i}`, label: `${l.category.name}: ${l.category.percent === null ? '' : percentText(l.category.percent)} (your setting)`, amount: l.target!, op: '-', fromRecords: false, note: l.calculation }))];
    const after = pr.cents - percentLines.reduce((c, l) => c + toCents(l.target!), 0);
    lines.push({ key: 'after', label: 'Profit remaining after planned reserves', amount: fromCents(Math.abs(after)), op: '=', fromRecords: false, negative: after < 0 });
    const calc: Calculation = { metric: 'planned_reserves', title: `Planned reserves: ${L}`, value: fromCents(after), period: { start: s.period.start, end: s.period.end, label: L }, asOf: today, formula: 'Suggested reserve = recorded realized profit (if positive) × your percentage. Profit remaining = recorded realized profit − suggested reserves.', lines, records: pr.records, warnings: s.warnings, basis: 'estimate' };
    const tax = s.tax;
    return {
      intent,
      text:
        intent === 'reserve-suggested'
          ? tax && tax.category.mode === 'percent'
            ? pr.cents > 0
              ? `At the ${percentText(tax.category.percent!)} you chose, consider setting aside ${money(tax.target!)} for ${L}${toDate}: ${tax.calculation}.`
              : `No profit is recorded for ${L}${toDate} (${money(fromCents(pr.cents))}), so your ${percentText(tax.category.percent!)} setting suggests ${money(0)}. A loss doesn’t create a negative reserve, and you may still have obligations.`
            : `Your planned reserves for ${L}${toDate} come to ${money(s.suggestedTotal)}.`
          : `After your planned reserves (${money(s.suggestedTotal)}), ${money(fromCents(after))} of recorded profit remains for ${L}${toDate}.`,
      details: [...percentLines.filter((l) => l !== tax).map((l) => `${l.category.name}: ${l.calculation}.`), caveat, ...s.warnings.slice(0, 3)],
      calculation: calc,
      followUps: ['How much have I set aside?', 'What financial obligations are coming up?'],
    };
  }

  // reserve-remaining
  if (!s.lines.length) return { intent, text: noPlan, details: [], followUps: [] };
  const targetCents = s.lines.reduce((c, l) => c + toCents(l.category.mode === 'percent' ? l.target! : l.target ?? 0), 0);
  const credited = s.lines.reduce((c, l) => c + toCents(l.category.mode === 'percent' ? l.setAsideInPeriod : l.balance), 0);
  return {
    intent,
    text: s.remainingTarget ? `You have ${money(s.remainingTarget)} left to set aside toward your targets for ${L}${toDate}: ${s.lines.filter((l) => l.remaining).map((l) => `${l.category.name} ${money(l.remaining)}`).join(', ')}.` : `You’ve met your reserve targets for ${L}${toDate}.`,
    details: [...s.lines.map((l) => `${l.category.name}: target ${money(l.target ?? 0)} (${l.calculation}); recorded ${money(l.category.mode === 'percent' ? l.setAsideInPeriod : l.balance)}${l.ahead ? `, ${money(l.ahead)} ahead` : ''}.`), caveat],
    calculation: {
      metric: 'reserve_remaining',
      title: `Reserve targets: ${L}`,
      value: s.remainingTarget,
      period: { start: s.period.start, end: s.period.end, label: L },
      asOf: today,
      formula: 'Percentage reserves: target for the period − what you recorded in the period. Goals: goal − what you recorded so far. Only shortfalls count toward the remaining figure.',
      lines: [
        { key: 'targets', label: 'Targets (your percentages and goals)', amount: fromCents(targetCents), op: 'info', fromRecords: false },
        { key: 'recorded', label: 'Recorded as set aside toward them', amount: fromCents(credited), op: 'info', fromRecords: false },
        { key: 'remaining', label: 'Left to set aside', amount: s.remainingTarget, op: 'info', fromRecords: false },
      ],
      records: [],
      warnings: [],
      basis: 'estimate',
    },
    followUps: ['How much profit should I consider reserving?'],
  };
}
