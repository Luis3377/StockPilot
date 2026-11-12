// Assistant answers about a month: how it went, why profit changed, which expenses rose, what
// to review before closing, which products hurt profit, whether payouts are reconciled, and
// what inventory difference is unexplained. Figures come from the monthly close engine; every
// amount comes with a calculation the app re-adds from its records.

import type { AppData, Sale, Settings } from '../domain/types';
import type { DateRange } from '../domain/dates';
import { computeSale } from '../domain/calc';
import { formatMoney, fromCents, toCents } from '../domain/money';
import { plural } from '../domain/format';
import { calcContext, payoutCalculation, profitCalculation, saleRecord, type CalcContext, type CalcLine, type Calculation, type SourceRecord } from './calculations';
import { closeChecklist } from './closeChecklist';
import { controllerReport } from './controllerReport';
import { currentClose, monthEnded, monthFigures, monthLabel, monthOf, monthRange, shiftMonth, type RollForward } from './monthly';

export type MonthIntent = 'month-performance' | 'month-changes' | 'month-expenses' | 'close-review' | 'products-hurt' | 'payouts-reconciled' | 'inventory-unexplained';

export interface MonthAnswer {
  intent: MonthIntent;
  text: string;
  details: string[];
  calculation?: Calculation;
  items?: { id: string; name: string }[];
  followUps: string[];
}

export function monthIntent(q: string): MonthIntent | null {
  if (/\bare (my |the )?payouts? reconciled\b|\bpayouts? (are |been )?reconciled\b|\breconciled (my |the )?payouts?\b/.test(q)) return 'payouts-reconciled';
  if (/\bunexplained\b|\broll-?forward\b|\binventory differences?\b|\bdifferences? (in|on) (my )?inventory\b/.test(q)) return 'inventory-unexplained';
  if (/\bbefore (i |we )?clos(e|ing)\b|\bclosing checklist\b|\bready to close\b|\b(close|closing) (the|my|this|last) month\b/.test(q)) return 'close-review';
  if (/\b(products?|items?|categor(y|ies)|what)\b.*\bhurt(s|ing)?\b|\bhurt(s|ing)? my (profit|profitability|margins?)\b/.test(q)) return 'products-hurt';
  if (/\b(which|what) (expenses|costs) (increased|went up|rose|grew|changed)\b|\bexpenses (increase|increased|went up|rose)\b/.test(q)) return 'month-expenses';
  if (/\bwhy did (my )?(realized )?profits? (decline|drop|fall|decrease|go down|shrink|increase|go up|rise|grow|change)\b|\bwhat changed\b|\bcompared (with|to) last month\b|\bmonth over month\b/.test(q)) return 'month-changes';
  if (/\bhow did (my business|my shop|my store|i|we|the business) (do|perform|go)\b|\bhow (was|is) (my|this|last) month\b|\bmonthly (summary|performance|report)\b/.test(q)) return 'month-performance';
  return null;
}

const sum = (xs: number[]) => fromCents(xs.reduce((c, x) => c + toCents(x), 0));

/** Last month's realized profit + each change = this month's, re-added from both months' sales. */
export function changeCalculation(ctx: CalcContext, month: string, cur: Sale[], prev: Sale[]): Calculation {
  const P = monthLabel(shiftMonth(month, -1));
  const parts = (s: Sale, sign: 1 | -1): Record<string, number> => {
    const f = computeSale(s);
    return sign === 1
      ? { revenue: f.revenue, cogs: -f.costOfGoods, fees: -f.fees, shipping: -f.shipping, other: -f.otherExpenses, total: f.netProfit }
      : { prev: f.netProfit, revenue: -f.revenue, cogs: f.costOfGoods, fees: f.fees, shipping: f.shipping, other: f.otherExpenses };
  };
  const records: SourceRecord[] = [
    ...prev.map((s) => ({ ...saleRecord(ctx, s), parts: parts(s, -1) })),
    ...cur.map((s) => ({ ...saleRecord(ctx, s), parts: parts(s, 1) })),
  ];
  const total = (key: string) => sum(records.map((r) => r.parts[key] ?? 0));
  const signedLine = (key: string, label: string): CalcLine => {
    const v = total(key);
    return { key, label, amount: Math.abs(v), op: v < 0 ? '-' : '+', fromRecords: true, signedParts: true };
  };
  const now = total('total');
  const r = monthRange(month);
  return {
    metric: 'month_change',
    title: `Change in realized profit: ${P} → ${monthLabel(month)}`,
    value: now,
    period: { start: monthRange(shiftMonth(month, -1)).start, end: r.end, label: `${P} and ${monthLabel(month)}` },
    asOf: ctx.today,
    formula: `${monthLabel(month)} realized profit = ${P} realized profit + change in revenue − change in cost of goods sold − change in fees − change in shipping − change in other selling expenses.`,
    lines: [
      signedLine('prev', `Realized profit in ${P}`),
      signedLine('revenue', 'Change in sales revenue'),
      signedLine('cogs', 'Change in cost of goods sold (lower is better)'),
      signedLine('fees', 'Change in marketplace fees (lower is better)'),
      signedLine('shipping', 'Change in shipping (lower is better)'),
      signedLine('other', 'Change in other selling expenses (lower is better)'),
      { key: 'total', label: `Realized profit in ${monthLabel(month)}`, amount: Math.abs(now), op: '=', fromRecords: true, signedParts: true, negative: now < 0 },
    ],
    records,
    warnings: [],
    basis: 'recorded',
  };
}

/** Beginning inventory + the month's recorded movements = expected ending, beside the item records. */
export function rollForwardCalculation(ctx: CalcContext, rf: RollForward): Calculation {
  const keys = new Map(rf.lines.map((l, i) => [l.key, `m${i}`]));
  const records: SourceRecord[] = rf.lines.flatMap((l) =>
    l.records.map((r) => ({ kind: r.kind === 'adjustment' ? ('item' as const) : r.kind, id: `${l.key}:${r.id}`, label: r.label, detail: `${l.label} · ${r.detail}`, date: r.date, links: [{ label: r.label, href: r.href }], parts: { [keys.get(l.key)!]: r.amount } })),
  );
  const lines: CalcLine[] = [
    { key: 'beginning', label: 'Beginning inventory cost', amount: Math.abs(rf.beginning ?? 0), op: (rf.beginning ?? 0) < 0 ? '-' : '+', fromRecords: false, note: rf.beginningBasis },
    ...rf.lines.filter((l) => l.amount !== 0).map((l): CalcLine => ({ key: keys.get(l.key)!, label: l.label, amount: Math.abs(l.amount), op: l.amount < 0 ? '-' : '+', fromRecords: true, signedParts: true })),
    { key: 'expected', label: 'Expected ending inventory cost', amount: Math.abs(rf.expectedEnding ?? 0), op: '=', fromRecords: false, negative: (rf.expectedEnding ?? 0) < 0 },
    { key: 'records', label: 'Ending inventory cost from the item records', amount: Math.abs(rf.recordsEnding ?? 0), op: 'info', fromRecords: false, note: rf.recordsBasis },
    { key: 'difference', label: 'Unexplained difference', amount: Math.abs(rf.difference ?? 0), op: 'info', fromRecords: false, negative: (rf.difference ?? 0) < 0 },
  ];
  return {
    metric: 'inventory_roll_forward',
    title: `Inventory roll-forward: ${monthLabel(rf.month)}`,
    value: rf.expectedEnding,
    period: { ...monthRange(rf.month), label: monthLabel(rf.month) },
    asOf: ctx.today,
    formula: 'Expected ending inventory cost = beginning inventory cost + purchases ± cost corrections − cost of goods sold − write-offs + units found − items deleted ± sale corrections. The difference is the item records minus that.',
    lines,
    records,
    warnings: rf.notes,
    basis: 'recorded',
  };
}

function pickMonth(intent: MonthIntent, range: DateRange | null, data: AppData, today: string): string {
  if (range?.start && range.end && monthOf(range.start) === monthOf(range.end)) return monthOf(range.start);
  if (intent === 'close-review') {
    // The latest month that has ended and isn't closed.
    for (let m = shiftMonth(monthOf(today), -1), n = 0; n < 24; m = shiftMonth(m, -1), n++) if (!currentClose(data, m)) return m;
    return shiftMonth(monthOf(today), -1);
  }
  return monthOf(today);
}

export function monthAnswer(q: string, data: AppData, settings: Settings, today: string, range: DateRange | null): MonthAnswer | null {
  const intent = monthIntent(q);
  if (!intent) return null;
  const money = (n: number) => formatMoney(n, settings.currency);
  const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${money(Math.abs(n))}`;
  const cc = calcContext(data, settings, today);
  const month = pickMonth(intent, range, data, today);
  const L = monthLabel(month);
  const P = monthLabel(shiftMonth(month, -1));
  const toDate = monthEnded(month, today) ? '' : ' (to date)';
  const cur = monthFigures(data, settings, month, today);
  const pri = monthFigures(data, settings, shiftMonth(month, -1), today);
  const c = cur.totals;
  const p = pri.totals;
  const d = fromCents(toCents(c.netProfit) - toCents(p.netProfit));

  if (intent === 'month-performance') {
    if (!c.salesCount) return { intent, text: `You have no sales recorded in ${L}${toDate}, so realized profit is ${money(0)}.`, details: [`${P}: ${money(p.netProfit)} realized profit from ${plural(p.salesCount, 'sale')}.`], followUps: ['What should I review before closing?'] };
    return {
      intent,
      text: `In ${L}${toDate} you made ${money(c.netProfit)} realized profit on ${money(c.revenue)} of sales (${plural(c.salesCount, 'sale')}, ${cur.marginPct ?? '—'}% margin). That’s ${d === 0 ? 'the same as' : `${signed(d)} compared with`} ${P} (${money(p.netProfit)}).`,
      details: [
        `Gross profit ${money(cur.grossProfit)} (revenue − cost of goods sold), then fees ${money(c.fees)}, shipping ${money(c.shipping)} and other expenses ${money(c.otherExpenses)}.`,
        `Inventory: ${cur.rollForward.statusText}.`,
        cur.noCostSales.length ? `${plural(cur.noCostSales.length, 'sale')} ${cur.noCostSales.length === 1 ? 'has' : 'have'} no recorded cost, so profit may be overstated.` : '',
        'From your recorded sales; payouts are transfers of money, not extra revenue.',
      ].filter(Boolean),
      calculation: profitCalculation(cc, cur.sales, cur.range, ''),
      followUps: ['Why did my profit decline?', 'Which expenses increased?'],
    };
  }

  if (intent === 'month-changes' || intent === 'month-expenses') {
    if (!c.salesCount && !p.salesCount) return { intent, text: `There were no sales in ${L} or ${P}, so there’s nothing to compare.`, details: [], followUps: [] };
    const report = controllerReport(data, settings, month, today);
    const calc = changeCalculation(cc, month, cur.sales, pri.sales);
    const changes = report.sections.find((s) => s.key === 'changes')!.lines;
    if (intent === 'month-expenses') {
      const rows = [
        ['Cost of goods sold', c.costOfGoods, p.costOfGoods],
        ['Marketplace fees', c.fees, p.fees],
        ['Shipping', c.shipping, p.shipping],
        ['Other selling expenses', c.otherExpenses, p.otherExpenses],
      ] as const;
      const up = rows.filter(([, a, b]) => toCents(a) > toCents(b));
      return {
        intent,
        text: up.length ? `Compared with ${P}, these increased in ${L}${toDate}: ${up.map(([l, a, b]) => `${l.toLowerCase()} ${money(b)} → ${money(a)} (${signed(fromCents(toCents(a) - toCents(b)))})`).join('; ')}.` : `None of your recorded expenses increased in ${L}${toDate} compared with ${P}.`,
        details: [
          ...rows.filter(([, a, b]) => toCents(a) <= toCents(b)).map(([l, a, b]) => `${l}: ${money(b)} → ${money(a)}.`),
          c.revenue && p.revenue ? `Relative to revenue, fees were ${Math.round((c.fees / c.revenue) * 1000) / 10}% (${P}: ${Math.round((p.fees / p.revenue) * 1000) / 10}%).` : '',
          'Buying inventory isn’t an expense here: its cost counts as cost of goods sold when it sells.',
        ].filter(Boolean),
        calculation: calc,
        followUps: ['Why did my profit decline?', 'Which products hurt my profitability?'],
      };
    }
    const declined = /\b(decline|drop|fall|decrease|go down|shrink)\b/.test(q);
    return {
      intent,
      text: `${declined && d >= 0 ? `Your profit didn’t decline: ` : ''}Realized profit ${d === 0 ? 'was unchanged' : d > 0 ? `rose by ${money(d)}` : `fell by ${money(-d)}`} in ${L}${toDate} compared with ${P} (${money(p.netProfit)} → ${money(c.netProfit)}). ${changes[0].text.replace(/^Realized profit changed by \S+\. /, '')}`,
      details: changes.slice(1, 6).map((l) => `${l.kind === 'contributing' ? 'Contributing: ' : l.kind === 'possible' ? 'Possible (not proven): ' : ''}${l.text}`),
      calculation: calc,
      followUps: ['Which products hurt my profitability?', 'Which expenses increased?'],
    };
  }

  if (intent === 'products-hurt') {
    const losses = cur.sales.filter((s) => computeSale(s).netProfit < 0);
    const low = cur.sales.filter((s) => {
      const f = computeSale(s);
      return f.netProfit >= 0 && f.revenue > 0 && (f.margin ?? 0) < settings.lowMarginPercent;
    });
    if (!losses.length && !low.length) return { intent, text: `No sale in ${L}${toDate} lost money or fell below your ${settings.lowMarginPercent}% margin threshold.`, details: [], calculation: cur.sales.length ? profitCalculation(cc, cur.sales, cur.range) : undefined, followUps: ['Why did my profit decline?'] };
    const byItem = new Map<string, Sale[]>();
    for (const s of [...losses, ...low]) byItem.set(s.itemName, [...(byItem.get(s.itemName) ?? []), s]);
    const ranked = [...byItem].map(([name, ss]) => ({ name, ss, profit: sum(ss.map((s) => computeSale(s).netProfit)) })).sort((a, b) => a.profit - b.profit);
    return {
      intent,
      text: losses.length ? `In ${L}${toDate}, ${plural(losses.length, 'sale')} lost money: ${money(sum(losses.map((s) => computeSale(s).netProfit)))} in recorded losses, led by ${ranked[0].name} (${money(ranked[0].profit)}).` : `No sale lost money in ${L}${toDate}, but ${plural(low.length, 'sale')} had a margin below ${settings.lowMarginPercent}%.`,
      details: [...ranked.slice(0, 5).map((r) => `${r.name}: ${plural(r.ss.length, 'sale')}, ${money(r.profit)} realized profit.`), 'From recorded sales: revenue − cost of goods sold − fees − shipping − other expenses.'],
      calculation: profitCalculation(cc, losses.length ? losses : low, cur.range, losses.length ? 'from loss-making sales' : 'from low-margin sales'),
      items: [...new Set([...losses, ...low].map((s) => s.itemId))].filter((id) => data.items.some((i) => i.id === id)).map((id) => ({ id, name: data.items.find((i) => i.id === id)!.name })),
      followUps: ['What should I review before closing?'],
    };
  }

  if (intent === 'close-review') {
    const list = closeChecklist(data, settings, month, today);
    if (list.closed) return { intent, text: `${L} is already closed (version ${list.closed.version}, ${new Date(list.closed.closedAt).toLocaleDateString()}). Reopen it in Sales & Profit → Monthly Close to make changes.`, details: [], followUps: [] };
    const open = list.steps.filter((s) => s.state === 'todo' || s.state === 'attention');
    return {
      intent,
      text: open.length ? `Before closing ${L}, ${plural(open.length, 'checklist step')} ${open.length === 1 ? 'is' : 'are'} still open${list.ended ? '' : ` (and the month isn’t over yet)`}.` : list.ended ? `Every checklist step for ${L} is done: you can close the month.` : `Every step is done, but ${L} isn’t over yet.`,
      details: [
        ...open.map((s) => `Step ${s.number}, ${s.title}: ${s.stateText}${s.issues[0] ? `. ${s.issues[0].text}` : ''}`),
        `Figures: ${money(list.figures.totals.netProfit)} realized profit; inventory ${list.figures.rollForward.statusText.toLowerCase()}; payouts: ${list.recon.statusText}`,
      ],
      calculation: profitCalculation(cc, list.figures.sales, list.figures.range),
      followUps: ['Are my payouts reconciled?', 'What inventory differences remain unexplained?'],
    };
  }

  if (intent === 'payouts-reconciled') {
    const recon = closeChecklist(data, settings, month, today).recon;
    const open = recon.openPayouts[0];
    return {
      intent,
      text: `${L}: ${recon.statusText}.`,
      details: [
        ...recon.openPayouts.slice(0, 5).map((po) => `Payout ${po.ref}: ${po.statusReason}`),
        ...recon.unmatchedSales.slice(0, 5).map((u) => `${u.sale.itemName} (${u.sale.saleDate}): ${u.reason}`),
        'Payouts are transfers of money, not revenue: reconciling compares them with your recorded sales.',
      ],
      calculation: open ? payoutCalculation(cc, open) : undefined,
      followUps: recon.status === 'not_performed' ? [] : ['Explain my latest payout'],
    };
  }

  // inventory-unexplained
  const rf = cur.rollForward;
  if (rf.status === 'not_available') return { intent, text: `The inventory roll-forward for ${L} isn’t available: ${rf.statusText}.`, details: rf.notes, followUps: [] };
  return {
    intent,
    text: rf.difference === 0 ? `No unexplained inventory difference in ${L}${toDate}: beginning inventory plus the month’s recorded movements equals the item records (${money(rf.recordsEnding!)})${rf.status === 'partial' ? ', for the part of the month since the inventory ledger began' : ''}.` : `${money(Math.abs(rf.difference!))} of inventory cost remains unexplained in ${L}${toDate}: the item records show ${money(rf.recordsEnding!)}, while beginning inventory plus recorded movements gives ${money(rf.expectedEnding!)}.`,
    details: [`Beginning: ${rf.beginningBasis}.`, ...rf.notes],
    calculation: rollForwardCalculation(cc, rf),
    followUps: ['What should I review before closing?'],
  };
}
