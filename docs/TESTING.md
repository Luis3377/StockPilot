# How StockPilot is tested

Run `npm test` for unit tests and `npm run test:e2e` for browser tests (each browser test runs on a desktop viewport and an iPhone-sized touch viewport). The browser tests start two builds: the standard one (port 4174) and one with the AI scanner switched on (port 4175), whose backend is mocked.

The AI scanner's backend has its own tests: `cd worker && npm ci && npm test && npm run test:integration`. **No test calls a real AI service or costs anything**; every AI response is mocked.

## Functional requirements → tests

| Requirement | Where it's tested |
| --- | --- |
| Every navigation button opens the correct screen | `e2e/navigation.spec.ts` — “every navigation entry opens the correct screen” (sidebar on desktop, bottom tabs on phones) |
| Switching modes preserves inventory | `e2e/navigation.spec.ts` — “switching modes changes the dashboard but preserves inventory”; `src/data/store.test.ts` |
| Adding an item updates the list and dashboard | `e2e/inventory.spec.ts` — “add an item…” |
| Editing an item updates calculations | `e2e/inventory.spec.ts` — “edit an item…”; `src/domain/actions.test.ts` (cost corrections, quantity log) |
| Deleting with confirmation | `e2e/inventory.spec.ts` — “delete asks for confirmation and can be cancelled” |
| Recording a sale reduces stock | `e2e/sales.spec.ts`; `src/domain/actions.test.ts` |
| Profit includes all expenses | `e2e/sales.spec.ts` (fees, shipping, other, % fees, total price); `src/domain/calc.test.ts` |
| Editing/cancelling sales doesn't double-count | `e2e/sales.spec.ts` — “editing and cancelling a sale never double-counts stock”; `src/domain/actions.test.ts` (incl. moving a sale to another item, deleted items) |
| Stock never goes below zero | `e2e/sales.spec.ts` — “a sale can never take stock below zero”; unit tests |
| Filters and search | `e2e/inventory.spec.ts` — “search, filters and sorting…” |
| Count Check shortages/overages | `e2e/count.spec.ts`; `src/domain/actions.test.ts` (count check) |
| Count Check flags stock that changed after an item was counted | `e2e/count.spec.ts` — “a count is flagged when stock changes…”; `src/domain/actions.test.ts`; `src/data/backup.test.ts` (older drafts still restore) |
| CSV import/export | `e2e/data.spec.ts`; `src/csv/*.test.ts` (quoting, injection-safe output, duplicates, re-import) |
| Data persists after closing/reopening | `e2e/inventory.spec.ts` — “data is still there after closing and reopening the app”, photos after reload; `src/data/storage.test.ts` |
| Works on mobile screens | `e2e/navigation.spec.ts` — no sideways scrolling on any screen; the whole suite runs on an iPhone-sized viewport |
| Demo data separated from real data | `e2e/data.spec.ts` — “demo data is clearly labeled and kept separate”; `src/data/store.test.ts` |
| Empty states, invalid entries, errors | `e2e/inventory.spec.ts` (validation, duplicate SKU), `e2e/data.spec.ts` (bad CSV rows, missing columns, invalid backup), `e2e/insights.spec.ts` (insufficient data) |
| Backups & restore | `e2e/data.spec.ts`; `src/data/backup.test.ts` |
| Insights use real data and are labeled rule-based | `e2e/insights.spec.ts`; `src/insights/insights.test.ts` |

## AI Inventory Scanner → tests

| Requirement | Where it's tested |
| --- | --- |
| Correct identification fills the form (shoes, electronics, clothing, collectibles, tools) | `e2e/scanner.spec.ts` — “scan shoes/electronics/clothing/collectibles/tools…”, each saved as a real item with its photo |
| Unknown or ambiguous items | `e2e/scanner.spec.ts` — “an unrecognized item fills nothing…”, “a partly identified item…”; `src/ai/scan.test.ts` (unknown-style answers become blanks, status kept consistent) |
| Incorrect, incomplete or malformed AI answers | `e2e/scanner.spec.ts` — “malformed or unusable answers…”; `src/ai/scan.test.ts`; `worker/test/claude.test.ts` (bad JSON, missing text, `max_tokens`, refusals) |
| Prices, quantities and invented details are never filled | `e2e/scanner.spec.ts` — “prices, quantities and other invented fields… are ignored”, plus a check in every scan test; `src/ai/scan.test.ts` |
| Invalid uploads | `e2e/scanner.spec.ts` — non-image and corrupt files are rejected on the device and nothing is sent; `worker/test/image.test.ts` (size, base64, real file type, pixel dimensions); `worker/test/body.test.ts` and `handler.test.ts` (upload size enforced while streaming: missing, invalid, oversized and misleading `Content-Length`); integration test (oversized and chunked uploads in the real runtime) |
| API failures and timeouts | `e2e/scanner.spec.ts` — AI outage with retry, no connection, timeout, cancel, daily limit, budget; `worker/test/handler.test.ts` (every error code, refunds) |
| Manual corrections before saving | `e2e/scanner.spec.ts` — “the user’s corrections are kept when they scan again”; `src/ai/scan.test.ts` (typed values never overwritten) |
| Record creation through the existing Add Item | every e2e scan test saves the item and opens it |
| Images sent only on request | `e2e/scanner.spec.ts` — no request before Analyze; hidden scanner sends nothing |
| Invite codes: entry, rejection, revocation, lockout, never in backups | `e2e/scanner.spec.ts`; `worker/test/codes.test.ts`, `ledger.test.ts`, `handler.test.ts`; `worker/scripts/integration-test.mjs` |
| Limits and budget hold under concurrent use | `worker/test/ledger.test.ts` (400 simultaneous requests); `worker/test/budget.test.ts` (10 simultaneous scans with budget for 2; stopping before the budget; timeouts charged in full; overruns recorded and self-correcting; pinned prices; invalid price or budget settings switch the scanner off; reservation covers the largest possible image); integration test (10 concurrent scans in the real Workers runtime; possibly-billed failures charged in full) |
| API key never reaches the browser | `worker/scripts/integration-test.mjs`; the app only ever sends the invite code |
| Existing features unchanged; scanner absent from the standard build | the full existing suite; `e2e/scanner.spec.ts` — “standard build… shows no scanner anywhere”; edit-item shows no scanner |
| Phone layout | `e2e/scanner.spec.ts` — “scanner panel and result fit a phone screen” |

## Trust & usability fixes (Phase 2) → tests

`e2e/trust.spec.ts` (desktop and iPhone-sized), plus unit tests. What can only be confirmed on a real iPhone is listed in [MANUAL_TESTS_IOS.md](MANUAL_TESTS_IOS.md). **No automated test exercises real iOS storage behaviour.**

| Requirement | Where it's tested |
| --- | --- |
| Onboarding explains where data is saved, the risks, and how to protect it; iPhone users see Home Screen advice without guarantees | `trust.spec.ts` — "onboarding explains where inventory is saved…" (iPhone advice checked in the phone project) |
| Backup reminder appears when needed, Back up now downloads a backup, Remind me later persists | `trust.spec.ts` — backup reminder tests; `src/data/backupStatus.test.ts` (when it's due) |
| Moving data safely: backup, then Restore from the welcome screen in a fresh browser/app, with photos and settings; the original is untouched | `trust.spec.ts` — "moving inventory: back up here, then restore…" |
| Settings explains storage, persistent-storage status, how to move data and what could delete it | `trust.spec.ts` — "Settings explains where data is saved…" |
| Backup & restore, data and photos surviving a reload | `data.spec.ts`, `inventory.spec.ts` (reloads now wait for saves to finish) |
| Distinct, defined financial terms on the dashboard, cards and item page | `trust.spec.ts` — "every dashboard money figure is named…"; `src/insights/consistency.test.ts` |
| Assistant uses the same figures and definitions ("invested" = inventory cost; "worth" = all three) | `consistency.test.ts`; `trust.spec.ts` — "the assistant answers with the same figures…" |
| Slow-moving amounts labeled as inventory cost | `trust.spec.ts`; `consistency.test.ts` |
| Same period on Overview and Insights; identical margins for identical filters; every section labeled with its period | `consistency.test.ts` (all five periods); `trust.spec.ts` — "Smart Insights uses the dashboard’s period…" |
| Keyboard-only onboarding with visible focus; accessible names | `trust.spec.ts` — keyboard test |
| No WCAG 2.1 A/AA violations (axe) on onboarding, Overview, Inventory, item page, Insights, Settings, Add Item | `trust.spec.ts` — "no accessibility violations…" |
| Zero stock is always "Out of stock" | `trust.spec.ts` |
| Long names wrap, full name available, no overflow (cards, item page, AI result) | `trust.spec.ts`; `scanner.spec.ts` — "scanner panel and result fit phone screens, with long names shown in full" |
| Form text ≥ 16px on phones (no iOS zoom); scanner panel fits at 320/375/390/414 px | `trust.spec.ts`; `scanner.spec.ts` |

## Bulk lot cost splitting → tests

| Requirement | Where it's tested |
| --- | --- |
| Relative sales value allocation ($100 → $50 / $30 / $20) | `src/domain/lots.test.ts` — “splits by relative sales value”; `e2e/lots.spec.ts` — “splits a lot by estimated resale value, with additional costs…” |
| Penny-accurate, deterministic rounding | `src/domain/lots.test.ts` — `splitCents` (largest remainder, ties, BigInt amounts), “never loses or creates a penny…”, and a seeded random test of 60 lots with random sales, losses and edits that checks every cent each time |
| Multiple quantities; line total vs cost per item | `src/domain/lots.test.ts` — “weights each line by estimate × quantity…”, `exactPerUnit`; `e2e/lots.spec.ts` — “uneven pennies and several units…” (3 single-unit sales add up to exactly $10.00) |
| Missing or zero estimates; equal allocation | `src/domain/lots.test.ts` — “asks for estimates…”, “gives a $0 estimate a $0 share”, “splits equally per unit”; `e2e/lots.spec.ts` — “without estimates the lot can be split equally per unit” |
| Additional acquisition costs | `src/domain/lots.test.ts` — “creates one inventory item per line…”, empty/unnamed cost rows; `e2e/lots.spec.ts` (freight + buyer's premium) |
| Buying isn't a loss; inventory and profit integration | `src/domain/lots.test.ts` — “treats buying as inventory, not a loss”, “partial sales keep realized and projected figures apart” |
| Partial sales, losses, restocks, undone sales | `src/domain/lots.test.ts` — “accounts for losses, restocks, undone sales and edits without losing a cent”; existing `src/domain/actions.test.ts` still passes with cost-leaving cost of goods sold |
| Editing allocations: confirmation, history, completed sales protected | `src/domain/lots.test.ts` — “editing a lot” (delta and re-split, method switch, refusals, no-cost edits); `e2e/lots.spec.ts` — “editing costs after a sale…”, “lowering a lot's cost below what's already sold is refused” |
| Changes outside the lot are shown, not hidden | `src/domain/lots.test.ts` — “shows changes made outside the lot instead of hiding them” |
| Persistence | `e2e/lots.spec.ts` — reload after an edit |
| Backup/restore compatibility | `src/data/backup.test.ts` — “backup with bulk lots” (round trip, backups from before lots, older apps ignoring lots, broken lots rejected); `e2e/lots.spec.ts` — “backups keep lots…” |
| Scanner integration (identifies, never prices) | `e2e/lots.spec.ts` — “a scan identifies an item in the lot but never sets its price” (mocked API that wrongly returns prices), “the standard build offers no AI scanner in a lot” |
| Phones and accessibility | every `e2e/lots.spec.ts` test runs on desktop and an iPhone-sized viewport with no sideways scrolling; axe check of the review step, lot page and edit dialog |

## Marketplace payout reconciliation → tests

All tests use sanitized eBay reports in `src/marketplace/fixtures/` (documented column names, made-up sellers, buyers and orders).

| Requirement | Where it's tested |
| --- | --- |
| Supported formats, header detection, site variants, dates, "--" cells | `src/marketplace/ebay.test.ts` — transaction and payout reports, UK column names, day-first dates, summary check |
| Validation and understandable errors | `src/marketplace/ebay.test.ts` — unsupported file, missing required columns, unreadable rows refuse the whole file; `e2e/payouts.spec.ts` — the same in the import dialog |
| Duplicate imports | `src/marketplace/ebay.test.ts` — same file refused; overlapping rows skipped; later reports only fill in payout details; first amounts kept |
| Original references preserved, no buyer data stored, sales never changed | `src/marketplace/ebay.test.ts`, `src/domain/reconcile.test.ts` — “import never changes sales…” |
| Exact payout match | `src/domain/reconcile.test.ts` — payout 5000000001; `e2e/payouts.spec.ts` — “…reconciles an exact payout to the cent” |
| Missing transactions, incorrect fees, shipping adjustments | `src/domain/reconcile.test.ts` — payout 5000000002 (findings add up to the difference); label void in a later payout |
| Refunds and returns | `src/domain/reconcile.test.ts` — refund as outstanding adjustment; sale recorded net of a refund |
| Multiple sales in one payout; multi-item orders | `src/domain/reconcile.test.ts` — fixture payouts; SKU pairing |
| Payouts crossing reporting periods, held funds, pending payouts | `src/domain/reconcile.test.ts` — March report, gap finding, not paid out, initiated payout; `e2e/payouts.spec.ts` |
| Unmatched or ambiguous transactions | `src/domain/reconcile.test.ts` — suggestions never auto-match; same order + SKU is ambiguous; possible duplicate sale; `e2e/payouts.spec.ts` — confirming a suggestion |
| Tax collected by the seller or by eBay | `src/domain/reconcile.test.ts` — “tax the seller collected…” |
| Timing differences | `src/domain/reconcile.test.ts` — fee charged in a later payout |
| Penny accuracy and tie-out | `src/domain/reconcile.test.ts` — every payout checks lines = expected, rows = reported, findings = difference; 40 random multi-payout scenarios |
| Decisions with reasons, audit trail, reopening | `src/domain/reconcile.test.ts` — accept, change, undo; `e2e/payouts.spec.ts` — reason required, history, withdraw |
| Bulk lot costs and profit | `src/domain/reconcile.test.ts` — lot item sold on eBay: payout ignores cost, profit uses the exact share |
| Assistant explanations from exact figures | `src/domain/reconcile.test.ts` — `explainPayout`, `payoutFacts`, “why doesn't my eBay payout match?” |
| Backup/restore compatibility and persistence | `src/domain/reconcile.test.ts` — round trip, older backups, broken data; `e2e/payouts.spec.ts` — backup and restore, reload |
| Phones and accessibility | every `e2e/payouts.spec.ts` test runs on desktop and an iPhone-sized viewport with no sideways scrolling; axe on the dashboard, payout page and empty state |

## AI that shows its work (assistant calculations) → tests

The full map is in [EXPLAINABLE_AI.md §7](EXPLAINABLE_AI.md#7-tests). In short:

| Requirement | Where it's tested |
| --- | --- |
| Every figure reproducible from its records, to the cent | `src/insights/calculations.test.ts` — `expectReproducible` on every answer, 25 random shops, rounding |
| Profit, revenue, periods, clarification, zero sales, losses | `src/insights/calculations.test.ts`; `e2e/assistant.spec.ts` |
| Inventory cost vs value, inventory purchases, lots, partial lot sales | `src/insights/calculations.test.ts` |
| Payout explanations (confirmed vs possible, no invented fees), cash received | `src/insights/calculations.test.ts`; `e2e/assistant.spec.ts` |
| Refunds, duplicates, $0 cost, missing records | `src/insights/calculations.test.ts` |
| Calculation view, records, links, mobile, accessibility | `e2e/assistant.spec.ts` (desktop + iPhone-sized, axe) |
| AI wording with wrong numbers refused (Worker and app) | `src/ai/explainSchema.test.ts`, `worker/test/assistant.test.ts`, `e2e/assistant.spec.ts` |
| Prompt injection via names, notes and CSV text | `src/insights/calculations.test.ts`, `src/ai/explainSchema.test.ts`, `worker/test/assistant.test.ts` |
| Shared daily limit and monthly budget, reservations, kill switch | `worker/test/assistant.test.ts` |
| Only the question / capped facts sent; nothing sent by the standard build | `worker/test/assistant.test.ts`, `e2e/assistant.spec.ts` |
| Backup and restore | `src/insights/calculations.test.ts` |

## Max Bid Calculator → tests

The full map is in [MAX_BID.md](MAX_BID.md#tests). In short:

| Requirement | Where it's tested |
| --- | --- |
| $1,000 → $340 example; target ROIs; fees, shipping, unsold; fixed costs; buyer's premium and tax | `src/domain/bids.test.ts` |
| Zero/negative bids explained; missing and invalid inputs; rounding (400 random cases) | `src/domain/bids.test.ts`; `e2e/maxbid.spec.ts` |
| Scenarios, budget, planned bid | `src/domain/bids.test.ts`; `e2e/maxbid.spec.ts` |
| Drafts, edit, duplicate, passed/lost/reopen | `src/domain/bids.test.ts`; `e2e/maxbid.spec.ts` |
| Converting to a bulk lot once; original estimate kept; linking an existing lot | `src/domain/bids.test.ts`; `e2e/maxbid.spec.ts` |
| Plans never change inventory, money figures or assistant answers | `src/domain/bids.test.ts`; `e2e/maxbid.spec.ts` (inventory stays empty) |
| Backup and restore | `src/domain/bids.test.ts`; `e2e/maxbid.spec.ts` |
| AI scanner identifies, never prices | `e2e/maxbid.spec.ts` (mocked) |
| Phones and accessibility | `e2e/maxbid.spec.ts` (desktop + iPhone-sized, axe) |

