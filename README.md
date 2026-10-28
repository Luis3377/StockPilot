# StockPilot

**Know what you own, know what it's worth, and know what you're making.**

StockPilot is an inventory and profit assistant for resellers, collectors and small businesses. This repository contains the first public-pilot prototype: a fast, mobile-friendly web app that runs entirely in the browser, with no accounts, servers or paid services.

## What's in the prototype

| Area | What works |
| --- | --- |
| **Onboarding & modes** | First-run question “How will you be using StockPilot?” → Reseller, Collector or Small business. Switch modes any time (sidebar/top-bar switcher or Settings); the dashboard changes, the data never does. |
| **Overview** | A dashboard per mode with a period filter (this month, 30/90 days, this year, all time): realized profit, revenue, items sold, inventory cost, selling value, projected profit, slow movers, recent sales, collection value over time, stock levels to watch, discrepancies and more. |
| **Inventory** | Add, edit and delete (with confirmation) items with photos (resized on-device), SKU (auto-generated if blank), category, quantity, unit cost, asking price, estimated value, purchase date, condition, location, low-stock alert and notes. Search, filter (status, category, location, condition), sort and grid/list views. Restock (weighted-average cost) and manual quantity adjustments with reasons. |
| **Sales & Profit** | Record a sale against an item; stock goes down automatically and can never go below zero. Price per item or total, fees as an amount or %, seller-paid shipping and other expenses, with a live profit preview. Edit or cancel sales without double-counting stock. Realized and projected figures are always shown separately. |
| **Smart Insights** | Rule-based alerts (low stock, slow movers, low/negative margins, prices that may not be profitable, top earners, category performance, discrepancies) and a question box that answers questions like “How much profit have I made this month?” from your own data. Clearly labeled as rule-based — no AI model is used yet. |
| **Count Check** | Count physical stock (all items, a category or a location), see missing/extra units and their value, approve adjustments with reasons, and keep a history and adjustment log. Progress is saved as you go. |
| **Import / export / backup** | CSV import with validation, row-level errors and duplicate protection; CSV exports for inventory, sales & profit, monthly profit summary, adjustments and count discrepancy reports; full JSON backup (including photos) and restore. |
| **Demo mode** | Clearly labeled sample data in a separate dataset. Your real records are never touched. |
| **Design** | Light/dark/system themes, responsive layout with bottom tabs on phones, iPhone safe areas, “Add to Home Screen” support, accessible dialogs and charts (each chart has a table view). |

## Getting started

Requires Node.js 20+.

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
```

For the end-to-end tests, install a browser once with `npx playwright install chromium` (CI does this automatically).

### Hosting the pilot

`npm run build` produces a static site in `dist/` that works from any static host or sub-path (routing is hash-based), for example GitHub Pages, Netlify, Cloudflare Pages or Vercel — all free for this size. A manual GitHub Pages workflow is included in `.github/workflows/deploy-pages.yml` (enable Pages → “GitHub Actions” in the repository settings, then run the workflow).

## How data is stored

Everything is stored **only on the user's device**, in the browser's IndexedDB (photos included). Nothing is uploaded. The app tells users this during onboarding and in Settings, asks the browser to protect the data from automatic cleanup, and makes backups one click away. Clearing browser data deletes the records, so users should download backups regularly.

Real data and demo data live in separate datasets. If two tabs are open, a change in one is reflected in the other.

## Calculations

All money is calculated at cent precision so totals always add up.

- **Revenue** = sale price × quantity (when the price is per item), or the entered total.
- **Cost of goods sold** = unit acquisition cost × quantity. The cost is captured when the sale is recorded so later edits don't silently rewrite history (the edit form offers to apply a corrected cost to past sales).
- **Net profit** = revenue − cost of goods sold − marketplace fees − seller-paid shipping − other expenses.
- **Profit margin** = net profit ÷ revenue × 100 (shown as “—” when revenue is 0).
- **ROI** = net profit ÷ cost of goods sold × 100 (shown as “—” when cost is 0).
- **Projected profit** (never mixed with realized profit) = unsold units × asking price − estimated selling costs − their cost. Selling costs are learned from your recorded sales (fees + shipping + other as a % of revenue) or set manually in Settings.
- **Restocking** averages the unit cost of existing and new stock.

## Project structure

```
src/
  domain/      Data model, money/date helpers, profit calculations and pure state transitions
  data/        Storage adapter (IndexedDB), app store, backup/restore, input sanitising, demo data
  csv/         CSV parser/writer, inventory import with validation, exports
  insights/    Rule-based alerts and the question-answering assistant (provider interface for future AI)
  ui/          Design-system components (buttons, dialogs, fields, charts, photos…)
  pages/       Screens, dialogs and the app shell
e2e/           Playwright browser tests
docs/          AI integration plan, production-readiness checklist, test coverage map
```

The domain layer is pure TypeScript with no browser dependencies, so the same inventory and profit logic can move to a server unchanged. The UI talks to storage through a `StorageAdapter` interface, so a secure per-user cloud backend can be added without redesigning the app.

## Further reading

- [docs/TESTING.md](docs/TESTING.md) — how each functional requirement is tested
- [docs/AI_INTEGRATION.md](docs/AI_INTEGRATION.md) — how to add genuine AI insights securely
- [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) — what must be done before launching with real users
