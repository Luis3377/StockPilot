// The Learning Center's lessons. Each step points at a real control on a real page, says what
// to do and why it matters, and finishes only when its check passes. Lessons that create
// records ("practice") run on the separate practice dataset: real and demo records are never
// touched. Explanation lessons only look; they never save, close, import or delete anything.

import { addItem } from '../domain/actions';
import { todayISO } from '../domain/dates';
import type { AppData, UserMode } from '../domain/types';
import { salesEnabled } from '../lib/modes';
import type { Lesson, LessonEnv, LessonStep, StaticEnv } from './types';

const NAV = (path: string) => `nav[aria-label="Main"] a[href="#${path}"]`;
const ITEM_FORM = '[data-testid="item-form"]';
const SALE_FORM = '[data-testid="sale-form"]';
const ALL: UserMode[] = ['reseller', 'collector', 'business'];

const num = (v: string) => Number(v.replace(/[$,\s]/g, ''));
const money = (v: string) => v.trim() !== '' && Number.isFinite(num(v)) && num(v) >= 0;
const done = (title: string, body: string): LessonStep => ({
  id: 'done',
  title,
  body,
  advance: { kind: 'next' },
});
const noSales = (e: StaticEnv) =>
  salesEnabled(e.settings) ? null : 'Sales tracking is off in Collector mode. Turn it on in Settings → Sales & profit tracking to use this lesson.';

/** Practice records the lessons can count on. */
export const PRACTICE_ITEM = 'Practice coffee mug';
const itemSaved = (e: LessonEnv) => e.data.items.length > e.baseline.items;
const saleSaved = (e: LessonEnv) => e.data.sales.length > e.baseline.sales;

/** A practice item to sell, if the practice records have nothing in stock (never added twice). */
function withPracticeItem(data: AppData): AppData {
  if (data.items.some((i) => i.quantity > 0)) return data;
  return addItem(data, {
    name: PRACTICE_ITEM,
    quantity: 3,
    unitCost: 8,
    askingPrice: 20,
    category: 'Practice',
    purchaseDate: todayISO(),
  }).data;
}

const practiceIntro = (what: string): LessonStep => ({
  id: 'intro',
  title: 'You’re in practice mode',
  body: `This lesson uses practice mode: a separate set of sample records. Nothing you do here changes your own inventory, sales or reports. ${what}`,
  advance: { kind: 'next' },
});

const openInventory: LessonStep = {
  id: 'go-inventory',
  title: 'Open your inventory',
  body: 'Click Inventory in the menu. This is where everything you own and sell is listed.',
  target: NAV('/inventory'),
  advance: { kind: 'when', check: (e) => e.path === '/inventory' },
  skipIf: (e) => e.path === '/inventory',
};

const openItemForm: LessonStep = {
  id: 'open-form',
  title: 'Start a new item',
  body: 'Click Add item. A form opens where you describe the product.',
  route: '/inventory',
  target: ['[data-testid="fab-add-item"]', 'main >> button:Add item|Add your first item'],
  advance: { kind: 'when', check: (e) => e.has(ITEM_FORM) },
  skipIf: itemSaved,
};

export const LESSONS: Lesson[] = [
  {
    id: 'tour-dashboard',
    title: 'Getting around StockPilot',
    summary: 'The Overview, the main menu and where to find help.',
    group: 'basics',
    modes: ALL,
    practice: false,
    minutes: 2,
    steps: [
      {
        id: 'overview',
        route: '/',
        title: 'This is your Overview',
        body: 'The Overview sums up your business from your own records: what you have in stock, what has sold, and anything that needs attention.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'headline',
        route: '/',
        title: 'Your headline figures',
        body: 'These come from what you’ve recorded. Profit counts completed sales only. Inventory figures show what you’ve paid for the stock you still have — money you’ve spent, not money you’ve earned.',
        target: ['[data-testid="hero-profit"]', '[data-testid="hero-inventory-value"]', '[data-testid="hero-collection-value"]'],
        advance: { kind: 'next' },
        optional: true,
      },
      {
        id: 'menu',
        title: 'The main menu',
        body: 'Move between your inventory, sales and profit, insights, Count Check (comparing your shelves with your records) and Settings (including backups).',
        target: 'nav[aria-label="Main"]',
        advance: { kind: 'next' },
      },
      {
        id: 'learn',
        title: 'The Learning Center',
        body: 'Lessons like this one live here. Come back any time to start, resume or replay one, or to look up a term.',
        target: '[data-tour="learn-link"]',
        advance: { kind: 'next' },
      },
      done('You know your way around', 'Next, try adding a product. Practice lessons use sample records, so you can’t break anything.'),
    ],
  },
  {
    id: 'practice-add-item',
    title: 'Add your first product',
    summary: 'Name, quantity, what you paid and your price — with a practice product.',
    group: 'basics',
    modes: ['reseller', 'business'],
    practice: true,
    minutes: 3,
    steps: [
      practiceIntro('Let’s add a product.'),
      openInventory,
      openItemForm,
      {
        id: 'name',
        title: 'Name it',
        body: 'Type a name you’ll recognize later, for example “Practice coffee mug”.',
        target: `${ITEM_FORM} >> label:Item name`,
        advance: {
          kind: 'field',
          valid: (v) => v.trim().length >= 2,
          invalid: 'Type a name (at least two letters).',
        },
        resumeAt: 'open-form',
        skipIf: itemSaved,
      },
      {
        id: 'quantity',
        title: 'How many do you have?',
        body: 'Quantity is how many you have on hand right now. Enter 3.',
        target: `${ITEM_FORM} >> label:Quantity`,
        advance: {
          kind: 'field',
          valid: (v) => Number.isInteger(num(v)) && num(v) >= 1,
          invalid: 'Enter a whole number, 1 or more.',
        },
        resumeAt: 'open-form',
        skipIf: itemSaved,
      },
      {
        id: 'cost',
        title: 'What did you pay for one?',
        body: 'Cost per item is what you paid for one product. StockPilot uses this amount to calculate how much profit you make when the item sells. Enter 8 (that’s $8.00 each).',
        target: `${ITEM_FORM} >> label:Cost per item`,
        advance: {
          kind: 'field',
          valid: money,
          invalid: 'Enter an amount like 8 or 8.50.',
        },
        resumeAt: 'open-form',
        skipIf: itemSaved,
      },
      {
        id: 'price',
        title: 'What will you sell it for?',
        body: 'Your price for one. StockPilot uses it to estimate profit before anything sells — an estimate, not money earned. Enter 20, or leave it empty.',
        target: `${ITEM_FORM} >> label:Selling price (per item)|Asking price (per item)`,
        advance: {
          kind: 'field',
          valid: (v) => v.trim() === '' || money(v),
          invalid: 'Enter an amount like 20, or leave it empty.',
        },
        resumeAt: 'open-form',
        optional: true,
        skipIf: itemSaved,
      },
      {
        id: 'save',
        title: 'Save it',
        body: 'Press Add item. If a field turns red, fix it and press Add item again — nothing is saved until the form is complete.',
        target: `${ITEM_FORM} button[type="submit"]`,
        advance: {
          kind: 'when',
          check: (e) => itemSaved(e) && !e.has(ITEM_FORM),
        },
        resumeAt: 'open-form',
      },
      {
        id: 'result',
        route: '/inventory',
        title: 'It’s in your inventory',
        body: 'Its inventory cost is cost per item × quantity: what you have invested in it until it sells. With 3 at $8.00 that’s $24.00.',
        target: '[data-testid="inventory-item"]',
        advance: { kind: 'next' },
        illustrative: true,
      },
      done('Your first product', 'That’s how every product starts. The practice product stays in practice mode; your own inventory wasn’t changed. Next: record a sale.'),
    ],
  },
  {
    id: 'practice-record-sale',
    title: 'Record a sale and read your profit',
    summary: 'Sell a practice item, then see revenue, cost of goods sold and realized profit.',
    group: 'sales',
    modes: ALL,
    practice: true,
    minutes: 4,
    unavailable: noSales,
    setup: withPracticeItem,
    steps: [
      practiceIntro('You’ll sell a practice item and see how StockPilot works out the profit.'),
      {
        id: 'go-sales',
        title: 'Open Sales & Profit',
        body: 'Click Sales & Profit in the menu.',
        target: NAV('/sales'),
        advance: { kind: 'when', check: (e) => e.path === '/sales' },
        skipIf: (e) => e.path === '/sales',
      },
      {
        id: 'open',
        route: '/sales',
        title: 'Record a sale',
        body: 'Click Record sale. The form takes the item out of stock when you save it.',
        target: 'main >> button:Record sale|Record your first sale',
        advance: { kind: 'when', check: (e) => e.has(SALE_FORM) },
        skipIf: saleSaved,
      },
      {
        id: 'item',
        title: 'Which item sold?',
        body: `Choose the item, for example “${PRACTICE_ITEM}”.`,
        target: `${SALE_FORM} >> label:Item sold`,
        advance: {
          kind: 'field',
          valid: (v) => v !== '',
          invalid: 'Choose an item.',
        },
        resumeAt: 'open',
        skipIf: saleSaved,
      },
      {
        id: 'price',
        title: 'What did the buyer pay?',
        body: 'Enter the sale price, for example 20.',
        target: `${SALE_FORM} >> label:Sale price`,
        advance: {
          kind: 'field',
          valid: (v) => money(v) && num(v) > 0,
          invalid: 'Enter the price, for example 20.',
        },
        resumeAt: 'open',
        skipIf: saleSaved,
      },
      {
        id: 'fees',
        title: 'Selling expenses',
        body: 'Enter any fees the marketplace kept, for example 2. Fees, shipping you paid and other selling costs come out of the sale before profit.',
        target: `${SALE_FORM} >> label:Marketplace fees`,
        advance: {
          kind: 'field',
          valid: (v) => v.trim() === '' || money(v),
          invalid: 'Enter an amount like 2, or leave it empty.',
        },
        resumeAt: 'open',
        optional: true,
        skipIf: saleSaved,
      },
      {
        id: 'save',
        title: 'Save the sale',
        body: 'Press Record sale. The preview beside the form already shows the profit on this sale.',
        target: `${SALE_FORM} button[type="submit"]`,
        advance: {
          kind: 'when',
          check: (e) => saleSaved(e) && !e.has(SALE_FORM),
        },
        resumeAt: 'open',
      },
      {
        id: 'revenue',
        route: '/sales',
        title: 'Revenue',
        body: 'Revenue is the total buyers paid you. It isn’t profit: what the items cost you and your selling expenses still come out of it.',
        target: '[data-testid="sales-revenue"]',
        advance: { kind: 'next' },
      },
      {
        id: 'cogs',
        route: '/sales',
        title: 'Cost of goods sold',
        body: 'Cost of goods sold is what the items you sold had cost you: cost per item × quantity sold. Unsold stock isn’t in it.',
        target: '[data-testid="sales-cogs"]',
        advance: { kind: 'next' },
      },
      {
        id: 'profit',
        route: '/sales',
        title: 'Realized profit',
        body: 'Realized profit = revenue − cost of goods sold − fees, shipping and other selling expenses. For $20 with $8 cost and $2 fees, that’s $10. It’s profit on completed sales — not the cash in your bank, which also depends on payouts, purchases and other spending.',
        target: '[data-testid="sales-net"]',
        advance: { kind: 'next' },
        illustrative: true,
      },
      done('Sale recorded', 'Revenue is what came in; realized profit is what’s left after the item’s cost and selling expenses. Your own sales weren’t changed.'),
    ],
  },
  {
    id: 'inventory-levels',
    title: 'Checking inventory levels',
    summary: 'Find items, read stock status and keep counts honest.',
    group: 'basics',
    modes: ['reseller', 'business'],
    practice: false,
    minutes: 2,
    steps: [
      {
        id: 'page',
        route: '/inventory',
        title: 'Your inventory',
        body: 'Everything you have is listed here with its quantity and price.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'search',
        route: '/inventory',
        title: 'Find things fast',
        body: 'Search by name, SKU, category, location or notes.',
        target: 'main input[type="search"]',
        advance: { kind: 'next' },
        optional: true,
      },
      {
        id: 'status',
        route: '/inventory',
        title: 'Stock status',
        body: 'Each item shows In stock, Low stock (at or below the alert level you set for it) or Out of stock.',
        target: '[data-testid="inventory-item"]',
        advance: { kind: 'next' },
        optional: true,
      },
      {
        id: 'count',
        title: 'Count Check',
        body: 'Count Check compares what’s on your shelves with your records and records any difference with a reason you choose.',
        target: NAV('/count'),
        advance: { kind: 'next' },
      },
      done('Inventory levels', 'Set a low-stock alert on items you restock, and run a Count Check now and then.'),
    ],
  },
  {
    id: 'profit-by-source',
    title: 'Sourcing Performance and profit per hour',
    summary: 'Where your best buys come from, and what your logged time earns.',
    group: 'insights',
    modes: ['reseller', 'business'],
    practice: false,
    minutes: 2,
    steps: [
      {
        id: 'page',
        route: '/insights/sourcing',
        title: 'Sourcing Performance',
        body: 'Results grouped by where you bought things — a store, a sale, a supplier — so you can see which places pay off.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'tabs',
        route: '/insights/sourcing',
        title: 'Overview, profit per hour, trips and time',
        body: 'Profit per logged hour divides realized profit by the hours you logged, only where time is logged against a source. It isn’t a wage: your time isn’t subtracted from profit.',
        target: '[data-testid="sourcing-tabs"]',
        advance: { kind: 'next' },
        optional: true,
      },
      done('Sourcing Performance', 'Add “where you bought it” to items and lots, and log your time, to fill these in.'),
    ],
  },
  {
    id: 'monthly-close',
    title: 'Understanding Monthly Close',
    summary: 'Checking a month’s figures before you call them final.',
    group: 'reporting',
    modes: ['reseller', 'business'],
    practice: false,
    minutes: 3,
    unavailable: noSales,
    steps: [
      {
        id: 'page',
        route: '/sales/close',
        title: 'Monthly Close',
        body: 'Here you check a month’s figures before calling them final. This lesson only looks around: nothing is closed or changed.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'figures',
        route: '/sales/close',
        title: 'The month’s figures',
        body: 'Each figure says whether it’s verified from your records, only partly covered, or missing. Nothing is shown as verified unless the records support it.',
        target: '[data-testid="close-figures"]',
        advance: { kind: 'next' },
        optional: true,
      },
      {
        id: 'rollforward',
        route: '/sales/close',
        title: 'Inventory reconciliation',
        body: 'Beginning inventory + purchases − cost of goods sold ± write-offs and corrections should equal what your item records show at month-end. A difference means something changed without a record.',
        target: '[data-testid="rollforward"]',
        advance: { kind: 'next' },
        optional: true,
      },
      {
        id: 'checklist',
        route: '/sales/close',
        title: 'The checklist',
        body: 'Review each step, then close the month. Closing locks its figures so they can’t change by accident; you can reopen it with a reason.',
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
        body: 'You choose a percentage; StockPilot multiplies your recorded profit by it. It doesn’t know your tax rate or work out what you owe.',
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
      done('Financial planning', 'Profit isn’t the same as cash: set aside from what you actually have, and ask an accountant about your taxes.'),
    ],
  },
  {
    id: 'backup',
    title: 'Backing up your data',
    summary: 'Keep a copy of your records somewhere safe.',
    group: 'basics',
    modes: ALL,
    practice: false,
    minutes: 1,
    steps: [
      {
        id: 'where',
        route: '/settings',
        title: 'Your records live on this device',
        body: 'StockPilot saves everything in this browser on this device. Clearing browser data or losing the device would lose them, so keep backups.',
        target: '[data-testid="data-safety"]',
        advance: { kind: 'next' },
      },
      {
        id: 'download',
        route: '/settings',
        title: 'Download a backup',
        body: 'Press Download backup to save a file with your records and photos (or Next to do it later). Keep it somewhere safe, like cloud storage.',
        target: 'button:Download backup',
        advance: { kind: 'click', orNext: true },
      },
      done('Backups', 'To move to another device, restore that file there from Settings.'),
    ],
  },
  // --- Reseller -------------------------------------------------------------------------------
  {
    id: 'ai-scanner',
    title: 'Adding items with the AI scanner',
    summary: 'Let AI suggest an item’s details from a photo — you check and save.',
    group: 'buying',
    modes: ['reseller', 'collector', 'business'],
    practice: true,
    minutes: 2,
    unavailable: (e) => (e.scannerEnabled ? null : 'The AI scanner isn’t available in this version of StockPilot.'),
    steps: [
      practiceIntro('You’ll see where the AI scanner is. Nothing is sent to the AI unless you press Analyze yourself.'),
      openInventory,
      openItemForm,
      {
        id: 'scanner',
        title: 'Scan with AI',
        body: 'Take or choose a photo, then press Analyze: the AI suggests a name, category and condition for you to check. Analyzing uses one of your daily AI requests, and nothing is saved until you press Add item.',
        target: `${ITEM_FORM} >> [aria-label="Scan with AI"]`,
        advance: { kind: 'next' },
        resumeAt: 'open-form',
      },
      done('The AI scanner', 'You can close the form: nothing was saved. Suggestions are only filled in; you always review them.'),
    ],
  },
  {
    id: 'max-bid',
    title: 'The Max Bid Calculator',
    summary: 'The most you can pay for a lot and still make your target return.',
    group: 'buying',
    modes: ['reseller'],
    practice: true,
    minutes: 3,
    steps: [
      practiceIntro('Plans you start here stay in practice mode.'),
      {
        id: 'page',
        route: '/inventory/bids',
        title: 'Plan before you bid',
        body: 'A plan estimates what a lot could resell for, the costs of buying and selling it, and your target return.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'new',
        route: '/inventory/bids',
        title: 'Start a plan',
        body: 'Click New plan.',
        target: '[data-testid="bid-new"]',
        advance: {
          kind: 'when',
          check: (e) => /^\/inventory\/bids\/.+/.test(e.path),
        },
      },
      {
        id: 'form',
        title: 'Your assumptions',
        body: 'Enter the expected resale value, fees, buyer’s premium and the return you want. Every figure updates as you type.',
        target: '[data-testid="bid-form"]',
        advance: { kind: 'next' },
        resumeAt: 'page',
      },
      done('Max bid', 'The maximum bid is the most you can pay and still reach your target return — an estimate from your assumptions, not a guarantee.'),
    ],
  },
  {
    id: 'bulk-lots',
    title: 'Bulk lots and cost splitting',
    summary: 'Buying many items for one price, and spreading the cost fairly.',
    group: 'buying',
    modes: ['reseller', 'business'],
    practice: false,
    minutes: 2,
    steps: [
      {
        id: 'page',
        route: '/inventory/lots',
        title: 'Bulk lots',
        body: 'When you pay one price for many items (a pallet, a storage unit), a lot splits that price — plus freight and fees — across the items.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'add',
        route: '/inventory/lots',
        title: 'Add a bulk lot',
        body: 'This starts a new lot. Splitting by estimated resale value gives items you expect to sell for more a bigger share of the cost, so each item’s profit is realistic.',
        target: 'main >> button:Add bulk lot',
        advance: { kind: 'next' },
      },
      done('Bulk lots', 'Every cent of a lot’s cost ends up on its items, so profit adds up exactly when they sell.'),
    ],
  },
  {
    id: 'payouts',
    title: 'Marketplace payout reconciliation',
    summary: 'Checking that eBay paid you what your sales say it should.',
    group: 'sales',
    modes: ['reseller', 'business'],
    practice: false,
    minutes: 2,
    unavailable: noSales,
    steps: [
      {
        id: 'page',
        route: '/sales/payouts',
        title: 'Payout Reconciliation',
        body: 'Payouts are money transferred to your bank, not profit. Here you compare them with your recorded sales.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      {
        id: 'import',
        route: '/sales/payouts',
        title: 'Importing eBay reports',
        body: 'You download reports from eBay and choose them here. StockPilot never imports anything on its own, and importing never changes your sales.',
        target: 'button:Import eBay report',
        advance: { kind: 'next' },
      },
      done('Payouts', 'Differences are explained item by item: fees, refunds, holds, or a sale you haven’t recorded.'),
    ],
  },
  {
    id: 'predicted-actual',
    title: 'Predicted vs. actual',
    summary: 'How your lots did against what you planned.',
    group: 'insights',
    modes: ['reseller'],
    practice: false,
    minutes: 2,
    steps: [
      {
        id: 'page',
        route: '/inventory/lots/performance',
        title: 'Predicted vs. actual',
        body: 'For lots bought with a Max Bid plan, this compares what you predicted with what actually sold, so your next estimates get better. Lots still selling are marked as not final.',
        target: 'main h1',
        advance: { kind: 'next' },
      },
      done('Predicted vs. actual', 'Sell-through is shown by estimated value and by units, so they’re never confused.'),
    ],
  },
  // --- Collector ------------------------------------------------------------------------------
  {
    id: 'collector-add',
    title: 'Adding a collectible',
    summary: 'What you paid, its condition and your estimate of its value — with a practice item.',
    group: 'basics',
    modes: ['collector'],
    practice: true,
    minutes: 3,
    steps: [
      practiceIntro('Let’s add a practice collectible.'),
      openInventory,
      openItemForm,
      {
        id: 'name',
        title: 'Name it',
        body: 'Be specific, for example “Practice 1986 baseball card”.',
        target: `${ITEM_FORM} >> label:Item name`,
        advance: {
          kind: 'field',
          valid: (v) => v.trim().length >= 2,
          invalid: 'Type a name (at least two letters).',
        },
        resumeAt: 'open-form',
        skipIf: itemSaved,
      },
      {
        id: 'cost',
        title: 'What you paid',
        body: 'Cost per item is what you paid for one. It’s the basis for your collection’s cost. Enter 15.',
        target: `${ITEM_FORM} >> label:Cost per item`,
        advance: {
          kind: 'field',
          valid: money,
          invalid: 'Enter an amount like 15.',
        },
        resumeAt: 'open-form',
        skipIf: itemSaved,
      },
      {
        id: 'value',
        title: 'Estimated market value',
        body: 'Your own estimate of what one is worth today, for example 40. It’s a guess, not a sale price or an appraisal. You can leave it empty.',
        target: `${ITEM_FORM} >> label:Est. market value (per item)`,
        advance: {
          kind: 'field',
          valid: (v) => v.trim() === '' || money(v),
          invalid: 'Enter an amount like 40, or leave it empty.',
        },
        resumeAt: 'open-form',
        optional: true,
        skipIf: itemSaved,
      },
      {
        id: 'more',
        title: 'Condition and acquisition details',
        body: 'Open More details to record its condition, where it’s stored and when you got it (or press Next to skip).',
        target: `${ITEM_FORM} >> button:More details`,
        advance: { kind: 'click', orNext: true },
        resumeAt: 'open-form',
        optional: true,
        skipIf: itemSaved,
      },
      {
        id: 'save',
        title: 'Save it',
        body: 'Press Add item. If a field turns red, fix it and press Add item again.',
        target: `${ITEM_FORM} button[type="submit"]`,
        advance: {
          kind: 'when',
          check: (e) => itemSaved(e) && !e.has(ITEM_FORM),
        },
        resumeAt: 'open-form',
      },
      done('Your first collectible', 'The practice item stays in practice mode; your own collection wasn’t changed.'),
    ],
  },
  {
    id: 'collector-organize',
    title: 'Organizing your collection',
    summary: 'Search, categories and locations.',
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
        body: 'Search by name, category, location or notes.',
        target: 'main input[type="search"]',
        advance: { kind: 'next' },
        optional: true,
      },
      done('Organizing', 'Give items a category and a location when you add them; you can filter by both later.'),
    ],
  },
  {
    id: 'collector-valuation',
    title: 'Value: what you paid vs. what it’s worth',
    summary: 'Asking price, estimated market value and their limits.',
    group: 'insights',
    modes: ['collector'],
    practice: false,
    minutes: 2,
    steps: [
      {
        id: 'headline',
        route: '/',
        title: 'Your collection’s figures',
        body: 'Cost is what you paid. Estimated market value is your own estimate, only for items you valued. Asking price is what you’ve listed something for. None of these is money received.',
        target: ['[data-testid="hero-collection-value"]', 'main h1'],
        advance: { kind: 'next' },
      },
      done('Valuation', 'Estimates are only as good as your research: StockPilot doesn’t look up prices or appraise items.'),
    ],
  },
  {
    id: 'collector-sales',
    title: 'Optional: sales and profit',
    summary: 'Turn on sales tracking if you sell from your collection.',
    group: 'sales',
    modes: ['collector'],
    practice: false,
    minutes: 1,
    steps: [
      {
        id: 'toggle',
        route: '/settings',
        title: 'Sales & profit tracking',
        body: 'If you sometimes sell, turn this on in Settings to record sales and see realized profit. It’s off by default for collectors.',
        target: ['label:Track sales & profit', 'main [role="switch"]'],
        advance: { kind: 'next' },
        optional: true,
      },
      done('Sales tracking', 'Turning it off later keeps any sales you recorded.'),
    ],
  },
];

/** The learning path the welcome tour follows, per mode. */
export const MODE_PATHS: Record<UserMode, string[]> = {
  business: ['tour-dashboard', 'practice-add-item', 'practice-record-sale', 'inventory-levels', 'profit-by-source', 'monthly-close', 'financial-planning', 'backup'],
  reseller: ['tour-dashboard', 'ai-scanner', 'max-bid', 'bulk-lots', 'practice-record-sale', 'payouts', 'predicted-actual', 'profit-by-source', 'backup'],
  collector: ['tour-dashboard', 'collector-add', 'collector-organize', 'collector-valuation', 'collector-sales', 'backup'],
};

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

/** Lessons offered in this mode (lessons that can't run here, like the scanner when it's off, aren't listed). */
export function lessonsFor(env: StaticEnv): Lesson[] {
  return LESSONS.filter((l) => l.modes.includes(env.settings.mode) && !(l.id === 'ai-scanner' && !env.scannerEnabled));
}

/** The mode's path, minus lessons that can't run (e.g. the scanner when it's off). */
export function pathFor(env: StaticEnv): Lesson[] {
  return MODE_PATHS[env.settings.mode].map(lessonById).filter((l): l is Lesson => !!l && !l.unavailable?.(env));
}

export function stepsFor(lesson: Lesson, env: StaticEnv): LessonStep[] {
  return lesson.steps.filter((s) => !s.include || s.include(env));
}
