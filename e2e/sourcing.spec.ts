// Profit by Source + Profit per Hour (Signature Feature 4): where inventory was bought, what it
// made once sold, the time logged for it, trips, and the explicit, logged source changes.

import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addItem, nav, noHorizontalOverflow, onboard, recordSale, reloadWhenSaved } from './helpers';
import { shop } from '../src/insights/sourcingFixture';
import { createBackup } from '../src/data/backup';
import { defaultSettings } from '../src/domain/types';

const NOW = new Date('2026-11-12T10:00:00');

async function axe(page: Page) {
  // Toasts fade in over 180 ms; they're checked once settled in trust.spec.ts.
  const { violations } = await new AxeBuilder({ page }).exclude('.animate-toast-in').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}

async function sell(page: Page, item: string, quantity: number, price: string, fees: string, shipping?: string) {
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: /^Record (sale|your first sale)$/ }).first().click();
  await recordSale(page, { item, quantity, price, fees, shipping, platform: 'eBay' });
  await expect(page.getByTestId('sale-form')).toBeHidden();
}

async function openSourcing(page: Page, tab?: string) {
  await nav(page, 'Smart Insights');
  await page.getByTestId('sourcing-link').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sourcing Performance');
  if (tab) await page.getByTestId('sourcing-tabs').getByRole('tab', { name: tab }).click();
}

const card = (page: Page, name: string) => page.getByTestId('source-card').filter({ has: page.getByRole('link', { name, exact: true }) });

test('“Where you bought it” on items and bulk lots feeds Sourcing Performance; near-duplicates are caught', async ({ page }) => {
  await page.clock.install({ time: NOW });
  await onboard(page, 'Reseller');
  await nav(page, 'Inventory');

  // A standalone item from a new source, with its type.
  await page.getByRole('button', { name: /^Add (item|your first item)$/ }).first().click();
  const form = page.getByTestId('item-form');
  await form.getByLabel('Item name').fill('Vinyl records');
  await form.getByRole('textbox', { name: 'Quantity', exact: true }).fill('10');
  await form.getByLabel('Cost per item').fill('5');
  await form.getByRole('button', { name: /More details/ }).click();
  await form.getByLabel('Where you bought it').fill('Saturday garage sales');
  await expect(form.getByTestId('source-type')).toHaveValue('garage_sale'); // guessed from the name, and editable
  await form.getByRole('button', { name: 'Add item' }).click();
  await expect(form).toBeHidden();

  // A bulk lot from a liquidation supplier: its items take the lot's source.
  await nav(page, 'Inventory');
  await page.getByRole('button', { name: 'Add bulk lot' }).first().click();
  const lot = page.getByTestId('lot-dialog');
  await lot.getByLabel('Lot name').fill('Pallet A');
  await lot.getByLabel('Total purchase price').fill('350');
  await lot.getByRole('button', { name: 'Add a cost' }).click();
  await lot.getByLabel('Cost 1 name').fill('Freight');
  await lot.getByLabel('Cost 1 amount').fill('30');
  await lot.getByLabel('Where you bought it').fill('Midwest Liquidation');
  await lot.getByTestId('source-type').selectOption('liquidation');
  await lot.getByTestId('lot-next').click();
  for (const [i, [name, qty, est]] of [
    ['Hand tools', '20', '30'],
    ['Drills', '10', '40'],
  ].entries()) {
    if (i > 0) await lot.getByTestId('lot-add-line').click();
    const row = lot.getByTestId('lot-line').nth(i);
    await row.getByLabel('Item name').fill(name);
    await row.getByRole('textbox', { name: 'Quantity', exact: true }).fill(qty);
    await row.getByLabel('Est. resale value, per item').fill(est);
    await row.getByRole('button', { name: 'Category, condition, notes' }).click();
    await row.getByLabel('Category').fill('Tools');
  }
  await lot.getByTestId('lot-next').click();
  await lot.getByTestId('lot-save').click();
  await expect(lot).toBeHidden();

  // An item with no source, and one typed with a slightly different spelling.
  await nav(page, 'Inventory');
  await addItem(page, { name: 'Old lamp', cost: '8' });
  await page.getByRole('button', { name: /^Add (item|your first item)$/ }).first().click();
  await form.getByLabel('Item name').fill('Pyrex mug');
  await form.getByLabel('Cost per item').fill('2');
  await form.getByRole('button', { name: /More details/ }).click();
  await form.getByLabel('Where you bought it').fill('saturday garage sale');
  await expect(form.getByTestId('source-similar')).toContainText('Did you mean Saturday garage sales?');
  await form.getByTestId('source-similar').getByRole('button', { name: 'Saturday garage sales' }).click();
  await expect(form.getByLabel('Where you bought it')).toHaveValue('Saturday garage sales');
  await expect(form.getByTestId('source-type')).toHaveCount(0); // an existing source: nothing new is added
  await form.getByRole('button', { name: 'Add item' }).click();
  await expect(form).toBeHidden();
  // A lot item shows the lot's source instead of its own field.
  await page.getByTestId('inventory-item').filter({ hasText: 'Drills' }).first().click();
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(form.getByRole('button', { name: /More details/ })).toHaveAttribute('aria-expanded', 'true'); // open when editing
  await expect(form.getByTestId('item-lot-source')).toContainText('Midwest Liquidation');
  await form.getByRole('button', { name: 'Cancel' }).click();

  await sell(page, 'Vinyl records', 10, '28', '30', '20');
  await sell(page, 'Hand tools', 20, '35', '70', '30');
  await sell(page, 'Drills', 5, '80', '40', '36');
  await sell(page, 'Old lamp', 1, '25', '5');

  await openSourcing(page);
  // $180 + $620 + $12: the same realized profit as Sales & Profit, split by where it was bought.
  await expect(page.getByTestId('sourcing-profit')).toContainText('$812.00');
  await expect(page.getByTestId('source-card')).toHaveCount(3);
  await expect(card(page, 'Midwest Liquidation')).toContainText(/Realized profit\s*\$620\.00/);
  await expect(card(page, 'Midwest Liquidation')).toContainText('Liquidation');
  await expect(card(page, 'Midwest Liquidation')).toContainText('Still selling');
  // Partly sold lot: cost of goods sold is only the sold units' share, never the whole $380.
  await expect(card(page, 'Midwest Liquidation')).toContainText(/Cost of goods sold\s*\$304\.00/);
  await expect(card(page, 'Midwest Liquidation')).toContainText(/Tied up in stock\s*\$76\.00/);
  await expect(card(page, 'Saturday garage sales')).toContainText(/Realized profit\s*\$180\.00/);
  await expect(card(page, 'Unassigned source')).toContainText(/Realized profit\s*\$12\.00/);
  await expect(card(page, 'Unassigned source')).toContainText('Small sample');
  await expect(page.getByTestId('sourcing-tied')).toContainText('$78.00'); // 5 drills + the mug
  await expect(page.getByTestId('chart-profit')).toContainText('Midwest Liquidation');
  await expect(page.getByTestId('by-type')).toContainText(/Garage \/ yard sale\$280\.00\$50\.00\$180\.00/);
  await expect(page.getByTestId('sourcing-pph')).toContainText('Not enough time data');

  // Filters: the Tools category is only the pallet.
  await page.getByTestId('sourcing-filters').getByLabel('Category').selectOption({ label: 'Tools' });
  await expect(page.getByTestId('sourcing-profit')).toContainText('$620.00');
  await expect(page.getByTestId('source-card')).toHaveCount(1);
  await page.getByTestId('sourcing-filters').getByLabel('Category').selectOption({ label: 'All categories' });
  await noHorizontalOverflow(page);
  await axe(page);

  // One source per place: the mug didn't create a second garage-sale source.
  await page.getByTestId('sourcing-tabs').getByRole('tab', { name: 'Sources' }).click();
  await expect(page.getByTestId('source-row')).toHaveCount(2);
  await expect(page.getByTestId('sources-unassigned').getByTestId('unassigned-record')).toHaveText([/Old lamp/]);
  await noHorizontalOverflow(page);
  await axe(page);

  // Every figure links back to its records.
  await page.getByTestId('sourcing-tabs').getByRole('tab', { name: 'Overview' }).click();
  await card(page, 'Midwest Liquidation').getByRole('link', { name: 'Midwest Liquidation' }).click();
  await expect(page.getByTestId('source-purchases')).toContainText('Lot: Pallet A');
  await expect(page.getByTestId('source-purchases')).toContainText('$380.00');
  await expect(page.getByTestId('source-sale')).toHaveCount(2);
  await expect(page.getByTestId('source-sales')).toContainText('$700.00 − $228.00 − $100.00 = $372.00');
  await noHorizontalOverflow(page);
});

function seededBackup(): string {
  const { data } = shop();
  return JSON.stringify(createBackup('real', { ...defaultSettings(), onboarded: true }, data, []));
}

test('time, trips and source changes: timer survives reloads, shared time is split once, renames keep history', async ({ page }, testInfo) => {
  await page.clock.install({ time: NOW });
  await onboard(page, 'Reseller');
  const file = testInfo.outputPath('sourcing-backup.json');
  writeFileSync(file, seededBackup());
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  const restore = page.getByTestId('restore-dialog');
  await restore.getByTestId('restore-file').setInputFiles(file);
  await restore.getByRole('button', { name: 'Replace my data' }).click();
  await expect(restore).toBeHidden();

  // The specification's example: $180 over 20 h vs $620 over 20 h.
  await openSourcing(page, 'Profit per hour');
  await expect(page.getByTestId('pph-formula')).toHaveText('$812.00 realized profit ÷ 40 h logged (all time) = $20.30 per logged hour');
  await expect(page.getByTestId('pph-sources')).toContainText(/Midwest Liquidation[\s\S]*\$31\.00/);
  await expect(page.getByTestId('pph-sources')).toContainText(/Saturday garage sales[\s\S]*\$9\.00/);
  await expect(page.getByTestId('pph-categories')).toContainText(/Tools[\s\S]*\$41\.33/);
  await page.getByRole('radio', { name: 'This month' }).click();
  await expect(page.getByTestId('pph-none')).toContainText('Not enough time data');
  await page.getByRole('radio', { name: 'All time' }).click();
  await noHorizontalOverflow(page);
  await axe(page);

  // The timer is saved with your data: it survives reloads, paused or running.
  await page.getByTestId('sourcing-tabs').getByRole('tab', { name: 'Time log' }).click();
  await page.getByTestId('timer-activity').selectOption('listing');
  await page.getByTestId('timer-start').click();
  await page.clock.fastForward('25:00');
  await expect(page.getByTestId('timer-elapsed')).toHaveText(/^0:25:0\d$/);
  await page.getByTestId('timer-pause').click();
  await reloadWhenSaved(page);
  await expect(page.getByTestId('timer')).toContainText('paused');
  await expect(page.getByTestId('timer-elapsed')).toHaveText(/^0:25:0\d$/);
  await page.getByTestId('timer-resume').click();
  await page.clock.fastForward('20:00');
  await reloadWhenSaved(page);
  await expect(page.getByTestId('timer')).toContainText('running');
  await expect(page.getByTestId('timer-elapsed')).toHaveText(/^0:45:\d\d$/);
  await page.getByTestId('timer-stop').click();
  await expect(page.getByTestId('timer-start')).toBeVisible();
  await expect(page.getByTestId('time-entry').first()).toContainText('45 min · Listing & photos');
  await expect(page.getByTestId('time-entry').first()).toContainText('General work (not linked)');

  // Two hours shared 70/30 between two sources: counted once, divided by the shares.
  await page.getByTestId('time-new').click();
  const dlg = page.getByTestId('time-dialog');
  await dlg.getByTestId('time-hours').fill('2');
  await dlg.getByTestId('time-activity').selectOption('sourcing');
  await dlg.getByTestId('time-add-link').click();
  await dlg.getByTestId('time-add-link').click();
  for (const [i, name, pct] of [
    [0, 'Midwest Liquidation', '70'],
    [1, 'Saturday garage sales', '20'],
  ] as const) {
    const link = dlg.getByTestId('time-link').nth(i);
    await link.getByLabel(`Link ${i + 1} kind`).selectOption('source');
    await link.getByLabel(`Link ${i + 1}`, { exact: true }).selectOption({ label: name });
    if (i === 0) await dlg.getByTestId('time-split').selectOption('custom');
    await link.getByLabel(`Link ${i + 1} share (%)`).fill(pct);
  }
  await dlg.getByTestId('time-save').click();
  await expect(dlg).toContainText('The shares must add up to 100%.');
  await dlg.getByLabel('Link 2 share (%)').fill('30');
  await dlg.getByTestId('time-save').click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId('time-entry').filter({ hasText: '2 h · Sourcing' })).toContainText('Source: Midwest Liquidation (70%) · Source: Saturday garage sales (30%)');

  await page.getByTestId('sourcing-tabs').getByRole('tab', { name: 'Profit per hour' }).click();
  // 40 h + 45 min + 2 h = 42.75 h; Midwest 21.4 h, garage 20.6 h.
  await expect(page.getByTestId('pph-formula')).toHaveText('$812.00 realized profit ÷ 42.75 h logged (all time) = $18.99 per logged hour');
  await expect(page.getByTestId('pph-sources')).toContainText('Midwest Liquidation$28.97/h$620.00 ÷ 21.4 h');
  await expect(page.getByTestId('pph-sources')).toContainText('Saturday garage sales$8.74/h$180.00 ÷ 20.6 h');
  await expect(page.getByTestId('pph-summary')).toContainText('0.75 h of general work');

  // A trip: link what was bought on it (no purchase is added); completed once all of it sold.
  await page.getByTestId('sourcing-tabs').getByRole('tab', { name: 'Trips' }).click();
  await page.getByTestId('trip-new').click();
  const trip = page.getByTestId('trip-dialog');
  await trip.getByLabel('Trip name').fill('Saturday loop');
  await trip.getByLabel('Date').fill('2026-09-05');
  await trip.getByRole('checkbox', { name: 'Saturday garage sales' }).check();
  await trip.getByTestId('trip-add-expense').click();
  await trip.getByLabel('Expense 1', { exact: true }).fill('Parking');
  await trip.getByLabel('Expense 1 amount').fill('10');
  await trip.getByLabel('Expense 1 kind').selectOption('acquisition');
  await trip.getByTestId('trip-save').click();
  await expect(trip).toBeHidden();
  await page.getByTestId('trip-card').filter({ hasText: 'Saturday loop' }).getByRole('link', { name: 'Saturday loop' }).click();
  await page.getByTestId('trip-link').selectOption({ label: 'Vinyl records' });
  await expect(page.getByText('Linked to the trip. No purchase was added.')).toBeVisible();
  const figures = page.getByTestId('trip-figures');
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await expect(figures).toContainText(/Bought\s*\$50\.00 · 10 units/);
  await expect(figures).toContainText(/Trip result\s*\$170\.00/); // $280 − $50 selling − $50 bought − $10 parking
  await expect(figures).toContainText(/Return\s*283\.33%/);
  await noHorizontalOverflow(page);
  await axe(page);
  await page.goto('./#/insights/sourcing?tab=trips');
  await expect(page.getByTestId('trips-best')).toContainText('Saturday loop');

  // Rename: the old name stays as an alias, so the lot typed "Midwest Liquidation" keeps its history.
  await page.getByTestId('sourcing-tabs').getByRole('tab', { name: 'Sources' }).click();
  await page.getByRole('button', { name: 'Edit Midwest Liquidation' }).click();
  const src = page.getByTestId('source-dialog');
  // The dialog fills in the current name just after opening; typing before that would be appended to it.
  await expect(src.getByLabel('Name')).toHaveValue('Midwest Liquidation');
  await src.getByLabel('Name').fill('Midwest Liquidators LLC');
  await expect(src).toContainText('Renaming keeps the old name as an alias');
  await src.getByTestId('source-save').click();
  await expect(src).toBeHidden();
  await expect(page.getByTestId('sources-log')).toContainText('Renamed “Midwest Liquidation” to “Midwest Liquidators LLC”');
  // Assigning a source to an unassigned record is explicit and logged.
  await page.getByTestId('unassigned-record').filter({ hasText: 'Old lamp' }).getByRole('combobox').selectOption({ label: 'Saturday garage sales' });
  await expect(page.getByTestId('sources-unassigned')).toHaveCount(0);
  await expect(page.getByTestId('sources-log')).toContainText('Old lamp');
  await noHorizontalOverflow(page);
  await axe(page);

  await page.getByTestId('sourcing-tabs').getByRole('tab', { name: 'Overview' }).click();
  await expect(card(page, 'Midwest Liquidators LLC')).toContainText(/Realized profit\s*\$620\.00/);
  await expect(card(page, 'Saturday garage sales')).toContainText(/Realized profit\s*\$192\.00/);
  await expect(card(page, 'Unassigned source')).toHaveCount(0);
  await expect(page.getByTestId('sourcing-profit')).toContainText('$812.00'); // unchanged in total

  // Everything persists.
  await reloadWhenSaved(page);
  await expect(card(page, 'Midwest Liquidators LLC')).toContainText(/Realized profit\s*\$620\.00/);

  // The assistant answers from the same figures, with the records behind them.
  await nav(page, 'Smart Insights');
  const assistant = page.getByTestId('assistant');
  for (const [q, expected] of [
    ['What is my profit per hour?', 'Your realized profit per logged hour all time is $18.99: $812.00 realized profit ÷ 42.75 h logged.'],
    ['Where do I make the most money?', 'Midwest Liquidators LLC has made you the most all time: $620.00 realized profit'],
    ['Which sourcing trips were most successful?', 'Your most successful completed trip was Saturday loop'],
  ]) {
    await assistant.getByLabel('Ask a question').fill(q);
    await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(assistant.getByTestId('assistant-answer').last()).toContainText(expected);
  }
  await expect(assistant.getByTestId('assistant-answer').last().getByTestId('calculation-lines')).toContainText(/Trip result\s*\$170\.00/);
});
