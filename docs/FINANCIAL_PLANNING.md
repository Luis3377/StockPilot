# Tax Set-Aside & Financial Planning

Financial Planning helps a business owner decide how much of their **recorded profit** to earmark for taxes and other goals. It answers six questions:

- How much profit have I recorded?
- How much should I consider setting aside, at a percentage **I** choose?
- How much have I actually recorded as set aside?
- Am I behind my target?
- How much profit remains after my planned reserves?
- What payments have I planned?

It is a **planning aid, not tax advice**:

- StockPilot doesn't know anyone's tax rate, assumes none, doesn't calculate tax liability, and doesn't file anything.
- A reserve based on the user's percentage may not cover every tax or obligation, and the app says so.
- Three different things are kept apart:
  - **recorded profit** comes from sales;
  - **estimated taxable income** is decided by tax rules and an accountant, and StockPilot doesn't compute it;
  - **cash** is in the bank, which StockPilot can't see.

It works the same for a sole owner, a partnership or a company. Nothing assumes a particular business structure or tax form.

## Where to find it

- **Sales & Profit → Financial Planning** (`#/sales/planning`). The link sits next to Monthly Close and Year-End Review, and also shows when there are no sales yet.
- Choose **Monthly**, **Quarterly** or **Annual**, then the period. The current month opens by default.
- **The assistant** in Smart Insights answers planning questions (see [The assistant](#the-assistant)).

## What the page shows

Every figure is labelled **Recorded** (from your records), **Estimated** (calculated from your own percentages or goals) or **User-entered** (amounts you typed).

| Figure | Where it comes from | Label |
| --- | --- | --- |
| Recorded realized profit | The period's sales: revenue − cost of goods sold − fees − shipping − other selling costs. It is exactly the Sales & Profit figure for the same dates (tested), and it matches Monthly Close and Year-End Review | Recorded |
| Suggested tax reserve | Recorded profit × your tax percentage | Estimated |
| Other planned reserves | Recorded profit × each other percentage reserve | Estimated |
| Profit remaining after planned reserves | Recorded profit − all suggested percentage reserves. It's not "cash safe to spend" | Estimated |
| Marked as reserved in this period | Net of the set-aside entries you dated in the period | User-entered |
| Remaining reserve target | What's still to set aside: each percentage reserve's target minus what you set aside in the period, plus each savings goal minus its balance | Estimated |
| Upcoming obligations (next 90 days) | Payments you planned, not yet marked done | User-entered |

The page also shows whether the period is closed (for a month), how many months are closed and whether the year is finalized (for a quarter or year), or that the period is in progress.

## Reserve calculations

```
Suggested reserve = recorded realized profit × your percentage   (only when profit is above zero)
Profit remaining after planned reserves = recorded realized profit − Σ suggested percentage reserves
Remaining for a percentage reserve = max(0, suggested reserve − set aside in the period)
Remaining for a savings goal = max(0, goal − set aside so far)
```

- **Cent-exact and deterministic.** The calculation works in whole cents and percentage basis points (25% = 2,500), rounding half a cent up once. For example, $259.33 × 22.5% = $58.349… = **$58.35**.
- **Zero or negative profit** suggests $0.00, never a negative reserve. The page and the assistant say why: "No profit recorded for … so nothing is suggested". Profit remaining then shows the loss as it is.
- **Percentages:**
  - must be from 0 to 100, with at most two decimals;
  - can be edited at any time, and each change is logged with the old and new value;
  - are never pre-filled. Until you choose one, the tax line says "Choose a percentage".
- **What isn't in recorded profit:**
  - The page lists what recorded profit leaves out:
    - business expenses never entered on a sale (rent, insurance, software, phone, vehicle);
    - sourcing-trip expenses, which StockPilot keeps separately;
    - planned obligations;
    - money set aside;
    - inventory purchases, which count when the items sell;
    - marketplace payouts, which are transfers, not profit.
  - So a reserve based on recorded profit may be higher than one based on taxable income, and the page says so plainly.
- **Warnings** come from the same checks as Sales & Profit:
  - a refund in an imported marketplace report that isn't recorded on the sale;
  - sales with no cost;
  - a period with no sales ("No sales are recorded for November 2026, so recorded realized profit is $0.00").

### Example (the test fixture)

October 2026 has three sales. Recorded realized profit is **$259.33**, the same as Sales & Profit and the October close. The user chooses 25%:

```
$259.33 × 25% = $64.83          suggested tax reserve
$259.33 − $64.83 = $194.50      profit remaining after planned reserves
```

They record a $50.00 transfer to tax savings on Oct 31: **$14.83 behind** the October target. They also add a $500 equipment-replacement savings goal, with $0 set aside by the end of October. The remaining reserve target is $14.83 + $500.00 = **$514.83**.

For the quarter (Q3 profit $128.00) the target is $32.00. For the year to date (profit $387.33) it is **$96.83**.

## Scenarios

**Compare percentages** shows 20%, 25% and 30%, plus your own setting and any percentage you type in. The page says these are **examples, not recommended tax rates**. Each row shows the arithmetic:

| Percentage | $1,000.00 of recorded profit | $259.33 (October above) |
| --- | --- | --- |
| 20% | $1,000.00 × 20% = $200.00; $1,000.00 − $200.00 = **$800.00** | $51.87; $207.46 remains |
| 25% | $1,000.00 × 25% = $250.00; $1,000.00 − $250.00 = **$750.00** | $64.83; $194.50 remains |
| 30% | $1,000.00 × 30% = $300.00; $1,000.00 − $300.00 = **$700.00** | $77.80; $181.53 remains |

## Suggested vs. actually set aside

- **Suggested** amounts are estimates from your percentages. **Set aside** amounts are what you record moving to savings.
- **No bank connection:**
  - StockPilot can't see a bank, so it can't confirm the money is there, and it says so in the page, the dialog and the assistant.
  - It never moves money.
- **Entry types:**
  - **Set aside** (deposit);
  - **Took out** (withdrawal), which is refused if it would take the reserve below zero;
  - **Adjustment** (signed).
- **Each entry has:**
  - a date, which can't be in the future;
  - an amount, in whole cents;
  - a reserve;
  - an optional note.
- **Duplicate protection:**
  - The same reserve, date, type and amount as an existing entry asks for confirmation ("Record it again only if it's a separate transfer").
  - **Record it again** is offered for a genuine second transfer.
- **Voiding:**
  - A mistake is **voided with a reason**, never deleted.
  - It stays in the history, crossed out, and stops counting.
  - Voiding a deposit that a later withdrawal relied on is refused.
- **Never an expense:**
  - Set-aside entries are allocations of your own money. They don't change profit, expenses, inventory or any closed month (tested).
  - Profit is never reduced twice: the suggested reserve is subtracted once, for "profit remaining", and recording the transfer subtracts nothing more.
- **Timing:**
  - A percentage reserve compares its target with entries **dated in the same period**.
  - A transfer made on Nov 3 for October's profit counts toward November unless you date it in October.
- **Savings goals** compare the goal with everything set aside up to the period's end (or today).

### Reserve kinds

| Kind | Notes |
| --- | --- |
| Taxes | One per dataset, always a percentage of profit. **Set percentage** creates it as "Taxes" |
| Equipment replacement | A savings goal or a percentage |
| Inventory purchasing fund | Money kept for future stock: not an expense, and not inventory until spent on items |
| Emergency reserve | |
| Upcoming business expenses | |
| Other | |

Reserves have unique names. They are **archived**, not deleted, and their history is kept.

## Upcoming obligations

- **What you enter:**
  - a description;
  - the expected date;
  - the estimated amount;
  - a category: tax payment, equipment purchase, insurance, software, inventory purchase, rent or other;
  - an optional repeat (monthly, every 3 months or yearly, with an optional last date);
  - an optional reserve it will be paid from.
- **Planning records only:**
  - Obligations never create expenses or change profit.
  - Marking one **Done** records nothing else, and the confirmation says "No expense was recorded."
- **No built-in deadlines:** StockPilot assumes no tax due dates. You enter yours.
- **Repeats:**
  - Repeating dates keep the original day of the month, falling back to the last day of a shorter month. So Jan 31 monthly gives Feb 28, Mar 31, and so on.
  - Yearly from Feb 29 gives Feb 28 in other years.
- **Reminders are in-app only:**
  - **Due soon** shows within 14 days and **Past its date** after the date.
  - They appear when you open StockPilot. Nothing is sent to a phone, and the page says so.
- **Duplicates:** the same description (any case), date and amount as an active obligation is refused.
- **Cancelling** keeps the record in the history.

## The assistant

The answers are rule-based, and every calculation is re-checked before it is shown. All amounts come from your sales and your own percentages, goals, entries and obligations. Rates, balances, transfers and obligations are never invented. With no percentage chosen, the answer is "You haven't chosen a reserve percentage yet. StockPilot doesn't assume a tax rate…".

| Question | Answer | Calculation and sources |
| --- | --- | --- |
| How much profit should I consider reserving? (month, quarter, year) | Your percentage × recorded profit, with the arithmetic | Profit (each sale) − suggested reserve = remaining |
| How much have I set aside? | Total and per reserve, as of today | Each entry you recorded (voided ones excluded) |
| What is my remaining reserve goal? | Still to set aside, per reserve | Targets and balances |
| What financial obligations are coming up? | Payments in the next 90 days, total and next one | Each planned obligation (labelled estimate) |
| How much profit remains after my planned reserves? | Recorded profit − suggested reserves | Profit (each sale) − each reserve |
| How did my reserve target change from last month? | This month's suggested reserve vs last month's, and why (it follows recorded profit) | Both months' sales |

- **Period:**
  - Questions use the period you name: "in October", "this quarter", "last quarter", "2026".
  - Without one, the current month is used.
  - "From last month" compares this month with last month.
- **Disclaimers:**
  - Answers about reserve targets say they are a planning estimate, not tax advice or what's owed, and that recorded profit isn't taxable income or cash.
  - Answers about money set aside and obligations say the amounts are the user's own entries, that StockPilot can't see the bank, and that none of it is an expense.
- **Explain with AI** (beta builds, only when tapped) sends the calculation and up to 8 of its records. These can include reserve notes and obligation descriptions, just as item names are sent elsewhere. They are treated as data, never as instructions.
- **AI layer:** in beta builds, AI only maps wording to these questions. The six new intents raise the worst-case interpret reservation from $0.0329 to **$0.0334** on Sonnet ($0.0017 Haiku, $0.0669 Opus). The shared $10 budget, invite codes, daily limits, privacy protections and models are unchanged.

## Stored data and compatibility

- **New, optional:** `data.planning` holds:
  - reserves (`categories`);
  - set-aside `entries` (voided entries are kept);
  - `obligations`;
  - the planning `audit` log.
- **Older data and backups** load with an empty plan. Backups and restores include everything above (tested).
- **Separate from accounting records:**
  - Planning never touches sales, items, lots, the inventory ledger, closes or year-end reviews.
  - Recording or voiding entries in a closed month or finalized year is allowed and doesn't reopen anything, because they aren't accounting records.
- **Nothing is deleted:**
  - Entries are voided, reserves archived and obligations cancelled.
  - StockPilot keeps up to 20,000 entries and refuses new ones beyond that rather than dropping old ones.
- **History:** the history log keeps the latest 5,000 changes.
- **Nothing new is paid for or connected:** no new services, no backend, no bank connection.

## Tests

| Requirement | Where |
| --- | --- |
| Reserve math: $1,000 × 25%; different percentages; fractional rounding; zero and negative profit | `src/insights/planning.test.ts` |
| Same profit as Sales & Profit and Monthly Close (month, quarter, year) | `src/insights/planning.test.ts` |
| Missing records and refund warnings from an imported eBay report | `src/insights/planning.test.ts` |
| Multiple reserves; planned vs set aside; withdrawals, adjustments, voiding; future dates; duplicates | `src/insights/planning.test.ts`; `e2e/planning.spec.ts` |
| Obligations: recurrence (month-end, quarterly, leap year, end date), done, cancelled, overdue, duplicates | `src/insights/planning.test.ts`; `e2e/planning.spec.ts` |
| Sales, inventory ledger and closed-month guard untouched | `src/insights/planning.test.ts` |
| Backup round trip | `src/insights/planning.test.ts` |
| Assistant questions, no assumed rate, verified calculations | `src/insights/planningAnswers.test.ts`; `src/ai/*.test.ts` (canonical questions for every intent); `e2e/planning.spec.ts` |
| Phones and accessibility | `e2e/planning.spec.ts` on desktop and an iPhone-sized viewport (no sideways scrolling, axe) |

## Limitations

- **Not tax software:**
  - no tax liability;
  - no self-employment, income, sales or payroll tax;
  - no deductions, credits or safe-harbor rules;
  - no filing and no due dates.
- **Recorded profit only:**
  - Expenses not entered on sales aren't in it.
  - Neither is inventory you bought but haven't sold, which matters for cash and possibly for taxes.
  - Ask an accountant how your business should treat these.
- **No bank connection:** set-aside balances are whatever you record.
- **Period matching:** percentage targets count entries dated in the same period, so date a transfer in the period it's for.
- **Calendar periods only:** months, quarters and years. Fiscal years aren't offered yet.
- **Reminders appear only inside the app.**
- **Single currency:** the one in Settings, as everywhere else in StockPilot.
