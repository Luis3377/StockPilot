# Max Bid Calculator

*StockPilot: know what you own. Know what you actually make.*

Before a storage-unit auction, a liquidation pallet, an estate-sale lot, a garage-sale bundle, a bulk collectibles buy or a retail inventory lot, the question is: **what's the most I should pay and still make the return I want?** The Max Bid Calculator answers it from the user's own estimates, with every assumption shown and editable. If the user buys the lot, the plan turns into a bulk lot in one step, and the original estimate is kept for a later predicted-vs-actual comparison.

Plans are **planning data**. Saving one never creates inventory, a purchase, an expense or a sale, and plans never change any money figure in the app.

## Where to find it

- **Inventory → Max bid** (or **Max bid calculator** when the inventory is empty). The direct link is `#/inventory/bids`.
- **Inventory → Lots → Plan a purchase: max bid**.
- A lot bought from a plan shows **Planned with the Max Bid Calculator** on its page, with a link back to the plan.

## Using it

**New calculation** opens the calculator. The result updates as you type. It sits on the right on wide screens; on phones, a summary at the top links to it.

| Section | Inputs | Units |
| --- | --- | --- |
| The lot | Name, type of purchase, optional description | |
| Resale value: your estimates | **One total for the lot** (+ optional number of items) **or item by item**: name, quantity, your resale estimate **per item** (the line total is shown), and optional category, condition and notes | $ total, or $ per item |
| Selling costs (expected) | Expected unsold or unsellable; selling fees; outbound shipping you pay | % of resale value; % of sale price; **$ per item sold** or **% of sale price** |
| Buying costs | Buyer's premium; sales tax on the purchase (also on the premium or not); fixed costs (truck rental, cleanout, entry fees, travel) | % of bid; % of bid; $ for the whole lot |
| Your goal | Target return (ROI); optional budget; optional planned bid | %; $ total you can spend, costs included; $ bid |
| Scenarios | Conservative / Expected / Optimistic: resale value, unsold, selling fees | % of your estimate; % of resale value; % of sale price |

Empty buying and shipping costs count as 0. The resale estimate, the target ROI and each scenario's percentages are required; until they're entered, the result lists what's missing. Values that aren't valid are flagged on their field: negative amounts, percentages over 100 (ROI over 1,000%, resale over 300%), more than 2 decimals on a percentage, or text where a number belongs.

**Estimates are the user's.** StockPilot doesn't look up prices. In builds with the AI scanner, **Identify with AI** on an item fills its name, category, condition and notes from a photo (marked "AI"), and leaves the resale estimate empty for the user to enter. The photo isn't kept with the plan. No pricing API is used.

## How the maximum bid is calculated

Deterministic, in integer cents (percentages as basis points), in `src/domain/bids.ts`. For each scenario:

```
resale value          = your estimate × resale %
expected sale proceeds = resale value × (100% − unsold %)          only what sells
selling fees          = expected sale proceeds × selling fee %
outbound shipping     = $ per item × items × (100% − unsold %)      or  expected sale proceeds × shipping %
net proceeds          = expected sale proceeds − selling fees − shipping
max all-in cost       = net proceeds ÷ (1 + target ROI)             rounded DOWN to the cent
all-in cost of a bid  = bid + buyer's premium (% of bid) + sales tax (% of bid, + premium if taxed) + fixed costs
max bid               = the largest whole-cent bid whose all-in cost ≤ max all-in cost
potential profit      = net proceeds − all-in cost at the max bid
ROI                   = potential profit ÷ all-in cost
```

With no premium, tax or fixed costs, the max bid equals the max all-in cost. Otherwise it is (max all-in − fixed costs) ÷ (1 + premium rate), and with tax ÷ ((1 + premium) × (1 + tax)), or ÷ (1 + premium + tax) if the premium isn't taxed. The engine then checks the cents: the premium and tax are rounded half up, and the bid is moved to the largest cent that still fits. So **the all-in cost never exceeds the target's limit**, and one cent more would. A 400-case randomized test checks this.

**Each cost counts once, where it happens.**
- Selling fees and shipping apply only to what is expected to sell.
- The premium and tax apply to the bid.
- Fixed costs are added once.
- The cost of the lot is not an expense: it becomes the lot's cost when bought, through the bulk lot workflow.

**The worked example** (the defaults reproduce it):

| | |
| --- | --- |
| Estimated resale value | $1,000.00 |
| Expected unsold (20%) | −$200.00 |
| Expected sale proceeds | $800.00 |
| Selling costs (15%) | −$120.00 |
| Net proceeds ($1,000 × 0.80 × 0.85) | **$680.00** |
| Target ROI 100%: max all-in = $680 ÷ 2 | **$340.00** |
| Max bid (no buying costs) | **$340.00** |
| …with a 10% buyer's premium | $309.09 (premium $30.91, all-in $340.00) |
| …with $40 fixed costs and a 10% premium | $272.73 (premium $27.27, all-in $340.00) |
| …with a 10% premium and 8% tax on bid + premium | $286.19 (at $286.20 the tax rounds the all-in to $340.01) |

**When no bid makes sense**, the result says why instead of showing a number:
- nothing is expected to sell;
- selling costs use up all of the expected sales;
- the fixed buying costs alone exceed what you can spend and still reach the target.

**Budget and planned bid.**
- **Budget** is the most you can spend in total. If it allows less than the maximum, the recommendation is the budget's bid, and the result says so. If it can't even cover the fixed costs, the result says that too.
- **Planned bid** is checked against both. For it, the result shows the all-in cost (bid + premium + tax + fixed costs) and the potential profit and ROI in each scenario.

The result is always labeled a **maximum bid estimate**: "an estimate from your own assumptions, not a guaranteed profitable price."

## Conservative, expected and optimistic

Each scenario has its own resale value (% of your estimate), unsold %, and selling fee %. Shipping and buying costs are the same in all three. The **Expected** column uses the selling costs entered above it.

| Starting values | Resale value | Unsold | Selling fees |
| --- | --- | --- | --- |
| Conservative | 80% | 30% | 18% |
| Expected | 100% | 20% | 15% |
| Optimistic | 110% | 10% | 15% |

These are starting points, not market data. They're printed under the scenario inputs and can all be changed; **Defaults** restores them.

The result shows, side by side for each scenario:
- expected sale proceeds and selling expenses;
- net proceeds and the maximum all-in cost;
- the max bid, potential profit and ROI.

It also gives a line-by-line breakdown for the chosen scenario, and **What drives this**: the expected scenario in plain sentences, from the estimate to the bid. With $1,000, the default scenarios give $229.60 / $340.00 / $420.75. A warning appears if the conservative scenario gives a higher maximum than the expected one, or the optimistic a lower one.

## Saving and reviewing plans

- **Save draft** stores the plan. **Max bid plans** (`#/inventory/bids`) lists them, newest first, and can filter them by Planning / Purchased / Passed / Lost.
- **Reopen and edit.** Open a plan, change it, then **Save changes**. Unsaved changes are flagged, and duplicating or recording the purchase waits until they're saved.
- **Duplicate.** A copy, named "(copy)", to test other assumptions. The original is unchanged.
- **Passed / Lost.** Records the decision with an optional note, such as "went for $520". The assumptions are then read-only until **Reopen to edit**.
- **Delete.** Asks first. Deleting a purchased plan never touches its lot.
- Every status change is listed in the plan's history.

## Turning a plan into a bulk lot

1. **I bought this lot** asks what was actually paid (the winning bid or price) and the date.
   - It shows the buying costs at that price from the plan's rates (premium, tax, fixed costs).
   - It compares the price with the maximum bid estimate.
2. **Next** opens the ordinary **bulk lot** dialog, filled in from the plan, under the title "Record the purchase":
   - the name and type of purchase;
   - the price and buying costs (as additional costs);
   - the date and description;
   - each item with its quantity, the user's resale estimate, category, condition and notes.

   The split is by estimated value (equal when the plan had one total). The user checks and changes anything, then reviews the cent-exact split as usual.
3. **Save** creates the lot and its inventory items through `createLot`, and marks the plan **Purchased**, in a single store commit.

**No duplicates.**
- A plan already recorded as purchased refuses a second purchase, so nothing is created twice. The "I bought this lot" button disappears, and the domain action refuses too (tested), even from a second tab.
- If a lot with the same name was already added by hand, the dialog offers **Link to this lot** instead. Any existing unlinked lot can also be chosen.
- Linking adds nothing to inventory, and a lot can be linked to only one plan.

**Nothing is created automatically.** Saving, duplicating or marking a plan never adds inventory. Only completing the bulk lot form does. Cancelling at either step leaves everything as it was.

## Original estimates are kept

When the purchase is recorded, the plan stores a **snapshot**: a frozen copy of every assumption, plus each scenario's results as calculated then:
- max bid and max all-in cost;
- expected sale proceeds, selling fees, shipping and net proceeds;
- all-in cost, profit and ROI at the max bid;
- the recommended bid.

From then on:
- the plan's assumptions are read-only, with no edit, reopen or status change;
- **Duplicate** makes an editable copy;
- the plan page shows **Purchased** (price paid, buying costs, total, the max bid at the time, how far above or below the recommendation, and a link to the lot) above the original estimate;
- the lot page shows **Planned with the Max Bid Calculator**.

## Predicted vs. Actual

Built on this data: see [PREDICTED_VS_ACTUAL.md](PREDICTED_VS_ACTUAL.md). Plans still being planned show **Learn from your results**, a suggested expected scenario from completed lots (opt-in, with Undo, recorded in `bidPlan.adjustments`).

### The data it uses

Each purchased plan links the prediction to the records that will show the result:

| Compare | Predicted (in the plan) | Actual (already in StockPilot) |
| --- | --- | --- |
| Resale proceeds | `snapshot.results[scenario].expectedSales` | Revenue of sales of the lot's items (`lotSummary`) |
| Selling costs | `…sellingFees`, `…shipping` | Fees, shipping and other expenses on those sales |
| ROI | `…roiAtMaxBidPct`, `snapshot.assumptions.targetRoiPct` | Realized profit ÷ lot total cost |
| Price vs. max bid | `snapshot.recommendedBid`, `…maxBid` | `purchase.pricePaid`, `purchase.additionalCosts` |
| Unsold / written off | `assumptions.scenarios[…].unsoldPct` | Units still in stock and written off (`lotSummary`) |
| Item by item | `assumptions.items` (estimates) | `purchase.itemLinks` → inventory items and their sales |

`purchase.lotId` points to the lot; `purchase.itemLinks` maps each planned item to the inventory item it became.

## Stored data and compatibility

- Plans are stored in `data.bidPlans` and included in backups.
- Data and backups from before this feature load with no plans, and no schema bump was needed.
- Restoring tolerates unreadable assumptions, which load empty, but refuses a plan without an id or name, naming the plan.
- A "purchased" plan without its purchase record loads as a draft.

## Tests

| Requirement | Where |
| --- | --- |
| $1,000 → $340 example, target ROIs, fees and shipping, unsold allowances, fixed costs, buyer's premium and tax | `src/domain/bids.test.ts` |
| Zero or negative bids explained; missing and invalid inputs | `src/domain/bids.test.ts`; `e2e/maxbid.spec.ts` |
| Rounding: largest cent within the target, everything adds up (400 random cases) | `src/domain/bids.test.ts` |
| Scenario comparison, inverted-scenario warning, budget and planned bid | `src/domain/bids.test.ts`; `e2e/maxbid.spec.ts` |
| Saved drafts, edit, duplicate, passed/lost/reopen, delete | `src/domain/bids.test.ts`; `e2e/maxbid.spec.ts` |
| Plans never change inventory, totals or assistant answers | `src/domain/bids.test.ts` |
| Converting to a bulk lot; original estimate frozen; no duplicate purchase; linking an existing lot | `src/domain/bids.test.ts`; `e2e/maxbid.spec.ts` |
| Backup and restore; older backups; damaged plans | `src/domain/bids.test.ts`; `e2e/maxbid.spec.ts` |
| AI scanner fills details, never the estimate | `e2e/maxbid.spec.ts` (mocked scanner) |
| Phones and accessibility | Every `e2e/maxbid.spec.ts` test on desktop and an iPhone-sized viewport, no sideways scrolling, axe on the calculator |

## Known limitations

- **Estimates.** Every resale estimate comes from the user. There is no market-price lookup, and identifying an item doesn't price it.
- **Unsold share.** It applies to value, not to specific items, and per-item shipping uses the expected number of items sold, which can be a fraction.
- **Simplified cost model.**
  - Selling fees are one percentage per scenario.
  - Outbound shipping is per item or a percentage of sales.
  - Buying costs are a premium, a tax and fixed amounts.
  - Tiered premiums, minimum fees, per-item lot fees and returns aren't modeled separately: put them in the closest field.
- **Items without a list.** A plan estimated as one total starts the lot form with an empty item line, and the user enters the items there.
- **Scan photos** aren't kept with the plan or carried into the lot.
- **Lost auctions.** A note can record the winning price, but it isn't a structured field yet.
- **Predicted vs. actual** is described in [PREDICTED_VS_ACTUAL.md](PREDICTED_VS_ACTUAL.md).

## Where it lives in the code

| File | What |
| --- | --- |
| `src/domain/bids.ts` | Engine, validation, plan actions, snapshot, purchase/link |
| `src/domain/types.ts` | `BidPlan`, `BidAssumptions`, `BidSnapshot`, `BidPurchase` |
| `src/data/sanitize.ts` | Loading plans from storage and backups |
| `src/pages/BidsPage.tsx`, `src/pages/BidPlanPage.tsx` | List and calculator pages |
| `src/pages/bids/` | Form, results, purchase dialog, draft conversion |
| `src/pages/dialogs/LotFormDialog.tsx` | The bulk lot form, which can start from a plan |
