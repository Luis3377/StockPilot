# StockPilot

**Know what you own, know what it's worth, and know what you're making.**

StockPilot is an inventory and profit assistant for resellers, collectors and small businesses. This repository contains the first public-pilot prototype: a fast, mobile-friendly web app that runs entirely in the browser, with no accounts, servers or paid services.

## What's in the prototype

| Area | What works |
| --- | --- |
| **Onboarding & modes** | First-run question “How will you be using StockPilot?” → Reseller, Collector or Small business. Switch modes any time (sidebar/top-bar switcher or Settings); the dashboard changes, the data never does. |
| **Overview** | A dashboard per mode with a period filter (this month, 30/90 days, this year, all time): realized profit, revenue, items sold, inventory cost, selling value, projected profit, slow movers, recent sales, collection value over time, stock levels to watch, discrepancies and more. |
| **Inventory** | Add, edit and delete (with confirmation) items with photos (resized on-device), SKU (auto-generated if blank), category, quantity, unit cost, asking price, estimated value, purchase date, condition, location, low-stock alert and notes. Search, filter (status, category, location, condition), sort and grid/list views. Restock (weighted-average cost) and manual quantity adjustments with reasons. |
| **Bulk lots** | **Add bulk lot** in Inventory: record several items bought for one price (plus freight, buyer's premium and other acquisition costs) and split the cost by each item's estimated resale value, or equally per unit. Exact to the cent, with a review step, a lot page that reconciles every cent (sold, written off, in stock), realized vs projected profit, and edits that need confirmation, keep a history and never change completed sales. See [docs/BULK_LOTS.md](docs/BULK_LOTS.md). |
| **Sales & Profit** | Record a sale against an item; stock goes down automatically and can never go below zero. Price per item or total, fees as an amount or %, seller-paid shipping and other expenses, with a live profit preview. Edit or cancel sales without double-counting stock. Realized and projected figures are always shown separately. |
| **AI Inventory Scanner (private beta, off by default)** | “Scan with AI” in Add Item: take or upload a photo and Claude suggests the name, brand, model, category, condition and a description. Suggestions are marked “AI” and must be checked; cost, quantity and prices are never filled in. Needs a build with the scanner enabled, the Cloudflare Worker in `worker/` and an invite code. See [docs/AI_SCANNER.md](docs/AI_SCANNER.md). |
| **Smart Insights** | Rule-based alerts (low stock, slow movers, low/negative margins, prices that may not be profitable, top earners, category performance, discrepancies) and a question box that answers questions like “How much profit have I made this month?” from your own data. Clearly labeled as rule-based — no AI model is used yet. |
| **Count Check** | Count physical stock (all items, a category or a location), see missing/extra units and their value, approve adjustments with reasons, and keep a history and adjustment log. Progress is saved as you go. |
| **Import / export / backup** | CSV import with validation, row-level errors and duplicate protection; CSV exports for inventory, sales & profit, monthly profit summary, adjustments and count discrepancy reports; full JSON backup (including photos) and restore. |
| **Demo mode** | Clearly labeled sample data in a separate dataset. Your real records are never touched. |
| **Design** | Light/dark/system themes, responsive layout with bottom tabs on phones, iPhone safe areas, “Add to Home Screen” support, accessible dialogs and charts (each chart has a table view). |

## Getting started

Requires Node.js 20+ (the AI scanner backend in `worker/` needs Node.js 22.12 or newer).

```bash
npm install
npm run dev          # http://localhost:5173
```

Other scripts:

```bash
npm run build        # type-check and build static files into dist/
npm run preview      # serve the production build
npm test             # unit tests (Vitest)
npm run test:e2e     # browser tests (Playwright; desktop + iPhone-sized viewport)
npm run check        # typecheck + unit tests + build
npm run build:scan-preview   # build with the AI scanner switched on (private preview only)
npm run test:worker  # scanner backend unit tests (run `npm ci` in worker/ first)
```

For the end-to-end tests, install a browser once with `npx playwright install chromium` (CI does this automatically).

### Hosting the pilot

`npm run build` produces a static site in `dist/` that works from any static host or sub-path (routing is hash-based), for example GitHub Pages, Netlify, Cloudflare Pages or Vercel — all free for this size. A GitHub Pages workflow is included in `.github/workflows/deploy-pages.yml`: with Settings → Pages → Source set to “GitHub Actions”, every push to the default branch publishes the app (it can also be run by hand from the Actions tab).

## How data is stored

Everything is stored **only on the user's device**, in the browser's IndexedDB (photos included). Nothing is uploaded. (Exception, only in builds with the AI scanner enabled: a photo the user chooses to analyze is sent to the scanner backend and Anthropic for that one request, and is not stored there. See [docs/AI_SCANNER.md](docs/AI_SCANNER.md).) Real data and demo data live in separate datasets; if two tabs are open, a change in one is reflected in the other.

Because there's no cloud copy yet, StockPilot is explicit about the risk and the protection:

- **Onboarding** explains where inventory is saved, what can remove it (deleting website data, switching browser or device; on iPhone, Safari's clean-up of sites not opened for about a week, and deleting the Home Screen icon) and how to protect it (backups). Someone moving from another browser or device can **Restore a backup** right from the welcome screen.
- **iPhone / iPad:** people using Safari are encouraged to **Add to Home Screen before entering important inventory**. WebKit's 7-day clean-up of unused sites doesn't apply to Home Screen apps, but the app keeps its **own** data, separate from Safari, so existing inventory is moved with a backup and Restore. The app never claims this guarantees permanent storage.
- **Backups:** Settings → Your data shows where the data is saved, when the last backup was and whether anything changed since, plus step-by-step instructions for moving to a new phone, another browser or the Home Screen app. A **backup reminder** appears on Overview and Inventory when there has never been a backup, or the last one is over a week old and things changed since ("Remind me later" hides it for three days).
- **Persistent storage:** the app asks the browser to protect its data from automatic cleanup (`navigator.storage.persist()`) where supported, and shows whether it was granted. Safari decides this itself and is more likely to grant it to Home Screen apps.
- Nothing ever migrates or overwrites data automatically: moving data is always a backup file plus Restore, done by the user. Restoring replaces the data in that place only; the backup file and the original copy aren't changed.

What iOS actually does can only be confirmed on a real iPhone; see [docs/MANUAL_TESTS_IOS.md](docs/MANUAL_TESTS_IOS.md).

## Calculations

All money is calculated at cent precision so totals always add up. The same names are used on the dashboard, item pages, Smart Insights and in the assistant's answers (defined once in `src/domain/terms.ts`, shown in the app under "What these numbers mean" and the ⓘ buttons). They're deliberately never merged:

- **Inventory cost** = cost per item × quantity on hand, for stock you still have. This is "money invested in unsold inventory".
- **Total asking price** = asking price × quantity, for unsold items that have an asking price. Not money received.
- **Est. market value** = the user's own estimated value × quantity, for items they've valued. Not a sale price or a guarantee.
- **Realized profit** (net profit) = revenue − cost of goods sold − marketplace fees − seller-paid shipping − other expenses, from completed sales.
- **Projected profit** (never mixed with realized profit) = unsold units × asking price − estimated selling costs − their cost. Selling costs are learned from your recorded sales (fees + shipping + other as a % of revenue) or set manually in Settings.
- **Revenue** = sale price × quantity (when the price is per item), or the entered total.
- **Cost of goods sold** = the cost leaving inventory: unit acquisition cost × quantity, or, when the unit cost isn't whole cents (a lot share like $3.3333), inventory cost before the sale minus after it, so selling units one by one never loses or creates a cent. The cost is captured when the sale is recorded so later edits don't silently rewrite history (the edit form offers to apply a corrected cost to past sales).
- **Bulk lot split** = total allocable cost (purchase price + additional costs) × (item's estimated resale value × quantity ÷ total estimated resale value), in whole cents with the largest-remainder method so the items always add up to the total exactly. See [docs/BULK_LOTS.md](docs/BULK_LOTS.md).
- **Profit margin** = realized profit ÷ revenue × 100, for the same period (shown as “—” when revenue is 0).
- **ROI** = realized profit ÷ cost of goods sold × 100 (shown as “—” when cost is 0).
- **Restocking** averages the unit cost of existing and new stock.

**Periods:** every figure says when it applies. Sales figures follow the period chosen on Overview ("this month", "in the last 90 days", …), and Smart Insights uses the same period, so the same metric with the same period always shows the same number. Stock figures (inventory cost, total asking price, slow movers, low stock) are tagged **Today**.

**Zero stock:** an item with quantity 0 is always labeled **Out of stock**, whether it sold or was corrected by a count. Items with a low-stock alert show the label in red (you plan to restock them), others in grey.

## Project structure

```
src/
  domain/      Data model, money/date helpers, profit calculations and pure state transitions
  data/        Storage adapter (IndexedDB), app store, backup/restore, input sanitising, demo data
  csv/         CSV parser/writer, inventory import with validation, exports
  insights/    Rule-based alerts and the question-answering assistant (provider interface for future AI)
  ai/          AI scanner: shared result schema and validator, form mapping, backend client
  ui/          Design-system components (buttons, dialogs, fields, charts, photos…)
  pages/       Screens, dialogs and the app shell
e2e/           Playwright browser tests
worker/        AI scanner backend (Cloudflare Worker): invite codes, limits, budget, Claude call
docs/          AI integration plan, production-readiness checklist, test coverage map
```

The domain layer is pure TypeScript with no browser dependencies, so the same inventory and profit logic can move to a server unchanged. The UI talks to storage through a `StorageAdapter` interface, so a secure per-user cloud backend can be added without redesigning the app.

## Further reading

- [docs/BULK_LOTS.md](docs/BULK_LOTS.md) — bulk lot cost splitting: the formula, rounding, reconciliation examples, editing rules, data compatibility and limitations
- [docs/TESTING.md](docs/TESTING.md) — how each functional requirement is tested
- [docs/MANUAL_TESTS_IOS.md](docs/MANUAL_TESTS_IOS.md) — checks that need a real iPhone (storage, Home Screen app, zoom, VoiceOver)
- [docs/AI_SCANNER.md](docs/AI_SCANNER.md) — the AI Inventory Scanner: how it works, costs, safeguards and how to switch on the private beta
- [docs/SCANNER_SETUP_WINDOWS.md](docs/SCANNER_SETUP_WINDOWS.md) — step-by-step setup of the private scanner test version on Windows
- [docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md) — how to add genuine AI insights securely
- [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) — what must be done before launching with real users
