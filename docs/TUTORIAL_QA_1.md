# Tutorial QA fixes, round 1

What changed after the first independent QA review of the Interactive Tutorial and Learning Center (17 lessons: 14 passed, 1 partly, 1 failed, 1 not tested; 4 High, 14 Medium, 14 Low issues; no Critical).

The full QA report (PDF) wasn't available while this work was done. The High issues are referenced by their report IDs. The Medium and Low items were numbered here **in the order the summary listed them**. Check that mapping against the report.

- [High issues: root causes and fixes](#high-issues)
- [Medium issues](#medium-issues)
- [Low issues](#low-issues)
- [Demo data: your test records vs. the demo's](#demo-data)
- [Learning experience](#learning-experience)
- [Tests](#tests)
- [Not fixed, or only partly](#not-fixed-or-only-partly)

## High issues

### H3 — Practice Mode data safety

**Root cause.** Practice Mode switched the open records to the practice dataset, but data management only had partial guards:

- Backups were refused in the backup hook.
- Restores were refused in the store.
- Everything else was guarded only by the visible page being dimmed:
  - imports;
  - "Try/Exit demo mode";
  - "Reset demo data";
  - "Erase all data".

**Erase all data** was the serious part. Its button is shown whenever the demo isn't open, so it showed during practice. It calls `clearRealData()`, which deletes the *real* dataset regardless of which records are open. The page was dimmed for the mouse but not for the keyboard, so these controls could be reached by Tab, or by opening `#/settings` directly.

**Fix.**

- **Enforced in the store, not just the buttons.** `AppStore.assertCanManageData()` throws `PracticeLockError` ("Leave Practice Mode to manage your data.") whenever the practice records are open. It runs at the start of each of these, and again after waiting for pending saves:
  - `clearRealData`;
  - `resetDemo`;
  - `setDemoActive` (both directions);
  - `restore`;
  - `createBackupFile` (new; backups go through it);
  - `importInventory` (new; CSV imports go through it);
  - `clearPractice` (new).
- **Explained in the UI.**
  - Settings shows the explanation and disables Back up now, Download backup, Restore, Import, the demo buttons and Erase all data.
  - So do the import and restore dialogs and Inventory's Import buttons.
- **Background page inaccessible.**
  - While a step is shown, **Tab only moves between the highlighted control(s) and the lesson box**. On look-only steps, Tab only reaches the lesson box.
  - Focus that lands anywhere else (a form's autofocus, a page change) is brought back.
  - The dimmed overlay already blocked pointer clicks, and look-only steps can't operate the control they show.
- **Always reachable:**
  - **Escape** exits from anywhere, including inside an open form.
  - **Exit** and **✕** are always in the lesson box.
  - **Skip lesson** asks for confirmation first.

**Before → after.**

- Before: in Practice Mode, Settings → Erase all data → typing DELETE would have erased your real records. Backup, restore and import were reachable, and Tab could reach any button on the page.
- After: every one of those actions is disabled with the explanation and refused by the store. Tab stays on the lesson.

### H1 — Two browser tabs rewound the lesson

**Root cause.** Tutorial progress is part of the saved settings, which every StockPilot tab shares and syncs. Every tab ran the active lesson.

1. A second tab, which didn't have the lesson's form open, saw the step's field "missing".
2. It decided the form had been closed, moved the lesson back to the step that opens it, and saved that.
3. The first tab received the rewind, moved forward again, and so on.

**Fix.**

- **One owner tab per lesson** (`src/learn/session.ts`):
  - Each tab has an id that survives a refresh (sessionStorage), stored with the running lesson.
  - The owner holds a Web Lock while the lesson runs, and only the owner renders the lesson or writes its progress.
  - `go()` also refuses to write unless this tab owns the lesson.
  - A tab that isn't visible never decides a form "closed".
- **Other tabs** show "The lesson “…” is running in another StockPilot tab" with **Continue it here**, which takes the lesson over on purpose.
- **Closing the owner** releases the lock. Another tab adopts the lesson after a 1.5 s grace period, with a single write.
- **Refreshing the owner** gives it the lesson straight back; the grace period stops the other tab grabbing it.
- **No endless writes:** non-owners never write progress except to adopt or to take over.
- **Without Web Locks** (older browsers), the lesson stays with the tab that started it, and the others offer Continue it here.

### H2 — Max Bid lesson wasn't functional

**Root cause.**

- The "Your assumptions" step was a look-only step over the whole form. It was shielded so it couldn't be used, while asking people to enter assumptions.
- It also said "Click New plan", but the button says **New calculation**.

**Fix.** The lesson is now a real calculation:

1. Click **New calculation**.
2. Enter **Estimated resale value, whole lot** (validated money).
3. Enter **Target return (ROI)** (validated percentage).
4. The **real** maximum bid is highlighted and explained with the figure on screen. Next only appears once a result is displayed, so the lesson can't be finished without one.
5. The breakdown explains net proceeds and the all-in cost using the figures on screen.

Plans saved during the lesson stay in practice records.

### H4 — Collector lesson skipped condition, purchase date and source

**Root cause.**

- The lesson went from **More details** straight to Save; it had no steps for the fields inside.
- The More details step was optional, so it could also be skipped silently.

**Fix.**

- **More details** is now a required step: it moves on when the details section is open.
- The lesson then guides three fields in turn. Each is highlighted as a whole field, scrolled into view and clickable:
  1. **Condition** (required in the lesson);
  2. **Purchase date** (no future dates);
  3. **Where you bought it** (the field and its new-source type).
- Save comes only after these.
- The wording is for collectors throughout ("Collection", "Add it to your collection", "where you got it — not where you keep it"), and so is the toast ("Added … to your collection").

## Medium issues

| # | Issue | Fix |
| --- | --- | --- |
| M1 | "Inventory" used in Collector mode | Lesson text follows the menu: "Collection" for collectors. The new-item toast says "to your collection". |
| M2 | Dashboard explanation the same for every mode | Separate Overview and headline explanations for business, reseller and collector. |
| M3 | Sales-tracking setting worded wrongly | Uses the setting's real name, **Track sales & profit**, and explains what turning it on adds. The lesson doesn't switch it on. |
| M4 | Collector notifications talk about a business | Collectors get their own welcome text ("catalog your collection…") and collection wording in toasts and lessons. |
| M5 | Only the input highlighted, not the whole field | New `field:` targets highlight the whole field: label, control, buttons and hint. |
| M6 | Quantity −/+ couldn't be used | The quantity step highlights the whole field, so −/+ work (tested). |
| M7 | Fee type toggle couldn't be used | The fees step highlights the fee field together with its amount/% switch. |
| M8 | Alternate buttons for the same action ignored | Steps can highlight every visible alternative (`targetAll`): Add item / Add your first item / the phone's + button, and Record sale / Record your first sale. |
| M9 | Lesson box jumped about | Placement is chosen once per step and kept while it still fits, and it is measured only against the current step's highlight (a leftover highlight from the previous step caused jumps and covered controls on phones). When the box sits above a control it is anchored by its bottom edge. A control taller than the screen gets the bottom corner instead of an off-screen box. |
| M10 | Hints moved buttons under the pointer | The hint appears on the side of the box that grows, so Back/Next stay put (tested: Next doesn't move when the reason appears). |
| M11 | Clipping on narrow screens | Buttons wrap; the "Next: …" button wraps its text; the sheet scrolls if needed. Tested at iPhone 13 width that every button stays on screen. |
| M12 | Recommended a lesson already completed; no "path complete" | "Next:" offers the next **unfinished** lesson on the path. Finishing the last one says the path is complete, and the Learning Center shows a completion message. |
| M13 | Resume and refresh read the same | Resuming says "Welcome back — picking up at step N", or "Picking up where you left off. Open the form again…". A refresh says "The page reloaded and the form closed…". |
| M14 | Backup reminder shown during Practice Mode | The Overview's backup reminder is only shown for your own records. |

### Financial lessons made useful

| Lesson | What's new |
| --- | --- |
| Record a sale | **Margin** and **ROI** steps calculated from the practice sale's own numbers, e.g. "$8.00 ÷ $20.00 = 40.0%". Revenue, cost of goods sold and realized profit also use the practice sale's real figures, and margin vs ROI is explained. |
| Sourcing Performance | A practice lamp from "Practice thrift store", a sale and 1½ hours logged. Shows where you record the source (item form → More details) and where you log time (Time log tab), and why profit per logged hour isn't a wage. |
| Bulk lots | A $100 practice lot split $75 / $25 by estimated resale value ($150 vs $50), shown on the real lot page. |
| Payouts | Which eBay reports you need (Transaction and Payout, as CSV), a worked $4.05 difference, and how to investigate. Nothing is imported. |
| Predicted vs. actual | A practice pallet bought with a Max Bid plan whose radios sold for $45 instead of $60. The real performance page shows the gap and its causes. |
| Monthly Close | A practice purchase and sale this month, with a worked inventory reconciliation. The page's own warnings, e.g. for a month in progress or before records began, are shown as they are. |
| Collector sales | What turning on Track sales & profit adds, without switching it on. |

### Learning Center discovery

- **All 17 lessons are listed in every mode.** The mode's own lessons are grouped by topic, and "Lessons made for other modes" lists the rest. Starting one never changes your mode.
- **Unavailable lessons say why** instead of being hidden. The AI scanner lesson is shown as unavailable when the scanner is off.
- **Search** covers every lesson's title, summary, keywords and every step's text, plus the help topics. Multi-word searches match lessons containing all the words. There's a new "Restoring a backup" topic.
- **Help topics no longer restart an unrelated tutorial.**
  - **See it in StockPilot** opens the page with that figure's explanation already open (`?help=<topic>`).
  - **Lesson: …** names the lesson before starting it.

## Low issues

| # | Issue | Fix |
| --- | --- | --- |
| L1 | Overlay too faint in dark mode | 75% dimming in dark mode (50% in light), plus a white outline around the highlight ring. The highlighted control isn't dimmed. The lesson box's primary buttons use a deeper blue in dark mode (5.7:1). |
| L2 | Visible seams in the dimming | One SVG shape with a hole per highlighted control, instead of four rectangles. |
| L3 | Instructions didn't use exact button labels | Labels checked against the app: **New calculation**, **Add item / Add your first item**, **Record sale / Record your first sale**, **More details**, **Download backup**, **Restore from backup**, **Import eBay report**, **Time log**, **Performance**, **Track sales & profit**. |
| L4 | Lesson box covered nearby figures | On larger screens the box tries below, above, right and left of the control, and picks the side that covers the fewest figures (`*-value` elements). |
| L5 | Hard-coded example numbers | Results use your practice numbers: "3 × $8.00 = $24.00", the practice sale's revenue, cost of goods sold, profit, margin and ROI, and your Max Bid result. The remaining fixed examples are labelled Illustrative example (a unit test enforces it). |
| L6 | Practice product lost between connected lessons | Going straight from "Add your first product" to "Record a sale" keeps the product you just added. Starting a lesson from the Learning Center still starts clean, so there are no duplicates. |
| L7 | Practice items raised low-stock warnings | Practice products get no default low-stock alert, so a practice sale doesn't trigger one (tested). |
| L8 | Count Check explanation unclear | Now explains that you count what's really there, see what's missing or extra and its cost, and records change only when you approve each difference with a reason. |
| L9 | Weak number feedback | Says what's wrong ("“eight” isn’t a number", "can’t be negative", "two decimal places"). Enter answers a field step instead of submitting the form. |
| L10 | No confirmation when skipping | "Skip this lesson?" with Skip lesson / Keep going, then a toast. |
| L11 | Inconsistent contextual help | Stat tiles and section headings use the same ⓘ button. Help topics on tiles open in the tile like definitions, with a Learning Center link. |
| L12 | Screen-reader names, including the phone icon | The phone Learning Center icon is named "Learning Center: lessons and help" (with a tooltip). The lesson box is a labelled dialog with a live "Step N of M" announcement. |
| L13 | No "Resume tour" offer | The Overview offers **Resume tour** for an unfinished lesson; the Learning Center shows "Pick up where you left off". |
| L14 | Existing users shown first-time onboarding | Someone whose settings are missing but who has records on the device skips onboarding and the welcome. Brand-new users still see both. |
| L15 | Escape unpredictable inside a form | During a lesson, Escape always exits the lesson (and the practice form closes with it). |
| L16 | No way back to the Learning Center after finishing | The last step has **Back to Learning Center**. |
| L17 | Unclear whether practice records stay stored | Explained in the lesson intro, in the toast when you exit, and in a Learning Center section with **Delete practice records**. |

## Demo data

The demo's own items always carry the note "Sample item (demo data).", including in demos saved before this change. In demo mode, any item without it is labelled **Added by you**, so records you made while testing are easy to tell apart from the demo seed.

- Nothing is removed or migrated.
- Saved demo datasets are not reset.
- Fresh demos are built exactly as before.

## Learning experience

Every lesson was rewritten against five questions:

1. What does this do?
2. Why would I use it?
3. What do I click (using the button's exact label)?
4. What does the result mean (with your own numbers where possible)?
5. What should I do next (in the summary step)?

Look-only lessons became hands-on practice lessons with a worked example wherever a safe one was possible: Sourcing Performance, Monthly Close, Bulk lots and Predicted vs. actual.

## Tests

| Check | Where |
| --- | --- |
| 1. No real or demo data erased, reset, replaced, imported into or backed up during Practice Mode | `src/learn/learn.test.ts` (each action refused, real and demo storage byte-identical); `e2e/tutorial.spec.ts` (Settings controls disabled with the explanation, Tab confined, Exit restores access) |
| 2. Two tabs can't rewind a lesson | `e2e/tutorial.spec.ts` (step log only moves forward; refresh keeps the lesson; closing hands it over; Continue it here) |
| 3. Max Bid completed with real input values | `e2e/tutorial.spec.ts` (resale value + target return → the real result in the explanation; can't finish without one); unit test for the gate |
| 4. Collector condition and purchase details entered | `e2e/tutorial.spec.ts`; unit test for the step order |
| 5. Practice inventory never in real records | both suites |
| 6. Replays don't duplicate | `e2e/tutorial.spec.ts`; unit tests |
| 7. Progress survives refresh and resume | both suites |
| 8. Phone buttons stay on screen | `e2e/tutorial.spec.ts` (iPhone 13 viewport) |
| 9. All 17 lessons discoverable | unit test (every mode lists all 17); `e2e/tutorial.spec.ts` (other modes, unavailable scanner) |
| 10. Inventory, sales, payout and financial calculations unchanged | the full existing unit and browser suites, unchanged |

## Not fixed, or only partly

- **The app's dark-mode primary buttons** (white on #3987e5, 3.6:1) are a pre-existing, app-wide colour-token issue, outside the tutorial. They're fixed inside the lesson box only. Changing the token would restyle the whole app, so it's left for a design decision.
- **Physical devices.** Phone behaviour is tested in a simulated iPhone 13 viewport (Chromium), not on a real phone. VoiceOver/TalkBack and a real on-screen keyboard still need a manual check (see [MANUAL_TESTS_IOS.md](MANUAL_TESTS_IOS.md)).
- **Keyboard users in a second tab** can still use that tab's own page (only the tab running the lesson is contained). Its practice banner's "Leave practice" pauses the lesson everywhere, as a deliberate action.
- **Web Locks** are needed for automatic hand-over between tabs (Chrome, Edge, Firefox, Safari 15.4+). Without them, the other tab offers "Continue it here" instead.
- **Report IDs.** The Medium and Low numbering above follows the summary's order because the PDF wasn't available.
