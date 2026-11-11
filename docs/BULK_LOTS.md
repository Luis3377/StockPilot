# Bulk Lot Cost Splitting

*StockPilot: know what you own. Know what you actually make.*

Resellers often buy many items for one price: an auction lot, an estate-sale box, a pallet, a wholesale bundle. To know what each sale really earned, each item needs its fair share of what the lot cost. StockPilot works that share out, keeps it exact to the cent, and shows where every cent of the lot's cost is now.

## Using it

**Inventory → Add bulk lot.** Three steps:

1. **Purchase.** The lot's name, the total purchase price, any additional acquisition costs (shipping/freight, buyer's premium, auction fees, sales tax, travel…), the date, where it was bought, and notes. The running total shows exactly what will be split.
2. **Items.** Each kind of item in the lot: name, quantity, and your estimated resale value **per item**. Category, condition and notes are optional. In builds with the AI scanner, **Scan with AI** on an item fills its name, category, condition and notes from a photo. It never sets a price.
3. **Review split.** Choose **By estimated resale value** (recommended) or **Equally per unit**. Every item shows its share (%), its allocated cost and its cost per item, and estimates can still be changed here with the split updating live. A green check confirms the whole cost is split: *"$100.00 of $100.00 split: every cent is assigned to an item."* It also shows the potential gross profit before selling expenses.

**Save lot & add N items** creates one ordinary inventory item per line, with its share as its cost per item, and opens the lot's page. Lots are listed under **Inventory → Lots**. Each lot item's page says which lot it came from.

## The formula

```
total allocable cost  = purchase price + additional acquisition costs
line's est. value     = estimated resale value per item × quantity
allocated line cost   = total allocable cost × (line's est. value ÷ total est. value)
cost per item         = allocated line cost ÷ quantity
```

When splitting **equally per unit**, every unit has the same weight, so a line's share is proportional to its quantity.

Additional costs are part of the inventory's cost: they are split with the purchase price and show up in cost of goods sold when items sell. They are never recorded as an expense or a loss when you buy, and buying a lot never creates an adjustment. Buying inventory isn't a loss.

### Cents, rounding and "no lost pennies"

Money is split in whole cents with the **largest-remainder method**, using integer arithmetic:

1. Each line gets its exact share rounded **down** to a whole cent.
2. The few cents left over go, one at a time, to the lines that lost the most in rounding. On a tie, the earlier line (the order you entered them) gets the cent.

The lines therefore always add up to the total exactly, and the same inputs always give the same split.

**Line total vs. cost per item.** A line's total is always whole cents, but dividing it by the quantity may not be ($10.00 over 3 mugs = $3.333…). The item stores a cost per item precise enough that *cost per item × quantity* gives back the line total exactly (here 3.3333; more decimals only for very large quantities). The review step shows the exact breakdown: **"$3.33–$3.34 each · 1 × $3.34 + 2 × $3.33"**.

When those units sell, cost of goods sold is *the cost leaving inventory*: inventory cost before the sale minus inventory cost after it. Selling the mugs one at a time records **$3.33, $3.34 and $3.33**, exactly $10.00 in total. Selling 2 then 1 records $6.67 and $3.33. Either way, cost of goods sold plus the cost still in stock always equals what was paid.

> This "cost leaving inventory" rule now applies to **every** sale and quantity adjustment, not just lot items. For an item whose cost is whole cents (almost all items), nothing changes: $10.00 × 2 is still $20.00. It only matters for costs with more decimals (a lot share, or a restock's weighted average such as $6.6667), where it removes a rounding error that could previously create or lose a cent across sales.

### What can't be split

- **By value, an item has no estimate:** the review asks for one under that item, with a one-tap **Split equally instead**.
- **By value, every estimate is $0:** there is nothing to split by, so the same choice is offered.
- **One item estimated at $0 while others aren't:** it carries none of the cost, and the review says so under that item so it isn't a silent mistake.
- Negative amounts, missing names or prices, quantities that aren't whole numbers ≥ 1, and invalid dates are rejected with a message next to the field.

## Reconciliation examples

**1. The basic case.** $90 purchase + $7.50 freight + $2.50 buyer's premium = **$100.00**.

| Item | Est. resale | Share | Allocated cost |
| --- | --- | --- | --- |
| Sneakers | $100 | 50% | $50.00 |
| Headphones | $60 | 30% | $30.00 |
| Jacket | $40 | 20% | $20.00 |
| **Total** | **$200** | | **$100.00** ✓ |

Potential gross profit before selling expenses: $200 − $100 = $100.

**2. Uneven split.** $100 across three items each estimated at $10: **$33.34 + $33.33 + $33.33 = $100.00**. The leftover cent goes to the first item, because the remainders tie.

**3. Mixed quantities.** $100 for sneakers ($100), headphones ($60), a jacket ($40) and 3 mugs ($10 each, $30 for the line):

| Item | Line est. | Allocated | Per item |
| --- | --- | --- | --- |
| Sneakers | $100 | $43.48 | $43.48 |
| Headphones | $60 | $26.09 | $26.09 |
| Jacket | $40 | $17.39 | $17.39 |
| Mugs × 3 | $30 | $13.04 | $4.34–$4.35 (2 × $4.35 + 1 × $4.34) |
| **Total** | **$230** | **$100.00** ✓ | |

**4. Larger amounts.** $1,234.56 for 7 × $19.99, 1 × $450 and 12 × $3.50 → $273.37 + $879.14 + $82.05 = **$1,234.56** ✓ (per item $39.0529, $879.14 and $6.8375).

**5. Selling, then correcting the cost.** Example 1 without the extra costs ($100 purchase price). The jacket sells for $35: cost of goods sold $20.00, realized profit $15.00. The invoice turns out to be $108. **Edit lot** shows, before anything is saved:

- Lot total cost: $100.00 → $108.00
- Cost already in completed sales or written off: **$20.00 (unchanged)**
- Sneakers (1 in stock): $50.00 → $55.00 · Headphones (1 in stock): $30.00 → $33.00

After confirming, the lot reads $55.00 + $33.00 + $20.00 = $108.00 ✓. The jacket sale still shows $20.00 cost and $15.00 profit, and the change, with the reason given, is in the lot's history.

## The lot page

- **Totals:** total cost (purchase price + additional), items and units bought, estimated resale value and potential gross profit (both tagged *Projected*: they come from your estimates).
- **Sold so far (Realized):** units sold and realized profit (sales − cost of goods sold − fees, shipping and other expenses).
- **Still in stock (Today / Projected):** inventory cost of what's left, and its projected gross profit from current estimated values. Realized and projected figures are never added together.
- **Where the cost is now:** the split check ("$X of $X split"), then the total cost broken into *sold (cost of goods sold)*, *written off or corrected* (count checks, losses, quantity edits) and *still in stock*, plus anything *added later by restocking*. When those add up, it says **"Fully reconciled: nothing lost, nothing counted twice."**
- **Items:** each item's allocated cost, cost per item (and its current cost, if an edit changed it), estimate, units sold/in stock, and realized profit, linked to the item.
- **Cost breakdown** and **History** (created, cost changes with before/after costs per item and the reason, detail changes).

If cost changed **outside** the lot (an item's cost edited directly, or a lot item deleted), the page shows the amount under *Changed outside the lot* and explains it, rather than hiding it.

## Editing a lot

**Edit lot** can change the name, purchase price, additional costs, split method, estimates, date, source and notes.

- **Completed sales never change.** Each sale keeps the cost recorded when it was made, so past profit stays as reported.
- A change to the **total** (price or additional costs) is shared across the units **still in stock**, in proportion to their estimated value (or quantity, for an equal split).
- A change to **estimates or the split method** re-splits the cost **still in stock** across the unsold items. Items already sold keep their cost.
- Anything that moves a cost opens **Confirm cost change**, with every unsold item's cost per item and inventory cost before and after, the cost that stays locked in completed sales, and an optional reason. Nothing is saved until **Confirm and update costs**.
- Refused: lowering the total by more than the cost still in unsold items, and any cost change once everything has sold or been written off. Either would mean rewriting completed sales. Name, date, source and notes can always be edited.
- Changing the lot's date also updates the items that still had the old date.
- Item quantities aren't edited from the lot. Sales, restocks, count checks and adjustments work on lot items exactly as on any item.

## Stored data and compatibility (migration)

There is **no migration and no schema bump**. The change is additive:

- `AppData.lots` is a new list of lots. Data saved before this feature, and backups made by earlier versions, have no `lots` and load with an empty list.
- Each lot line records the inventory item it created (`itemId`), its name at the time (so the lot stays readable if the item is deleted), quantity, estimate (`estimateSource: 'user'`) and allocated cost. The lot keeps its purchase price, additional costs, method and history.
- Lot items are ordinary `Item` records: their `unitCost` is their share. Nothing in `Item` or `Sale` changed shape.
- The backup format is unchanged (`version: 1`) and includes lots. A backup with lots restored into an **older** StockPilot version keeps every item, cost, sale and profit figure, but that version ignores the lot grouping and history. Restoring the same file into this version brings the lots back.
- Restoring checks lots like everything else: a malformed lot (e.g. a quantity of 0) is rejected with a clear message, and unreadable history entries are skipped.

## Designed for future market prices

Estimated resale values come from the user. AI identification never sets a price: the scanner fills only the name, category, condition and notes. Its response is parsed by the same validator as Add Item, which drops any price-like field, and the lot shows *"The scanner identifies the item. It doesn't estimate prices: enter your own resale estimate below."* Each estimate records where it came from (`EstimateSource`, currently only `'user'`). A future market-price lookup can add a source and pre-fill estimates for the user to confirm, without changing the split. No paid API was added.

## Known limitations

- **Restocking a lot item mixes costs.** Units added later are averaged into the item's cost (as for any item). The lot page shows them as *Added later by restocking* and still reconciles, but a later lot cost edit applies to all units of that item in stock, including the restocked ones.
- **Direct cost edits and deletions aren't routed through the lot.** Editing a lot item's cost on the item form, or deleting a lot item, isn't blocked. The lot shows the difference under *Changed outside the lot*, and the item form explains that lot costs should be changed with Edit lot.
- **Editing a past sale's quantity, or cancelling a sale that isn't the latest, on an item whose cost has more than two decimals** can move a single cent: the sale keeps its recorded per-unit cost (protecting history) while inventory is valued at the item's current cost. It shows up as *Changed outside the lot* (for example −$0.01), never silently. Cancelling the most recent sale is exact.
- **Lines can't be added to or removed from a saved lot**, and line quantities aren't edited there. Add separate items, or a new lot.
- **Changing costs after a sale doesn't reach back.** By design, an invoice correction discovered after some items sold changes only unsold items. The portion that "belonged" to sold items stays in their recorded cost of goods sold, and the history records how much was locked.
- **Display precision:** costs are shown to the cent. An item's stored cost can carry more decimals (e.g. 3.3333), and the item edit form shows that exact value.
- The CSV inventory export lists lot items like any other item (cost per item = their share). It doesn't have a lot column yet.

## Where it lives in the code

| | |
| --- | --- |
| `src/domain/lots.ts` | `splitCents` (largest remainder), `allocate`, `createLot`, `planLotEdit` / `applyLotEdit`, `lotSummary`, `lotForItem` |
| `src/domain/money.ts` | `exactPerUnit`, `unitCentSplit` |
| `src/domain/calc.ts` | `costLeaving` (cost of goods sold = cost leaving inventory) |
| `src/domain/actions.ts` | sales, adjustments and restocks use `costLeaving` / `exactPerUnit` |
| `src/domain/types.ts` | `Lot`, `LotLine`, `LotExtraCost`, `LotChange`, `AppData.lots` |
| `src/data/sanitize.ts` | lots in stored data and backups (defaults to none) |
| `src/pages/dialogs/LotFormDialog.tsx`, `LotEditDialog.tsx` | Add bulk lot, Edit lot and Confirm cost change |
| `src/pages/LotsPage.tsx`, `LotDetailPage.tsx` | lot list and lot page |
| Tests | `src/domain/lots.test.ts`, `src/data/backup.test.ts`, `e2e/lots.spec.ts` |

## Manual checks before Feature 2

Worth doing by hand on the beta build (and once on a real iPhone) before building the next feature:

1. **Real lot, real numbers.** Enter a lot you actually bought, with its real invoice (price, buyer's premium, shipping). Check that the "Total cost to split" matches the invoice and the review's split check is green.
2. **Estimates feel right.** Do the per-item costs look fair to you? Try changing one estimate on the review step and watch the split move.
3. **Awkward quantities.** A line like 7 items for a share that doesn't divide evenly: check the "$x–$y each" breakdown, sell units one at a time, and confirm the lot page shows cost of goods sold + still in stock = total.
4. **No estimates.** Leave estimates empty, use "Split equally instead", and save.
5. **Sell, then correct.** Sell one item, then Edit lot to add a forgotten fee. Read the confirmation: the sold item's cost must say unchanged. Afterwards check Sales & Profit: that sale's profit hasn't moved.
6. **Refusals.** Try lowering the price below what's already sold, and editing the price after everything has sold. Both should be refused with a clear reason.
7. **Outside changes.** Edit a lot item's cost directly (or delete one) and check the lot page explains the difference instead of saying "Fully reconciled".
8. **Backup round trip.** Download a backup, restore it (Settings → Restore from backup) and check the lot, its history and the reconciliation are intact.
9. **AI scanner (beta build).** Scan an item inside a lot. Check that the name/category/condition fill in, the AI marker shows, and the estimate stays empty until you type it.
10. **iPhone.** Go through Add bulk lot on an iPhone in the Home Screen app: no zooming on tap, no sideways scrolling, the footer buttons are reachable, and the lot page reads well.
11. **Dashboard consistency.** After the lot, check that Overview's inventory cost went up by exactly the lot's total, and that realized profit only changes when something sells.
