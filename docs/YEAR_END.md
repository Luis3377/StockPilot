# Year-End Inventory Roll-Forward & Accountant-Ready Summary

Year-End Review shows where a business's inventory money went over a year and whether the inventory records truly reconcile:
- what inventory cost at the start of the year;
- what was bought, including buying costs;
- what was sold, at cost;
- what was damaged, lost, used personally, returned or corrected;
- what was left at year-end.

It also says whether the records are enough to support those balances. It is built on the inventory ledger and the Monthly Close (see [MONTHLY_CLOSE.md](MONTHLY_CLOSE.md)). Nothing is estimated, and figures the records can't support are labelled, never presented as verified.

The wording is general on purpose (inventory, merchandise, items), so it works for any business that buys, holds and sells goods: independent retail and specialty shops, wholesalers, thrift and resale, and online sellers. Manufacturing (raw materials, labor, overhead, work in progress) and service-only businesses aren't modeled, and the feature doesn't pretend otherwise.

## Where to find it

- **Sales & Profit → Year-End Review** (`#/sales/year-end`, with `?year=2026`). There's also a link from Monthly Close.
  - The year that opens by default is the latest past year that isn't finalized.
  - Periods are calendar years. Every calculation takes a period (key, start, end, label), so fiscal years can be added without changing the stored data.
- **Accountant summary** (`#/sales/year-end/2026/report`): Print / Save as PDF, Download (.html), and three CSV files.
- **The assistant** in Smart Insights answers year-end questions (see [The assistant](#the-assistant)).

## The year at a glance

| Figure | Where it comes from | Label |
| --- | --- | --- |
| Beginning inventory | The previous year's finalized review, else its December close, else the inventory ledger | Verified, **Not verified** (records began during the year) or **Missing** |
| Purchases and acquisition costs | Items, bulk lots (purchase price plus freight, buyer's premiums, fees and tax recorded on the lot, split exactly across its items, counted once) and restocks, dated in the year. Buying costs on lots are shown separately | as above |
| Inventory cost corrections | Cost-per-item edits and lot cost changes, dated when made | |
| Cost of goods sold | From recorded sales (each sale's cost of the units it sold; bulk-lot items at their exact share) | Verified |
| Write-offs and other movements | Damaged, lost or other documented decreases; personal use; returns added back; units found; deletions; sale edits | |
| Expected ending inventory | Beginning + the year's movements | |
| Independently determined ending inventory | A designated year-end count, otherwise the item records at year-end | |
| Unexplained difference | Independent ending − expected ending, to the cent | Verified at $0.00, otherwise **Difference** |
| Monthly closing coverage | How many of the 12 months are closed | |
| Year-end review status | In review, ready to finalize, or finalized | |

## The annual reconciliation

```
  Beginning inventory (Jan 1)
+ Items bought
+ Bulk lots bought (purchase price + acquisition costs, split across their items)
+ Restocks
± Cost corrections
− Cost of goods sold (recorded sales)
− Write-offs and other documented decreases (damaged, lost, stolen, counted short)
− Withdrawn for personal use
+ Units found
+ Returns added back to stock
− Items deleted with stock
± Sale edits and cancellations
= Expected ending inventory (Dec 31)
  compared with the independently determined ending inventory
  = Unexplained difference
```

- **Two separate sides.** The expected ending comes from the beginning balance plus dated movements. The independent ending comes from either:
  - **the item records at year-end:** today's Σ quantity × cost, less movements dated after Dec 31; or
  - **a physical year-end count.**

  They are never computed from the same figure, so a $0.00 difference is earned, not assumed.
- **Movement types follow their accounting treatment.**
  - Restocks are purchases.
  - Returns ("Returned to stock") and units found add inventory back.
  - Personal use ("Used personally") is a withdrawal, kept apart from write-offs.
  - Losses are kept apart from merchandise sold.
  - Deleted items are their own line.
  - Cost edits are corrections dated when made.
  - Every line lists its records with links.
- **Fractional costs stay exact.** A lot split into six plates at $8.3333 leaves inventory as $8.33 / $8.34 / … so nothing is lost or invented.

### Example (the test fixture)

**2025:**
- Bought 4 lamps at $12.50, and an estate box for $90 + $10 freight, split into a $50 vase and six plates at $8.3333.
- Sold a lamp on Dec 20 and two plates on Dec 31.
- Beginning $0.00 + purchases $150.00 (including $10.00 freight) − cost of goods sold $29.17 = **$120.83**, and the item records agree.

**2026:**

| | |
| --- | --- |
| Inventory at Jan 1, 2026 | $120.83 |
| Items bought | +$80.00 |
| Restocks | +$28.00 |
| Cost corrections | +$1.60 |
| Cost of goods sold | −$35.33 |
| Write-offs (damaged lamp) | −$13.10 |
| Withdrawn for personal use (vase) | −$50.00 |
| Returns added back to stock (a plate) | +$8.33 |
| Items deleted with stock (rug) | −$80.00 |
| **Expected inventory at Dec 31, 2026** | **$60.33** |
| Item records at year-end | $60.33 |
| Unexplained difference | $0.00 |

The 2026 sale of a plate on Jan 2 is in 2026, and the Dec 31 sale is in 2025: the year boundaries are exact.

## Year-end physical count

Use **Count Check** (count everything: no category or location filter) on or near Dec 31, then choose it under **Year-end inventory count**. Any count completed within a month either side of the year-end can be chosen.

- **What it shows:** recorded and counted quantities, the difference, the cost impact, and a status for each item: matches, **needs recount** (difference not applied), missing or damaged (applied decrease), or found (applied increase).
- **Applied differences are recorded once,** as a dated adjustment with a reason (Count Check's existing behaviour). Past quantities are never rewritten.
- **When the count was taken matters:**
  - **On Dec 31:** the count is the year-end.
  - **After Dec 31:** the movements recorded between Dec 31 and the count are taken from the records, and the differences found are assumed to have existed at year-end. The page says how many movements and how much.
  - **Before Dec 31:** the movements recorded between the count and Dec 31 are taken from the records.
- **Counted ending:** the item records at year-end plus any differences the records don't show at year-end (applied after Dec 31, or not applied).
- **Partial counts** are labelled; items not counted come from the records.

## Monthly coverage (all 12 months)

Each month shows one of these statuses:

| Status | Meaning |
| --- | --- |
| Closed and verified | Closed, with a verified roll-forward and no open issues |
| Closed with exceptions | Closed with acknowledged issues, or a partial or differing roll-forward |
| Open (reopened) | Reopened and not closed again |
| Not closed | Ended but never closed |
| Not fully verifiable | Before StockPilot's dated inventory records began |
| Not over yet | |

- **Chain checks:** consecutive closes are compared (each month's beginning against the previous month's ending), and so are the first and last closes against the year's beginning and ending. Gaps are listed with amounts.
- **Sums:** when all 12 months are closed, the closes' revenue, cost of goods sold, realized profit and purchases are added up and compared with the year's records. Any difference is listed; with nothing changed, they agree exactly (tested).
- **No backfilled records:** records are never created for periods before the inventory ledger.

## Missing information

- **Before the inventory ledger began** (data from older versions): the year shows **Cannot fully verify**. It names the missing evidence (the inventory cost on Jan 1; purchases, write-offs and cost changes during the year), shows "Not available" instead of amounts, and has no difference. Sales still come from the sale records.
- **The ledger began during the year:** beginning inventory is the opening balance on the day the ledger began. It's marked **Not verified**, with the missing evidence listed.
- **Monthly gaps:** months that aren't closed are listed in the checklist and the summary.
- **No count:** the summary says ending inventory comes from the item records, not a count.

## Review, finalizing and reopening

Six steps, each needing a decision (reviewed, not applicable with an explanation, or open issues acknowledged with a note), as in Monthly Close:
1. Check the monthly closes.
2. Confirm beginning inventory.
3. Review purchases, corrections and write-offs.
4. Reconcile ending inventory.
5. Year-end count ("not performed" when none is chosen).
6. Review the summary.

A decision goes stale if its records change.

- **Finalize** is available once the year is over and every step is decided, with open issues confirmed. The review keeps:
  - the figures;
  - the full roll-forward;
  - the 12-month coverage, with each close's version;
  - the count reference;
  - every decision;
  - open issues and your note;
  - the finalization time;
  - the version and the accountant summary.
- **Reopen year** requires a reason. The review is kept as **superseded**, and the next finalization is version 2.
- **Audit history:** every decision, count choice, finalization, reopening and flag is listed.

### How month-end and year-end locking interact

- **Closed months stay locked** by Monthly Close. A sale dated in a closed month is refused with the monthly message.
- **A finalized year also refuses changes to any of its months,** including months that were never closed. The message is: "Reopen the 2026 review first…".
- **Reopening a closed month** inside a finalized year is allowed, but it is an explicit correction path:
  - The reopen dialog warns that the year will be flagged.
  - A **flagged** event is added to the year's audit.
  - The year shows **Finalized · needs re-review**, listing why: the month reopened, a month closed again, or figures that now differ.
  - Corrections in that month are then allowed.
  - The finalized figures never change by themselves. Reopen the year to review and finalize it again.
- **Not tamper-proof:** like monthly closes, all of this is stored in the browser with your data and in backups. It's a record and an accident guard, not a tamper-proof log.

## The accountant-ready summary

The summary has these sections:
1. Summary, in plain words.
2. Inventory movement (table).
3. Inventory at year-end and the count.
4. Record completeness: ledger start, beginning evidence, each month, chain checks and sums.
5. Supporting details (sales, items on hand at year-end, the largest adjustments).
6. Significant warnings.
7. The optional tax-preparer worksheet.

Every line comes from records and links to them on screen. The summary carries: *"Generated from user-maintained StockPilot records. This is not an audited financial statement or a tax return, and it is only as complete as the records it was made from."*

Example summary (2026 above):

> On Jan 1, 2026 your inventory cost $120.83 (what you paid for the goods on hand).
> During 2026 you bought $108.00 of inventory.
> The goods you sold had cost you $35.33 (cost of goods sold, from 2 recorded sales bringing in $80.00).
> $13.10 was written off as damaged, lost or otherwise removed; $50.00 was taken for personal use; $80.00 left with items deleted from the records; $8.33 came back as returns or units found; cost corrections changed inventory by $1.60.
> That leaves $60.33 of inventory expected at Dec 31, 2026. The item records show $60.33: they agree to the cent.
> The records support these balances: beginning inventory is documented, every movement is dated and linked to a record, and the ending balance agrees.

**Exports:**
- **Print / Save as PDF:** the browser's print dialog. Navigation is hidden when printing.
- **Download (.html):** a standalone file of the finalized (or draft) summary.
- **CSV files, from today's records:**
  - **Inventory movements:** date, movement type, item, detail, cost change. They add up to each roll-forward line.
  - **Sales and cost of goods sold:** each sale's revenue, cost of goods sold, fees, shipping, other costs and profit.
  - **Inventory at year-end:** item, SKU, category, units and cost at Dec 31, including items deleted since. They add up to the item-records ending.
  - CSV cells are protected against spreadsheet formula injection.

## Optional tax-preparer worksheet

The worksheet is organized like Schedule C, Part III, to support a tax preparer. It is not tax advice.

| Line | What StockPilot shows |
| --- | --- |
| 33 Method | **Needs review.** Explains that StockPilot records each item at its own cost (lots split by the chosen method; restocks average). The method is for the accountant |
| 34 Change in method | **Needs review** |
| 35 Beginning inventory | Recorded figure when verified; otherwise **needs review**, with the missing evidence |
| 36 Purchases less personal use | Recorded purchases (including lot buying costs) less items recorded as used personally |
| 37 Labor, 38 Materials and supplies | **Not tracked.** Never assumed or filled in |
| 39 Other costs | **Needs review.** Sourcing-trip buying costs are mentioned, not added |
| 40 | Sum of the recorded lines only, marked needs review |
| 41 Ending inventory | The independent ending inventory, with its basis |
| 42 | Line 40 − line 41, marked needs review |

A **bridge** explains line 42 against cost of goods sold from your records. It covers write-offs, deletions, returns, corrections and any unexplained difference, and it adds up exactly. In the example: $35.33 + $13.10 + $80.00 − $8.33 − $1.60 = $118.50.

Safeguards stated on the page and in the summary:
- StockPilot doesn't prepare or file returns or work out taxable income.
- Not every business files Schedule C.
- Not every business uses the same inventory method.
- Recorded figures are kept apart from possible tax classifications.
- An accountant should confirm the method, every classification and every amount.

No tax planning features are included.

## The assistant

Rule-based, with re-checked calculations. The AI layer (beta builds) only maps wording to these questions.

| Question | Answer | Calculation |
| --- | --- | --- |
| How much inventory did I start the year with? | Beginning inventory and its basis, or the missing evidence | Item-by-item cost on hand at the previous Dec 31 |
| How much inventory did I purchase? (any period) | Items, bulk lots and restocks | Each purchase record |
| What was my cost of goods sold? (any period) | From recorded sales; for a year, how the worksheet's line 42 differs | Each sale's cost of goods sold |
| Why doesn't my inventory reconcile? | Says when it does; otherwise splits the difference into records vs ledger and count vs records, and names unverifiable beginnings | The annual roll-forward |
| What inventory did I write off? (any period) | Write-offs, personal use and deletions | Each adjustment and deletion |
| Which months are missing information? | Months not closed and verified, and chain gaps | — |
| Is my year-end report ready for my accountant? | Finalized (or flagged), or the steps still open | — |

The year asked about is the one named ("2026", "last year", "this year"). Otherwise it's the year just ended in January–March, and this year after that.

**AI cost:** the AI interpret step gained seven intents, so the worst-case reservation rises from $0.0324 to $0.0329 on Sonnet. The shared $10 budget, invite codes, limits, privacy protections and models are unchanged.

## Stored data and compatibility

- **New, optional:** `data.yearEnd` holds reviews (versioned snapshots), decisions, designated counts per year, and the audit log.
- **Ledger events** now also record the units added or removed by purchases, deletions and opening balances (optional; older events have none). This lets inventory be listed item by item at any date.
- **Older data and backups** load with no reviews. Backups include everything above.
- **Nothing historical is rewritten or deleted.**

## Tests

| Requirement | Where |
| --- | --- |
| Beginning/ending inventory, purchases with bulk acquisition costs, partial sales, cost of goods sold, write-offs, personal use, returns, restocks, deletions, cost corrections, fractional costs | `src/insights/yearEnd.test.ts` — "annual inventory reconciliation" |
| December/January boundary; multiple years; next year starting from a finalized review | `src/insights/yearEnd.test.ts` |
| Item-by-item inventory at a date (including deleted items) | `src/insights/yearEnd.test.ts` |
| Missing opening balances, pre-ledger years, never a zero difference | `src/insights/yearEnd.test.ts`; `e2e/yearend.spec.ts` |
| Discrepancy detection to the cent | `src/insights/yearEnd.test.ts`; `src/insights/yearAnswers.test.ts` |
| Year-end counts (after and on Dec 31, applied or not) | `src/insights/yearEnd.test.ts`; `e2e/yearend.spec.ts` |
| Missing months, reopened months, monthly sums | `src/insights/yearEnd.test.ts` — "monthly coverage" |
| Finalizing, locking with monthly closes, reopened monthly closes flagging the year, reopening, version 2 | `src/insights/yearEnd.test.ts`; `e2e/yearend.spec.ts` |
| Summary, worksheet bridge, CSV accuracy, HTML export | `src/insights/yearEnd.test.ts`; `e2e/yearend.spec.ts` (downloaded files) |
| Backup and restore | `src/insights/yearEnd.test.ts` |
| Assistant answers with verified calculations | `src/insights/yearAnswers.test.ts`; `e2e/yearend.spec.ts` |
| Phones and accessibility | `e2e/yearend.spec.ts` on desktop and an iPhone-sized viewport (no sideways scrolling, axe) |

## Limitations

- **Coverage depends on the ledger:** verification reaches back only to when StockPilot's dated inventory records began. Earlier years are labelled as unverifiable, and no history is reconstructed for them.
- **Valuation:** costs are each item's own (specific identification; restocks average an item's cost). LIFO, FIFO layers and lower-of-cost-or-market aren't calculated.
- **Rolling a count:** a count taken away from Dec 31 is rolled to the year-end using recorded movements, assuming the differences found already existed at year-end.
- **Not covered:** bank and cash, manufacturing (raw materials, labor, overhead, work in progress) and services.
- **Fiscal years** other than the calendar year aren't offered yet (the structure allows them).
- **CSV files** always reflect today's records. The finalized summary itself is kept unchanged.
