// Financial Planning: the tax reserve at a percentage the user chooses, scenarios, reserves and
// what's recorded as set aside (with duplicate protection and voiding), planned obligations with
// in-app reminders, and the assistant's planning answers. Planning never changes recorded profit.

import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { nav, noHorizontalOverflow, onboard } from './helpers';
import { closeShop } from '../src/insights/closeFixture';
import { createBackup } from '../src/data/backup';
import { defaultSettings, type AppData } from '../src/domain/types';

const NOW = new Date('2026-11-12T10:00:00');

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

async function recordSetAside(page: Page, reserve: string, amount: string, date: string, note = '') {
  await page.getByTestId('entry-new').click();
  const d = page.getByTestId('entry-dialog');
  await d.getByLabel('Reserve').selectOption({ label: reserve });
  await d.getByLabel('Amount').fill(amount);
  if (note) await d.getByLabel('Note (optional)').fill(note);
  await d.getByLabel('Date').fill(date);
  await expect(d.getByLabel('Date')).toHaveValue(date);
  await d.getByTestId('entry-save').click();
  return d;
}

async function ask(page: Page, q: string) {
  const assistant = page.getByTestId('assistant');
  await assistant.getByLabel('Ask a question').fill(q);
  await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
  return assistant.getByTestId('assistant-answer').last();
}

test('financial planning: reserve percentage, scenarios, set-aside, obligations, assistant', async ({ page }, testInfo) => {
  await page.clock.install({ time: NOW });
  await onboard(page, 'Reseller');
  await restore(page, closeShop().data, testInfo.outputPath('planning-backup.json'));

  await nav(page, 'Sales & Profit');
  await page.getByTestId('planning-link').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Financial Planning');
  await expect(page.getByTestId('planning-disclaimer')).toContainText('not tax advice');
  // No percentage is assumed.
  await expect(page.getByTestId('pl-tax')).toContainText('Choose a percentage');
  await page.getByTestId('planning-period').selectOption('2026-10');
  await expect(page.getByTestId('pl-profit')).toContainText(/\$259\.33\s*Recorded/);

  // The user's own percentage, with the arithmetic shown.
  await page.getByTestId('tax-percent').fill('25');
  await page.getByTestId('tax-percent-save').click();
  await expect(page.getByTestId('tax-calc')).toContainText('$259.33 × 25% = $64.83');
  await expect(page.getByTestId('tax-calc')).toContainText('$259.33 − $64.83 = $194.50');
  await expect(page.getByTestId('pl-tax')).toContainText(/\$64\.83\s*Estimated/);
  await expect(page.getByTestId('pl-after')).toContainText('$194.50');
  await expect(page.getByTestId('planning-not-included')).toContainText('Business expenses you haven’t entered');

  // Scenarios are examples, not recommendations.
  const rows = page.getByTestId('scenario-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('$259.33 × 20% = $51.87');
  await expect(rows.nth(1)).toContainText('(your setting)');
  await expect(rows.nth(2)).toContainText('$77.80');
  await expect(rows.nth(2)).toContainText('$181.53');
  await page.getByTestId('scenario-custom').fill('22.5');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1)).toContainText('$259.33 × 22.5% = $58.35');

  // A savings goal for equipment.
  await page.getByTestId('category-new').click();
  const cd = page.getByTestId('category-dialog');
  await cd.getByLabel('Name').fill('Equipment replacement');
  await cd.getByLabel('Kind').selectOption({ label: 'Equipment replacement' });
  await cd.getByLabel('Goal amount').fill('500');
  await cd.getByTestId('category-save').click();
  await expect(cd).toBeHidden();
  await expect(page.getByTestId('reserve-row')).toHaveCount(2);

  // Recording money set aside: an allocation, not an expense.
  let d = await recordSetAside(page, 'Taxes', '50', '2026-10-31', 'Savings transfer');
  await expect(d).toBeHidden();
  await expect(page.getByTestId('pl-set-aside')).toContainText(/\$50\.00\s*User-entered/);
  await expect(page.getByTestId('tax-calc')).toContainText('$14.83 behind your target');
  await expect(page.getByTestId('pl-profit')).toContainText('$259.33');

  // The same transfer twice is caught; cancel it.
  d = await recordSetAside(page, 'Taxes', '50', '2026-10-31');
  await expect(d.getByTestId('entry-duplicate')).toContainText('You already recorded a deposit of $50.00');
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('reserve-entry')).toHaveCount(1);

  // A mistaken entry is voided with a reason, and stays in the history.
  d = await recordSetAside(page, 'Equipment replacement', '30', '2026-10-15');
  await expect(d).toBeHidden();
  await expect(page.getByTestId('reserve-entry')).toHaveCount(2);
  await page.getByTestId('reserve-entry').filter({ hasText: 'Equipment replacement' }).getByTestId('entry-void').click();
  const vd = page.getByTestId('void-dialog');
  await vd.getByTestId('void-save').click();
  await expect(vd.getByRole('alert')).toContainText('Say why');
  await vd.getByTestId('void-reason').fill('Entered by mistake.');
  await vd.getByTestId('void-save').click();
  await expect(vd).toBeHidden();
  await expect(page.getByTestId('reserve-entry').filter({ hasText: 'Equipment replacement' })).toContainText('Voided: Entered by mistake.');
  await expect(page.getByTestId('pl-set-aside')).toContainText('$50.00');

  // Planned obligations: in-app reminders, never expenses, no duplicates.
  await page.getByTestId('obligation-new').click();
  const od = page.getByTestId('obligation-dialog');
  await od.getByLabel('Description').fill('Insurance renewal');
  await od.getByLabel('Category').selectOption({ label: 'Insurance' });
  await od.getByLabel('Expected date').fill('2026-11-20');
  await od.getByLabel('Estimated amount').fill('420');
  await od.getByTestId('obligation-save').click();
  await expect(od).toBeHidden();
  const ob = page.getByTestId('obligation-row').filter({ hasText: 'Insurance renewal' });
  await expect(ob).toContainText('Due soon');
  await expect(ob).toContainText('$420.00');
  await page.getByTestId('obligation-new').click();
  await od.getByLabel('Description').fill('insurance renewal');
  await od.getByLabel('Expected date').fill('2026-11-20');
  await od.getByLabel('Estimated amount').fill('420');
  await od.getByTestId('obligation-save').click();
  await expect(od.getByRole('alert')).toContainText('is already planned for Nov 20, 2026');
  await od.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByTestId('obligation-row')).toHaveCount(1);
  await expect(page.getByTestId('pl-upcoming')).toContainText('$420.00');
  await ob.getByTestId('occurrence-done').click();
  await expect(ob).toContainText('Done');
  await expect(page.getByTestId('pl-upcoming')).toContainText('$0.00');

  await expect(page.getByTestId('planning-log')).toContainText('Planned “Insurance renewal”');
  await noHorizontalOverflow(page);
  await axe(page);

  // Quarter view: Q4 so far is October + November.
  await page.getByRole('radio', { name: 'Quarter' }).click();
  await expect(page.getByTestId('planning-period')).toHaveValue('2026-Q4');
  await expect(page.getByTestId('pl-profit')).toContainText('$259.33');

  // The assistant answers from the same records and settings.
  await nav(page, 'Smart Insights');
  let answer = await ask(page, 'How much profit should I consider reserving in October?');
  await expect(answer).toContainText('At the 25% you chose, consider setting aside $64.83 for October 2026: $259.33 × 25% = $64.83.');
  await expect(answer.getByTestId('calculation-lines')).toContainText(/Profit remaining after planned reserves\s*\$194\.50/);
  answer = await ask(page, 'How much have I set aside?');
  await expect(answer).toContainText('You’ve recorded $50.00 as set aside: Taxes $50.00, Equipment replacement $0.00.');
  await expect(answer).toContainText('Recorded figures');
  answer = await ask(page, 'What financial obligations are coming up?');
  await expect(answer).toContainText('You haven’t planned any obligations for the next 90 days.');
});

test('financial planning on a month with a loss suggests no reserve', async ({ page }, testInfo) => {
  await page.clock.install({ time: NOW });
  await onboard(page, 'Reseller');
  await restore(page, closeShop().data, testInfo.outputPath('planning-backup.json'));
  await nav(page, 'Sales & Profit');
  await page.getByTestId('planning-link').click();
  await expect(page.getByTestId('planning-period')).toHaveValue('2026-11');
  await page.getByTestId('tax-percent').fill('30');
  await page.getByTestId('tax-percent-save').click();
  await expect(page.getByTestId('pl-profit')).toContainText('$0.00');
  await expect(page.getByTestId('pl-tax')).toContainText('$0.00');
  await expect(page.getByTestId('planning-warnings')).toContainText('No sales are recorded for November 2026');
  await page.getByTestId('tax-percent').fill('130');
  await page.getByTestId('tax-percent-save').click();
  await expect(page.getByText('Enter a percentage from 0 to 100.')).toBeVisible();
});
