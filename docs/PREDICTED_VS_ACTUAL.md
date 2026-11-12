# Predicted vs. Actual

*StockPilot: know what you own. Know what you actually make.*

When a lot is bought through the [Max Bid Calculator](MAX_BID.md), its estimate is frozen. Predicted vs. Actual compares that frozen forecast with what the user's records show happened, explains every difference, and turns completed lots into transparent suggestions for the next purchase.

Every actual figure comes from recorded sales, costs and stock, through the same engines the rest of the app uses:
- bulk lot cost allocation (`lotSummary`);
- `computeSale` / `totalSales`;
- inventory adjustments;
- marketplace reconciliation, for warnings.

Every predicted figure is read from the plan's snapshot, never recalculated or overwritten. Arithmetic is in integer cents. No AI calculates anything.

## Where to find it

- **Inventory → Lots → (a lot) → Performance**: one lot, predicted vs. actual (`#/inventory/lots/<id>/performance`).
- **Inventory → Lots → Performance**: all lots, completed-lot history, and filters (`#/inventory/lots/performance`).
- A purchased Max Bid plan links to **Predicted vs. actual**, and so does the lot page's "Planned with the Max Bid Calculator" card.
- In a Max Bid plan that's still being planned: **Learn from your results**.
- In Smart Insights, the assistant answers questions about it (see below).

## Lot stages

| Stage | When | Result |
| --- | --- | --- |
| Not selling yet | Nothing sold, stock on hand | Not final: compared through a projection |
| Partially sold | Some sold, some still on hand | Not final: compared through a projection |
| Fully sold | Every unit sold | **Final** |
| Closed | Every unit sold or written off (with some written off), or the user closed the lot | **Final** |

**Closing** ("I'm done selling it") never writes anything off.
- If units are still on hand, the user must first write them off on the item pages, or confirm they stay in inventory at cost and count as unsold in this lot's result.
- Closing records what was on hand at the time, and a closed lot can be reopened.
- A sale recorded after closing is still included, with a note.

## The comparison

| Metric | Predicted (from the snapshot, chosen scenario) | Actual (from records) |
| --- | --- | --- |
| Acquisition cost | All-in cost at the max bid: the most you planned to pay | Lot total: purchase price + buying costs recorded on the lot |
| Sales revenue | Expected sale proceeds | Σ sale price × quantity of the lot's items |
| Selling expenses | Estimated fees + shipping | Σ fees + shipping + other expenses on those sales |
| Net proceeds | Expected net proceeds | Revenue − selling expenses |
| Profit (whole lot) | Projected profit at the max bid | Net proceeds − acquisition cost |
| ROI (whole lot) | Expected ROI at the max bid | Profit ÷ acquisition cost |
| Sell-through | 100% − unsold allowance (by value) | Share of the lot's estimated value that sold (the lot's item estimates); by units when not every item has an estimate |

**Differences.**
- **$ difference** = actual − predicted.
- **Forecast error** = (actual − predicted) ÷ |predicted| × 100, to 2 decimals.
- When the prediction is $0 there's no percentage: it shows "—" and never divides by zero.
- ROI and sell-through differences are in **percentage points**.
- Green means better for the user: more revenue, profit, proceeds or sell-through, or lower costs. Red means worse.
- Each row expands to show its formula.

**Partly sold lots are never compared as if they were finished.**
- The table shows *Actual so far* and *→ projected*.
- Differences use the projected final outcome, and a banner says so.
- **Projected final** = net proceeds so far + estimated net proceeds of the units still on hand.
- That estimate uses the plan's chosen scenario: resale %, unsold %, fees and shipping, applied to the lot's item estimates for the remaining units.
- Lots without a plan use the item estimates and the app's selling-cost rate, with no unsold allowance. The page says which assumptions were used.

For partly sold lots the page also shows:
- revenue so far;
- cost of goods sold (exact lot shares);
- realized profit on the units sold;
- inventory cost still in stock;
- **not yet recovered** = acquisition cost − net proceeds so far, or a note that it's already covered;
- estimated proceeds still to come;
- the projected final result and ROI.

Realized profit on sold units is kept separate from the whole-lot result, which also counts what was paid for units still in stock.

**Selling prices on what sold.** At any stage, "What has sold brought $X; at the plan's prices it would have brought $Y (±Z%)".
- *The plan's prices* = (scenario resale value) × (estimated value of the units sold ÷ estimated value of the lot).

## Why the result differs (final lots with a plan)

Starting from the predicted profit, each recorded difference is added. **They add up exactly** to the actual result, to the cent.

| Factor | Amount |
| --- | --- |
| Paid less / more than planned | planned all-in cost − actual acquisition cost |
| Sold for less / more than estimated | actual revenue − the plan's prices for what sold |
| Less / more of the lot sold | the plan's prices for what sold − predicted revenue (write-offs count as unsold) |
| Fees | predicted fees − actual fees and other selling expenses |
| Shipping | predicted shipping − actual shipping |

**When the records can't support a factor, it isn't invented.**
- If not every item has a resale estimate, prices and sell-through can't be separated. They're shown as one "sales revenue" factor, with that reason.
- If the plan had no sensible max bid, the explanation starts from the predicted result at the price paid.

**Example (the specification's).**
- A $1,000 estimate, 20% unsold, 15% fees and a 100% ROI give predicted net proceeds of **$680** and a max bid of $340. The lot was bought for $300.
- Sales: 4 pans at $90 and 2 mixers at $190 ($740), with $111 of fees and $34 of shipping. The 10 mugs were written off.

| | Predicted | Actual | Difference |
| --- | --- | --- | --- |
| Acquisition cost | $340.00 | $300.00 | −$40.00 (−11.76%) |
| Sales revenue | $800.00 | $740.00 | −$60.00 (−7.5%) |
| Selling expenses | $120.00 | $145.00 | +$25.00 |
| Net proceeds | **$680.00** | **$595.00** | **−$85.00 (−12.5%)** |
| Profit | $340.00 | $295.00 | −$45.00 |
| ROI | 100% | 98.33% | −1.67 pts |
| Sell-through | 80% | 80% | 0 pts |

Why it differs:
- $340.00 predicted profit;
- **+$40.00** paid less than planned;
- **−$60.00** sold for less than estimated ($740 vs $800 at the plan's prices);
- $0.00 sold as much of the lot as expected (80% of the value; the written-off mugs count as unsold);
- **+$9.00** lower fees;
- **−$34.00** higher shipping;
- = **$295.00**.

**Partial example (same lot, only the pans sold).**
- So far: revenue $360.00, cost of goods sold $120.00, realized profit on sold units $166.00.
- Net proceeds so far are $286.00, so **$14.00 not yet recovered**. Inventory cost still in stock: $180.00.
- What's left: $600 of estimates × 80% × (1 − 15%) = **$408.00** estimated.
- Projected final net is **$694.00**: result $394.00, 131.33% ROI. Net proceeds are compared on that, +$14.00 (+2.06%).
- The pans sold for **−10%** against the plan's prices.

## The original prediction

The frozen snapshot is the authoritative forecast. It includes:
- the resale estimate;
- fees, shipping and the unsold allowance;
- the target ROI;
- the max bid and recommended bid;
- all three scenarios, each with its net proceeds.

It's shown on the Performance page as **What you believed**, next to the price paid. Any scenario can be chosen for the comparison. Plans can't be edited once purchased, sales never touch the snapshot, and backups keep it.

## History across lots

Completed (final) lots only; lots still selling are listed but not counted.

| Figure | Definition |
| --- | --- |
| Completed lots | Fully sold or closed |
| Invested | Σ acquisition cost |
| Result | Σ (net proceeds − acquisition cost) |
| ROI, all completed lots | Σ result ÷ Σ invested (with the simple per-lot mean shown too) |
| Average forecast error | Mean of per-lot net proceeds errors, for lots planned with Max Bid (expected scenario); the aggregate (Σ actual − Σ predicted) ÷ Σ predicted is in the definitions |
| Best / worst | Top 3 by ROI, and up to 3 others from the bottom (never the same lot in both) |
| By lot type | Lots, invested, result, ROI and average forecast error per plan type ("Not planned" for others); small samples (under 3) are marked |
| Selling prices by category | Units sold from planned lots, against the plan's prices for them, per item category (includes lots still selling); small samples marked |

**Filters:** purchase date (from / to), lot type (from the plan) and where bought (the lot's source).

## Learning: suggested adjustments for the next plan

In a Max Bid plan that's still being planned, **Learn from your results** looks at completed lots the user planned. Each needs a frozen prediction and a resale estimate for every item. It compares them with the plan's **expected** scenario.

**Which lots.** Lots of the same type as the plan when there are at least 3. Otherwise all planned lots, and it says so.

**What the lots showed** (value-weighted over the lots):
- **Prices:** Σ revenue ÷ Σ the plan's prices for what sold.
- **Unsold:** 1 − Σ estimated value sold ÷ Σ estimated value bought.
- **Fees:** Σ (fees + other selling expenses) ÷ Σ revenue.

**Weighting and safeguards:**
- Credibility weight = n ÷ (n + 3), so 3 lots count for 50% and 9 lots for 75%.
- The weight is halved when lots disagree (prices spread by more than 50 points).
- Resale % suggested = current × (1 + (price ratio − 1) × weight). Unsold % and fee % suggested = current + (historical − current) × weight.
- **No suggestion below 3 lots.** Only changes that make the plan more conservative are made with 3–4 lots. Raising an estimate, or lowering unsold or fees, needs 5 consistent lots.
- Changes are capped: resale −30 / +10 points, unsold ±20, fees ±10.

**What the card shows:**
- the sentence, e.g. *"Your 4 completed lots of this type (liquidation pallet) brought net proceeds averaging 12% below your original predictions."*;
- the sample size, and now / your lots / suggested for each value;
- the arithmetic, and every lot used, with links;
- the max bid before and after: e.g. 100% → 93.1% resale changes $340.00 → $316.54.

**Your choice:**
- **Use these values** changes only the plan's expected scenario, never the resale estimates. It records the before and after values, the basis, the sample size and the lots, and is shown with **Undo**.
- **Not now** hides it.
- Every value stays editable, and nothing is saved until **Save**.
- The card says past results don't guarantee future ones.

## The assistant

Rule-based, with re-checked calculations; the AI layer (beta builds) can map wording to these questions but never calculates.

| Question | Answer |
| --- | --- |
| How accurate have my predictions been? / Am I overestimating resale prices? | Actual vs predicted net proceeds over completed planned lots (calculation with each lot), average error, and the selling-price comparison |
| Which lots made more (less) than expected? | The lots and their errors |
| What kinds of lots consistently underperform? | By lot type, small samples marked |
| Why did this lot lose money? / Why did Estate box lose money? | The factors for the named (or most recent losing) lot, as a calculation; a lot still selling gets its status and projection instead of a verdict |
| How should my previous results affect my next maximum bid? (optionally naming a type: pallet, storage…) | The same suggestion as the plan page, against the default scenario, with its lots and safeguards |

The AI interpret step gained three intents, so its worst-case reservation rises slightly ($0.0311 → $0.0313 on Sonnet). It still uses the same shared budget, limits and security, and the explain step is unchanged.

## Accounting accuracy

- **Acquisition cost** is the lot's purchase price plus its recorded buying costs, split cent-exactly by the bulk lot engine.
- **Write-offs** reduce stock at their exact lot share, and the units count as unsold.
- **Cost accounting:** every lot's cost stays accounted for: cost of goods sold + written off + still in stock.
- **Records outside the lot:** if stock was **restocked** into lot items, or an item's cost was edited or deleted outside the lot, the page warns that the comparison mixes in other stock or that the cost doesn't fully reconcile.
- **Refunds** in imported eBay reports that the sale doesn't reflect, possible duplicate sales, $0-cost sales and unreconciled payouts are warned about, using the assistant's warnings. They never silently change figures.
- **Cash vs profit:** a payout is cash moved, never profit; these comparisons use recorded sales, not payouts.
- **Auditable:** every actual sale and write-off is listed with links to its item.

## Stored data and compatibility

- `lot.closure` (optional) and `bidPlan.adjustments` are new.
- Data and backups without them load as open lots with no adjustments, and no schema bump was needed.
- Nothing about past records is changed: closing records a note, and adjustments are only made when the user applies them.

## Tests

| Requirement | Where |
| --- | --- |
| Fully sold, partially sold, not selling, written off, closed with stock, unprofitable, zero revenue | `src/insights/performance.test.ts` |
| Forecast errors, ROI, zero predictions, different purchase prices, factors that add up exactly | `src/insights/performance.test.ts` |
| Multiple items with partial sales and write-offs (every cent accounted for) | `src/insights/performance.test.ts` |
| Refunds in eBay reports flagged, figures unchanged | `src/insights/performance.test.ts` |
| Original prediction preserved; every scenario comparable | `src/insights/performance.test.ts` |
| History aggregates, filters, best/worst, by type and category | `src/insights/performance.test.ts`; `e2e/performance.spec.ts` |
| Suggestions: weighting, small and inconsistent samples, raising rules, caps, fallback to all lots | `src/insights/performance.test.ts`; `e2e/performance.spec.ts` (apply, undo, save) |
| Assistant answers and re-checked calculations | `src/insights/performance.test.ts`; `e2e/performance.spec.ts` |
| Backup and restore, older backups | `src/insights/performance.test.ts`; `e2e/performance.spec.ts` (seeded through restore) |
| Phones, accessibility | Every `e2e/performance.spec.ts` test on desktop and an iPhone-sized viewport; no sideways scrolling; axe |

## Known limitations

- **Sell-through by value** needs a resale estimate on every lot item. Otherwise it's by units, and prices and sell-through can't be separated.
- **The plan's prices for what sold** spread the plan's resale % evenly across items. Per-item resale percentages aren't modeled.
- **Projections** are estimates from the plan's (or the app's) assumptions, not forecasts of when items will sell. There's no time dimension (days to sell).
- **Suggestions** adjust only the expected scenario's three percentages, from lots with complete estimates. They're statistics over a few lots, not a predictive model.
- **Lot type** comes from the Max Bid plan. Unplanned lots are "Not planned". Category breakdowns use the items' current category.
- **Refunds** recorded only in marketplace reports are warned about, not applied.
- **Restocked units** in lot items are included in revenue, with a warning.
