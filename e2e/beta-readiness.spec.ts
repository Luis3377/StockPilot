// Beta-readiness regression tests for the Learning Center (QA retest, Nov 16 2026): financial
// lessons that agree with the page (N3, N4), Resume (N2), Escape in forms (L13), stale forms in a
// second tab (N1), and the remaining polish (M2, M3, M4, M10, M11, N5, L7, L11, L3).

import { expect, test, type Page } from '@playwright/test';
import { isMobile, nav, onboard } from './helpers';
import { answer, at, axe, clickStep, expectReachable, fieldOf, itemForm, lessonRow, openLearn, pop, startLesson, step, tap, walk } from './tourHelpers';

const moneyIn = (s: string) => s.match(/[+−-]?\$[\d,]+\.\d{2}/g) ?? [];
const text = async (page: Page, testId: string) => ((await page.getByTestId(testId).first().textContent()) ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------------------------
// N3 — Predicted vs. actual
// ---------------------------------------------------------------------------------------------

test('N3: Predicted vs. actual explains the same figures the page shows, and in the right direction', async ({ page }) => {
  await onboard(page, 'Reseller');
  await startLesson(page, 'predicted-actual');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'lots');
  await clickStep(page, 'perf-link');
  await step(page, 'stage');
  await expect(pop(page)).toContainText('compares it with a projected final outcome');
  await page.getByTestId('tour-next').click();

  // 1. Profit already earned = the "Realized profit on sold units" figure.
  await step(page, 'earned');
  const realized = moneyIn(await text(page, 'perf-realized'))[0];
  expect(realized).toBeTruthy();
  await expect(pop(page)).toContainText(`= ${realized} realized profit`);
  await expectReachable(page);
  await page.getByTestId('tour-next').click();

  // 2 + 3. Predicted and projected final profit, and the difference, exactly as in the table.
  await step(page, 'prediction');
  const row = page.getByTestId('perf-row-profit');
  const predicted = moneyIn((await row.locator('span.tabular').first().textContent()) ?? '')[0];
  const projected = moneyIn((await row.getByTestId('perf-projected').textContent()) ?? '')[0];
  const diffText = ((await row.getByTestId('perf-diff').textContent()) ?? '').replace(/\s+/g, ' ');
  const diff = moneyIn(diffText)[0]!;
  const pct = diffText.match(/[+−]?[\d.]+%/)![0];
  await expect(pop(page)).toContainText(`predicted ${predicted} profit`);
  await expect(pop(page)).toContainText(`projected final profit is ${projected}`);
  await expect(pop(page)).toContainText(`${diff} (${pct})`);
  // The QA retest saw +$18.86 (+41.6%) next to a lesson saying "behind": now the words follow the sign.
  await expect(pop(page)).toContainText(diff.startsWith('+') ? 'ahead of the prediction' : 'behind the prediction');
  await expect(pop(page)).not.toContainText(diff.startsWith('+') ? 'behind the prediction' : 'ahead of the prediction');
  await page.getByTestId('tour-next').click();

  // 4. Why: what you paid + net proceeds, adding up to the same difference.
  await step(page, 'why');
  const netDiff = moneyIn((await page.getByTestId('perf-row-net').getByTestId('perf-diff').textContent()) ?? '')[0];
  await expect(pop(page)).toContainText(`(${netDiff})`);
  await expect(pop(page)).toContainText(`the ${diff} difference in profit`);
  const soldPrices = moneyIn(await text(page, 'perf-sold-prices'));
  await expect(pop(page)).toContainText(`brought ${soldPrices[0]}`);
  await expect(pop(page)).toContainText(`would have brought ${soldPrices[1]}`);
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-finish').click();
});

// ---------------------------------------------------------------------------------------------
// N4 — Monthly Close opens the practice records' month
// ---------------------------------------------------------------------------------------------

for (const [label, when] of [
  ['today', null],
  ['the last day of the year', '2026-12-31T21:00:00'],
  ['the first day of a new month and year', '2027-01-01T08:00:00'],
  ['the first day of a month', '2027-03-01T09:00:00'],
] as const) {
  test(`N4: Monthly Close lesson shows the worked reconciliation on ${label}`, async ({ page }) => {
    if (when) await page.clock.setFixedTime(new Date(when));
    await onboard(page, 'Small business');
    const month = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    await startLesson(page, 'monthly-close');
    await page.getByTestId('tour-next').click();
    await step(page, 'page');
    await expect(page).toHaveURL(new RegExp(`#/sales/close\\?month=${month}$`));
    await expect(page.getByTestId('close-month')).toHaveValue(month);
    for (let i = 0; i < 4 && (await pop(page).getAttribute('data-step')) !== 'rollforward'; i++) await page.getByTestId('tour-next').click();
    await step(page, 'rollforward');
    // The page itself shows the worked example (not $0.00), and the lesson quotes it.
    const line = (key: string) => page.getByTestId('rollforward').locator(`[data-testid="rf-line"][data-key="${key}"] td`);
    await expect(line('beginning')).toHaveText('$0.00');
    await expect(line('items')).toHaveText('+$24.00');
    await expect(line('cogs')).toHaveText('−$8.00');
    await expect(line('expected')).toHaveText('$16.00');
    await expect(pop(page)).toContainText(
      '$0.00 at the start, items bought +$24.00, cost of goods sold −$8.00 = $16.00 expected, and your item records show $16.00. They match, so it’s verified.',
    );
    await page.getByTestId('tour-exit').click();
  });
}

test('M11: the tall Monthly Close checklist is shown from its top, not scrolled to its middle', async ({ page }) => {
  await onboard(page, 'Small business');
  await startLesson(page, 'monthly-close');
  for (let i = 0; i < 6 && (await pop(page).getAttribute('data-step')) !== 'checklist'; i++) await page.getByTestId('tour-next').click();
  await step(page, 'checklist');
  const vh = page.viewportSize()!.height;
  await expect
    .poll(async () => {
      const b = await at(page, 'checklist').boundingBox();
      return b!.height > vh * 0.6 ? b!.y >= 0 && b!.y < vh * 0.4 : b!.y >= 0 && b!.y + b!.height <= vh;
    })
    .toBe(true);
});

// ---------------------------------------------------------------------------------------------
// N2 + L11 — Resume
// ---------------------------------------------------------------------------------------------

test('N2: Resume never offers a lesson the current mode can’t run; L11: the welcome offers Resume tour', async ({ page }) => {
  await onboard(page, 'Small business');
  // Pause a sales lesson, then switch to Collector (sales tracking off).
  await startLesson(page, 'practice-record-sale');
  await page.getByTestId('tour-next').click();
  await step(page, 'go-sales');
  await page.getByTestId('tour-exit').click();
  await nav(page, 'Overview');
  await expect(page.getByTestId('resume-tour')).toContainText('Record a sale and read your profit');
  await page.locator('[data-testid="mode-switcher"]:visible').click();
  await page.getByRole('menuitemradio', { name: /Collector/ }).click();
  await nav(page, 'Overview');
  await expect(page.getByTestId('resume-tour')).toHaveCount(0);
  await openLearn(page);
  await expect(page.getByTestId('learn-resume-card')).toHaveCount(0);
  await page.getByTestId('learn-welcome').click();
  await expect(page.getByTestId('tour-welcome-resume')).toHaveCount(0);
  await page.getByTestId('tour-welcome-skip').click();

  // A collector lesson paused later is the one offered, everywhere.
  await startLesson(page, 'collector-organize');
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-exit').click();
  await nav(page, 'Collection');
  await nav(page, 'Overview');
  await expect(page.getByTestId('resume-tour')).toContainText('Organizing your collection');
  await openLearn(page);
  await expect(page.getByTestId('learn-resume-card')).toContainText('Organizing your collection');
  await page.getByTestId('learn-welcome').click();
  await expect(page.getByTestId('tour-welcome-unfinished')).toContainText('Organizing your collection');
  await page.getByTestId('tour-welcome-resume').click();
  await expect(pop(page)).toContainText('Organizing your collection');
  await step(page, 'search');
});

// ---------------------------------------------------------------------------------------------
// L13 — Escape in forms
// ---------------------------------------------------------------------------------------------

test('L13: Escape never closes a form with typing in it; leaving asks first; dropdowns keep their Escape', async ({ page }) => {
  await onboard(page, 'Small business');
  await startLesson(page, 'practice-add-item');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-inventory');
  await clickStep(page, 'open-form');
  await step(page, 'name');
  const name = await fieldOf(page, 'name');
  await name.fill('Half-typed mug');
  await page.keyboard.press('Escape');
  // Asked, not closed: the form and the typing are still there.
  await expect(page.getByTestId('tour-leave-confirm')).toContainText('what you’ve typed will be lost');
  await expect(page.getByTestId('tour-leave-no')).toBeFocused();
  await expect(itemForm(page)).toBeVisible();
  await expect(name).toHaveValue('Half-typed mug');
  // Escape again = Keep going.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tour-leave-confirm')).toHaveCount(0);
  await step(page, 'name');
  await expect(name).toHaveValue('Half-typed mug');
  // Exit asks too; Keep going keeps everything.
  await page.getByTestId('tour-exit').click();
  await page.getByTestId('tour-leave-no').click();
  await expect(itemForm(page)).toBeVisible();
  await expect(name).toHaveValue('Half-typed mug');
  // Leaving on purpose: confirmed, then the lesson pauses (and can be resumed).
  await page.getByTestId('tour-exit-x').click();
  await page.getByTestId('tour-leave-yes').click();
  await expect(pop(page)).toBeHidden();
  await expect(itemForm(page)).toBeHidden();
  await openLearn(page);
  await expect(lessonRow(page, 'practice-add-item')).toHaveAttribute('data-status', 'in_progress');

  // In a dropdown, Escape is the dropdown's: the lesson and the form stay.
  await startLesson(page, 'practice-record-sale');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-sales');
  await clickStep(page, 'open');
  await step(page, 'item');
  await (await fieldOf(page, 'item')).focus();
  await page.keyboard.press('Escape');
  await expect(pop(page)).toBeVisible();
  await expect(page.getByTestId('sale-form')).toBeVisible();
  await step(page, 'item');
  // With nothing typed, Escape leaves straight away (nothing to lose).
  await pop(page).getByRole('heading', { level: 2 }).focus();
  await page.keyboard.press('Escape');
  await expect(pop(page)).toBeHidden();
});

// ---------------------------------------------------------------------------------------------
// N1 — a second tab can't save a stale practice form
// ---------------------------------------------------------------------------------------------

test('N1: a tab that no longer runs the lesson closes its practice form and can’t save practice records', async ({ page, context }) => {
  await onboard(page, 'Small business');
  await startLesson(page, 'practice-add-item');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-inventory');
  await clickStep(page, 'open-form');
  await answer(page, 'name', 'Item name', 'Stale form mug');
  await step(page, 'quantity');

  // The lesson moves to a second tab.
  const other = await context.newPage();
  await other.goto('./');
  await other.getByTestId('tour-continue-here').click();
  await expect(other.getByTestId('tour-popover')).toBeVisible();
  const ownerStep = await other.getByTestId('tour-popover').getAttribute('data-step');

  // The first tab's open practice form closes, and it can't save practice records any more.
  await expect(page.getByTestId('tour-other-tab')).toBeVisible();
  await expect(itemForm(page)).toBeHidden();
  await page
    .getByRole('button', { name: /^Add (item|your first item)$/ })
    .first()
    .click();
  // (The form resets its fields just after it opens: type until both values stick.)
  await expect(async () => {
    await itemForm(page).getByLabel('Item name').fill('Stale form mug');
    await itemForm(page).getByLabel('Cost per item').fill('8');
    await expect(itemForm(page).getByLabel('Item name')).toHaveValue('Stale form mug', { timeout: 500 });
  }).toPass({ timeout: 10_000 });
  await itemForm(page).getByRole('button', { name: 'Add item' }).click();
  await expect(page.getByText('A Learning Center lesson is running in another StockPilot tab, so the practice records can’t be changed here.')).toBeVisible();

  // The lesson in the owning tab didn't move, and no practice item was added.
  await other.waitForTimeout(800);
  await expect(other.getByTestId('tour-popover')).toHaveAttribute('data-step', ownerStep!);
  await other.getByTestId('tour-exit').click();
  await expect(other.getByText('Stale form mug')).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// Polish
// ---------------------------------------------------------------------------------------------

for (const [mode, ids] of [
  ['Small business', ['hero-inventory-value', 'stat-profit']],
  ['Reseller', ['hero-profit', 'stat-inventory-cost']],
  ['Collector', ['hero-collection-value', 'stat-acquisition-cost']],
] as const) {
  test(`M2 + L3 (${mode}): both financial cards the text describes are highlighted, and the lesson box covers neither`, async ({ page }) => {
    await onboard(page, mode, true);
    await startLesson(page, 'tour-dashboard');
    await page.getByTestId('tour-next').click();
    await step(page, 'headline');
    const cards = page.locator('[data-tour-active="headline"]');
    await expect(cards).toHaveCount(2);
    expect((await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).sort()).toEqual([...ids].sort());
    await expect(page.locator('[data-tour-overlay] .ring-4')).toHaveCount(2);
    await expectReachable(page, cards.nth(0));
    if (!isMobile(page)) await expectReachable(page, cards.nth(1));
    // A phone can't show both tall cards and the lesson box at once: the second is a scroll away, and
    // once scrolled to, neither the lesson box nor the tab bar covers it.
    else
      await expect(async () => {
        await cards.nth(1).evaluate((n) => n.scrollIntoView({ block: 'center' }));
        await expectReachable(page, cards.nth(1));
      }).toPass({ timeout: 10_000 });
  });
}

test('M3: the large centred New calculation button works during the Max Bid lesson', async ({ page }) => {
  await onboard(page, 'Reseller');
  await startLesson(page, 'max-bid');
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-next').click();
  await step(page, 'new');
  const buttons = page.locator('[data-tour-active="new"]');
  await expect(buttons).toHaveCount(2);
  // The one in the middle of the page (the empty state), not the header one. On a phone it's below
  // the fold: scroll to it as a person would; nothing (lesson box, tab bar, shield) may cover it.
  await expect(async () => {
    await buttons.nth(1).evaluate((n) => n.scrollIntoView({ block: 'center' }));
    await expectReachable(page, buttons.nth(1));
  }).toPass({ timeout: 10_000 });
  const box = await buttons.nth(1).boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await step(page, 'resale');
  await expect(page).toHaveURL(/#\/inventory\/bids\/new/);
});

test('M10: a help topic’s lesson link opens the step that explains that figure', async ({ page }) => {
  await onboard(page, 'Small business');
  await openLearn(page);
  await page.getByLabel('Search lessons and help topics').fill('margin');
  await page.locator('#topic-margin').getByTestId('learn-topic-lesson').click();
  await step(page, 'margin');
  await expect(page.getByTestId('tour-progress')).not.toHaveText(/^Step 1 of/);
  // A practice sale is ready to explain: $20 sale, $8 cost, $2 fees.
  await expect(pop(page)).toContainText('$10.00 ÷ $20.00 = 50.0%');
  await expectReachable(page);
  await page.getByTestId('tour-exit').click();
});

test('N5: the closing message names the same next lesson as the button, never "path complete" alongside it', async ({ page }) => {
  await onboard(page, 'Small business');
  await walk(page, 'tour-dashboard');
  await startLesson(page, 'backup');
  for (let i = 0; i < 5 && !(await page.getByTestId('tour-finish').isVisible()); i++) await page.getByTestId('tour-next').click();
  const next = ((await page.getByTestId('tour-next-lesson').textContent()) ?? '').replace(/^Next:\s*/, '');
  await expect(page.getByTestId('tour-body')).toContainText(`Next on your path: “${next}”.`);
  await expect(page.getByTestId('tour-body')).not.toContainText('every lesson on your path');
});

test('L7: quantities keep a minus sign or decimal point and say what’s wrong', async ({ page }) => {
  await onboard(page, 'Small business');
  await page
    .getByRole('button', { name: /^Add (item|your first item)$/ })
    .first()
    .click();
  const qty = itemForm(page).getByRole('textbox', { name: 'Quantity', exact: true });
  await qty.fill('-3');
  await expect(qty).toHaveValue('-3');
  await expect(itemForm(page)).toContainText('Can’t be negative.');
  await qty.fill('1.5');
  await expect(qty).toHaveValue('1.5');
  await expect(itemForm(page)).toContainText('Use a whole number, like 3.');
  await qty.fill('3');
  await expect(itemForm(page)).not.toContainText('Can’t be negative.');
  await itemForm(page).getByRole('button', { name: 'Cancel' }).click();

  // In the lesson too.
  await startLesson(page, 'practice-add-item');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-inventory');
  await clickStep(page, 'open-form');
  await answer(page, 'name', 'Item name', 'Mug');
  await step(page, 'quantity');
  await (await fieldOf(page, 'quantity')).fill('-3');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tour-hint')).toHaveText('A quantity can’t be negative. Enter how many you have, like 3.');
  await step(page, 'quantity');
});

test('M4: on a phone the lesson box stays at the same end of the screen from step to step', async ({ page }) => {
  test.skip(!isMobile(page), 'phone layout');
  await onboard(page, 'Small business');
  await startLesson(page, 'practice-add-item');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-inventory');
  await clickStep(page, 'open-form');
  const ends: string[] = [];
  for (const [id, label, value] of [
    ['name', 'Item name', 'Phone mug'],
    ['quantity', 'Quantity', '2'],
    ['cost', 'Cost per item', '4'],
    ['price', 'Selling price', '9'],
  ] as const) {
    await step(page, id);
    await expectReachable(page);
    const b = (await pop(page).boundingBox())!;
    ends.push(b.y < page.viewportSize()!.height / 2 ? 'top' : 'bottom');
    await answer(page, id, label, value);
  }
  const switches = ends.slice(1).filter((e, i) => e !== ends[i]).length;
  expect(switches, ends.join(' → ')).toBeLessThanOrEqual(1);
});

test('no lesson changes real or demo records: the demo’s figures are the same after practice lessons', async ({ page }) => {
  test.setTimeout(90_000);
  await onboard(page, 'Small business', true);
  const figures = async () => {
    await nav(page, 'Sales & Profit');
    await page.getByRole('radio', { name: 'All time' }).click();
    const sales = { revenue: await text(page, 'sales-revenue-value'), net: await text(page, 'sales-net-value'), rows: await page.getByTestId('sale-row').count() };
    await nav(page, 'Overview');
    return { ...sales, inventoryCost: await text(page, 'hero-inventory-value-value') };
  };
  const before = await figures();
  expect(before.revenue).not.toBe('$0.00');
  for (const id of ['profit-by-source', 'monthly-close']) await walk(page, id);
  await startLesson(page, 'practice-record-sale');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-sales');
  await clickStep(page, 'open');
  await (await fieldOf(page, 'item')).selectOption({ index: 1 });
  await answer(page, 'price', 'Sale price', '20');
  await answer(page, 'fees', 'Marketplace fees', '2');
  await clickStep(page, 'save');
  await step(page, 'revenue');
  await page.getByTestId('tour-exit').click();
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  expect(await figures()).toEqual(before);
});

test('accessibility: the leave-confirmation and the welcome with Resume pass axe', async ({ page }) => {
  await onboard(page, 'Small business');
  await startLesson(page, 'practice-add-item');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-inventory');
  await clickStep(page, 'open-form');
  await (await fieldOf(page, 'name')).fill('Typed');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tour-leave-confirm')).toBeVisible();
  await axe(page, 'leave confirmation');
  await page.getByTestId('tour-leave-yes').click();
  await openLearn(page);
  await page.getByTestId('learn-welcome').click();
  await expect(page.getByTestId('tour-welcome-resume')).toBeVisible();
  await axe(page, 'welcome with resume');
});
