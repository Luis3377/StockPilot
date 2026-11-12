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
import { buildInsights, lowMarginSection } from './rules';
import { performanceAnswer } from './performanceAnswers';
import { sourcingAnswer } from './sourcingAnswers';
import { explainPayout } from '../domain/reconcile';
import { toCents } from '../domain/money';
import {
  calcContext,
  expensesCalculation,
  inventoryCostCalculation,
  inventorySpendCalculation,
  inventoryWorthCalculation,
  itemRankingCalculation,
  lossReviewCalculation,
  lotProfitCalculation,
  payoutCalculation,
  payoutsReceivedCalculation,
  profitCalculation,
  projectedProfitCalculation,
  revenueCalculation,
  slowMovingCalculation,
  type Calculation,
} from './calculations';
import { plural, pluralWord } from '../domain/format';
import { TERMS, type TermKey } from '../domain/terms';

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
  /** The verified calculation behind a financial answer: figures, period, formula and source records. */
  calculation?: Calculation;
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
  'What’s my inventory worth?',
  'Show my best-selling items',
  'Explain my latest payout',
  'Which items are losing money?',
  'How much money do I have invested in unsold inventory?',
  'What are my biggest selling expenses?',
  'How much profit have my bulk lots made?',
  'Which items are making me the most money?',
  'What inventory has been sitting the longest?',
  'Which categories are performing best?',
  'What items should I consider discounting?',
  'Which products are running low?',
  'Which platform earns me the most?',
  'How accurate have my predictions been?',
  'Where do I make the most money?',
  'What is my profit per hour?',
];

/** Period phrases offered when a question doesn't say which dates it means. */
const PERIOD_CHOICES = ['this month', 'last month', 'this year', 'in total'];

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
  // "In total" is a period; the adjective in "total sales" isn't.
  if (/\b(all[- ]time|ever|overall|in total|so far|to date|lifetime)\b/.test(q)) return periodRange('all', today);
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

/**
 * Words that are about the question, not an item: an item named "Profit Pro" (or a name crafted
 * to steer the assistant) mustn't turn "how much profit did I make?" into an item lookup.
 */
const QUESTION_WORDS = new Set(
  'profit profits revenue sales sale month months year years week weeks today yesterday total money inventory stock cost costs worth value price prices margin margins fees fee shipping expense expenses payout payouts ebay platform platforms category categories best worst most least selling sold lots lot bulk all time ever last much spent spend paid invested source sources sourcing hour hours trip trips tied store stores thrift'.split(' '),
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
  const qTokens = new Set(tokens(q).filter((t) => !QUESTION_WORDS.has(t)));
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
  const cc = calcContext(data, settings, today);
  // Curly apostrophes (iPhone keyboards) read the same as straight ones.
  const q = question.toLowerCase().replace(/[\u2018\u2019]/g, "'").trim();
  const report = () => buildInsights(data, settings, today);

  if (!q) return b.answer('empty', 'Type a question about your inventory, sales or profit.', { followUps: SUGGESTED_QUESTIONS.slice(0, 4) });

  if (/^(help|\?|what can (you|i) ask|what (can|do) you (do|answer|know))/.test(q)) {
    return b.answer('help', 'I answer questions using fixed rules over your recorded inventory and sales. Here are things I can work out:', {
      details: [
        'Profit, revenue and expenses for a period ("profit last month", "revenue in March", "sales on eBay this year")',
        'Your best and worst items, categories and selling platforms',
        'Slow-moving inventory and what to consider discounting',
        'Low-stock items, money invested in inventory (inventory cost), total asking price and est. market value',
        'Inventory discrepancies from Count Check',
        'A summary of any item by name or SKU',
        'What a number means ("what does projected profit mean?")',
        'Why an eBay payout doesn’t match your records ("why doesn’t my eBay payout match?")',
        'Where you make the most money, realized profit per logged hour, and your best sourcing trips ("which thrift store is most profitable?")',
      ],
      followUps: SUGGESTED_QUESTIONS.slice(0, 4),
    });
  }

  // --- Definitions (same wording as the dashboard) ---------------------------
  const DEFINITION_PATTERNS: [TermKey, RegExp][] = [
    ['inventoryCost', /inventory cost/],
    ['totalAsking', /(total )?asking price/],
    ['marketValue', /(market|estimated) value/],
    ['realizedProfit', /realized profit/],
    ['projectedProfit', /projected profit/],
    ['margin', /(profit )?margin/],
  ];
  // Only when the question names one of these terms (or asks about "these numbers"), so
  // "what's the meaning of life?" doesn't get a glossary.
  const asked = DEFINITION_PATTERNS.filter(([, re]) => re.test(q)).map(([k]) => k);
  const asksDefinition =
    /\b(mean|means|meaning|definition|define|difference between)\b/.test(q) ||
    /^what('?s| is| are) (an? |the )?(inventory cost|total asking|asking price|market value|estimated value|realized profit|projected profit|profit margin|margin)\b/.test(q);
  const aboutNumbers = /\b(these|the|my|your) (numbers|figures|terms)\b/.test(q);
  if (asksDefinition && (asked.length > 0 || aboutNumbers)) {
    const keys: TermKey[] = asked.length ? asked : ['inventoryCost', 'totalAsking', 'marketValue', 'realizedProfit', 'projectedProfit'];
    return b.answer('definitions', asked.length === 1 ? `${TERMS[keys[0]].label}: ${TERMS[keys[0]].definition}` : 'StockPilot keeps these figures separate, because they answer different questions:', {
      details: asked.length === 1 ? [] : keys.map((k) => `${TERMS[k].label}: ${TERMS[k].definition}`),
      followUps: ['How much money do I have invested in unsold inventory?', 'What is my inventory worth?'],
    });
  }

  // --- Marketplace payouts ------------------------------------------------------
  // Answers come from the reconciliation engine's own figures and findings, word for word:
  // nothing here calculates, estimates or invents an amount. A payout is money moved, not profit.
  const asksCash = /\b(cash (received|in|from)|payouts? (received|total)|total payouts?|paid out to me|how much (did|has|have) (ebay|the marketplace|marketplaces) (paid|pay|sent))\b/.test(q);
  const asksPayout = /\bpayouts?\b/.test(q) || /\b(ebay|marketplace)\b.*\b(paid|pay|deposit|transfer)/.test(q);
  if (asksCash || asksPayout) {
    const r = cc.recon();
    if (!r.payouts.length) {
      return b.answer('payouts', 'You haven’t imported any eBay payout or transaction reports yet, so there’s nothing to compare.', {
        details: ['Open Sales & Profit → Payouts and import the Transaction report and Payout report from eBay Seller Hub (Payments → Reports).'],
      });
    }
    if (asksCash && !/\b(why|match|short|differ|explain)\b/.test(q)) {
      const range = parseTimeframe(q, today) ?? periodRange('all', today);
      const calc = payoutsReceivedCalculation(cc, range);
      const received = calc.records.filter((r) => 'amount' in r.parts).length;
      const notYet = calc.lines.find((l) => l.key === 'inProgress');
      const text = `eBay paid out ${b.money(calc.value ?? 0)} ${range.label}, across ${plural(received, 'completed payout')}.${notYet ? ` Another ${b.money(notYet.amount)} is still in progress and not counted as received.` : ''}`;
      return b.answer('payouts-received', text, {
        details: ['That’s cash moved to your bank, not revenue or profit: eBay deducts fees, labels and refunds before paying out, and what the items cost you was paid when you bought them.'],
        calculation: calc,
        followUps: ['Explain my latest payout', 'How much profit have I made this month?'],
      });
    }
    const named = r.payouts.find((p) => q.includes(p.ref.toLowerCase()));
    const amountMatch = /\$?\s?(\d[\d,]*\.\d{2})\b/.exec(q);
    const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null;
    const byAmount = amount === null ? undefined : r.payouts.find((p) => p.difference !== null && toCents(Math.abs(p.difference)) === toCents(amount));
    const latest = /\b(latest|last|most recent|newest|recent)\b/.test(q) ? r.payouts[0] : undefined;
    const target = named ?? byAmount ?? latest ?? r.payouts.find((p) => p.status === 'unreconciled') ?? r.payouts.find((p) => p.status === 'needs_review') ?? r.payouts[0];
    const [headline, ...rest] = explainPayout(target, settings.currency);
    const others = r.payouts.filter((p) => p !== target && p.status === 'unreconciled').length;
    return b.answer('payouts', headline, {
      details: [
        ...(amount !== null && !byAmount && !named ? [`None of your imported payouts differs by exactly ${b.money(amount)}, so this is the ${latest ? 'latest' : 'first one that needs attention'}.`] : []),
        ...rest,
        ...(others ? [`${others} other payout${others === 1 ? ' is' : 's are'} unreconciled too.`] : []),
        'A payout is money moved, not profit. Open the payout to see the report rows and sales behind each figure.',
      ],
      calculation: payoutCalculation(cc, target),
      followUps: ['How much has eBay paid me in total?', 'How much profit have I made this month?'],
    });
  }

  if (data.items.length === 0 && data.sales.length === 0) {
    return b.answer('no-data', "There's no inventory recorded yet, so I don't have anything to analyse.", {
      details: ['Add your first item from the Inventory screen, or import a CSV file from Settings.'],
    });
  }

  // --- Predicted vs. actual (lots planned with the Max Bid Calculator) ----------------
  const perfAnswer = performanceAnswer(q, data, settings, today);
  if (perfAnswer) return b.answer(perfAnswer.intent, perfAnswer.text, { details: perfAnswer.details, calculation: perfAnswer.calculation, followUps: perfAnswer.followUps });

  // --- Sourcing (where you buy, profit per logged hour, trips) ----------------------
  const srcAnswer = sourcingAnswer(q, data, settings, today, parseTimeframe(q, today) ?? periodRange('all', today));
  if (srcAnswer) return b.answer(srcAnswer.intent, srcAnswer.text, { details: srcAnswer.details, calculation: srcAnswer.calculation, followUps: srcAnswer.followUps });

  // --- Bulk lots ----------------------------------------------------------------
  if (/\b(bulk lots?|lot purchases?|my lots|from (my |the )?lots?)\b/.test(q)) {
    if (!data.lots.length) {
      return b.answer('lot-profit', 'You haven’t recorded any bulk lots yet, so there’s no lot profit to report.', {
        details: ['Add one from Inventory → Add bulk lot when you buy several items for one price.'],
      });
    }
    const calc = lotProfitCalculation(cc);
    const line = (k: string) => calc.lines.find((l) => l.key === k)!.amount;
    return b.answer(
      'lot-profit',
      `Your ${plural(data.lots.length, 'bulk lot')} ${data.lots.length === 1 ? 'has' : 'have'} made ${b.money(calc.value ?? 0)} in realized profit so far${(calc.value ?? 0) < 0 ? ' (a loss)' : ''}.`,
      {
        details: [
          `You paid ${b.money(line('totalCost'))} for ${data.lots.length === 1 ? 'it' : 'them'}; ${b.money(line('remaining'))} of that cost is still in unsold stock, so the final result isn’t known yet.`,
          'Cost of goods sold uses each item’s exact share of its lot.',
        ],
        calculation: calc,
        followUps: ['How much profit have I made this month?', 'What inventory has been sitting the longest?'],
      },
    );
  }

  // --- Inventory purchases (all time) ---------------------------------------------
  if (/\b(spen[dt]|spending)\b.*\b(inventory|stock)\b|\binventory purchases\b/.test(q)) {
    const calc = inventorySpendCalculation(cc);
    const line = (k: string) => calc.lines.find((l) => l.key === k)!;
    const wo = line('writtenOff');
    return b.answer(
      'inventory-spend',
      `You’ve recorded ${b.money(calc.value ?? 0)} of inventory purchases in total. ${b.money(line('inStock').amount)} of it is still in stock (your inventory cost) and ${b.money(line('sold').amount)} has been sold (cost of goods sold)${wo.amount ? `; ${b.money(wo.amount)} was ${wo.op === '-' ? 'found back in counts' : 'written off'}` : ''}.`,
      {
        details: ['Buying stock isn’t an expense: its cost counts against profit as cost of goods sold when it sells.'],
        calculation: calc,
        followUps: ['How much money do I have invested in unsold inventory?', 'How much profit have I made this month?'],
      },
    );
  }

  // --- Selling expenses -----------------------------------------------------------
  if (/\b(expenses|fees|selling costs?)\b/.test(q) && /\b(biggest|largest|top|most|what are|how much|total|selling)\b/.test(q) && !/\bprofit\b/.test(q)) {
    if (!data.sales.length) return needSales(b, 'selling-expenses');
    const range = parseTimeframe(q, today) ?? periodRange('all', today);
    const sales = salesInRange(data.sales, range);
    if (!sales.length) return b.answer('selling-expenses', `You have no recorded sales ${range.label}, so there are no selling expenses.`);
    const calc = expensesCalculation(cc, sales, range);
    const parts = calc.lines.filter((l) => l.op === '+').sort((a, c) => c.amount - a.amount);
    return b.answer(
      'selling-expenses',
      `Your biggest selling expense ${range.label} is ${parts[0].label.toLowerCase()}: ${b.money(parts[0].amount)} of ${b.money(calc.value ?? 0)} in total.`,
      {
        details: [
          parts.map((l) => `${l.label}: ${b.money(l.amount)}`).join(' · '),
          'What the items cost you isn’t a selling expense: it’s cost of goods sold.',
          ...(parseTimeframe(q, today) ? [] : ['No period was mentioned, so this covers all time.']),
        ],
        calculation: calc,
        followUps: ['Which platform earns me the most?', 'How much profit have I made this month?'],
      },
    );
  }

  // --- Projected profit at asking prices -------------------------------------------
  if (/\bprojected profit\b|\bsells? at (its|their|my)? ?asking|\bat (its|their|my) asking prices?\b/.test(q)) {
    const calc = projectedProfitCalculation(cc);
    if (!calc.records.length) {
      return b.answer('projected-profit', 'None of your in-stock items has an asking price, so there’s nothing to project yet.', {
        details: ['Add asking prices to your items and ask again.'],
      });
    }
    return b.answer(
      'projected-profit',
      `If your ${plural(calc.records.length, 'priced item')} sell at their asking prices, you’d make about ${b.money(calc.value ?? 0)} in profit${(calc.value ?? 0) < 0 ? ' (a loss)' : ''}. That’s a projection, not money earned.`,
      { calculation: calc, followUps: ['What’s my inventory worth?', 'What items should I consider discounting?'] },
    );
  }

  // --- Possible losses ----------------------------------------------------------
  if (/\b(review|check|look at)\b.*\b(loss|losses|losing)\b|\b(possible|potential) loss(es)?\b/.test(q)) {
    const calc = lossReviewCalculation(cc);
    if (!calc.records.length) {
      return b.answer('loss-review', 'Nothing to review: no item has sold at a loss, no units were written off, and no item in stock is priced or valued below its cost.', { calculation: calc });
    }
    const line = (k: string) => calc.lines.find((l) => l.key === k)!.amount;
    return b.answer('loss-review', `${plural(new Set(calc.records.map((r) => r.label)).size, 'item')} could be costing you money.`, {
      details: [
        `Recorded: ${b.money(line('realized'))} lost on completed sales and ${b.money(line('writtenOff'))} written off in counts and adjustments.`,
        `Estimate: ${b.money(line('estimated'))} by which your own value estimates for unsold stock fall below what it cost. That isn’t a loss until it sells.`,
      ],
      calculation: calc,
      followUps: ['What items should I consider discounting?', 'Which items are losing money?'],
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
      return b.answer('discount', `Nothing stands out for discounting. No priced item has gone ${settings.slowMovingDays}+ days without a sale, and none is priced above its est. market value.`, {
        details: ['Items without an asking price are not checked.'],
      });
    }
    const breakEven = (item: Item) => (rate.percent < 100 ? roundMoney(item.unitCost / (1 - rate.percent / 100)) : null);
    return b.answer('discount', `${plural(candidates.length, 'item')} ${pluralWord(candidates.length, 'is a candidate', 'are candidates')} for a discount. These are suggestions based on your data, not market research — check current prices before changing yours.`, {
      details: [
        `Listed because they haven't sold in ${settings.slowMovingDays}+ days, or their asking price is above your own est. market value.`,
        `"Break-even price" is the lowest price that still covers your cost after ~${formatPercent(rate.percent)} selling costs${rate.source === 'history' ? ' (your historical average)' : rate.source === 'none' ? ' (no fee history yet)' : ' (from Settings)'}.`,
      ],
      table: {
        columns: ['Item', 'Asking price', 'Est. market value', 'Break-even price', 'Days unsold'],
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
    const slowCalc = slowMovingCalculation(cc);
    if (/\b(how much|money|tied up|worth|cost|value)\b/.test(q)) {
      return b.answer(
        'slow-moving',
        slow.length
          ? `${b.money(slowCalc.value ?? 0)} of inventory cost is tied up in ${plural(slow.length, 'item')} that ${slow.length === 1 ? 'hasn’t' : 'haven’t'} sold for ${settings.slowMovingDays}+ days.`
          : `Nothing has gone ${settings.slowMovingDays}+ days without a sale, so no money is tied up in slow-moving stock.`,
        {
          details: ['“Inventory cost” is what you paid for the units on hand, not their asking price.', `The ${settings.slowMovingDays}-day threshold can be changed in Settings.`],
          calculation: slowCalc,
          followUps: ['What items should I consider discounting?'],
        },
      );
    }
    return b.answer(
      'slow-moving',
      `${ranked[0].item.name} has been sitting the longest — ${plural(ranked[0].days, 'day')} without a sale. ${slow.length ? `${plural(slow.length, 'item')} ${pluralWord(slow.length, 'has', 'have')} gone ${settings.slowMovingDays}+ days, holding ${b.money(tied)} in inventory cost (what you paid).` : `Nothing has passed your ${settings.slowMovingDays}-day slow-moving threshold.`}`,
      {
        details: ['Days are counted from the purchase date or the most recent sale, whichever is later.', `"Inventory cost" is what you paid for the units still on hand, not their asking price.`],
        table: {
          columns: ['Item', 'Days without sale', 'On hand', 'Inventory cost'],
          rows: ranked.slice(0, 8).map((r) => [r.item.name, String(r.days), String(r.item.quantity), b.money(itemCostValue(r.item))]),
        },
        items: ranked.slice(0, 8).map((r) => ({ id: r.item.id, name: r.item.name })),
        followUps: ['What items should I consider discounting?'],
        calculation: slowCalc,
      },
    );
  }

  // --- Money invested / value ----------------------------------------------
  // "Invested" is always inventory cost (what was paid). "Worth / value" gets all three figures,
  // each named, because asking prices and the user's own estimates are different things.
  const asksInvested = /\b(invested|invest|tied up|unsold|money in|cost of (my )?(inventory|stock)|paid for)\b/.test(q);
  const asksWorth = /\b(worth|value|valued)\b/.test(q);
  if (asksInvested || asksWorth) {
    const t = inventoryTotals(data.items);
    const projection = projectUnsold(data.items, data.sales, settings);
    const stock = `${plural(t.unitsInStock, 'unit')} across ${plural(t.itemsInStock, 'item')} ${pluralWord(t.unitsInStock, 'is', 'are')} in stock today.`;
    const askingLine = t.itemsWithAsking
      ? `${TERMS.totalAsking.label}: ${b.money(t.askingValue)} for the ${plural(t.itemsWithAsking, 'item')} with an asking price${t.itemsMissingAsking ? ` (${plural(t.itemsMissingAsking, 'item')} without one ${pluralWord(t.itemsMissingAsking, 'isn’t', 'aren’t')} included)` : ''}. That's what it's listed for, not money received.`
      : `${TERMS.totalAsking.label}: none of your in-stock items has an asking price yet.`;
    const marketLine = t.itemsWithEstimate
      ? `${TERMS.marketValue.label}: ${b.money(t.estimatedValue)} for the ${plural(t.itemsWithEstimate, 'item')} you've valued (your own estimate; ${t.estimatedValue - t.estimatedCostBasis >= 0 ? 'up' : 'down'} ${b.money(Math.abs(t.estimatedValue - t.estimatedCostBasis))} vs. what you paid for them)${t.itemsMissingEstimate ? `; ${plural(t.itemsMissingEstimate, 'item')} without an estimate ${pluralWord(t.itemsMissingEstimate, 'isn’t', 'aren’t')} included` : ''}.`
      : `${TERMS.marketValue.label}: you haven't entered an estimated value for any in-stock item.`;
    const projectedLine = projection.itemsIncluded
      ? `${TERMS.projectedProfit.label} (not yet earned): about ${b.money(projection.projectedProfit)} if the ${plural(projection.itemsIncluded, 'priced item')} sell at asking, after ~${formatPercent(projection.rate.percent)} selling costs and what you paid.`
      : null;
    if (asksInvested && !asksWorth) {
      return b.answer('invested', `You have ${b.money(t.costValue)} invested in unsold inventory. That's your inventory cost: what you paid for everything in stock today.`, {
        details: [stock, `For comparison, these are not money invested:`, askingLine, marketLine, ...(projectedLine ? [projectedLine] : [])],
        table: {
          columns: ['Figure', 'Amount'],
          rows: [
            [TERMS.inventoryCost.label, b.money(t.costValue)],
            [TERMS.totalAsking.label, t.itemsWithAsking ? b.money(t.askingValue) : '—'],
            [TERMS.marketValue.label, t.itemsWithEstimate ? b.money(t.estimatedValue) : '—'],
          ],
        },
        followUps: ['What is my inventory worth?', 'What inventory has been sitting the longest?'],
        calculation: inventoryCostCalculation(cc),
      });
    }
    return b.answer(
      'worth',
      `There are three ways to put a number on your unsold inventory today: you paid ${b.money(t.costValue)} for it (inventory cost), it's listed for ${t.itemsWithAsking ? b.money(t.askingValue) : 'nothing yet'} (total asking price), and ${t.itemsWithEstimate ? `you estimate it's worth ${b.money(t.estimatedValue)}` : "you haven't estimated its value"} (est. market value).`,
      {
        details: [stock, `${TERMS.inventoryCost.label}: ${TERMS.inventoryCost.definition}`, askingLine, marketLine, ...(projectedLine ? [projectedLine] : [])],
        table: {
          columns: ['Figure', 'Amount', 'Items included'],
          rows: [
            [TERMS.inventoryCost.label, b.money(t.costValue), String(t.itemsInStock)],
            [TERMS.totalAsking.label, t.itemsWithAsking ? b.money(t.askingValue) : '—', String(t.itemsWithAsking)],
            [TERMS.marketValue.label, t.itemsWithEstimate ? b.money(t.estimatedValue) : '—', String(t.itemsWithEstimate)],
          ],
        },
        followUps: ['How much money do I have invested in unsold inventory?', 'What is my projected profit if my remaining inventory sells at its asking prices?'],
        calculation: inventoryWorthCalculation(cc),
      },
    );
  }

  // --- Categories -----------------------------------------------------------
  if (/\bcategor/.test(q)) {
    if (!data.sales.length) {
      const t = uniqueSorted(data.items.map((i) => i.category || 'Uncategorized'));
      return b.answer('categories', `No sales yet, so category performance can't be measured. You have ${plural(t.length, 'category', 'categories')} in stock.`);
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
    return b.answer('platforms', `${groups[0].label} earns you the most ${range.label}: ${b.money(groups[0].netProfit)} net profit across ${plural(groups[0].salesCount, 'sale')}.`, {
      details: ['Compare margins too: a platform with higher fees can earn less per sale even with more revenue.'],
      table: b.groupTable(groups, 'Platform'),
    });
  }

  // --- Losing money / low margin -------------------------------------------
  if (/\b(losing|lose money|lost money|at a loss|loss|unprofitable|negative|low margin|worst|least profitable)\b/.test(q)) {
    const range = parseTimeframe(q, today) ?? periodRange('all', today);
    const s = lowMarginSection(data, settings, range);
    const p = report().pricingRisks;
    if (s.insufficient && p.insufficient) return b.answer('low-margin', s.insufficient);
    const rows = s.findings.map((f) => [f.group.label, b.money(f.group.revenue), b.money(f.group.netProfit), formatPercent(f.group.margin)]);
    const inRange = salesInRange(data.sales, range);
    return b.answer('low-margin', s.insufficient ?? s.summary, {
      details: [s.rule, p.findings.length ? `Also, ${p.summary.charAt(0).toLowerCase()}${p.summary.slice(1)} See Smart Insights for the list.` : p.summary],
      table: rows.length ? { columns: ['Item', 'Revenue', 'Net profit', 'Margin'], rows: rows.slice(0, 8) } : undefined,
      calculation: inRange.length ? itemRankingCalculation(cc, inRange, range, 'margin') : undefined,
      followUps: ['Which items should I review for possible losses?'],
    });
  }

  // --- Top items ------------------------------------------------------------
  if (/\b(most money|most profit|best[- ]?sell(?:ing|ers?)?|top (item|product|seller|earner)s?|most profitable|best (item|product)s?|making me|biggest earner|highest (profit|revenue))\b/.test(q)) {
    if (!data.sales.length) return needSales(b, 'top-items');
    const range = parseTimeframe(q, today) ?? periodRange('all', today);
    const byRevenue = /\brevenue|sales\b/.test(q) && !/\bprofit\b/.test(q);
    const inRange = salesInRange(data.sales, range);
    const groups = salesByItem(inRange).sort((a, c) => (byRevenue ? c.revenue - a.revenue : c.netProfit - a.netProfit));
    if (!groups.length) return b.answer('top-items', `No sales ${range.label}.`);
    if (/\bbest[- ]?sell/.test(q)) {
      const calc = itemRankingCalculation(cc, inRange, range, 'units');
      const best = calc.records[0];
      return b.answer('best-selling', `${best.label} is your best-selling item ${range.label}: ${plural(best.parts.units, 'unit')} sold for ${b.money(best.parts.revenue)}.`, {
        details: ['Ranked by units sold (revenue breaks ties).'],
        calculation: calc,
        followUps: ['Which items are making me the most money?'],
      });
    }
    const top = groups[0];
    return b.answer('top-items', `${top.label} has made you the most ${range.label}: ${b.money(top.netProfit)} net profit from ${b.money(top.revenue)} in sales.`, {
      calculation: itemRankingCalculation(cc, inRange, range, byRevenue ? 'revenue' : 'profit'),
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
    const wantsRevenue = /\brevenue|sales|sold\b/.test(q) && !/\bprofit|made|make|earn/.test(q);
    if (!explicit) {
      // Profit and sales depend on the dates; ask rather than guess.
      const base = question.trim().replace(/[?.!\s]+$/, '');
      return b.answer('clarify', `Which period do you mean? ${wantsRevenue ? 'Sales' : 'Realized profit'} depends on the dates.`, {
        // "What were my total sales in total?" reads badly; say "all time" there.
        followUps: PERIOD_CHOICES.map((p) => `${base} ${p === 'in total' && /\btotal\b/i.test(base) ? 'all time' : p}?`),
      });
    }
    const range = explicit;
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
    const scopeLabel = scope.join(' ');
    if (!sales.length) {
      return b.answer(wantsRevenue ? 'revenue' : 'profit', `You have no recorded sales ${where}, so ${wantsRevenue ? 'sales revenue' : 'realized profit'} ${where} is ${b.money(0)}.`, {
        followUps: ['How much profit have I made this year?'],
        calculation: wantsRevenue ? revenueCalculation(cc, sales, range, scopeLabel) : profitCalculation(cc, sales, range, scopeLabel),
      });
    }
    const t = totalSales(sales);
    if (wantsRevenue) {
      return b.answer('revenue', `Your total sales ${where} were ${b.money(t.revenue)}, from ${plural(t.salesCount, 'sale')} (${plural(t.unitsSold, 'unit')}).`, {
        details: ['Sales revenue is before any costs, so it isn’t profit.'],
        calculation: revenueCalculation(cc, sales, range, scopeLabel),
        followUps: ['How much profit did I make in the same period?'.replace('in the same period', range.label)],
      });
    }
    return b.answer('profit', `Your realized profit ${where} was ${b.money(t.netProfit)}${t.netProfit < 0 ? ' (a loss)' : ''}.`, {
      details: [
        `Profit margin ${formatPercent(t.margin)} · ROI ${formatPercent(t.roi)} · ${plural(t.salesCount, 'sale')}, ${plural(t.unitsSold, 'unit')}.`,
        'This is realized profit from recorded sales only. Unsold inventory and marketplace payouts are not part of it.',
      ],
      calculation: profitCalculation(cc, sales, range, scopeLabel),
      followUps: ['Which items are making me the most money?', 'What are my biggest selling expenses?'],
    });
  }

  // --- Item lookup ----------------------------------------------------------
  if (item) {
    const sales = data.sales.filter((s) => s.itemId === item.id);
    const t = totalSales(sales);
    const details = [
      `On hand: ${item.quantity} · Cost per item: ${b.money(item.unitCost)} · Asking price: ${item.askingPrice === null ? 'not set' : b.money(item.askingPrice)} · Est. market value: ${item.estimatedValue === null ? 'not set' : b.money(item.estimatedValue)} (per item).`,
      `Inventory cost for the ${plural(item.quantity, 'unit')} on hand: ${b.money(itemCostValue(item))}.`,
      sales.length
        ? `Sold ${plural(t.unitsSold, 'unit')} (all time) for ${b.money(t.revenue)} revenue and ${b.money(t.netProfit)} realized profit (${formatPercent(t.margin)} margin).`
        : 'No sales recorded for this item yet.',
      `${plural(daysWithoutSale(item, data.sales, today), 'day')} since it was bought or last sold.`,
    ];
    return b.answer('item', `Here's what I know about ${item.name}${item.sku ? ` (${item.sku})` : ''}.`, {
      details,
      items: [{ id: item.id, name: item.name }],
      calculation: sales.length ? profitCalculation(cc, sales, periodRange('all', today), `from ${item.name}`) : undefined,
    });
  }

  // --- Inventory counts -----------------------------------------------------
  if (/\bhow many\b|\bcount of\b|\bnumber of\b/.test(q)) {
    const t = inventoryTotals(data.items);
    return b.answer('counts', `You have ${plural(t.unitsInStock, 'unit')} in stock across ${plural(t.itemsInStock, 'item')} (${plural(t.totalItems, 'item')} recorded in total).`, {
      details: [`${plural(t.totalItems - t.itemsInStock, 'item')} ${pluralWord(t.totalItems - t.itemsInStock, 'is', 'are')} out of stock (quantity 0).`],
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
