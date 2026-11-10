import { expect, test } from '@playwright/test';
import { addItem, nav, onboard, recordSale } from './helpers';

test('insights are labeled rule-based and answer questions from real data', async ({ page }) => {
  await onboard(page, 'Reseller', true);
  await nav(page, 'Smart Insights');
  await expect(page.getByText('Rule-based · no AI model yet')).toBeVisible();
  await expect(page.getByTestId('insight-low-stock')).toContainText('Running low');
  await expect(page.getByTestId('insight-low-stock')).toContainText('Soy Candle — Cedar & Sage 8oz');
  await expect(page.getByTestId('insight-pricing')).toContainText('Yeezy Boost 350 V2');

  const assistant = page.getByTestId('assistant');
  await assistant.getByRole('button', { name: 'Which products are running low?' }).click();
  await expect(assistant.getByTestId('assistant-answer').last()).toContainText('need restocking');
  await expect(assistant.getByTestId('assistant-answer').last()).toContainText('Rule-based answer');

  await assistant.getByLabel('Ask a question').fill('How much money do I have invested in unsold inventory?');
  await assistant.getByRole('button', { name: 'Ask' }).click();
  await expect(assistant.getByTestId('assistant-answer').last()).toContainText('invested in unsold inventory');

  await assistant.getByLabel('Ask a question').fill('What is the meaning of life?');
  await assistant.getByLabel('Ask a question').press('Enter');
  await expect(assistant.getByTestId('assistant-answer').last()).toContainText('not an AI model');
});

test('insights explain when there is not enough data', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Only item' });
  await nav(page, 'Smart Insights');
  await expect(page.getByTestId('insight-low-stock')).toContainText('No items have a low-stock alert level yet');
  await expect(page.getByTestId('insight-top-revenue')).toContainText('No sales recorded yet.');
  await page.getByTestId('assistant').getByRole('button', { name: 'How much profit have I made this month?' }).click();
  await expect(page.getByTestId('assistant-answer')).toContainText("haven't recorded any sales");
});

test('spellings that differ only in capitalization are grouped together', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Throw pillow', quantity: 2, cost: '5', category: 'Home' });
  await addItem(page, { name: 'Candle jar', quantity: 2, cost: '3', category: 'home' });
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: 'Record your first sale' }).click();
  await recordSale(page, { item: 'Throw pillow', price: '20', platform: 'eBay' });
  await page.getByRole('button', { name: 'Record sale' }).first().click();
  await recordSale(page, { item: 'Candle jar', price: '15', platform: 'ebay' });
  await expect(page.getByTestId('sale-row')).toHaveCount(2);
  await expect(page.getByLabel('Platform').locator('option')).toHaveText(['All platforms', 'eBay']);

  await nav(page, 'Smart Insights');
  const categories = page.getByTestId('insight-categories');
  await expect(categories.getByRole('listitem')).toHaveCount(1);
  await expect(categories.getByRole('listitem')).toContainText('Home');
});
