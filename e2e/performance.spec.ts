// Predicted vs. actual: a lot planned with the Max Bid Calculator, bought, sold and written off
// through the app, compared with its frozen estimate; history and suggestions from past lots.

import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { nav, noHorizontalOverflow, onboard, openItem, recordSale, reloadWhenSaved } from './helpers';
import { createBidPlan, defaultAssumptions, lotPrefillFromPlan, recordBidPurchase } from '../src/domain/bids';
import { adjustQuantity, recordSale as recordSaleData } from '../src/domain/actions';
import { createBackup } from '../src/data/backup';
import { defaultSettings, emptyData, type AppData } from '../src/domain/types';

const ITEMS: [string, string, string][] = [
  ['Cast iron pan', '4', '100'],
  ['Stand mixer', '2', '200'],
  ['Coffee mug set', '10', '20'],
];

/** Plans "Estate lot" ($1,000 of estimates → max bid $340), buys it for $300 and opens the lot page. */
async function planAndBuy(page: Page) {
  await nav(page, 'Inventory');
  await page.getByTestId('bids-link').click();
  await page.getByTestId('bid-new').first().click();
  await page.getByLabel('Lot name').fill('Estate lot');
  await page.getByLabel('Type of purchase').selectOption('estate_sale');
  await page.getByRole('radio', { name: 'Item by item' }).click();
  for (const [name, qty, value] of ITEMS) {
    await page.getByTestId('bid-add-item').click();
    const it = page.getByTestId('bid-item').last();
    await it.getByLabel('Item name').fill(name);
    await it.getByRole('textbox', { name: 'Quantity', exact: true }).fill(qty);
    await it.getByTestId('bid-item-value').fill(value);
  }
  await expect(page.getByTestId('bid-max')).toHaveText('$340.00');
  await page.getByTestId('bid-save').click();
  await expect(page.getByText('Saved as a draft plan.')).toBeVisible();
  await page.getByTestId('bid-bought').click();
  await page.getByTestId('bid-purchase-price').fill('300');
  await page.getByTestId('bid-purchase-next').click();
  const lotForm = page.getByTestId('lot-dialog');
  await lotForm.getByTestId('lot-next').click();
  await lotForm.getByTestId('lot-next').click();
  await lotForm.getByTestId('lot-save').click();
  await expect(lotForm).toBeHidden();
  await expect(page).toHaveURL(/#\/inventory\/lots\/[\w-]+$/);
}

async function sell(page: Page, item: string, quantity: number, price: string, fees: string, shipping?: string) {
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: /^Record (sale|your first sale)$/ }).first().click();
  await recordSale(page, { item, quantity, price, fees, shipping, platform: 'eBay' });
  await expect(page.getByTestId('sale-form')).toBeHidden();
}

async function openPerformance(page: Page) {
  await nav(page, 'Inventory');
  await page.getByTestId('lots-link').click();
  await page.getByTestId('lot-card').filter({ hasText: 'Estate lot' }).click();
  await page.getByTestId('lot-performance-link').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Performance: Estate lot');
}

const row = (page: Page, key: string) => page.getByTestId(`perf-row-${key}`);

test('a completed lot: the original estimate against recorded results, with every difference explained', async ({ page }) => {
  await onboard(page, 'Reseller');
  await planAndBuy(page);
  await sell(page, 'Cast iron pan', 4, '90', '54', '20');
  await sell(page, 'Stand mixer', 2, '190', '57', '14');
  await openItem(page, 'Coffee mug set');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Adjust quantity' }).click();
  const stock = page.getByTestId('stock-dialog');
  await stock.getByLabel('Quantity you actually have').fill('0');
  await stock.getByLabel('Reason').selectOption('Damaged');
  await stock.getByRole('button', { name: 'Save quantity' }).click();
  await expect(page.getByTestId('item-quantity')).toHaveText('0');

  await openPerformance(page);
  await expect(page.getByTestId('perf-stage-note')).toContainText('This lot is closed: 6 units sold, 10 written off. These are final results.');
  await expect(row(page, 'net')).toContainText('$680.00');
  await expect(row(page, 'net').getByTestId('perf-actual')).toContainText('$595.00');
  await expect(row(page, 'net').getByTestId('perf-diff')).toContainText('−$85.00');
  await expect(row(page, 'net').getByTestId('perf-diff')).toContainText('−12.5%');
  await expect(row(page, 'acquisition').getByTestId('perf-diff')).toContainText('−$40.00');
  await expect(row(page, 'roi')).toContainText('100%');
  await expect(row(page, 'roi').getByTestId('perf-actual')).toContainText('98.33%');
  await expect(row(page, 'roi').getByTestId('perf-diff')).toContainText('−1.67 pts');
  await expect(row(page, 'sellThrough').getByTestId('perf-diff')).toContainText('0 pts');

  // The calculation behind a row.
  await row(page, 'net').getByRole('button', { name: 'Net proceeds' }).click();
  await expect(row(page, 'net').getByTestId('perf-row-detail')).toContainText('Forecast error = (actual − predicted) ÷ predicted = −12.5%.');

  // Why: the factors add up from the predicted $340 to the actual $295.
  const factors = page.getByTestId('perf-factor');
  await expect(factors).toHaveCount(5);
  await expect(factors.nth(0)).toContainText(/Paid less than planned\s*\+\$40\.00/);
  await expect(factors.nth(1)).toContainText(/Sold for less than estimated\s*−\$60\.00/);
  await expect(factors.nth(4)).toContainText(/Higher shipping than expected\s*−\$34\.00/);
  await expect(page.getByTestId('perf-why-end')).toContainText('$295.00');

  // What was believed at purchase, unchanged; and the records behind the actuals.
  const original = page.getByTestId('perf-original');
  await expect(original).toContainText(/Max bid \(expected\)\s*\$340\.00/);
  await expect(original).toContainText(/Price you paid\s*\$300\.00/);
  await expect(page.getByTestId('perf-source-sale')).toHaveCount(2);
  await expect(page.getByTestId('perf-source-writeoff')).toContainText('10 written off');
  await noHorizontalOverflow(page);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
});

test('a partly sold lot is compared through a projection, and closing it never writes stock off', async ({ page }) => {
  await onboard(page, 'Reseller');
  await planAndBuy(page);
  await sell(page, 'Cast iron pan', 4, '90', '54', '20');
  await openPerformance(page);

  await expect(page.getByTestId('perf-stage-note')).toContainText('Still selling: 4 of 16 units sold.');
  await expect(page.getByTestId('perf-stage-note')).toContainText('$14.00 of what you paid isn’t recovered yet.');
  await expect(row(page, 'net').getByTestId('perf-actual')).toContainText('$286.00');
  await expect(row(page, 'net').getByTestId('perf-projected')).toContainText('$694.00 projected');
  await expect(row(page, 'net').getByTestId('perf-diff')).toContainText('+$14.00');
  await expect(page.getByTestId('perf-why')).toHaveCount(0);
  await expect(page.getByTestId('perf-realized')).toContainText('$166.00');
  await expect(page.getByTestId('perf-unrecovered')).toContainText('$14.00');
  await expect(page.getByTestId('perf-remaining')).toContainText('$408.00');
  await expect(page.getByTestId('perf-sold-prices')).toContainText('What has sold brought $360.00; at the plan’s prices it would have brought $400.00 (−10%)');
  await noHorizontalOverflow(page);

  // Closing needs the remaining stock acknowledged, and keeps it.
  await page.getByTestId('perf-close').click();
  const dialog = page.getByTestId('perf-close-dialog');
  await expect(dialog).toContainText('12 units are still in stock ($180.00 at cost). Closing never writes them off.');
  await expect(dialog.getByTestId('perf-close-confirm')).toBeDisabled();
  await dialog.getByTestId('perf-close-keep').check();
  await dialog.getByTestId('perf-close-confirm').click();
  await expect(page.getByTestId('perf-stage-note')).toContainText('12 kept in stock and counted as unsold. These are final results.');
  await expect(row(page, 'net').getByTestId('perf-diff')).toContainText('−$394.00');
  await reloadWhenSaved(page);
  await expect(page.getByTestId('perf-warnings')).toContainText('Closed with 12 units still in stock ($180.00 at cost).');
  await page.getByTestId('perf-reopen').click();
  await expect(page.getByTestId('perf-stage-note')).toContainText('Still selling');
  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item').filter({ hasText: 'Coffee mug set' })).toContainText('10');
});

/** Four completed pallet lots that sold at 88% of the plans' prices, and one still selling. */
function seededBackup(): string {
  let data: AppData = emptyData();
  const settings = { ...defaultSettings(), onboarded: true };
  const lot = (name: string, factor: number, finish: boolean) => {
    const a = {
      ...defaultAssumptions(),
      valueMode: 'items' as const,
      items: [
        { id: `${name}-a`, name: `${name} radio`, quantity: 4, unitValue: 100, category: 'Electronics', condition: '', notes: '', aiFields: [] },
        { id: `${name}-b`, name: `${name} speaker`, quantity: 2, unitValue: 200, category: 'Electronics', condition: '', notes: '', aiFields: [] },
        { id: `${name}-c`, name: `${name} cables`, quantity: 10, unitValue: 20, category: 'Electronics', condition: '', notes: '', aiFields: [] },
      ],
    };
    const p = createBidPlan(data, { name, description: '', kind: 'pallet', assumptions: a });
    const { input, lineBidItemIds } = lotPrefillFromPlan(p.plan, 300, '2026-08-01');
    const bought = recordBidPurchase(p.data, p.plan.id, input, lineBidItemIds);
    data = bought.data;
    const [A, B, C] = bought.items;
    for (const [it, q] of [
      [A, 4],
      [B, 2],
    ] as const) {
      const total = Math.round(it.estimatedValue! * q * factor * 100) / 100;
      data = recordSaleData(data, { itemId: it.id, quantity: q, salePrice: total, priceMode: 'total', fees: Math.round(total * 15) / 100, saleDate: '2026-09-15', platform: 'eBay' }).data;
      if (!finish) break;
    }
    if (finish) data = adjustQuantity(data, C.id, 0, 'Unsellable').data;
  };
  for (const n of ['Pallet 1', 'Pallet 2', 'Pallet 3', 'Pallet 4']) lot(n, 0.88, true);
  lot('Pallet 5', 0.9, false);
  return JSON.stringify(createBackup('real', settings, data, []));
}

test('history across lots, and a suggested expected scenario the user can apply or undo', async ({ page }, testInfo) => {
  await onboard(page, 'Reseller');
  const file = testInfo.outputPath('seed-backup.json');
  writeFileSync(file, seededBackup());
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  const restore = page.getByTestId('restore-dialog');
  await restore.getByTestId('restore-file').setInputFiles(file);
  await restore.getByRole('button', { name: 'Replace my data' }).click();
  await expect(restore).toBeHidden();

  await page.goto('./#/inventory/lots');
  await page.getByTestId('lots-performance-link').click();
  await expect(page.getByTestId('history-completed')).toContainText('4');
  await expect(page.getByTestId('history-completed')).toContainText('1 still selling (not counted)');
  await expect(page.getByTestId('history-error')).toContainText('−12%');
  await expect(page.getByTestId('history-roi')).toContainText('99.47%'); // (4 × $598.40 − $1,200) ÷ $1,200
  await expect(page.getByTestId('history-by-type')).toContainText('Liquidation pallet');
  await expect(page.getByTestId('history-by-category')).toContainText('Electronics');
  await expect(page.getByTestId('history-lot')).toHaveCount(5);
  await page.getByLabel('Bought from').fill('2027-01-01');
  await expect(page.getByTestId('history-lot')).toHaveCount(0);
  await page.getByLabel('Bought from').fill('');
  await noHorizontalOverflow(page);
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);

  // A new pallet plan: the suggestion shows its evidence, and changes nothing until applied.
  await page.goto('./#/inventory/bids/new');
  await page.getByLabel('Lot name').fill('Pallet 6');
  await page.getByLabel('Type of purchase').selectOption('pallet');
  await page.getByTestId('bid-total-value').fill('1000');
  await expect(page.getByTestId('bid-max')).toHaveText('$340.00');
  const learn = page.getByTestId('bid-learn');
  await expect(learn).toContainText('Your 4 completed lots of this type (liquidation pallet) brought net proceeds averaging 12% below your original predictions.');
  await expect(learn.getByTestId('bid-learn-resalePct')).toContainText(/100%\s*88%\s*93\.1%/);
  await expect(learn.getByTestId('bid-learn-effect')).toContainText('Max bid estimate with these values: $316.54 (now $340.00).');
  await learn.getByText('How this was calculated (4 lots)').click();
  await expect(learn.getByTestId('bid-learn-lots').getByRole('link')).toHaveCount(4);
  await learn.getByTestId('bid-learn-apply').click();
  await expect(page.getByTestId('bid-scenario-expected').getByLabel('Resale value')).toHaveValue('93.1');
  await expect(page.getByTestId('bid-max')).toHaveText('$316.54');
  await expect(learn.getByTestId('bid-learn-applied')).toContainText('resale 100% → 93.1%');
  await learn.getByTestId('bid-learn-undo').click();
  await expect(page.getByTestId('bid-scenario-expected').getByLabel('Resale value')).toHaveValue('100');
  await expect(page.getByTestId('bid-max')).toHaveText('$340.00');
  await learn.getByTestId('bid-learn-apply').click();
  await page.getByTestId('bid-save').click();
  await reloadWhenSaved(page);
  await expect(page.getByTestId('bid-learn-applied')).toContainText('Adjusted from 4 completed lots of this type (liquidation pallet)');
  await expect(page.getByTestId('bid-max')).toHaveText('$316.54');
  await noHorizontalOverflow(page);

  // The assistant answers from the same figures.
  await nav(page, 'Smart Insights');
  const assistant = page.getByTestId('assistant');
  await assistant.getByLabel('Ask a question').fill('How accurate have my predictions been?');
  await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
  const answer = assistant.getByTestId('assistant-answer').last();
  await expect(answer).toContainText('Across 4 completed lots you planned, net proceeds were $2,393.60 against $2,720.00 predicted: 12% below (−$326.40).');
  await expect(answer.getByTestId('calculation-lines')).toContainText(/Less than predicted\s*−\$326\.40/);
});
