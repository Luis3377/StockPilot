# Learning Center and guided tours

StockPilot teaches itself. Someone with no accounting or inventory background can follow short, hands-on lessons that point at the real buttons, fields and figures in the app, one step at a time, and practise on sample records that never touch their own.

> After the first QA review, see [TUTORIAL_QA_1.md](TUTORIAL_QA_1.md): Practice Mode data lock, one tab per lesson, an interactive Max Bid lesson, collector details, worked examples, and discovery of every lesson in every mode.

- [Where to find it](#where-to-find-it)
- [How a lesson works](#how-a-lesson-works)
- [Lessons](#lessons)
- [Practice mode: how practice records are kept apart](#practice-mode-how-practice-records-are-kept-apart)
- [Safeguards](#safeguards)
- [Help icons](#help-icons)
- [Progress, refreshes and backups](#progress-refreshes-and-backups)
- [Accessibility and phones](#accessibility-and-phones)
- [Trying it locally](#trying-it-locally)
- [Tests](#tests)
- [Adding a lesson](#adding-a-lesson)
- [Known limitations](#known-limitations)

## Where to find it

- **Welcome.** After onboarding, new users see *"Welcome to StockPilot! Let's show you how to manage inventory, track sales, and understand your business's profits."* with **Start guided tour** and **Explore on my own**. It's never required, and it isn't shown again after either choice (Escape or closing it counts as "Explore on my own"). People who used StockPilot before the Learning Center existed aren't shown it.
- **Learning Center.** A **Learning Center** link sits above the mode switcher in the sidebar (desktop), and a graduation-cap icon sits in the top bar (phones). It opens `#/learn`.
- **Help icons.** A small **ⓘ** next to key figures explains the term and links to its entry in the Learning Center (see [Help icons](#help-icons)).
- **Resume tour.** An unfinished lesson is offered on the Overview and at the top of the Learning Center.

The Learning Center page has:

1. **Your path** for the current mode, with each lesson's status (not started, in progress at step *n* of *m*, completed, skipped) and **Start**, **Resume**, **Start over** or **Replay**, plus "*x* of *y* lessons done".
2. **All lessons** for the mode, grouped as *Basic inventory*, *Sales*, *Buying intelligence*, *Business insights* and *Financial reporting*, then **Lessons made for other modes** (all 17 are always listed; starting one never changes your mode). A lesson that can't run says why (e.g. sales tracking is off, or the AI scanner is switched off).
3. **Search** across every lesson's text (titles, summaries, keywords and every step) and the help topics.
4. **Help topics**: what each figure means and how StockPilot calculates it, with **See it in StockPilot** (opens the page with that explanation showing) and **Lesson: …** links.
5. **Practice records**: what's kept, when it's cleared, and **Delete practice records**.
6. **Show the welcome again**.

## How a lesson works

The tour engine (`src/learn/TourProvider.tsx`) runs on top of the real app:

- The page is **dimmed** except for the control the step is about, which gets a highlight ring. A **lesson box** beside it says what to do and why, shows **Step *n* of *m*** with a progress bar, and has **Back**, **Next** (when the step allows it), **Skip lesson** and **Exit** (plus an ✕). On the last step: **Finish**, and **Next: *lesson*** to continue the path.
- A step moves on **only when it's actually done**:
  - *click* steps: a click on the highlighted control (nothing else counts);
  - *field* steps: leaving the field (Tab, or moving to another field) with a valid answer, or choosing from a list; **Next** with an invalid answer shows what's wrong instead of moving on;
  - *result* steps: a verified result in the records, e.g. "an item was saved" (more items than when the lesson started) and the form has closed;
  - *look* steps: **Next**.
- **Wrong clicks** on the dimmed page don't do anything; the box explains that the page is paused and points to the highlighted area or Exit.
- **Keyboard**: Tab only moves between the highlighted control(s) and the lesson box; Tab or Enter in a field with a valid answer moves on; Escape exits.
- **One tab at a time**: the tab that started (or continued) a lesson runs it; other StockPilot tabs say so and offer "Continue it here", and take over if that tab is closed.
- **Look-only steps can't operate the highlighted control** (a clear shield sits over it), so an explanation lesson never saves, imports, closes, deletes or sends anything.
- **Navigation**: a step that belongs to a page opens it once when the step starts. If you go elsewhere, the box says so and offers **Take me back**.
- **Forms and dialogs**: steps inside the Add item / Record sale forms highlight one field at a time. If the form is closed (or the page is refreshed), the lesson goes back to the step that opens it, with a note.
- **Missing controls**: an optional step whose control isn't there is skipped; otherwise, after a few seconds the box says *"This part of the screen isn't showing"* with **Try again**, **Skip this step** and **Exit**. The user is never stuck.
- **Exit** (or Escape) pauses: the place is remembered, practice mode ends, and the lesson can be resumed from the Learning Center.

## Lessons

Practice lessons (🧪) run on practice records, several with a ready-made worked example. All others only look around.

| Lesson | Group | Modes | What it covers |
| --- | --- | --- | --- |
| Getting around StockPilot | Basic inventory | all | The Overview, headline figures, the main menu and the Learning Center |
| 🧪 Add your first product | Basic inventory | reseller, business | Opening Inventory, Add item, name, quantity, **cost per item** (*"Cost per item is what you paid for one product. StockPilot uses this amount to calculate how much profit you make when the item sells."*), selling/asking price, saving, inventory cost |
| 🧪 Record a sale and read your profit | Sales | all (needs sales tracking) | Record sale, item, sale price, fees (amount or %), saving; then **revenue**, **cost of goods sold**, **realized profit**, **margin** and **ROI** calculated from your own practice sale (and why profit isn't cash). Straight after "Add your first product" it sells the product you just added |
| Checking inventory levels | Basic inventory | reseller, business | Search, In stock / Low stock / Out of stock, Count Check |
| 🧪 Sourcing Performance and profit per hour | Business insights | reseller, business | A practice purchase, sale and logged time: results by source, where you record sources and time, profit per logged hour (not a wage) |
| 🧪 Understanding Monthly Close | Financial reporting | reseller, business | A practice month: figures (verified / partly / missing), a worked inventory reconciliation, the checklist (nothing is closed) |
| Financial planning and reserves | Financial reporting | reseller, business | The disclaimer, tax reserve (your own percentage), 20/25/30% examples, money set aside |
| Backing up your data | Basic inventory | all | Where records live, Download backup, what Restore does |
| 🧪 Adding items with the AI scanner | Buying intelligence | all, **only when the scanner is enabled** | Where Scan with AI is and what Analyze does; never analyzes anything |
| 🧪 The Max Bid Calculator | Buying intelligence | reseller | New calculation → your resale estimate → your target return → the **real** maximum bid, highlighted and explained, with the breakdown |
| 🧪 Bulk lots and cost splitting | Buying intelligence | reseller, business | A $100 practice lot split $75 / $25 by estimated resale value, on the real lot page |
| Marketplace payout reconciliation | Sales | reseller, business | Which eBay reports to download, a worked payout difference, how to investigate; never imports |
| 🧪 Predicted vs. actual | Business insights | reseller | A practice pallet bought with a Max Bid plan, sold below the plan: the comparison and why it differs |
| 🧪 Adding a collectible | Basic inventory | collector | Name, cost, **estimated market value** (an estimate, not a sale or appraisal), then More details: condition, purchase date and where you got it |
| Organizing your collection | Basic inventory | collector | Search, categories and locations |
| Value: what you paid vs. what it's worth | Business insights | collector | Cost vs asking price vs estimated market value, and their limits |
| Optional: sales and profit | Sales | collector | What “Track sales & profit” adds (the lesson doesn't switch it on) |

**Learning paths** (the welcome tour follows these; lessons that can't run are left out):

- **Small business:** Getting around → Add your first product → Record a sale → Inventory levels → Sourcing Performance → Monthly Close → Financial planning → Backup.
- **Reseller:** Getting around → Add your first product → AI scanner (when enabled) → Max Bid → Bulk lots → Record a sale → Payouts → Predicted vs. actual → Sourcing Performance → Backup.
- **Collector:** Getting around → Adding a collectible → Organizing → Valuation → Optional sales → Backup.

Every dollar amount in a lesson is an example and is labelled **Illustrative example** in the lesson box.

## Practice mode: how practice records are kept apart

- Practice records are a **third dataset** (`practice`), stored separately from your records (`real`) and the demo (`demo`), exactly like the demo is. Settings record which one is open (`practiceActive`, `demoActive`); `datasetFor()` in `src/data/store.ts` picks it.
- **Starting** a practice lesson switches to the practice records; **starting it again from the beginning empties them first**, so replays never pile up duplicates. **Resuming** keeps them.
- A lesson's sample item (the "Practice coffee mug" for the sale lesson) is added **only to the practice records**, and only if they have nothing in stock.
- **Finishing, skipping, exiting** or **Leave practice** in the purple banner switches back to whichever records were open before (your own or the demo), exactly as they were. A refresh mid-lesson reopens the practice records and the lesson.
- **Open forms close when the records switch**, so a form opened on practice records can never save into your own (and vice versa). Leaving practice on a practice record's page (e.g. a practice Max Bid plan) goes to its list.
- **Data management is refused in practice mode** — backups, restores, imports, demo switching and resets, and erasing — in the store itself, with “Leave Practice Mode to manage your data.” on the disabled buttons. Practice records stay stored until a practice lesson starts over or you delete them (Learning Center → Practice records).
- A banner — *"Practice mode — a Learning Center lesson is using sample records. Your own records aren't changed."* — is shown the whole time.

## Safeguards

| The tutorial must never… | How |
| --- | --- |
| Create real financial transactions without intentional action outside practice mode | Lessons that save anything run only on practice records (checked by a unit test); explanation lessons can't operate the controls they show. |
| Delete real inventory | No lesson deletes anything; practice resets clear only the practice dataset. |
| Modify finalized monthly or year-end records | The Monthly Close lesson only looks (no close/reopen steps); closings made while practicing would only touch practice records. |
| Automatically import marketplace reports | The Payouts lesson only shows the Import button, which it can't press. |
| Trigger paid AI requests without consent | The scanner lesson only shows the panel (shielded); nothing is sent unless the user presses Analyze themselves, outside the lesson (tested with a mocked backend: zero requests). |
| Expose API keys or invitation codes | The Learning Center reads and stores neither. |
| Alter accounting calculations | No calculation code changed; lessons read the same figures the pages show. |
| Require a new paid service | Everything runs in the browser; no accounts or cloud sync. |

## Help icons

A **?** button (`src/learn/HelpTip.tsx`) next to:

- Sales & Profit tiles: **revenue**, **cost of goods sold**, **net (realized) profit**, **profit margin**, **ROI**;
- Max Bid results: **maximum bid** and **net proceeds**;
- Monthly Close: **inventory reconciliation** (the roll-forward card);
- Financial Planning: **tax reserve**;
- Sourcing Performance: **profit per logged hour** (tile and section).

Each opens a short explanation from `src/learn/help.ts`, stating how StockPilot actually calculates the figure, never calling an estimate verified and never treating profit as cash, with a link to the topic in the Learning Center. Keyboard: Enter/Space opens, Escape closes; the panel stays on screen on phones.

## Progress, refreshes and backups

- Progress lives in `Settings.tutorial` (`src/learn/progress.ts`): welcome state, completed lessons (with dates), skipped lessons, where unfinished lessons stopped, and the running lesson. It's sanitized on load like all settings, so a damaged or hand-edited value can't break the app.
- It's **not financial data**: it's never in the records, reports or CSVs.
- It's in **backups** (with settings). **Restore → Also restore settings** brings it back, minus any running lesson, and never brings the welcome back.
- A **refresh** keeps the running lesson, its step and its practice records.

## Accessibility and phones

- The lesson box is a non-modal dialog (`role="dialog"`, labelled by the step title, described by its text). Each new step moves focus to its title so screen readers read it (except field steps, where focus goes to the field), and a live region announces "Step *n* of *m*: *title*". Hints are announced as alerts.
- Everything works from the keyboard: Tab reaches the lesson box's buttons, including from inside an open form (the form's focus trap includes the lesson box), Escape exits, and **Go to the highlighted control** moves focus there.
- The dimmed page is not made inert, so nobody is ever trapped; Exit is always visible.
- `prefers-reduced-motion`: no animated scrolling or highlight transitions.
- Phones: the lesson box is a full-width sheet at the top or bottom, whichever leaves more room; if it still covers the control, the page scrolls the control clear of it and of the sticky header and tab bar. The highlight follows scrolling and resizing. Field steps don't pop the keyboard up uninvited.
- Checked with axe (WCAG 2.1 A/AA) on the welcome, lesson steps (including inside a form) and the Learning Center, on desktop and iPhone-sized layouts.

## Trying it locally

```bash
npm install
npm run dev            # open the printed URL
```

1. Choose a mode and **Start with my own inventory** → the welcome appears → **Start guided tour**.
2. Try a wrong click (on the dimmed page), an invalid answer (one letter for the name, then Next), a refresh in the middle of a form, Exit and then Resume from the Learning Center.
3. Finish **Add your first product**, then check Inventory: your own records don't have the practice product.
4. Open **Learning Center** to replay, skip, search ("tax", "profit") and show the welcome again. Switch modes to see the other paths.
5. To see the scanner lesson, run the scanner test build: `npx vite --mode scantest`. Its backend address (`scan.test`) is a placeholder that is never reached, which is fine: the lesson never contacts the scanner. Real scanner set-up is in [AI_SCANNER.md](AI_SCANNER.md).

Tests: `npm run check` (types, unit tests, build) and `npx playwright test e2e/tutorial.spec.ts` (add `--project=mobile` for the iPhone-sized run).

## Tests

| Requirement | Where it's tested |
| --- | --- |
| First-time welcome; never repeated after skip; shown again on request; not shown to existing users or after a restore | `e2e/tutorial.spec.ts`; `src/learn/learn.test.ts`; `e2e/trust.spec.ts`, `e2e/navigation.spec.ts` |
| Start, skip, exit, resume, replay; completing guided steps | `e2e/tutorial.spec.ts`; `src/learn/learn.test.ts` (progress reducers) |
| Incorrect clicks; form validation (invalid answers); auto-advance only on success | `e2e/tutorial.spec.ts` |
| Navigation between screens; forms and modal dialogs; missing targets | `e2e/tutorial.spec.ts` (every explanation lesson's targets are walked in each mode) |
| Refresh and progress recovery | `e2e/tutorial.spec.ts`; `src/learn/learn.test.ts` |
| Switching modes | `e2e/tutorial.spec.ts`; `src/learn/learn.test.ts` |
| Practice-data isolation; duplicate prevention; backup/restore refused in practice | `src/learn/learn.test.ts`; `e2e/tutorial.spec.ts` |
| Backup and restore of progress | `src/learn/learn.test.ts`; `e2e/tutorial.spec.ts` |
| Scanner lesson only where enabled, never sends a photo | `e2e/scanner.spec.ts`; `e2e/tutorial.spec.ts`; `src/learn/learn.test.ts` |
| Lesson integrity: unique ids, paths, resume points, practice-only record creation, illustrative examples, wording | `src/learn/learn.test.ts` |
| Help text accuracy | `src/learn/learn.test.ts`; `e2e/tutorial.spec.ts` |
| Keyboard, screen readers, axe, reduced motion, phone layout | `e2e/tutorial.spec.ts` (desktop + iPhone-sized) |
| Existing inventory, sales and financial functions | the whole existing suite, run unchanged except for dismissing the welcome after onboarding |

## Adding a lesson

Add an entry to `LESSONS` in `src/learn/lessons.ts` (and to `MODE_PATHS` if it belongs on a path). Each step has a `title`, a plain-English `body` (what to do and why), an optional `route`, a `target` and an `advance` rule:

- `target`: a CSS selector, `label:Field label` (a form control by its label), `button:Text` (a button or link by its text), alternatives separated by `|`, scoped with `scope >> target`, or a list tried in order. Prefer `data-testid`s and labels over layout.
- `advance`: `{ kind: 'next' }` (look only; the control is shielded), `{ kind: 'click' }`, `{ kind: 'field', valid, invalid }`, or `{ kind: 'when', check }` (a check on the records, the page or the DOM).
- `resumeAt` (inside a form: the step that opens it), `optional` (skip when the control isn't there), `skipIf`, `illustrative` (required for any dollar example).

Any lesson that saves something must be `practice: true`. `npm test` checks this.

## Known limitations

- Lessons find controls by test ids, labels and button text; a future redesign of a page needs its lesson checked (the walk-through tests catch a missing target).
- Explanation lessons show real pages with the user's own (or demo) figures; on an empty account some optional steps (e.g. the headline tiles) are skipped.
- The dimmed page blocks pointer clicks but not the keyboard, by design (nobody is trapped). A keyboard user can still reach other controls during a look-only step; anything they do there is their own deliberate action.
- Only the shared forms (Add item, Record sale, etc.) close automatically when the records switch; a page's own pop-ups (rare during a lesson, since the page is dimmed) stay open on the new records.
- Lesson text is English only; progress is per browser and device (no accounts or sync, by design).
- The scanner lesson can only be tried in a build with the scanner enabled.
