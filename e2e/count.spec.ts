import { expect, test } from '@playwright/test';
import { addItem, nav, onboard, openItem } from './helpers';

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
  await expect(page.getByTestId('count-excess')).toContainText('1 units');
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
  await page.getByRole('button', { name: /Start counting/ }).click();
  await page.getByLabel('Counted quantity for Lone item').fill('0');
  await page.getByLabel('Counted quantity for Lone item').press('Enter');
  await page.getByRole('button', { name: 'Discard' }).click();
  await page.getByTestId('confirm-dialog').getByRole('button', { name: 'Discard count' }).click();
  await expect(page.getByText('Start a new count')).toBeVisible();
  await openItem(page, 'Lone item');
  await expect(page.getByTestId('item-quantity')).toHaveText('2');
});
