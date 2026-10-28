# How StockPilot is tested

Run `npm test` for unit tests and `npm run test:e2e` for browser tests (each browser test runs on a desktop viewport and an iPhone-sized touch viewport).

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
| CSV import/export | `e2e/data.spec.ts`; `src/csv/*.test.ts` (quoting, injection-safe output, duplicates, re-import) |
| Data persists after closing/reopening | `e2e/inventory.spec.ts` — “data is still there after closing and reopening the app”, photos after reload; `src/data/storage.test.ts` |
| Works on mobile screens | `e2e/navigation.spec.ts` — no sideways scrolling on any screen; the whole suite runs on an iPhone-sized viewport |
| Demo data separated from real data | `e2e/data.spec.ts` — “demo data is clearly labeled and kept separate”; `src/data/store.test.ts` |
| Empty states, invalid entries, errors | `e2e/inventory.spec.ts` (validation, duplicate SKU), `e2e/data.spec.ts` (bad CSV rows, missing columns, invalid backup), `e2e/insights.spec.ts` (insufficient data) |
| Backups & restore | `e2e/data.spec.ts`; `src/data/backup.test.ts` |
| Insights use real data and are labeled rule-based | `e2e/insights.spec.ts`; `src/insights/insights.test.ts` |
