// StockPilot Insights assistant.
//
// Today every answer comes from the RuleBasedProvider below: fixed rules that read the user's
// recorded data — no AI model is involved, and the UI labels answers accordingly. A future
// AI provider can implement the same InsightsProvider interface (see docs/AI_INTEGRATION.md);
// it must run behind a server so API keys never reach the browser.

import {
  daysWithoutSale,
  inventoryTotals,
  itemCostValue,
  projectUnsold,
  salesByCategory,
  salesByItem,
  salesByPlatform,
  salesInRange,
  sellingCostRate,
  totalSales,
  uniqueSorted,
  type GroupTotals,
} from '../domain/calc';
import { addDays, formatDate, periodRange, todayISO, type DateRange } from '../domain/dates';
import { formatMoney, formatPercent, roundMoney } from '../domain/money';
import type { AppData, Item, Settings } from '../domain/types';
import { buildInsights } from './rules';

export interface AnswerTable {
  columns: string[];
  rows: string[][];
}

export interface AssistantAnswer {
  source: 'rules' | 'ai';
  intent: string;
  text: string;
  details: string[];
  table?: AnswerTable;
  items?: { id: string; name: string }[];
  followUps: string[];
}

export interface InsightsContext {
  data: AppData;
  settings: Settings;
  today?: string;
}

export interface InsightsProvider {
  readonly kind: 'rules' | 'ai';
  readonly label: string;
  ask(question: string, ctx: InsightsContext): Promise<AssistantAnswer>;
}

export const SUGGESTED_QUESTIONS = [
  'How much profit have I made this month?',
  'Which items are making me the most money?',
  'What inventory has been sitting the longest?',
  'How much money do I have invested in unsold inventory?',
  'Which categories are performing best?',
  'What items should I consider discounting?',
  'Which products are running low?',
  'Which platform earns me the most?',
];

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** Pulls a date range out of phrases like "this month", "last 30 days", "in March". */
export function parseTimeframe(q: string, today: string): DateRange | null {
  if (/\btoday\b/.test(q)) return { start: today, end: today, label: 'today' };
  if (/\byesterday\b/.test(q)) {
    const y = addDays(today, -1);
    return { start: y, end: y, label: 'yesterday' };
  }
  const lastN = /\b(?:last|past|previous)\s+(\d{1,4})\s+(day|week|month)s?\b/.exec(q);
  if (lastN) {
    const n = Number(lastN[1]);
    const days = lastN[2] === 'day' ? n : lastN[2] === 'week' ? n * 7 : n * 30;
    return { start: addDays(today, -(days - 1)), end: today, label: `in the last ${n} ${lastN[2]}${n === 1 ? '' : 's'}` };
  }
  if (/\bthis week\b/.test(q)) {
    const d = new Date(`${today}T00:00:00`);
    const monday = addDays(today, -((d.getDay() + 6) % 7));
    return { start: monday, end: today, label: 'this week' };
  }
  if (/\blast week\b/.test(q)) return { start: addDays(today, -13), end: addDays(today, -7), label: 'last week' };
  if (/\b(this|current) month\b|\bmonth to date\b/.test(q)) return periodRange('this_month', today);
  if (/\b(last|previous) month\b/.test(q)) return periodRange('last_month', today);
  if (/\b(this|current) year\b|\bytd\b|\byear to date\b/.test(q)) return periodRange('this_year', today);
  if (/\b(last|previous) year\b/.test(q)) return periodRange('last_year', today);
  if (/\b(all time|ever|overall|in total|so far|total)\b/.test(q)) return periodRange('all', today);
  const month = MONTHS.findIndex((m) => new RegExp(`\\b(${m}|${m.slice(0, 3)})\\b`).test(q));
  if (month >= 0 && !/\bmay i\b/.test(q)) {
    let year = Number(today.slice(0, 4));
    if (month + 1 > Number(today.slice(5, 7))) year -= 1;
    const mm = String(month + 1).padStart(2, '0');
    const last = new Date(year, month + 1, 0).getDate();
    return { start: `${year}-${mm}-01`, end: `${year}-${mm}-${last}`, label: `in ${MONTHS[month][0].toUpperCase()}${MONTHS[month].slice(1)} ${year}` };
  }
  return null;
}

const STOPWORDS = new Set(
  'a an the my i me of on in for to and or is are was were how much many what which who did do does have has had made make sold sell selling item items about tell show give with from that this it its'.split(' '),
);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Finds the item a question most likely refers to, by SKU or by name words. Words shared by
 * many items ("candle", "size") count for less than distinctive ones ("charizard"), and an
 * ambiguous match (two items scoring the same) returns null rather than guessing.
 */
export function matchItem(q: string, items: Item[]): Item | null {
  const lower = q.toLowerCase();
  const bySku = items.find((i) => i.sku && new RegExp(`(^|[^a-z0-9])${i.sku.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(lower));
  if (bySku) return bySku;
  const qTokens = new Set(tokens(q));
  if (qTokens.size === 0) return null;
  const nameTokens = new Map(items.map((i) => [i.id, [...new Set(tokens(i.name))]]));
  const df = new Map<string, number>();
  for (const list of nameTokens.values()) for (const t of list) df.set(t, (df.get(t) ?? 0) + 1);
  const scored = items
    .map((item) => {
      const hits = nameTokens.get(item.id)!.filter((t) => qTokens.has(t) && t.length >= 3 && /[a-z]/.test(t));
      return { item, score: hits.reduce((s, t) => s + 1 / df.get(t)!, 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length || scored[0].score < 1) return null;
  if (scored[1] && scored[1].score === scored[0].score) return null;
  return scored[0].item;
}

function findMentioned(q: string, values: string[]): string | null {
  const lower = q.toLowerCase();
  return values.find((v) => v.length > 1 && new RegExp(`\\b${v.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) ?? null;
}

class AnswerBuilder {
  constructor(private ctx: Required<InsightsContext>) {}
  money = (n: number) => formatMoney(n, this.ctx.settings.currency);

  answer(intent: string, text: string, extra: Partial<AssistantAnswer> = {}): AssistantAnswer {
    return { source: 'rules', intent, text, details: [], followUps: [], ...extra };
  }

  groupTable(groups: GroupTotals[], firstColumn: string, limit = 8): AnswerTable {
    return {
      columns: [firstColumn, 'Revenue', 'Net profit', 'Margin', 'Units'],
      rows: groups.slice(0, limit).map((g) => [g.label, this.money(g.revenue), this.money(g.netProfit), formatPercent(g.margin), String(g.unitsSold)]),
    };
  }
}

function needSales(b: AnswerBuilder, intent: string): AssistantAnswer {
  return b.answer(intent, "You haven't recorded any sales yet, so there's no profit data to analyse.", {
    details: ['Record a sale from the Sales & Profit screen (or from an item’s page) and ask again.'],
    followUps: ['How much money do I have invested in unsold inventory?'],
  });
}

export function answerQuestion(question: string, input: InsightsContext): AssistantAnswer {
  const ctx: Required<InsightsContext> = { today: todayISO(), ...input };
  const { data, settings, today } = ctx;
  const b = new AnswerBuilder(ctx);
  const q = question.toLowerCase().trim();
  const report = () => buildInsights(data, settings, today);

  if (!q) return b.answer('empty', 'Type a question about your inventory, sales or profit.', { followUps: SUGGESTED_QUESTIONS.slice(0, 4) });

  if (/^(help|\?|what can (you|i) ask|what (can|do) you (do|answer|know))/.test(q)) {
    return b.answer('help', 'I answer questions using fixed rules over your recorded inventory and sales. Here are things I can work out:', {
      details: [
        'Profit, revenue and expenses for a period ("profit last month", "revenue in March", "sales on eBay this year")',
        'Your best and worst items, categories and selling platforms',
        'Slow-moving inventory and what to consider discounting',
        'Low-stock items, money tied up in inventory and estimated values',
        'Inventory discrepancies from Count Check',
        'A summary of any item by name or SKU',
      ],
      followUps: SUGGESTED_QUESTIONS.slice(0, 4),
    });
  }

  if (data.items.length === 0 && data.sales.length === 0) {
    return b.answer('no-data', "There's no inventory recorded yet, so I don't have anything to analyse.", {
      details: ['Add your first item from the Inventory screen, or import a CSV file from Settings.'],
    });
  }

  // --- Low stock -----------------------------------------------------------
  if (/\b(low|running out|run out|restock|reorder|out of stock|running low|need more)\b/.test(q) && !/\bmargin|profit\b/.test(q)) {
    const s = report().lowStock;
    if (s.insufficient) return b.answer('low-stock', s.insufficient);
    if (!s.findings.length) return b.answer('low-stock', s.summary, { details: [s.rule] });
    return b.answer('low-stock', s.summary, {
      details: [s.rule],
      table: {
        columns: ['Item', 'On hand', 'Alert level', 'Location'],
        rows: s.findings.map((f) => [f.item.name, String(f.item.quantity), String(f.item.lowStockThreshold), f.item.location || '—']),
      },
      items: s.findings.map((f) => ({ id: f.item.id, name: f.item.name })),
      followUps: ['What inventory has been sitting the longest?'],
    });
  }

  // --- Discount suggestions -------------------------------------------------
  if (/\b(discount|mark ?down|lower (the |my )?price|reduce (the |my )?price|clearance|price drop|cut (the )?price|overpriced)/.test(q)) {
    const rate = sellingCostRate(data.sales, settings);
    const slowIds = new Set(report().slowMoving.findings.map((f) => f.item.id));
    const candidates = data.items
      .filter((i) => i.quantity > 0 && i.askingPrice !== null)
      .map((item) => ({ item, days: daysWithoutSale(item, data.sales, today), aboveMarket: item.estimatedValue !== null && item.askingPrice! > item.estimatedValue }))
      .filter((c) => slowIds.has(c.item.id) || c.aboveMarket)
      .sort((a, b2) => b2.days - a.days);
    if (!candidates.length) {
      return b.answer('discount', `Nothing stands out for discounting. No priced item has gone ${settings.slowMovingDays}+ days without a sale, and none is priced above its estimated value.`, {
        details: ['Items without an asking price are not checked.'],
      });
    }
    const breakEven = (item: Item) => (rate.percent < 100 ? roundMoney(item.unitCost / (1 - rate.percent / 100)) : null);
    return b.answer('discount', `${candidates.length} ${candidates.length === 1 ? 'item is a candidate' : 'items are candidates'} for a discount. These are suggestions based on your data, not market research — check current prices before changing yours.`, {
      details: [
        `Listed because they haven't sold in ${settings.slowMovingDays}+ days, or their asking price is above your own estimated value.`,
        `"Break-even price" is the lowest price that still covers your cost after ~${formatPercent(rate.percent)} selling costs${rate.source === 'history' ? ' (your historical average)' : rate.source === 'none' ? ' (no fee history yet)' : ' (from Settings)'}.`,
      ],
      table: {
        columns: ['Item', 'Asking', 'Est. value', 'Break-even price', 'Days unsold'],
        rows: candidates.slice(0, 10).map((c) => {
          const be = breakEven(c.item);
          return [c.item.name, b.money(c.item.askingPrice!), c.item.estimatedValue === null ? '—' : b.money(c.item.estimatedValue), be === null ? '—' : b.money(be), String(c.days)];
        }),
      },
      items: candidates.slice(0, 10).map((c) => ({ id: c.item.id, name: c.item.name })),
    });
  }

  // --- Slow-moving / oldest -------------------------------------------------
  if (/\b(longest|sitting|slow|oldest|not sold|haven'?t sold|hasn'?t sold|aging|ageing|stale|dead stock|not moving)\b/.test(q)) {
    const inStock = data.items.filter((i) => i.quantity > 0);
    if (!inStock.length) return b.answer('slow-moving', 'Nothing is in stock right now.');
    const ranked = inStock.map((item) => ({ item, days: daysWithoutSale(item, data.sales, today) })).sort((a, c) => c.days - a.days);
    const slow = ranked.filter((r) => r.days >= settings.slowMovingDays);
    const tied = slow.reduce((s, r) => s + itemCostValue(r.item), 0);
    return b.answer(
      'slow-moving',
      `${ranked[0].item.name} has been sitting the longest — ${ranked[0].days} days without a sale. ${slow.length ? `${slow.length} ${slow.length === 1 ? 'item has' : 'items have'} gone ${settings.slowMovingDays}+ days, holding ${b.money(tied)} at cost.` : `Nothing has passed your ${settings.slowMovingDays}-day slow-moving threshold.`}`,
      {
        details: ['Days are counted from the purchase date or the most recent sale, whichever is later.'],
        table: {
          columns: ['Item', 'Days without sale', 'On hand', 'Cost tied up'],
          rows: ranked.slice(0, 8).map((r) => [r.item.name, String(r.days), String(r.item.quantity), b.money(itemCostValue(r.item))]),
        },
        items: ranked.slice(0, 8).map((r) => ({ id: r.item.id, name: r.item.name })),
        followUps: ['What items should I consider discounting?'],
      },
    );
  }

  // --- Money invested / value ----------------------------------------------
  if (/\b(invested|tied up|unsold|spent on (stock|inventory)|money in|cost of (my )?(inventory|stock))\b/.test(q) || /\b(worth|value|valued)\b/.test(q)) {
    const t = inventoryTotals(data.items);
    const projection = projectUnsold(data.items, data.sales, settings);
    const details = [
      `${t.unitsInStock} units across ${t.itemsInStock} items are in stock.`,
    ];
    if (t.itemsWithEstimate) {
      const gain = t.estimatedValue - t.estimatedCostBasis;
      details.push(`Estimated value: ${b.money(t.estimatedValue)} for the ${t.itemsWithEstimate} items you've valued (${gain >= 0 ? 'up' : 'down'} ${b.money(Math.abs(gain))} vs. what you paid for them).`);
    }
    if (t.itemsMissingEstimate && t.itemsWithEstimate) details.push(`${t.itemsMissingEstimate} items have no estimated value and aren't included in that figure.`);
    if (projection.itemsIncluded) {
      details.push(`Projected (not yet realized): selling the ${projection.itemsIncluded} priced items at asking would bring ${b.money(projection.projectedRevenue)}, or about ${b.money(projection.projectedProfit)} profit after ~${formatPercent(projection.rate.percent)} selling costs.`);
    }
    return b.answer('invested', `You have ${b.money(t.costValue)} invested in unsold inventory (what you paid for everything currently in stock).`, {
      details,
      followUps: ['What inventory has been sitting the longest?', 'Which categories are performing best?'],
    });
  }

  // --- Categories -----------------------------------------------------------
  if (/\bcategor/.test(q)) {
    if (!data.sales.length) {
      const t = uniqueSorted(data.items.map((i) => i.category || 'Uncategorized'));
      return b.answer('categories', `No sales yet, so category performance can't be measured. You have ${t.length} ${t.length === 1 ? 'category' : 'categories'} in stock.`);
    }
    const range = parseTimeframe(q, today) ?? periodRange('all', today);
    const groups = salesByCategory(salesInRange(data.sales, range)).sort((a, c) => c.netProfit - a.netProfit);
    if (!groups.length) return b.answer('categories', `No sales ${range.label}.`);
    const best = groups[0];
    return b.answer('categories', `${best.label} is your best-performing category ${range.label}: ${b.money(best.netProfit)} net profit on ${b.money(best.revenue)} revenue (${formatPercent(best.margin)} margin).`, {
      details: ['Ranked by realized net profit after cost of goods, fees, shipping and other expenses.'],
      table: b.groupTable(groups, 'Category'),
    });
  }

  // --- Platforms ------------------------------------------------------------
  if (/\b(platform|marketplace|which site|where (should|do|did) i sell|best place)\b/.test(q)) {
    if (!data.sales.length) return needSales(b, 'platforms');
    const range = parseTimeframe(q, today) ?? periodRange('all', today);
    const groups = salesByPlatform(salesInRange(data.sales, range)).sort((a, c) => c.netProfit - a.netProfit);
    if (!groups.length) return b.answer('platforms', `No sales ${range.label}.`);
    return b.answer('platforms', `${groups[0].label} earns you the most ${range.label}: ${b.money(groups[0].netProfit)} net profit across ${groups[0].salesCount} ${groups[0].salesCount === 1 ? 'sale' : 'sales'}.`, {
      details: ['Compare margins too: a platform with higher fees can earn less per sale even with more revenue.'],
      table: b.groupTable(groups, 'Platform'),
    });
  }

  // --- Losing money / low margin -------------------------------------------
  if (/\b(losing|lose money|lost money|at a loss|loss|unprofitable|negative|low margin|worst|least profitable)\b/.test(q)) {
    const s = report().lowMarginSales;
    const p = report().pricingRisks;
    if (s.insufficient && p.insufficient) return b.answer('low-margin', s.insufficient);
    const rows = s.findings.map((f) => [f.group.label, b.money(f.group.revenue), b.money(f.group.netProfit), formatPercent(f.group.margin)]);
    return b.answer('low-margin', s.insufficient ?? s.summary, {
      details: [s.rule, p.findings.length ? `Also, ${p.summary.charAt(0).toLowerCase()}${p.summary.slice(1)} See Smart Insights for the list.` : p.summary],
      table: rows.length ? { columns: ['Item', 'Revenue', 'Net profit', 'Margin'], rows: rows.slice(0, 8) } : undefined,
    });
  }

  // --- Top items ------------------------------------------------------------
  if (/\b(most money|most profit|best[- ]sell|top (item|product|seller|earner)s?|most profitable|best (item|product)s?|making me|biggest earner|highest (profit|revenue))\b/.test(q)) {
    if (!data.sales.length) return needSales(b, 'top-items');
    const range = parseTimeframe(q, today) ?? periodRange('all', today);
    const byRevenue = /\brevenue|sales\b/.test(q) && !/\bprofit\b/.test(q);
    const groups = salesByItem(salesInRange(data.sales, range)).sort((a, c) => (byRevenue ? c.revenue - a.revenue : c.netProfit - a.netProfit));
    if (!groups.length) return b.answer('top-items', `No sales ${range.label}.`);
    const top = groups[0];
    return b.answer('top-items', `${top.label} has made you the most ${range.label}: ${b.money(top.netProfit)} net profit from ${b.money(top.revenue)} in sales.`, {
      details: [`Ranked by ${byRevenue ? 'revenue' : 'realized net profit (after cost, fees, shipping and other expenses)'}.`],
      table: b.groupTable(groups, 'Item'),
      items: groups.slice(0, 8).flatMap((g) => (data.items.some((i) => i.id === g.key) ? [{ id: g.key, name: g.label }] : [])),
      followUps: ['Which categories are performing best?'],
    });
  }

  // --- Discrepancies --------------------------------------------------------
  if (/\b(missing|discrepanc|shrink|shrinkage|stolen|theft|mismatch|count check|physical count)\b/.test(q)) {
    const s = report().discrepancies;
    if (s.insufficient) return b.answer('discrepancies', s.insufficient);
    return b.answer('discrepancies', s.summary, {
      details: [s.rule],
      table: s.findings.length
        ? {
            columns: ['Date', 'Item', 'Change', 'Value', 'Reason'],
            rows: s.findings.slice(0, 8).map((f) => [formatDate(f.adjustment.date), f.adjustment.itemName, `${f.adjustment.difference > 0 ? '+' : ''}${f.adjustment.difference}`, b.money(f.adjustment.valueDifference), f.adjustment.reason || '—']),
          }
        : undefined,
    });
  }

  // --- Profit / revenue for a period ---------------------------------------
  const asksMoney = /\b(profit|made|make|earn|earned|earning|revenue|sales|sold|income|net|margin|roi|fees|expenses)\b/.test(q);
  const platform = findMentioned(q, uniqueSorted(data.sales.map((s) => s.platform)));
  const category = findMentioned(q, uniqueSorted(data.sales.map((s) => s.itemCategory)));
  const item = matchItem(q, data.items);

  if (asksMoney && !item) {
    if (!data.sales.length) return needSales(b, 'profit');
    const explicit = parseTimeframe(q, today);
    const range = explicit ?? periodRange('all', today);
    let sales = salesInRange(data.sales, range);
    const scope: string[] = [];
    if (platform) {
      sales = sales.filter((s) => s.platform.toLowerCase() === platform.toLowerCase());
      scope.push(`on ${platform}`);
    }
    if (category) {
      sales = sales.filter((s) => s.itemCategory.toLowerCase() === category.toLowerCase());
      scope.push(`in ${category}`);
    }
    const where = [scope.join(' '), range.label].filter(Boolean).join(' ');
    if (!sales.length) {
      return b.answer('profit', `You have no recorded sales ${where}.`, { followUps: ['How much profit have I made this year?'] });
    }
    const t = totalSales(sales);
    const headline = /\brevenue|sales|sold\b/.test(q) && !/\bprofit|made|make|earn/.test(q)
      ? `Revenue ${where} is ${b.money(t.revenue)} from ${t.salesCount} ${t.salesCount === 1 ? 'sale' : 'sales'} (${t.unitsSold} units).`
      : `You've made ${b.money(t.netProfit)} in net profit ${where}, from ${b.money(t.revenue)} in sales.`;
    return b.answer('profit', headline, {
      details: [
        `Revenue ${b.money(t.revenue)} − cost of goods ${b.money(t.costOfGoods)} − fees ${b.money(t.fees)} − shipping ${b.money(t.shipping)} − other ${b.money(t.otherExpenses)} = ${b.money(t.netProfit)} net profit.`,
        `Profit margin ${formatPercent(t.margin)} · ROI ${formatPercent(t.roi)} · ${t.salesCount} ${t.salesCount === 1 ? 'sale' : 'sales'}, ${t.unitsSold} units.`,
        ...(explicit ? [] : ['No time period was mentioned, so this covers all time. Try "this month" or "last 30 days".']),
        'This is realized profit from recorded sales only — unsold inventory is not included.',
      ],
      followUps: ['Which items are making me the most money?', 'Which platform earns me the most?'],
    });
  }

  // --- Item lookup ----------------------------------------------------------
  if (item) {
    const sales = data.sales.filter((s) => s.itemId === item.id);
    const t = totalSales(sales);
    const details = [
      `On hand: ${item.quantity} · Cost per item: ${b.money(item.unitCost)} · Asking: ${item.askingPrice === null ? 'not set' : b.money(item.askingPrice)} · Estimated value: ${item.estimatedValue === null ? 'not set' : b.money(item.estimatedValue)}.`,
      sales.length
        ? `Sold ${t.unitsSold} for ${b.money(t.revenue)} revenue and ${b.money(t.netProfit)} net profit (${formatPercent(t.margin)} margin).`
        : 'No sales recorded for this item yet.',
      `${daysWithoutSale(item, data.sales, today)} days since it was bought or last sold.`,
    ];
    return b.answer('item', `Here's what I know about ${item.name}${item.sku ? ` (${item.sku})` : ''}.`, {
      details,
      items: [{ id: item.id, name: item.name }],
    });
  }

  // --- Inventory counts -----------------------------------------------------
  if (/\bhow many\b|\bcount of\b|\bnumber of\b/.test(q)) {
    const t = inventoryTotals(data.items);
    return b.answer('counts', `You have ${t.unitsInStock} units in stock across ${t.itemsInStock} items (${t.totalItems} items recorded in total).`, {
      details: [`${t.totalItems - t.itemsInStock} items are sold out or at zero.`],
    });
  }

  return b.answer('unknown', "I couldn't match that to one of the questions I know how to answer. I use fixed rules, not an AI model, so phrasing matters. Try one of these:", {
    followUps: SUGGESTED_QUESTIONS.slice(0, 6),
  });
}

export const ruleBasedProvider: InsightsProvider = {
  kind: 'rules',
  label: 'Rule-based insights',
  async ask(question, ctx) {
    return answerQuestion(question, ctx);
  },
};
