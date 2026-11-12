// Year-End Review: the annual roll-forward, monthly coverage, a year-end count taken after
// Dec 31, the review checklist, finalizing, the accountant summary and its downloads, year and
// month locking together, reopening, and a year from before the inventory ledger began.

import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { nav, noHorizontalOverflow, onboard } from './helpers';
import { closeWholeMonth, countOn, yearShop } from '../src/insights/yearFixture';
import { addItem, recordSale } from '../src/domain/actions';
import { createBackup } from '../src/data/backup';
import { defaultSettings, emptyData, type AppData } from '../src/domain/types';

const NOW = new Date('2027-02-10T10:00:00');

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

const step = (page: Page, key: string) => page.locator(`[data-testid="close-step"][data-step="${key}"]`);

async function decide(page: Page, key: string, how: 'review' | 'ack', note = 'Discussed with the accountant.') {
  const s = step(page, key);
  await s.getByTestId(how === 'review' ? 'step-review' : 'step-ack').click();
  if (how === 'ack') {
    const d = page.getByTestId('decision-dialog');
    await d.getByTestId('decision-note').fill(note);
    await d.getByTestId('decision-save').click();
    await expect(d).toBeHidden();
  }
  await expect(s.getByTestId('step-undo')).toBeVisible();
}

async function download(page: Page, testId: string): Promise<[string, string]> {
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
  return [d.suggestedFilename(), readFileSync(await d.path(), 'utf8')];
}

/** The fixture shop, with September 2026 closed and a count on Jan 5, 2027 that found one plate missing (not applied). */
function seeded(): AppData {
  const s = yearShop();
  let data = closeWholeMonth(s.data, '2026-09', '2027-02-10');
  data = countOn(data, '2027-01-05', { [s.lamp.id]: 2, [s.plates.id]: 3 }, false).data;
  return data;
}

test('year-end review: reconcile, count, finalize, summary and exports, locks and reopening', async ({ page }, testInfo) => {
  await page.clock.install({ time: NOW });
  await onboard(page, 'Reseller');
  await restore(page, seeded(), testInfo.outputPath('year-backup.json'));

  await nav(page, 'Sales & Profit');
  await page.getByTestId('yearend-link').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Year-End Review');
  await expect(page.getByTestId('year-select')).toHaveValue('2026');
  await expect(page.getByTestId('ye-beginning')).toContainText(/\$120\.83\s*Verified/);
  await expect(page.getByTestId('ye-purchases')).toContainText('$108.00');
  await expect(page.getByTestId('ye-cogs')).toContainText('$35.33');
  await expect(page.getByTestId('ye-expected')).toContainText('$60.33');
  await expect(page.getByTestId('ye-independent')).toContainText('$60.33');
  await expect(page.getByTestId('ye-difference')).toContainText(/\$0\.00\s*Verified/);
  await expect(page.getByTestId('ye-coverage')).toContainText('1 of 12 months closed');
  await expect(page.locator('[data-testid="rf-line"][data-key="withdrawals"]')).toContainText('−$50.00');
  await expect(page.locator('[data-testid="rf-line"][data-key="returns"]')).toContainText('+$8.33');
  await expect(page.getByTestId('year-month')).toHaveCount(12);
  await expect(page.getByTestId('year-month').filter({ hasText: 'September 2026' })).toContainText('Closed and verified');
  await expect(page.getByTestId('year-month').filter({ hasText: 'March 2026' })).toContainText('Not closed');
  await noHorizontalOverflow(page);
  await axe(page);

  // The count on Jan 5, 2027 becomes the year-end count: rolled back to Dec 31, one plate missing.
  await page.getByTestId('year-count-select').selectOption({ index: 1 });
  await expect(page.getByTestId('year-count-basis')).toContainText('Physical count on Jan 5, 2027, after the year-end');
  await expect(page.getByTestId('year-count-line').filter({ hasText: 'Dinner plates' })).toContainText('Needs recount');
  await expect(page.getByTestId('ye-independent')).toContainText('$52.00');
  await expect(page.getByTestId('ye-difference')).toContainText('−$8.33');

  await decide(page, 'months', 'ack', 'Only September was closed this year; the accountant has the monthly sales export.');
  await decide(page, 'beginning', 'review');
  await decide(page, 'movements', 'ack', 'The rug was returned to the seller.');
  await decide(page, 'reconciliation', 'ack', 'One plate missing at the count; will recount.');
  await decide(page, 'count', 'ack', 'Recount scheduled.');
  await decide(page, 'report', 'review');
  await page.getByTestId('year-finalize').click();
  const fin = page.getByTestId('year-finalize-dialog');
  await expect(fin.getByTestId('year-unresolved')).toContainText('Recount Dinner plates');
  await fin.getByRole('checkbox').check();
  await fin.getByTestId('year-finalize-confirm').click();
  await expect(fin).toBeHidden();
  await expect(page.getByTestId('year-status')).toContainText('Finalized');
  await expect(page.getByTestId('year-finalized')).toContainText('$52.00');
  await noHorizontalOverflow(page);
  await axe(page);

  // The accountant summary, as finalized, and its downloads.
  await page.getByTestId('year-report-link').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Year-End Inventory Summary: 2026');
  await expect(page.getByTestId('year-report-disclaimer')).toContainText('not an audited financial statement or a tax return');
  await expect(page.getByTestId('year-report')).toContainText('On Jan 1, 2026 your inventory cost $120.83');
  await expect(page.getByTestId('year-report')).toContainText('Physical count at year-end: $52.00');
  await expect(page.getByTestId('year-report')).toContainText('Line 33 — Method used to value closing inventory: — [needs review]');
  const [htmlName, html] = await download(page, 'year-report-download');
  expect(htmlName).toBe('stockpilot-year-end-2026-v1.html');
  expect(html).toContain('<li>Expected inventory at Dec 31, 2026: $60.33</li>');
  const [, movements] = await download(page, 'csv-movements');
  expect(movements).toContain('2026-03-01,Withdrawn for personal use,Glass vase');
  const [, inventory] = await download(page, 'csv-inventory');
  expect(inventory).toContain('Desk lamp,SP-0001,Lighting,2,27');
  await noHorizontalOverflow(page);
  await axe(page);

  // A finalized year refuses changes to its months.
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: /^Record (sale|your first sale)$/ }).first().click();
  const sale = page.getByTestId('sale-form');
  const select = sale.getByLabel('Item sold');
  await select.selectOption((await select.locator('option', { hasText: 'Desk lamp' }).first().getAttribute('value'))!);
  await sale.getByLabel('Quantity sold').fill('1');
  await sale.getByLabel('Sale price').fill('30');
  await sale.getByLabel('Sale date').fill('2026-04-02');
  await expect(sale.getByLabel('Sale date')).toHaveValue('2026-04-02');
  await sale.getByRole('button', { name: /Record sale/ }).click();
  await expect(page.getByText('part of the finalized 2026 year-end review')).toBeVisible();
  await sale.getByRole('button', { name: 'Cancel' }).click();

  // Reopening a closed month inside the year flags the year; the finalized figures stay.
  await page.goto('./#/sales/close?month=2026-09');
  await page.getByTestId('close-reopen').click();
  await expect(page.getByTestId('reopen-year-warning')).toContainText('part of the finalized 2026 year-end review (version 1)');
  await page.getByTestId('reopen-reason').fill('Lamp sale price needs checking.');
  await page.getByTestId('reopen-confirm').click();
  await page.goto('./#/sales/year-end?year=2026');
  await expect(page.getByTestId('year-status')).toContainText('Finalized · needs re-review');
  await expect(page.getByTestId('year-flags')).toContainText('Reopened September 2026');
  await expect(page.getByTestId('year-finalized')).toContainText('$52.00');

  // Reopening the year needs a reason and keeps version 1.
  await page.getByTestId('year-reopen').click();
  await page.getByTestId('year-reopen-reason').fill('September to be corrected.');
  await page.getByTestId('year-reopen-confirm').click();
  await expect(page.getByTestId('year-status')).toContainText('Open');
  await expect(page.getByTestId('year-versions')).toContainText('Version 1 · finalized');
  await expect(page.getByTestId('year-versions')).toContainText('superseded');
  await expect(page.getByTestId('year-audit')).toContainText('September 2026 was reopened (Lamp sale price needs checking.)');

  await nav(page, 'Smart Insights');
  const assistant = page.getByTestId('assistant');
  await assistant.getByLabel('Ask a question').fill('How much inventory did I start the year with?');
  await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
  const answer = assistant.getByTestId('assistant-answer').last();
  await expect(answer).toContainText('You started 2026 with $120.83 of inventory at cost');
  await expect(answer.getByTestId('calculation-lines')).toContainText(/Inventory at the start of 2026\s*\$120\.83/);
});

test('a year before the inventory ledger: cannot fully verify, never a zero difference', async ({ page }, testInfo) => {
  await page.clock.install({ time: NOW });
  await onboard(page, 'Reseller');
  let data = addItem(emptyData(), { name: 'Bookshelf', quantity: 3, unitCost: 40, purchaseDate: '2025-06-01' }, { now: new Date('2025-06-01T12:00:00Z') }).data;
  data = recordSale(data, { itemId: data.items[0].id, quantity: 1, salePrice: 90, priceMode: 'total', saleDate: '2025-08-01' }, { now: new Date('2025-08-01T12:00:00Z') }).data;
  await restore(page, data, testInfo.outputPath('old-backup.json'));

  await page.goto('./#/sales/year-end?year=2025');
  await expect(page.getByTestId('ye-beginning')).toContainText(/Not available\s*Missing/);
  await expect(page.getByTestId('ye-difference')).toContainText(/Not available\s*Missing/);
  await expect(page.getByTestId('ye-missing')).toContainText('Cannot fully verify. Missing evidence: Inventory cost on Jan 1, 2025');
  await expect(page.getByTestId('ye-cogs')).toContainText('$40.00');
  await expect(page.getByTestId('year-month').filter({ hasText: 'March 2025' })).toContainText('Not fully verifiable');
  await noHorizontalOverflow(page);
  await axe(page);
});
