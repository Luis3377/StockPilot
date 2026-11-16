// Learning Center and guided tours: the welcome, practice lessons on the separate practice
// records, verified step-by-step progress, stop/resume, replays, every lesson's targets, phones,
// keyboard and screen-reader support, and that real records are never touched.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { addItem, isMobile, nav, onboard, recordSale, reloadWhenSaved, saved } from './helpers';

const pop = (page: Page) => page.getByTestId('tour-popover');
const step = (page: Page, id: string) => expect(pop(page)).toHaveAttribute('data-step', id);
/** The control the current step highlights (marked with the step's id, so it's never a stale one). */
const target = (page: Page) => page.locator('[data-tour-active]');
const at = (page: Page, id: string) => page.locator(`[data-tour-active="${id}"]`);

/** Taps the highlighted control where a person sees it: once it has stopped moving and nothing covers it. */
async function tap(page: Page, id: string) {
  const el = at(page, id);
  let last = '';
  let point: { x: number; y: number } | null = null;
  await expect
    .poll(
      async () => {
        const b = await el.boundingBox();
        const key = JSON.stringify(b);
        const still = key === last;
        last = key;
        if (!b || !still) return false;
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        const onTop = await el.evaluate((node, [px, py]) => {
          const hit = document.elementFromPoint(px, py);
          return !!hit && (node === hit || node.contains(hit));
        }, [x, y]);
        point = onTop ? { x, y } : null;
        return onTop;
      },
      { message: `the "${id}" control should be on screen and uncovered`, timeout: 5000, intervals: [100] },
    )
    .toBe(true);
  await page.mouse.click(point!.x, point!.y);
}

/** Waits for a step, then taps the control it highlights. */
async function clickStep(page: Page, id: string) {
  await step(page, id);
  await tap(page, id);
}
const itemForm = (page: Page) => page.getByTestId('item-form');

async function axe(page: Page, where: string) {
  await page.waitForTimeout(400);
  const { violations } = await new AxeBuilder({ page }).exclude('.animate-toast-in').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${where}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

/** The highlighted control is on screen and nothing (the popover included) covers its middle. */
async function expectReachable(page: Page, control?: Locator) {
  const el = control ?? at(page, (await pop(page).getAttribute('data-step'))!);
  await expect(el).toBeInViewport();
  const covered = () => el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const top = Math.max(0, r.top);
    const bottom = Math.min(window.innerHeight, r.bottom);
    let last = 'nothing';
    // The middle, or (for a big card the lesson box partly overlaps) another point inside it.
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
      const hit = document.elementFromPoint(r.left + r.width * fx, top + (bottom - top) * fy) as HTMLElement | null;
      if (!hit) continue;
      // Look-only steps put a clear shield over the control: shown, but not usable from the lesson.
      if (node === hit || node.contains(hit) || hit.contains(node) || hit.dataset.testid === 'tour-look-shield') return null;
      last = `${hit.tagName} ${hit.dataset.testid ?? ''} ${hit.className}`.slice(0, 160);
    }
    return last;
  });
  // Allow a moment for the lesson to scroll the control clear of the header, tab bar or lesson box.
  await expect.poll(covered, { message: `the highlighted control (${await pop(page).getAttribute('data-step')}) should not be covered`, timeout: 3000 }).toBeNull();
}

async function openLearn(page: Page) {
  await page.locator('[data-tour="learn-link"]:visible').click();
  await expect(page.getByRole('heading', { level: 1, name: 'Learning Center' })).toBeVisible();
}

const lessonRow = (page: Page, id: string) => page.getByTestId('learn-path').locator(`[data-lesson="${id}"]`).or(page.locator(`[data-testid^="learn-group-"] [data-lesson="${id}"]`)).first();

async function startLesson(page: Page, id: string) {
  await openLearn(page);
  await lessonRow(page, id).getByTestId('learn-start').click();
  await expect(pop(page)).toBeVisible();
}

/** Types into the highlighted field (checked by its label) and moves on with Tab, like a person would. */
async function answer(page: Page, label: string, value: string) {
  const el = target(page);
  await expect(el).toHaveAccessibleName(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  await el.fill(value);
  await page.keyboard.press('Tab');
}

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

test('guided tour: welcome, getting around, then adding a practice product step by step', async ({ page }) => {
  await onboard(page, 'Small business');
  // A real record that must stay exactly as it is.
  await addItem(page, { name: 'Real desk lamp', quantity: 2, cost: '12', asking: '30' });
  await openLearn(page);
  await page.getByTestId('learn-welcome').click();
  await page.getByTestId('tour-welcome-start').click();

  // Lesson 1: getting around (explanation steps only).
  await expect(pop(page)).toContainText('Getting around StockPilot');
  await expect(page.getByTestId('tour-progress')).toHaveText(/^Step 1 of \d+$/);
  await step(page, 'overview');
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
  await page.getByTestId('tour-next-lesson').click();

  // Lesson 2: practice product.
  await expect(pop(page)).toContainText('Add your first product');
  await expect(page.getByTestId('practice-banner')).toBeVisible();
  await step(page, 'intro');
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
  // Invalid answers don't move on.
  await target(page).fill('a');
  await page.getByTestId('tour-next').click();
  await expect(page.getByTestId('tour-hint')).toHaveText('Type a name (at least two letters).');
  await step(page, 'name');
  await answer(page, 'Item name', 'Practice coffee mug');
  await step(page, 'quantity');
  await expect(pop(page)).toContainText('Quantity is how many you have on hand');
  await answer(page, 'Quantity', '3');
  await step(page, 'cost');
  await expect(pop(page)).toContainText('Cost per item is what you paid for one product. StockPilot uses this amount to calculate how much profit you make when the item sells.');
  await answer(page, 'Cost per item', '8');
  await step(page, 'price');
  await answer(page, 'Selling price', '20');
  await step(page, 'save');
  await expectReachable(page);
  await tap(page, 'save');
  await step(page, 'result');
  await expect(pop(page)).toContainText('Illustrative example');
  await expect(page.getByTestId('inventory-item')).toHaveCount(1);
  await expect(page.getByTestId('inventory-item')).toContainText('Practice coffee mug');
  await page.getByTestId('tour-next').click();
  await step(page, 'done');
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

test('recording a practice sale explains revenue, cost of goods sold and realized profit; a refresh resumes', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Real camera', quantity: 1, cost: '50', asking: '120' });
  await startLesson(page, 'practice-record-sale');
  await step(page, 'intro');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-sales');
  await clickStep(page, 'open');
  await expect(page.getByTestId('sale-form')).toBeVisible();
  await step(page, 'item');
  // Only the practice item is offered.
  await expect(target(page).locator('option', { hasText: 'Real camera' })).toHaveCount(0);
  await target(page).selectOption({ index: 1 });
  await step(page, 'price');

  // Refresh in the middle: the lesson comes back in practice mode, at the step that opens the form.
  await reloadWhenSaved(page);
  await expect(pop(page)).toBeVisible();
  await expect(page.getByTestId('practice-banner')).toBeVisible();
  await step(page, 'open');
  await expect(page.getByTestId('tour-hint')).toContainText('Open it again to carry on');
  await tap(page, 'open');
  await step(page, 'item');
  await target(page).selectOption({ index: 1 });
  await step(page, 'price');
  await answer(page, 'Sale price', '20');
  await step(page, 'fees');
  await answer(page, 'Marketplace fees', '2');
  await clickStep(page, 'save');
  await step(page, 'revenue');
  await expect(target(page)).toContainText('$20.00');
  await page.getByTestId('tour-next').click();
  await step(page, 'cogs');
  await expect(target(page)).toContainText('$8.00');
  await page.getByTestId('tour-next').click();
  await step(page, 'profit');
  await expect(target(page)).toContainText('$10.00');
  await expect(pop(page)).toContainText('not the cash in your bank');
  await expect(pop(page)).toContainText('Illustrative example');
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-finish').click();

  // The real records have no sales and the camera is still in stock.
  await nav(page, 'Sales & Profit');
  await expect(page.getByRole('button', { name: 'Record your first sale' })).toBeVisible();
  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item')).toHaveCount(1);
  await expect(page.getByTestId('inventory-item')).toContainText('Real camera');
});

test('exit and resume from the Learning Center, skip a lesson, and replay without duplicate practice records', async ({ page }) => {
  await onboard(page, 'Small business');
  await startLesson(page, 'practice-add-item');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-inventory');
  await step(page, 'open-form');

  // Exit keeps the place.
  await page.getByTestId('tour-exit').click();
  await expect(pop(page)).toBeHidden();
  await expect(page.getByText('Lesson paused. Resume it any time from the Learning Center.')).toBeVisible();
  await expect(page.getByTestId('practice-banner')).toBeHidden();
  await openLearn(page);
  const row = lessonRow(page, 'practice-add-item');
  await expect(row).toHaveAttribute('data-status', 'in_progress');
  await expect(row).toContainText(/In progress · step 3 of \d+/);
  await row.getByTestId('learn-resume').click();
  await step(page, 'open-form');

  // Escape also exits (and the place is kept).
  await page.getByTestId('tour-progress').click();
  await page.keyboard.press('Escape');
  await expect(pop(page)).toBeHidden();

  // Finish it once.
  await openLearn(page);
  await lessonRow(page, 'practice-add-item').getByTestId('learn-resume').click();
  await clickStep(page, 'open-form');
  await step(page, 'name');
  await answer(page, 'Item name', 'Practice coffee mug');
  await step(page, 'quantity');
  await answer(page, 'Quantity', '3');
  await step(page, 'cost');
  await answer(page, 'Cost per item', '8');
  await step(page, 'price');
  await answer(page, 'Selling price', '20');
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
  await step(page, 'name');
  await answer(page, 'Item name', 'Practice coffee mug');
  await step(page, 'quantity');
  await answer(page, 'Quantity', '3');
  await step(page, 'cost');
  await answer(page, 'Cost per item', '8');
  await step(page, 'price');
  await answer(page, 'Selling price', '20');
  await clickStep(page, 'save');
  await step(page, 'result');
  await expect(page.getByTestId('inventory-item')).toHaveCount(1);

  // Skip lesson.
  await page.getByTestId('tour-skip').click();
  await expect(pop(page)).toBeHidden();
  await openLearn(page);
  await expect(lessonRow(page, 'practice-add-item')).toHaveAttribute('data-status', 'completed');
  await lessonRow(page, 'inventory-levels').getByTestId('learn-start').click();
  await page.getByTestId('tour-skip').click();
  await openLearn(page);
  await expect(lessonRow(page, 'inventory-levels')).toHaveAttribute('data-status', 'skipped');
  await expect(lessonRow(page, 'inventory-levels')).toContainText('Skipped');
});

test('leaving practice from the banner pauses the lesson and shows your own records', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Real record player', quantity: 1, cost: '40' });
  await startLesson(page, 'practice-add-item');
  await expect(page.getByTestId('practice-banner')).toBeVisible();
  await expect(page.getByTestId('practice-banner')).toContainText('Your own records aren’t changed.');
  // During a lesson the page is dimmed for pointer clicks, but the banner stays usable from the keyboard.
  await page.getByTestId('practice-leave').focus();
  await page.keyboard.press('Enter');
  await expect(pop(page)).toBeHidden();
  await expect(page.getByTestId('practice-banner')).toBeHidden();
  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item')).toContainText('Real record player');
  await openLearn(page);
  await expect(lessonRow(page, 'practice-add-item')).toHaveAttribute('data-status', 'in_progress');
});

/** Walks a look-only lesson: every step must find what it points at. */
async function walk(page: Page, id: string) {
  await startLesson(page, id);
  for (let i = 0; i < 25; i++) {
    const p = pop(page);
    await expect(p).toBeVisible();
    await expect(p).not.toHaveAttribute('data-target-found', 'false', { timeout: 3000 });
    await expect(page.getByTestId('tour-body')).not.toContainText('can’t find');
    if (await page.getByTestId('tour-finish').isVisible()) {
      await page.getByTestId('tour-finish').click();
      await expect(p).toBeHidden();
      return;
    }
    if ((await p.getAttribute('data-target-found')) === 'true') await expectReachable(page);
    const before = await p.getAttribute('data-step');
    await page.getByTestId('tour-next').click();
    await expect(p).not.toHaveAttribute('data-step', before!);
  }
  throw new Error(`lesson ${id} didn't finish`);
}

test('every small-business explanation lesson finds what it points at', async ({ page }) => {
  await onboard(page, 'Small business', true);
  for (const id of ['tour-dashboard', 'inventory-levels', 'profit-by-source', 'monthly-close', 'financial-planning', 'backup']) await walk(page, id);
  await openLearn(page);
  for (const id of ['tour-dashboard', 'inventory-levels', 'profit-by-source', 'monthly-close', 'financial-planning', 'backup']) {
    await expect(lessonRow(page, id)).toHaveAttribute('data-status', 'completed');
  }
});

test('reseller lessons: buying intelligence and payouts, and the scanner is not offered when it is off', async ({ page }) => {
  await onboard(page, 'Reseller', true);
  for (const id of ['bulk-lots', 'payouts', 'predicted-actual']) await walk(page, id);
  await openLearn(page);
  await expect(page.locator('[data-lesson="ai-scanner"]')).toHaveCount(0);
  await expect(page.getByTestId('learn-path')).not.toContainText('AI scanner');

  // Max Bid runs in practice: the plan it starts isn't one of the demo's plans.
  await startLesson(page, 'max-bid');
  await page.getByTestId('tour-next').click();
  await step(page, 'page');
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'new');
  await step(page, 'form');
  await expectReachable(page);
  await page.getByTestId('tour-next').click();
  await page.getByTestId('tour-finish').click();
  await expect(page.getByTestId('demo-banner')).toBeVisible();
});

test('collector path: practice collectible, valuation and optional sales; switching modes changes the path', async ({ page }) => {
  await onboard(page, 'Collector');
  await openLearn(page);
  await expect(page.getByTestId('learn-path')).toContainText('Your path: Collector');
  await expect(page.getByTestId('learn-path').getByTestId('learn-lesson')).toHaveCount(6);
  // Record-a-sale explains why it's unavailable while collector sales are off.
  await expect(lessonRow(page, 'practice-record-sale')).toContainText('Sales tracking is off in Collector mode');
  await expect(lessonRow(page, 'practice-record-sale').getByTestId('learn-start')).toBeDisabled();

  await lessonRow(page, 'collector-add').getByTestId('learn-start').click();
  await page.getByTestId('tour-next').click();
  await clickStep(page, 'go-inventory');
  await clickStep(page, 'open-form');
  await step(page, 'name');
  await answer(page, 'Item name', 'Practice 1986 baseball card');
  await step(page, 'cost');
  await answer(page, 'Cost per item', '15');
  await step(page, 'value');
  await answer(page, 'Est. market value', '40');
  await clickStep(page, 'more');
  await clickStep(page, 'save');
  await step(page, 'done');
  await page.getByTestId('tour-finish').click();
  for (const id of ['collector-organize', 'collector-valuation', 'collector-sales']) await walk(page, id);
  await nav(page, 'Collection');
  await expect(page.getByText('Your collection is empty')).toBeVisible();

  await page.locator('[data-testid="mode-switcher"]:visible').click();
  await page.getByRole('menuitemradio', { name: /Small business/ }).click();
  await openLearn(page);
  await expect(page.getByTestId('learn-path')).toContainText('Your path: Small business');
  await expect(lessonRow(page, 'practice-add-item')).toHaveAttribute('data-status', 'not_started');
  await expect(lessonRow(page, 'tour-dashboard')).toBeVisible();
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

test('learning center search finds lessons and help topics; help icons explain the figures', async ({ page }) => {
  await onboard(page, 'Small business', true);
  await openLearn(page);
  for (const g of ['Basic inventory', 'Sales', 'Business insights', 'Financial reporting']) await expect(page.getByRole('heading', { name: g, exact: true })).toBeVisible();
  await page.getByTestId('learn-search').getByRole('searchbox').or(page.getByLabel('Search lessons and help topics')).first().fill('tax');
  await expect(page.getByTestId('learn-topic').filter({ hasText: 'Tax reserve' })).toContainText('doesn’t know your tax rate');
  await expect(page.getByTestId('learn-topic').filter({ hasText: 'Tax reserve' })).toContainText('profit isn’t the same as cash');
  await expect(page.locator('[data-lesson="financial-planning"]').first()).toBeVisible();

  await nav(page, 'Sales & Profit');
  await page.getByTestId('help-realized-profit').click();
  await expect(page.getByTestId('help-realized-profit-text')).toContainText('not the cash in your bank account');
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
  // Lesson progress isn't financial data: nothing was added to the records.
  expect(file.data.items).toEqual([]);
  expect(file.data.sales).toEqual([]);

  // Progress moves on after the backup…
  await walk(page, 'payouts');
  await openLearn(page);
  await expect(lessonRow(page, 'payouts')).toHaveAttribute('data-status', 'completed');

  // …and restoring the backup with its settings brings back the progress it had.
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

test('keyboard and screen readers: the welcome, a running lesson and the Learning Center', async ({ page }) => {
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

  // A field step inside a dialog: Tab moves between the form and the lesson box.
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

  await page.getByTestId('tour-exit').click();
  await openLearn(page);
  await axe(page, 'learning center');
});

test('reduced motion: the lesson still works and scrolls without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await onboard(page, 'Small business', true);
  await walk(page, 'monthly-close');
});

test('phone layout: the lesson box never hides the control, and follows scrolling', async ({ page }) => {
  test.skip(!isMobile(page), 'phone layout');
  await onboard(page, 'Small business', true);
  await startLesson(page, 'financial-planning');
  for (const id of ['page', 'tax', 'scenarios', 'reserves']) {
    await step(page, id);
    await expectReachable(page);
    const box = await pop(page).boundingBox();
    const vw = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw.width);
    await page.getByTestId('tour-next').click();
  }
  await step(page, 'done');
  await page.getByTestId('tour-finish').click();

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

test('without the Learning Center open, existing work flows are unchanged', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Vintage radio', quantity: 2, cost: '15', asking: '45' });
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: 'Record your first sale' }).click();
  await recordSale(page, { item: 'Vintage radio', price: '45', fees: '5' });
  await expect(page.getByTestId('sales-net')).toContainText('$25.00');
  await expect(page.getByTestId('tour-popover')).toHaveCount(0);
  await expect(page.getByTestId('tour-mask')).toHaveCount(0);
});
