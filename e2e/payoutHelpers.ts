// Shared by the payout reconciliation and assistant browser tests: a seller with five eBay sales
// recorded in StockPilot, and sanitized eBay reports from src/marketplace/fixtures to import.

import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import { addItem, nav, onboard } from './helpers';

export const fixture = (name: string) => ({ name, mimeType: 'text/csv', buffer: readFileSync(new URL(`../src/marketplace/fixtures/${name}`, import.meta.url)) });
export const FEB = 'ebay-transactions-2026-02.csv';
export const MAR = 'ebay-transactions-2026-03.csv';
export const PAYOUTS = 'ebay-payouts-2026-02.csv';

export interface Recorded {
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
export const RECORDED: Recorded[] = [
  { name: 'Nike Air Max 90 size 10', sku: 'SNK-001', cost: '40', price: '120', fees: '15.82', shipping: '9.45', date: '2026-01-28', order: '11-00001-00001' },
  { name: 'Sony WH-1000XM4 headphones', sku: 'EL-002', cost: '85', price: '180', fees: '24.25', date: '2026-01-30', order: '11-00002-00002' },
  { name: 'Levi’s denim jacket', sku: 'CL-003', cost: '12', price: '73.50', fees: '9.74', shipping: '8.50', date: '2026-01-31', order: '11-00003-00003' },
  { name: 'Coach wallet', sku: 'AC-005', cost: '9', price: '35', fees: '3.75', date: '2026-02-12', order: '11-00005-00005' },
  { name: 'Pyrex bowl', sku: 'HW-006', cost: '4', price: '37', fees: '5.30', date: '2026-02-14', order: '11-00006-00006' },
];

export async function recordEbaySale(page: Page, s: Recorded, withOrder = true) {
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

export async function setUpSeller(page: Page, sales: Recorded[] = RECORDED) {
  await onboard(page, 'Reseller');
  for (const s of sales) await addItem(page, { name: s.name, quantity: 1, cost: s.cost, sku: s.sku });
  for (const s of sales) await recordEbaySale(page, s);
}

export async function importReport(page: Page, name: string) {
  await page.goto('./#/sales/payouts');
  await page.getByRole('button', { name: 'Import eBay report' }).first().click();
  const d = page.getByTestId('payout-import');
  await d.getByTestId('payout-file').setInputFiles(fixture(name));
  await expect(d.getByTestId('payout-import-preview')).toBeVisible();
  await d.getByTestId('payout-import-run').click();
  await expect(d).toBeHidden();
  await expect(page).toHaveURL(/#\/sales\/payouts$/);
}
