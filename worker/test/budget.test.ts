// The monthly AI budget: how big each reservation is, why it covers the worst case, and that
// overruns, concurrency, failures and bad configuration can't quietly get past it.

import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { SCAN_JSON_SCHEMA, SCAN_SYSTEM_PROMPT, SCAN_USER_PROMPT } from '../../src/ai/scanSchema';
import { interpretMessage } from '../src/claude';
import { hashCode, normalizeCode } from '../src/codes';
import {
  costMicros,
  imageTokenBound,
  loadConfig,
  MAX_IMAGE_TOKENS,
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  MODELS,
  pricingProblem,
  PROMPT_TOKENS_BOUND,
  REQUEST_OVERHEAD_TOKENS,
  worstCaseMicros,
  type ScanModel,
} from '../src/config';
import { handleRequest, type HandlerDeps } from '../src/handler';
import { LedgerCore, type BeginResult } from '../src/ledgerCore';
import { asyncLedger, fakeClient, fakeJpegBase64, fakeMessage, memorySql, SNEAKERS } from './helpers';

const NOW = Date.UTC(2026, 10, 10, 15);

describe('prices', () => {
  it('match Anthropic’s published rates (change this test deliberately if they change)', () => {
    // https://platform.claude.com/docs/en/about-claude/pricing — USD per million tokens.
    expect(MODELS['claude-haiku-5-5']).toMatchObject({ inputMicrosPerToken: 0.1, outputMicrosPerToken: 0.5 });
    expect(MODELS['claude-sonnet-5-5']).toMatchObject({ inputMicrosPerToken: 2, outputMicrosPerToken: 10 });
    expect(MODELS['claude-opus-5-5']).toMatchObject({ inputMicrosPerToken: 4, outputMicrosPerToken: 20 });
    for (const model of Object.keys(MODELS)) expect(pricingProblem(model), model).toBeNull();
  });

  it('switch the scanner off when a price is missing or invalid, instead of ignoring the budget', () => {
    const table = (input: number, output: number) => ({ m: { label: 'M', inputMicrosPerToken: input, outputMicrosPerToken: output } });
    expect(pricingProblem('unknown-model')).toMatch(/no price/);
    for (const [input, output] of [[0, 10], [2, 0], [-1, 10], [Number.NaN, 10], [2, Number.POSITIVE_INFINITY], [10, 2]]) {
      expect(pricingProblem('m', table(input, output)), `${input}/${output}`).toMatch(/invalid/);
    }
    expect(pricingProblem('m', table(2, 10))).toBeNull();
    const config = loadConfig({ ANTHROPIC_API_KEY: 'k', CODE_PEPPER: 'p'.repeat(40), SCAN_MODEL: 'claude-sonnet-9' });
    expect(config.enabled).toBe(false);
  });

  it('charge cache tokens at the highest rates, so caching can never make a scan look cheaper', () => {
    expect(costMicros('claude-sonnet-5-5', 1000, 100, 500)).toBe((1000 + 2 * 500) * 2 + 100 * 10);
    const cached = fakeMessage(SNEAKERS);
    cached.usage = { ...cached.usage, input_tokens: 1000, cache_creation_input_tokens: 500, cache_read_input_tokens: 300, output_tokens: 100 };
    const outcome = interpretMessage(cached, 'claude-sonnet-5-5');
    expect(outcome.costMicros).toBe((1000 + 300 + 2 * 500) * 2 + 100 * 10);
  });
});

describe('monthly budget setting', () => {
  const base = { ANTHROPIC_API_KEY: 'k', CODE_PEPPER: 'p'.repeat(40) };
  it('defaults to $10 and accepts plain dollar amounts up to the ceiling', () => {
    expect(loadConfig(base).limits.monthlyBudgetMicros).toBe(10_000_000);
    expect(loadConfig({ ...base, MONTHLY_BUDGET_USD: '25.50' }).limits.monthlyBudgetMicros).toBe(25_500_000);
    expect(loadConfig({ ...base, MONTHLY_BUDGET_USD: '0' })).toMatchObject({ enabled: true, limits: { monthlyBudgetMicros: 0 } });
  });

  it('switches the scanner off for a typo or an amount above the ceiling', () => {
    for (const bad of ['1000', '10O', '-5', '$10', '1e2', 'ten', '']) {
      const config = loadConfig({ ...base, MONTHLY_BUDGET_USD: bad });
      expect(config.enabled, bad).toBe(false);
      expect(config.limits.monthlyBudgetMicros, bad).toBe(0);
      expect(config.problems.join(), bad).toMatch(/MONTHLY_BUDGET_USD/);
    }
  });

  it('keeps the beta limits by default: 20 per tester, 200 a day', () => {
    expect(loadConfig(base).limits).toMatchObject({ dailyPerCode: 20, dailyGlobal: 200, monthlyBudgetMicros: 10_000_000 });
  });
});

describe('reservation size', () => {
  it('is built from the image cap, the actual prompt and an allowance for API overhead', () => {
    const chars = SCAN_SYSTEM_PROMPT.length + SCAN_USER_PROMPT.length + JSON.stringify(SCAN_JSON_SCHEMA).length;
    expect(PROMPT_TOKENS_BOUND).toBe(Math.ceil(chars / 2));
    expect(MAX_INPUT_TOKENS).toBe(MAX_IMAGE_TOKENS + PROMPT_TOKENS_BOUND + REQUEST_OVERHEAD_TOKENS);
    // Generous: the instructions are estimated at 1 token per 2 characters (real text: 3–4).
    expect(PROMPT_TOKENS_BOUND).toBeGreaterThanOrEqual(Math.ceil(chars / 3.5) * 1.5);
    expect(MAX_OUTPUT_TOKENS).toBe(2048);
  });

  it('covers the most expensive image the AI provider accepts, at any size or shape', () => {
    // Token counts from Anthropic's vision docs (high-resolution tier).
    expect(imageTokenBound(1000, 1000)).toBe(1296);
    expect(imageTokenBound(1920, 1080)).toBe(2691);
    expect(imageTokenBound(1600, 1200)).toBe(2494);
    for (const [w, h] of [[3840, 2160], [8000, 8000], [8000, 1], [1, 8000], [2576, 1932]]) {
      const tokens = imageTokenBound(w, h);
      expect(tokens, `${w}x${h}`).toBeLessThanOrEqual(MAX_IMAGE_TOKENS);
      expect(tokens + PROMPT_TOKENS_BOUND + REQUEST_OVERHEAD_TOKENS).toBeLessThanOrEqual(MAX_INPUT_TOKENS);
    }
  });

  it('is computed per model and stays a few cents', () => {
    const expected: Record<ScanModel, number> = {
      'claude-haiku-5-5': Math.ceil(MAX_INPUT_TOKENS * 0.1 + 2048 * 0.5),
      'claude-sonnet-5-5': MAX_INPUT_TOKENS * 2 + 2048 * 10,
      'claude-opus-5-5': MAX_INPUT_TOKENS * 4 + 2048 * 20,
    };
    for (const [model, micros] of Object.entries(expected)) expect(worstCaseMicros(model as ScanModel), model).toBe(micros);
    expect(worstCaseMicros('claude-sonnet-5-5')).toBeLessThan(40_000); // < $0.04
    expect(worstCaseMicros('claude-opus-5-5')).toBeLessThan(75_000); // < $0.075
  });
});

describe('ledger overruns', () => {
  const limits = { dailyPerCode: 1000, dailyGlobal: 1000, perMinutePerCode: 1000, monthlyBudgetMicros: 1_000_000 };
  const setup = () => {
    const core = new LedgerCore(memorySql());
    core.createCode({ id: 'c1', hash: 'h1', label: 'T', dailyLimit: 1000, expiresAt: NOW + 90 * 86_400_000, now: NOW });
    let n = 0;
    const begin = (estimate: number, now = NOW): BeginResult =>
      core.beginScan({ codeHash: 'h1', clientKey: 'k', reservationId: `r${n++}`, estimateMicros: estimate, limits, now });
    return { core, begin };
  };

  it('charges a scan that cost more than its reservation in full and records it', () => {
    const { core, begin } = setup();
    const r = begin(10_000);
    if (!r.ok) throw new Error('expected ok');
    expect(core.finishScan({ reservationId: r.reservationId, actualMicros: 25_000, refundScan: false })).toEqual({ chargedMicros: 25_000, overrunMicros: 15_000 });
    expect(core.usage(NOW, limits)).toMatchObject({ spentMicros: 25_000, reservedMicros: 0, overruns: { count: 1, excessMicros: 15_000, maxScanMicros: 25_000 } });
  });

  it('raises later reservations to the most expensive scan seen, so the budget self-corrects', () => {
    const { core, begin } = setup();
    const first = begin(10_000);
    if (!first.ok) throw new Error('expected ok');
    expect(first.reservedMicros).toBe(10_000);
    core.finishScan({ reservationId: first.reservationId, actualMicros: 40_000, refundScan: false });
    const next = begin(10_000);
    expect(next).toMatchObject({ ok: true, reservedMicros: 40_000 });
    // Budget: 1,000,000 − 40,000 spent − 40,000 reserved leaves room for 23 more such reservations.
    const more: BeginResult[] = [];
    for (let i = 0; i < 30; i++) more.push(begin(10_000));
    expect(more.filter((r) => r.ok)).toHaveLength(23);
    expect(more.at(-1)).toMatchObject({ ok: false, error: 'budget_exhausted' });
    const usage = core.usage(NOW, limits);
    expect(usage.spentMicros + usage.reservedMicros).toBeLessThanOrEqual(limits.monthlyBudgetMicros);
  });

  it('charges the reservation when a cost can’t be read', () => {
    const { core, begin } = setup();
    const r = begin(10_000);
    if (!r.ok) throw new Error('expected ok');
    expect(core.finishScan({ reservationId: r.reservationId, actualMicros: Number.NaN, refundScan: false })).toMatchObject({ chargedMicros: 10_000 });
  });

  it('starts a new month with the normal reservation again', () => {
    const { core, begin } = setup();
    const r = begin(10_000);
    if (!r.ok) throw new Error('expected ok');
    core.finishScan({ reservationId: r.reservationId, actualMicros: 40_000, refundScan: false });
    expect(begin(10_000, Date.UTC(2026, 11, 1, 1))).toMatchObject({ ok: true, reservedMicros: 10_000 });
  });
});

describe('budget through the scan endpoint', () => {
  const ADMIN = 'a'.repeat(48);
  function setup(opts: { budget: string; respond?: () => Promise<Anthropic.Message>; daily?: string }) {
    const core = new LedgerCore(memorySql());
    const logs: Record<string, unknown>[] = [];
    const config = loadConfig({
      ANTHROPIC_API_KEY: 'sk-test',
      CODE_PEPPER: 'p'.repeat(48),
      ADMIN_TOKEN: ADMIN,
      MONTHLY_BUDGET_USD: opts.budget,
      DAILY_SCANS_PER_CODE: opts.daily ?? '20',
      SCANS_PER_MINUTE_PER_CODE: '60',
    });
    const ai = fakeClient(opts.respond ?? (async () => fakeMessage(SNEAKERS)));
    const deps: HandlerDeps = { config, ledger: asyncLedger(core), ai, now: () => NOW, log: (e) => logs.push(e) };
    const send = (path: string, init: RequestInit = {}) => handleRequest(new Request(`https://scanner.example${path}`, init), deps);
    const createCode = async (dailyLimit?: number) =>
      ((await (await send('/admin/codes', { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ label: 'T', dailyLimit }) })).json()) as { code: string }).code;
    const scan = (code: string) =>
      send('/v1/scan', { method: 'POST', headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ image: fakeJpegBase64() }) });
    const usage = () => core.usage(NOW, config.limits);
    return { core, ai, logs, send, createCode, scan, usage, config };
  }
  const WORST = worstCaseMicros('claude-sonnet-5-5'); // 34,750 µ$
  const ACTUAL = 3000 * 2 + 400 * 10; // what each fake scan reports: 10,000 µ$

  it('lets only as many simultaneous scans reach the AI as the budget can cover', async () => {
    // $0.10 covers 2 worst-case reservations (69,500 µ$) but not 3 (104,250 µ$).
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = setup({ budget: '0.10', respond: async () => (await gate, fakeMessage(SNEAKERS)) });
    const code = await t.createCode();
    const pending = Array.from({ length: 10 }, () => t.scan(code));
    await new Promise((r) => setTimeout(r, 20));
    expect(t.ai.calls).toHaveLength(2);
    expect(t.usage()).toMatchObject({ reservedMicros: 2 * WORST, spentMicros: 0 });
    release();
    const statuses = (await Promise.all(pending)).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(2);
    expect(statuses.filter((s) => s === 503)).toHaveLength(8);
    expect(t.usage()).toMatchObject({ reservedMicros: 0, spentMicros: 2 * ACTUAL });
  });

  it('stops scanning before the budget is exceeded, and never goes over it', async () => {
    const t = setup({ budget: '0.10', daily: '200' });
    const code = await t.createCode(200);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await t.scan(code)).status);
    // Each scan reserves 34,750 and settles at 10,000: 7 fit (6 × 10,000 + 34,750 ≤ 100,000).
    expect(statuses.filter((s) => s === 200)).toHaveLength(7);
    expect(statuses.slice(7).every((s) => s === 503)).toBe(true);
    expect(t.ai.calls).toHaveLength(7);
    expect(t.usage().spentMicros).toBe(7 * ACTUAL);
    expect(t.usage().spentMicros).toBeLessThanOrEqual(100_000);
  });

  it('charges timeouts at the full reservation, so they use up the budget conservatively', async () => {
    const t = setup({ budget: '0.10', respond: () => Promise.reject(new Anthropic.APIConnectionTimeoutError()) });
    const code = await t.createCode();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await t.scan(code)).status);
    expect(statuses).toEqual([504, 504, 503, 503]);
    expect(t.usage()).toMatchObject({ spentMicros: 2 * WORST, reservedMicros: 0, scansToday: 2 });
  });

  it('records and reports a scan that cost more than reserved, and adjusts the next reservation', async () => {
    const huge = fakeMessage(SNEAKERS);
    huge.usage = { ...huge.usage, input_tokens: 20_000, output_tokens: 2048 };
    const t = setup({ budget: '10', respond: async () => huge });
    const code = await t.createCode();
    expect((await t.scan(code)).status).toBe(200);
    const charged = 20_000 * 2 + 2048 * 10;
    expect(t.logs.find((l) => l.evt === 'budget_overrun')).toMatchObject({ reservedMicros: WORST, chargedMicros: charged });
    const usage = (await (await t.send('/admin/usage', { headers: { Authorization: `Bearer ${ADMIN}` } })).json()) as any;
    expect(usage.overruns).toMatchObject({ count: 1, maxScanMicros: charged });
    expect(usage.scanner).toMatchObject({ reservationPerScanMicros: WORST, pricePerMillionTokens: { input: 2, output: 10 }, maxTokensPerScan: { input: MAX_INPUT_TOKENS, output: 2048 } });
    // The next scan reserves the larger amount.
    const codeHash = await hashCode('p'.repeat(48), normalizeCode(code)!);
    const next = t.core.beginScan({ codeHash, clientKey: 'k', reservationId: 'next', estimateMicros: WORST, limits: t.config.limits, now: NOW });
    expect(next).toMatchObject({ ok: true, reservedMicros: charged });
  });
});
