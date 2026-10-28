import { expect, test } from '@playwright/test';
import { addItem, nav, onboard } from './helpers';

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
