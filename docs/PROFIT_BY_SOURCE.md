# Profit by Source + Profit per Hour

Signature Feature 4. It shows where your inventory comes from, what each source actually earns once its items sell, how much cash is still tied up in its unsold stock, and how much realized profit each logged hour of your work produces.

Everything here is worked out from records you saved: purchases, sales, sourcing trips and logged time. Nothing is estimated or guessed. A source is never called profitable because of what its unsold items might be worth.

## Where to find it

- **Smart Insights → Sourcing Performance** (the button at the top of Smart Insights). It has five tabs:
  - **Overview**: totals, charts, a card per source, and tables by source type and by product category. Filter by period, category and source type.
  - **Profit per hour**: the formula with your numbers, then the figures by source, by category and by trip.
  - **Trips**: sourcing trips (outings), with the best completed trips first.
  - **Time log**: the timer, manual entries, and the history with edit and delete.
  - **Sources**: add, edit, rename, merge and delete sources; register names typed on lots; assign a source to records that have none; the change log.
- **A source's page**: click its name anywhere. It lists every purchase, sale and time entry behind its figures, each linked to the record.
- **A trip's page**: click a trip. It shows what was bought on it, its expenses, time and result, and lets you link items or lots to it.
- **Add item → More details → "Where you bought it"** and an optional **Sourcing trip**.
- **Add bulk lot → "Where you bought it"** (the same field as before, now backed by your sources) and an optional **Sourcing trip**.
- **The assistant** in Smart Insights answers sourcing questions (see [The assistant](#the-assistant)).

## Sources

A source has a **type** and a **name**, for example *Thrift store*: *Goodwill — West Little Rock*. It can also have a location or description and notes.

The types are: thrift store, garage / yard sale, estate sale, online marketplace, liquidation supplier, storage unit auction, retail store / clearance, wholesale, auction, and other.

### Avoiding duplicates

- Names are compared ignoring capitals, punctuation, accents, extra spaces and "&" vs "and". *goodwill west*, *Goodwill — West* and *GOODWILL-WEST* are the same source, and adding it a second time is refused with "You already have …".
- Close spellings (*saturday garage sale* vs *Saturday garage sales*) are pointed out with **Did you mean …?** before a new source is added. One click uses the existing source.
- Typing a new name shows the type to choose (guessed from the name, and always editable) and says the name will be added to your sources.

### Kept separate from other fields

- **Storage location** (where an item is kept now) is a different field and is not affected.
- **Adjustment reasons** (Count Check, write-offs) are not affected either.

### Changes are explicit and logged

- **Rename**: the old name is kept as an alias, so records that say the old name (for example a lot whose "Where you bought it" text is the old name) stay with the source. History is never rewritten.
- **Merge** two sources that are the same place: every item, lot, trip and time link moves to the one you keep, which keeps the other name as an alias. It says how many records moved.
- **Delete**: only a source that nothing refers to can be deleted.
- **Assign** a source to an item or lot that has none (Sources → Unassigned source): one record at a time, never guessed.
- The **change log** on the Sources tab lists every source added, renamed, edited, merged, deleted or assigned, with the date and time.

## Attribution: which source a record belongs to

| Record | Source |
| --- | --- |
| A standalone item | The source chosen in "Where you bought it" |
| A bulk lot | The source named in its "Where you bought it" |
| An item in a bulk lot | **Always the lot's source**. The item form shows the lot's source instead of its own field. |
| A sale | The source of the item sold (for a lot item, the lot's source). A sale whose item was later deleted keeps its lot's source if the lot still lists it, otherwise "Unassigned source". |
| A lot whose text isn't one of your sources | Shown under that name ("name from a lot, not in your sources yet"), never merged into another source. **Sources → Names from your lots → Add to my sources** registers it. A lot bought from a Max Bid plan takes its type from the plan (pallet → liquidation supplier, …). |
| Anything with no source | **Unassigned source**. It is always shown, so the totals still add up. |

A lot keeps its source while its text still names the source or one of its aliases. If the lot's text is later edited to a different name, the lot follows the text.

## Metrics

Every figure is for the selected **period**, except the "today" figures (inventory cost and units in stock, which are as of today).

| Figure | Definition |
| --- | --- |
| **Acquisition cost** ("Bought") | What you paid for items and lots from the source that were bought in the period. Lots count their full cost (purchase price + recorded buying costs + costs added later). Items count every unit ever bought, including restocks. |
| **Sales revenue** | Σ sale price × quantity, for sales dated in the period |
| **Cost of goods sold** | What the **sold units** cost you (recorded with each sale). For a lot item, its exact share of the lot. A partly sold lot never counts its full cost. |
| **Fees · shipping · other** | The selling expenses recorded on those sales |
| **Realized profit** | Revenue − cost of goods sold − fees − shipping − other selling expenses. The same formula and records as Sales & Profit. |
| **Margin** | Realized profit ÷ revenue |
| **ROI** | Realized profit ÷ **cost of goods sold** (the cost of what sold, not of everything bought, so a source still selling isn't penalized for stock it hasn't sold yet) |
| **Units purchased / sold / in stock** | Units bought in the period / units sold in the period / units on hand today |
| **Tied up in stock** (cash tied up) | Inventory cost today: cost per item × quantity on hand, for the source's items |
| **Avg. days to sell** | Days from purchase (the lot's or item's purchase date, else the date it was added) to the sale, weighted by units |
| **Avg. days in stock** | The same for units still on hand, as of today |
| **Trip expenses** | Expenses of trips to the source (see [Trips](#sourcing-trips)). Shown separately. They are **not** item costs and are **not** subtracted from realized profit. |
| **Logged time / profit per logged hour** | See [Profit per hour](#profit-per-hour) |

**Realized vs projected:** only completed sales count. Unsold stock appears as cash tied up at its cost, never as profit. Asking prices and estimated values are not used anywhere on these pages.

**Payouts are not revenue:** marketplace payouts are cash moved. Revenue comes from recorded sales, as on Sales & Profit.

**No double counting:** each sale belongs to exactly one source, so the sources' realized profit adds up to the total, which matches Sales & Profit for the same dates to the cent (tested).

### Small samples

Sources and groups with fewer than 5 units sold are marked **Small sample**. The assistant says how few sales an answer rests on.

## Comparisons, charts and filters

- **Charts**: realized profit by source, and cash tied up by source (bars with the amounts written out).
- **Source cards**, in order of realized profit, with "Still selling" and "Small sample" badges.
- **By source type** and **By product category** tables: revenue, cost of goods sold, realized profit, margin, ROI, units sold and cash tied up.
- **Filters**:
  - **Period**: this month, last 30 days, last 90 days, this year, all time.
  - **Category**: shows only sales and stock in that category.
  - **Source type**.
- **What these figures mean** expands the definitions on the page.

## Sourcing trips

A trip (a sourcing session) is one outing: a name, date, the sources visited, expenses, notes, and what was bought.

- **Linking never adds a purchase.** Items and lots are added once, as usual. On a trip's page you link existing records to it, or choose the trip in the item or lot form. A record belongs to at most one trip. Lot items follow their lot.
- **Expenses** are one of two kinds:
  - **Buying costs**: entry fees, admission.
  - **Running costs**: fuel, parking, food.

  Both are shown with the trip and are never added to item costs. Costs that belong in an item's cost, like a buyer's premium, go on the lot.
- **Shared expenses and time are not split silently.**
  - When a trip visited **one** source, they count toward that source.
  - When it visited **several**, they stay in the totals but go to no single source until you choose how to divide them on the trip: **equally** or **by what you spent at each**. The page says how much is waiting for that choice.
- **Trip result** = sales revenue − selling expenses − what was bought on the trip − trip expenses.
- **Return** = trip result ÷ (what was bought + trip expenses).
- A trip is **completed** when everything bought on it has sold or been written off. Only completed trips are ranked as "best". A trip still selling shows "Result so far".
- Deleting a trip unlinks its items and lots (they stay in inventory). Time logged only to it becomes general work.

## Time tracking

Activities: **sourcing**, **listing & photos**, **packing & shipping**, and **other**.

- **Timer**: start, pause, resume, stop and save, or discard.
  - The timer is **saved with your data** (and in backups), not held in memory. It keeps counting while the app is closed or you switch screens.
  - Stopping saves an entry dated the day it started, rounded to the nearest minute (at least 1).
  - Only one timer runs at a time.
- **Manual entries**: date, hours and minutes (1 minute to 24 hours per entry), activity and a note.
- **History**: every entry with edit and delete.
- **What it was for**: link an entry to one or more trips, sources, lots or items, or to nothing (general work).
- **Shared time is counted once.** An entry linked to several things is divided **equally**, or by **custom shares** that must add up to 100% (refused otherwise). Each second is counted once.

How time reaches a source:

| Linked to | Counts toward |
| --- | --- |
| A source | That source |
| A lot or item | Its source (a lot item: the lot's source) |
| A trip | The trip's source when it visited one; divided by the trip's chosen split when it visited several; otherwise unallocated (shown) |
| Nothing | General work: in the total, not in any source (shown) |

Time counts toward a **category** only when linked to items or lots. A lot's time is split by each item line's share of the lot's cost.

## Profit per hour

**Realized profit per logged hour = realized profit ÷ hours logged**, for the same period.

- It is labelled "realized profit per logged hour", **not a wage**. Your time is not subtracted from profit, and unsold stock isn't counted.
- The period and the hours included by activity are shown with it.
- **"Not enough time data"** when no time is logged. It never divides by zero.
- **Incomplete time** is flagged: when there are sales but no sourcing, listing or shipping time in the period, the page says profit per hour is overstated.
- **Negative** values are shown as they are (a loss per hour).
- **Partial vs completed:** sources still selling are marked "still selling: more profit may come", so a source with stock left isn't compared as if it were finished. Trips are ranked by profit per hour only when they have logged time.

### Example (from the specification)

| Source | Realized profit | Logged hours | Profit per logged hour |
| --- | --- | --- | --- |
| Garage sales | $180.00 | 20 h | **$9.00** |
| Liquidation pallet | $620.00 | 20 h | **$31.00** |

Worked records behind the example (also a unit test):

- **Garage sales**: 10 records bought for $5 each, sold for $280 with $30 fees and $20 shipping. $280 − $50 − $30 − $20 = $180.
- **Liquidation pallet**: $350 + $30 freight, split by estimated value across 20 hand tools ($11.40 each) and 10 drills ($15.20 each).
  - All 20 tools sold for $700: $700 − $228 − $70 − $30 = $372.
  - 5 drills sold for $400: $400 − $76 − $40 − $36 = $248.
  - Total $620. The 5 unsold drills are $76.00 of cash tied up, not profit.
- **Shared time**: 2 hours split 70% / 30% between the two adds 1.4 h and 0.6 h, so $620 ÷ 21.4 h = $28.97 and $180 ÷ 20.6 h = $8.74.

## Integration with Bulk Lots and Predicted vs. Actual

- **Bulk lots**: a lot's "Where you bought it" field is the source field. Lot items use the lot's source, and cost of goods sold uses each item's exact lot share, so a partly sold lot only counts what sold. Lot pages and lot allocation are unchanged.
- **Max Bid → I bought this lot**: the lot form opens as before, and its source and trip are saved with the new lot. Unregistered lot names from Max Bid plans take a type from the plan's kind.
- **Predicted vs. actual**: unchanged. It compares a lot with its plan. Sourcing Performance compares sources, types, categories, trips and time, from the same sales.

## The assistant

Rule-based, with re-checked calculations (each re-adds from its records). The AI layer (beta builds) can map wording to these questions but never calculates.

| Question | Answer |
| --- | --- |
| Where do I make the most money? (optionally a period: "in October", "this year") | The source with the most realized profit, its margin and ROI, the next ones, and stock still unsold; the calculation lists its sales |
| Which thrift store is most profitable? (or garage sale, estate sale, liquidation, auction…) | The same, among sources of that type; says so if none has sales |
| What is my profit per hour? | Realized profit ÷ logged hours for the period, by source, flags missing activities; "Not enough time data" without time |
| Which category gives me the best return for my time? | Profit per logged hour by category (time linked to items or lots only) |
| How much inventory money is tied up at each source? | Inventory cost by source, as a calculation over the unsold items |
| Which sourcing trips were most successful? | The best completed trip by return after trip expenses, as a calculation (revenue − selling expenses − bought − trip expenses); trips still selling aren't ranked |
| Where should I consider sourcing more inventory? | The source with the best realized profit per logged hour (or ROI without time), stated as **past results, not a prediction**, with sample sizes and stock still unsold |

Answers state the period, the number of units behind them and small-sample caveats. They never use estimated values.

**AI cost:** the AI interpret step gained seven intents, so its worst-case reservation rises slightly ($0.0313 → $0.0319 on Sonnet). It uses the same shared $10 budget, limits, invite codes and security. The explain step and the AI models are unchanged.

## Stored data and compatibility

- **New, all optional:**
  - `data.sourcing`: `sources`, `sessions`, `timeEntries`, `timer` and `changes` (the change log).
  - `item.sourceId`, `item.sessionId`, `lot.sourceId` and `lot.sessionId`.
- **Older data and backups** load with no sources, trips or time, and every existing record shows as before. Lot source text keeps working, under its own name. No schema bump was needed.
- **Backups** include sources, trips, time entries, a running or paused timer and the change log, and restore them.
- **Nothing is rewritten:** existing records only change when you save a form, assign a source, link a record to a trip, or rename or merge (each logged).

## Tests

| Requirement | Where |
| --- | --- |
| Item and lot attribution; partial and completed lot sales | `src/insights/sourcing.test.ts` — "attributes individual items and bulk lots…"; `e2e/sourcing.spec.ts` — "“Where you bought it” on items and bulk lots…" |
| Source totals reconcile with sales, to the cent, across periods | `src/insights/sourcing.test.ts` — "source totals reconcile with the recorded sales" |
| Multiple and missing sources; Unassigned | both of the above; `e2e/sourcing.spec.ts` (assigning the unassigned lamp) |
| Duplicate names, near-misses, renames, merges, the log | `src/insights/sourcing.test.ts` — "sources"; `e2e/sourcing.spec.ts` |
| Trips: multiple trips, no duplicate purchases, completed trips, expenses | `src/insights/sourcing.test.ts` — "sourcing trips"; `src/insights/sourcingAnswers.test.ts`; `e2e/sourcing.spec.ts` |
| Shared time (70/30, multi-source trips), each entry once | `src/insights/sourcing.test.ts`; `e2e/sourcing.spec.ts` |
| Profit per hour; zero hours; incomplete time; negative profit | `src/insights/sourcing.test.ts` — "profit per hour…", "no time, missing activities and negative results…" |
| Timer persistence | `src/insights/sourcing.test.ts` (backup round trip); `e2e/sourcing.spec.ts` (reloads while paused and running) |
| Multiple categories; inventory cost | `src/insights/sourcing.test.ts` — "by type and by category"; `src/insights/sourcingAnswers.test.ts` |
| Backup/restore and older data | `src/insights/sourcing.test.ts` — "backup and compatibility"; `e2e/sourcing.spec.ts` (restores a backup) |
| Assistant questions with re-checked calculations | `src/insights/sourcingAnswers.test.ts`; `e2e/sourcing.spec.ts` |
| Existing AI intents still answered | `src/ai/explainSchema.test.ts`; `src/insights/calculations.test.ts` |
| Phones and accessibility | both `e2e/sourcing.spec.ts` tests run on desktop and an iPhone-sized viewport: no sideways scrolling, axe on the overview, sources, profit per hour, and trip pages |

## Limitations

- **Time is what you log.** Profit per hour is only as complete as your time entries. Missing activities are flagged, but time you never logged can't be detected.
- **One timer** at a time. It uses the device clock. An entry is capped at 24 hours, so a timer left running longer saves 24 hours (edit the entry if needed).
- **Trip expenses** are shown per trip and per source but are not subtracted from realized profit (consistent with Sales & Profit). A trip's own result does subtract them.
- **Trips with several sources** need a split choice before their time and expenses reach a source.
- **Category time** counts only time linked to items or lots.
- **Restocked items** are attributed to the item's one source. Restock units bought elsewhere can't be told apart.
- **Lot text edits**: changing a lot's "Where you bought it" in **Edit lot** moves the lot to the source its new text names. The change is recorded in the lot's own edit history, not in the sources change log.
- **Data stays on this device** like the rest of StockPilot. Back it up to keep it.
