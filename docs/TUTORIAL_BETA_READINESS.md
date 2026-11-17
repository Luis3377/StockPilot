# Tutorial beta-readiness fixes

What changed after the QA retest of the Learning Center (report dated November 16, 2026), on top of [TUTORIAL_QA_1.md](TUTORIAL_QA_1.md).

The report PDF wasn't available while this work was done. The issues and their IDs (N1–N5, M2–M11, L3–L13) come from the written summary of the retest.

- [Priority 1: the two financial lessons](#priority-1-the-two-financial-lessons)
- [Priority 2: resume, Escape, a second tab](#priority-2-resume-escape-a-second-tab)
- [Priority 3: polish](#priority-3-polish)
- [What was kept as it was](#what-was-kept-as-it-was)
- [Tests](#tests)
- [Remaining known issues](#remaining-known-issues)

## Priority 1: the two financial lessons

Both lessons now take every figure they quote from the same calculation the page itself shows (`lotPerformance` for Predicted vs. actual, `rollForward` for Monthly Close). No calculation was changed. Only the lesson text, and the month the lesson opens, changed.

### N3: Predicted vs. actual contradicted its own numbers

**Root cause.** The lesson's text was fixed when it was written: *“The radios sold for $45 each, not the $60 you estimated, so revenue and profit are behind the forecast.”* But the page doesn't compare the plan with what has sold so far. It compares the plan with a **projected final outcome** for the whole lot. The practice pallet was also bought for $80.00, well under the $90.66 the plan allowed. So the page showed the lot **ahead** of the prediction while the lesson said it was behind.

**Before** (the practice pallet, expected scenario, as QA saw it):

| Row | Predicted | Projected final | Difference | Lesson said |
| --- | ---: | ---: | ---: | --- |
| Revenue | $160.00 | $162.00 | +$2.00 (+1.25%) | “behind the forecast” |
| Net proceeds | $136.00 | $144.20 | +$8.20 (+6.03%) | |
| Profit | $45.34 | $64.20 | **+$18.86 (+41.6%)** | “behind the forecast” |

**After.** The lesson works through the four things the page separates, in order:

1. **Where the lot is (`stage`).** “3 of 4 units have sold, so the lot isn’t finished. Your plan predicted the whole lot, so StockPilot compares it with a projected final outcome — an estimate of where the whole lot ends up — not with what has sold so far.”
2. **Profit already earned (`earned`, highlights *Realized profit on sold units*).** “On the 3 units sold: revenue $130.00 − their share of the lot’s cost $64.00 − selling expenses $13.00 = $53.00 realized profit. That’s earned on completed sales (not the cash in your bank). Net proceeds so far ($117.00) already cover the $80.00 you paid for the whole lot.”
3. **The original prediction and the projected final profit (`prediction`, highlights the Profit row).** “When you planned the purchase, the expected scenario predicted $45.34 profit for the whole lot, if you paid up to $90.66 in total. If the 1 unit still in stock sells as the plan assumes, the projected final profit is $64.20: ahead of the prediction by +$18.86 (+41.6%), as the Difference column shows. Projected figures are estimates, not results.”
4. **The reasons (`why`).** “What you paid: $80.00 in total, less than the $90.66 the plan allowed (+$10.66). Net proceeds (sales after selling costs): projected $144.20 against $136.00 predicted (+$8.20). Together that’s the +$18.86 difference in profit. What has sold so far brought $130.00; at the plan’s prices it would have brought $160.00 (−18.75%), so those items sold for less than you estimated. The rest is still an estimate: if the unsold 1 unit sells for less, or not at all, the final profit will be lower.”

The reasons add up exactly: +$10.66 (paid less) + $8.20 (net proceeds) = +$18.86. The words *ahead of* or *behind* follow the sign of the Difference column. The text also follows the scenario chosen on the page (Conservative, Expected or Optimistic).

### N4: Monthly Close showed $0.00

**Root cause.** The Monthly Close page opens the most recent **finished** month that isn't closed yet. The practice records are dated **today**. On November 16, 2026, the lesson opened **October 2026**, which had no records at all. Every figure was $0.00 and the reconciliation was “verified” only because there was nothing to check. The lesson's worked example didn't match anything on screen.

**After.** The lesson opens the page at the practice records' own month (`/sales/close?month=…`). That's the month of the latest practice purchase or sale on or before today. The lesson then quotes that month's roll-forward:

| | Before (opened 2026-10) | After (opens 2026-11) |
| --- | ---: | ---: |
| Beginning inventory | $0.00 | $0.00 |
| Items bought | $0.00 | +$24.00 |
| Cost of goods sold | $0.00 | −$8.00 |
| Expected ending | $0.00 | $16.00 |
| Item records show | $0.00 | $16.00 |

Lesson text after: “For November 2026: $0.00 at the start, items bought +$24.00, cost of goods sold −$8.00 = $16.00 expected, and your item records show $16.00. They match, so it’s verified.”

Tested on November 16 and 30, December 1 and 31, 2026, January 1, 2027 (year-end), March 1, 2027 (first day of a month) and February 29, 2028.

## Priority 2: resume, Escape, a second tab

### N2: Resume could offer a lesson that can't run

**Root cause.** Resume offered the first paused lesson in the list, whatever the current mode or settings. For example, a paused sales lesson was offered in Collector mode with sales tracking off, and starting it ended in an error.

**After.** One function (`resumeCandidate`) decides what to offer in the Overview's Resume banner, the Learning Center's resume card and the welcome. It offers only lessons for the current mode that can run with the current settings (sales tracking, scanner). Among those, it offers the **most recently paused** one. Pause times are stored with the progress (`pausedAt`) and survive backups. They're cleared when the lesson is finished or skipped.

### L13: Escape closed forms and lost what was typed

**After.**
- Escape never closes the form underneath a lesson.
- In a dropdown or a date/time field, Escape is left to the browser (it closes the list or the picker). The lesson stays where it is.
- Otherwise Escape (like Exit and ✕) leaves the lesson. If the open form has typing in it, it asks first: *“Leave the lesson? … what you’ve typed will be lost.”* **Keep going** has the focus, and Escape again means Keep going. With nothing typed, leaving is immediate, as before.
- The skip confirmation also warns when a form has typing in it.
- All of this works from the keyboard and passes axe.

### N1: A second tab could save a stale practice form

**Root cause.** Lesson ownership (one tab runs the lesson) was fixed in round 1. But a practice form left open in the other tab could still be saved. That wrote into the shared practice records and moved the lesson on in the owning tab.

**After.**
- **Practice records are read-only in a tab that isn't running the lesson.** The store refuses the write (`setPracticeWriteGuard`) with: *“A Learning Center lesson is running in another StockPilot tab, so the practice records can’t be changed here. Use ‘Continue it here’ to move the lesson to this tab.”* Your own records and the demo's aren't affected by this guard.
- **The form closes in the tab that lost the lesson.** When a practice lesson moves to another tab, this tab closes its open forms, so a stale one can't be submitted later.
- Round 1's ownership rules (Web Locks, refresh, hand-over, Continue it here) are unchanged.

## Priority 3: polish

| ID | Problem | Fix |
| --- | --- | --- |
| **M2** | The Overview step described two figures but highlighted one card | Both cards are highlighted in every layout: Realized profit + Inventory cost (Reseller, Small business), Estimated market value + Cost (Collector). |
| **M3** | The large centred **New calculation** button didn't work during the Max Bid lesson | Both New calculation buttons (header and empty state) are targets, and either one moves the lesson on. The text says so. |
| **M4** | On a phone the lesson box jumped between the top and bottom of the screen | The box stays at the same end of the screen from step to step. It moves only if staying would cover the control. |
| **M10** | A help topic's lesson link started the lesson from step 1 | It opens the step that explains that figure (for example, Margin opens at the margin step with “$10.00 ÷ $20.00 = 50.0%”). Practice lessons opened part-way set up the records that step needs. |
| **M11** | Monthly Close scrolled to the middle of the tall checklist | A control taller than most of the screen is shown from its top, just under the header. |
| **N5** | The last step said “path complete” while recommending another lesson | The closing line comes from the engine only. It says either “Next on your path: “X”.” (the same lesson as the Next button) or that the path is complete, never both. Lesson summaries no longer name a next lesson themselves. |
| **L7** | Quantity silently turned −3 into 3 and 1.5 into 15 | The field keeps a minus sign or decimal point as typed and says what's wrong (“Can’t be negative.”, “Use a whole number, like 3.”). The lesson's hint does the same. Saving still refuses them. |
| **L11** | Reopening the welcome didn't offer to continue | “Show the welcome again” offers **Resume tour** (with the lesson's name) when there's an unfinished lesson that can run here. |
| **L3** | The lesson box covered the controls it was explaining | The box is placed against the combined area of every highlighted control, not just the first. On a phone the sheet goes to whichever end leaves the control visible. |

## What was kept as it was

The retest confirmed these were working. They are unchanged, and their existing tests still pass:
- practice isolation and data safety, and the protection from dangerous actions during practice;
- two-tab ownership;
- the interactive Max Bid lesson, and the collector condition and date inputs;
- the margin/ROI and bulk lot examples;
- progress persistence, skip, replay and resume;
- the phone controls;
- every financial calculation.

## Tests

| Issue | Unit (`src/learn/beta.test.ts`) | Browser (`e2e/beta-readiness.spec.ts`, desktop + iPhone 13) |
| --- | --- | --- |
| N3 | The text quotes the engine's realized, predicted, projected and difference figures. The reasons sum to the difference to the cent. It says “behind” for a lot that really is behind. It follows the selected scenario. No fixed “behind the forecast” text is left. | The popover's figures equal the page's *Realized profit*, Profit row (predicted, projected, difference, %), Net proceeds difference and sold-price figures. The direction word matches the sign. |
| N4 | Six dates, including month end, Dec 31 → Jan 1 and Feb 29. The lesson's month equals the practice records' month, not the page's default. The roll-forward is verified at $0.00 / $16.00 / $16.00. The text matches. Future-dated records are ignored. | Today, Dec 31, 2026, Jan 1, 2027 and Mar 1, 2027 (clock set in the browser). URL `?month=`, month picker, roll-forward lines and popover text. |
| N2 | Never offers a lesson the mode can't run. Picks the most recently paused. Pause times survive saving and are cleared on finish or skip. | A paused sales lesson isn't offered in Collector mode (Overview, Learning Center or welcome). A later collector lesson is offered everywhere and resumes at its step. |
| L13 | | Escape with typing asks first and keeps the form and typing. Escape again or Keep going continues. Exit asks too. Leaving pauses the lesson. Escape in a dropdown stays in the lesson. With nothing typed, Escape leaves. The confirmation passes axe. |
| N1 | The guard refuses practice writes only, and only while active. | Continue it here in a second tab closes the first tab's form. Saving there is refused with the message. The owning tab's step doesn't move and no practice item is added. |
| N5 | “Next unfinished” and “path complete” are never both true. No lesson summary names a next lesson. | The closing text names the same lesson as the Next button. |
| M10 | Every topic's step exists in its lesson. Practice lessons opened part-way have a jump setup, with a sale to explain. | The Margin topic opens at the margin step with the worked example. |
| M2 + L3 | | Both cards are highlighted in Small business, Reseller and Collector, and neither is covered. On a phone the second card is a scroll away and uncovered once there. |
| M3 | | The centred button is clicked by position and the lesson moves on. |
| M4 | | Over four form steps on a phone, the lesson box changes ends at most once. |
| M11 | | The checklist is shown from its top. |
| L7 | | “-3” and “1.5” stay as typed with their messages, in the form and in the lesson. |
| L11 | | The welcome offers Resume tour and resumes. Passes axe. |
| Data safety | | After two look-only lessons and a practice sale on the demo, the demo's revenue, net profit, sale count and inventory cost are unchanged. |

Two existing tests in `e2e/tutorial.spec.ts` now expect the leave confirmation: they click Exit with typing in a lesson form. Their other assertions are unchanged. The browser-test helpers for lessons moved to `e2e/tourHelpers.ts` so both suites can use them.

## Remaining known issues

- **Phones and two tall cards (M2).** On a phone in Reseller mode, the two highlighted Overview cards together are taller than the screen space left beside the lesson box. Both are highlighted, but the second (Inventory cost) is a short scroll away. Desktop and tablet show both at once.
- **Physical devices.** Phone behaviour is tested in a simulated iPhone 13 viewport (Chromium), not on a real phone. VoiceOver/TalkBack, a real on-screen keyboard and native date pickers still need a manual check (see [MANUAL_TESTS_IOS.md](MANUAL_TESTS_IOS.md)).
- **Report IDs.** Fixes are labelled with the IDs from the retest summary, because the PDF wasn't available.
- Still open from round 1: the app-wide dark-mode primary button contrast, and the need for Web Locks for automatic tab hand-over (see [TUTORIAL_QA_1.md](TUTORIAL_QA_1.md#not-fixed-or-only-partly)).
