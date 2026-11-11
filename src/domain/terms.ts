// One set of financial terms, used by the dashboard, item pages, inventory list, Smart
// Insights and the assistant, so the same word always means the same number.
//
// These are deliberately kept apart. They are different questions with different answers:
//   inventory cost       — what you paid (money already spent)
//   total asking price   — what you've listed it for (not money received)
//   est. market value    — your own guess at what it's worth (not a sale price)
//   realized profit      — what completed sales actually earned
//   projected profit     — what unsold stock would earn at asking, if it sells

export interface Term {
  /** Short label for tiles, tables and columns. */
  label: string;
  /** One-sentence definition, including how it's calculated. */
  definition: string;
}

export const TERMS = {
  inventoryCost: {
    label: 'Inventory cost',
    definition: 'What you paid for the stock you still have: cost per item × quantity on hand. This is the money you have invested in unsold inventory.',
  },
  totalAsking: {
    label: 'Total asking price',
    definition: 'What your unsold stock is listed for: asking price × quantity, for items that have an asking price. It isn’t money you’ve received.',
  },
  marketValue: {
    label: 'Est. market value',
    definition: 'Your own estimate of what unsold stock is worth: estimated value × quantity, for items you’ve valued. It isn’t a sale price or a guarantee.',
  },
  realizedProfit: {
    label: 'Realized profit',
    definition: 'Profit from completed sales: sale price − what the items cost you − marketplace fees − shipping you paid − other expenses.',
  },
  projectedProfit: {
    label: 'Projected profit',
    definition: 'What unsold stock would earn if it all sells at its asking price, after estimated selling costs and what you paid. Not earned yet.',
  },
  margin: {
    label: 'Profit margin',
    definition: 'Realized profit as a percentage of sales revenue, for the same period.',
  },
} as const satisfies Record<string, Term>;

export type TermKey = keyof typeof TERMS;
