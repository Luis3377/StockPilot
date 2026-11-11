// AI Inventory Scanner, tested against a build with the scanner switched on (port 4175).
// Every call to the scanner backend is answered by a mock below: no test reaches a real AI
// service or costs anything.

import { expect, test, type Page, type Route } from '@playwright/test';
import { isMobile, nav, noHorizontalOverflow, onboard, openItem, solidPng } from './helpers';

const SCAN_APP = 'http://localhost:4175/';
const STANDARD_APP = 'http://localhost:4174/';
const API = 'http://scan.test';
const CODE = 'SP-TEST1-TEST2-TEST3-TEST4';
const CODE_KEY = 'stockpilot-scan-invite-code';

test.use({ baseURL: SCAN_APP });

type Reply = { status?: number; json?: unknown; text?: string; delayMs?: number; abort?: boolean };

interface ApiLog {
  scans: { auth: string | undefined; image: unknown }[];
  statusChecks: (string | undefined)[];
}

const success = (result: Record<string, unknown>, scansLeftToday = 19): Reply => ({
  json: { ok: true, result, model: { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, scansLeftToday },
});
const failure = (status: number, code: string, message?: string): Reply => ({ status, json: { error: { code, message } } });

/** Answers the scanner API (CORS preflight included) and records what the app sent. */
async function mockScanner(page: Page, scanReplies: Reply[] = []): Promise<ApiLog> {
  const log: ApiLog = { scans: [], statusChecks: [] };
  await page.route(`${API}/**`, async (route: Route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': new URL(SCAN_APP).origin,
      'access-control-allow-headers': 'Authorization, Content-Type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      vary: 'Origin',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const headers = await req.allHeaders();
    const path = new URL(req.url()).pathname;
    let reply: Reply;
    if (path === '/v1/scan') {
      log.scans.push({ auth: headers.authorization, image: (req.postDataJSON() as { image?: unknown }).image });
      reply = scanReplies[Math.min(log.scans.length - 1, scanReplies.length - 1)] ?? failure(500, 'ai_error');
    } else if (path === '/v1/status') {
      log.statusChecks.push(headers.authorization);
      reply =
        headers.authorization === `Bearer ${CODE}`
          ? { json: { ok: true, label: 'Tester', scansLeftToday: 20, dailyLimit: 20, expiresAt: Date.UTC(2031, 0, 15) } }
          : failure(401, 'invalid_code', 'That invite code isn’t valid. Check it and try again.');
    } else {
      reply = failure(404, 'not_found');
    }
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    try {
      if (reply.abort) await route.abort('failed');
      else
        await route.fulfill({
          status: reply.status ?? 200,
          headers: { ...cors, 'content-type': 'application/json' },
          body: reply.text ?? JSON.stringify(reply.json),
        });
    } catch {
      // The app already gave up on this request (timeout or cancel).
    }
  });
  return log;
}

async function saveCode(page: Page) {
  await page.evaluate(([key, code]) => localStorage.setItem(key, code), [CODE_KEY, CODE]);
}

async function storedCode(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), CODE_KEY);
}

/** Opens Add Item through "Scan with AI" and chooses a photo. */
async function startScan(page: Page, color = '#8a5a2b') {
  await nav(page, 'Inventory');
  await page.getByRole('button', { name: 'Scan with AI' }).first().click();
  const dialog = page.getByTestId('item-form');
  await expect(dialog.getByTestId('scan-panel')).toBeVisible();
  await uploadScanPhoto(page, color);
  return dialog;
}

async function uploadScanPhoto(page: Page, color: string) {
  const dialog = page.getByTestId('item-form');
  await dialog.getByTestId('scan-upload-input').setInputFiles({ name: 'item.png', mimeType: 'image/png', buffer: await solidPng(page, color) });
  await expect(dialog.getByTestId('scan-panel').getByRole('img', { name: 'Photo to scan' })).toBeVisible();
}

// Labels may carry an "AI suggested" marker, and fields with suggestions are comboboxes.
const field = (page: Page, label: string) => page.getByTestId('item-form').getByLabel(label);

/** Values the scanner must never fill. */
async function expectMoneyAndQuantityUntouched(page: Page) {
  await expect(page.getByTestId('item-form').getByRole('textbox', { name: 'Quantity', exact: true })).toHaveValue('1');
  await expect(page.getByTestId('item-form').getByLabel('Cost per item')).toHaveValue('');
  const prices = await page.getByTestId('item-form').getByLabel(/Asking price|Selling price|market value/).all();
  expect(prices.length).toBeGreaterThan(0);
  for (const price of prices) await expect(price).toHaveValue('');
}

const ITEM_TYPES = [
  {
    kind: 'shoes',
    result: {
      status: 'identified',
      name: 'Nike Air Jordan 1 Retro High OG "Chicago"',
      brand: 'Nike',
      model: 'Air Jordan 1 Retro High OG',
      category: 'Sneakers',
      description: 'High-top basketball sneakers in white, red and black leather.',
      condition: 'like_new',
      condition_notes: 'Light creasing on the toe box.',
      confidence: 'high',
      notes: null,
    },
    name: 'Nike Air Jordan 1 Retro High OG "Chicago"',
    category: 'Sneakers',
    condition: 'Like new',
    notes: 'High-top basketball sneakers in white, red and black leather.\nBrand: Nike · Model: Air Jordan 1 Retro High OG\nVisible condition: Light creasing on the toe box.',
  },
  {
    kind: 'electronics',
    result: {
      status: 'identified',
      name: 'Sony WH-1000XM4 Wireless Noise Cancelling Headphones',
      brand: 'Sony',
      model: 'WH-1000XM4',
      category: 'Headphones',
      description: 'Black over-ear wireless headphones with a folding headband.',
      condition: 'good',
      condition_notes: 'Minor scuffs on the ear cups.',
      confidence: 'medium',
      notes: null,
    },
    name: 'Sony WH-1000XM4 Wireless Noise Cancelling Headphones',
    category: 'Headphones',
    condition: 'Used — good',
    notes: 'Black over-ear wireless headphones with a folding headband.\nBrand: Sony · Model: WH-1000XM4\nVisible condition: Minor scuffs on the ear cups.',
  },
  {
    kind: 'clothing',
    result: {
      status: 'identified',
      name: 'Better Sweater Fleece Jacket',
      brand: 'Patagonia',
      model: null,
      category: 'Jackets',
      description: 'Grey full-zip fleece jacket with a stand-up collar.',
      condition: 'fair',
      condition_notes: 'Pilling on the sleeves.',
      confidence: 'medium',
      notes: 'Size label not visible.',
    },
    // The brand is added to the front when the name leaves it out.
    name: 'Patagonia Better Sweater Fleece Jacket',
    category: 'Jackets',
    condition: 'Used — fair',
    notes: 'Grey full-zip fleece jacket with a stand-up collar.\nBrand: Patagonia\nVisible condition: Pilling on the sleeves.',
  },
  {
    kind: 'collectibles',
    result: {
      status: 'identified',
      name: 'Charizard Holo Base Set Trading Card',
      brand: 'Pokémon',
      model: 'Base Set 4/102',
      category: 'Trading cards',
      description: 'Holographic Charizard card in a clear top-loader.',
      condition: 'unknown',
      condition_notes: null,
      confidence: 'high',
      notes: 'Card grade can’t be judged from a photo.',
    },
    name: 'Pokémon Charizard Holo Base Set Trading Card',
    category: 'Trading cards',
    // Condition unknown: left empty for the user.
    condition: '',
    notes: 'Holographic Charizard card in a clear top-loader.\nBrand: Pokémon · Model: Base Set 4/102',
  },
  {
    kind: 'tools',
    result: {
      status: 'identified',
      name: 'DeWalt 20V MAX Cordless Drill/Driver',
      brand: 'DeWalt',
      model: 'DCD771',
      category: 'Power tools',
      description: 'Yellow and black cordless drill with a battery pack attached.',
      condition: 'poor',
      condition_notes: 'Cracked housing near the chuck; heavy paint wear.',
      confidence: 'high',
      notes: null,
    },
    name: 'DeWalt 20V MAX Cordless Drill/Driver',
    category: 'Power tools',
    condition: 'Used — poor',
    notes: 'Yellow and black cordless drill with a battery pack attached.\nBrand: DeWalt · Model: DCD771\nVisible condition: Cracked housing near the chuck; heavy paint wear.',
  },
] as const;

for (const t of ITEM_TYPES) {
  test(`scan ${t.kind}: suggestions fill the form, the user adds cost and saves`, async ({ page }) => {
    const api = await mockScanner(page, [success(t.result)]);
    await onboard(page, 'Reseller');
    await saveCode(page);
    const dialog = await startScan(page);

    // Nothing is sent until Analyze is tapped.
    await expect(dialog.getByRole('button', { name: 'Analyze photo' })).toBeVisible();
    expect(api.scans).toHaveLength(0);
    await dialog.getByRole('button', { name: 'Analyze photo' }).click();

    await expect(dialog.getByTestId('scan-result')).toContainText('Suggested details');
    await expect(dialog.getByTestId('scan-result')).toContainText('19 scans left today');
    expect(api.scans).toHaveLength(1);
    expect(api.scans[0].auth).toBe(`Bearer ${CODE}`);
    expect(String(api.scans[0].image)).toMatch(/^data:image\/jpeg;base64,/);

    await expect(field(page, 'Item name')).toHaveValue(t.name);
    await expect(field(page, 'Category')).toHaveValue(t.category);
    await expect(field(page, 'Condition')).toHaveValue(t.condition);
    await expect(field(page, 'Notes')).toHaveValue(t.notes);
    await expect(dialog.getByTestId('ai-filled')).toHaveCount(t.condition ? 4 : 3);
    await expect(dialog.getByText('Cover')).toBeVisible();
    await expectMoneyAndQuantityUntouched(page);

    // Saving still needs the user's cost; the scanner never guesses it.
    await dialog.getByRole('button', { name: 'Add item' }).click();
    await expect(dialog.getByText('Enter what you paid per item')).toBeVisible();
    await dialog.getByLabel('Cost per item').fill('42.50');
    await dialog.getByRole('button', { name: 'Add item' }).click();
    await expect(dialog).toBeHidden();

    await openItem(page, t.name);
    const main = page.getByRole('main');
    await expect(main).toContainText(t.category);
    if (t.condition) await expect(main).toContainText(t.condition);
    await expect(main).toContainText(t.notes.split('\n')[0]);
    await expect(main.getByRole('img', { name: t.name }).first()).toBeVisible();
    expect(api.scans).toHaveLength(1);
  });
}

test('an unrecognized item fills nothing and the user enters details by hand', async ({ page }) => {
  await mockScanner(page, [
    success({
      status: 'unrecognized',
      name: null,
      brand: null,
      model: null,
      category: null,
      description: null,
      condition: 'unknown',
      condition_notes: null,
      confidence: 'low',
      notes: 'The photo is too blurry to identify the item.',
    }),
  ]);
  await onboard(page, 'Reseller');
  await saveCode(page);
  const dialog = await startScan(page);
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  await expect(dialog.getByTestId('scan-result')).toContainText('Couldn’t identify this item');
  await expect(dialog.getByTestId('scan-result')).toContainText('too blurry');
  await expect(field(page, 'Item name')).toHaveValue('');
  await expect(field(page, 'Category')).toHaveValue('');
  await expect(dialog.getByTestId('ai-filled')).toHaveCount(0);
  await expectMoneyAndQuantityUntouched(page);

  await field(page, 'Item name').fill('Mystery gadget');
  await dialog.getByLabel('Cost per item').fill('5');
  await dialog.getByRole('button', { name: 'Add item' }).click();
  await expect(dialog).toBeHidden();
  await openItem(page, 'Mystery gadget');
});

test('a partly identified item fills only what was seen', async ({ page }) => {
  await mockScanner(page, [
    success({
      status: 'partial',
      name: 'Vintage film camera',
      brand: null,
      model: null,
      category: 'Cameras',
      description: 'Silver and black 35mm rangefinder-style camera.',
      condition: 'unknown',
      condition_notes: null,
      confidence: 'low',
      notes: 'Brand markings aren’t readable.',
    }),
  ]);
  await onboard(page, 'Reseller');
  await saveCode(page);
  const dialog = await startScan(page);
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  await expect(dialog.getByTestId('scan-result')).toContainText('Partly identified');
  await expect(dialog.getByTestId('scan-result')).toContainText('low confidence');
  await expect(field(page, 'Item name')).toHaveValue('Vintage film camera');
  await expect(field(page, 'Category')).toHaveValue('Cameras');
  await expect(field(page, 'Condition')).toHaveValue('');
  await expect(field(page, 'Notes')).toHaveValue('Silver and black 35mm rangefinder-style camera.');
});

test('prices, quantities and other invented fields in a response are ignored', async ({ page }) => {
  await mockScanner(page, [
    {
      json: {
        ok: true,
        result: {
          status: 'identified',
          name: 'Lego Star Wars Millennium Falcon 75192',
          brand: 'Lego',
          model: '75192',
          category: 'Toys',
          description: 'Boxed Lego set, box sealed.',
          condition: 'new',
          condition_notes: null,
          confidence: 'high',
          notes: null,
          price: 849.99,
          purchase_price: 600,
          resale_value: 950,
          quantity: 4,
          sold_count: 12,
        },
        price: 849.99,
        scansLeftToday: 18,
      },
    },
  ]);
  await onboard(page, 'Reseller');
  await saveCode(page);
  const dialog = await startScan(page);
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  await expect(dialog.getByTestId('scan-result')).toContainText('Price, cost and quantity are never filled in');
  await expect(field(page, 'Item name')).toHaveValue('Lego Star Wars Millennium Falcon 75192');
  await expect(field(page, 'Condition')).toHaveValue('New');
  await expectMoneyAndQuantityUntouched(page);
  const notes = await field(page, 'Notes').inputValue();
  expect(notes).not.toMatch(/849|600|950|\$/);
});

test('malformed or unusable answers show an error and fill nothing', async ({ page }) => {
  await mockScanner(page, [
    { json: { ok: true, result: { status: 'certain', name: 42 } } },
    { text: '<html>Gateway</html>' },
    success({ status: 'identified', name: 'Canon AE-1 Program', brand: 'Canon', model: 'AE-1 Program', category: 'Cameras', description: null, condition: 'good', condition_notes: null, confidence: 'high', notes: null }),
  ]);
  await onboard(page, 'Reseller');
  await saveCode(page);
  const dialog = await startScan(page);
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  const error = dialog.getByTestId('scan-error');
  await expect(error).toContainText('The scanner’s answer couldn’t be used');
  await expect(field(page, 'Item name')).toHaveValue('');
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(error).toContainText('The scanner’s answer couldn’t be used');
  await expect(field(page, 'Item name')).toHaveValue('');
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(field(page, 'Item name')).toHaveValue('Canon AE-1 Program');
});

test('a file that is not an image is rejected on the device and nothing is sent', async ({ page }) => {
  const api = await mockScanner(page, [success(ITEM_TYPES[0].result)]);
  await onboard(page, 'Reseller');
  await saveCode(page);
  await nav(page, 'Inventory');
  await page.getByRole('button', { name: 'Scan with AI' }).first().click();
  const dialog = page.getByTestId('item-form');
  const input = dialog.getByTestId('scan-upload-input');

  await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') });
  await expect(dialog.getByTestId('scan-error')).toContainText('"notes.txt" isn\'t an image.');
  await input.setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not really a jpeg') });
  await expect(dialog.getByTestId('scan-error')).toContainText('"broken.jpg" couldn\'t be read.');
  await expect(dialog.getByRole('button', { name: 'Analyze photo' })).toHaveCount(0);

  // A real photo afterwards works.
  await uploadScanPhoto(page, '#336699');
  await expect(dialog.getByTestId('scan-error')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Analyze photo' })).toBeVisible();
  expect(api.scans).toHaveLength(0);
  expect(api.statusChecks).toHaveLength(0);
});

test('invite code: asked for before the first scan, checked, then remembered', async ({ page }) => {
  const api = await mockScanner(page, [success(ITEM_TYPES[1].result)]);
  await onboard(page, 'Reseller');
  const dialog = await startScan(page);
  const form = dialog.getByTestId('invite-code-form');
  await expect(form).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Analyze photo' })).toHaveCount(0);

  await form.getByLabel('Private beta: enter your invite code').fill('SP-WRONG-WRONG-WRONG-WRONG');
  await form.getByRole('button', { name: 'Save code' }).click();
  await expect(form.getByRole('alert')).toHaveText('That invite code isn’t valid. Check it and try again.');
  expect(await storedCode(page)).toBeNull();

  await form.getByLabel('Private beta: enter your invite code').fill(`  ${CODE} `);
  await form.getByRole('button', { name: 'Save code' }).click();
  await expect(dialog.getByRole('button', { name: 'Analyze photo' })).toBeVisible();
  expect(await storedCode(page)).toBe(CODE);
  expect(api.statusChecks).toEqual(['Bearer SP-WRONG-WRONG-WRONG-WRONG', `Bearer ${CODE}`]);
  expect(api.scans).toHaveLength(0);

  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  await expect(field(page, 'Item name')).toHaveValue(ITEM_TYPES[1].name);
  expect(api.scans[0].auth).toBe(`Bearer ${CODE}`);
});

test('a rejected invite code is forgotten and can be replaced without losing the photo', async ({ page }) => {
  const api = await mockScanner(page, [failure(403, 'code_revoked', 'This invite code has been turned off.'), success(ITEM_TYPES[2].result)]);
  await onboard(page, 'Reseller');
  await saveCode(page);
  const dialog = await startScan(page);
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  const error = dialog.getByTestId('scan-error');
  await expect(error).toContainText('This invite code has been turned off.');
  expect(await storedCode(page)).toBeNull();
  await expect(error.getByRole('button', { name: 'Try again' })).toHaveCount(0);

  await error.getByLabel('Private beta: enter your invite code').fill(CODE);
  await error.getByRole('button', { name: 'Save code' }).click();
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  await expect(field(page, 'Item name')).toHaveValue(ITEM_TYPES[2].name);
  expect(api.scans).toHaveLength(2);
});

test('limits and budget errors explain themselves and leave manual entry open', async ({ page }) => {
  await mockScanner(page, [
    failure(429, 'code_daily_limit', 'You’ve used all of today’s scans. They reset at midnight UTC.'),
    failure(503, 'budget_exhausted', 'AI scanning is paused for the rest of this month.'),
  ]);
  await onboard(page, 'Reseller');
  await saveCode(page);
  const dialog = await startScan(page);
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  const error = dialog.getByTestId('scan-error');
  await expect(error).toContainText('You’ve used all of today’s scans. They reset at midnight UTC.');
  await expect(error.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  // The code is still good; only today's scans are used up.
  expect(await storedCode(page)).toBe(CODE);

  // A new photo, a new attempt: the monthly budget is spent.
  await uploadScanPhoto(page, '#225522');
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  await expect(error).toContainText('AI scanning is paused for the rest of this month.');

  await error.getByRole('button', { name: 'Enter details manually' }).click();
  await expect(dialog.getByTestId('scan-panel')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Scan with AI instead' })).toBeVisible();
  await field(page, 'Item name').fill('Hand-entered item');
  await dialog.getByLabel('Cost per item').fill('3');
  await dialog.getByRole('button', { name: 'Add item' }).click();
  await expect(dialog).toBeHidden();
  await openItem(page, 'Hand-entered item');
});

test('an AI service failure can be retried', async ({ page }) => {
  const api = await mockScanner(page, [
    failure(502, 'ai_error', 'The AI service had a problem. Try again, or enter the details yourself.'),
    success(ITEM_TYPES[4].result),
  ]);
  await onboard(page, 'Reseller');
  await saveCode(page);
  const dialog = await startScan(page);
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  const error = dialog.getByTestId('scan-error');
  await expect(error).toContainText('The AI service had a problem.');
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(field(page, 'Item name')).toHaveValue(ITEM_TYPES[4].name);
  expect(api.scans).toHaveLength(2);
});

test('no connection and a slow scanner both show a retryable error', async ({ page }) => {
  // The scantest build waits 3 seconds before giving up.
  await mockScanner(page, [{ abort: true }, { delayMs: 4500, ...success(ITEM_TYPES[0].result) }, success(ITEM_TYPES[3].result)]);
  await onboard(page, 'Reseller');
  await saveCode(page);
  const dialog = await startScan(page);
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  const error = dialog.getByTestId('scan-error');
  await expect(error).toContainText('Couldn’t reach the scanner. Check your connection and try again.');
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(dialog.getByText('Analyzing your photo…')).toBeVisible();
  await expect(error).toContainText('The scan took too long. Try again.', { timeout: 6000 });
  await expect(field(page, 'Item name')).toHaveValue('');
  await error.getByRole('button', { name: 'Try again' }).click();
  await expect(field(page, 'Item name')).toHaveValue(ITEM_TYPES[3].name);
});

test('cancelling a scan keeps the photo and fills nothing', async ({ page }) => {
  await mockScanner(page, [{ delayMs: 1500, ...success(ITEM_TYPES[0].result) }]);
  await onboard(page, 'Reseller');
  await saveCode(page);
  const dialog = await startScan(page);
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  await expect(dialog.getByText('Analyzing your photo…')).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel scan' }).click();
  await expect(dialog.getByRole('button', { name: 'Analyze photo' })).toBeVisible();
  await expect(dialog.getByTestId('scan-error')).toHaveCount(0);
  // Wait past the moment the answer would have arrived.
  await page.waitForTimeout(1800);
  await expect(field(page, 'Item name')).toHaveValue('');
  await expect(dialog.getByText('Cover')).toBeVisible();
});

test('the user’s corrections are kept when they scan again', async ({ page }) => {
  await mockScanner(page, [
    success(ITEM_TYPES[0].result),
    success({ ...ITEM_TYPES[0].result, name: 'Nike Air Jordan 1 High', category: 'Basketball shoes', condition: 'unknown', condition_notes: null }),
  ]);
  await onboard(page, 'Reseller');
  await saveCode(page);
  const dialog = await startScan(page);
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  await expect(field(page, 'Item name')).toHaveValue(ITEM_TYPES[0].name);
  await expect(dialog.getByTestId('ai-filled')).toHaveCount(4);

  // The user fixes the name: it's theirs now and loses its AI marker.
  await field(page, 'Item name').fill('Jordan 1 Chicago, size 10');
  await expect(dialog.getByTestId('ai-filled')).toHaveCount(3);

  // A second photo replaces the first and refreshes only the AI-filled fields.
  await uploadScanPhoto(page, '#aa2222');
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  await expect(dialog.getByTestId('scan-filled')).toContainText('Filled in category, notes below');
  await expect(field(page, 'Item name')).toHaveValue('Jordan 1 Chicago, size 10');
  await expect(field(page, 'Category')).toHaveValue('Basketball shoes');
  // The new scan couldn't judge condition, so the earlier guess is cleared rather than kept.
  await expect(field(page, 'Condition')).toHaveValue('');
  await expect(dialog.getByTestId('ai-filled')).toHaveCount(2);
  // Only the latest scan photo stays on the item.
  await expect(dialog.getByRole('button', { name: 'Remove photo' })).toHaveCount(1);

  await dialog.getByLabel('Cost per item').fill('180');
  await field(page, 'Condition').fill('Worn twice');
  await dialog.getByRole('button', { name: 'Add item' }).click();
  await expect(dialog).toBeHidden();
  await openItem(page, 'Jordan 1 Chicago, size 10');
  await expect(page.getByRole('main')).toContainText('Basketball shoes');
  await expect(page.getByRole('main')).toContainText('Worn twice');
});

test('the scanner can be hidden and the normal Add Item works without it', async ({ page }) => {
  const api = await mockScanner(page);
  await onboard(page, 'Reseller');
  await expect(page.getByTestId('get-started').getByRole('button', { name: 'Scan with AI' })).toBeVisible();
  await page.getByRole('button', { name: /^Add (item|your first item)$/ }).first().click();
  const dialog = page.getByTestId('item-form');
  await dialog.getByRole('button', { name: 'Hide AI scanner' }).click();
  await expect(dialog.getByTestId('scan-panel')).toHaveCount(0);
  await field(page, 'Item name').fill('Plain item');
  await dialog.getByLabel('Cost per item').fill('1');
  await dialog.getByRole('button', { name: 'Add item' }).click();
  await expect(dialog).toBeHidden();
  expect(api.scans).toHaveLength(0);
  expect(api.statusChecks).toHaveLength(0);

  // Editing an existing item never shows the scanner.
  await openItem(page, 'Plain item');
  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByTestId('item-form')).toBeVisible();
  await expect(page.getByTestId('scan-panel')).toHaveCount(0);
});

test('Settings: save, check and remove the invite code', async ({ page }) => {
  const api = await mockScanner(page);
  await onboard(page, 'Collector');
  await nav(page, 'Settings');
  const card = page.getByTestId('scanner-settings');
  await expect(card).toContainText('Private beta');
  await expect(card).toContainText('Anthropic automatically deletes API inputs and outputs within 30 days');
  await card.getByLabel('Private beta: enter your invite code').fill(CODE);
  await card.getByRole('button', { name: 'Save code' }).click();
  await expect(card).toContainText('Invite code saved on this device');
  await card.getByRole('button', { name: 'Check code' }).click();
  await expect(card.getByTestId('scanner-status')).toContainText('20 scans left today (of 20)');
  expect(api.statusChecks).toEqual([`Bearer ${CODE}`, `Bearer ${CODE}`]);
  await card.getByRole('button', { name: 'Remove code' }).click();
  await expect(card.getByLabel('Private beta: enter your invite code')).toBeVisible();
  expect(await storedCode(page)).toBeNull();
});

test('the invite code is never included in backups', async ({ page }) => {
  await mockScanner(page);
  await onboard(page, 'Reseller');
  await saveCode(page);
  await nav(page, 'Settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download backup/ }).click();
  const file = await (await download).path();
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(file, 'utf8');
  expect(text).not.toContain(CODE);
  expect(text).not.toContain(CODE_KEY);
});

test('scanner panel and result fit phone screens, with long names shown in full', async ({ page }) => {
  test.skip(!isMobile(page), 'phone layout only');
  const LONG = 'Stanley Quencher H2.0 FlowState Stainless Steel Vacuum Insulated Tumbler with Lid and Straw 40 oz Rose Quartz';
  await mockScanner(page, [success({ ...ITEM_TYPES[0].result, name: LONG, brand: 'Stanley', model: 'Quencher H2.0 FlowState 40 oz', category: 'Drinkware' })]);
  await onboard(page, 'Reseller');
  const dialog = await startScan(page);
  const body = dialog.locator('.overflow-y-auto').first();
  const fits = async (state: string) => {
    for (const width of [320, 375, 390, 414]) {
      await page.setViewportSize({ width, height: 800 });
      await noHorizontalOverflow(page);
      const sideways = await body.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(sideways, `${state} at ${width}px`).toBeLessThanOrEqual(1);
      const panel = await dialog.getByTestId('scan-panel').boundingBox();
      expect(panel!.x + panel!.width, `${state} at ${width}px`).toBeLessThanOrEqual(width);
    }
  };

  // Invite code step: the code field is 16px (no iOS zoom) and can shrink on narrow phones.
  const code = dialog.getByLabel('Private beta: enter your invite code');
  expect(parseFloat(await code.evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await fits('invite code');
  await code.fill(CODE);
  await dialog.getByRole('button', { name: 'Save code' }).click();
  await fits('ready');
  await dialog.getByRole('button', { name: 'Analyze photo' }).click();
  await expect(dialog.getByTestId('scan-result')).toBeVisible();
  await fits('result');

  // The suggested name is shown in full (wrapped, not cut off), and fills the form.
  const shown = dialog.getByTestId('scan-result').locator('dd').first();
  await expect(shown).toHaveText(LONG);
  const style = await shown.evaluate((el) => ({ overflow: getComputedStyle(el).textOverflow, clipped: el.scrollWidth > el.clientWidth + 1 }));
  expect(style).toEqual({ overflow: 'clip', clipped: false });
  await expect(field(page, 'Item name')).toHaveValue(LONG);
});

test.describe('standard build (scanner off)', () => {
  test.use({ baseURL: STANDARD_APP });

  test('shows no scanner anywhere', async ({ page }) => {
    let requests = 0;
    await page.route(`${API}/**`, (route) => {
      requests++;
      return route.abort();
    });
    await onboard(page, 'Reseller');
    await expect(page.getByTestId('get-started')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Scan with AI' })).toHaveCount(0);
    await nav(page, 'Inventory');
    await expect(page.getByRole('button', { name: 'Scan with AI' })).toHaveCount(0);
    await page.getByRole('button', { name: /^Add (item|your first item)$/ }).first().click();
    await expect(page.getByTestId('item-form')).toBeVisible();
    await expect(page.getByTestId('scan-panel')).toHaveCount(0);
    await page.getByTestId('item-form').getByRole('button', { name: 'Cancel' }).click();
    await nav(page, 'Settings');
    // Wait for Settings to render, so the "nothing here" checks can't pass on the previous page.
    await expect(page.getByRole('heading', { name: 'Your data' })).toBeVisible();
    await expect(page.getByTestId('scanner-settings')).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText(/AI scanner|invite code/i);
    expect(requests).toBe(0);
  });
});
