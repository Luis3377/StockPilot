// Marketplace Payout Reconciliation (Signature Feature 2), with sanitized eBay reports from
// src/marketplace/fixtures. No marketplace is contacted: reports are files the user imports.

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addItem, nav, noHorizontalOverflow, onboard, reloadWhenSaved } from './helpers';

const fixture = (name: string) => ({ name, mimeType: 'text/csv', buffer: readFileSync(new URL(`../src/marketplace/fixtures/${name}`, import.meta.url)) });
const FEB = 'ebay-transactions-2026-02.csv';
const MAR = 'ebay-transactions-2026-03.csv';
const PAYOUTS = 'ebay-payouts-2026-02.csv';

interface Recorded {
  name: string;
  sku: string;
  cost: string;
  price: string;
  fees: string;
  shipping?: string;
  date: string;
  order: string;
}

/** What the seller recorded in StockPilot (the Pokémon card lot, order 11-00004-00004, wasn't). */
const RECORDED: Recorded[] = [
  { name: 'Nike Air Max 90 size 10', sku: 'SNK-001', cost: '40', price: '120', fees: '15.82', shipping: '9.45', date: '2026-01-28', order: '11-00001-00001' },
  { name: 'Sony WH-1000XM4 headphones', sku: 'EL-002', cost: '85', price: '180', fees: '24.25', date: '2026-01-30', order: '11-00002-00002' },
  { name: 'Levi’s denim jacket', sku: 'CL-003', cost: '12', price: '73.50', fees: '9.74', shipping: '8.50', date: '2026-01-31', order: '11-00003-00003' },
  { name: 'Coach wallet', sku: 'AC-005', cost: '9', price: '35', fees: '3.75', date: '2026-02-12', order: '11-00005-00005' },
  { name: 'Pyrex bowl', sku: 'HW-006', cost: '4', price: '37', fees: '5.30', date: '2026-02-14', order: '11-00006-00006' },
];

async function recordSale(page: Page, s: Recorded, withOrder = true) {
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: /^Record (sale|your first sale)$/ }).first().click();
  const d = page.getByTestId('sale-form');
  const select = d.getByLabel('Item sold');
  await select.selectOption((await select.locator('option', { hasText: s.name }).first().getAttribute('value'))!);
  await d.getByLabel('Sale price').fill(s.price);
  await d.getByLabel('Where did it sell?').fill('eBay');
  if (withOrder) await d.getByLabel('Order number (optional)').fill(s.order);
  await d.getByLabel('Marketplace fees').fill(s.fees);
  if (s.shipping) await d.getByLabel('Shipping you paid').fill(s.shipping);
  await d.getByLabel('Sale date').fill(s.date);
  await d.getByRole('button', { name: 'Record sale' }).click();
  await expect(d).toBeHidden();
}

async function setUpSeller(page: Page, sales: Recorded[] = RECORDED) {
  await onboard(page, 'Reseller');
  for (const s of sales) await addItem(page, { name: s.name, quantity: 1, cost: s.cost, sku: s.sku });
  for (const s of sales) await recordSale(page, s);
}

async function importReport(page: Page, name: string) {
  await page.goto('./#/sales/payouts');
  await page.getByRole('button', { name: 'Import eBay report' }).first().click();
  const d = page.getByTestId('payout-import');
  await d.getByTestId('payout-file').setInputFiles(fixture(name));
  await expect(d.getByTestId('payout-import-preview')).toBeVisible();
  await d.getByTestId('payout-import-run').click();
  await expect(d).toBeHidden();
  await expect(page).toHaveURL(/#\/sales\/payouts$/);
}

const payoutLink = (page: Page, date: string) => page.getByRole('link', { name: new RegExp(`eBay · ${date}`) }).filter({ visible: true }).first();

test('import previews the report first, then reconciles an exact payout to the cent', async ({ page }) => {
  await setUpSeller(page);
  await nav(page, 'Sales & Profit');
  await page.getByTestId('payouts-link').click();
  await expect(page.getByRole('heading', { name: 'Payout Reconciliation' })).toBeVisible();

  // Preview: nothing is saved until Import.
  await page.getByRole('button', { name: 'Import eBay report' }).first().click();
  const d = page.getByTestId('payout-import');
  await expect(d).toContainText('eBay transaction report: Seller Hub → Payments → Reports');
  await d.getByTestId('payout-file').setInputFiles(fixture(FEB));
  const preview = d.getByTestId('payout-import-preview');
  await expect(preview).toContainText('eBay transaction report · Jan 28, 2026 – Feb 14, 2026');
  await expect(preview).toContainText('10 new transactions');
  await expect(preview).toContainText(/Orders: 6\s*\$428\.35/);
  await expect(preview).toContainText(/Refunds: 1\s*-\$15\.50/);
  await expect(preview).toContainText('Importing doesn’t create or change any sales');
  await noHorizontalOverflow(page);
  await d.getByTestId('payout-import-run').click();
  await importReport(page, PAYOUTS);

  await expect(page.getByTestId('payout-count')).toContainText('4');
  await expect(page.getByTestId('payout-not-paid')).toContainText('$31.70');
  await expect(page.getByTestId('payout-not-paid')).toContainText('on hold by eBay');
  await noHorizontalOverflow(page);

  await payoutLink(page, 'Feb 2, 2026').click();
  await expect(page.getByTestId('payout-status')).toContainText('Reconciled');
  await expect(page.getByTestId('payout-status')).toContainText('Your records and the payout agree to the cent.');
  const calc = page.getByTestId('payout-calculation');
  await expect(calc.getByTestId('expected-sales')).toContainText('$300.00');
  await expect(calc.getByTestId('expected-fees')).toContainText('-$40.07');
  await expect(calc.getByTestId('expected-labels')).toContainText('-$9.45');
  await expect(calc.getByTestId('payout-expected')).toContainText('$250.48');
  await expect(calc.getByTestId('payout-actual')).toContainText('$250.48');
  await expect(calc.getByTestId('payout-difference')).toContainText('$0.00');
  await expect(page.getByTestId('payout-profit')).toContainText('$300.00 sales − $125.00 what the items cost you');
  await expect(page.getByTestId('payout-transactions').getByTestId('payout-txn')).toHaveCount(3);
  await expect(page.getByTestId('payout-transactions')).toContainText('Matched to the sale of Nike Air Max 90 size 10');
  await noHorizontalOverflow(page);
});

test('an incorrect payout explains every cent, and decisions are recorded with a reason', async ({ page }) => {
  await setUpSeller(page);
  await importReport(page, FEB);
  await importReport(page, PAYOUTS);
  await payoutLink(page, 'Feb 9, 2026').click();

  await expect(page.getByTestId('payout-status')).toContainText('Unreconciled');
  const calc = page.getByTestId('payout-calculation');
  await expect(calc.getByTestId('expected-refunds')).toContainText('-$15.50');
  await expect(calc.getByTestId('payout-expected')).toContainText('$39.76');
  await expect(calc.getByTestId('payout-actual')).toContainText('$77.82');
  await expect(calc.getByTestId('payout-difference')).toContainText('+$38.06');
  await expect(calc.getByTestId('payout-unexplained')).toContainText('$0.00');

  const findings = page.getByTestId('payout-finding');
  await expect(findings).toHaveCount(3);
  await expect(findings.nth(0)).toContainText('Possible explanation');
  await expect(findings.nth(0)).toContainText('Sale not recorded in StockPilot: order 11-00004-00004');
  await expect(findings.nth(0)).toContainText('+$42.11');
  await expect(findings.nth(1)).toContainText('Confirmed');
  await expect(findings.nth(1)).toContainText('Marketplace fees differ: order 11-00003-00003');
  await expect(findings.nth(1)).toContainText('Promoted Listings - General fee');
  await expect(findings.nth(1)).toContainText('-$3.65');
  await expect(findings.nth(2)).toContainText('Shipping label cost differs');
  await expect(findings.nth(2)).toContainText('-$0.40');
  await expect(page.getByTestId('payout-explanation')).toContainText('Difference: +$38.06 (the payout is higher than expected).');

  // The refund is an adjustment to review; marking it needs a reason.
  const adjustment = page.getByTestId('payout-adjustment');
  await expect(adjustment).toContainText('Refund');
  await expect(adjustment).toContainText('Sale: Sony WH-1000XM4 headphones');
  await adjustment.getByRole('button', { name: 'Mark reviewed…' }).click();
  const reason = page.getByTestId('reason-dialog');
  await reason.getByTestId('reason-save').click();
  await expect(reason).toContainText('Say why');
  await reason.getByRole('button', { name: 'Edited the sale to reflect it' }).click();
  await reason.getByTestId('reason-save').click();
  await expect(reason).toBeHidden();
  await expect(adjustment).toContainText('Reviewed: “Edited the sale to reflect it”');

  // Record the missing sale through the normal sale form, pre-filled from eBay's order.
  await addItemForMissingSale(page);
  await payoutLinkAfterNav(page, 'Feb 9, 2026');
  await findings.nth(0).getByRole('button', { name: 'Record this sale' }).click();
  const sale = page.getByTestId('sale-form');
  await expect(sale.getByLabel('Order number (optional)')).toHaveValue('11-00004-00004');
  await expect(sale.getByLabel('Sale price')).toHaveValue('49.00');
  await expect(sale.getByLabel('Marketplace fees')).toHaveValue('6.89');
  const select = sale.getByLabel('Item sold');
  await select.selectOption((await select.locator('option', { hasText: 'Pokemon card lot' }).first().getAttribute('value'))!);
  await sale.getByRole('button', { name: 'Record sale' }).click();
  await expect(sale).toBeHidden();
  await expect(findings).toHaveCount(2);
  await expect(calc.getByTestId('payout-difference')).toContainText('-$4.05');

  // Accept what's left, with a reason. The difference stays visible.
  await page.getByTestId('accept-difference').click();
  await reason.getByLabel('Reason').fill('Fees and label were higher than I entered; will fix next month');
  await reason.getByTestId('reason-save').click();
  await expect(page.getByTestId('payout-status')).toContainText('Reconciled');
  await expect(page.getByTestId('payout-status')).toContainText('Difference of -$4.05 explained by you');
  await expect(calc.getByTestId('payout-difference')).toContainText('-$4.05');
  await expect(page.getByTestId('payout-history')).toContainText('Accepted a difference of -$4.05 on payout 5000000002. Reason: “Fees and label were higher than I entered; will fix next month”.');

  // Saved on the device.
  await reloadWhenSaved(page);
  await expect(page.getByTestId('payout-status')).toContainText('Reconciled');

  // Withdrawing the decision reopens it.
  await page.getByRole('button', { name: 'Withdraw' }).first().click();
  await expect(page.getByTestId('payout-status')).toContainText('Unreconciled');
});

async function addItemForMissingSale(page: Page) {
  await nav(page, 'Inventory');
  await addItem(page, { name: 'Pokemon card lot', quantity: 1, cost: '10', sku: 'CC-004' });
}

async function payoutLinkAfterNav(page: Page, date: string) {
  await page.goto('./#/sales/payouts');
  await payoutLink(page, date).click();
}

test('suggested matches need confirmation; a later report fills in held funds', async ({ page }) => {
  // The Nike sale was recorded without its order number.
  await onboard(page, 'Reseller');
  const nike = RECORDED[0];
  await addItem(page, { name: nike.name, quantity: 1, cost: nike.cost, sku: nike.sku });
  await recordSale(page, nike, false);
  await importReport(page, FEB);
  await importReport(page, PAYOUTS);
  await payoutLink(page, 'Feb 2, 2026').click();
  const finding = page.getByTestId('payout-finding').filter({ hasText: '11-00001-00001' });
  await expect(finding.getByTestId('match-candidate')).toContainText('Same SKU (SNK-001)');
  await finding.getByRole('button', { name: 'It’s this sale' }).click();
  await expect(page.getByTestId('payout-transactions')).toContainText('Matched to the sale of Nike Air Max 90 size 10');
  await expect(page.getByTestId('payout-transactions')).toContainText('(confirmed by you)');

  // March's report pays out the held Pyrex order and shows a payout with a missing row.
  await importReport(page, MAR);
  await expect(page.getByTestId('not-paid-out')).toHaveCount(0);
  await payoutLink(page, 'Mar 2, 2026').click();
  await expect(page.getByTestId('payout-finding').first()).toContainText('Payout is larger than the transactions imported for it');
  await expect(page.getByTestId('payout-finding').first()).toContainText('+$7.50');
});

test('duplicate, unsupported and broken files are explained and nothing is imported', async ({ page }) => {
  await onboard(page, 'Reseller');
  await importReport(page, FEB);
  await page.getByRole('button', { name: 'Import eBay report' }).first().click();
  const d = page.getByTestId('payout-import');
  await d.getByTestId('payout-file').setInputFiles(fixture(FEB));
  await expect(d.getByTestId('payout-import-duplicate')).toContainText('This file was already imported');
  await expect(d.getByTestId('payout-import-run')).toBeDisabled();

  await d.getByTestId('payout-file').setInputFiles({ name: 'inventory.csv', mimeType: 'text/csv', buffer: Buffer.from('Item Name,SKU,Qty\nMug,M1,2') });
  await expect(d.getByTestId('payout-import-error')).toContainText('StockPilot doesn’t recognise this file');
  await expect(d.getByTestId('payout-import-error')).toContainText('Columns in this file: Item Name, SKU, Qty');
  await expect(d.getByTestId('payout-import-run')).toBeDisabled();

  const broken = 'Transaction creation date,Type,Net amount\n2026-01-02,Order,abc';
  await d.getByTestId('payout-file').setInputFiles({ name: 'broken.csv', mimeType: 'text/csv', buffer: Buffer.from(broken) });
  await expect(d.getByTestId('payout-import-error')).toContainText('1 row couldn’t be read, so nothing will be imported');
  await expect(d.getByTestId('payout-import-error')).toContainText('Line 2: "Net amount" “abc” isn’t an amount.');
  await expect(d.getByTestId('payout-import-run')).toBeDisabled();
});

test('reconciliation data survives backup and restore', async ({ page }) => {
  await setUpSeller(page, RECORDED.slice(0, 2));
  await importReport(page, FEB);
  await importReport(page, PAYOUTS);
  await nav(page, 'Settings');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const file = JSON.parse(readFileSync(await download.path(), 'utf8'));
  expect(file.data.marketplace.transactions).toHaveLength(10);
  expect(file.data.sales[0].orderNumber).toBe('11-00001-00001');

  await page.getByRole('button', { name: 'Erase all data' }).click();
  const confirm = page.getByTestId('confirm-dialog');
  await confirm.getByRole('textbox').fill('DELETE');
  await confirm.getByRole('button', { name: 'Erase everything' }).click();
  await page.getByRole('button', { name: 'Restore from backup' }).click();
  const dialog = page.getByTestId('restore-dialog');
  await dialog.getByTestId('restore-file').setInputFiles(await download.path());
  await dialog.getByRole('button', { name: 'Replace my data' }).click();
  await expect(dialog).toBeHidden();
  await page.goto('./#/sales/payouts');
  await payoutLink(page, 'Feb 2, 2026').click();
  await expect(page.getByTestId('payout-status')).toContainText('Reconciled');
});

test('no accessibility violations on the payout screens', async ({ page }) => {
  const check = async (where: string) => {
    await page.waitForTimeout(600);
    const { violations } = await new AxeBuilder({ page }).exclude('.animate-toast-in').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(violations.map((v) => `${where}: ${v.id} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  };
  await setUpSeller(page, RECORDED.slice(0, 3));
  await page.goto('./#/sales/payouts');
  await check('empty dashboard');
  await importReport(page, FEB);
  await importReport(page, PAYOUTS);
  await check('dashboard');
  await payoutLink(page, 'Feb 9, 2026').click();
  await check('payout detail');
});
