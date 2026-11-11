// "AI That Shows Its Work" (Signature Feature 3): assistant answers come with their calculation,
// the records behind it and links to them. The standard build has no AI at all; the AI build's
// backend is mocked, so no test reaches a real AI service or costs anything.

import { expect, test, type Page, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { addItem, nav, noHorizontalOverflow, onboard, recordSale } from './helpers';
import { FEB, importReport, PAYOUTS, setUpSeller } from './payoutHelpers';

const SCAN_APP = 'http://localhost:4175/';
const API = 'http://scan.test';
const CODE = 'SP-TEST1-TEST2-TEST3-TEST4';
const CODE_KEY = 'stockpilot-scan-invite-code';

/** Boots: 1 sold for $60 (fees $7.50, shipping $5). Lamp: sold for $10 after costing $15 (fees $1). */
async function smallShop(page: Page) {
  await onboard(page, 'Reseller');
  await addItem(page, { name: 'Leather boots', quantity: 2, cost: '20' });
  await addItem(page, { name: 'Brass lamp', quantity: 1, cost: '15' });
  await nav(page, 'Sales & Profit');
  await page.getByRole('button', { name: 'Record your first sale' }).click();
  await recordSale(page, { item: 'Leather boots', price: '60', fees: '7.50', shipping: '5', platform: 'eBay' });
  await expect(page.getByTestId('sale-form')).toBeHidden();
  await page.getByRole('button', { name: 'Record sale' }).first().click();
  await recordSale(page, { item: 'Brass lamp', price: '10', fees: '1', platform: 'Etsy' });
  await expect(page.getByTestId('sale-form')).toBeHidden();
  await nav(page, 'Smart Insights');
}

async function ask(page: Page, question: string) {
  const assistant = page.getByTestId('assistant');
  await assistant.getByLabel('Ask a question').fill(question);
  await assistant.getByRole('button', { name: 'Ask', exact: true }).click();
  return assistant.getByTestId('assistant-answer').last();
}

test.describe('standard build (no AI)', () => {
  test('a profit answer shows its calculation, the records behind it, and links to them', async ({ page }) => {
    await smallShop(page);
    const answer = await ask(page, 'How much profit have I made this month?');
    await expect(answer).toContainText('Your realized profit this month was $21.50.');

    const calc = answer.getByTestId('calculation');
    await expect(calc).toContainText('Recorded figures');
    const lines = calc.getByTestId('calculation-lines');
    await expect(lines).toContainText(/Sales revenue\s*\+\$70\.00/);
    await expect(lines).toContainText(/Cost of goods sold\s*−\$35\.00/);
    await expect(lines).toContainText(/Gross profit\s*\$35\.00/);
    await expect(lines).toContainText(/Marketplace fees\s*−\$8\.50/);
    await expect(lines).toContainText(/Shipping you paid\s*−\$5\.00/);
    await expect(lines).toContainText(/Other expenses\s*\$0\.00/);
    await expect(lines).toContainText(/Realized profit\s*\$21\.50/);
    await expect(answer.getByTestId('calculation-details')).toBeHidden();

    await answer.getByTestId('view-calculation').click();
    const details = answer.getByTestId('calculation-details');
    await expect(details).toContainText('Realized profit = sales revenue − cost of goods sold − marketplace fees − shipping you paid − other expenses');
    await expect(details.getByTestId('calculation-verified')).toContainText('every figure above adds up from the 2 records below');
    const records = details.getByTestId('calculation-record');
    await expect(records).toHaveCount(2);
    const lamp = records.filter({ hasText: 'Brass lamp' });
    await expect(lamp).toContainText('Sales revenue $10.00 · Cost of goods sold $15.00 · Marketplace fees $1.00 · Realized profit −$6.00');
    await expect(lamp).toContainText('Etsy');
    await noHorizontalOverflow(page);

    const { violations } = await new AxeBuilder({ page }).include('[data-testid="assistant"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([]);

    await lamp.getByRole('link', { name: 'Brass lamp →' }).click();
    await expect(page.getByTestId('item-title')).toHaveText('Brass lamp');
  });

  test('asks which period when it matters, and answers zero sales and losses from the records', async ({ page }) => {
    await smallShop(page);
    const clarify = await ask(page, 'What were my total sales?');
    await expect(clarify).toContainText('Which period do you mean? Sales depends on the dates.');
    await expect(clarify.getByTestId('calculation')).toHaveCount(0);
    const chips = page.getByTestId('assistant-suggestions');
    await expect(chips.getByRole('button')).toHaveText(['What were my total sales this month?', 'What were my total sales last month?', 'What were my total sales this year?', 'What were my total sales all time?']);

    await chips.getByRole('button', { name: 'What were my total sales last month?' }).click();
    const none = page.getByTestId('assistant-answer').last();
    await expect(none).toContainText('You have no recorded sales last month, so sales revenue last month is $0.00.');

    await expect(await ask(page, 'What were my total sales this month?')).toContainText('Your total sales this month were $70.00, from 2 sales (2 units).');

    const losses = await ask(page, 'Which items should I review for possible losses?');
    await expect(losses.getByTestId('calculation-lines')).toContainText(/Lost on completed sales \(recorded\)\s*\$6\.00/);
    await losses.getByTestId('view-calculation').click();
    await expect(losses.getByTestId('calculation-record').filter({ hasText: 'Brass lamp' })).toBeVisible();

    // Inventory purchases aren't an expense: what's still in stock is inventory cost.
    const spend = await ask(page, 'How much have I spent on inventory?');
    await expect(spend).toContainText('You’ve recorded $55.00 of inventory purchases in total. $20.00 of it is still in stock (your inventory cost) and $35.00 has been sold');
  });

  test('a payout question uses the reconciliation, keeps confirmed and possible apart, and links to the evidence', async ({ page }) => {
    await setUpSeller(page);
    await importReport(page, FEB);
    await importReport(page, PAYOUTS);
    await nav(page, 'Smart Insights');

    const answer = await ask(page, 'Why is my eBay payout $38.06 off?');
    const calc = answer.getByTestId('calculation');
    await expect(calc).toContainText('From payout reconciliation');
    await expect(calc.getByTestId('calculation-lines')).toContainText(/Expected payout\s*\$39\.76/);
    await expect(calc.getByTestId('calculation-lines')).toContainText(/Actual payout \(from eBay’s payout report\)\s*\$77\.82/);
    await expect(calc.getByTestId('calculation-lines')).toContainText(/Difference \(more than expected\)\s*\$38\.06/);
    await expect(answer).toContainText('A payout is money moved, not profit.');

    await answer.getByTestId('view-calculation').click();
    const records = answer.getByTestId('calculation-record');
    await expect(records.filter({ hasText: 'Possible explanation: Sale not recorded in StockPilot' })).toContainText('$42.11');
    await expect(records.filter({ hasText: 'Confirmed: Marketplace fees differ' })).toContainText('−$3.65');
    await expect(records.filter({ hasText: 'Shipping label cost differs' })).toContainText('−$0.40');
    await noHorizontalOverflow(page);

    await records.filter({ hasText: 'Confirmed: Marketplace fees differ' }).getByRole('link', { name: 'See the evidence →' }).click();
    await expect(page.getByTestId('payout-status')).toContainText('Unreconciled');
  });

  test('the standard build offers no AI and sends nothing', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith('http://localhost')) requests.push(r.url());
    });
    await smallShop(page);
    await expect(page.getByTestId('assistant')).toContainText('Answers use fixed rules, not an AI model.');
    await ask(page, 'How much profit have I made this month?');
    await ask(page, 'Am I doing okay?');
    await expect(page.getByTestId('assistant-answer').last()).toContainText('not an AI model');
    await expect(page.getByRole('button', { name: /Explain with AI|Ask AI/ })).toHaveCount(0);
    expect(requests).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// AI build (port 4175) with a mocked backend
// ---------------------------------------------------------------------------

type Reply = { status?: number; json: unknown };
const explained = (explanation: string | null, unverified: string[] = []): Reply => ({
  json: { ok: true, mode: 'explain', explanation, verified: explanation !== null, unverified, model: { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, requestsLeftToday: 17 },
});

async function mockAssistant(page: Page, replies: Reply[]) {
  const sent: { auth: string | undefined; body: Record<string, unknown> }[] = [];
  await page.route(`${API}/**`, async (route: Route) => {
    const req = route.request();
    const cors = { 'access-control-allow-origin': new URL(SCAN_APP).origin, 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-allow-methods': 'GET, POST, OPTIONS', vary: 'Origin' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (new URL(req.url()).pathname !== '/v1/assistant') return route.fulfill({ status: 404, headers: cors, body: '{}' });
    sent.push({ auth: (await req.allHeaders()).authorization, body: req.postDataJSON() as Record<string, unknown> });
    const reply = replies[Math.min(sent.length - 1, replies.length - 1)];
    await route.fulfill({ status: reply.status ?? 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(reply.json) });
  });
  return sent;
}

test.describe('AI build (mocked backend)', () => {
  test.use({ baseURL: SCAN_APP });

  const saveCode = (page: Page) => page.evaluate(([key, code]) => localStorage.setItem(key, code), [CODE_KEY, CODE]);

  test('explaining an answer is opt-in, sends only its figures, and shows wording whose numbers check out', async ({ page }) => {
    const sent = await mockAssistant(page, [
      explained('You made $21.50 this month: $70.00 of sales, minus $35.00 the items cost you, $8.50 in fees and $5.00 of shipping.'),
    ]);
    await smallShop(page);
    await expect(page.getByTestId('assistant')).toContainText('AI can explain an answer when you ask; it never calculates.');
    const answer = await ask(page, 'How much profit have I made this month?');
    await expect(answer).toContainText('Your realized profit this month was $21.50.');
    expect(sent).toHaveLength(0);

    // Without an invite code nothing can be sent.
    await answer.getByRole('button', { name: 'Explain with AI' }).click();
    await expect(answer.getByTestId('ai-explain-confirm')).toContainText('Not your notes, photos or the rest of your inventory.');
    await expect(answer.getByRole('link', { name: 'Add it in Settings' })).toBeVisible();
    await expect(answer.getByTestId('ai-explain-send')).toHaveCount(0);

    await saveCode(page);
    await nav(page, 'Overview');
    await nav(page, 'Smart Insights');
    const again = await ask(page, 'How much profit have I made this month?');
    await again.getByRole('button', { name: 'Explain with AI' }).click();
    await expect(again.getByTestId('ai-explain-confirm')).toContainText('sends your question and the figures in this calculation');
    expect(sent).toHaveLength(0);
    await again.getByTestId('ai-explain-send').click();

    const explanation = again.getByTestId('ai-explanation');
    await expect(explanation).toContainText('You made $21.50 this month');
    await expect(explanation).toContainText('Every number in it was checked against the calculation above.');
    await expect(explanation).toContainText('17 AI requests left today.');
    await noHorizontalOverflow(page);

    expect(sent).toHaveLength(1);
    expect(sent[0].auth).toBe(`Bearer ${CODE}`);
    const body = sent[0].body as { mode: string; question: string; facts: { answer: string; lines: { label: string; amount: string }[]; records: unknown[]; recordCount: number } };
    expect(Object.keys(body).sort()).toEqual(['facts', 'mode', 'question']);
    expect(body.mode).toBe('explain');
    expect(body.question).toBe('How much profit have I made this month?');
    expect(body.facts.answer).toBe('Your realized profit this month was $21.50.');
    expect(body.facts.lines.at(-1)).toEqual({ label: 'Realized profit', amount: '$21.50' });
    expect(body.facts.recordCount).toBe(2);
    expect(JSON.stringify(body)).not.toMatch(/photo|notes|data:image/i);
  });

  test('wording with a number that isn’t in the calculation is never shown, even if the server lets it through', async ({ page }) => {
    await mockAssistant(page, [
      // A buggy or compromised backend claims this is verified; the app checks again.
      explained('Your profit was $21.50, and you’ll make $999.00 next month.'),
      // The backend's own refusal.
      explained(null, ['$12.00']),
      { status: 429, json: { error: { code: 'code_daily_limit', message: 'You’ve used all of today’s AI requests (scans and AI answers share one daily limit). They reset at midnight UTC.' } } },
      { status: 429, json: { error: { code: 'budget_exhausted', message: 'AI features are paused for the rest of this month: the shared monthly AI budget is used up.' } } },
    ]);
    await smallShop(page);
    await saveCode(page);

    for (const expected of ['$999.00', '$12.00']) {
      const answer = await ask(page, 'How much profit have I made this month?');
      await answer.getByRole('button', { name: 'Explain with AI' }).click();
      await answer.getByTestId('ai-explain-send').click();
      await expect(answer.getByTestId('ai-explanation-refused')).toContainText(expected);
      await expect(answer.getByTestId('ai-explanation-refused')).toContainText('isn’t shown. The verified calculation above is unchanged.');
      await expect(answer.getByTestId('ai-explanation')).toHaveCount(0);
      await expect(answer).not.toContainText('next month');
      await expect(answer.getByTestId('calculation-lines')).toContainText(/Realized profit\s*\$21\.50/);
    }

    for (const message of ['scans and AI answers share one daily limit', 'the shared monthly AI budget is used up']) {
      const answer = await ask(page, 'How much profit have I made this month?');
      await answer.getByRole('button', { name: 'Explain with AI' }).click();
      await answer.getByTestId('ai-explain-send').click();
      await expect(answer.getByTestId('ai-explain-error')).toContainText(message);
      await expect(answer.getByTestId('calculation-lines')).toContainText(/Realized profit\s*\$21\.50/);
    }
  });

  test('AI can map an unrecognized question to a supported one, but the answer is still calculated from the records', async ({ page }) => {
    const sent = await mockAssistant(page, [
      { json: { ok: true, mode: 'interpret', intent: 'realized_profit', period: 'this_month', model: { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, requestsLeftToday: 18 } },
      { json: { ok: true, mode: 'interpret', intent: 'unsupported', period: 'none', model: { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, requestsLeftToday: 17 } },
    ]);
    await smallShop(page);
    await saveCode(page);

    const unknown = await ask(page, 'how are my flips going');
    await expect(unknown).toContainText('not an AI model');
    await unknown.getByRole('button', { name: 'Ask AI to understand the question' }).click();
    await expect(unknown).toContainText('This sends only your question (no records)');
    await unknown.getByTestId('ai-interpret-send').click();

    const mapped = page.getByTestId('assistant-answer').last();
    await expect(mapped.getByTestId('interpreted-as')).toContainText('AI understood this as “How much profit did I make this month?”');
    await expect(mapped).toContainText('Your realized profit this month was $21.50.');
    await expect(mapped.getByTestId('calculation-lines')).toContainText(/Realized profit\s*\$21\.50/);
    expect(sent[0].body).toEqual({ mode: 'interpret', question: 'how are my flips going' });
    // The original question doesn't offer a second request.
    await expect(unknown).toContainText('Answered below, from your records.');
    await expect(unknown.getByRole('button', { name: 'Ask AI to understand the question' })).toHaveCount(0);

    const other = await ask(page, 'write me a poem about candles');
    await other.getByRole('button', { name: 'Ask AI to understand the question' }).click();
    await other.getByTestId('ai-interpret-send').click();
    await expect(other.getByTestId('ai-interpret-unsupported')).toContainText('there’s no answer rather than a guess');
    expect(sent).toHaveLength(2);
  });
});
