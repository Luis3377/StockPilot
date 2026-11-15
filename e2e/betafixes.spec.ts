// Manual beta testing, first fix round: the critical financial findings, checked in the browser
// on desktop and an iPhone-sized viewport (no sideways scrolling, axe).

import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { nav, noHorizontalOverflow, onboard } from './helpers';
import { FEB, importReport, PAYOUTS, setUpSeller } from './payoutHelpers';
import { at, sell, tracked } from '../src/insights/closeFixture';
import { addItem, adjustQuantity, recordSale } from '../src/domain/actions';
import { startLedger, trackChanges } from '../src/domain/ledger';
import { createBidPlan, defaultAssumptions, lotPrefillFromPlan, recordBidPurchase } from '../src/domain/bids';
import { createBackup } from '../src/data/backup';
import { defaultSettings, emptyData, type AppData } from '../src/domain/types';

async function axe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).exclude('.animate-toast-in').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);
}

async function restore(page: Page, data: AppData, file: string) {
  writeFileSync(file, JSON.stringify(createBackup('real', { ...defaultSettings(), onboarded: true }, data, [])));
  await nav(page, 'Settings');
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  const dialog = page.getByTestId('restore-dialog');
  await dialog.getByTestId('restore-file').setInputFiles(file);
  await dialog.getByRole('button', { name: 'Replace my data' }).click();
  await expect(dialog).toBeHidden();
}

/** Bought and mostly sold before the inventory ledger began (Nov 14, 2026); more sold after. */
function midYear(): AppData {
  let data = emptyData();
  const phones = addItem(data, { name: 'Headphones', quantity: 10, unitCost: 100, purchaseDate: '2026-02-01' }, at('2026-02-01'));
  data = phones.data;
  data = recordSale(data, { itemId: phones.item.id, quantity: 6, salePrice: 900, priceMode: 'total', saleDate: '2026-03-10' }, at('2026-03-10')).data;
  data = startLedger(data, at('2026-11-14'));
  const mug = trackChanges(data, addItem(data, { name: 'Mug', quantity: 3, unitCost: 8, purchaseDate: '2026-11-15' }, at('2026-11-15')).data, at('2026-11-15'));
  data = sell(mug, mug.items.find((i) => i.name === 'Mug')!.id, 1, 20, '2026-11-20', 2, 3).data;
  return sell(data, phones.item.id, 1, 150, '2026-11-21').data;
}

test('year-end: when the inventory records began mid-year, sales cost of goods sold and the covered part are shown apart', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2027-02-10T10:00:00') });
  await onboard(page, 'Reseller');
  await restore(page, midYear(), testInfo.outputPath('midyear.json'));
  await nav(page, 'Sales & Profit');
  await page.getByTestId('yearend-link').click();
  await expect(page.getByTestId('year-select')).toHaveValue('2026');
  await expect(page.getByTestId('ye-cogs')).toContainText('$708.00');
  await expect(page.getByTestId('ye-cogs-ledger')).toContainText('$108.00');
  await expect(page.getByTestId('ye-cogs-ledger')).toContainText('1 sale recorded before the records began ($600.00)');
  await expect(page.getByTestId('ye-beginning')).toContainText('Inventory when records began (Nov 14, 2026)');
  const ws = page.getByTestId('year-worksheet');
  await ws.getByText('Optional: worksheet for a tax preparer').click();
  await expect(ws.getByTestId('worksheet-cogs')).toContainText('Only $108.00 of 2026’s $708.00 cost of goods sold is in the inventory records.');
  await expect(ws.getByTestId('worksheet-bridge')).toHaveCount(0);
  await expect(ws.getByTestId('worksheet-line').filter({ hasText: 'Line 42.' })).toContainText(/—\s*Needs review/);
  await expect(ws.getByTestId('worksheet-line').filter({ hasText: 'Line 42.' })).toContainText('isn’t a substitute');
  await noHorizontalOverflow(page);
  await axe(page);
});

test('a sale dated before the purchase is explained and needs a reason', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-11-15T10:00:00') });
  await onboard(page, 'Reseller');
  await restore(page, addItem(emptyData(), { name: 'Sony WH-1000XM4 Headphones', quantity: 1, unitCost: 120, askingPrice: 165, purchaseDate: '2026-06-17' }, at('2026-06-17')).data, testInfo.outputPath('sony.json'));
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: 'Record sale' }).first().click();
  const d = page.getByTestId('sale-form');
  await d.getByLabel('Item sold').selectOption({ index: 1 });
  await d.getByLabel('Sale price').fill('165');
  await d.getByLabel('Sale date').fill('2026-01-30');
  await expect(d.getByTestId('sale-before-purchase')).toContainText('The sale date (Jan 30, 2026) is before “Sony WH-1000XM4 Headphones” was bought (Jun 17, 2026).');
  await noHorizontalOverflow(page);
  await d.getByRole('button', { name: 'Record sale' }).click();
  await expect(d.getByTestId('sale-before-purchase')).toContainText('Say why, or correct the dates.');
  await expect(d).toBeVisible();
  await d.getByTestId('sale-date-reason').fill('Preorder paid in January');
  await d.getByRole('button', { name: 'Record sale' }).click();
  await expect(d).toBeHidden();
  await expect(page.getByText(/Sale recorded/)).toBeVisible();
});

test('payouts: only completed payouts count as paid out; the pending one is shown apart', async ({ page }) => {
  await setUpSeller(page);
  await importReport(page, FEB);
  await importReport(page, PAYOUTS);
  await expect(page.getByTestId('payout-paid')).toContainText('$389.93');
  await expect(page.getByTestId('payout-paid')).toContainText('3 completed payouts · $31.25 pending (1 payout)');
  await noHorizontalOverflow(page);
  await axe(page);
});

test('a purchased Max Bid plan is a read-only prediction that can’t be deleted', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-11-15T10:00:00') });
  await onboard(page, 'Reseller');
  const a = { ...defaultAssumptions(), valueMode: 'items' as const, items: [{ id: 'x', name: 'Mixer', quantity: 1, unitValue: 120, category: 'Kitchen', condition: '', notes: '', aiFields: [] }] };
  const r = createBidPlan(emptyData(), { name: 'Storage unit #14', description: '', kind: 'storage_unit', assumptions: a }, at('2026-11-01'));
  const { input, lineBidItemIds } = lotPrefillFromPlan(r.plan, 40, '2026-11-02');
  const bought = recordBidPurchase(r.data, r.plan.id, input, lineBidItemIds, at('2026-11-02'));
  await restore(page, bought.data, testInfo.outputPath('plan.json'));
  await page.goto(`./#/inventory/bids/${r.plan.id}`);
  await expect(page.getByTestId('bid-readonly')).toContainText('Read-only: a historical prediction.');
  await expect(page.getByTestId('bid-delete')).toHaveCount(0);
  await expect(page.getByTestId('bid-duplicate')).toBeVisible();
  await noHorizontalOverflow(page);
});

test('documented inventory losses are shown next to realized profit, not as net income', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-11-15T10:00:00') });
  await onboard(page, 'Reseller');
  let data = startLedger(emptyData(), at('2026-11-01'));
  const mug = tracked(data, '2026-11-02', (d) => addItem(d, { name: 'Coffee mug', quantity: 3, unitCost: 8, purchaseDate: '2026-11-02' }, at('2026-11-02')));
  data = sell(mug.data, mug.item.id, 1, 20, '2026-11-05', 2, 3).data; // $7 profit
  data = tracked(data, '2026-11-10', (d) => adjustQuantity(d, mug.item.id, 1, 'Count: missing', at('2026-11-10'))).data; // −$8
  await restore(page, data, testInfo.outputPath('mugs.json'));
  await nav(page, 'Sales & Profit');
  await expect(page.getByTestId('sales-net')).toContainText('$7.00');
  const card = page.getByTestId('inventory-losses');
  await expect(card.getByTestId('loss-losses')).toContainText('−$8.00');
  await expect(card.getByTestId('loss-after')).toContainText('−$1.00');
  await expect(card).toContainText('Not net income');
  await noHorizontalOverflow(page);
  await axe(page);
});
