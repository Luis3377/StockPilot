// Plain-English explanations of the figures StockPilot shows, for help icons and the Learning
// Center's search. Each one says how StockPilot actually calculates the number (the same
// formulas as the app and docs), and never calls an estimate verified or profit cash.

import { TERMS } from '../domain/terms';

export interface HelpTopic {
  id: string;
  term: string;
  text: string;
  /** A lesson that shows it in the app. */
  lesson?: string;
  keywords?: string;
  /** The page where the figure is, with its "?" opened there ("See it in StockPilot"). */
  where?: { route: string; needsSales?: boolean };
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'revenue',
    where: { route: '/sales', needsSales: true },
    term: 'Revenue',
    text: 'The total buyers paid you for completed sales (sale price × quantity, or the total you entered). It isn’t profit: what the items cost you and your selling expenses still come out of it.',
    lesson: 'practice-record-sale',
    keywords: 'sales income',
  },
  {
    id: 'cogs',
    where: { route: '/sales', needsSales: true },
    term: 'Cost of goods sold',
    text: 'What the items you sold had cost you: cost per item × quantity sold, as recorded on each sale. For items from a bulk lot, their exact share of the lot’s cost. Unsold stock isn’t in it.',
    lesson: 'practice-record-sale',
    keywords: 'cogs cost',
  },
  {
    id: 'realized-profit',
    where: { route: '/sales', needsSales: true },
    term: 'Realized profit',
    text: `${TERMS.realizedProfit.definition} It’s profit on completed sales, not the cash in your bank account.`,
    lesson: 'practice-record-sale',
    keywords: 'net profit earnings',
  },
  {
    id: 'margin',
    where: { route: '/sales', needsSales: true },
    term: 'Profit margin',
    text: `${TERMS.margin.definition} 25% means a quarter of what buyers paid was profit.`,
    lesson: 'practice-record-sale',
    keywords: 'percent',
  },
  {
    id: 'roi',
    where: { route: '/sales', needsSales: true },
    term: 'ROI (return on investment)',
    text: 'Realized profit ÷ cost of goods sold, for the same sales. 50% means you made back what the items cost you plus half again.',
    lesson: 'practice-record-sale',
    keywords: 'return',
  },
  {
    id: 'inventory-cost',
    term: 'Inventory cost',
    text: TERMS.inventoryCost.definition,
    lesson: 'practice-add-item',
    keywords: 'stock value invested',
  },
  {
    id: 'cost-per-item',
    term: 'Cost per item',
    text: 'What you paid for one product. StockPilot uses this amount to calculate how much profit you make when the item sells.',
    lesson: 'practice-add-item',
  },
  {
    id: 'asking-price',
    term: 'Asking price',
    text: `${TERMS.totalAsking.definition} An item’s asking price is what you plan to sell one for.`,
    keywords: 'selling price list',
  },
  {
    id: 'market-value',
    term: 'Estimated market value',
    text: TERMS.marketValue.definition,
    lesson: 'collector-valuation',
    keywords: 'worth appraisal collection',
  },
  {
    id: 'projected-profit',
    term: 'Projected profit',
    text: TERMS.projectedProfit.definition,
    keywords: 'estimate forecast',
  },
  {
    id: 'max-bid',
    where: { route: '/inventory/bids/new' },
    term: 'Maximum bid',
    text: 'The most you can bid and still reach your target return: the bid plus buyer’s premium, sales tax and fixed buying costs must not exceed what you expect to net from reselling, divided by (1 + your target return). It’s an estimate from your own assumptions, not a guarantee.',
    lesson: 'max-bid',
    keywords: 'auction lot',
  },
  {
    id: 'net-proceeds',
    where: { route: '/inventory/bids/new' },
    term: 'Net proceeds',
    text: 'What sales bring in after selling costs: revenue − marketplace fees − shipping − other selling expenses. In a Max Bid plan it’s the expected resale value, less what you expect not to sell and the selling costs.',
    lesson: 'max-bid',
  },
  {
    id: 'inventory-reconciliation',
    where: { route: '/sales/close', needsSales: true },
    term: 'Inventory reconciliation',
    text: 'Beginning inventory cost + purchases ± cost corrections − cost of goods sold − write-offs and other documented changes should equal the cost of what your item records show at the end. A difference means something changed without a dated record. Figures are only marked verified when the records support them.',
    lesson: 'monthly-close',
    keywords: 'roll-forward month close',
  },
  {
    id: 'tax-reserve',
    where: { route: '/sales/planning', needsSales: true },
    term: 'Tax reserve',
    text: 'Recorded realized profit × a percentage you choose, as a planning amount to set aside. StockPilot doesn’t know your tax rate or work out what you owe, and profit isn’t the same as cash. Ask an accountant about your taxes.',
    lesson: 'financial-planning',
    keywords: 'set aside taxes planning',
  },
  {
    id: 'profit-per-hour',
    where: { route: '/insights/sourcing' },
    term: 'Profit per logged hour',
    text: 'Realized profit ÷ the hours you logged, counting only profit from sources with time logged against them. Your time isn’t subtracted from profit, and it isn’t an hourly wage.',
    lesson: 'profit-by-source',
    keywords: 'time hourly',
  },
  {
    id: 'payout',
    term: 'Payout',
    text: 'Money a marketplace transferred to your bank. It’s a transfer of money you already earned (less fees, refunds and holds), not extra profit. Only completed payouts count as paid out.',
    lesson: 'payouts',
    keywords: 'ebay bank transfer',
  },
  {
    id: 'sell-through',
    term: 'Sell-through',
    text: 'For a bulk lot: the share of its estimated resale value that has sold. It’s shown separately from the share of units sold, so the two are never confused.',
    lesson: 'predicted-actual',
  },
  {
    id: 'practice-mode',
    term: 'Practice mode',
    text: 'A separate set of sample records used by Learning Center lessons. Nothing in practice mode changes your own inventory, sales or reports, and leaving it takes you back to them exactly as they were.',
  },
  {
    id: 'restore',
    term: 'Restoring a backup',
    text: 'Settings → Restore from backup puts the records from a backup file back on this device — for a new phone, another browser, or after something went wrong. It replaces the records that are here now, so it asks first, and it’s turned off while a practice lesson is running.',
    lesson: 'backup',
    keywords: 'restore recover move device phone import backup file',
  },
  {
    id: 'backup',
    term: 'Backup',
    text: 'A file with your records and photos. StockPilot keeps everything in this browser on this device, so download a backup regularly and keep it somewhere safe.',
    lesson: 'backup',
  },
];

export function helpTopic(id: string): HelpTopic {
  const t = HELP_TOPICS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown help topic ${id}`);
  return t;
}
