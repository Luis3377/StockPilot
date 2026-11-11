// Phase 2 trust & usability fixes: data safety, financial labels and periods, accessibility,
// zero-stock wording, long names and mobile layout.

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { addItem, isMobile, nav, noHorizontalOverflow, onboard, openItem, recordSale, solidPng, reloadWhenSaved } from './helpers';

const LONG_NAME = 'Stanley Quencher H2.0 FlowState Stainless Steel Vacuum Insulated Tumbler with Lid and Straw 40 oz Rose Quartz';

async function sell(page: Page, item: string, quantity = 1, price = '20') {
  await openItem(page, item);
  await page.getByRole('button', { name: 'Record sale' }).click();
  await recordSale(page, { item, quantity, price });
  await expect(page.getByTestId('sale-form')).toBeHidden();
}

// ---------------------------------------------------------------------------
// Priority 1 — protecting inventory data
// ---------------------------------------------------------------------------

test('onboarding explains where inventory is saved, what can delete it and how to protect it', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('radio', { name: 'Reseller Mode', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Where your inventory is saved' })).toBeVisible();
  await expect(page.getByTestId('storage-explainer')).toContainText('Only on this device, in this browser');
  const risks = page.getByTestId('data-risks');
  await expect(risks).toContainText('delete website data');
  await expect(risks).toContainText('different browser or a different phone or computer');
  await expect(page.getByText('Download a backup now and then')).toBeVisible();

  const advice = page.getByTestId('home-screen-advice');
  if (isMobile(page)) {
    // The phone project uses an iPhone browser identity: Home Screen advice is shown, without promises.
    await expect(risks).toContainText('Safari');
    await expect(advice).toContainText('Add StockPilot to your Home Screen first');
    await expect(advice).toContainText('It isn’t a guarantee');
    await expect(advice).toContainText('separate from Safari');
  } else {
    await expect(advice).toHaveCount(0);
  }
  await expect(page.locator('body')).not.toContainText(/permanent|never lose|guaranteed/i);
});

test('a backup reminder appears once there is inventory, and Back up now downloads a backup', async ({ page }) => {
  await onboard(page, 'Reseller');
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0); // nothing to protect yet
  await addItem(page, { name: 'Vintage camera', quantity: 1, cost: '40' });
  await nav(page, 'Overview');
  const reminder = page.getByTestId('backup-reminder');
  await expect(reminder).toContainText('Back up your inventory');
  await expect(reminder).toContainText('saved only in this browser on this device');
  const [download] = await Promise.all([page.waitForEvent('download'), reminder.getByRole('button', { name: 'Back up now' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^stockpilot-backup-.*\.json$/);
  await expect(reminder).toHaveCount(0);
  await nav(page, 'Settings');
  await expect(page.getByTestId('last-backup')).toContainText('(today) · up to date');
});

test('Remind me later hides the backup reminder, also after reloading', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Vintage camera', quantity: 1, cost: '40' });
  await nav(page, 'Overview');
  await page.getByTestId('backup-reminder').getByRole('button', { name: 'Remind me later' }).click();
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);
  await reloadWhenSaved(page);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByTestId('backup-reminder')).toHaveCount(0);
});

test('moving inventory: back up here, then restore from the welcome screen of a fresh browser or app', async ({ page, browser }) => {
  await onboard(page, 'Collector');
  await addItem(page, { name: 'Signed baseball', quantity: 1, cost: '75', photo: await solidPng(page, '#c44') });
  await nav(page, 'Settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const file = await download.path();

  // A fresh browser profile stands in for the Home Screen app / another browser: its storage is empty.
  const fresh = await browser.newContext({ viewport: page.viewportSize(), userAgent: await page.evaluate(() => navigator.userAgent), baseURL: 'http://localhost:4174/' });
  const other = await fresh.newPage();
  await other.goto('./');
  await other.getByTestId('onboarding-restore').getByRole('button', { name: 'Restore a backup' }).click();
  const dialog = other.getByTestId('restore-dialog');
  await dialog.getByTestId('restore-file').setInputFiles(file);
  await expect(dialog).toContainText('1 item');
  await expect(dialog).toContainText('1 photo');
  await dialog.getByRole('button', { name: 'Replace my data' }).click();
  await expect(other.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(other.getByText('Collector mode')).toBeVisible(); // settings came along
  await nav(other, 'Collection');
  await other.getByTestId('inventory-item').filter({ hasText: 'Signed baseball' }).click();
  await expect(other.getByRole('button', { name: 'Enlarge photo' })).toBeVisible();
  await nav(other, 'Settings');
  await expect(other.getByTestId('last-backup')).not.toContainText('never');
  await fresh.close();

  // The original is untouched.
  await nav(page, 'Collection');
  await expect(page.getByTestId('inventory-item')).toHaveCount(1);
});

test('Settings explains where data is saved, how to move it and what could delete it', async ({ page }) => {
  await onboard(page, 'Reseller');
  await nav(page, 'Settings');
  const safety = page.getByTestId('data-safety');
  await expect(safety).toContainText('Where your inventory is saved: only in this browser on this device');
  await expect(safety.getByTestId('last-backup')).toHaveText('never');
  await expect(safety.getByTestId('persist-status')).not.toBeEmpty();
  await safety.getByRole('button', { name: 'Moving to a new phone, another browser, or the Home Screen app' }).click();
  await expect(safety.getByTestId('move-data-steps')).toContainText('Download backup');
  await expect(safety.getByTestId('move-data-steps')).toContainText('Restore a backup');
  await safety.getByRole('button', { name: 'What could make my inventory disappear?' }).click();
  await expect(safety.getByTestId('data-risks')).toContainText('delete website data');
});

// ---------------------------------------------------------------------------
// Priorities 2 & 3 — financial labels, definitions and periods
// ---------------------------------------------------------------------------

test('every dashboard money figure is named, says when it applies, and can be explained', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Desk lamp', quantity: 4, cost: '10', asking: '25' });
  await nav(page, 'Overview');
  const cost = page.getByTestId('stat-inventory-cost');
  await expect(cost).toContainText('Inventory cost');
  await expect(cost).toContainText('Today');
  await expect(page.getByTestId('stat-inventory-cost-value')).toHaveText('$40.00');
  await expect(page.getByTestId('stat-inventory-cost-info')).toBeHidden();
  await cost.getByRole('button', { name: 'What is Inventory cost?' }).click();
  await expect(page.getByTestId('stat-inventory-cost-info')).toContainText('money you have invested in unsold inventory');

  await expect(page.getByTestId('stat-selling-value')).toContainText('Total asking price');
  await expect(page.getByTestId('stat-selling-value-value')).toHaveText('$100.00');
  await expect(page.getByTestId('stat-projected-profit')).toContainText('Projected profit');
  await expect(page.getByTestId('hero-profit')).toContainText('Realized profit this month');
  await expect(page.locator('body')).not.toContainText('Est. selling value');

  await page.getByTestId('definitions').locator('summary').click();
  await expect(page.getByTestId('definitions')).toContainText('Est. market value');

  // Cards and the item page label every price.
  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item').first()).toContainText('Asking $25.00');
  await openItem(page, 'Desk lamp');
  await expect(page.getByText('Est. market value', { exact: true })).toBeVisible();
  await expect(page.getByText('Your own estimate, per item')).toBeVisible();
  await expect(page.getByText('Your listed price, per item')).toBeVisible();
});

test('the assistant answers with the same figures and terms as the dashboard', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Desk lamp', quantity: 4, cost: '10', asking: '25' });
  await nav(page, 'Overview');
  const invested = await page.getByTestId('stat-inventory-cost-value').textContent();
  const asking = await page.getByTestId('stat-selling-value-value').textContent();
  await nav(page, 'Smart Insights');
  const assistant = page.getByTestId('assistant');
  await assistant.getByLabel('Ask a question').fill('How much money do I have invested in unsold inventory?');
  await assistant.getByRole('button', { name: 'Ask' }).click();
  await expect(assistant.getByTestId('assistant-answer').last()).toContainText(`You have ${invested} invested in unsold inventory. That's your inventory cost`);
  await assistant.getByLabel('Ask a question').fill('What is my inventory worth?');
  await assistant.getByRole('button', { name: 'Ask' }).click();
  const answer = assistant.getByTestId('assistant-answer').last();
  await expect(answer).toContainText(`you paid ${invested} for it (inventory cost)`);
  await expect(answer).toContainText(`it's listed for ${asking} (total asking price)`);
});

test('slow-moving amounts are labeled as inventory cost', async ({ page }) => {
  await onboard(page, 'Reseller', true);
  const slow = page.getByTestId('slow-movers');
  await expect(slow).toContainText('amounts are inventory cost (what you paid)');
  await expect(slow.getByText('inventory cost', { exact: true }).first()).toBeVisible();
  await expect(slow).toContainText(/asking \$[\d,.]+ each/);
});

test('Smart Insights uses the dashboard’s period, labels it, and shows the same margins', async ({ page }) => {
  await onboard(page, 'Reseller', true);
  await page.getByRole('radio', { name: 'Last 90 days' }).click();
  const categoryRow = page.getByText(/revenue · -?[\d.]+% margin/).first();
  const dashboardMargin = (await categoryRow.textContent())!.match(/(-?[\d.]+% margin)/)![1];

  await nav(page, 'Smart Insights');
  await expect(page.getByRole('radio', { name: 'Last 90 days' })).toHaveAttribute('aria-checked', 'true');
  const categories = page.getByTestId('insight-categories');
  await expect(categories.getByTestId('insight-period')).toHaveText('In the last 90 days');
  await expect(categories.locator('li').first()).toContainText(dashboardMargin);
  await expect(page.getByTestId('insight-slow-moving').getByTestId('insight-period')).toHaveText('Today');

  // Changing the period here changes it on the dashboard too.
  await page.getByRole('radio', { name: 'All time' }).click();
  await expect(categories.getByTestId('insight-period')).toHaveText('All time');
  await nav(page, 'Overview');
  await expect(page.getByRole('radio', { name: 'All time' })).toHaveAttribute('aria-checked', 'true');
});

// ---------------------------------------------------------------------------
// Priority 4 — accessibility
// ---------------------------------------------------------------------------

test('onboarding works with the keyboard alone, with visible focus', async ({ page }) => {
  test.skip(isMobile(page), 'keyboard navigation is checked on desktop');
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'How will you be using StockPilot?' })).toBeVisible(); // app loaded
  // One Tab stop for the whole mode group; arrows move and select.
  for (let i = 0; i < 10 && (await page.evaluate(() => document.activeElement?.getAttribute('role'))) !== 'radio'; i++) await page.keyboard.press('Tab');
  await expect(page.getByRole('radio', { name: 'Reseller Mode', exact: true })).toBeFocused();
  const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle);
  expect(outline).not.toBe('none');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Collector Mode', exact: true })).toBeFocused();
  await expect(page.getByRole('radio', { name: 'Collector Mode', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('radio', { name: 'Reseller Mode', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Where your inventory is saved' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Where your inventory is saved' })).toBeInViewport();
  const start = page.getByRole('button', { name: /^Start with my own inventory/ });
  for (let i = 0; i < 20 && !(await start.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  await expect(start).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('get-started')).toBeVisible();
});

test('no accessibility violations on onboarding and the main screens', async ({ page }) => {
  const check = async (where: string) => {
    await page.waitForTimeout(600); // let dialogs and toasts finish animating
    const { violations } = await new AxeBuilder({ page }).exclude('.animate-toast-in').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(violations.map((v) => `${where}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  };
  await page.goto('./');
  await check('onboarding step 1');
  await page.getByRole('radio', { name: 'Reseller Mode', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await check('onboarding step 2');
  await page.getByRole('button', { name: /^Start with my own inventory/ }).click();
  await check('empty overview');
  await addItem(page, { name: 'Desk lamp', quantity: 2, cost: '10', asking: '25' });
  await nav(page, 'Overview');
  await check('overview');
  await nav(page, 'Inventory');
  await check('inventory');
  await openItem(page, 'Desk lamp');
  await check('item page (no photo)');
  await nav(page, 'Smart Insights');
  await check('insights');
  await nav(page, 'Settings');
  await check('settings');
  await nav(page, 'Inventory');
  await page.getByRole('button', { name: /^Add item$/ }).first().click();
  await check('add item dialog');
});

// ---------------------------------------------------------------------------
// Priority 5 — zero-stock wording
// ---------------------------------------------------------------------------

test('quantity zero is always "Out of stock", with or without a low-stock alert', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'One-off jacket', quantity: 1, cost: '10' });
  await addItem(page, { name: 'Restockable candle', quantity: 1, cost: '3', lowStockAt: 1 });
  await sell(page, 'One-off jacket');
  await sell(page, 'Restockable candle', 1, '9');
  await nav(page, 'Inventory');
  for (const name of ['One-off jacket', 'Restockable candle']) {
    await expect(page.getByTestId('inventory-item').filter({ hasText: name })).toContainText('Out of stock');
  }
  await expect(page.locator('body')).not.toContainText(/sold out/i);
  await page.getByLabel('Status').selectOption('out');
  await expect(page.getByTestId('inventory-item')).toHaveCount(2);
});

// ---------------------------------------------------------------------------
// Priorities 6 & 7 — long names and mobile layout
// ---------------------------------------------------------------------------

test('long item names wrap on cards, keep the full name available, and never overflow', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: LONG_NAME, quantity: 1, cost: '20', asking: '45' });
  await nav(page, 'Inventory');
  const name = page.getByTestId('inventory-item-name');
  await expect(name).toHaveAttribute('title', LONG_NAME);
  await expect(name).toHaveText(LONG_NAME);
  const fits = await name.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  await noHorizontalOverflow(page);
  await name.click();
  await expect(page.getByTestId('item-title')).toHaveText(LONG_NAME);
  const titleFits = await page.getByTestId('item-title').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  expect(titleFits).toBe(true);
  await noHorizontalOverflow(page);
});

test('form fields use at least 16px text on phones, so iPhone Safari does not zoom in', async ({ page }) => {
  test.skip(!isMobile(page), 'phone layout only');
  await onboard(page, 'Reseller');
  const tooSmall = async () =>
    page.evaluate(() =>
      [...document.querySelectorAll('input, select, textarea')]
        .filter((el) => (el as HTMLInputElement).type !== 'file' && (el as HTMLInputElement).type !== 'checkbox' && el.getBoundingClientRect().width > 2)
        .map((el) => ({ name: el.getAttribute('aria-label') ?? el.id, size: parseFloat(getComputedStyle(el).fontSize) }))
        .filter((f) => f.size < 16),
    );
  await nav(page, 'Inventory');
  expect(await tooSmall()).toEqual([]);
  await page.getByRole('button', { name: /^Add (item|your first item)$/ }).first().click();
  await page.getByTestId('item-form').getByRole('button', { name: /More details/ }).click();
  expect(await tooSmall()).toEqual([]);
  await page.getByTestId('item-form').getByRole('button', { name: 'Cancel' }).click();
  await nav(page, 'Smart Insights');
  expect(await tooSmall()).toEqual([]);
  await nav(page, 'Settings');
  expect(await tooSmall()).toEqual([]);
});
