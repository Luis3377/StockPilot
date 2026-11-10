import { expect, test } from '@playwright/test';
import { addItem, nav, onboard, openItem, recordSale } from './helpers';

test('Count Check finds shortages and overages and applies approved adjustments', async ({ page }) => {
  await onboard(page, 'Small business');
  await addItem(page, { name: 'Mug — blue', quantity: 10, cost: '4', location: 'Shelf A' });
  await addItem(page, { name: 'Mug — red', quantity: 6, cost: '5', location: 'Shelf A' });
  await addItem(page, { name: 'Coaster set', quantity: 3, cost: '2', location: 'Shelf A' });

  await nav(page, 'Count Check');
  await page.getByRole('button', { name: 'Start counting 3 items' }).click();
  await expect(page.getByText('Count in progress')).toBeVisible();

  await page.getByLabel('Counted quantity for Mug — blue').fill('8');
  await page.getByLabel('Counted quantity for Mug — blue').press('Enter');
  await page.getByLabel('Counted quantity for Mug — red').fill('7');
  await page.getByLabel('Counted quantity for Mug — red').press('Enter');
  await page.getByRole('button', { name: 'Matches (3)' }).click();

  await expect(page.getByTestId('count-missing')).toContainText('2 units');
  await expect(page.getByTestId('count-missing')).toContainText('-$8.00');
  await expect(page.getByTestId('count-excess')).toContainText('1 unit');
  await expect(page.getByTestId('count-excess')).not.toContainText('1 units');
  await expect(page.getByTestId('count-excess')).toContainText('$5.00');
  await expect(page.getByTestId('count-net')).toContainText('-$3.00');

  // Progress is saved: reload keeps the draft.
  await page.reload();
  await expect(page.getByTestId('count-missing')).toContainText('2 units');

  await page.getByRole('button', { name: 'Review & finish' }).click();
  const review = page.getByTestId('count-review');
  await expect(review.getByTestId('review-line')).toHaveCount(2);
  await review.getByLabel('Reason for Mug — blue').selectOption('Damaged');
  await review.getByLabel('Apply adjustment for Mug — red').uncheck();
  await review.getByRole('button', { name: 'Apply 1 adjustment & finish' }).click();
  await expect(page.getByText('Count finished. 1 adjustment applied.')).toBeVisible();

  await expect(page.getByText('Past counts')).toBeVisible();
  await expect(page.getByText(/3 counted · 2 differences · 1 applied/)).toBeVisible();
  await expect(page.getByText(/Count Check · Damaged/)).toBeVisible();

  await openItem(page, 'Mug — blue');
  await expect(page.getByTestId('item-quantity')).toHaveText('8');
  await openItem(page, 'Mug — red');
  await expect(page.getByTestId('item-quantity')).toHaveText('6');

  // The discrepancy report downloads as CSV.
  await nav(page, 'Count Check');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV' }).click()]);
  const csv = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString('utf8'));
  expect(csv).toContain('Mug — blue');
  expect(csv).toMatch(/Missing,yes,Damaged/);
  expect(csv).toMatch(/Excess,no/);
});

test('a count can be discarded without changing inventory', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Lone item', quantity: 2 });
  await nav(page, 'Count Check');
  await page.getByRole('button', { name: 'Start counting 1 item' }).click();
  // Nothing counted yet: the message says so instead of "0 counts".
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Nothing has been counted yet. Inventory quantities are not changed.');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByLabel('Counted quantity for Lone item').fill('0');
  await page.getByLabel('Counted quantity for Lone item').press('Enter');
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('The 1 count you’ve entered will be thrown away.');
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Discard count' }).click();
  await expect(page.getByText('Start a new count')).toBeVisible();
  await openItem(page, 'Lone item');
  await expect(page.getByTestId('item-quantity')).toHaveText('2');
});

test('the Overview shows missing stock on its own, with extras in the small text', async ({ page }) => {
  await onboard(page, 'Small business');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await addItem(page, { name: 'Hoodie', quantity: 4, cost: '18' });
  await addItem(page, { name: 'Mug', quantity: 6, cost: '3.25' });
  await expect(page.getByTestId('stat-discrepancy-value')).toHaveText('Nothing missing');
  await expect(page.getByTestId('stat-discrepancy')).toContainText('No physical count yet');

  await nav(page, 'Count Check');
  await page.getByRole('button', { name: 'Start counting 2 items' }).click();
  await page.getByLabel('Counted quantity for Hoodie').fill('5');
  await page.getByLabel('Counted quantity for Hoodie').press('Enter');
  await page.getByLabel('Counted quantity for Mug').fill('4');
  await page.getByLabel('Counted quantity for Mug').press('Enter');
  await page.getByRole('button', { name: 'Review & finish' }).click();
  await page.getByTestId('count-review').getByRole('button', { name: 'Apply 2 adjustments & finish' }).click();
  await expect(page.getByText('Past counts')).toBeVisible();

  await nav(page, 'Overview');
  await expect(page.getByTestId('stat-discrepancy-value')).toHaveText('-$6.50 missing');
  await expect(page.getByTestId('stat-discrepancy')).toContainText('+$18.00 extra found · Last count');
});

test('a count is flagged when stock changes after the item was counted', async ({ page }) => {
  await onboard(page, 'Small business');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await addItem(page, { name: 'Widget', quantity: 12, cost: '2' });
  await addItem(page, { name: 'Gadget', quantity: 5, cost: '4' });
  await nav(page, 'Count Check');
  await page.getByRole('button', { name: 'Start counting 2 items' }).click();
  await page.getByLabel('Counted quantity for Widget').fill('12');
  await page.getByLabel('Counted quantity for Widget').press('Enter');
  await page.getByLabel('Counted quantity for Gadget').fill('5');
  await page.getByLabel('Counted quantity for Gadget').press('Enter');
  await expect(page.getByTestId('count-changed')).toHaveCount(0);

  // A sale is recorded before the count is finished.
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: 'Record your first sale' }).click();
  await recordSale(page, { item: 'Widget', price: '5' });
  await nav(page, 'Count Check');
  await expect(page.getByTestId('count-changed-banner')).toContainText('Stock changed for 1 item since you counted it');
  const row = page.getByTestId('count-row').filter({ hasText: 'Widget' });
  await expect(row.getByTestId('count-changed')).toContainText('Stock changed since you counted this (12 → 11). Recount?');

  // In review, the changed row starts unticked so it can't adjust stock by accident.
  await page.getByRole('button', { name: 'Review & finish' }).click();
  const review = page.getByTestId('count-review');
  await expect(review.getByLabel('Apply adjustment for Widget')).not.toBeChecked();
  await expect(review.getByTestId('review-line')).toContainText('Stock changed since you counted this (12 → 11). Recount?');
  await review.getByRole('button', { name: 'Keep counting' }).click();

  // Recount clears the number so it can be entered again.
  await row.getByRole('button', { name: 'Recount' }).click();
  await expect(page.getByLabel('Counted quantity for Widget')).toHaveValue('');
  await expect(page.getByTestId('count-changed-banner')).toHaveCount(0);
  await page.getByLabel('Counted quantity for Widget').fill('11');
  await page.getByLabel('Counted quantity for Widget').press('Enter');
  await expect(row).toContainText('✓ Matches');

  // "Keep count" accepts a count as still right after another change.
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: 'Record sale' }).first().click();
  await recordSale(page, { item: 'Gadget', price: '9' });
  await nav(page, 'Count Check');
  const gadget = page.getByTestId('count-row').filter({ hasText: 'Gadget' });
  await gadget.getByRole('button', { name: 'Keep count' }).click();
  await expect(page.getByTestId('count-changed')).toHaveCount(0);
  await expect(gadget).toContainText('+1');

  // Kept counts survive a reload (the snapshot is saved with the draft).
  await page.reload();
  await expect(page.getByTestId('count-row').filter({ hasText: 'Gadget' })).toContainText('+1');
  await expect(page.getByTestId('count-changed')).toHaveCount(0);
});
