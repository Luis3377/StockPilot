# Monthly Close + Controller's Report

Signature Feature 5. Monthly Close is a month-end checklist that walks you through closing a month without needing accounting knowledge. You:

- review the month's records step by step;
- check that inventory adds up to the cent;
- read a plain-English Controller's Report comparing the month with the one before;
- finalize the month, which protects its figures from accidental changes.

Every figure comes from records you saved: sales, purchases, adjustments, imported marketplace reports and the inventory ledger. Nothing is estimated. Where the records can't prove something, the page says so.

## Where to find it

- **Sales & Profit → Monthly Close** (button at the top of Sales & Profit), at `#/sales/close`. Choose a month and year.
  - The month that opens by default is the latest one that has ended and isn't closed.
  - The chosen month stays in the address (`?month=2026-10`).
- **Preview report / Closing report** opens the Controller's Report (`#/sales/close/2026-10/report`). It has **Print / Save as PDF** and **Download (.html)** buttons.
- **History** (`#/sales/close/history`) lists every closed month, its versions and the full change history.
- **The assistant** in Smart Insights answers month questions (see [The assistant](#the-assistant)).

## The financial summary

| Figure | Definition | Label |
| --- | --- | --- |
| Reporting period | First to last day of the month (local dates). "In progress" until it ends | |
| Sales revenue | Σ sale price × quantity, for sales dated in the month | Verified |
| Cost of goods sold | What the sold units cost (recorded with each sale; a bulk lot item's exact share) | Verified, or **Incomplete** when some sales have no cost |
| Gross profit | Revenue − cost of goods sold (and gross margin = gross profit ÷ revenue) | as above |
| Marketplace fees, Shipping, Other selling expenses | As recorded on the month's sales | Verified |
| Realized profit | Revenue − cost of goods sold − fees − shipping − other expenses (and margin = realized profit ÷ revenue). Matches Sales & Profit for the month to the cent | Verified / Incomplete |
| Beginning and ending inventory cost | From the roll-forward (below) | Verified, **Not verified** (partly covered), **Difference** or **Missing** |
| Inventory purchases | Items, bulk lots (purchase price + freight, premiums and other buying costs) and restocks bought in the month | Verified / Not verified / Missing |
| Adjustments and corrections | Write-offs, units found, cost corrections, deleted items, sale corrections | |
| Payout reconciliation | Reconciled, Issues, Partial (reports cover part of the month) or **Not performed** (no reports cover it) | |
| Outstanding issues | Issues needing attention across the checklist | |
| Sourcing trip expenses | Shown when present. Recorded separately; **not** included in realized profit (as on Sourcing Performance) | |

**What the labels mean:**
- **Verified**: recalculated from your records, with the checks passing.
- **Not verified**: only partly covered by the records.
- **Missing**: can't be worked out from the records.

No estimated values are used anywhere.

## The closing checklist

| # | Step | What it shows | Issues that need attention | Not applicable when |
| --- | --- | --- | --- | --- |
| 1 | Review recorded sales | Every sale dated in the month, with revenue and profit | Possible duplicates; sales recorded for $0 | No sales |
| 2 | Review inventory purchases | Items, lots and restocks bought | Items added with no cost; purchases before the inventory ledger began | No purchases (and the ledger covers the month) |
| 3 | Review adjustments and write-offs | Physical changes (write-offs, units found, counts) and financial corrections (cost edits, deleted items, edited or cancelled sales) | Items deleted with stock; edited or cancelled sales | No adjustments |
| 4 | Confirm inventory counts | Count Check results completed in the month | Differences not applied; a count still in progress | No count was done ("Not performed") |
| 5 | Review marketplace payouts | Payouts dated in the month and their status | Unreconciled payouts; recorded sales missing from the reports | No reports cover the month. Shown as **not performed**, never as reconciled |
| 6 | Check refunds and returns | Refunds in imported reports; returned items added back to stock | Refunds not reviewed in Payouts | Nothing to review, or no reports |
| 7 | Review missing costs and low margins | Sales without a cost; sales below your low-margin threshold; stock without a cost | All of these | — |
| 8 | Review the month's financial summary | The P&L, roll-forward and reconciliation status | Unexplained inventory difference; roll-forward not fully verifiable; month not over | — |
| 9 | Finalize the month | Ready when steps 1–8 are done and the month has ended | | |

Rules:

- **Steps are never ticked automatically**, not even when a month has no records. Each step needs your decision:
  - **Mark reviewed**: only when nothing needs attention.
  - **Not applicable**: only when there's nothing to review, or the check couldn't be performed. A pre-filled explanation is shown, and you can edit it.
  - **Acknowledge issues**: keeps open issues on record; a note is required.
- **Stale decisions**: each decision records what the step showed. If the step's records change later, the decision no longer counts and the step must be reviewed again.
- **Records behind each step**: every step lists its records ("Show the records"), with links to the item, lot, payout or Count Check behind each one.
- **Undo**: a decision can be undone until the month is closed. Every decision and undo is logged.

## The inventory roll-forward

```
  Beginning inventory cost
+ Items bought
+ Bulk lots bought (purchase price + acquisition costs, split exactly across the lot's items)
+ Restocks
± Cost corrections (cost-per-item edits, lot cost changes)
− Cost of goods sold (the existing cost-allocation rules: sale cost × quantity, exact lot shares)
− Write-offs and other documented decreases
+ Units found and other documented increases
− Items deleted with stock
± Sale edits and cancellations
= Expected ending inventory cost
  compared with: ending inventory cost from the item records (Σ quantity × cost per item)
  = Unexplained difference (to the cent)
```

### The two sides come from different records

- **The expected ending** is the beginning balance plus the dated movements. Those come from:
  - sales (cost of goods sold, by sale date);
  - quantity adjustments (by the day they were made);
  - the **inventory ledger**.
- **The item-record ending** is today's Σ quantity × cost per item, less any recorded movements dated after the month. So it isn't the expected figure copied to both sides.
- A difference means the item records changed in a way no dated record explains, for example data restored from an older copy over newer records.

### The inventory ledger (new)

StockPilot already recorded sales and quantity adjustments, but several changes left no dated trace:
- item cost edits, and "apply to recorded sales", which rewrote the cost on past sales;
- deleted items;
- edited or cancelled sales;
- item purchases themselves.

The ledger now records each of these, with the day it counts on (a purchase's purchase date, otherwise the day it was made). It does so by comparing the data before and after every saved change and keeping whatever sales and adjustments don't already account for. Nothing is estimated: each amount is the exact change in Σ quantity × cost, in whole cents.

**How double counting is avoided:**
- A restock is an adjustment, so it's never also a ledger purchase.
- A lot is recorded as its items' allocated costs, which add up to the lot total exactly.
- A sale's cost is never repeated in the ledger.

### When the ledger starts, and older data

- The ledger starts the first time this version loads your data, with each item's cost on hand as the **opening balance**. It also starts after restoring a backup from an older version.
- Months that end **before** that day are reported as **Not available**. Their sales figures still show, but inventory balances and purchases can't be verified: purchases of items deleted before then, and cost edits made before then, left no dated record.
- The month the ledger began in is **partly verified**. It covers what was recorded from that day on, and the page shows how much of the month's cost of goods sold predates the ledger.
- A dataset started fresh with this version has a complete ledger, so every month can be verified.

### Beginning balance

- **When the previous month is closed:** its closing ending balance (from the item records at the time). If the ledger disagrees, the page shows both figures.
- **Otherwise:** the ledger's balance at the start of the month.

### Fractional costs

A lot or average cost such as $3.3333 per unit is handled exactly as everywhere else. Units leave inventory at $3.33, $3.34, $3.33…, so the cents always add up.

## Closing and reopening

- **Finalize month** is available once the month has ended and every step is done. If issues are still open (acknowledged), you must confirm them, and you can add a closing note.
- **Closing records:**
  - the closing date and time;
  - the financial summary;
  - the roll-forward (lines, balances, difference, notes);
  - every checklist decision and its issues;
  - the open issues you acknowledged, with your note;
  - the Controller's Report as generated.
- **Protection:** while a month is closed, any change that would alter its figures is refused with "That would change October 2026, which is closed. Reopen October 2026 first, or use a date in an open month." This covers:
  - sales dated in it (new, edited, deleted);
  - purchases dated in it;
  - rewriting the cost on its sales;
  - its trip expenses.

  Changes dated in open months go through as usual, such as today's sales, a cost correction made today, or renaming an item. The check runs for every saved change, so it covers every form, imports and bulk actions.
- **Reopen month** requires a reason:
  - The close is kept and marked **superseded**, with the reason and time.
  - An audit event is recorded.
  - The month becomes editable, and the checklist must be completed again before closing.
  - Closing again creates **version 2**. Version 1 stays exactly as it was.

**What this protection is:** the close records, decisions and audit log are stored in this browser with the rest of your data (and in backups). They're a record of what was done and an accident guard, **not** a tamper-proof or legally immutable ledger.

## The Monthly Controller's Report

The report compares the month with the previous month, in plain English, from saved records only.

**Sections:**
1. Executive summary.
2. Revenue and profitability: a table with month, previous month and change for revenue, cost of goods sold, gross profit and margin, fees, shipping, other expenses, realized profit and margin, and units.
3. What changed.
4. Product categories (best and weakest).
5. Inventory movement: purchases, beginning and ending inventory, roll-forward status, and slow-moving stock with the cash tied up in it.
6. Sourcing performance.
7. Marketplace reconciliation.
8. Important exceptions.
9. Recommended follow-up for next month.
10. Limitations.

**How statements are labelled:**
- **Verified:** arithmetic on the records. The change in realized profit splits exactly into revenue, cost of goods sold, fees, shipping and other expenses, and the parts add up to the cent.
- **Contributing factor:** records that account for part of a change. Examples:
  - the categories with the biggest profit change, with their margins (e.g. "its margin decreased from 23% to 13%");
  - loss-making sales by category ("3 Sneakers sales generated $145.00 in recorded losses");
  - sources whose profit changed most.
- **Possible explanation (not proven):** patterns that may explain a change: units sold, average revenue per unit, fees or shipping as a share of revenue. A pattern pointing the other way is said to not explain the change.
- **Needs attention** and **Limitation:** open issues, and gaps in the records. Examples: payouts not reconciled, no opening balance, sales without a cost, no bank data.

**Using the report:**
- **Links:** each statement links to the records behind it (items, lots, sources, payouts).
- **Drafts:** an open month shows a draft from the current records.
- **Closed months:** a closed month shows the report **as kept at closing**. Earlier versions and today's recalculation are one click away, and they never replace each other.
- **Disclaimer:** every report says *"Generated from user-maintained StockPilot records. This is not an audited financial statement, and it is only as complete as the records it was made from."*
- **Print / Save as PDF:** uses the browser's print dialog. The app's navigation is hidden when printing.
- **Download (.html):** saves a standalone file with the same text, which opens in any browser and can also be printed to PDF. No paid service is used.

### Example

From the test fixture shop. September: records and a liquidation pallet. October: card sales, five drills, a deleted lamp.

> **Executive summary**
> Verified: Realized profit increased by $131.33 compared with September 2026: $128.00 → $259.33.
> Verified: Revenue was $418.00 from 3 sales (September 2026: $250.00 from 2 sales). Realized margin 51.2% → 62.04%; gross margin 69.2% → 80.22%.
> Contributing factor: Tools: realized profit $68.00 in September 2026 → $248.00 in October 2026 (+$180.00); its margin increased from 45.33% to 62%.
>
> **What changed**
> Verified: Realized profit changed by +$131.33. It splits exactly into: sales revenue +$168.00, cost of goods sold −$5.67, marketplace fees −$13.00, shipping −$18.00.
> Possible explanation (not proven by the records): Units sold went from 9 to 7. Profit moved the other way, so the number of units sold doesn't explain the change.
>
> **Inventory movement**
> Verified: Inventory roll-forward: Verified: the item records match beginning inventory plus the month's recorded movements, to the cent.
>
> **Important exceptions**
> Needs attention: Lamp was deleted with $8.00 of stock at cost, on Oct 15, 2026. If it was lost or damaged, that's a write-off; if it was a mistake, re-add it.
>
> **Limitations**
> Payouts weren't reconciled, so recorded sales weren't checked against what the marketplace paid. Bank transactions aren't part of StockPilot, so cash in the bank isn't verified here.

## The assistant

The assistant's answers are rule-based, and each comes with a calculation the app re-adds from its records. The AI layer (beta builds) only maps wording to these questions and may explain verified figures; it never calculates.

| Question | Answer | Calculation |
| --- | --- | --- |
| How did my business perform this month? (or "in October") | Revenue, realized profit and margin, compared with the previous month, plus roll-forward status | The month's realized profit, sale by sale |
| Why did my profit decline? / What changed compared with last month? | The exact split of the change, then contributing factors and possible explanations. If profit didn't decline, it says so | Last month's profit + each change = this month's, re-added from both months' sales |
| Which expenses increased? | Cost of goods sold, fees, shipping and other expenses that rose, with amounts | Same |
| What should I review before closing? | The open checklist steps of the latest month that has ended and isn't closed, with their first issue | The month's realized profit |
| Which products hurt my profitability? | Loss-making sales (else low-margin sales), by item | Realized profit of those sales |
| Are my payouts reconciled? | The month's reconciliation status, or "not performed" | The first open payout, when there is one |
| What inventory differences remain unexplained? | The roll-forward difference, or why it isn't available | The roll-forward: beginning + each movement line (re-added from its records) = expected ending, beside the item records and the difference |

**AI cost:** the AI interpret step gained eight intents, so its worst-case reservation rises slightly, from $0.0319 to $0.0324 on Sonnet. It uses the same shared $10 monthly budget, invite codes, limits and security. The explain step, the AI models and the spending limits are unchanged, and no new service was added.

## Accounting and data integrity

| With | How it's handled |
| --- | --- |
| Bulk lots | Purchases are the items' allocated costs (= the lot total, once). Cost of goods sold uses each item's exact lot share, so a partly sold lot never counts its full cost. Lot cost edits are cost corrections dated when made |
| Cost of goods sold | The cost recorded on each sale, as everywhere in StockPilot |
| Payout reconciliation | Payouts are transfers of money, not revenue. Status per month: reconciled, issues, partial or not performed |
| Explainable AI | Same calculation format and verifier as every other answer |
| Predicted vs. actual | Unchanged; it reads the same sales and lots |
| Profit by source | The report's sourcing section uses Sourcing Performance figures for each month |
| Individual and bulk purchases | Dated by purchase date. A purchase-date edit moves the purchase to its new month (refused if either month is closed) |
| Inventory adjustments | Physical quantity changes are kept apart from financial cost corrections |
| Refunds and returns | Refunds come from imported marketplace reports and are flagged when unreviewed. StockPilot never changes a sale on its own |
| Partial sales | Fractional unit costs leave inventory to the exact cent |
| Sourcing expenses | Shown separately; never added to item costs or subtracted from realized profit |
| Months | Sales by sale date; adjustments, cost corrections and deletions by the local day they were made; purchases by purchase date. Exact calendar-month boundaries |

Inventory purchases are not losses: their cost counts when the items sell.

### Records that can change after they're created

The audit behind this feature found these records can change after they're created. Each is now covered:

| Record | Change | Now |
| --- | --- | --- |
| Sale | Edit (amounts, quantity, date, item) or delete | Inventory effect in the ledger; refused in closed months |
| Item | Cost per item edit | Cost correction in the ledger, dated |
| Item | "Apply to recorded sales" (rewrites cost on past sales) | Recorded; refused when a closed month's sales would change |
| Item | Quantity edit | Already an adjustment (unchanged) |
| Item | Delete | "Items deleted with stock" in the ledger; flagged in the checklist |
| Item | Purchase date edit | Moves the purchase between months; refused for closed months |
| Bulk lot | Cost edits | Already in lot history; cost correction in the ledger |
| Trip | Expenses | Part of a closed month's protected figures |
| Marketplace reports | New imports | Never change sales; the closed report is kept, and today's recalculation is shown separately |

## Prepared for year-end

Each close keeps the month's figures and full roll-forward. Twelve closed months therefore give year-end reporting:
- monthly beginning and ending inventory cost;
- purchases, cost of goods sold and adjustments, by month;
- their reconciliation status;
- the supersede history.

The ledger keeps the dated movements needed for a year-end roll-forward. The year-end feature itself isn't built yet.

## Stored data and compatibility

- **New, both optional:**
  - `data.inventoryLedger`: `startedAt` and append-only `events`.
  - `data.monthlyClose`: `closes` (versioned snapshots), `decisions` (checklist decisions for open months) and `audit`.
- **Older data and backups** load with the ledger starting on load and no closes. No schema bump was needed.
- **Backups** include the ledger, closes, decisions and audit log.
- **Nothing historical is rewritten or deleted:** reopening marks a close superseded, and corrections are new dated ledger records.

## Tests

| Requirement | Where |
| --- | --- |
| Month selection and boundaries | `src/insights/monthly.test.ts` — "month helpers", "uses exact month boundaries"; `e2e/close.spec.ts` (default month) |
| Revenue and profit; month-over-month | `src/insights/monthly.test.ts`; `src/insights/close.test.ts` — "controller's report"; `e2e/close.spec.ts` |
| Roll-forward: beginning/ending, bulk lots, partial sales, purchases, adjustments, write-offs, deletions, fractional costs, cost corrections | `src/insights/monthly.test.ts` — "inventory roll-forward" |
| No false zero; missing historical records | `src/insights/monthly.test.ts` — "shows an unexplained difference…", "before the ledger began…"; `e2e/close.spec.ts` — "months before the inventory ledger began…" |
| Unreconciled payouts / not performed; refund warnings | `src/insights/close.test.ts`; `src/insights/closeAnswers.test.ts`; `e2e/close.spec.ts` |
| Checklist rules, stale decisions, missing costs, low margins | `src/insights/close.test.ts` — "closing checklist" |
| Finalizing, protection, reopening, snapshots, audit | `src/insights/close.test.ts` — "closing and reopening a month"; `e2e/close.spec.ts` |
| Exported report accuracy | `src/insights/close.test.ts` — "the kept report and its downloadable HTML…"; `e2e/close.spec.ts` (downloaded file) |
| Backup and restore | `src/insights/monthly.test.ts`; `src/insights/close.test.ts` |
| Assistant answers with re-checked calculations | `src/insights/closeAnswers.test.ts`; `e2e/close.spec.ts` |
| Phones and accessibility | `e2e/close.spec.ts` on desktop and an iPhone-sized viewport: no sideways scrolling, axe on the open month, the closed month, the report and history |

## Limitations

- **Months before the ledger** (older data) can't have a verified roll-forward or complete purchases. They're marked as such.
- **Only StockPilot's records are checked.** Bank transactions and cash aren't in StockPilot, and marketplace data is only as complete as the imported reports.
- **The roll-forward can say that an inventory difference exists, not when it happened.** A difference shows up in every month not covered by a later close.
- **Stored in the browser:** closing protection and the audit log live in this browser's storage, so they're not tamper-proof. Restoring an older backup replaces them.
- **Slow-moving stock in the report is "as of today"**, not as of the month's end.
- **Day boundaries are this device's:** timestamps (adjustments, edits) count on the local day they were made.
- **One currency:** the report uses your currency setting.
