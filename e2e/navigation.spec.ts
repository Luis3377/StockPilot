import { expect, test } from '@playwright/test';
import { addItem, isMobile, nav, noHorizontalOverflow, onboard } from './helpers';

test('onboarding asks how StockPilot will be used and requires a choice', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'How will you be using StockPilot?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  for (const mode of ['Reseller Mode', 'Collector Mode', 'Small business Mode']) {
    await expect(page.getByRole('radio', { name: new RegExp(mode) })).toBeVisible();
  }
  await page.getByRole('radio', { name: /Collector Mode/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('Your inventory is stored only on this device')).toBeVisible();
  await page.getByRole('button', { name: /Start with my own inventory/ }).click();
  await expect(page.getByText('Collector mode')).toBeVisible();
  await expect(page.getByTestId('get-started')).toBeVisible();
});

test('every navigation entry opens the correct screen', async ({ page }) => {
  await onboard(page, 'Reseller');
  const screens: [string, string, RegExp][] = [
    ['Inventory', 'Inventory', /#\/inventory$/],
    ['Sales & Profit', 'Sales & Profit', /#\/sales$/],
    ['Smart Insights', 'StockPilot Insights', /#\/insights$/],
    ['Count Check', 'Count Check', /#\/count$/],
    ['Settings', 'Settings', /#\/settings$/],
    ['Overview', 'Good (morning|afternoon|evening)', /#\/$/],
  ];
  for (const [link, heading, url] of screens) {
    await nav(page, link);
    await expect(page).toHaveURL(url);
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(heading) })).toBeVisible();
    await noHorizontalOverflow(page);
  }
});

test('switching modes changes the dashboard but preserves inventory', async ({ page }) => {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Mode test lamp', quantity: 3, cost: '20', asking: '45' });
  await expect(page.getByTestId('hero-profit')).toBeVisible();

  const switchTo = async (mode: string) => {
    await page.getByTestId('mode-switcher').filter({ visible: true }).click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${mode}`) }).click();
    await expect(page.getByText(`Switched to ${mode} mode`)).toBeVisible();
  };

  await switchTo('Collector');
  await expect(page.getByTestId('hero-collection-value')).toBeVisible();
  await expect(page.getByTestId('stat-collection-size-value')).toHaveText('3');
  // Collectors don't see Sales unless they opt in.
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Sales/ })).toHaveCount(0);

  await switchTo('Small business');
  await expect(page.getByTestId('hero-inventory-value-value')).toHaveText('$60.00');

  await switchTo('Reseller');
  await expect(page.getByTestId('stat-inventory-cost-value')).toHaveText('$60.00');
  await nav(page, 'Inventory');
  await expect(page.getByTestId('inventory-item')).toHaveCount(1);
});

test('collectors can turn on sales tracking in Settings', async ({ page }) => {
  await onboard(page, 'Collector');
  await nav(page, 'Settings');
  await page.getByRole('switch', { name: /Track sales & profit/ }).click();
  await nav(page, 'Sales & Profit');
  await expect(page.getByRole('heading', { level: 1, name: 'Sales & Profit' })).toBeVisible();
});

test('unknown routes show a helpful page', async ({ page }) => {
  await onboard(page);
  await page.goto('./#/nowhere');
  await expect(page.getByText('That page doesn’t exist')).toBeVisible();
  await page.getByRole('link', { name: 'Go to Overview' }).click();
  await expect(page).toHaveURL(/#\/$/);
});

test('mobile layout uses bottom tabs and never scrolls sideways', async ({ page }) => {
  test.skip(!isMobile(page), 'phone-only check');
  await onboard(page, 'Reseller', true);
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  for (const path of ['', 'inventory', 'sales', 'insights', 'count', 'settings']) {
    await page.goto(`./#/${path}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noHorizontalOverflow(page);
  }
  const tabs = page.getByRole('navigation', { name: 'Main' }).getByRole('link');
  await expect(tabs).toHaveCount(6);
});
