// The Learning Center's lessons. Each step points at a real control on a real page, says what to
// do and why it matters, and finishes only when its check passes. Lessons that create records
// ("practice") run on the separate practice dataset: real and demo records are never touched.
// Look-only steps can't operate what they show, so explanation lessons never save, import, close
// or delete anything.
//
// Every lesson tries to answer five questions for a beginner: what does this do, why would I use
// it, what do I click, what does the result mean, and what should I do next.

import { addItem, recordSale } from '../domain/actions';
import { SCENARIO_KEYS, SCENARIO_LABELS, bidPlanForLot, createBidPlan, defaultAssumptions, lotPrefillFromPlan, recordBidPurchase } from '../domain/bids';
import { localDate } from '../domain/ledger';
import { lotPerformance, type LotPerformance } from '../insights/performance';
import { monthLabel, monthOf, rollForward } from '../insights/monthly';
import { totalSales } from '../domain/calc';
import { todayISO } from '../domain/dates';
import { createLot } from '../domain/lots';
import { formatMoney, formatPercent, toCents } from '../domain/money';
import { addTimeEntry, assignSource, resolveSource } from '../domain/sourcing';
import { emptyData, type AppData, type Item, type UserMode } from '../domain/types';
import { salesEnabled } from '../lib/modes';
import { lessonStatus, type TutorialProgress } from './progress';
import type { Lesson, LessonEnv, LessonStep, StaticEnv, Text } from './types';

const NAV = (path: string) => `nav[aria-label="Main"] a[href="#${path}"]`;
const ITEM_FORM = '[data-testid="item-form"]';
const SALE_FORM = '[data-testid="sale-form"]';
const ALL: UserMode[] = ['reseller', 'collector', 'business'];

// ---------------------------------------------------------------------------------------------
// Wording helpers
// ---------------------------------------------------------------------------------------------

type ModeEnv = { settings: { mode: UserMode } };
const collector = (e: ModeEnv) => e.settings.mode === 'collector';
/** "Inventory" or, for collectors, "Collection" — the menu's own word. */
const listName = (e: ModeEnv) => (collector(e) ? 'Collection' : 'Inventory');
const thing = (e: ModeEnv) => (collector(e) ? 'collectible' : 'product');
const money = (e: LessonEnv, n: number) => formatMoney(n, e.settings.currency);
/** "+$2.00" / "−$2.00" / "$0.00": the same signs the app's comparison tables use. */
const signed = (e: LessonEnv, n: number) => (toCents(n) === 0 ? formatMoney(0, e.settings.currency) : `${n > 0 ? '+' : '−'}${formatMoney(Math.abs(n), e.settings.currency)}`);
const signedPctText = (n: number | null) => (n === null ? '—' : Math.round(n * 100) === 0 ? '0%' : `${n > 0 ? '+' : '−'}${Math.abs(n)}%`);
const units = (n: number) => `${n} unit${n === 1 ? '' : 's'}`;

const num = (v: string) => Number(v.replace(/[$,\s%]/g, ''));
const decimals = (v: string) => (v.split('.')[1] ?? '').replace(/\D/g, '').length;
/** What's wrong with a money answer, in plain words (null when it's fine). */
export function moneyProblem(v: string, opts: { optional?: boolean; positive?: boolean } = {}): string | null {
  const t = v.trim();
  if (!t) return opts.optional ? null : 'Enter an amount, like 8 or 8.50.';
  const n = num(t);
  if (!Number.isFinite(n)) return `“${t}” isn’t a number. Use digits, like 8 or 8.50 (no letters).`;
  if (n < 0) return 'Amounts can’t be negative.';
  if (opts.positive && n === 0) return 'Enter an amount above zero.';
  if (decimals(t) > 2) return 'Use at most two decimal places (cents), like 8.50.';
  return null;
}
const moneyStep = (opts: { optional?: boolean; positive?: boolean } = {}) => ({
  kind: 'field' as const,
  valid: (v: string) => moneyProblem(v, opts) === null,
  invalid: (v: string) => moneyProblem(v, opts) ?? 'Enter an amount, like 8 or 8.50.',
});

const done = (title: Text, body: Text): LessonStep => ({ id: 'done', title, body, advance: { kind: 'next' } });
const noSales = (e: StaticEnv) => (salesEnabled(e.settings) ? null : 'Sales tracking is off in Collector mode. Turn on “Track sales & profit” in Settings to use this lesson.');

// ---------------------------------------------------------------------------------------------
// Practice records the lessons can count on (only ever added to the practice dataset)
// ---------------------------------------------------------------------------------------------

export const PRACTICE_ITEM = 'Practice coffee mug';
const itemSaved = (e: LessonEnv) => e.data.items.length > e.baseline.items;
const saleSaved = (e: LessonEnv) => e.data.sales.length > e.baseline.sales;
const newestItem = (e: LessonEnv): Item | undefined => e.data.items.at(-1);

/** A practice product to sell, if the practice records have nothing in stock (never added twice). */
function withPracticeItem(data: AppData): AppData {
  if (data.items.some((i) => i.quantity > 0)) return data;
  return addItem(data, { name: PRACTICE_ITEM, quantity: 3, unitCost: 8, askingPrice: 20, category: 'Practice', purchaseDate: todayISO(), lowStockThreshold: null }).data;
}

/** A practice product bought at a practice store, one sale, and an hour logged there. */
function withSourcingExample(data: AppData): AppData {
  if (data.sourcing.timeEntries.length) return data;
  const today = todayISO();
  const added = addItem(data, { name: 'Practice table lamp', quantity: 2, unitCost: 12, askingPrice: 35, category: 'Practice', purchaseDate: today, lowStockThreshold: null });
  const src = resolveSource(added.data, 'Practice thrift store', 'thrift');
  let d = assignSource(src.data, 'item', added.item.id, src.sourceId, undefined, { newRecord: true });
  d = recordSale(d, { itemId: added.item.id, quantity: 1, salePrice: 35, priceMode: 'per_unit', fees: 5, saleDate: today, platform: 'Practice' }).data;
  return addTimeEntry(d, { date: today, minutes: 90, activity: 'sourcing', links: [{ kind: 'source', id: src.sourceId!, sharePct: null }], split: 'equal' }).data;
}

/** A $100 practice box lot with two items of different estimated value. */
function withPracticeLot(data: AppData): AppData {
  if (data.lots.length) return data;
  return createLot(data, {
    name: 'Practice box lot',
    purchasePrice: 100,
    extraCosts: [],
    purchaseDate: todayISO(),
    source: '',
    notes: 'A practice lot for the Learning Center.',
    method: 'relative_value',
    lines: [
      { name: 'Practice brass lamp', quantity: 1, estimatedUnitValue: 150, category: 'Practice' },
      { name: 'Practice glass vase', quantity: 1, estimatedUnitValue: 50, category: 'Practice' },
    ],
  }).data;
}

/** A practice pallet bought with a Max Bid plan, partly sold below the plan's estimates. */
function withPlannedLot(data: AppData): AppData {
  if (data.lots.length) return data;
  const today = todayISO();
  const assumptions = {
    ...defaultAssumptions(),
    valueMode: 'items' as const,
    targetRoiPct: 50,
    items: [
      { id: 'practice-radio', name: 'Practice radio', quantity: 2, unitValue: 60, category: 'Practice', condition: '', notes: '', aiFields: [] },
      { id: 'practice-speaker', name: 'Practice speaker', quantity: 2, unitValue: 40, category: 'Practice', condition: '', notes: '', aiFields: [] },
    ],
  };
  const p = createBidPlan(data, { name: 'Practice pallet', description: 'A practice plan for the Learning Center.', kind: 'pallet', assumptions });
  const { input, lineBidItemIds } = lotPrefillFromPlan(p.plan, 80, today);
  const bought = recordBidPurchase(p.data, p.plan.id, input, lineBidItemIds);
  let d = bought.data;
  const [radio, speaker] = bought.items;
  d = recordSale(d, { itemId: radio.id, quantity: 2, salePrice: 45, priceMode: 'per_unit', fees: 9, saleDate: today, platform: 'Practice' }).data;
  return recordSale(d, { itemId: speaker.id, quantity: 1, salePrice: 40, priceMode: 'per_unit', fees: 4, saleDate: today, platform: 'Practice' }).data;
}

/** A product bought this month and one sale, so the month's inventory reconciliation has something to check. */
const withMonthExample = (data: AppData): AppData => {
  const withItem = withPracticeItem(data);
  if (withItem.sales.length) return withItem;
  const item = withItem.items.find((i) => i.quantity > 0)!;
  return recordSale(withItem, { itemId: item.id, quantity: 1, salePrice: 20, priceMode: 'per_unit', fees: 2, saleDate: todayISO(), platform: 'Practice' }).data;
};

/**
 * The month the practice records are in (their latest purchase or sale), so Monthly Close opens
 * that month rather than its own default (the last finished month, which practice records made
 * today aren't in).
 */
export function practiceMonth(data: AppData, today: string = todayISO()): string {
  const dates = [...data.items.map((i) => i.purchaseDate ?? localDate(i.createdAt)), ...data.sales.map((x) => x.saleDate)].filter((d) => d && d <= today);
  return monthOf(dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : today);
}

/**
 * The practice lot's figures exactly as its Performance page shows them: the same engine, and the
 * scenario the page has selected (Expected unless it was changed there).
 */
export function practicePerformance(e: LessonEnv): LotPerformance | null {
  const lot = e.data.lots.find((l) => bidPlanForLot(e.data, l.id)) ?? e.data.lots[0];
  if (!lot) return null;
  const shown = e.text('[aria-label="Compare with scenario"] [aria-checked="true"]');
  const scenario = SCENARIO_KEYS.find((k) => SCENARIO_LABELS[k] === shown) ?? 'expected';
  return lotPerformance(e.data, e.settings, lot, { scenario, skipWarnings: true });
}

const direction = (n: number) => (toCents(n) > 0 ? 'ahead of' : toCents(n) < 0 ? 'behind' : 'level with');

// ---------------------------------------------------------------------------------------------
// Shared steps
// ---------------------------------------------------------------------------------------------

const practiceIntro = (what: Text): LessonStep => ({
  id: 'intro',
  title: 'You’re in Practice Mode',
  body: (e) =>
    `This lesson uses practice records: a separate set of samples. Nothing you do here changes your own ${collector(e) ? 'collection' : 'inventory, sales or reports'}, and your backups never include it. ${typeof what === 'function' ? what(e) : what}`,
  advance: { kind: 'next' },
});

const openList: LessonStep = {
  id: 'go-inventory',
  title: (e) => `Open your ${listName(e).toLowerCase()}`,
  body: (e) => `Click ${listName(e)} in the menu. This is where everything you ${collector(e) ? 'collect is listed' : 'own and sell is listed'}.`,
  target: NAV('/inventory'),
  advance: { kind: 'when', check: (e) => e.path === '/inventory' },
  skipIf: (e) => e.path === '/inventory',
};

const openItemForm: LessonStep = {
  id: 'open-form',
  title: (e) => `Start a new ${thing(e)}`,
  body: 'Click Add item (it says Add your first item while the list is empty; on a phone it’s the round + button). A form opens where you describe it.',
  route: '/inventory',
  target: ['[data-testid="fab-add-item"]', 'main >> button:Add item|Add your first item'],
  targetAll: true,
  advance: { kind: 'when', check: (e) => e.has(ITEM_FORM) },
  skipIf: itemSaved,
};

const nameStep = (example: string): LessonStep => ({
  id: 'name',
  title: 'Name it',
  body: `Type a name you’ll recognize later, for example “${example}”. Then press Tab (or Next).`,
  target: `${ITEM_FORM} >> label:Item name`,
  advance: { kind: 'field', valid: (v) => v.trim().length >= 2, invalid: 'Type a name (at least two letters).' },
  resumeAt: 'open-form',
  skipIf: itemSaved,
});

const saveItemStep: LessonStep = {
  id: 'save',
  title: 'Save it',
  body: 'Press Add item at the bottom of the form. If a field turns red, fix it and press Add item again — nothing is saved until the form is complete.',
  target: `${ITEM_FORM} button[type="submit"]`,
  advance: { kind: 'when', check: (e) => itemSaved(e) && !e.has(ITEM_FORM) },
  resumeAt: 'open-form',
};

// ---------------------------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------------------------

export const LESSONS: Lesson[] = [
  {
    id: 'tour-dashboard',
    title: 'Getting around StockPilot',
    summary: 'The Overview, your headline figures, the main menu and where to find help.',
    keywords: 'dashboard overview menu navigation start home help',
    group: 'basics',
    modes: ALL,
    practice: false,
    minutes: 2,
    steps: [
      {
        id: 'overview',
        route: '/',
        title: 'This is your Overview',
        body: (e) =>
          collector(e)
            ? 'Your collection at a glance: how many items you have, what you paid for them, and your own estimates of what they’re worth. It’s built only from what you record.'
            : e.settings.mode === 'business'
              ? 'A summary of your business from your own records: what’s in stock, what has sold, what you’ve earned, and anything that needs attention, such as low stock.'
              : 'A summary of your reselling from your own records: what’s in stock, what has sold, what you’ve earned on completed sales, and items that are slow to sell.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'headline',
        route: '/',
        title: 'Your headline figures',
        body: (e) =>
          collector(e)
            ? 'Cost is what you paid. Estimated market value is your own estimate for the items you valued — not an appraisal and not money you’d receive. Neither is cash in your pocket.'
            : 'Realized profit counts completed sales only, after what the items cost you and your selling expenses. Inventory cost is what you paid for stock you still have: money spent, not money earned.',
        // Both cards the text describes are highlighted (profit and inventory cost; or, for a collection,
        // estimated market value and cost), not just the first. Each overview layout has one of each pair.
        target: [
          '[data-testid="hero-profit"]',
          '[data-testid="stat-profit"]',
          '[data-testid="hero-inventory-value"]',
          '[data-testid="stat-inventory-cost"]',
          '[data-testid="hero-collection-value"]',
          '[data-testid="stat-acquisition-cost"]',
        ],
        targetAll: true,
        advance: { kind: 'next' },
        optional: true,
      },
      {
        id: 'menu',
        title: 'The main menu',
        body: (e) =>
          `${listName(e)} lists everything you have.${salesEnabled(e.settings) ? ' Sales & Profit is where you record sales and see what you earned.' : ''} Smart Insights points out things worth a look. Count Check helps you compare your shelves with your records. Settings holds your preferences and backups.`,
        target: 'nav[aria-label="Main"]',
        advance: { kind: 'next' },
      },
      {
        id: 'learn',
        title: 'The Learning Center',
        body: 'Lessons like this one live here, plus plain-English explanations of every figure. Come back any time to start, resume or replay a lesson.',
        target: '[data-tour="learn-link"]',
        advance: { kind: 'next' },
      },
      done('You know your way around', 'Practice lessons use their own records, kept apart from yours, so you can try anything without breaking something.'),
    ],
  },
  {
    id: 'practice-add-item',
    title: 'Add your first product',
    summary: 'Name, quantity, what you paid and your price — with a practice product.',
    keywords: 'new item add product stock cost price quantity inventory',
    group: 'basics',
    modes: ['reseller', 'business'],
    practice: true,
    minutes: 3,
    steps: [
      practiceIntro('Let’s add a product, the first thing you do for anything you buy to sell.'),
      openList,
      openItemForm,
      nameStep(PRACTICE_ITEM),
      {
        id: 'quantity',
        title: 'How many do you have?',
        body: 'Quantity is how many you have on hand right now. Type 3, or use the − and + buttons. StockPilot lowers it automatically each time you record a sale.',
        target: `${ITEM_FORM} >> field:Quantity`,
        advance: {
          kind: 'field',
          valid: (v) => /^\d+$/.test(v.trim()) && num(v) >= 1,
          invalid: (v) =>
            v.trim() === ''
              ? 'Enter how many you have, like 3.'
              : /^-/.test(v.trim())
                ? 'A quantity can’t be negative. Enter how many you have, like 3.'
                : !/^\d+$/.test(v.trim())
                  ? `“${v.trim()}” isn’t a whole number. Use digits, like 3.`
                  : 'Enter 1 or more.',
        },
        resumeAt: 'open-form',
        skipIf: itemSaved,
      },
      {
        id: 'cost',
        title: 'What did you pay for one?',
        body: 'Cost per item is what you paid for one product. StockPilot uses this amount to calculate how much profit you make when the item sells. Enter 8 (that’s $8.00 each).',
        target: `${ITEM_FORM} >> field:Cost per item`,
        advance: moneyStep(),
        resumeAt: 'open-form',
        skipIf: itemSaved,
        illustrative: true,
      },
      {
        id: 'price',
        title: 'What will you sell it for?',
        body: (e) =>
          `Your ${e.settings.mode === 'business' ? 'selling' : 'asking'} price for one. StockPilot uses it to estimate profit before anything sells — an estimate, not money earned. Enter 20, or leave it empty.`,
        target: `${ITEM_FORM} >> field:Selling price (per item)|Asking price (per item)`,
        advance: moneyStep({ optional: true }),
        resumeAt: 'open-form',
        optional: true,
        skipIf: itemSaved,
      },
      saveItemStep,
      {
        id: 'result',
        route: '/inventory',
        title: 'It’s in your inventory',
        body: (e) => {
          const it = newestItem(e);
          if (!it) return 'Its inventory cost is cost per item × quantity: what you have invested in it until it sells.';
          return `Its inventory cost is cost per item × quantity: ${it.quantity} × ${money(e, it.unitCost)} = ${money(e, it.unitCost * it.quantity)}. That’s money you’ve spent on stock, not money earned — it only turns into profit when you sell.`;
        },
        target: '[data-testid="inventory-item"]',
        advance: { kind: 'next' },
      },
      done('Your first product', 'That’s how every product starts. Your own inventory wasn’t changed.'),
    ],
  },
  {
    id: 'practice-record-sale',
    title: 'Record a sale and read your profit',
    summary: 'Sell a practice item, then read revenue, cost of goods sold, realized profit, margin and ROI from your own numbers.',
    keywords: 'sale sell sold revenue profit margin roi fees cost of goods cogs earnings',
    group: 'sales',
    modes: ALL,
    practice: true,
    minutes: 5,
    unavailable: noSales,
    continuesPractice: true,
    setup: withPracticeItem,
    // Opened at an explanation step (from a help topic): a practice sale to explain, already recorded.
    jumpSetup: withMonthExample,
    steps: [
      practiceIntro('You’ll sell a practice item and see exactly how StockPilot works out the profit.'),
      {
        id: 'go-sales',
        title: 'Open Sales & Profit',
        body: 'Click Sales & Profit in the menu. Every sale you record ends up here.',
        target: NAV('/sales'),
        advance: { kind: 'when', check: (e) => e.path === '/sales' },
        skipIf: (e) => e.path === '/sales',
      },
      {
        id: 'open',
        route: '/sales',
        title: 'Record a sale',
        body: 'Click Record sale (Record your first sale while nothing has sold yet). Saving the form takes the item out of stock.',
        target: 'main >> button:Record sale|Record your first sale',
        targetAll: true,
        advance: { kind: 'when', check: (e) => e.has(SALE_FORM) },
        skipIf: saleSaved,
      },
      {
        id: 'item',
        title: 'Which item sold?',
        body: (e) => `Choose the item from the list, for example “${e.data.items.find((i) => i.quantity > 0)?.name ?? PRACTICE_ITEM}”.`,
        target: `${SALE_FORM} >> label:Item sold`,
        advance: { kind: 'field', valid: (v) => v !== '', invalid: 'Choose an item from the list.' },
        resumeAt: 'open',
        skipIf: saleSaved,
      },
      {
        id: 'price',
        title: 'What did the buyer pay?',
        body: 'Enter the sale price for one, for example 20. (It starts as your asking price; change it if the buyer paid something else.)',
        target: `${SALE_FORM} >> field:Sale price`,
        advance: moneyStep({ positive: true }),
        resumeAt: 'open',
        skipIf: saleSaved,
      },
      {
        id: 'fees',
        title: 'Selling expenses',
        body: 'Enter what the marketplace kept, for example 2. You can switch between a dollar amount and a percentage. Fees, shipping you paid and other selling costs come out of the sale before profit.',
        target: `${SALE_FORM} [data-tour="sale-fees"]`,
        advance: moneyStep({ optional: true }),
        resumeAt: 'open',
        optional: true,
        skipIf: saleSaved,
      },
      {
        id: 'save',
        title: 'Save the sale',
        body: 'Press Record sale at the bottom of the form. The preview beside the form already shows the profit on this sale.',
        target: `${SALE_FORM} button[type="submit"]`,
        advance: { kind: 'when', check: (e) => saleSaved(e) && !e.has(SALE_FORM) },
        resumeAt: 'open',
      },
      {
        id: 'revenue',
        route: '/sales',
        title: 'Revenue',
        body: (e) =>
          `Revenue is the total buyers paid you: ${money(e, totalSales(e.data.sales).revenue)} so far in your practice sales. It isn’t profit yet — what the items cost you and your selling expenses still come out of it.`,
        target: '[data-testid="sales-revenue"]',
        advance: { kind: 'next' },
      },
      {
        id: 'cogs',
        route: '/sales',
        title: 'Cost of goods sold',
        body: (e) =>
          `What the items you sold had cost you: cost per item × quantity sold = ${money(e, totalSales(e.data.sales).costOfGoods)}. Items still on the shelf aren’t in it.`,
        target: '[data-testid="sales-cogs"]',
        advance: { kind: 'next' },
      },
      {
        id: 'profit',
        route: '/sales',
        title: 'Realized profit',
        body: (e) => {
          const t = totalSales(e.data.sales);
          return `Realized profit = revenue − cost of goods sold − selling expenses: ${money(e, t.revenue)} − ${money(e, t.costOfGoods)} − ${money(e, t.totalExpenses)} = ${money(e, t.netProfit)}. It’s profit on completed sales — not the cash in your bank, which also depends on payouts, purchases and other spending.`;
        },
        target: '[data-testid="sales-net"]',
        advance: { kind: 'next' },
      },
      {
        id: 'margin',
        route: '/sales',
        title: 'Profit margin',
        body: (e) => {
          const t = totalSales(e.data.sales);
          return `Margin = realized profit ÷ revenue: ${money(e, t.netProfit)} ÷ ${money(e, t.revenue)} = ${formatPercent(t.margin)}. It tells you how much of each dollar a buyer pays you keep as profit.`;
        },
        target: '[data-testid="sales-margin"]',
        advance: { kind: 'next' },
      },
      {
        id: 'roi',
        route: '/sales',
        title: 'ROI (return on investment)',
        body: (e) => {
          const t = totalSales(e.data.sales);
          return `ROI = realized profit ÷ cost of goods sold: ${money(e, t.netProfit)} ÷ ${money(e, t.costOfGoods)} = ${formatPercent(t.roi)}. Margin compares profit with what buyers paid; ROI compares it with what you paid. Both use the same profit.`;
        },
        target: '[data-testid="sales-roi"]',
        advance: { kind: 'next' },
      },
      done(
        'Sale recorded',
        'Revenue is what came in; realized profit is what’s left after the item’s cost and selling expenses. Your own sales weren’t changed. The “?” beside each figure explains it any time.',
      ),
    ],
  },
  {
    id: 'inventory-levels',
    title: 'Checking inventory levels',
    summary: 'Find items, read stock status, and keep your counts honest with Count Check.',
    keywords: 'stock level low stock out of stock search count check quantity',
    group: 'basics',
    modes: ['reseller', 'business'],
    practice: false,
    minutes: 2,
    steps: [
      {
        id: 'page',
        route: '/inventory',
        title: (e) => `Your ${listName(e).toLowerCase()}`,
        body: 'Everything you have is listed here with its quantity and price. Open an item to restock it, edit it or record a sale.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'search',
        route: '/inventory',
        title: 'Find things fast',
        body: 'Search by name, SKU, category, location or notes, and filter by stock status.',
        target: 'main input[type="search"]',
        advance: { kind: 'next' },
        optional: true,
      },
      {
        id: 'status',
        route: '/inventory',
        title: 'Stock status',
        body: 'Each item shows In stock, Low stock (at or below the alert level you set for it) or Out of stock. Set an alert level on items you restock so you hear about it in time.',
        target: '[data-testid="inventory-item"]',
        advance: { kind: 'next' },
        optional: true,
      },
      {
        id: 'count',
        title: 'Count Check',
        body: 'Count Check is for comparing your shelves with your records: you count what’s really there and type the numbers in. StockPilot shows anything missing or extra and what it cost, and changes a record only when you approve that difference with a reason (lost, damaged, found…).',
        target: NAV('/count'),
        advance: { kind: 'next' },
      },
      done('Inventory levels', 'Next time you restock or sell, check the status here, and run a Count Check every month or two.'),
    ],
  },
  {
    id: 'profit-by-source',
    title: 'Sourcing Performance and profit per hour',
    summary: 'Where your best buys come from, and what your logged time earns — with a practice example.',
    keywords: 'source where bought thrift store supplier time log hours per hour wage',
    group: 'insights',
    modes: ['reseller', 'business'],
    practice: true,
    minutes: 3,
    setup: withSourcingExample,
    jumpSetup: withSourcingExample,
    steps: [
      practiceIntro('The practice records have a lamp bought at “Practice thrift store”, one sale, and 1½ hours logged there.'),
      {
        id: 'page',
        route: '/insights/sourcing',
        title: 'Sourcing Performance',
        body: 'Results grouped by where you bought things — a store, a sale, a supplier — so you can see which places are worth your time. You record the place in “Where you bought it” when you add an item (under More details), or on a bulk lot.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'per-hour',
        route: '/insights/sourcing',
        title: 'Profit per logged hour',
        body: 'This is realized profit ÷ hours you logged, only where time is logged against a source. It isn’t a wage: your time isn’t subtracted from profit, and it doesn’t count unsold stock.',
        target: '[data-testid="sourcing-pph"]',
        advance: { kind: 'next' },
        optional: true,
      },
      {
        id: 'time-tab',
        route: '/insights/sourcing',
        title: 'Where you log time',
        body: 'Click Time log to see where hours are recorded. You can type them in or run a timer while you shop, list or ship.',
        target: '[data-testid="sourcing-tabs"] >> button:Time log',
        advance: { kind: 'click', orNext: true },
      },
      {
        id: 'time',
        route: '/insights/sourcing',
        title: 'Your logged time',
        body: 'Each entry says how long, what kind of work, and which source, trip or item it was for. Linking time to a source is what lets StockPilot work out its profit per hour.',
        target: ['main [role="tabpanel"]', 'main h1'],
        advance: { kind: 'next' },
      },
      done('Sourcing Performance', 'Add “Where you bought it” to your items and log your time, and this page fills in with your own results.'),
    ],
  },
  {
    id: 'monthly-close',
    title: 'Understanding Monthly Close',
    summary: 'Checking a month’s figures before calling them final, with a worked inventory reconciliation.',
    keywords: 'month end close reconcile reconciliation roll forward checklist verify',
    group: 'reporting',
    modes: ['reseller', 'business'],
    practice: true,
    minutes: 4,
    unavailable: noSales,
    setup: withMonthExample,
    jumpSetup: withMonthExample,
    steps: [
      practiceIntro('The practice records have a product bought this month and one sale, so there’s something to check. Nothing is closed.'),
      {
        id: 'page',
        route: (e) => `/sales/close?month=${practiceMonth(e.data)}`,
        title: 'Monthly Close',
        body: 'At the end of each month you check its figures here before calling them final, so your reports and taxes start from numbers you trust.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'figures',
        route: (e) => `/sales/close?month=${practiceMonth(e.data)}`,
        title: 'The month’s figures',
        body: 'Each figure says whether it’s verified from your records, only partly covered, or missing. Nothing is shown as verified unless the records support it — a month still in progress, or before your records began, says so.',
        target: '[data-testid="close-figures"]',
        advance: { kind: 'next' },
        optional: true,
      },
      {
        id: 'rollforward',
        route: (e) => `/sales/close?month=${practiceMonth(e.data)}`,
        title: 'Inventory reconciliation, worked through',
        body: (e) => {
          const month = practiceMonth(e.data);
          const rf = rollForward(e.data, e.settings, month, todayISO());
          const intro =
            'Beginning inventory + purchases − cost of goods sold ± write-offs and corrections should equal what your item records show at month-end. A difference means something changed without a record.';
          if (rf.status === 'not_available' || rf.beginning === null || rf.expectedEnding === null) return `${intro} For ${monthLabel(month)}: ${rf.statusText}.`;
          const moves = rf.lines.filter((l) => toCents(l.amount) !== 0).map((l) => `${l.label.toLowerCase()} ${signed(e, l.amount)}`);
          const records = rf.recordsEnding === null ? '' : `, and your item records show ${money(e, rf.recordsEnding)}`;
          const verdict = rf.status === 'verified' ? 'They match, so it’s verified.' : `${rf.statusText}.`;
          return `${intro} For ${monthLabel(month)}: ${money(e, rf.beginning)} at the start${moves.length ? `, ${moves.join(', ')}` : ''} = ${money(e, rf.expectedEnding)} expected${records}. ${verdict}`;
        },
        target: '[data-testid="rollforward"]',
        advance: { kind: 'next' },
        optional: true,
      },
      {
        id: 'checklist',
        route: (e) => `/sales/close?month=${practiceMonth(e.data)}`,
        title: 'The checklist',
        body: 'Work through each step, then close the month. Closing locks its figures so they can’t change by accident; you can reopen it with a reason. (This lesson doesn’t close anything.)',
        target: '[data-testid="close-checklist"]',
        advance: { kind: 'next' },
        optional: true,
      },
      done('Monthly Close', 'Close each month once its sales and purchases are recorded. Year-End Review builds on the closed months.'),
    ],
  },
  {
    id: 'financial-planning',
    title: 'Financial planning and reserves',
    summary: 'Setting money aside for taxes and other goals.',
    keywords: 'tax reserve set aside savings goal planning',
    group: 'reporting',
    modes: ['reseller', 'business'],
    practice: false,
    minutes: 3,
    unavailable: noSales,
    steps: [
      {
        id: 'page',
        route: '/sales/planning',
        title: 'Financial Planning',
        body: 'A planning aid: decide how much of your recorded profit to set aside. It isn’t tax advice, and it doesn’t see your bank. This lesson changes nothing.',
        target: '[data-testid="planning-disclaimer"]',
        advance: { kind: 'next' },
      },
      {
        id: 'tax',
        route: '/sales/planning',
        title: 'Tax reserve',
        body: 'You choose a percentage; StockPilot multiplies your recorded profit by it. It doesn’t know your tax rate or work out what you owe — ask an accountant what percentage suits you.',
        target: '[data-testid="tax-card"]',
        advance: { kind: 'next' },
      },
      {
        id: 'scenarios',
        route: '/sales/planning',
        title: 'Compare percentages',
        body: 'Examples at 20%, 25% and 30% show the effect of each. They aren’t recommended rates.',
        target: '[data-testid="scenario-card"]',
        advance: { kind: 'next' },
        illustrative: true,
      },
      {
        id: 'reserves',
        route: '/sales/planning',
        title: 'Money set aside',
        body: 'Record what you actually move to savings. It’s an allocation of your money, not an expense, so it doesn’t change profit.',
        target: '[data-testid="reserves-card"]',
        advance: { kind: 'next' },
      },
      done('Financial planning', 'Profit isn’t the same as cash: set aside from what you actually have in the bank.'),
    ],
  },
  {
    id: 'backup',
    title: 'Backing up your data',
    summary: 'Keep a copy of your records somewhere safe, and restore it on another device.',
    keywords: 'backup back up restore export save file move device phone safe',
    group: 'basics',
    modes: ALL,
    practice: false,
    minutes: 2,
    steps: [
      {
        id: 'where',
        route: '/settings',
        title: 'Your records live on this device',
        body: 'StockPilot saves everything in this browser on this device — there’s no account or cloud copy. Clearing browser data or losing the device would lose it, so keep backups.',
        target: '[data-testid="data-safety"]',
        advance: { kind: 'next' },
      },
      {
        id: 'download',
        route: '/settings',
        title: 'Download a backup',
        body: 'Press Download backup to save one file with your records and photos (or Next to do it later). Keep it somewhere safe, like cloud storage or email to yourself.',
        target: 'button:Download backup',
        advance: { kind: 'click', orNext: true },
      },
      {
        id: 'restore',
        route: '/settings',
        title: 'Restoring',
        body: 'Restore from backup puts a backup file’s records back — on a new phone, another browser, or after something went wrong. It replaces what’s there, so it asks first. (Nothing is restored in this lesson.)',
        target: 'button:Restore from backup',
        advance: { kind: 'next' },
      },
      done('Backups', 'Download a backup every week or two, and after big changes.'),
    ],
  },
  // --- Buying intelligence -----------------------------------------------------------------------
  {
    id: 'ai-scanner',
    title: 'Adding items with the AI scanner',
    summary: 'Let AI suggest an item’s details from a photo — you check and save.',
    keywords: 'ai scan photo camera identify',
    group: 'buying',
    modes: ['reseller', 'collector', 'business'],
    practice: true,
    minutes: 2,
    unavailable: (e) => (e.scannerEnabled ? null : 'The AI scanner is switched off in this version of StockPilot, so this lesson can’t run. Everything else works without it.'),
    steps: [
      practiceIntro('You’ll see where the AI scanner is. Nothing is sent to the AI unless you press Analyze yourself.'),
      openList,
      openItemForm,
      {
        id: 'scanner',
        title: 'Scan with AI',
        body: 'Take or choose a photo, then press Analyze: the AI suggests a name, category and condition for you to check. Analyzing uses one of your daily AI requests, and nothing is saved until you press Add item.',
        target: `${ITEM_FORM} >> [aria-label="Scan with AI"]`,
        advance: { kind: 'next' },
        resumeAt: 'open-form',
      },
      done('The AI scanner', 'Suggestions are only filled in; you always review them. Cost, quantity and prices are never guessed.'),
    ],
  },
  {
    id: 'max-bid',
    title: 'The Max Bid Calculator',
    summary: 'Enter your own estimates and see the most you can pay for a lot and still make your target return.',
    keywords: 'max bid auction pallet storage unit estimate roi offer',
    group: 'buying',
    modes: ['reseller'],
    practice: true,
    minutes: 4,
    // Opened at New calculation (from a help topic): nothing to prepare.
    jumpSetup: (d) => d,
    steps: [
      practiceIntro('You’ll work out a real maximum bid. Plans you save here stay in practice.'),
      {
        id: 'page',
        route: '/inventory/bids',
        title: 'Plan before you bid',
        body: 'Before buying a pallet, storage unit or other lot, the calculator tells you the most you can bid and still reach the return you want — based on your own estimates.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'new',
        route: '/inventory/bids',
        title: 'Start a calculation',
        body: 'Click New calculation (either button works).',
        target: '[data-testid="bid-new"]',
        // The page shows New calculation twice when there are no plans yet (top and centre): both work.
        targetAll: true,
        advance: { kind: 'when', check: (e) => /^\/inventory\/bids\/.+/.test(e.path) },
      },
      {
        id: 'resale',
        title: 'What could it all sell for?',
        body: 'Enter your estimate of what everything in the lot would sell for, for example 1000. It’s your own estimate — StockPilot doesn’t look up prices.',
        target: '[data-testid="bid-resale"] >> field:Estimated resale value, whole lot',
        advance: moneyStep({ positive: true }),
        resumeAt: 'new',
      },
      {
        id: 'roi',
        title: 'Choose your target return',
        body: 'How much profit you want on top of everything you pay. 50% means $50 profit for every $100 spent; 100% means doubling your money. Enter 50.',
        target: '[data-testid="bid-goal"] >> field:Target return (ROI)',
        illustrative: true,
        advance: {
          kind: 'field',
          valid: (v) => v.trim() !== '' && Number.isFinite(num(v)) && num(v) >= 0 && num(v) <= 1000,
          invalid: (v) =>
            v.trim() === ''
              ? 'Enter a percentage, like 50.'
              : !Number.isFinite(num(v))
                ? `“${v.trim()}” isn’t a number. Enter a percentage, like 50.`
                : 'Enter a percentage from 0 to 1000.',
        },
        resumeAt: 'new',
      },
      {
        id: 'result',
        title: 'Your maximum bid',
        body: (e) => {
          const max = e.text('[data-testid="bid-max"]');
          if (e.has('[data-testid="bid-no-bid"]'))
            return 'With these numbers no bid reaches your target return: after fees and costs, the lot wouldn’t earn enough. Go Back and try a higher resale estimate or a lower target.';
          if (!max) return 'Fill in the resale value and target return, and the maximum bid appears here.';
          return `With your estimates, the most to bid is ${max}. Pay more and you’d expect less than your target return; pay less and you’d expect more. It’s an estimate from your own assumptions, not a guarantee.`;
        },
        target: ['[data-testid="bid-headline"]', '[data-testid="bid-no-bid"]'],
        // The lesson can't be finished until a real result is on screen.
        advance: { kind: 'next', ready: (e) => e.has('[data-testid="bid-max"]') },
        resumeAt: 'new',
      },
      {
        id: 'breakdown',
        title: 'How it’s worked out',
        body: (e) => {
          const net = e.text('[data-testid="bid-net"]').replace(/^Net proceeds\s*/i, '');
          const allIn = e.text('[data-testid="bid-max-all-in"]').replace(/^.*?\)\s*/, '');
          return `Start from your resale estimate, take off what you expect not to sell, selling fees and shipping: that’s net proceeds${net ? ` (${net})` : ''}. Divide by 1 + your target return to get the most you can spend in total${allIn ? ` (${allIn})` : ''}. Take off buying costs such as a buyer’s premium and tax, and what’s left is your maximum bid.`;
        },
        target: '[data-testid="bid-breakdown"]',
        advance: { kind: 'next' },
        resumeAt: 'new',
      },
      done(
        'Max bid',
        'Try the conservative and optimistic scenarios too. If you buy the lot, “I bought this lot” turns the plan into a bulk lot and keeps your estimate to compare with what really happens.',
      ),
    ],
  },
  {
    id: 'bulk-lots',
    title: 'Bulk lots and cost splitting',
    summary: 'Buying many items for one price, and how StockPilot splits that price fairly — with a $100 example.',
    keywords: 'bulk lot pallet box split allocate cost share',
    group: 'buying',
    modes: ['reseller', 'business'],
    practice: true,
    minutes: 3,
    setup: withPracticeLot,
    steps: [
      practiceIntro('The practice records have a $100 box lot with a brass lamp (you estimate it sells for $150) and a glass vase ($50).'),
      {
        id: 'page',
        route: '/inventory/lots',
        title: 'Bulk lots',
        body: 'When you pay one price for many items (a box, a pallet, a storage unit), a lot splits that price — plus freight and fees — across the items, so each one has a cost and a real profit when it sells.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'open',
        route: '/inventory/lots',
        title: 'Open the practice lot',
        body: 'Click “Practice box lot”.',
        target: '[data-testid="lot-card"]',
        advance: { kind: 'when', check: (e) => /^\/inventory\/lots\/[^/]+$/.test(e.path) && e.path !== '/inventory/lots/performance' },
      },
      {
        id: 'split',
        title: 'How the $100 was split',
        body: 'Split by estimated resale value: the lamp is $150 of the $200 you expect to sell for (75%), so it carries $75 of the cost; the vase carries $25. Items you expect to earn more from take a bigger share, so each one’s profit is realistic. Every cent adds up to the $100 you paid.',
        target: '[data-testid="lot-items"]',
        advance: { kind: 'next' },
        illustrative: true,
      },
      done('Bulk lots', 'To add your own, use Add bulk lot in Inventory. You can also split equally per unit when you don’t have estimates.'),
    ],
  },
  {
    id: 'payouts',
    title: 'Marketplace payout reconciliation',
    summary: 'Which eBay reports you need, what a payout difference means, and how to look into one.',
    keywords: 'payout ebay report reconcile bank transfer fees refund hold difference',
    group: 'sales',
    modes: ['reseller', 'business'],
    practice: false,
    minutes: 3,
    unavailable: noSales,
    steps: [
      {
        id: 'page',
        route: '/sales/payouts',
        title: 'Payout Reconciliation',
        body: 'A payout is money eBay transfers to your bank. It’s not extra profit — it’s money you already earned, less fees, refunds and holds. This page checks each payout against the sales you recorded.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'reports',
        route: '/sales/payouts',
        title: 'The reports you need',
        body: 'From eBay’s Seller Hub (Payments → Reports), download the Transaction report and the Payout report as CSV files for the same dates, then choose them with Import eBay report. StockPilot never imports anything on its own, and importing never changes your sales. (Nothing is imported in this lesson.)',
        target: 'button:Import eBay report',
        advance: { kind: 'next' },
      },
      {
        id: 'difference',
        route: '/sales/payouts',
        title: 'What a difference means',
        body: 'For example: sales $120.00 − eBay fees $15.60 = $104.40 expected, but eBay paid $100.35. The $4.05 gap is explained line by line from the reports — here, a shipping label bought on eBay. Other common causes: a refund, a hold on new sellers, or a sale you haven’t recorded yet.',
        target: 'main h1',
        advance: { kind: 'next' },
        illustrative: true,
      },
      done('Payouts', 'When a payout doesn’t match, open it: each finding links to the report rows and sales behind it, and you record what you decided.'),
    ],
  },
  {
    id: 'predicted-actual',
    title: 'Predicted vs. actual',
    summary: 'How a lot really did against your Max Bid plan, and why — with a practice pallet.',
    keywords: 'predicted actual forecast variance plan performance estimate lot',
    group: 'insights',
    modes: ['reseller'],
    practice: true,
    minutes: 3,
    setup: withPlannedLot,
    jumpSetup: withPlannedLot,
    steps: [
      practiceIntro(
        'The practice records have a pallet bought with a Max Bid plan that estimated radios at $60 and speakers at $40. Some items have sold, and one is still in stock.',
      ),
      {
        id: 'lots',
        route: '/inventory/lots',
        title: 'Open the practice pallet',
        body: 'Click “Practice pallet”.',
        target: '[data-testid="lot-card"]',
        advance: { kind: 'when', check: (e) => /^\/inventory\/lots\/[^/]+$/.test(e.path) && e.path !== '/inventory/lots/performance' },
      },
      {
        id: 'perf-link',
        title: 'See how it’s doing',
        body: 'Click Performance to compare the plan with what actually happened.',
        target: '[data-testid="lot-performance-link"]',
        advance: { kind: 'when', check: (e) => /\/performance$/.test(e.path) },
      },
      {
        id: 'stage',
        title: 'Still selling: not final yet',
        body: (e) => {
          const perf = practicePerformance(e);
          if (!perf) return 'This page compares what you planned with what your records show.';
          const a = perf.actual;
          if (perf.final) return 'Every unit has sold (or the lot was closed), so these are final results, compared directly with the plan.';
          return `${a.unitsSold} of ${units(a.unitsBought)} have sold, so the lot isn’t finished. Your plan predicted the whole lot, so StockPilot compares it with a projected final outcome — an estimate of where the whole lot ends up — not with what has sold so far.`;
        },
        target: '[data-testid="perf-stage-note"]',
        advance: { kind: 'next' },
      },
      {
        id: 'earned',
        title: '1. Profit already earned',
        body: (e) => {
          const perf = practicePerformance(e);
          if (!perf) return 'Realized profit on the units sold so far.';
          const a = perf.actual;
          const whole =
            a.unrecovered > 0
              ? `For the whole lot, ${money(e, a.unrecovered)} of the ${money(e, a.acquisitionCost)} you paid isn’t recovered yet.`
              : `Net proceeds so far (${money(e, a.netProceeds)}) already cover the ${money(e, a.acquisitionCost)} you paid for the whole lot.`;
          return `On the ${units(a.unitsSold)} sold: revenue ${money(e, a.revenue)} − their share of the lot’s cost ${money(e, a.costOfGoods)} − selling expenses ${money(e, a.sellingExpenses)} = ${money(e, a.realizedProfit)} realized profit. That’s earned on completed sales (not the cash in your bank). ${whole}`;
        },
        target: '[data-testid="perf-realized"]',
        advance: { kind: 'next' },
      },
      {
        id: 'prediction',
        title: '2. Predicted vs. 3. projected final profit',
        body: (e) => {
          const perf = practicePerformance(e);
          const r = perf?.rows.find((x) => x.key === 'profit');
          if (!perf || !perf.prediction || !r || r.predicted === null || r.compared === null || r.difference === null)
            return 'This lot has no prediction to compare with, so only the actual results are shown.';
          const scenario = SCENARIO_LABELS[perf.scenario].toLowerCase();
          const planned = perf.prediction.acquisitionCost;
          const predicted = `When you planned the purchase, the ${scenario} scenario predicted ${money(e, r.predicted)} profit for the whole lot${planned !== null ? `, if you paid up to ${money(e, planned)} in total` : ''}.`;
          if (perf.final)
            return `${predicted} The actual final profit is ${money(e, r.compared)} — ${direction(r.difference)} the prediction by ${signed(e, r.difference)} (${signedPctText(r.errorPct)}).`;
          const left = perf.projection?.remainingUnits ?? 0;
          return `${predicted} If the ${units(left)} still in stock ${left === 1 ? 'sells' : 'sell'} as the plan assumes, the projected final profit is ${money(e, r.compared)}: ${direction(r.difference)} the prediction by ${signed(e, r.difference)} (${signedPctText(r.errorPct)}), as the Difference column shows. Projected figures are estimates, not results.`;
        },
        target: '[data-testid="perf-row-profit"]',
        advance: { kind: 'next' },
      },
      {
        id: 'why',
        title: '4. Why it differs',
        body: (e) => {
          const perf = practicePerformance(e);
          const p = perf?.prediction;
          const profit = perf?.rows.find((x) => x.key === 'profit');
          const net = perf?.rows.find((x) => x.key === 'net');
          if (!perf || !p || !profit || profit.difference === null || !net || net.difference === null || net.compared === null)
            return 'Without a prediction there’s nothing to explain the difference against.';
          const a = perf.actual;
          const parts: string[] = [];
          if (p.acquisitionCost !== null) {
            const saved = p.acquisitionCost - a.acquisitionCost;
            parts.push(
              `What you paid: ${money(e, a.acquisitionCost)} in total, ${toCents(saved) === 0 ? 'exactly what the plan allowed' : `${toCents(saved) > 0 ? 'less' : 'more'} than the ${money(e, p.acquisitionCost)} the plan allowed`} (${signed(e, saved)}).`,
            );
          }
          parts.push(
            `Net proceeds (sales after selling costs): ${perf.final ? '' : 'projected '}${money(e, net.compared)} against ${money(e, net.predicted ?? 0)} predicted (${signed(e, net.difference)}).`,
          );
          const total = `Together that’s the ${signed(e, profit.difference)} difference in profit.`;
          const sp = perf.soldPrices;
          const prices = sp
            ? ` What has sold so far brought ${money(e, sp.actual)}; at the plan’s prices it would have brought ${money(e, sp.predicted)} (${signedPctText(sp.differencePct)}), so ${toCents(sp.actual - sp.predicted) < 0 ? 'those items sold for less than you estimated' : toCents(sp.actual - sp.predicted) > 0 ? 'those items sold for more than you estimated' : 'those items sold at your estimates'}.`
            : '';
          const rest =
            !perf.final && perf.projection
              ? ` The rest is still an estimate: if the unsold ${units(perf.projection.remainingUnits)} ${perf.projection.remainingUnits === 1 ? 'sells' : 'sell'} for less, or not at all, the final profit will be lower.`
              : '';
          return `${parts.join(' ')} ${total}${prices}${rest}`;
        },
        target: ['[data-testid="perf-sold-prices"]', '[data-testid="perf-comparison"]'],
        advance: { kind: 'next' },
      },
      done('Predicted vs. actual', 'After a few lots, Max Bid can suggest adjusting your estimates based on how your past lots really did — only if you accept it.'),
    ],
  },
  // --- Collector -------------------------------------------------------------------------------
  {
    id: 'collector-add',
    title: 'Adding a collectible',
    summary: 'What you paid, its estimated value, condition, when you got it and where — with a practice collectible.',
    keywords: 'collectible collection card coin add condition value acquired',
    group: 'basics',
    modes: ['collector'],
    practice: true,
    minutes: 4,
    steps: [
      practiceIntro('Let’s add a practice collectible to your collection.'),
      openList,
      openItemForm,
      nameStep('Practice 1986 baseball card'),
      {
        id: 'cost',
        title: 'What you paid',
        body: 'Cost per item is what you paid for one. It’s the basis for what your collection cost you. Enter 15.',
        target: `${ITEM_FORM} >> field:Cost per item`,
        advance: moneyStep(),
        resumeAt: 'open-form',
        skipIf: itemSaved,
        illustrative: true,
      },
      {
        id: 'value',
        title: 'Estimated market value',
        body: 'Your own estimate of what one is worth today, for example 40. It’s a guess from your research, not a sale price or an appraisal. You can leave it empty.',
        target: `${ITEM_FORM} >> field:Est. market value (per item)`,
        advance: moneyStep({ optional: true }),
        resumeAt: 'open-form',
        optional: true,
        skipIf: itemSaved,
      },
      {
        id: 'more',
        title: 'More details',
        body: 'Click More details to record its condition, when you got it and where.',
        target: `${ITEM_FORM} >> button:More details`,
        advance: { kind: 'when', check: (e) => e.has(`${ITEM_FORM} [data-testid="source-field"]`) },
        resumeAt: 'open-form',
        skipIf: itemSaved,
      },
      {
        id: 'condition',
        title: 'Condition',
        body: 'Describe its condition, for example “Near mint”. For collectibles, condition makes a big difference to value.',
        target: `${ITEM_FORM} >> field:Condition`,
        advance: { kind: 'field', valid: (v) => v.trim().length > 0, invalid: 'Describe the condition, for example “Near mint” or “Good”.' },
        resumeAt: 'open-form',
        skipIf: itemSaved,
      },
      {
        id: 'date',
        title: 'When you got it',
        body: 'Pick the date you acquired it (today is fine for practice). It helps you see how long you’ve had things and what you paid when.',
        target: `${ITEM_FORM} >> field:Purchase date`,
        advance: { kind: 'field', valid: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= todayISO(), invalid: 'Choose a date that isn’t in the future.' },
        resumeAt: 'open-form',
        skipIf: itemSaved,
      },
      {
        id: 'where',
        title: 'Where you got it',
        body: 'The shop, show, auction or person you got it from, for example “Practice card show”. It’s where you bought it — not where you keep it (that’s Storage location).',
        target: `${ITEM_FORM} [data-testid="source-field"]`,
        advance: { kind: 'field', valid: () => true, invalid: '' },
        resumeAt: 'open-form',
        skipIf: itemSaved,
      },
      { ...saveItemStep, title: 'Add it to your collection' },
      {
        id: 'result',
        route: '/inventory',
        title: 'It’s in your collection',
        body: (e) => {
          const it = newestItem(e);
          if (!it) return 'Your collectible is listed with what you paid and your estimate.';
          return `“${it.name}”: you paid ${money(e, it.unitCost)}${it.estimatedValue !== null ? `, and you estimate it’s worth ${money(e, it.estimatedValue)} — an estimate, not money received` : ''}.`;
        },
        target: '[data-testid="inventory-item"]',
        advance: { kind: 'next' },
      },
      done('Your first collectible', 'The practice collectible stays in Practice Mode; your own collection wasn’t changed.'),
    ],
  },
  {
    id: 'collector-organize',
    title: 'Organizing your collection',
    summary: 'Search, categories and storage locations.',
    keywords: 'organize category location search filter collection',
    group: 'basics',
    modes: ['collector'],
    practice: false,
    minutes: 2,
    steps: [
      {
        id: 'page',
        route: '/inventory',
        title: 'Your collection',
        body: 'Every item is listed here. Categories and storage locations (in each item’s details) keep a big collection manageable.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'search',
        route: '/inventory',
        title: 'Find anything',
        body: 'Search by name, category, location or notes, and filter by category or location.',
        target: 'main input[type="search"]',
        advance: { kind: 'next' },
        optional: true,
      },
      done('Organizing', 'Give items a category and a storage location when you add them; you can filter by both later.'),
    ],
  },
  {
    id: 'collector-valuation',
    title: 'Value: what you paid vs. what it’s worth',
    summary: 'Cost, asking price and estimated market value, and their limits.',
    keywords: 'value worth appraisal estimate market value collection',
    group: 'insights',
    modes: ['collector'],
    practice: false,
    minutes: 2,
    steps: [
      {
        id: 'headline',
        route: '/',
        title: 'Your collection’s figures',
        body: 'Cost is what you paid. Estimated market value is your own estimate, and only for items you gave one. Asking price is what you’ve listed something for. None of these is money received.',
        target: ['[data-testid="hero-collection-value"]', 'main h1'],
        advance: { kind: 'next' },
      },
      done(
        'Valuation',
        'Estimates are only as good as your research: StockPilot doesn’t look up prices or appraise items. Update an item’s estimate when you learn more, and StockPilot keeps the history.',
      ),
    ],
  },
  {
    id: 'collector-sales',
    title: 'Optional: sales and profit',
    summary: 'What turning on sales tracking adds, if you sometimes sell from your collection.',
    keywords: 'sell sales track profit collector setting',
    group: 'sales',
    modes: ['collector'],
    practice: false,
    minutes: 1,
    steps: [
      {
        id: 'toggle',
        route: '/settings',
        title: 'The “Track sales & profit” setting',
        body: 'Off by default for collectors. Turning it on adds Sales & Profit to the menu, where you record what you sold and see realized profit. Nothing else changes, and turning it off later keeps any sales you recorded. This lesson doesn’t switch it on — that’s your choice.',
        target: ['label:Track sales & profit', 'main [role="switch"]'],
        advance: { kind: 'next' },
        optional: true,
      },
      done('Sales tracking', 'If you turn it on, the “Record a sale and read your profit” lesson shows how sales work.'),
    ],
  },
];

/** The learning path the welcome tour follows, per mode. */
export const MODE_PATHS: Record<UserMode, string[]> = {
  business: ['tour-dashboard', 'practice-add-item', 'practice-record-sale', 'inventory-levels', 'profit-by-source', 'monthly-close', 'financial-planning', 'backup'],
  reseller: ['tour-dashboard', 'practice-add-item', 'ai-scanner', 'max-bid', 'bulk-lots', 'practice-record-sale', 'payouts', 'predicted-actual', 'profit-by-source', 'backup'],
  collector: ['tour-dashboard', 'collector-add', 'collector-organize', 'collector-valuation', 'collector-sales', 'backup'],
};

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

/** Lessons made for this mode (including any that can't run right now; ask `unavailable` why). */
export function lessonsFor(env: StaticEnv): Lesson[] {
  return LESSONS.filter((l) => l.modes.includes(env.settings.mode));
}

/** Lessons made for other modes: still offered (if the feature is there), never by switching your mode. */
export function otherModeLessons(env: StaticEnv): Lesson[] {
  return LESSONS.filter((l) => !l.modes.includes(env.settings.mode));
}

/** The mode's path, minus lessons that can't run (e.g. the scanner when it's off). */
export function pathFor(env: StaticEnv): Lesson[] {
  return MODE_PATHS[env.settings.mode].map(lessonById).filter((l): l is Lesson => !!l && !l.unavailable?.(env));
}

/** The next lesson on the path that isn't completed (after `currentId`, then from the start), if any. */
export function nextUnfinished(env: StaticEnv, progress: TutorialProgress, currentId: string): Lesson | undefined {
  const path = pathFor(env);
  const at = path.findIndex((l) => l.id === currentId);
  const ordered = [...path.slice(at + 1), ...path.slice(0, Math.max(0, at))];
  return ordered.find((l) => l.id !== currentId && !(l.id in progress.completed) && lessonStatus(progress, l.id) !== 'completed');
}

/**
 * The unfinished lesson to offer as "Resume": one made for the current mode that can run with
 * this setup (e.g. not a sales lesson while collector sales tracking is off), the most recently
 * paused first. Undefined when there's none, so no Resume button ever leads to an error.
 */
export function resumeCandidate(env: StaticEnv, progress: TutorialProgress): Lesson | undefined {
  const when = (id: string) => progress.pausedAt?.[id] ?? '';
  return Object.keys(progress.resume)
    .map(lessonById)
    .filter((l): l is Lesson => !!l && l.modes.includes(env.settings.mode) && !l.unavailable?.(env))
    .sort((a, b) => when(b.id).localeCompare(when(a.id)))[0];
}

/** Every unfinished lesson that can be resumed now (for a "more unfinished" count). */
export function resumable(env: StaticEnv, progress: TutorialProgress): Lesson[] {
  return Object.keys(progress.resume)
    .map(lessonById)
    .filter((l): l is Lesson => !!l && l.modes.includes(env.settings.mode) && !l.unavailable?.(env));
}

export function stepsFor(lesson: Lesson, env: StaticEnv): LessonStep[] {
  return lesson.steps.filter((s) => !s.include || s.include(env));
}

/** All the words of a lesson (title, summary, keywords, every step), for the Learning Center's search. */
export function lessonSearchText(lesson: Lesson, env: StaticEnv): string {
  const e: LessonEnv = { ...env, data: emptyData(), path: '', baseline: { items: 0, sales: 0, lots: 0, bidPlans: 0 }, has: () => false, text: () => '' };
  const t = (x: Text) => (typeof x === 'function' ? x(e) : x);
  return [lesson.title, lesson.summary, lesson.keywords ?? '', ...lesson.steps.flatMap((s) => [t(s.title), t(s.body)])].join(' ');
}

/** For a page that shows one record (/inventory/<id>, /inventory/bids/<id>, …), the list it belongs to. */
export function practiceDetailParent(path: string): string | null {
  const m = path.match(/^\/(inventory\/(?:bids|lots)|inventory|sales\/payouts|insights\/sourcing\/(?:source|trips))\/([^/]+)(\/.*)?$/);
  if (!m) return null;
  if (m[1] === 'inventory' && (m[2] === 'lots' || m[2] === 'bids')) return null;
  if (m[1] === 'inventory/lots' && m[2] === 'performance') return null;
  return `/${m[1].replace(/\/(source|trips)$/, '')}`;
}
