import { expect, test, type Page } from '@playwright/test';
import { addItem, nav, onboard, openItem, recordSale } from './helpers';

async function setup(page: Page) {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Retro console', quantity: 5, cost: '40', asking: '100', category: 'Games' });
}

test('recording a sale reduces stock and profit includes every expense', async ({ page }) => {
  await setup(page);
  await openItem(page, 'Retro console');
  await page.getByRole('button', { name: 'Record sale' }).click();
  const dialog = page.getByTestId('sale-form');
  // Asking price is pre-filled for a new sale.
  await expect(dialog.getByLabel('Sale price')).toHaveValue('100');
  await dialog.getByLabel('Quantity sold').fill('2');
  await dialog.getByLabel('Sale price').fill('95');
  await dialog.getByLabel('Where did it sell?').fill('eBay');
  await dialog.getByLabel('Marketplace fees').fill('25.18');
  await dialog.getByLabel('Shipping you paid').fill('18.40');
  await dialog.getByLabel('Other expenses').fill('3.00');
  // 190 − 80 − 25.18 − 18.40 − 3.00 = 63.42
  await expect(dialog.getByTestId('sale-preview-profit')).toHaveText('$63.42');
  await expect(dialog.getByTestId('sale-preview')).toContainText('Margin 33.4%');
  await expect(dialog.getByTestId('sale-preview')).toContainText('ROI 79.3%');
  await dialog.getByRole('button', { name: 'Record sale' }).click();
  await expect(page.getByTestId('toast').filter({ hasText: '$63.42 net profit' })).toBeVisible();
  await expect(page.getByTestId('item-quantity')).toHaveText('3');

  await nav(page, 'Sales & Profit');
  await page.getByRole('radio', { name: 'All time' }).click();
  await expect(page.getByTestId('sales-revenue-value')).toHaveText('$190.00');
  await expect(page.getByTestId('sales-cogs-value')).toHaveText('$80.00');
  await expect(page.getByTestId('sales-expenses-value')).toHaveText('$46.58');
  await expect(page.getByTestId('sales-net-value')).toHaveText('$63.42');
  await expect(page.getByTestId('sales-margin-value')).toHaveText('33.4%');
  await expect(page.getByTestId('sales-roi-value')).toHaveText('79.3%');
  // Realized and projected are shown separately: 3 unsold × $100 at ~24.5% learned costs.
  await expect(page.getByTestId('projected-card')).toContainText('Projected — not earned yet');
});

test('fees can be entered as a percentage and price as a total', async ({ page }) => {
  await setup(page);
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: 'Record your first sale' }).click();
  const dialog = page.getByTestId('sale-form');
  await dialog.getByLabel('Item sold').selectOption({ label: 'Retro console — 5 available' });
  await dialog.getByLabel('Quantity sold').fill('3');
  await dialog.getByLabel('Sale price').fill('240');
  await dialog.getByRole('radio', { name: 'Total for 3' }).click();
  await dialog.getByRole('radio', { name: '% of sale' }).click();
  await dialog.getByLabel('Marketplace fees (%)').fill('10');
  // 240 − 120 − 24 = 96
  await expect(dialog.getByTestId('sale-preview-profit')).toHaveText('$96.00');
  await dialog.getByRole('button', { name: 'Record sale' }).click();
  await expect(page.getByTestId('sale-row')).toHaveCount(1);
  await expect(page.getByTestId('sales-net-value')).toHaveText('$96.00');
});

test('a sale can never take stock below zero', async ({ page }) => {
  await setup(page);
  await openItem(page, 'Retro console');
  await page.getByRole('button', { name: 'Record sale' }).click();
  const dialog = page.getByTestId('sale-form');
  await dialog.getByLabel('Quantity sold').fill('6');
  await dialog.getByRole('button', { name: 'Record sale' }).click();
  await expect(dialog.getByText('Only 5 of "Retro console" are available — you entered 6.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('item-quantity')).toHaveText('5');
});

test('editing and cancelling a sale never double-counts stock', async ({ page }) => {
  await setup(page);
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: 'Record your first sale' }).click();
  await recordSale(page, { item: 'Retro console', quantity: 2, price: '100' });
  await expect(page.getByTestId('sale-row')).toHaveCount(1);

  // Edit 2 → 4 units: stock 5 → 1.
  await page.getByRole('button', { name: 'Edit sale of Retro console' }).click();
  const dialog = page.getByTestId('sale-form');
  await expect(dialog.getByLabel('Item sold').locator('option:checked')).toHaveText('Retro console — 5 available');
  await dialog.getByLabel('Quantity sold').fill('4');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('sales-revenue-value')).toHaveText('$400.00');
  await openItem(page, 'Retro console');
  await expect(page.getByTestId('item-quantity')).toHaveText('1');

  // Edit again 4 → 1: stock back to 4.
  await page.getByRole('button', { name: 'Edit' }).last().click();
  await dialog.getByLabel('Quantity sold').fill('1');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('item-quantity')).toHaveText('4');

  // Cancel the sale: stock fully restored, revenue gone.
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: 'Cancel sale of Retro console' }).click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('The 1 unit goes back into stock.');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Cancel sale' }).click();
  await expect(page.getByText('No sales recorded yet')).toBeVisible();
  await openItem(page, 'Retro console');
  await expect(page.getByTestId('item-quantity')).toHaveText('5');
});

test('deleting an item keeps its sales in profit history', async ({ page }) => {
  await setup(page);
  await openItem(page, 'Retro console');
  await page.getByRole('button', { name: 'Record sale' }).click();
  await recordSale(page, { item: 'Retro console', quantity: 1, price: '100', fees: '10' });
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete item' }).click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('sale stays in your sales history');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Delete item' }).click();
  await nav(page, 'Sales & Profit');
  await expect(page.getByTestId('sales-net-value')).toHaveText('$50.00');
});
