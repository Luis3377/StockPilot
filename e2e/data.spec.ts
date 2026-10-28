import { readFileSync } from 'node:fs';
import { expect, test, type Download, type Page } from '@playwright/test';
import { addItem, nav, onboard } from './helpers';

async function text(download: Download): Promise<string> {
  return readFileSync(await download.path(), 'utf8');
}

async function downloadFrom(page: Page, click: () => Promise<void>): Promise<Download> {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  return download;
}

const CSV = [
  'Item Name,SKU,Category,Qty,Unit Cost,Asking Price,Purchase Date,Location',
  'Funko Pop Batman,FUN-1,Collectibles,3,8.50,20,2026-09-01,Bin 1',
  'Lego set 75192,LEGO-1,Toys,1,"$650.00",900,9/15/2026,Garage',
  ',NOPE,Toys,1,5,,,',
  'Bad qty,X-1,Toys,two,5,,,',
].join('\n');

test('CSV import validates rows, reports errors and avoids duplicates', async ({ page }) => {
  await onboard(page, 'Reseller');
  await nav(page, 'Inventory');
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const dialog = page.getByTestId('import-dialog');
  await dialog.getByTestId('import-file').setInputFiles({ name: 'stock.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(dialog.getByTestId('import-summary')).toContainText('2New items');
  await expect(dialog).toContainText('Row 4: Name is required.');
  await expect(dialog).toContainText('Row 5: Quantity "two" must be a whole number.');
  await dialog.getByRole('button', { name: 'Import 2 items' }).click();
  await expect(page.getByTestId('inventory-item')).toHaveCount(2);

  // Importing the same file again finds duplicates and skips them by default.
  await page.getByRole('button', { name: 'Import' }).first().click();
  await dialog.getByTestId('import-file').setInputFiles({ name: 'stock.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await expect(dialog.getByTestId('import-summary')).toContainText('2Already in inventory');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Update existing items' }).click();
  await dialog.getByRole('button', { name: 'Import 2 items' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: '0 added, 2 updated' })).toBeVisible();
  await expect(page.getByTestId('inventory-item')).toHaveCount(2);
});

test('missing required columns are explained', async ({ page }) => {
  await onboard(page, 'Reseller');
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Import inventory CSV' }).click();
  const dialog = page.getByTestId('import-dialog');
  await dialog.getByTestId('import-file').setInputFiles({ name: 'x.csv', mimeType: 'text/csv', buffer: Buffer.from('title,price\nA,5') });
  // "title" and "price" are recognised as name and asking price; quantity and cost are missing.
  await expect(dialog.getByRole('alert')).toContainText('Missing required columns: quantity, unit_cost');
  await expect(dialog.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
});

test('exports inventory, sales and profit CSVs', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Camera, "Leica" M6', quantity: 2, cost: '1500', asking: '2400' });
  await page.getByRole('button', { name: 'Record sale' }).click();
  const sale = page.getByTestId('sale-form');
  await sale.getByLabel('Item sold').selectOption({ index: 1 });
  await sale.getByLabel('Sale price').fill('2350');
  await sale.getByLabel('Marketplace fees').fill('300');
  await sale.getByRole('button', { name: 'Record sale' }).click();

  await nav(page, 'Settings');
  const inv = await text(await downloadFrom(page, () => page.getByRole('button', { name: 'Inventory', exact: true }).click()));
  expect(inv.split('\r\n')[0]).toContain('name,sku,category,quantity,unit_cost');
  expect(inv).toContain('"Camera, ""Leica"" M6",SP-0001,,1,1500,2400');

  const sales = await text(await downloadFrom(page, () => page.getByRole('button', { name: 'Sales & profit' }).click()));
  expect(sales).toContain('net_profit');
  expect(sales).toMatch(/,2350,1500,1500,300,0,0,550,23\.4,36\.7,/);

  const summary = await text(await downloadFrom(page, () => page.getByRole('button', { name: 'Monthly profit summary' }).click()));
  expect(summary).toContain('TOTAL,1,1,2350,1500,300,0,0,550');
});

test('backup and restore round-trip all data', async ({ page }) => {
  await onboard(page, 'Collector');
  await addItem(page, { name: 'Rookie card', quantity: 1, cost: '30' });
  await nav(page, 'Settings');
  const backup = await downloadFrom(page, () => page.getByRole('button', { name: 'Download backup' }).click());
  const file = JSON.parse(await text(backup));
  expect(file.format).toBe('stockpilot-backup');
  expect(file.data.items[0].name).toBe('Rookie card');
  await expect(page.getByText(/Last backup: (?!never)/)).toBeVisible();

  // Erase everything (requires typing DELETE), then restore.
  await page.getByRole('button', { name: 'Erase all data' }).click();
  const confirm = page.getByTestId('confirm-dialog');
  await expect(confirm.getByRole('button', { name: 'Erase everything' })).toBeDisabled();
  await confirm.getByRole('textbox').fill('DELETE');
  await confirm.getByRole('button', { name: 'Erase everything' }).click();
  await nav(page, 'Collection');
  await expect(page.getByText('Your collection is empty')).toBeVisible();

  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  const dialog = page.getByTestId('restore-dialog');
  await dialog.getByTestId('restore-file').setInputFiles(await backup.path());
  await expect(dialog).toContainText('1 items');
  await dialog.getByRole('button', { name: 'Replace my data' }).click();
  await nav(page, 'Collection');
  await expect(page.getByTestId('inventory-item')).toContainText('Rookie card');
});

test('an invalid backup file is rejected without changing data', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Safe item' });
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  const dialog = page.getByTestId('restore-dialog');
  await dialog.getByTestId('restore-file').setInputFiles({ name: 'nope.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(dialog.getByRole('alert')).toContainText("isn't a StockPilot backup");
  await expect(dialog.getByRole('button', { name: 'Replace my data' })).toBeDisabled();
});

test('demo data is clearly labeled and kept separate from real data', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'My real item' });
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Try demo mode' }).click();
  await expect(page.getByTestId('demo-banner')).toContainText('Demo mode');
  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item').first()).toBeVisible();
  await expect(page.getByText('My real item')).toHaveCount(0);
  expect(await page.getByTestId('inventory-item').count()).toBeGreaterThan(20);
  // Changes in demo mode stay in the demo.
  await page.getByTestId('inventory-item').first().click();
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete item' }).click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Delete item' }).click();

  await page.getByTestId('demo-banner').getByRole('button', { name: 'Exit demo' }).click();
  await expect(page.getByTestId('demo-banner')).toHaveCount(0);
  await expect(page.getByTestId('inventory-item')).toHaveCount(1);
  await expect(page.getByTestId('inventory-item')).toContainText('My real item');
});
