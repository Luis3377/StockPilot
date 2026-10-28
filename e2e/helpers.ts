import { expect, type Page } from '@playwright/test';

export type Mode = 'Reseller' | 'Collector' | 'Small business';

export function isMobile(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1000) < 1024;
}

/** Completes onboarding with a fresh, empty dataset (or demo data). */
export async function onboard(page: Page, mode: Mode = 'Reseller', demo = false) {
  await page.goto('./');
  await page.getByRole('radio', { name: new RegExp(`^${mode} Mode`) }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: demo ? /Explore with demo data/ : /Start with my own inventory/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  if (demo) await expect(page.getByTestId('demo-banner')).toBeVisible();
}

/** Clicks a main navigation entry (sidebar on desktop, bottom tabs on phones). */
export async function nav(page: Page, label: string) {
  const short: Record<string, string> = {
    'Sales & Profit': 'Sales',
    'Smart Insights': 'Insights',
    'Count Check': 'Count',
  };
  const name = isMobile(page) ? (short[label] ?? label) : label;
  // Links may carry an alert-count badge ("Smart Insights 4 alerts").
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: new RegExp(`^${escaped}( \\d+ alerts?)?$`) }).click();
}

export interface NewItem {
  name: string;
  quantity?: number;
  cost?: string;
  asking?: string;
  category?: string;
  sku?: string;
  location?: string;
}

export async function addItem(page: Page, item: NewItem) {
  await page.getByRole('button', { name: /^Add (item|your first item)$/ }).first().click();
  const dialog = page.getByTestId('item-form');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Item name').fill(item.name);
  await dialog.getByRole('textbox', { name: 'Quantity', exact: true }).fill(String(item.quantity ?? 1));
  await dialog.getByLabel('Cost per item').fill(item.cost ?? '10');
  if (item.asking !== undefined) await dialog.getByLabel(/Asking price|Selling price/).fill(item.asking);
  if (item.category) await dialog.getByLabel('Category').fill(item.category);
  if (item.sku || item.location) {
    await dialog.getByRole('button', { name: /More details/ }).click();
    if (item.sku) await dialog.getByLabel('SKU / ID').fill(item.sku);
    if (item.location) await dialog.getByLabel('Storage location').fill(item.location);
  }
  await dialog.getByRole('button', { name: 'Add item' }).click();
  await expect(dialog).toBeHidden();
}

export async function recordSale(page: Page, s: { item: string; quantity?: number; price: string; fees?: string; shipping?: string; other?: string; platform?: string }) {
  const dialog = page.getByTestId('sale-form');
  await expect(dialog).toBeVisible();
  const select = dialog.getByLabel('Item sold');
  const value = await select.locator('option', { hasText: s.item }).first().getAttribute('value');
  await select.selectOption(value!);
  await dialog.getByLabel('Quantity sold').fill(String(s.quantity ?? 1));
  await dialog.getByLabel('Sale price').fill(s.price);
  if (s.platform) await dialog.getByLabel('Where did it sell?').fill(s.platform);
  if (s.fees) await dialog.getByLabel('Marketplace fees').fill(s.fees);
  if (s.shipping) await dialog.getByLabel('Shipping you paid').fill(s.shipping);
  if (s.other) await dialog.getByLabel('Other expenses').fill(s.other);
  await dialog.getByRole('button', { name: /Record sale|Save changes/ }).click();
}

export async function openItem(page: Page, name: string) {
  await nav(page, 'Inventory');
  await page.getByTestId('inventory-item').filter({ hasText: name }).first().click();
  await expect(page.getByTestId('item-title')).toHaveText(name);
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'page should not scroll sideways').toBeLessThanOrEqual(1);
}
