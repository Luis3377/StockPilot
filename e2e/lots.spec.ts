// Bulk lots (Signature Feature 1): buy several items for one price, split the cost across them,
// and check that every cent stays accounted for through sales, edits, reloads and backups.

import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { nav, noHorizontalOverflow, onboard, recordSale, reloadWhenSaved, solidPng } from './helpers';

interface LotLine {
  name: string;
  quantity?: number;
  estimate?: string;
}

interface NewLot {
  name: string;
  price: string;
  extras?: [string, string][];
  source?: string;
  lines: LotLine[];
}

/** Fills steps 1 and 2 of Add bulk lot and stops on the review step. */
async function startLot(page: Page, lot: NewLot): Promise<Locator> {
  await nav(page, 'Inventory');
  await page.getByRole('button', { name: 'Add bulk lot' }).first().click();
  const d = page.getByTestId('lot-dialog');
  await expect(d).toBeVisible();
  await d.getByLabel('Lot name').fill(lot.name);
  await d.getByLabel('Total purchase price').fill(lot.price);
  for (const [i, [label, amount]] of (lot.extras ?? []).entries()) {
    await d.getByRole('button', { name: 'Add a cost' }).click();
    await d.getByLabel(`Cost ${i + 1} name`).fill(label);
    await d.getByLabel(`Cost ${i + 1} amount`).fill(amount);
  }
  if (lot.source) await d.getByLabel('Where you bought it').fill(lot.source);
  await d.getByTestId('lot-next').click();
  await expect(d.getByTestId('lot-step-items')).toBeVisible();
  for (const [i, line] of lot.lines.entries()) {
    if (i > 0) await d.getByTestId('lot-add-line').click();
    const row = d.getByTestId('lot-line').nth(i);
    await row.getByLabel('Item name').fill(line.name);
    await row.getByRole('textbox', { name: 'Quantity', exact: true }).fill(String(line.quantity ?? 1));
    if (line.estimate !== undefined) await row.getByLabel('Est. resale value, per item').fill(line.estimate);
  }
  await d.getByTestId('lot-next').click();
  await expect(d.getByTestId('lot-step-review')).toBeVisible();
  return d;
}

async function saveLot(page: Page, d: Locator) {
  await d.getByTestId('lot-save').click();
  await expect(d).toBeHidden();
  await expect(page).toHaveURL(/#\/inventory\/lots\//);
}

const lineCosts = (d: Locator) => d.getByTestId('lot-line-cost').allInnerTexts();

const ESTATE: NewLot = {
  name: 'Estate sale box',
  price: '90',
  extras: [
    ['Shipping / freight', '7.50'],
    ['Buyer’s premium', '2.50'],
  ],
  source: 'Estate sale',
  lines: [
    { name: 'Nike sneakers', estimate: '100' },
    { name: 'Sony headphones', estimate: '60' },
    { name: 'Denim jacket', estimate: '40' },
  ],
};

/** Opens an item from the lot page and records a sale of it. */
async function sellFromLot(page: Page, item: string, sale: { quantity?: number; price: string; fees?: string }) {
  await page.getByTestId('lot-item').getByRole('link', { name: item }).click();
  await expect(page.getByTestId('item-title')).toHaveText(item);
  await page.getByRole('button', { name: 'Record sale' }).click();
  await recordSale(page, { item, ...sale });
  await expect(page.getByTestId('sale-form')).toBeHidden();
  await page.getByTestId('item-lot-link').getByRole('link').click();
  await expect(page.getByTestId('lot-reconciliation')).toBeVisible();
}

test('splits a lot by estimated resale value, with additional costs, and every cent assigned', async ({ page }) => {
  await onboard(page, 'Reseller');
  const d = await startLot(page, ESTATE);

  // $90 + $7.50 + $2.50 = $100 split 100 : 60 : 40.
  expect(await lineCosts(d)).toEqual(['$50.00', '$30.00', '$20.00']);
  await expect(d.getByTestId('lot-review-line').first()).toContainText('50.0% of the cost');
  await expect(d.getByTestId('split-check')).toHaveAttribute('data-balanced', 'true');
  await expect(d.getByTestId('split-check')).toContainText('$100.00 of $100.00 split');
  await expect(d.getByTestId('lot-potential-profit')).toContainText('$100.00');
  await noHorizontalOverflow(page);

  // Estimates can still be adjusted here; the split follows.
  await d.getByTestId('lot-review-estimate').nth(2).fill('90');
  expect(await lineCosts(d)).toEqual(['$40.00', '$24.00', '$36.00']);
  await d.getByTestId('lot-review-estimate').nth(2).fill('40');
  await saveLot(page, d);

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Estate sale box');
  await expect(page.getByTestId('lot-stat-total')).toContainText('$100.00');
  await expect(page.getByTestId('lot-stat-total')).toContainText('$90.00 price + $10.00 additional');
  await expect(page.getByTestId('lot-reconciled')).toBeVisible();
  await expect(page.getByTestId('lot-item-allocated')).toHaveText(['$50.00', '$30.00', '$20.00']);
  await expect(page.getByTestId('lot-history-entry')).toContainText('Lot created · $100.00 split by estimated resale value');
  await noHorizontalOverflow(page);

  // The items are ordinary inventory, costing their share; buying isn't a loss.
  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item')).toHaveCount(3);
  await expect(page.getByTestId('lots-link')).toHaveText(/Lots \(1\)/);
  await page.getByTestId('inventory-item').filter({ hasText: 'Sony headphones' }).first().click();
  await expect(page.getByTestId('item-lot-link')).toContainText('Part of lot Estate sale box · $30.00 of its cost for 1 unit');
  await expect(page.getByText('Cost per item', { exact: true }).locator('..')).toContainText('$30.00');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByTestId('item-cost-lot-hint')).toContainText('share of the lot “Estate sale box”');
});

test('uneven pennies and several units: costs add up exactly as units sell one at a time', async ({ page }) => {
  await onboard(page, 'Reseller');
  const d = await startLot(page, { name: 'Mug box', price: '10', lines: [{ name: 'Coffee mug', quantity: 3, estimate: '5' }] });
  await expect(d.getByTestId('lot-unit-cost')).toContainText('$3.33–$3.34 each');
  await expect(d.getByTestId('lot-unit-cost')).toContainText('1 × $3.34 + 2 × $3.33');
  await saveLot(page, d);

  for (let n = 0; n < 3; n++) await sellFromLot(page, 'Coffee mug', { price: '8' });
  const flow = page.getByTestId('lot-reconciliation');
  await expect(flow).toContainText(/Sold \(cost of goods sold\)\s*\$10\.00/);
  await expect(flow).toContainText(/Still in stock\s*\$0\.00/);
  await expect(page.getByTestId('lot-reconciled')).toBeVisible();
  // $24 of sales − exactly $10 of cost.
  await expect(page.getByTestId('lot-realized-profit')).toContainText('$14.00');
});

test('without estimates the lot can be split equally per unit', async ({ page }) => {
  await onboard(page, 'Reseller');
  const d = await startLot(page, {
    name: 'Mystery pallet',
    price: '9',
    lines: [
      { name: 'Blue vase', quantity: 2 },
      { name: 'Lamp', quantity: 1 },
    ],
  });
  await expect(d.getByTestId('lot-split-problem')).toContainText('need an estimated resale value');
  await expect(d.getByTestId('lot-save')).toBeDisabled();
  await d.getByRole('button', { name: 'Split equally instead' }).click();
  await expect(d.getByRole('radio', { name: /Equally per unit/ })).toHaveAttribute('aria-checked', 'true');
  expect(await lineCosts(d)).toEqual(['$6.00', '$3.00']);
  await expect(d.getByTestId('lot-potential-profit')).toContainText('Add every estimate to see this');
  await saveLot(page, d);
  await expect(page.getByTestId('lot-history-entry')).toContainText('split equally per unit');
});

test('editing costs after a sale: explicit confirmation, history, and completed sales untouched', async ({ page }) => {
  await onboard(page, 'Reseller');
  await saveLot(page, await startLot(page, { ...ESTATE, extras: [], price: '100' }));
  await sellFromLot(page, 'Denim jacket', { price: '35' });
  await expect(page.getByTestId('lot-realized-profit')).toContainText('$15.00');

  // The invoice turns out to be $8 higher.
  await page.getByTestId('lot-edit-open').click();
  const edit = page.getByTestId('lot-edit');
  await edit.getByLabel('Total purchase price').fill('108');
  await edit.getByTestId('lot-edit-save').click();

  const confirm = page.getByTestId('lot-confirm');
  await expect(confirm.getByTestId('lot-confirm-total')).toContainText('$100.00 → $108.00');
  await expect(confirm.getByTestId('lot-confirm-locked')).toContainText('$20.00 (unchanged)');
  await expect(confirm.getByTestId('lot-confirm-line')).toHaveCount(2);
  await expect(confirm.getByTestId('lot-confirm-line').first()).toContainText('$50.00 → $55.00');
  await expect(confirm.getByTestId('lot-confirm-line').last()).toContainText('$30.00 → $33.00');
  await noHorizontalOverflow(page);

  // Going back changes nothing.
  await confirm.getByRole('button', { name: 'Back to editing' }).click();
  await edit.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('lot-stat-total')).toContainText('$100.00');

  await page.getByTestId('lot-edit-open').click();
  await edit.getByLabel('Total purchase price').fill('108');
  await edit.getByTestId('lot-edit-save').click();
  await confirm.getByLabel('Reason (optional)').fill('Invoice included a handling fee');
  await confirm.getByTestId('lot-confirm-apply').click();
  await expect(confirm).toBeHidden();

  await expect(page.getByTestId('lot-stat-total')).toContainText('$108.00');
  await expect(page.getByTestId('lot-item-allocated')).toHaveText(['$55.00', '$33.00', '$20.00']);
  await expect(page.getByTestId('lot-realized-profit')).toContainText('$15.00');
  await expect(page.getByTestId('lot-reconciled')).toBeVisible();
  const latest = page.getByTestId('lot-history-entry').first();
  await expect(latest).toContainText('Costs changed · total $100.00 → $108.00');
  await expect(latest).toContainText('$20.00 already in completed sales or written off was left unchanged.');
  await expect(latest).toContainText('Nike sneakers: $50.00 → $55.00 per item');
  await expect(latest).toContainText('Invoice included a handling fee');

  // The sale itself still shows its original $20 cost and $15 profit.
  await nav(page, 'Sales & Profit');
  const jacketSale = page.getByTestId('sale-row').filter({ hasText: 'Denim jacket' });
  await expect(jacketSale).toContainText('$20.00');
  await expect(jacketSale).toContainText('$15.00');

  // Saved on the device.
  await page.goBack();
  await reloadWhenSaved(page);
  await expect(page.getByTestId('lot-stat-total')).toContainText('$108.00');
  await expect(page.getByTestId('lot-history-entry')).toHaveCount(2);
});

test('lowering a lot’s cost below what’s already sold is refused', async ({ page }) => {
  await onboard(page, 'Reseller');
  await saveLot(page, await startLot(page, { ...ESTATE, extras: [], price: '100' }));
  await sellFromLot(page, 'Nike sneakers', { price: '120' });
  await page.getByTestId('lot-edit-open').click();
  const edit = page.getByTestId('lot-edit');
  await edit.getByLabel('Total purchase price').fill('40');
  await edit.getByTestId('lot-edit-save').click();
  await expect(edit).toContainText('can go down by at most that much');
  await expect(page.getByTestId('lot-confirm')).toBeHidden();
});

test('backups keep lots, and restoring them keeps every cent reconciled', async ({ page }) => {
  await onboard(page, 'Reseller');
  await saveLot(page, await startLot(page, ESTATE));
  await sellFromLot(page, 'Sony headphones', { price: '75', fees: '9.75' });

  await nav(page, 'Settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const file = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(file.version).toBe(1);
  expect(file.data.lots).toHaveLength(1);
  expect(file.data.lots[0].lines.map((l: { allocatedCost: number }) => l.allocatedCost)).toEqual([50, 30, 20]);

  await page.getByRole('button', { name: 'Erase all data' }).click();
  const confirm = page.getByTestId('confirm-dialog');
  await confirm.getByRole('textbox').fill('DELETE');
  await confirm.getByRole('button', { name: 'Erase everything' }).click();

  await page.getByRole('button', { name: 'Restore from backup' }).click();
  const dialog = page.getByTestId('restore-dialog');
  await dialog.getByTestId('restore-file').setInputFiles(await download.path());
  await expect(dialog).toContainText('1 bulk lot');
  await dialog.getByRole('button', { name: 'Replace my data' }).click();
  await expect(dialog).toBeHidden();

  await nav(page, 'Inventory');
  await page.getByTestId('lots-link').click();
  await page.getByTestId('lot-card').first().click();
  await expect(page.getByTestId('lot-reconciled')).toBeVisible();
  await expect(page.getByTestId('lot-realized-profit')).toContainText('$35.25');
});

test('the standard build offers no AI scanner in a lot', async ({ page }) => {
  await onboard(page, 'Reseller');
  await nav(page, 'Inventory');
  await page.getByRole('button', { name: 'Add bulk lot' }).first().click();
  const d = page.getByTestId('lot-dialog');
  await d.getByLabel('Lot name').fill('No scanner');
  await d.getByLabel('Total purchase price').fill('5');
  await d.getByTestId('lot-next').click();
  await expect(d.getByTestId('lot-line')).toBeVisible();
  await expect(d.getByRole('button', { name: /Scan with AI/ })).toHaveCount(0);
});

test('no accessibility violations in the lot dialog and lot page', async ({ page }) => {
  const check = async (where: string) => {
    await page.waitForTimeout(600);
    const { violations } = await new AxeBuilder({ page }).exclude('.animate-toast-in').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(violations.map((v) => `${where}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  };
  await onboard(page, 'Reseller');
  const d = await startLot(page, ESTATE);
  await check('review step');
  await saveLot(page, d);
  await check('lot page');
  await page.getByTestId('lot-edit-open').click();
  await check('edit dialog');
});

test.describe('with the AI scanner', () => {
  const SCAN_APP = 'http://localhost:4175/';
  test.use({ baseURL: SCAN_APP });

  test('a scan identifies an item in the lot but never sets its price', async ({ page }) => {
    let scans = 0;
    await page.route('http://scan.test/**', async (route: Route) => {
      const cors = { 'access-control-allow-origin': new URL(SCAN_APP).origin, 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (new URL(route.request().url()).pathname !== '/v1/scan') return route.fulfill({ status: 404, headers: cors, body: '{}' });
      scans++;
      // A response that (wrongly) includes prices: they must be ignored.
      return route.fulfill({
        headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({
          ok: true,
          result: {
            status: 'identified',
            name: 'WH-1000XM4 Headphones',
            brand: 'Sony',
            model: 'WH-1000XM4',
            category: 'Headphones',
            description: 'Black over-ear wireless headphones.',
            condition: 'good',
            condition_notes: null,
            confidence: 'high',
            notes: null,
            price: 199,
            resale_value: 180,
          },
          model: { id: 'test', label: 'Test model' },
          scansLeftToday: 19,
        }),
      });
    });
    await onboard(page, 'Reseller');
    await page.evaluate(() => localStorage.setItem('stockpilot-scan-invite-code', 'SP-TEST1-TEST2-TEST3-TEST4'));
    await nav(page, 'Inventory');
    await page.getByRole('button', { name: 'Add bulk lot' }).first().click();
    const d = page.getByTestId('lot-dialog');
    await d.getByLabel('Lot name').fill('Electronics lot');
    await d.getByLabel('Total purchase price').fill('60');
    await d.getByTestId('lot-next').click();

    const row = d.getByTestId('lot-line').first();
    await row.getByRole('button', { name: 'Scan with AI' }).click();
    await expect(row.getByTestId('lot-scan-price-note')).toContainText('doesn’t estimate prices');
    await row.getByTestId('scan-upload-input').setInputFiles({ name: 'item.png', mimeType: 'image/png', buffer: await solidPng(page, '#222222') });
    await row.getByRole('button', { name: 'Analyze photo' }).click();
    await expect(row.getByTestId('scan-result')).toContainText('Suggested details');
    expect(scans).toBe(1);

    await expect(row.getByLabel(/Item name/)).toHaveValue('Sony WH-1000XM4 Headphones');
    await expect(row.getByTestId('ai-filled')).toBeVisible();
    // Price and quantity are the user's to enter.
    await expect(row.getByLabel('Est. resale value, per item')).toHaveValue('');
    await expect(row.getByRole('textbox', { name: 'Quantity', exact: true })).toHaveValue('1');

    await row.getByLabel('Est. resale value, per item').fill('150');
    await d.getByTestId('lot-add-line').click();
    const second = d.getByTestId('lot-line').nth(1);
    await second.getByLabel('Item name').fill('Charging case');
    await second.getByLabel('Est. resale value, per item').fill('50');
    await d.getByTestId('lot-next').click();
    expect(await lineCosts(d)).toEqual(['$45.00', '$15.00']);
    await saveLot(page, d);

    await page.getByTestId('lot-item').getByRole('link', { name: 'Sony WH-1000XM4 Headphones' }).click();
    await expect(page.getByTestId('item-title')).toHaveText('Sony WH-1000XM4 Headphones');
    await expect(page.getByRole('img', { name: 'Sony WH-1000XM4 Headphones' }).first()).toBeVisible();
  });
});
