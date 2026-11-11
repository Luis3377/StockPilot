# Marketplace Payout Reconciliation

*StockPilot: know what you own. Know what you actually make.*

A payout is the money a marketplace sends to your bank. It rarely equals "sales minus fees" for the same days:
- one payout bundles several orders;
- refunds, shipping labels and ad fees are deducted;
- funds can be held back;
- part of an order can be paid in a later payout.

Payout Reconciliation compares eBay's reports with the sales you recorded in StockPilot, payout by payout, like a simplified bank reconciliation. It shows every difference with the report rows and sales behind it. You review and resolve each difference with a recorded reason, and nothing changes your financial records automatically.

**Where:** Sales & Profit → **Payouts** (or Payout reconciliation when no sales are recorded yet).

## 1. Supported eBay reports

Both reports come from **eBay Seller Hub → Payments → Reports**, downloaded as CSV. Import both for the same dates:
- the **Transaction report** says what each payout contained;
- the **Payout report** says what was actually paid.

The column names below are the ones eBay documents. Sources:
- [eBay: Reconciling your eBay sales transactions](https://www.ebay.com/help/selling/fees-credits-invoices/reconciling-ebay-sales-transactions?id=4847)
- [eBay UK announcement listing the report's columns](https://community.ebay.co.uk/t5/Announcements/Reconciling-your-eBay-Sales-Transactions/ba-p/7163037)

StockPilot doesn't invent columns. A column it doesn't know is listed as ignored in the import preview.

### Transaction report

eBay lets sellers add and remove columns, and names differ between sites. So StockPilot:
- finds columns **by name**, never by position;
- finds the header row even under title lines;
- accepts each site's spelling.

| Column (as eBay names it) | Also accepted | Used for | Required |
| --- | --- | --- | --- |
| Transaction creation date | | Date of the transaction | **Yes** |
| Type | | What the row is (see below) | **Yes** |
| Net amount | | What the row adds to or takes from the payout | **Yes** |
| Order number | Order ID | Matching to your sales | Recommended |
| Legacy order ID | | Matching (older order IDs) | |
| Payout ID | | Grouping rows into payouts | Recommended |
| Payout date, Payout status, Reason for hold | Payout Status | Timing, holds | |
| Item ID, Transaction ID, Reference ID | | Original references, kept as-is; Reference ID also recognises the same row in a later report | |
| Item title, Custom label, Quantity | | Matching suggestions (Custom label = your SKU) | |
| Item subtotal | | Checking the recorded sale price | |
| Shipping and handling | Postage and packaging | Checking the recorded sale price (buyer-paid shipping) | |
| Seller collected tax | Sales tax (older title) | Tax in the payout that isn't revenue | |
| eBay collected tax | | Shown for information: collected and remitted by eBay, not in the payout | |
| Final value fee – fixed, Final value fee – variable, Very high "item not as described" fee, Below standard performance fee, International fee | | Checking recorded fees | |
| Gross transaction amount, Payout currency, Transaction currency, Description | | Kept for reference | |
| Buyer username, Buyer name, Ship to city/state/zip/country (and the "Ship/post to" variants), Payout method, Exchange rate, Seller specified VAT rate | | Recognised but **not stored** (buyer details are personal data) | |

**Type values.** eBay's help names "Order" and "Refund" as values of the Type column. The other values are matched to the transaction categories eBay's help page lists:

| Type text contains | Treated as |
| --- | --- |
| Order | sale |
| Shipping label / Postage label | shipping label |
| Refund / Return | refund |
| Claim | claim |
| Dispute | payment dispute |
| Hold | hold |
| Payout / Transfer / Withdrawal | the payout itself |
| Fee | fee (e.g. "Other fee" for promoted listings) |
| Adjustment | adjustment |
| Credit | credit |
| Charge | charge |

A Type StockPilot doesn't recognise is **kept**: it is counted at its Net amount exactly as eBay reports it, and flagged "needs review". It is never dropped.

**Formats handled:**
- Dates: "Jan 28, 2026", "28 Jan 2026", "2026-01-28" (with or without a time), and numeric dates. Numeric dates are read month-first unless the file has one that can only be day-first; when every date could be read either way, the preview says so.
- Amounts: "1,234.56", "-9.45", "($9.45)", "$9.45" and "USD 9.45".
- eBay's "--" for empty cells.
- Fee columns count as charges, whether eBay writes them as negative or positive.

### Payout report

The file starts with a summary: Seller, Start date / End date, Payouts (how many) and Amount (total). Then one row per payout:

| Column | Used for | Required |
| --- | --- | --- |
| Payout date | Date of the payout | **Yes** |
| Payout ID | Linking to the transaction report | **Yes** |
| Amount | **The amount actually paid** | **Yes** |
| Status | Pending vs paid ("Initiated", "Succeeded", "Failed"…) | |
| Payout method, Currency, Payout type, Memo | Shown for reference | |

When StockPilot can read the summary, it checks it: if the number of payouts or their total doesn't match the rows, the preview says so.

### Validation and duplicates

- **Unsupported file:** "StockPilot doesn't recognise this file". The preview shows the columns it found and the supported reports.
- **Missing required columns:** the preview names them.
- **Any row that can't be read** (an invalid date or amount): the whole file is refused, with the line numbers. A partial report would make payouts look wrong.
- **The same file imported twice:** recognised by a fingerprint of its contents. It says when it was imported and imports nothing.
- **Rows already imported** (e.g. overlapping date ranges) are skipped.
  - If a later report adds payout details to a row that was waiting or on hold, only those details are filled in. The original references and amounts are kept, and the row remembers both imports.
  - If a later report shows a different amount for the same row, the first amount is kept and the preview says so.
- **Different currency:** if the report's currency differs from StockPilot's, the preview warns that amounts are compared as reported, without conversion.
- **Nothing is saved before Import.** Importing never creates, edits or replaces a sale.

Other marketplaces can be added as further `ReportAdapter`s (`src/marketplace/reports.ts`). The reconciliation engine works on normalised transactions and doesn't know about eBay.

## 2. Matching eBay orders to your sales

Sales now have an optional **Order number** field (in Record sale). Matching is done in this order:
1. **A match you confirmed** earlier.
2. **The same order number** on exactly one sale and one eBay order line. For a multi-item order, the **SKU** (eBay "Custom label") decides between lines when it's unique.
3. **Nothing else is matched automatically.** For an unmatched eBay order, StockPilot suggests up to three recorded sales and shows why: same SKU, same quantity, same amount, how many days apart, similar title, sold on eBay. You confirm with **It's this sale** or record the sale. A confirmed match can be removed.

**Never automatic:**
- Two sales with the same order number and SKU (e.g. the same sale entered twice) are shown as **ambiguous** and must be chosen by you.
- A recorded sale that no report row matches is listed under "Recorded eBay sales not found in your reports", with possible reasons: not paid out yet, an order-number typo, sold elsewhere, or a possible duplicate.

Payout dates are never assumed to equal sale dates: rows are grouped by eBay's **Payout ID**.

## 3. The calculation

Everything is integer-cent arithmetic and deterministic. For each payout:

```
Expected payout =  sales you recorded for its orders
                 − marketplace fees you recorded on those sales
                 − shipping you recorded (only for orders where eBay charged a shipping label)
                 + items in eBay's report that aren't sales:
                     tax you collected, refunds and returns, claims and disputes, holds,
                     account fees, and fees or labels on orders not matched to a sale
Actual payout   =  the payout report's Amount
Difference      =  actual − expected
```

The rules behind it:
- **Each recorded amount counts once.**
  - A sale's revenue and fees are counted with the payout that contains the sale.
  - A sale's shipping is counted with the payout of the order's first shipping label.
  - Separate fee rows for a matched order (e.g. promoted listings) are covered by the fees recorded on the sale, so they aren't deducted again.
- **Inventory cost is never deducted.** A payout is money moved, not profit. Each payout page shows the accounting profit of its sales separately: sales − cost of goods sold (including exact Bulk Lot shares) − fees and expenses.
- **Sales tax:**
  - Tax eBay collected and remitted is in neither the payout nor revenue. It is shown for information only.
  - Tax you collected is in the payout but isn't revenue, so it's a separate line.
- **Withheld vs missing:** transactions eBay hasn't paid out yet, including funds on hold with eBay's reason, are listed under **Not paid out yet**, separate from any payout's difference. A payout eBay shows as "Initiated" or "Processing" is **Pending**.

The difference is then split into **findings**, each traced to report rows and sales. Each one is labelled **Confirmed** (the data shows it) or **Possible explanation** (a likely cause the data can't prove):

| Finding | Amount | Typical cause |
| --- | --- | --- |
| Sale not recorded in StockPilot | the order's net | Missing transaction (possible: never recorded, or recorded without an order number) |
| Order matches more than one sale | the order's net | Duplicate entries; you choose |
| Recorded sale amount differs | eBay item + shipping − recorded revenue | Incorrect recorded amount; buyer-paid shipping left out; sale recorded net of a refund |
| Marketplace fees differ | recorded − eBay's fees | Unrecorded fee (fixed fee, ad fee) or a fee credit |
| Fees in another payout | ± | Timing: evens out across two payouts |
| Shipping label differs / not recorded | recorded − eBay's label charges | Label adjustment, void, label not entered |
| Labels in another payout | ± | Timing |
| eBay's net isn't explained by its columns | net − (item + shipping + tax − fees) | A deduction in a column your export doesn't include |
| Payout differs from its imported rows | actual − Σ rows | Some of the payout's rows are in a report not yet imported (e.g. crossing a month), or funds held back |
| Possible duplicate | 0 | Two identical rows with different references. Both are counted, as eBay reported them. |
| Unexplained | whatever remains | Anything the data can't attribute |

The findings always add up exactly to the difference. That's tested on fixed and randomly generated payouts. The remainder is shown as **Unexplained** and never forced to zero.

**Outstanding adjustments** are report items that aren't sales (refunds, claims, holds, account fees, unknown types). They are part of the expected payout as reported, and each needs a look. For example, a refund on a recorded sale means that sale's profit may be overstated. You mark each one as reviewed, with a reason.

### Statuses

| Status | Meaning |
| --- | --- |
| **Reconciled** | The payout and your records agree to the cent. Or, if they don't, every finding (or the overall difference) is explained by you with a reason. The difference stays on screen. |
| **Unreconciled** | The difference isn't fully explained. |
| **Pending / timing difference** | eBay hasn't finished the payout, or the difference is only parts of orders paid out in another payout. |
| **Needs review** | It ties out but has open items (an ambiguous match, adjustments to review), or the amount paid isn't known yet, or none of its transactions are imported, or eBay reports it as failed or reversed. |

## 4. Sample reconciliations

These come from the sanitized fixtures in `src/marketplace/fixtures/` and are checked by `src/domain/reconcile.test.ts` and `e2e/payouts.spec.ts`. The seller recorded five eBay sales with their order numbers and did not record order 11-00004-00004.

**Payout 5000000001 (Feb 2): correct**

| | |
| --- | --- |
| Sales you recorded (Nike $120.00 + Sony $180.00) | +$300.00 |
| Marketplace fees you recorded ($15.82 + $24.25) | −$40.07 |
| Shipping labels you recorded (Nike) | −$9.45 |
| **Expected payout** | **$250.48** |
| **Actual payout** | **$250.48** |
| Difference | $0.00 → **Reconciled** |

Accounting profit on these sales: $300.00 − $125.00 item cost − $49.52 fees and shipping = $125.48. This is shown separately; item cost never enters the payout.

**Payout 5000000002 (Feb 9): incorrect, every cent explained**

| | |
| --- | --- |
| Sales you recorded (jacket) | +$73.50 |
| Marketplace fees you recorded | −$9.74 |
| Shipping labels you recorded | −$8.50 |
| Refunds and returns (from the report: partial refund on the Sony order) | −$15.50 |
| **Expected payout** | **$39.76** |
| **Actual payout** | **$77.82** |
| **Difference** | **+$38.06** → **Unreconciled** |
| Possible: sale not recorded, order 11-00004-00004 (Pokémon card lot) | +$42.11 |
| Confirmed: fees differ on the jacket. eBay $10.14 on the sale + $3.25 promoted listing fee = $13.39; recorded $9.74 | −$3.65 |
| Confirmed: shipping label differs. eBay $8.90; recorded $8.50 | −$0.40 |
| **Unexplained** | **$0.00** |

Recording the card lot with the pre-filled sale form leaves −$4.05: the fee and label differences. Accepting that with a reason marks the payout Reconciled, with "Difference of −$4.05 explained by you" still shown. Withdrawing the decision reopens it.

**Payout 5000000003 (Feb 16):** eBay status "Initiated", so it's **Pending**.

**Pyrex bowl, on hold:** $31.70 is listed under **Not paid out yet**, with eBay's reason. It's held funds, not missing money. Importing March's report fills in its payout (5000000004, Mar 2).

**Payout 5000000004 (Mar 2): crossing reporting periods.**
- With only February's reports imported, its transactions aren't there yet, so it shows **Needs review**: "import the transaction report covering the days before Mar 2, 2026".
- After March's report, $54.13 of its $61.63 is imported. The $7.50 gap is a *possible* explanation: "some of this payout's transactions are in a report you haven't imported".

## 5. The screens

- **Sales & Profit → Payouts:**
  - Summary tiles: payouts by status, total paid out, unreconciled difference, not paid out yet (with how much is on hold).
  - Status filter.
  - A table on large screens, cards on phones: marketplace, payout date, reference, expected, actual, difference, matched, unmatched, adjustments to review, status.
  - Lists of transactions not paid out yet and of recorded eBay sales not found in the reports.
  - Import history, and "How the numbers work".
- **Import eBay report:**
  - Lists the supported reports and where to download them.
  - Then a preview: format, dates, new / updated / already imported rows by type and amount, warnings, and errors with line numbers.
- **A payout:**
  - Its status, with the reason.
  - **The calculation**, line by line, each line tagged *Your records* or *eBay report*: expected, actual, difference, explained and unexplained.
  - Tax eBay collected, for information.
  - **In plain words**: the same figures as sentences, plus the accounting profit of its sales.
  - **Why it doesn't match**: each finding with its certainty, amount, explanation and supporting data, plus actions — confirm a suggested match, **Record this sale** (opens the normal sale form pre-filled from eBay's order; you choose the item and save), or **Mark as resolved…** with a reason.
  - **Adjustments from eBay's report**, each with **Mark reviewed…** and a reason.
  - **Transactions in this payout**: eBay's amount next to what your records say, with links to matched sales.
  - **History** of imports and decisions.
- **Record sale** has an optional **Order number** field.

## 6. Decisions and the audit trail

- **Every decision needs a reason** and is saved with its date: confirming or removing a match, resolving a finding, accepting a difference, reviewing an adjustment.
- **History is append-only.** Withdrawing a decision marks it as undone; it isn't deleted.
- **A decision covers the amount it was made for.** If new data changes that amount (e.g. a sale is recorded), the item reopens.
- **No decision changes a sale, fee or amount.** To correct a sale, edit it as usual; the reconciliation follows.

## 7. Accounting integrity

- **Imported reports are kept apart from sales**, so revenue, fees, refunds and inventory cost are never recognised twice. Realized profit, inventory, Bulk Lots, cost of goods sold and every existing report are unchanged.
- **A refund in eBay's report doesn't silently change a sale.** It is flagged so you can edit the sale (or cancel it to return the item to stock) if your records should reflect it.

## 8. Stored data and compatibility

There is **no migration and no schema bump**:
- `AppData.marketplace` holds imports, transactions, payouts, confirmed matches, decisions and the log. Data and backups without it load with an empty one.
- `Sale.orderNumber` is new. Older sales and backups load with no order number.
- Backups include everything, still as backup version 1. Restoring a new backup in an older version keeps all items, sales and profits but drops the marketplace data and order numbers.
- Buyer names and addresses from eBay's report are not stored.

## 9. For a future AI assistant

`payoutFacts()` returns a payout's exact figures, lines and findings with their supporting records as plain data. `explainPayout()` turns them into sentences.

The current rule-based assistant already answers "Why doesn't my eBay payout match?" from these figures, word for word. A future AI model would receive the same facts and only phrase them. It never calculates or invents an amount. No AI service is used or added.

## 10. Known limitations

- **eBay's exact Type labels** beyond "Order" and "Refund" aren't published. They are matched by keyword to the categories eBay documents, and unknown ones are flagged, never dropped. The same goes for the transaction report's title lines and date style. **Please check with one of your own exports** (see the manual checks).
- **Fees:** only the documented fee columns are read. Any other deduction shows up as "eBay's net isn't explained by its columns" rather than as a named fee.
- **Refunds and returns aren't separate records in StockPilot.** A refund is flagged so you can edit or cancel the sale. If you record a sale net of its refund, the refund is counted twice in the expected payout. The finding says so, and you resolve it with a reason.
- **Fees on multi-item orders** are compared per order, not per line.
- **One currency:** amounts are compared as reported, and a different currency is warned about, not converted.
- **An order-number match can't be rejected** directly. Change or clear the sale's order number instead.
- **Only eBay**, and only these two reports. eBay's Orders report, PDF statements, the 1099-K and other marketplaces aren't supported yet.
- Large reports are fine (everything is computed in the browser), but a single file is limited to 20 MB.

## 11. Manual checks before Feature 3

1. Download a **real** Transaction report and Payout report from your Seller Hub for one month and import both. Does the preview recognise them, with no unexpected warnings? Are the Type values recognised (none shown as "Other (needs review)")?
2. Check that one payout you know well ties out to the cent with what reached your bank.
3. Add the eBay order number to a few recorded sales and confirm they match automatically. Confirm one suggested match by hand.
4. Find a payout with a refund and check that the refund is flagged with the right sale.
5. Import the next month's report and check that held or late transactions move into their payout without duplicates. Re-import the same file and confirm it's refused.
6. Resolve a finding with a reason, withdraw it, and check the history.
7. Back up, restore, and confirm payouts, matches and decisions are intact.
8. On an iPhone: import a report from Files, open a payout, and use Mark reviewed and Record this sale.
9. If any column or Type in your export isn't recognised, share a sanitized copy (remove buyer names and addresses) so it can be supported exactly.
