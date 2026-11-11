// Max Bid Calculator: the estimate, scenarios, saved plans, turning a plan into a bulk lot once,
// and backups. The AI build's scanner is mocked; nothing reaches a real AI service.

import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addItem, nav, noHorizontalOverflow, onboard, reloadWhenSaved, solidPng } from './helpers';

async function newPlan(page: Page, name: string) {
  await nav(page, 'Inventory');
  await page.getByTestId('bids-link').click();
  await expect(page.getByRole('heading', { name: 'Max bid calculator' })).toBeVisible();
  await page.getByTestId('bid-new').first().click();
  await page.getByLabel('Lot name').fill(name);
}

const results = (page: Page) => page.getByTestId('bid-results');
const maxBid = (page: Page) => page.getByTestId('bid-max');

test('the $1,000 example: $340 max bid, scenarios, buying costs, budget and a planned bid', async ({ page }) => {
  await onboard(page, 'Reseller');
  await newPlan(page, 'Storage unit B-14');
  await expect(results(page)).toContainText('Enter your estimated total resale value for the lot.');

  await page.getByTestId('bid-total-value').fill('1000');
  await expect(maxBid(page)).toHaveText('$340.00');
  await expect(page.getByTestId('bid-breakdown')).toContainText(/Expected sale proceeds\s*\$800\.00/);
  await expect(page.getByTestId('bid-net')).toContainText('$680.00');
  await expect(page.getByTestId('bid-max-all-in')).toContainText('$340.00');
  await expect(page.getByTestId('bid-row-max-bid')).toContainText(/\$229\.60\s*\$340\.00\s*\$420\.75/);
  await expect(page.getByTestId('bid-drivers')).toContainText('A 100% target return means spending at most $680.00 ÷ 2 = $340.00 in total.');
  await expect(results(page)).toContainText('not a guaranteed profitable price');
  await noHorizontalOverflow(page);
  if ((page.viewportSize()?.width ?? 1000) < 1024) {
    // On phones a summary at the top jumps to the result (without leaving the page).
    await expect(page.getByTestId('bid-mobile-summary')).toContainText('$340.00');
    await page.getByTestId('bid-mobile-summary').click();
    await expect(results(page)).toBeInViewport();
    await expect(page).toHaveURL(/#\/inventory\/bids\/new$/);
  }

  // Target return
  await page.getByTestId('bid-roi').fill('50');
  await expect(maxBid(page)).toHaveText('$453.33');
  await page.getByTestId('bid-roi').fill('100');

  // Buyer's premium and a fixed cost lower the bid; the all-in cost stays at $340.
  await page.getByTestId('bid-premium').fill('10');
  await page.getByTestId('bid-add-fixed').click();
  await page.getByTestId('bid-fixed-cost').getByRole('textbox').first().fill('Truck rental');
  await page.getByTestId('bid-fixed-cost').getByRole('textbox').nth(1).fill('40');
  await expect(maxBid(page)).toHaveText('$272.73');
  await expect(page.getByTestId('bid-breakdown')).toContainText(/All-in cost at this bid\s*\$340\.00/);

  // Budget and a planned bid
  await page.getByTestId('bid-budget').fill('250');
  await expect(page.getByTestId('bid-budget-limited')).toContainText('Your budget of $250.00 allows a bid of up to $190.91');
  await page.getByTestId('bid-planned-input').fill('300');
  await expect(page.getByTestId('bid-planned')).toContainText('Your planned bid of $300.00 is $109.09 above the bid your budget allows.');
  await expect(page.getByTestId('bid-planned')).toContainText('All-in: $370.00 ($300.00 bid + $30.00 premium + $40.00 fixed costs). Budget: $250.00, which it exceeds.');

  // Scenarios are editable and the comparison updates.
  await page.getByTestId('bid-scenario-optimistic').getByLabel('Unsold').fill('0');
  await expect(page.getByTestId('bid-row-unsold')).toContainText(/30%\s*20%\s*0%/);

  // Nothing financially sensible: say so instead of recommending.
  await page.getByTestId('bid-fees').fill('100');
  await expect(page.getByTestId('bid-no-bid')).toContainText('Selling costs ($800.00) would use up all of the expected sales ($800.00)');
  await page.getByTestId('bid-fees').fill('abc');
  await expect(page.getByTestId('bid-form')).toContainText('Enter a percentage like 15');

  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
});

test('plans are saved as drafts, reopened, edited, duplicated and marked lost, without touching inventory', async ({ page }) => {
  await onboard(page, 'Reseller');
  await newPlan(page, 'Liquidation pallet 7');
  await page.getByLabel('Type of purchase').selectOption('pallet');
  await page.getByTestId('bid-total-value').fill('1000');
  await page.getByTestId('bid-save').click();
  await expect(page.getByText('Saved as a draft plan. Nothing was added to your inventory.')).toBeVisible();
  await expect(page).toHaveURL(/#\/inventory\/bids\/[\w-]+$/);

  await reloadWhenSaved(page);
  await expect(page.getByTestId('bid-total-value')).toHaveValue('1000');
  await page.getByTestId('bid-total-value').fill('1200');
  await expect(page.getByTestId('bid-unsaved')).toBeVisible();
  await expect(page.getByTestId('bid-bought')).toBeDisabled();
  await page.getByTestId('bid-save').click();
  await expect(maxBid(page)).toHaveText('$408.00');
  await expect(page.getByTestId('bid-unsaved')).toBeHidden();

  await page.getByTestId('bid-duplicate').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Liquidation pallet 7 (copy)');
  await page.getByTestId('bid-total-value').fill('900');
  await page.getByTestId('bid-save').click();

  await page.getByRole('link', { name: 'Max bid plans' }).click();
  const cards = page.getByTestId('bid-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: 'Liquidation pallet 7 (copy)' })).toContainText('$306.00');
  await cards.filter({ hasNotText: '(copy)' }).click();
  await expect(maxBid(page)).toHaveText('$408.00');

  await page.getByTestId('bid-lost').click();
  await page.getByLabel('Note (optional)').fill('Went for $520');
  await page.getByTestId('bid-decision-save').click();
  await expect(page.getByTestId('bid-history')).toContainText('Planning → Lost · Went for $520');
  await expect(page.getByTestId('bid-total-value')).toBeDisabled();
  await page.getByTestId('bid-reopen').click();
  await expect(page.getByTestId('bid-total-value')).toBeEnabled();

  await page.getByRole('link', { name: 'Max bid plans' }).click();
  await page.getByRole('radio', { name: /Planning/ }).click();
  await expect(page.getByTestId('bid-card')).toHaveCount(2);

  // Planning data never becomes inventory by itself.
  await nav(page, 'Inventory');
  await expect(page.getByText('No inventory yet')).toBeVisible();
  await noHorizontalOverflow(page);
});

test('buying a planned lot creates the bulk lot once and keeps the original estimate', async ({ page }) => {
  await onboard(page, 'Reseller');
  await newPlan(page, 'Estate sale box');
  await page.getByLabel('Type of purchase').selectOption('estate_sale');
  await page.getByRole('radio', { name: 'Item by item' }).click();
  for (const [name, qty, value] of [
    ['Cast iron pan', '4', '30'],
    ['Stand mixer', '1', '150'],
  ] as const) {
    await page.getByTestId('bid-add-item').click();
    const it = page.getByTestId('bid-item').last();
    await it.getByLabel('Item name').fill(name);
    await it.getByRole('textbox', { name: 'Quantity', exact: true }).fill(qty);
    await it.getByTestId('bid-item-value').fill(value);
  }
  await expect(page.getByTestId('bid-items-total')).toContainText('$270.00');
  await page.getByTestId('bid-premium').fill('10');
  await expect(maxBid(page)).toHaveText('$83.45'); // 270 × .8 × .85 = 183.60 ÷ 2 = 91.80 ÷ 1.1
  await page.getByTestId('bid-save').click();
  await expect(page.getByText('Saved as a draft plan.')).toBeVisible();

  await page.getByTestId('bid-bought').click();
  const buy = page.getByTestId('bid-purchase-dialog');
  await buy.getByTestId('bid-purchase-price').fill('80');
  await expect(buy.getByTestId('bid-purchase-summary')).toContainText(/Buyer’s premium \(10%\)\s*\+ \$8\.00/);
  await expect(buy.getByTestId('bid-purchase-summary')).toContainText(/Total cost of the lot\s*\$88\.00/);
  await expect(buy.getByTestId('bid-purchase-compare')).toContainText('$3.45 below your maximum bid estimate of $83.45.');
  await buy.getByTestId('bid-purchase-next').click();

  const lotForm = page.getByTestId('lot-dialog');
  await expect(lotForm.getByTestId('lot-from-bid')).toContainText('Started from your Max Bid plan “Estate sale box”');
  await expect(lotForm.getByLabel('Lot name')).toHaveValue('Estate sale box');
  await expect(lotForm.getByLabel('Total purchase price')).toHaveValue('80');
  await lotForm.getByTestId('lot-next').click();
  await expect(lotForm.getByTestId('lot-line')).toHaveCount(2);
  await expect(lotForm.getByTestId('lot-line').first().getByLabel('Item name')).toHaveValue('Cast iron pan');
  await lotForm.getByTestId('lot-next').click();
  await expect(lotForm.getByTestId('split-check')).toHaveAttribute('data-balanced', 'true');
  await lotForm.getByTestId('lot-save').click();
  await expect(lotForm).toBeHidden();

  // The lot page links back to the original estimate.
  await expect(page).toHaveURL(/#\/inventory\/lots\/[\w-]+$/);
  await expect(page.getByTestId('lot-stat-total')).toContainText('$88.00');
  const card = page.getByTestId('lot-bid-plan');
  await expect(card).toContainText(/Max bid estimate \(expected\)\s*\$83\.45/);
  await expect(card).toContainText(/Paid\s*\$80\.00/);
  await card.getByRole('link', { name: 'Open plan →' }).click();

  const purchased = page.getByTestId('bid-purchased');
  await expect(purchased).toContainText(/Price paid\s*\$80\.00/);
  await expect(purchased).toContainText(/Total cost\s*\$88\.00/);
  await expect(page.getByTestId('bid-paid-vs-max')).toContainText(/Paid below the recommendation by\s*\$3\.45/);
  await expect(results(page)).toContainText('Original estimate');
  await expect(maxBid(page)).toHaveText('$83.45');
  // The estimate can't be changed, and the purchase can't be recorded again.
  await expect(page.getByTestId('bid-item-value').first()).toBeDisabled();
  await expect(page.getByTestId('bid-bought')).toHaveCount(0);
  await expect(page.getByTestId('bid-save')).toHaveCount(0);
  await noHorizontalOverflow(page);

  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item')).toHaveCount(2);
});

test('a lot already added by hand is linked instead of being added twice', async ({ page }) => {
  await onboard(page, 'Reseller');
  await nav(page, 'Inventory');
  await page.getByRole('button', { name: 'Add bulk lot' }).first().click();
  const lotForm = page.getByTestId('lot-dialog');
  await lotForm.getByLabel('Lot name').fill('Garage sale bundle');
  await lotForm.getByLabel('Total purchase price').fill('40');
  await lotForm.getByTestId('lot-next').click();
  await lotForm.getByTestId('lot-line').first().getByLabel('Item name').fill('Toolbox');
  await lotForm.getByTestId('lot-next').click();
  await lotForm.getByRole('radio', { name: /Equally per unit/ }).click();
  await lotForm.getByTestId('lot-save').click();
  await expect(lotForm).toBeHidden();

  await newPlan(page, 'Garage sale bundle');
  await page.getByTestId('bid-total-value').fill('200');
  await page.getByTestId('bid-save').click();
  await page.getByTestId('bid-bought').click();
  const buy = page.getByTestId('bid-purchase-dialog');
  await expect(buy.getByTestId('bid-purchase-similar')).toContainText('You have a lot named “Garage sale bundle”');
  await buy.getByRole('button', { name: 'Link to this lot' }).click();
  await expect(page.getByText('Nothing new was added to inventory.')).toBeVisible();
  await expect(page.getByTestId('bid-purchased')).toContainText('by linking a lot you had already added');
  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item')).toHaveCount(1);
});

test('bid plans survive backup and restore', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Existing item', quantity: 1, cost: '5' });
  await newPlan(page, 'Collectibles lot');
  await page.getByTestId('bid-total-value').fill('1000');
  await page.getByTestId('bid-save').click();
  await expect(page.getByText('Saved as a draft plan.')).toBeVisible();

  await nav(page, 'Settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const file = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(file.data.bidPlans).toHaveLength(1);
  expect(file.data.bidPlans[0]).toMatchObject({ name: 'Collectibles lot', status: 'draft', assumptions: { totalResaleValue: 1000 } });

  await page.getByRole('button', { name: 'Erase all data' }).click();
  const confirm = page.getByTestId('confirm-dialog');
  await confirm.getByRole('textbox').fill('DELETE');
  await confirm.getByRole('button', { name: 'Erase everything' }).click();
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  const dialog = page.getByTestId('restore-dialog');
  await dialog.getByTestId('restore-file').setInputFiles(await download.path());
  await dialog.getByRole('button', { name: 'Replace my data' }).click();
  await expect(dialog).toBeHidden();
  await page.goto('./#/inventory/bids');
  await page.getByTestId('bid-card').click();
  await expect(maxBid(page)).toHaveText('$340.00');
});

// ---------------------------------------------------------------------------
// AI build: the scanner identifies an item in a plan; it never prices it.
// ---------------------------------------------------------------------------

test.describe('AI build (mocked scanner)', () => {
  const SCAN_APP = 'http://localhost:4175/';
  test.use({ baseURL: SCAN_APP });

  test('identifying an item fills its details, never its resale estimate', async ({ page }) => {
    const scans: unknown[] = [];
    await page.route('http://scan.test/**', async (route: Route) => {
      const cors = { 'access-control-allow-origin': new URL(SCAN_APP).origin, 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      scans.push(route.request().url());
      await route.fulfill({
        status: 200,
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          result: { status: 'identified', name: 'KitchenAid Artisan Stand Mixer', brand: 'KitchenAid', model: 'KSM150', category: 'Kitchen', description: 'Tilt-head stand mixer.', condition: 'good', condition_notes: null, confidence: 'high', notes: null },
          model: { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
          scansLeftToday: 19,
        }),
      });
    });
    await onboard(page, 'Reseller');
    await page.evaluate(() => localStorage.setItem('stockpilot-scan-invite-code', 'SP-TEST1-TEST2-TEST3-TEST4'));
    await newPlan(page, 'Kitchen auction');
    await page.getByRole('radio', { name: 'Item by item' }).click();
    await page.getByTestId('bid-add-item').click();
    const it = page.getByTestId('bid-item');
    await it.getByRole('button', { name: 'Identify with AI' }).click();
    await expect(it.getByTestId('bid-scan-note')).toContainText('Identifying an item doesn’t tell you what it will sell for.');
    await it.getByTestId('scan-upload-input').setInputFiles({ name: 'mixer.png', mimeType: 'image/png', buffer: await solidPng(page, '#c0392b') });
    await it.getByRole('button', { name: 'Analyze photo' }).click();
    await expect(it.getByLabel(/Item name/)).toHaveValue('KitchenAid Artisan Stand Mixer');
    await expect(it.getByTestId('ai-filled')).toBeVisible();
    await expect(it.getByTestId('bid-item-value')).toHaveValue('');
    await expect(results(page)).toContainText('Enter your resale estimate for one of these.');
    expect(scans).toHaveLength(1);
    await it.getByTestId('bid-item-value').fill('120');
    await expect(maxBid(page)).toHaveText('$40.80');
    await expect(page.getByTestId('bid-warnings')).toContainText('Some item details came from the AI scanner. It identifies items only: the resale estimates are yours.');
    await noHorizontalOverflow(page);
  });
});
