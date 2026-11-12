// Monthly Close (Signature Feature 5): the checklist, the inventory roll-forward, finalizing a
// month, protection of closed months, reopening with a reason, the Controller's Report (print
// and download), history, and months from before the inventory ledger began.

import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { nav, noHorizontalOverflow, onboard } from './helpers';
import { closeShop } from '../src/insights/closeFixture';
import { addItem, recordSale as recordSaleData } from '../src/domain/actions';
import { createBackup } from '../src/data/backup';
import { defaultSettings, emptyData, type AppData } from '../src/domain/types';

const NOW = new Date('2026-11-12T10:00:00');

async function axe(page: Page) {
  // Toasts fade in over 180 ms; they're checked once settled in trust.spec.ts.
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

async function decide(page: Page, key: string, how: 'review' | 'na' | 'ack', note?: string) {
  const s = step(page, key);
  await s.getByTestId(how === 'review' ? 'step-review' : how === 'na' ? 'step-na' : 'step-ack').click();
  if (how !== 'review') {
    const d = page.getByTestId('decision-dialog');
    if (note !== undefined) await d.getByTestId('decision-note').fill(note);
    await d.getByTestId('decision-save').click();
    await expect(d).toBeHidden();
  }
  await expect(s.getByTestId('step-undo')).toBeVisible();
}

/** Records a $20 sale of one record dated October 31 (the date is set last and checked before saving). */
async function backdatedSale(page: Page) {
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: /^Record (sale|your first sale)$/ }).first().click();
  const dialog = page.getByTestId('sale-form');
  await expect(dialog).toBeVisible();
  const select = dialog.getByLabel('Item sold');
  await select.selectOption((await select.locator('option', { hasText: 'Vinyl records' }).first().getAttribute('value'))!);
  await dialog.getByLabel('Quantity sold').fill('1');
  await dialog.getByLabel('Sale price').fill('20');
  await dialog.getByLabel('Sale date').fill('2026-10-31');
  await expect(dialog.getByLabel('Sale date')).toHaveValue('2026-10-31');
  await dialog.getByRole('button', { name: /Record sale/ }).click();
}

test('close a month: checklist, verified roll-forward, report, protection, reopen and history', async ({ page }, testInfo) => {
  await page.clock.install({ time: NOW });
  await onboard(page, 'Reseller');
  await restore(page, closeShop().data, testInfo.outputPath('close-backup.json'));

  await nav(page, 'Sales & Profit');
  await page.getByTestId('close-link').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Monthly Close');
  // October has ended and isn't closed: it opens by default.
  await expect(page.getByTestId('close-month')).toHaveValue('2026-10');
  await expect(page.getByTestId('fig-revenue')).toContainText(/\$418\.00\s*Verified/);
  await expect(page.getByTestId('fig-profit')).toContainText('$259.33');
  await expect(page.getByTestId('fig-beginning')).toContainText(/\$348\.00\s*Verified/);
  await expect(page.getByTestId('fig-ending')).toContainText(/\$298\.33\s*Verified/);
  await expect(page.getByTestId('fig-recon')).toContainText('Not performed');
  await expect(page.getByTestId('rf-status')).toContainText('Verified');
  await expect(page.locator('[data-testid="rf-line"][data-key="cogs"]')).toContainText('−$82.67');
  await expect(page.locator('[data-testid="rf-line"][data-key="difference"]')).toContainText('$0.00');
  await expect(page.getByTestId('close-step')).toHaveCount(9);
  await expect(page.getByTestId('close-finalize')).toBeDisabled();
  // Nothing is ticked for you, even where there's nothing to review.
  await expect(step(page, 'counts').getByTestId('step-state')).toHaveText('To review');
  await expect(step(page, 'adjustments')).toContainText('Lamp was deleted with $8.00 of stock at cost');
  await noHorizontalOverflow(page);
  await axe(page);

  await decide(page, 'sales', 'review');
  await decide(page, 'purchases', 'review');
  await decide(page, 'adjustments', 'ack', 'The lamp broke; I’ll record write-offs properly from now on.');
  await decide(page, 'counts', 'na');
  await decide(page, 'payouts', 'na');
  await expect(step(page, 'payouts').getByTestId('step-state')).toContainText('Not applicable: Not performed: no marketplace reports have been imported');
  await decide(page, 'refunds', 'na');
  await decide(page, 'costs', 'review');
  await decide(page, 'summary', 'review');
  await expect(page.getByTestId('close-status-text')).toContainText('Every step is done');

  // Finalize: the open issue must be acknowledged.
  await page.getByTestId('close-finalize').click();
  const fin = page.getByTestId('finalize-dialog');
  await expect(fin.getByTestId('finalize-unresolved')).toContainText('Lamp was deleted');
  await expect(fin.getByTestId('close-confirm')).toBeDisabled();
  await fin.getByRole('checkbox').check();
  await fin.getByTestId('close-confirm').click();
  await expect(fin).toBeHidden();
  await expect(page.getByTestId('close-status')).toContainText('Closed');
  await expect(page.getByTestId('closed-figures')).toContainText('$259.33');
  await expect(page.getByTestId('closed-unresolved')).toContainText('Lamp was deleted');
  await noHorizontalOverflow(page);
  await axe(page);

  // The Controller's Report as closed: on screen and as a downloaded file, the same figures.
  await page.getByTestId('close-report-link').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Controller’s Report: October 2026');
  await expect(page.getByTestId('report-disclaimer')).toContainText('not an audited financial statement');
  await expect(page.getByTestId('report')).toContainText('Realized profit: $259.33 (September 2026: $128.00; change +$131.33 (+102.6%))');
  await expect(page.getByTestId('report')).toContainText('Verified: Realized profit increased by $131.33 compared with September 2026: $128.00 → $259.33.');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('report-download').click()]);
  expect(download.suggestedFilename()).toBe('stockpilot-controllers-report-2026-10-v1.html');
  const html = readFileSync(await download.path(), 'utf8');
  expect(html).toContain('<li>Realized profit: $259.33 (September 2026: $128.00; change +$131.33 (+102.6%))</li>');
  expect(html).toContain('Generated from user-maintained StockPilot records');
  await expect(page.getByTestId('report-print')).toBeVisible();
  await noHorizontalOverflow(page);
  await axe(page);

  // A closed month is protected: a sale dated in October is refused.
  await backdatedSale(page);
  await expect(page.getByText('That would change October 2026, which is closed.')).toBeVisible();
  await page.getByTestId('sale-form').getByRole('button', { name: 'Cancel' }).click();

  // Reopen with a reason: the close is kept as superseded and the checks start again.
  await page.goto('./#/sales/close?month=2026-10');
  await page.getByTestId('close-reopen').click();
  await page.getByTestId('reopen-dialog').getByTestId('reopen-confirm').click();
  await expect(page.getByTestId('reopen-dialog')).toContainText('Say why you’re reopening the month');
  await page.getByTestId('reopen-reason').fill('A late October sale was missing.');
  await page.getByTestId('reopen-confirm').click();
  await expect(page.getByTestId('close-status')).toContainText('Open');
  await expect(step(page, 'sales').getByTestId('step-state')).toHaveText('To review');
  await expect(page.getByTestId('close-audit')).toContainText('Reopened October 2026 (version 1 superseded) — A late October sale was missing.');

  // The correction now goes through, and the figures follow.
  await backdatedSale(page);
  await expect(page.getByTestId('sale-form')).toBeHidden();
  await page.goto('./#/sales/close?month=2026-10');
  await expect(page.getByTestId('fig-revenue')).toContainText('$438.00');

  await page.getByTestId('close-history-link').click();
  await expect(page.getByTestId('history-version')).toHaveCount(1);
  await expect(page.getByTestId('history-version')).toContainText('Superseded');
  await expect(page.getByTestId('history-version')).toContainText('realized profit $259.33');
  await expect(page.getByTestId('history-version')).toContainText('Reopened');
  await expect(page.getByTestId('history-audit')).toContainText('Closed October 2026 (version 1) with 1 acknowledged open issue');
  await noHorizontalOverflow(page);
  await axe(page);

  // The assistant answers from the same figures (with the late $20 sale: +$14 at the $6 cost), and doesn't invent a decline.
  await nav(page, 'Smart Insights');
  const assistant = page.getByTestId('assistant');
  await assistant.getByLabel('Ask a question').fill('Why did my profit decline in October?');
  await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
  const answer = assistant.getByTestId('assistant-answer').last();
  await expect(answer).toContainText('Your profit didn’t decline: Realized profit rose by $145.33 in October 2026 compared with September 2026 ($128.00 → $273.33).');
  await expect(answer.getByTestId('calculation-lines')).toContainText(/Realized profit in September 2026\s*\+\$128\.00[\s\S]*Realized profit in October 2026\s*\$273\.33/);
});

test('months before the inventory ledger began are not verifiable, never a false zero', async ({ page }, testInfo) => {
  await page.clock.install({ time: NOW });
  await onboard(page, 'Reseller');
  // A backup from an older version: sales in October, no inventory ledger.
  let data = addItem(emptyData(), { name: 'Camera', quantity: 4, unitCost: 25, purchaseDate: '2026-09-02' }, { now: new Date('2026-09-02T12:00:00Z') }).data;
  data = recordSaleData(data, { itemId: data.items[0].id, quantity: 1, salePrice: 60, priceMode: 'total', saleDate: '2026-10-02' }, { now: new Date('2026-10-02T12:00:00Z') }).data;
  await restore(page, data, testInfo.outputPath('old-backup.json'));

  await page.goto('./#/sales/close?month=2026-10');
  await expect(page.getByTestId('fig-revenue')).toContainText(/\$60\.00\s*Verified/);
  await expect(page.getByTestId('fig-beginning')).toContainText(/Not available\s*Missing/);
  await expect(page.getByTestId('fig-ending')).toContainText(/Not available\s*Missing/);
  await expect(page.getByTestId('rf-status')).toContainText('Not available: before the inventory ledger began');
  await expect(page.locator('[data-testid="rf-line"]')).toHaveCount(0);
  await expect(step(page, 'summary')).toContainText('Inventory roll-forward can’t be fully verified');
  await expect(step(page, 'purchases').getByTestId('step-na')).toHaveCount(0);
  await noHorizontalOverflow(page);
  await axe(page);

  await nav(page, 'Smart Insights');
  const assistant = page.getByTestId('assistant');
  await assistant.getByLabel('Ask a question').fill('What inventory differences remain unexplained in October?');
  await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(assistant.getByTestId('assistant-answer').last()).toContainText('The inventory roll-forward for October 2026 isn’t available: Not available: before the inventory ledger began');
});
