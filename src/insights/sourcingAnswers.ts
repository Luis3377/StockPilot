// Assistant answers about sourcing: where the profit comes from, profit per logged hour, money
// tied up by source, and the best trips. Figures come from the sourcing engine (which reuses the
// sales and lot accounting); answers carry calculations the app re-checks. Recommendations are
// stated as past results, never as predictions.

import type { AppData, Settings, SourceType } from '../domain/types';
import type { DateRange } from '../domain/dates';
import { formatDate, inRange } from '../domain/dates';
import { plural } from '../domain/format';
import { formatMoney, fromCents, toCents } from '../domain/money';
import { itemCostValue } from '../domain/calc';
import { SOURCE_TYPE_LABELS } from '../domain/sourcing';
import { calcContext, profitCalculation, type CalcContext, type CalcLine, type Calculation, type SourceRecord } from './calculations';
import { computeSale, itemSource, sessionStats, smallSample, sourcingReport, type SessionStats, type SourceStats } from './sourcing';

export interface SourcingAnswer {
  intent: string;
  text: string;
  details: string[];
  calculation?: Calculation;
  followUps: string[];
}

const SOURCING_WORDS = /\b(sources?|sourcing|suppliers?|thrift( stores?)?|goodwill|salvation army|garage sales?|yard sales?|estate sales?|liquidat\w*|pallets?|storage units?|auctions?|wholesalers?)\b/;

const TYPE_WORDS: [RegExp, SourceType][] = [
  [/thrift|goodwill|salvation army/, 'thrift'],
  [/garage|yard sale/, 'garage_sale'],
  [/estate sale/, 'estate_sale'],
  [/facebook|marketplace|craigslist|offerup/, 'online_marketplace'],
  [/liquidat|pallet/, 'liquidation'],
  [/storage unit/, 'storage_auction'],
  [/wholesal/, 'wholesale'],
  [/auction/, 'auction'],
  [/retail/, 'retail'],
];

export function sourcingIntent(q: string): 'source-recommend' | 'source-trips' | 'source-tied-up' | 'profit-per-hour' | 'source-profit' | null {
  // Where to sell (platforms) is a different question.
  if (/\bwhere (should|do|did|can) i sell\b|\b(platforms?|which site)\b/.test(q)) return null;
  if (/\bwhere (should|could|can) i\b.*\b(sourc|buy|shop|look)|\bsource more\b|\bbuy more\b.*\bwhere\b/.test(q)) return 'source-recommend';
  if (/\b(sourcing )?trips?\b|\bsourcing sessions?\b|\bouting/.test(q)) return 'source-trips';
  if (SOURCING_WORDS.test(q) && /\b(tied up|tied-up|unsold|inventory money|money in stock)\b/.test(q)) return 'source-tied-up';
  if (/\b(per hour|hourly|an hour|for my time|my time worth)\b/.test(q)) return 'profit-per-hour';
  if (/\bwhere (do|did|have) i (make|made|earn|earned|get)\b|\bwhere i (make|made|earn)\b/.test(q) || (SOURCING_WORDS.test(q) && /\b(money|profit|profitable|earn|make|best|margins?)\b/.test(q))) return 'source-profit';
  return null;
}

export function sourcingAnswer(q: string, data: AppData, settings: Settings, today: string, range: DateRange): SourcingAnswer | null {
  const intent = sourcingIntent(q);
  if (!intent) return null;
  const money = (n: number) => formatMoney(n, settings.currency);
  const cc = calcContext(data, settings, today);
  const report = sourcingReport(data, settings, { range, today });
  const type = TYPE_WORDS.find(([re]) => re.test(q))?.[1] ?? null;
  const pool = report.sources.filter((s) => !type || s.ref.type === type);
  const where = type ? ` among your ${SOURCE_TYPE_LABELS[type].toLowerCase()} sources` : '';
  const sold = pool.filter((s) => s.sales.length);
  const sample = (s: SourceStats) => (smallSample(s.unitsSold) ? ` Only ${plural(s.unitsSold, 'unit')} sold, so this may not represent what it will do next.` : '');
  const sourceCalc = (s: SourceStats) => profitCalculation(cc, s.sales, range, `from ${s.ref.name}`);

  if (intent === 'source-profit' || intent === 'source-recommend') {
    if (!sold.length) {
      return {
        intent,
        text: type ? `None of your ${SOURCE_TYPE_LABELS[type].toLowerCase()} sources has a recorded sale ${range.label}.` : `You have no sales with a recorded source ${range.label}, so there’s no source to compare yet.`,
        details: ['Record “Where you bought it” when adding items and lots; profit counts once they sell.'],
        followUps: [],
      };
    }
    if (intent === 'source-recommend') {
      // Observed results only: profit per logged hour where time exists, otherwise ROI.
      const timed = sold.filter((s) => s.profitPerHour !== null);
      const ranked = timed.length ? [...timed].sort((a, b) => b.profitPerHour! - a.profitPerHour!) : [...sold].sort((a, b) => (b.roiPct ?? -Infinity) - (a.roiPct ?? -Infinity));
      const top = ranked[0];
      const metric = timed.length ? `${money(top.profitPerHour!)} realized profit per logged hour` : `a ${top.roiPct}% return on the cost of what sold`;
      return {
        intent,
        text: `Based on what has already sold (a record of the past, not a prediction), ${top.ref.name} has done best${where}: ${metric}, from ${plural(top.unitsSold, 'unit')} sold.${sample(top)}`,
        details: [
          ...ranked.slice(1, 4).map((s) => `${s.ref.name}: ${timed.length ? `${money(s.profitPerHour!)}/h` : `${s.roiPct ?? '—'}% ROI`}, ${plural(s.unitsSold, 'unit')} sold${s.stillSelling ? ', still selling' : ''}.`),
          top.stillSelling ? `${top.ref.name} still has ${money(top.inventoryCost)} of stock unsold; its result isn’t final.` : '',
          timed.length ? '' : 'No time is logged per source yet, so this compares return on cost instead of time.',
          'Estimated resale values aren’t counted: only completed sales. Past results don’t guarantee future ones.',
        ].filter(Boolean),
        calculation: sourceCalc(top),
        followUps: ['What is my profit per hour?', 'How much inventory money is tied up at each source?'],
      };
    }
    const top = [...sold].sort((a, b) => b.realizedProfit - a.realizedProfit)[0];
    return {
      intent,
      text: `${top.ref.name} has made you the most${where} ${range.label}: ${money(top.realizedProfit)} realized profit from ${plural(top.unitsSold, 'unit')} sold (${top.marginPct ?? '—'}% margin; ${top.roiPct ?? '—'}% return on the cost of what sold).${sample(top)}`,
      details: [
        ...[...sold].sort((a, b) => b.realizedProfit - a.realizedProfit).slice(1, 4).map((s) => `${s.ref.name}: ${money(s.realizedProfit)} from ${plural(s.unitsSold, 'unit')}${smallSample(s.unitsSold) ? ' (small sample)' : ''}.`),
        top.inventoryCost > 0 ? `${money(top.inventoryCost)} of ${top.ref.name}’s stock is still unsold, so more may come.` : '',
        'Realized profit from completed sales only. High estimated resale values don’t count until they sell.',
      ].filter(Boolean),
      calculation: sourceCalc(top),
      followUps: ['Which category gives me the best return for my time?', 'Where should I consider sourcing more inventory?'],
    };
  }

  if (intent === 'profit-per-hour') {
    if (/categor/.test(q)) {
      const cats = report.categories.filter((c) => c.profitPerHour !== null).sort((a, b) => b.profitPerHour! - a.profitPerHour!);
      if (!cats.length) {
        return { intent, text: 'Not enough time data: no logged time is linked to items or lots, so time can’t be counted by category.', details: ['Link time entries to the items or lots you worked on (Insights → Sourcing Performance → Time log).'], followUps: [] };
      }
      const c = cats[0];
      return {
        intent,
        text: `${c.label} gives you the most realized profit per logged hour ${range.label}: ${money(c.profitPerHour!)} (${money(c.realizedProfit)} ÷ ${c.hours} h).${smallSample(c.unitsSold) ? ` Only ${plural(c.unitsSold, 'unit')} sold, so treat it with care.` : ''}`,
        details: [...cats.slice(1, 4).map((x) => `${x.label}: ${money(x.profitPerHour!)} per hour (${money(x.realizedProfit)} ÷ ${x.hours} h).`), 'Only time linked to items or lots counts toward a category.', 'Your time isn’t subtracted from profit; this isn’t an hourly wage.'],
        calculation: profitCalculation(cc, data.sales.filter((x) => (x.itemCategory.trim() || 'Uncategorized').toLowerCase() === c.key && inRange(x.saleDate, range)), range, `from ${c.label}`),
        followUps: ['Where do I make the most money?'],
      };
    }
    const t = report.totals;
    const sales = data.sales.filter((x) => inRange(x.saleDate, range));
    if (!report.hasTime) {
      return { intent, text: `Not enough time data: you haven’t logged any time ${range.label}.`, details: ['Log time in Insights → Sourcing Performance → Time log (manually, or with the timer).', `Realized profit ${range.label}: ${money(t.netProfit)}.`], calculation: sales.length ? profitCalculation(cc, sales, range) : undefined, followUps: [] };
    }
    const bySource = report.sources.filter((s) => s.profitPerHour !== null).sort((a, b) => b.profitPerHour! - a.profitPerHour!);
    return {
      intent,
      text: `Your realized profit per logged hour ${range.label} is ${money(t.profitPerHour!)}: ${money(t.netProfit)} realized profit ÷ ${t.hours} h logged.`,
      details: [
        report.missingActivities.length ? `Incomplete: no ${report.missingActivities.join(', ')} time logged, so this is overstated.` : '',
        ...bySource.slice(0, 3).map((s) => `${s.ref.name}: ${money(s.profitPerHour!)} per hour (${money(s.realizedProfit)} ÷ ${s.hours} h)${s.stillSelling ? ', still selling' : ''}.`),
        'This is realized profit per hour you logged, not an hourly wage: your time isn’t subtracted from profit, and unsold stock isn’t counted.',
      ].filter(Boolean),
      calculation: sales.length ? profitCalculation(cc, sales, range) : undefined,
      followUps: ['Which category gives me the best return for my time?', 'Where do I make the most money?'],
    };
  }

  if (intent === 'source-tied-up') {
    const tied = report.sources.filter((s) => s.inventoryCost > 0).sort((a, b) => b.inventoryCost - a.inventoryCost);
    if (!tied.length) return { intent, text: 'Nothing is in stock, so no money is tied up in unsold inventory.', details: [], followUps: [] };
    const keys = new Map(tied.map((s, i) => [s.ref.key, `s${i}`]));
    const total = tied.reduce((c, s) => c + toCents(s.inventoryCost), 0);
    const lines: CalcLine[] = [
      ...tied.map((s, i): CalcLine => ({ key: `s${i}`, label: s.ref.name, amount: s.inventoryCost, op: '+', fromRecords: true, term: 'inventoryCost' })),
      { key: 'total', label: 'Inventory cost in stock', amount: fromCents(total), op: '=', fromRecords: false, term: 'inventoryCost' },
    ];
    const records: SourceRecord[] = data.items
      .filter((i) => i.quantity > 0 && keys.has(itemSource(data, i).key))
      .map((i) => {
        const ref = itemSource(data, i);
        return { kind: 'item' as const, id: i.id, label: i.name, detail: `${i.quantity} on hand · ${ref.name}`, links: [{ label: i.name, href: `/inventory/${i.id}` }], parts: { [keys.get(ref.key)!]: itemCostValue(i) } };
      });
    const top = tied[0];
    return {
      intent: 'source-tied-up',
      text: `${money(fromCents(total))} of inventory cost is tied up in unsold stock across ${plural(tied.length, 'source')}. The most is from ${top.ref.name}: ${money(top.inventoryCost)} (${plural(top.unitsRemaining, 'unit')}${top.avgDaysInStock !== null ? `, ${top.avgDaysInStock} days in stock on average` : ''}).`,
      details: [...tied.slice(1, 4).map((s) => `${s.ref.name}: ${money(s.inventoryCost)} (${plural(s.unitsRemaining, 'unit')}).`), 'This is what the unsold items cost you, not what they might sell for.'],
      calculation: { metric: 'inventory_by_source', title: 'Inventory cost by source', value: fromCents(total), period: null, asOf: today, formula: 'Inventory cost = cost per item × quantity on hand, grouped by where each item (or its bulk lot) was bought.', lines, records, warnings: [], basis: 'recorded' },
      followUps: ['Where do I make the most money?'],
    };
  }

  // Trips
  const stats = data.sourcing.sessions.map((s) => sessionStats(data, s));
  if (!stats.length) return { intent, text: 'You haven’t recorded any sourcing trips yet.', details: ['Add one in Insights → Sourcing Performance → Trips, and link what you bought on it.'], followUps: [] };
  const done = stats.filter((s) => s.completed && s.roiPct !== null).sort((a, b) => b.roiPct! - a.roiPct! || b.result - a.result);
  if (!done.length) {
    const sofar = [...stats].sort((a, b) => b.realizedProfit - a.realizedProfit)[0];
    return {
      intent,
      text: `${stats.length === 1 ? 'Your trip isn’t' : `None of your ${stats.length} trips is`} completed yet (something bought on ${stats.length === 1 ? 'it' : 'each'} is still in stock, or nothing is linked), so no trip’s result is final. So far, ${sofar.session.name} has the most realized profit: ${money(sofar.realizedProfit)}.`,
      details: stats.slice(0, 4).map((s) => `${s.session.name} (${formatDate(s.session.date)}): realized ${money(s.realizedProfit)}, ${money(s.inventoryCost)} still in stock.`),
      calculation: sofar.sales.length ? profitCalculation(cc, sofar.sales, { start: null, end: today, label: 'all time' }, `from ${sofar.session.name}`) : undefined,
      followUps: [],
    };
  }
  const best = done[0];
  const open = stats.length - done.length;
  return {
    intent,
    text: `Your most successful completed trip was ${best.session.name} (${formatDate(best.session.date)}): ${money(best.result)} after what you paid and ${money(best.tripExpenses)} of trip expenses, a ${best.roiPct}% return.${best.unitsSold < 5 ? ` It rests on ${plural(best.unitsSold, 'unit')} sold.` : ''}`,
    details: [
      ...done.slice(1, 4).map((s) => `${s.session.name}: ${money(s.result)}, a ${s.roiPct}% return.`),
      best.hours ? `${best.session.name} took ${best.hours} h logged: ${money(best.profitPerHour!)} realized profit per hour.` : `No time is logged for ${best.session.name}.`,
      open ? `${plural(open, 'trip')} still ${open === 1 ? 'has' : 'have'} stock to sell and ${open === 1 ? 'isn’t' : 'aren’t'} ranked yet.` : '',
      'Return = trip result ÷ (what was bought + trip expenses). Only completed trips are ranked.',
    ].filter(Boolean),
    calculation: tripCalculation(cc, best, today),
    followUps: ['What is my profit per hour?'],
  };
}

/** A completed trip's result: net proceeds − what was bought − trip expenses, from its sales and purchases. */
function tripCalculation(cc: CalcContext, st: SessionStats, today: string): Calculation {
  const money = (n: number) => formatMoney(n, cc.settings.currency);
  const sales = [...st.sales].sort((a, b) => a.saleDate.localeCompare(b.saleDate));
  const records: SourceRecord[] = [
    ...st.purchases.map((p): SourceRecord => ({
      kind: p.kind,
      id: p.id,
      label: p.kind === 'lot' ? `Lot: ${p.name}` : p.name,
      detail: `${formatDate(p.date)} · ${plural(p.units, 'unit')} · ${p.ref.name}`,
      date: p.date,
      links: [{ label: p.name, href: p.kind === 'lot' ? `/inventory/lots/${p.id}` : `/inventory/${p.id}` }],
      parts: { bought: p.cost },
    })),
    ...sales.map((x): SourceRecord => {
      const f = computeSale(x);
      return { kind: 'sale', id: x.id, label: `${x.itemName}${x.quantity > 1 ? ` × ${x.quantity}` : ''}`, detail: `${formatDate(x.saleDate)} · ${money(f.revenue)} − ${money(f.totalExpenses)} selling expenses`, date: x.saleDate, links: [{ label: x.itemName, href: `/inventory/${x.itemId}` }], parts: { revenue: f.revenue, selling: f.totalExpenses } };
    }),
  ];
  return {
    metric: 'trip_result',
    title: `Trip result: ${st.session.name}`,
    value: st.result,
    period: null,
    asOf: today,
    formula: 'Trip result = sales revenue − selling expenses − what was bought on the trip − trip expenses. Return = trip result ÷ (what was bought + trip expenses).',
    lines: [
      { key: 'revenue', label: 'Sales revenue', amount: st.revenue, op: '+', fromRecords: true },
      { key: 'selling', label: 'Selling expenses (fees, shipping, other)', amount: st.sellingExpenses, op: '-', fromRecords: true },
      { key: 'bought', label: 'What was bought on the trip', amount: st.acquisitionCost, op: '-', fromRecords: true },
      { key: 'trip', label: 'Trip expenses', amount: st.tripExpenses, op: '-', fromRecords: false, note: st.session.expenses.map((e) => `${e.label || 'Expense'} ${money(e.amount)}`).join(', ') || undefined },
      { key: 'result', label: 'Trip result', amount: Math.abs(st.result), op: '=', fromRecords: false, negative: st.result < 0 },
    ],
    records,
    warnings: [],
    basis: 'recorded',
  };
}
