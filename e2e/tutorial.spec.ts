// Learning Center and guided tours: the welcome, practice lessons on the separate practice
// records, verified step-by-step progress, stop/resume, replays, every lesson's targets, phones,
// keyboard and screen-reader support, Practice Mode data safety, two tabs, and that real
// records are never touched.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addItem, isMobile, nav, onboard, recordSale, reloadWhenSaved, saved } from './helpers';
import { answer, at, axe, buttonsInside, clickStep, expectReachable, fieldOf, itemForm, lessonRow, openLearn, pop, startLesson, step, tap, walk } from './tourHelpers';

// ---------------------------------------------------------------------------------------------
// Welcome and the first lessons
// ---------------------------------------------------------------------------------------------

test('new users get the welcome once; skipping it never brings it back, and it can be shown again', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('radio', { name: /^Small business Mode/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Start with my own inventory/ }).click();
  const welcome = page.getByTestId('tour-welcome');
  await expect(welcome).toBeVisible();
  await expect(welcome).toContainText('Welcome to StockPilot!');
  await expect(welcome).toContainText('Let’s show you how to manage inventory, track sales, and understand your business’s profits.');
  await expect(welcome.getByRole('button', { name: 'Start guided tour' })).toBeVisible();
  await welcome.getByRole('button', { name: 'Explore on my own' }).click();
  await expect(welcome).toBeHidden();
  await expect(page.getByText('You can start a lesson any time from the Learning Center.')).toBeVisible();

  await reloadWhenSaved(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(welcome).toBeHidden();

  await openLearn(page);
  await page.getByTestId('learn-welcome').click();
  await expect(welcome).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(welcome).toBeHidden();
});

test('guided tour: getting around, then adding a practice product step by step with real feedback', async ({ page }) => {
  await onboard(page, 'Small business');
  // A real record that must stay exactly as it is.
  await addItem(page, { name: 'Real desk lamp', quantity: 2, cost: '12', asking: '30' });
  await openLearn(page);
  await page.getByTestId('learn-welcome').click();
  await page.getByTestId('tour-welcome-start').click();

  // Lesson 1: getting around (look steps; Back works).
  await expect(pop(page)).toContainText('Getting around StockPilot');
  await expect(page.getByTestId('tour-progress')).toHaveText(/^Step 1 of \d+$/);
  await step(page, 'overview');
  await expect(pop(page)).toContainText('A summary of your business');
  await expect(page.getByTestId('tour-back')).toBeHidden();
  await page.getByTestId('tour-next').click();
  await step(page, 'headline');
  await page.getByTestId('tour-back').click();
  await step(page, 'overview');
  for (const id of ['headline', 'menu', 'learn', 'done']) {
    await page.getByTestId('tour-next').click();
    await step(page, id);
    if (id !== 'done') await expectReachable(page);
  }
  // The next lesson offered is the next unfinished one on the path.
  await expect(page.getByTestId('tour-next-lesson')).toHaveText('Next: Add your first product');
  await page.getByTestId('tour-next-lesson').click();

  // Lesson 2: practice product.
  await expect(pop(page)).toContainText('Add your first product');
  await expect(page.getByTestId('practice-banner')).toBeVisible();
  await step(page, 'intro');
  await expect(pop(page)).toContainText('your backups never include it');
  await page.getByTestId('tour-next').click();
  await step(page, 'go-inventory');
  await expectReachable(page);
  // A click somewhere else doesn't count, and says why.
  await page.mouse.click(5, (page.viewportSize()?.height ?? 600) - 120);
  await expect(page.getByTestId('tour-hint')).toContainText('paused during this step');
  await clickStep(page, 'go-inventory');
  await step(page, 'open-form');
  // Practice records only: the real lamp isn't here.
  await expect(page.getByText('Real desk lamp')).toHaveCount(0);
  await expectReachable(page);
  await tap(page, 'open-form');
  await expect(itemForm(page)).toBeVisible();
  await step(page, 'name');
  // Invalid answers don't move on, and the lesson box's buttons don't move when the reason appears.
  const name = await fieldOf(page, 'name');
  await name.fill('a');
  const nextBefore = await page.getByTestId('tour-next').boundingBox();
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-hint')).toHaveText('Type a name (at least two letters).');
  expect(await page.getByTestId('tour-next').boundingBox()).toEqual(nextBefore);
  await step(page, 'name');
  await answer(page, 'name', 'Item name', 'Practice coffee mug');
  // The whole quantity field is highlighted, and its − / + buttons work.
  await step(page, 'quantity');
  await expect(pop(page)).toContainText('Quantity is how many you have on hand');
  await tap(page, 'quantity', 'button[aria-label="Increase"]');
  await tap(page, 'quantity', 'button[aria-label="Increase"]');
  await expect(await fieldOf(page, 'quantity')).toHaveValue('3');
  await step(page, 'quantity');
  await (await fieldOf(page, 'quantity')).focus();
  await page.keyboard.press('Tab');
  await step(page, 'cost');
  await expect(pop(page)).toContainText('Cost per item is what you paid for one product. StockPilot uses this amount to calculate how much profit you make when the item sells.');
  // Clear feedback on a number that isn't one.
  await (await fieldOf(page, 'cost')).fill('eight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('tour-hint')).toContainText('“eight” isn’t a number');
  await step(page, 'cost');
  await answer(page, 'cost', 'Cost per item', '8');
  await answer(page, 'price', 'Selling price', '20');
  await step(page, 'save');
  await expectReachable(page);
  await tap(page, 'save');
  await step(page, 'result');
  // The person's own numbers, not a fixed example.
  await expect(pop(page)).toContainText('3 × $8.00 = $24.00');
  await expect(page.getByTestId('inventory-item')).toHaveCount(1);
  await expect(page.getByTestId('inventory-item')).toContainText('Practice coffee mug');
  // No low-stock warning appears on the practice product.
  await expect(page.getByTestId('inventory-item')).not.toContainText('Low stock');
  await page.getByTestId('tour-next').click();
  await step(page, 'done');
  await expect(page.getByTestId('tour-back-to-learn')).toBeVisible();
  await page.getByTestId('tour-finish').click();
  await expect(pop(page)).toBeHidden();
  await expect(page.getByText('Lesson complete: Add your first product.')).toBeVisible();

  // Back on the real records, unchanged.
  await expect(page.getByTestId('practice-banner')).toBeHidden();
  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item')).toHaveCount(1);
  await expect(page.getByTestId('inventory-item')).toContainText('Real desk lamp');
  await expect(page.getByText('Practice coffee mug')).toHaveCount(0);

  await openLearn(page);
  await expect(lessonRow(page, 'tour-dashboard')).toHaveAttribute('data-status', 'completed');
  await expect(lessonRow(page, 'practice-add-item')).toHaveAttribute('data-status', 'completed');
  await expect(page.getByTestId('learn-path')).toContainText(/2 of \d+ lessons done/);
});

test('recording a practice sale: the product from the last lesson, real figures for margin and ROI, refresh and resume', async ({ page }) => {
  await onboard(page, 'Small business');
  await addItem(page, { name: 'Real camera', quantity: 1, cost: '50', asking: '120' });
  // Add a practice product, then go straight on: the sale lesson keeps that product.
  await startLesson(page, 'practice-add-item');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-inventory');
  await clickStep(page, 'open-form');
  await answer(page, 'name', 'Item name', 'My practice teapot');
  await answer(page, 'quantity', 'Quantity', '2');
  await answer(page, 'cost', 'Cost per item', '10');
  await answer(page, 'price', 'Selling price', '25');
  await clickStep(page, 'save');
  await step(page, 'result');
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-next-lesson')).toHaveText('Next: Record a sale and read your profit');
  await page.getByTestId('tour-next-lesson').click();
  await step(page, 'intro');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-sales');
  await clickStep(page, 'open');
  await expect(page.getByTestId('sale-form')).toBeVisible();
  await step(page, 'item');
  // Only practice items are offered.
  const select = await fieldOf(page, 'item');
  await expect(select.locator('option', { hasText: 'Real camera' })).toHaveCount(0);
  await expect(select.locator('option', { hasText: 'My practice teapot' })).toHaveCount(1);
  await expect(select.locator('option', { hasText: 'Practice coffee mug' })).toHaveCount(0);
  await select.selectOption({ index: 1 });
  await step(page, 'price');

  // Refresh in the middle: the lesson comes back in practice mode, at the step that opens the form, saying why.
  await reloadWhenSaved(page);
  await expect(pop(page)).toBeVisible();
  await expect(page.getByTestId('practice-banner')).toBeVisible();
  await step(page, 'open');
  await expect(page.getByTestId('tour-hint')).toContainText('The page reloaded and the form closed');
  await tap(page, 'open');
  await step(page, 'item');
  await (await fieldOf(page, 'item')).selectOption({ index: 1 });
  await answer(page, 'price', 'Sale price', '20');
  // The fee field and its amount/percent switch are highlighted together.
  await step(page, 'fees');
  await expect(at(page, 'fees').getByRole('radio').first()).toBeVisible();
  await answer(page, 'fees', 'Marketplace fees', '2');
  await clickStep(page, 'save');
  await step(page, 'revenue');
  await expect(pop(page)).toContainText('$20.00');
  await page.getByTestId('tour-next').click();
  await step(page, 'cogs');
  await expect(pop(page)).toContainText('$10.00');
  await page.getByTestId('tour-next').click();
  await step(page, 'profit');
  await expect(pop(page)).toContainText('$20.00 − $10.00 − $2.00 = $8.00');
  await expect(pop(page)).toContainText('not the cash in your bank');
  await page.getByTestId('tour-next').click();
  await step(page, 'margin');
  await expect(pop(page)).toContainText('$8.00 ÷ $20.00 = 40.0%');
  await page.getByTestId('tour-next').click();
  await step(page, 'roi');
  await expect(pop(page)).toContainText('$8.00 ÷ $10.00 = 80.0%');
  await expect(pop(page)).toContainText('Margin compares profit with what buyers paid; ROI compares it with what you paid');
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-finish').click();

  // The real records have no sales and the camera is still in stock.
  await nav(page, 'Sales & Profit');
  await expect(page.getByRole('button', { name: 'Record your first sale' })).toBeVisible();
  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item')).toHaveCount(1);
  await expect(page.getByTestId('inventory-item')).toContainText('Real camera');
});

test('exit and resume (with a "welcome back"), skip with confirmation, and replay without duplicate practice records', async ({ page }) => {
  await onboard(page, 'Small business');
  await startLesson(page, 'practice-add-item');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-inventory');
  await step(page, 'open-form');

  // Exit keeps the place.
  await page.getByTestId('tour-exit').click();
  await expect(pop(page)).toBeHidden();
  await expect(page.getByText(/Lesson paused\. Resume it any time from the Learning Center\. The practice records stay stored/)).toBeVisible();
  await expect(page.getByTestId('practice-banner')).toBeHidden();
  // The Overview offers to resume.
  await nav(page, 'Overview');
  await expect(page.getByTestId('resume-tour')).toContainText('Add your first product');
  await openLearn(page);
  await expect(page.getByTestId('learn-resume-card')).toContainText('Add your first product (step 3 of');
  const row = lessonRow(page, 'practice-add-item');
  await expect(row).toHaveAttribute('data-status', 'in_progress');
  await expect(row).toContainText(/In progress · step 3 of \d+/);
  await row.getByTestId('learn-resume').click();
  await step(page, 'open-form');
  await expect(page.getByTestId('tour-hint')).toContainText('Welcome back — picking up at step 3');

  // Escape exits from anywhere, including inside the open form (and the place is kept).
  await tap(page, 'open-form');
  await step(page, 'name');
  await page.keyboard.press('Escape');
  await expect(pop(page)).toBeHidden();
  await expect(itemForm(page)).toBeHidden();

  // Resuming (from the Overview) inside a form that's no longer open says so.
  await nav(page, 'Overview');
  await page.getByTestId('resume-tour-button').click();
  await step(page, 'open-form');
  await expect(page.getByTestId('tour-hint')).toContainText('Picking up where you left off');
  await tap(page, 'open-form');
  await answer(page, 'name', 'Item name', 'Practice coffee mug');
  await answer(page, 'quantity', 'Quantity', '3');
  await answer(page, 'cost', 'Cost per item', '8');
  await answer(page, 'price', 'Selling price', '20');
  await clickStep(page, 'save');
  await step(page, 'result');
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-finish').click();

  // Replay starts from clean practice records: still only one practice product afterwards.
  await openLearn(page);
  await expect(lessonRow(page, 'practice-add-item').getByTestId('learn-start')).toHaveText('Replay');
  await lessonRow(page, 'practice-add-item').getByTestId('learn-start').click();
  await step(page, 'intro');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-inventory');
  await step(page, 'open-form');
  await expect(page.getByText(/Practice coffee mug/)).toHaveCount(0);
  await tap(page, 'open-form');
  await answer(page, 'name', 'Item name', 'Practice coffee mug');
  await answer(page, 'quantity', 'Quantity', '3');
  await answer(page, 'cost', 'Cost per item', '8');
  await answer(page, 'price', 'Selling price', '20');
  await clickStep(page, 'save');
  await step(page, 'result');
  await expect(page.getByTestId('inventory-item')).toHaveCount(1);

  // Skip lesson asks first; "Keep going" changes nothing.
  await page.getByTestId('tour-skip').click();
  await expect(page.getByTestId('tour-skip-confirm')).toContainText('Skip this lesson?');
  await page.getByTestId('tour-skip-no').click();
  await step(page, 'result');
  await page.getByTestId('tour-skip').click();
  await page.getByTestId('tour-skip-yes').click();
  await expect(pop(page)).toBeHidden();
  await expect(page.getByText('Lesson skipped. It stays in the Learning Center whenever you want it.')).toBeVisible();
  await openLearn(page);
  await expect(lessonRow(page, 'practice-add-item')).toContainText('Completed');
  await lessonRow(page, 'inventory-levels').getByTestId('learn-start').click();
  await page.getByTestId('tour-skip').click();
  await page.getByTestId('tour-skip-yes').click();
  await openLearn(page);
  await expect(lessonRow(page, 'inventory-levels')).toHaveAttribute('data-status', 'skipped');
  await expect(lessonRow(page, 'inventory-levels')).toContainText('Skipped');
});

// ---------------------------------------------------------------------------------------------
// H3 — Practice Mode data safety and keyboard containment
// ---------------------------------------------------------------------------------------------

test('Practice Mode: data management is locked with an explanation, the page can’t be reached by keyboard, and nothing real changes', async ({ page }) => {
  await onboard(page, 'Small business');
  await addItem(page, { name: 'Real desk lamp', quantity: 2, cost: '12', asking: '30' });
  await startLesson(page, 'practice-add-item');
  await page.getByTestId('tour-next').click();
  await step(page, 'go-inventory');

  // Keyboard: Tab only moves between the highlighted control and the lesson box.
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return a?.closest('[data-tour-popover]') ? 'popover' : a?.closest('[data-tour-active]') ? 'target' : `${a?.tagName} ${a?.textContent?.slice(0, 30)}`;
    });
    expect(['popover', 'target']).toContain(where);
  }

  // Even if Settings is opened directly, every data action is off, with the reason.
  await page.evaluate(() => {
    location.hash = '#/settings';
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByTestId('practice-data-lock').first()).toContainText('Leave Practice Mode to manage your data.');
  for (const name of ['Back up now', 'Download backup', 'Restore from backup', 'Import inventory CSV', 'Try demo mode', 'Reset demo data', 'Erase all data']) {
    const b = page.getByRole('button', { name, exact: true });
    if (await b.count()) await expect(b.first(), name).toBeDisabled();
  }
  // Exit is always there.
  await expect(page.getByTestId('tour-exit')).toBeVisible();
  await page.getByTestId('tour-exit').click();

  // Out of practice: everything works again, on your own records.
  await expect(page.getByTestId('practice-banner')).toBeHidden();
  await expect(page.getByTestId('practice-data-lock')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Download backup', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Erase all data', exact: true })).toBeEnabled();
  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item')).toHaveCount(1);
  await expect(page.getByTestId('inventory-item')).toContainText('Real desk lamp');
});

// ---------------------------------------------------------------------------------------------
// H1 — Two tabs
// ---------------------------------------------------------------------------------------------

test('two tabs: only the tab running a lesson moves it; the other says so, and takes over only when that tab is closed', async ({ page, context }) => {
  await onboard(page, 'Small business');
  await startLesson(page, 'practice-add-item');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-inventory');
  await clickStep(page, 'open-form');
  await step(page, 'name');
  // Record every step the first tab shows from now on.
  await page.evaluate(() => {
    (window as unknown as { steps: string[] }).steps = [];
    new MutationObserver(() => {
      const s = document.querySelector('[data-tour-popover]')?.getAttribute('data-step');
      const log = (window as unknown as { steps: string[] }).steps;
      if (s && log.at(-1) !== s) log.push(s);
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-step'], childList: true });
  });

  const other = await context.newPage();
  await other.goto('./');
  await expect(other.getByTestId('tour-other-tab')).toContainText('“Add your first product” is running in another StockPilot tab');
  await expect(other.getByTestId('tour-popover')).toHaveCount(0);

  // The first tab carries on through the form while the second is open (it used to rewind it).
  await page.bringToFront();
  await answer(page, 'name', 'Item name', 'Practice coffee mug');
  await answer(page, 'quantity', 'Quantity', '3');
  await page.waitForTimeout(2500);
  await step(page, 'cost');
  await answer(page, 'cost', 'Cost per item', '8');
  await page.waitForTimeout(1500);
  await step(page, 'price');
  const seen = await page.evaluate(() => (window as unknown as { steps: string[] }).steps);
  expect(seen).toEqual(['quantity', 'cost', 'price']);
  await expect(other.getByTestId('tour-popover')).toHaveCount(0);

  // Refreshing the first tab keeps the lesson there.
  await reloadWhenSaved(page);
  await expect(pop(page)).toBeVisible();
  await step(page, 'open-form');
  await expect(other.getByTestId('tour-other-tab')).toBeVisible();

  // Closing it: the second tab takes the lesson over.
  await page.close();
  await expect(other.getByTestId('tour-popover')).toBeVisible({ timeout: 10000 });
  await expect(other.getByTestId('tour-other-tab')).toHaveCount(0);
  await expect(other.getByTestId('tour-popover')).toHaveAttribute('data-step', 'open-form');
});

test('two tabs: "Continue it here" moves the lesson to this tab and the first tab stands down', async ({ page, context }) => {
  await onboard(page, 'Reseller');
  await startLesson(page, 'tour-dashboard');
  await page.getByTestId('tour-next').click();
  await step(page, 'headline');
  const other = await context.newPage();
  await other.goto('./');
  await other.getByTestId('tour-continue-here').click();
  await expect(other.getByTestId('tour-popover')).toBeVisible();
  await expect(other.getByTestId('tour-popover')).toHaveAttribute('data-step', 'headline');
  await expect(page.getByTestId('tour-other-tab')).toBeVisible();
  await expect(pop(page)).toHaveCount(0);
});

// ---------------------------------------------------------------------------------------------
// H2 — Max Bid; H4 — collector details
// ---------------------------------------------------------------------------------------------

test('Max Bid lesson: enter a resale value and target return, see and understand the real maximum bid', async ({ page }) => {
  await onboard(page, 'Reseller');
  await startLesson(page, 'max-bid');
  await step(page, 'intro');
  await page.getByTestId('tour-next').click();
  await step(page, 'page');
  await page.getByTestId('tour-next').click();
  await step(page, 'new');
  await expect(pop(page)).toContainText('Click New calculation');
  await tap(page, 'new');
  await answer(page, 'resale', 'Estimated resale value, whole lot', '1000');
  await step(page, 'roi');
  await expectReachable(page);
  await answer(page, 'roi', 'Target return (ROI)', '50');
  await step(page, 'result');
  await expect(page.getByTestId('bid-max')).toBeVisible();
  const max = (await page.getByTestId('bid-max').textContent())!.trim();
  expect(max).toMatch(/^\$\d/);
  await expect(pop(page)).toContainText(`the most to bid is ${max}`);
  await expectReachable(page);
  await page.getByTestId('tour-next').click();
  await step(page, 'breakdown');
  await expect(pop(page)).toContainText('net proceeds');
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-finish').click();
  await openLearn(page);
  await expect(lessonRow(page, 'max-bid')).toHaveAttribute('data-status', 'completed');
});

test('Max Bid lesson: it can’t be finished until a result is on screen', async ({ page }) => {
  await onboard(page, 'Reseller');
  await startLesson(page, 'max-bid');
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'new');
  await step(page, 'resale');
  // No resale value: Next explains, and the result step can't be reached.
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-hint')).toContainText('Enter an amount');
  await step(page, 'resale');
});

test('collector lesson: condition, purchase date and where it was bought are each guided before saving', async ({ page }) => {
  await onboard(page, 'Collector');
  await startLesson(page, 'collector-add');
  await page.getByTestId('tour-next').click();
  await step(page, 'go-inventory');
  await expect(pop(page)).toContainText('Click Collection in the menu');
  await tap(page, 'go-inventory');
  await clickStep(page, 'open-form');
  await answer(page, 'name', 'Item name', 'Practice 1986 baseball card');
  await answer(page, 'cost', 'Cost per item', '15');
  await answer(page, 'value', 'Est. market value', '40');
  await step(page, 'more');
  await expect(page.getByTestId('tour-next')).toHaveCount(0);
  await tap(page, 'more');
  await step(page, 'condition');
  await expectReachable(page);
  // Saving early isn't possible from the lesson: the condition is asked for first.
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-hint')).toContainText('Describe the condition');
  await answer(page, 'condition', 'Condition', 'Near mint');
  await step(page, 'date');
  await expectReachable(page);
  await (await fieldOf(page, 'date')).fill('2026-01-15');
  await page.keyboard.press('Enter');
  await step(page, 'where');
  await expectReachable(page);
  await expect(pop(page)).toContainText('not where you keep it');
  await answer(page, 'where', 'Where you bought it', 'Practice card show');
  await step(page, 'save');
  await expect(pop(page)).toContainText('Add it to your collection');
  await tap(page, 'save');
  await step(page, 'result');
  await expect(pop(page)).toContainText('you paid $15.00, and you estimate it’s worth $40.00');
  await expect(page.getByText('Added "Practice 1986 baseball card" to your collection')).toBeVisible();
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-finish').click();
  // Nothing in the real collection.
  await nav(page, 'Collection');
  await expect(page.getByText('Your collection is empty')).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// Every lesson, every mode
// ---------------------------------------------------------------------------------------------

test('every small-business lesson finds what it points at, with worked examples', async ({ page }) => {
  test.setTimeout(90_000);
  await onboard(page, 'Small business', true);
  for (const id of ['tour-dashboard', 'inventory-levels', 'profit-by-source', 'monthly-close', 'financial-planning', 'backup']) await walk(page, id);
  await openLearn(page);
  for (const id of ['tour-dashboard', 'inventory-levels', 'profit-by-source', 'monthly-close', 'financial-planning', 'backup']) {
    await expect(lessonRow(page, id)).toHaveAttribute('data-status', 'completed');
  }
  // The demo is untouched by the practice lessons.
  await expect(page.getByTestId('demo-banner')).toBeVisible();
});

test('reseller lessons: bulk lot split, payouts, predicted vs actual; the scanner lesson is listed as unavailable', async ({ page }) => {
  test.setTimeout(90_000);
  await onboard(page, 'Reseller', true);
  // Bulk lots: the $100 split between two practice items by estimated value.
  await startLesson(page, 'bulk-lots');
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'open');
  await step(page, 'split');
  await expect(at(page, 'split')).toContainText('$75.00');
  await expect(at(page, 'split')).toContainText('$25.00');
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-finish').click();
  // Back on the demo's own lots page, without the practice lot.
  await expect(page.getByText('Practice box lot')).toHaveCount(0);

  await walk(page, 'payouts');
  await walk(page, 'predicted-actual');
  await openLearn(page);
  const scanner = page.locator('[data-lesson="ai-scanner"]').first();
  await expect(scanner).toHaveAttribute('data-available', 'false');
  await expect(scanner).toContainText('The AI scanner is switched off in this version');
  await expect(scanner.getByTestId('learn-start')).toBeDisabled();
  await expect(page.getByTestId('learn-path')).not.toContainText('AI scanner');
  await expect(page.getByTestId('demo-banner')).toBeVisible();
});

test('collector path: valuation and optional sales; other modes’ lessons are discoverable without changing mode', async ({ page }) => {
  await onboard(page, 'Collector');
  await openLearn(page);
  await expect(page.getByTestId('learn-path')).toContainText('Your path: Collector');
  await expect(page.getByTestId('learn-path').getByTestId('learn-lesson')).toHaveCount(6);
  // Record-a-sale explains why it's unavailable while collector sales are off.
  await expect(lessonRow(page, 'practice-record-sale')).toContainText('Sales tracking is off in Collector mode');
  await expect(lessonRow(page, 'practice-record-sale').getByTestId('learn-start')).toBeDisabled();
  // Lessons made for other modes are listed, and can be taken here.
  const others = page.getByTestId('learn-other-modes');
  await expect(others).toContainText('The Max Bid Calculator');
  await expect(others).toContainText('For Reseller mode');
  for (const id of ['collector-organize', 'collector-valuation']) await walk(page, id);
  await startLesson(page, 'collector-sales');
  await expect(pop(page)).toContainText('This lesson doesn’t switch it on');
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-finish').click();
  await walk(page, 'bulk-lots');
  await expect(page.getByTestId('mode-switcher').first()).toContainText('Collector');

  await page.locator('[data-testid="mode-switcher"]:visible').click();
  await page.getByRole('menuitemradio', { name: /Small business/ }).click();
  await openLearn(page);
  await expect(page.getByTestId('learn-path')).toContainText('Your path: Small business');
  await expect(lessonRow(page, 'practice-add-item')).toHaveAttribute('data-status', 'not_started');
  await expect(lessonRow(page, 'bulk-lots')).toHaveAttribute('data-status', 'completed');
});

test('a step whose control is missing explains it and offers a way on, never a dead end', async ({ page }) => {
  await onboard(page, 'Reseller');
  await startLesson(page, 'tour-dashboard');
  await page.getByTestId('tour-next').click();
  await step(page, 'menu');
  await page.addStyleTag({ content: 'nav[aria-label="Main"] { display: none !important; }' });
  await expect(pop(page)).toHaveAttribute('data-target-found', 'false');
  await expect(page.getByRole('heading', { name: 'This part of the screen isn’t showing' })).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId('tour-exit')).toBeVisible();
  await page.getByTestId('tour-skip-step').click();
  await step(page, 'learn');
});

test('learning center: search by instructions; "See it in StockPilot" opens the explanation in place', async ({ page }) => {
  await onboard(page, 'Small business', true);
  await openLearn(page);
  for (const g of ['Basic inventory', 'Sales', 'Business insights', 'Financial reporting']) await expect(page.getByRole('heading', { name: g, exact: true })).toBeVisible();
  const search = page.getByLabel('Search lessons and help topics');
  await search.fill('restore');
  await expect(page.locator('[data-lesson="backup"]').first()).toBeVisible();
  await expect(page.getByTestId('learn-topic').filter({ hasText: 'Restoring a backup' })).toBeVisible();
  await search.fill('margin roi');
  await expect(page.locator('[data-lesson="practice-record-sale"]').first()).toBeVisible();
  await search.fill('tax');
  const tax = page.getByTestId('learn-topic').filter({ hasText: 'Tax reserve' });
  await expect(tax).toContainText('doesn’t know your tax rate');
  await expect(tax).toContainText('profit isn’t the same as cash');
  await search.fill('realized profit');
  await page.locator('#topic-realized-profit').getByTestId('learn-topic-see').click();
  await expect(page).toHaveURL(/#\/sales\?help=realized-profit/);
  await expect(page.getByTestId('help-realized-profit-text')).toBeVisible();
  await expect(page.getByTestId('help-realized-profit-text')).toContainText('not the cash in your bank account');
  // No lesson started.
  await expect(pop(page)).toHaveCount(0);
  // Help icons look and work the same on tiles and section headings.
  await page.getByTestId('help-realized-profit-text').getByRole('link', { name: 'More in the Learning Center' }).click();
  await expect(page).toHaveURL(/#\/learn\?topic=realized-profit/);
  await expect(page.locator('#topic-realized-profit')).toBeInViewport();
});

test('progress is kept in backups and restored with settings', async ({ page }) => {
  await onboard(page, 'Reseller');
  await walk(page, 'bulk-lots');
  await nav(page, 'Settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const file = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(Object.keys(file.settings.tutorial.completed)).toEqual(['bulk-lots']);
  expect(file.settings.tutorial.active).toBeNull();
  // Lesson progress isn't financial data, and practice records aren't in the backup.
  expect(file.data.items).toEqual([]);
  expect(file.data.lots).toEqual([]);
  expect(file.data.sales).toEqual([]);

  await walk(page, 'payouts');
  await openLearn(page);
  await expect(lessonRow(page, 'payouts')).toHaveAttribute('data-status', 'completed');

  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  const dialog = page.getByTestId('restore-dialog');
  await dialog.getByTestId('restore-file').setInputFiles(await download.path());
  await expect(dialog).toContainText('Learning Center progress');
  await expect(dialog.getByRole('checkbox', { name: /Also restore settings/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Replace my data' }).click();
  await expect(dialog).toBeHidden();
  await openLearn(page);
  await expect(lessonRow(page, 'bulk-lots')).toHaveAttribute('data-status', 'completed');
  await expect(lessonRow(page, 'payouts')).toHaveAttribute('data-status', 'not_started');
  await expect(page.getByTestId('tour-welcome')).toBeHidden();
});

test('practice records: explained, kept for resuming, and can be deleted from the Learning Center', async ({ page }) => {
  await onboard(page, 'Small business');
  await openLearn(page);
  await expect(page.getByTestId('learn-practice-records')).toContainText('They stay stored after you leave a lesson');
  await page.getByTestId('learn-clear-practice').click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Delete practice records' }).click();
  await expect(page.getByText('Practice records deleted.')).toBeVisible();
});

test('keyboard and screen readers: the welcome, a running lesson, a field step and the Learning Center', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('radio', { name: /^Reseller Mode/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Start with my own inventory/ }).click();
  await axe(page, 'welcome');
  await expect(page.getByTestId('tour-welcome-start')).toBeFocused();
  await page.keyboard.press('Enter');
  const p = pop(page);
  await expect(p).toBeVisible();
  await expect(p).toHaveAttribute('role', 'dialog');
  await expect(p).toHaveAccessibleName(/This is your Overview/);
  // Focus moves to the step's title so it's read out; Tab reaches Next.
  await expect(p.getByRole('heading', { level: 2 })).toBeFocused();
  await axe(page, 'lesson step');
  let found = false;
  for (let i = 0; i < 8 && !found; i++) {
    await page.keyboard.press('Tab');
    found = await page.getByTestId('tour-next').evaluate((el) => el === document.activeElement);
  }
  expect(found).toBe(true);
  await page.keyboard.press('Enter');
  await step(page, 'headline');
  await page.keyboard.press('Escape');
  await expect(p).toBeHidden();

  // A field step inside a dialog: type, Tab moves on to the next field; Tab never leaves field + lesson box.
  await startLesson(page, 'practice-add-item');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-inventory');
  await clickStep(page, 'open-form');
  await step(page, 'name');
  // Focus starts in the field (on phones it waits for a tap, so the keyboard doesn't pop up uninvited).
  if (isMobile(page)) await at(page, 'name').focus();
  await expect(at(page, 'name')).toBeFocused();
  await page.keyboard.type('Practice mug');
  await page.keyboard.press('Tab');
  await step(page, 'quantity');
  await axe(page, 'lesson step in a form');

  // Leaving with typing in the form asks first (nothing is thrown away by accident).
  await page.getByTestId('tour-exit').click();
  await expect(page.getByTestId('tour-leave-confirm')).toBeVisible();
  await page.getByTestId('tour-leave-yes').click();
  await openLearn(page);
  await axe(page, 'learning center');
  await expect(page.locator('[data-tour="learn-link"]:visible')).toHaveAccessibleName(/Learning Center/);
});

test('reduced motion: the lesson still works and scrolls without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await onboard(page, 'Small business', true);
  await walk(page, 'monthly-close');
});

test('dark mode: the dimmed page is darker and the highlighted control stays readable', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await onboard(page, 'Small business');
  await startLesson(page, 'tour-dashboard');
  const fill = await page
    .getByTestId('tour-mask')
    .locator('path')
    .evaluate((el) => getComputedStyle(el).fill);
  expect(fill).toMatch(/0\.75\)$/);
  // The lesson box itself passes (the app's own dark accent buttons under the overlay are a separate, known issue).
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).include('[data-tour-popover]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
  // The highlighted control isn't dimmed: nothing of the overlay covers it.
  await expectReachable(page);
});

test('phone layout: the lesson box and all its buttons stay on screen, never hide the control, and follow scrolling', async ({ page }) => {
  test.skip(!isMobile(page), 'phone layout');
  await onboard(page, 'Small business', true);
  await startLesson(page, 'financial-planning');
  for (const id of ['page', 'tax', 'scenarios', 'reserves']) {
    await step(page, id);
    await expectReachable(page);
    await buttonsInside(page);
    await page.getByTestId('tour-next').click();
  }
  await step(page, 'done');
  await buttonsInside(page);
  await page.getByTestId('tour-finish').click();

  // A long form on a phone: each field scrolls into view and stays usable.
  await startLesson(page, 'practice-add-item');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-inventory');
  await clickStep(page, 'open-form');
  for (const [id, label, value] of [
    ['name', 'Item name', 'Phone mug'],
    ['quantity', 'Quantity', '2'],
    ['cost', 'Cost per item', '4'],
    ['price', 'Selling price', '9'],
  ] as const) {
    await step(page, id);
    await expectReachable(page);
    await buttonsInside(page);
    await answer(page, id, label, value);
  }
  await step(page, 'save');
  await expectReachable(page);
  await page.getByTestId('tour-exit').click();
  await page.getByTestId('tour-leave-yes').click();

  // The highlight follows the control as the page scrolls.
  await startLesson(page, 'backup');
  await step(page, 'where');
  await page.getByTestId('tour-next').click();
  await step(page, 'download');
  await expectReachable(page);
  const highlight = page.getByTestId('tour-highlight');
  const follows = async () => {
    const [h, t] = [await highlight.boundingBox(), await at(page, 'download').boundingBox()];
    return Math.round(Math.abs(h!.y - (t!.y - 6)));
  };
  await expect.poll(follows).toBeLessThanOrEqual(1);
  await page.mouse.move(200, 300);
  await page.mouse.wheel(0, 120);
  await expect.poll(follows).toBeLessThanOrEqual(1);
});

test('without a lesson running, existing work flows are unchanged', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Vintage radio', quantity: 2, cost: '15', asking: '45' });
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: 'Record your first sale' }).click();
  await recordSale(page, { item: 'Vintage radio', price: '45', fees: '5' });
  await expect(page.getByTestId('sales-net')).toContainText('$25.00');
  await expect(page.getByTestId('tour-popover')).toHaveCount(0);
  await expect(page.getByTestId('tour-mask')).toHaveCount(0);
  await saved(page);
});

test('demo mode: items you add while trying it out are labelled, the demo’s own items are not', async ({ page }) => {
  await onboard(page, 'Reseller', true);
  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item').first()).toBeVisible();
  await expect(page.getByTestId('demo-added-by-you')).toHaveCount(0);
  await addItem(page, { name: 'My demo test item', quantity: 1, cost: '3' });
  await nav(page, 'Inventory');
  const mine = page.getByTestId('inventory-item').filter({ hasText: 'My demo test item' });
  await expect(mine.getByTestId('demo-added-by-you')).toHaveText('Added by you');
  await expect(page.getByTestId('demo-added-by-you')).toHaveCount(1);
});
