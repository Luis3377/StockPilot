# Manual beta testing: first consolidated fix round

This round fixes what 24 hands-on test scenarios found. It adds no new features. Every confirmed accounting or data-integrity bug has a regression test (see [Tests](#tests)). The calculations that passed manual testing are pinned in `src/insights/provenCases.test.ts`.

## Priority 1: financial accuracy

| Finding | Root cause | Now |
| --- | --- | --- |
| A. The year-end worksheet's line 42 ($168.00) was said to agree with "recorded cost of goods sold", while 2026 sales cost $2,324.00 | The inventory ledger began Nov 14, 2026. The roll-forward, and so the worksheet, covered only what was recorded after that. Its comparison used the ledger's own $168.00 and called it cost of goods sold "from recorded sales". A start date inside the year was also hidden whenever there was an unexplained difference | Year figures show the year's full sales cost of goods sold ($2,324.00) apart from the part in the inventory records ($168.00), and explain the $2,156.00 (sales recorded before the records began, and any unmatched edits). Lines 35, 36, 40 and 42 are **not available / needs your accountant** for such a year. Sales cost of goods sold is never substituted. The summary, movement table, checklist, sales CSV (`in_inventory_records`) and assistant say so |
| B. Business-wide "$909.30 per logged hour" from $1,818.59 of profit and 2 hours | All realized profit ÷ all logged hours, whether or not that profit had any time behind it | Matched records: profit of the sources with time ÷ their hours ($40 ÷ 2 h = $20/h). Coverage is shown: sales and revenue share with time, profit with none, unlinked hours. The source figure is unchanged. Shared time is still split once |
| C. A sale dated Jan 30 for headphones bought Jun 17 was accepted silently | Sales were never compared with the item's (or its lot's) purchase date | The sale form explains the conflict before saving. Saving needs either a stated reason (kept on the sale and in backups) or an explicit correction of the item's purchase date. Dates are never changed silently. Older records and imports aren't rejected; they show in sale warnings. As dated, such a sale counts in its month, before the item was in inventory |
| D. "Paid out $421.18" included a pending $31.25 payout | The tile added up every payout's amount | Only completed payouts count ($389.93). Pending and failed payouts are shown apart, to the cent |
| E. A purchased Max Bid plan looked editable, and Delete removed its frozen forecast | Fields were disabled without saying why. Delete wasn't restricted | A purchased plan can't be deleted while its lot exists. It is labelled a read-only historical prediction, with how to correct things (duplicate it, or edit the lot) |

## Priority 2: accounting and workflow

- **F. Inventory losses:** Sales & Profit shows documented losses for the period next to realized profit:
  - lost, damaged or missing, net of units found, and "realized sales profit after documented inventory losses";
  - personal use and returns apart;
  - the label "not net income".
  
  Adjustments never involve a sale, so there's no overlap with cost of goods sold. The figures match Monthly Close's write-off line.
- **G. Bulk lot split:** a plan with resale estimates becomes a lot split **by estimated resale value**, even if some items lack one. The chosen split is shown next to the save button.
- **H. Sell-through:** shown as "Sell-through (share of estimated value sold)" with "Sell-through by units" alongside.
- **I. Monthly Close:**
  - purchases are counted as buying transactions (a bulk lot is one);
  - the adjustments row has a Verified / Not verified label;
  - margins use one decimal, as in Sales & Profit (also in the Controller's Report);
  - an unperformed reconciliation with eBay sales is listed as an issue.
- **J. Count Check:** no reason is preselected. Every applied adjustment needs a chosen reason, in the form and in the data layer.

## Priority 3: usability

1. **Cards:** cards without a photo are compact. The list view stays available and remembered.
2. **Low-stock default:** one-of-a-kind items don't get the default low-stock alert.
3. **Projected profit:** it is calculated correctly. The selling-cost rate comes from your sales history and is recalculated after every sale. It is now shown to two decimals and explained, which is why projected profit can move by a cent.
4. **Recovered vs realized:** lots show "Investment recovered" (net proceeds against the whole cost) apart from realized profit.
5. **Fully sold lots:** they show "All sold" instead of an empty projection.
6. **Minus sign:** money uses one minus sign everywhere: "−$10.20".
7. **Lot edit button:** it says "Review cost changes" or "Save changes", whichever will happen.
8. **Generic source names:** names that only say the kind of place prompt for the real supplier; unknown sources are still allowed. Max Bid no longer uses the plan's kind as the lot's source.
9. **Time links:** they start on "Choose…" and are never preset to the first source.
10. **Max bid comparison:** "Exactly the maximum bid" instead of "$0.00 below".
11. **Top products:** "Top products by revenue", which is how the list is ranked.
12. **Assistant labels:** answers are labelled as calculated by StockPilot. AI only explains in words, on request, in builds that have it.
13. **Unmatched eBay sales:** they get a labelled, unconfirmed suggested item (by SKU, or a clearly similar name; never a tie). The user confirms it by recording the sale.

## Compatibility

- **New optional field:** `Sale.dateException` (older sales have none).
- **Older data and backups:** they load unchanged; nothing is re-dated or rewritten.
- **Monthly Close:** months with eBay sales and no imported reports now show the reconciliation as an issue, so an earlier "not applicable" decision on that step is asked again.

## Tests

| Finding | Tests |
| --- | --- |
| A | `src/insights/yearEnd.test.ts` — "a year whose inventory records began part-way through" (coverage, worksheet, summary, checklist, CSV, assistant, other periods, mid-year start with a difference); `e2e/betafixes.spec.ts` |
| B | `src/insights/sourcing.test.ts` — "profit per hour uses matched records…"; `src/insights/sourcingAnswers.test.ts`; `e2e/sourcing.spec.ts` |
| C | `src/domain/saleDates.test.ts`; `e2e/betafixes.spec.ts` |
| D | `src/domain/reconcile.test.ts` — "payout totals by status"; `e2e/betafixes.spec.ts` |
| E | `src/domain/bids.test.ts`; `e2e/betafixes.spec.ts` |
| F | `src/insights/adjustments.test.ts`; `e2e/betafixes.spec.ts` |
| G, H | `src/domain/bids.test.ts`; `src/insights/performance.test.ts` |
| I | `src/insights/close.test.ts` |
| J | `src/domain/actions.test.ts`; `e2e/count.spec.ts` |
| P3 items 8, 9, 13 | `src/domain/bids.test.ts`; `src/domain/timeLinks.test.ts`; `src/domain/reconcile.test.ts` |
| Proven calculations | `src/insights/provenCases.test.ts` |
