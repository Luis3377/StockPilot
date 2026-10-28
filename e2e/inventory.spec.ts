import { expect, test } from '@playwright/test';
import { addItem, nav, onboard, openItem } from './helpers';

// 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('add an item: inventory list and dashboard update', async ({ page }) => {
  await onboard(page, 'Reseller');
  await expect(page.getByTestId('get-started')).toBeVisible();
  await addItem(page, { name: 'Vintage Polaroid SX-70', quantity: 2, cost: '45.50', asking: '120', category: 'Cameras' });
  await expect(page.getByTestId('toast').filter({ hasText: 'Added "Vintage Polaroid SX-70"' })).toBeVisible();
  await expect(page.getByTestId('stat-inventory-cost-value')).toHaveText('$91.00');
  await expect(page.getByTestId('stat-selling-value-value')).toHaveText('$240.00');
  await expect(page.getByTestId('stat-in-stock-value')).toHaveText('2');
  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item')).toHaveCount(1);
  await expect(page.getByTestId('inventory-item')).toContainText('Vintage Polaroid SX-70');
});

test('validation explains what is missing and nothing is saved', async ({ page }) => {
  await onboard(page, 'Reseller');
  await page.getByRole('button', { name: 'Add your first item' }).click();
  const dialog = page.getByTestId('item-form');
  await dialog.getByRole('textbox', { name: 'Quantity', exact: true }).fill('');
  await dialog.getByRole('button', { name: 'Add item' }).click();
  await expect(dialog.getByText('Give the item a name')).toBeVisible();
  await expect(dialog.getByText('Enter what you paid per item')).toBeVisible();
  await expect(dialog.getByText('Enter how many you have')).toBeVisible();
  await dialog.getByLabel('Item name').fill('Thing');
  await dialog.getByRole('textbox', { name: 'Quantity', exact: true }).fill('1');
  await dialog.getByLabel('Cost per item').fill('abc');
  await dialog.getByRole('button', { name: 'Add item' }).click();
  await expect(dialog.getByText('Enter an amount like 12.50')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('get-started')).toBeVisible();
});

test('duplicate SKUs are rejected with a clear message', async ({ page }) => {
  await onboard(page, 'Small business');
  await addItem(page, { name: 'Candle A', sku: 'CAN-1' });
  await page.getByRole('button', { name: 'Add item' }).first().click();
  const dialog = page.getByTestId('item-form');
  await dialog.getByLabel('Item name').fill('Candle B');
  await dialog.getByLabel('Cost per item').fill('3');
  await dialog.getByRole('button', { name: /More details/ }).click();
  await dialog.getByLabel('SKU / ID').fill('can-1');
  await dialog.getByRole('button', { name: 'Add item' }).click();
  await expect(dialog.getByText('SKU "can-1" is already used by "Candle A".')).toBeVisible();
});

test('edit an item and see calculations update everywhere', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Desk lamp', quantity: 4, cost: '10', asking: '25' });
  await openItem(page, 'Desk lamp');
  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByTestId('item-form');
  await dialog.getByLabel('Item name').fill('Brass desk lamp');
  await dialog.getByRole('textbox', { name: 'Quantity', exact: true }).fill('5');
  await dialog.getByLabel('Cost per item').fill('12');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('item-title')).toHaveText('Brass desk lamp');
  await expect(page.getByTestId('item-quantity')).toHaveText('5');
  await expect(page.getByText('Total cost')).toBeVisible();
  await expect(page.getByText('$60.00').first()).toBeVisible();
  // The quantity change is logged.
  await expect(page.getByText('Edited: 4 → 5')).toBeVisible();
  await nav(page, 'Overview');
  await expect(page.getByTestId('stat-inventory-cost-value')).toHaveText('$60.00');
  await expect(page.getByTestId('stat-selling-value-value')).toHaveText('$125.00');
});

test('delete asks for confirmation and can be cancelled', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Keep or toss' });
  await openItem(page, 'Keep or toss');
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete item' }).click();
  const confirm = page.getByTestId('confirm-dialog');
  await expect(confirm).toContainText('Delete "Keep or toss"?');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('item-title')).toHaveText('Keep or toss');

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete item' }).click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Delete item' }).click();
  await expect(page).toHaveURL(/#\/inventory$/);
  await expect(page.getByText('No inventory yet')).toBeVisible();
});

test('photos can be added, shown and kept after reload', async ({ page }) => {
  await onboard(page, 'Collector');
  await page.getByRole('button', { name: 'Add your first item' }).click();
  const dialog = page.getByTestId('item-form');
  await dialog.getByLabel('Item name').fill('Signed baseball');
  await dialog.getByLabel('Cost per item').fill('80');
  await dialog.getByTestId('photo-input').setInputFiles([{ name: 'ball.png', mimeType: 'image/png', buffer: PNG }]);
  await expect(dialog.getByText('Cover')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add item' }).click();
  await nav(page, 'Collection');
  await expect(page.getByTestId('inventory-item').locator('img')).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('inventory-item').locator('img')).toHaveAttribute('src', /^data:image\/jpeg/);
});

test('search, filters and sorting return the right items', async ({ page }) => {
  await onboard(page, 'Reseller', true);
  await nav(page, 'Inventory');
  const items = page.getByTestId('inventory-item');
  await expect(items.first()).toBeVisible();
  const total = await items.count();
  expect(total).toBeGreaterThan(20);

  // Matches names and the "Candles" category (wax melts).
  await page.getByLabel('Search inventory').fill('candle');
  await expect(items).toHaveCount(5);
  await expect(page.getByTestId('result-count')).toContainText(`5 of ${total} items match`);

  await page.getByLabel('Search inventory').fill('');
  await page.getByLabel('Category').selectOption('Sneakers');
  await expect(items).toHaveCount(6);
  await page.getByLabel('Status').selectOption('out');
  await expect(items).toHaveCount(2);
  await expect(page.getByTestId('inventory-grid')).toContainText('Travis Scott');
  await expect(page.getByTestId('inventory-grid')).toContainText('Samba');

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(items).toHaveCount(total);
  await page.getByLabel('Status').selectOption('low');
  await expect(items).toHaveCount(4);

  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Location').selectOption('Card safe');
  await page.getByLabel('Sort').selectOption('name');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText('Charizard');
  await expect(items.nth(1)).toContainText('Umbreon');

  await page.getByLabel('Search inventory').fill('zzz-no-match');
  await expect(page.getByText('No items match')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search & filters' }).click();
  await expect(items).toHaveCount(total);

  await page.getByRole('radio', { name: 'List view' }).click();
  await expect(page.getByTestId('inventory-list')).toBeVisible();
});

test('data is still there after closing and reopening the app', async ({ page, context }) => {
  await onboard(page, 'Small business');
  await addItem(page, { name: 'Persistent soap bar', quantity: 12, cost: '1.75', asking: '6' });
  const reopened = await context.newPage();
  await reopened.goto('./');
  await expect(reopened.getByText('Small business mode')).toBeVisible();
  await reopened.goto('./#/inventory');
  await expect(reopened.getByTestId('inventory-item')).toContainText('Persistent soap bar');
  await page.close();
  await reopened.reload();
  await expect(reopened.getByTestId('inventory-item')).toHaveCount(1);
});

test('restock averages the cost, adjust quantity requires a reason', async ({ page }) => {
  await onboard(page, 'Small business');
  await addItem(page, { name: 'Tote bag', quantity: 2, cost: '10' });
  await openItem(page, 'Tote bag');
  await page.getByRole('button', { name: 'Add stock' }).click();
  const stock = page.getByTestId('stock-dialog');
  await stock.getByLabel('How many are you adding?').fill('2');
  await stock.getByLabel('Cost per item for this batch').fill('14');
  await expect(stock).toContainText('$12.00');
  await stock.getByRole('button', { name: 'Add stock' }).click();
  await expect(page.getByTestId('item-quantity')).toHaveText('4');

  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Adjust quantity' }).click();
  await stock.getByLabel('Quantity you actually have').fill('3');
  await stock.getByLabel('Reason').selectOption('Damaged');
  await stock.getByRole('button', { name: 'Save quantity' }).click();
  await expect(page.getByTestId('item-quantity')).toHaveText('3');
  await expect(page.getByText('Adjustment: 4 → 3')).toBeVisible();
});
