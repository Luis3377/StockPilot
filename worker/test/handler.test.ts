import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { handleRequest, type HandlerDeps } from '../src/handler';
import { loadConfig, worstCaseMicros, type ConfigEnv } from '../src/config';
import { LedgerCore } from '../src/ledgerCore';
import { asyncLedger, fakeClient, fakeJpegBase64, fakeMessage, memorySql, SNEAKERS } from './helpers';

const ADMIN = 'a'.repeat(48);
const BASE_ENV: ConfigEnv = {
  ANTHROPIC_API_KEY: 'sk-test',
  CODE_PEPPER: 'p'.repeat(48),
  ADMIN_TOKEN: ADMIN,
  ALLOWED_ORIGINS: 'https://preview.example',
};
const ORIGIN = 'https://preview.example';
const URL_BASE = 'https://scanner.example';

function setup(opts: { env?: ConfigEnv; respond?: () => Promise<Anthropic.Message>; assets?: HandlerDeps['assets'] } = {}) {
  const core = new LedgerCore(memorySql());
  const logs: Record<string, unknown>[] = [];
  const ai = fakeClient(opts.respond ?? (async () => fakeMessage(SNEAKERS)));
  const config = loadConfig({ ...BASE_ENV, ...opts.env });
  let clock = Date.UTC(2026, 10, 10, 15);
  const deps: HandlerDeps = { config, ledger: asyncLedger(core), ai: config.anthropicApiKey ? ai : null, now: () => clock, log: (e) => logs.push(e), assets: opts.assets };
  const send = (path: string, init: RequestInit & { origin?: string | null } = {}) => {
    const headers = new Headers(init.headers);
    if (init.origin !== null) headers.set('Origin', init.origin ?? ORIGIN);
    headers.set('CF-Connecting-IP', headers.get('CF-Connecting-IP') ?? '203.0.113.5');
    return handleRequest(new Request(`${URL_BASE}${path}`, { ...init, headers }), deps);
  };
  const createCode = async (label = 'Tester', extra: Record<string, unknown> = {}) => {
    const res = await send('/admin/codes', { method: 'POST', origin: null, headers: { Authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ label, ...extra }) });
    expect(res.status).toBe(201);
    return (await res.json()) as { code: string; id: string };
  };
  const scan = (code: string | null, body: unknown = { image: fakeJpegBase64() }, ip?: string) =>
    send('/v1/scan', {
      method: 'POST',
      headers: { ...(code ? { Authorization: `Bearer ${code}` } : {}), 'Content-Type': 'application/json', ...(ip ? { 'CF-Connecting-IP': ip } : {}) },
      body: JSON.stringify(body),
    });
  return { core, ai, logs, send, scan, createCode, config, tick: (ms: number) => (clock += ms) };
}

describe('scan endpoint', () => {
  it('returns validated suggestions and counts the scan', async () => {
    const t = setup();
    const { code } = await t.createCode();
    const res = await t.scan(code);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const body = (await res.json()) as Record<string, any>;
    expect(body.result).toMatchObject({ status: 'identified', name: 'Nike Air Force 1 Low White', condition: 'good' });
    expect(body.scansLeftToday).toBe(19);
    expect(body.model).toEqual({ id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' });
    // Actual cost recorded, nothing left reserved.
    expect(t.core.usage(Date.UTC(2026, 10, 10, 15), t.config.limits)).toMatchObject({ spentMicros: 3000 * 2 + 400 * 10, reservedMicros: 0, scansToday: 1 });
  });

  it('never logs the image or the invite code', async () => {
    const t = setup();
    const { code } = await t.createCode();
    const image = fakeJpegBase64();
    await t.scan(code, { image });
    const logged = JSON.stringify(t.logs);
    expect(logged).not.toContain(image.slice(0, 40));
    expect(logged).not.toContain(code);
    expect(t.logs.find((l) => l.evt === 'scan')).toMatchObject({ inTok: 3000, outTok: 400 });
  });

  it('requires a valid code, and throttles guessing', async () => {
    const t = setup();
    expect((await t.scan(null)).status).toBe(401);
    for (let i = 0; i < 10; i++) {
      const res = await t.scan('SP-AAAAA-AAAAA-AAAAA-AAAAA');
      expect(res.status).toBe(401);
    }
    const locked = await t.scan('SP-AAAAA-AAAAA-AAAAA-AAAAA');
    expect(locked.status).toBe(429);
    expect(locked.headers.get('Retry-After')).toBeTruthy();
    expect(((await locked.json()) as any).error.code).toBe('too_many_attempts');
    expect(t.ai.calls).toHaveLength(0);
  });

  it('rejects revoked and expired codes', async () => {
    const t = setup();
    const { code, id } = await t.createCode('Short', { days: 1 });
    await t.send(`/admin/codes/${id}/revoke`, { method: 'POST', origin: null, headers: { Authorization: `Bearer ${ADMIN}` } });
    expect(((await (await t.scan(code)).json()) as any).error.code).toBe('code_revoked');
    const other = await t.createCode('Expiring', { days: 1 });
    t.tick(2 * 86_400_000);
    const res = await t.scan(other.code, undefined, '198.51.100.9');
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).error.code).toBe('code_expired');
  });

  it('rejects invalid images without calling the AI and refunds the scan', async () => {
    const t = setup();
    const { code } = await t.createCode();
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(2000)]).toString('base64');
    expect((await t.scan(code, { image: pdf })).status).toBe(415);
    expect((await t.scan(code, { image: 'nope!' })).status).toBe(422);
    expect((await t.scan(code, { nothing: true })).status).toBe(400);
    const notJson = await t.send('/v1/scan', { method: 'POST', headers: { Authorization: `Bearer ${code}` }, body: '{oops' });
    expect(notJson.status).toBe(400);
    expect(t.ai.calls).toHaveLength(0);
    const status = (await (await t.send('/v1/status', { headers: { Authorization: `Bearer ${code}` } })).json()) as any;
    expect(status.scansLeftToday).toBe(20);
  });

  it('rejects oversized bodies before doing any work', async () => {
    const t = setup();
    const res = await t.send('/v1/scan', { method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Length': String(20_000_000) }, body: '{}' });
    expect(res.status).toBe(413);
  });

  it('maps AI timeouts, outages and bad answers to clear errors', async () => {
    const cases: [() => Promise<Anthropic.Message>, number, string][] = [
      [() => Promise.reject(new Anthropic.APIConnectionTimeoutError()), 504, 'ai_timeout'],
      [() => Promise.reject(Anthropic.APIError.generate(529, {}, 'overloaded', new Headers())), 503, 'ai_busy'],
      [() => Promise.reject(Anthropic.APIError.generate(500, {}, 'boom', new Headers())), 502, 'ai_error'],
      [() => Promise.reject(Anthropic.APIError.generate(401, {}, 'bad key', new Headers())), 503, 'scanner_unavailable'],
      [async () => fakeMessage('not json'), 502, 'ai_bad_response'],
      [async () => fakeMessage({ name: 'Nike' }), 502, 'ai_bad_response'],
    ];
    for (const [respond, status, code] of cases) {
      const t = setup({ respond });
      const created = await t.createCode();
      const res = await t.scan(created.code);
      expect(res.status, code).toBe(status);
      expect(((await res.json()) as any).error.code).toBe(code);
      // The tester gets the scan back; a timeout is charged at the worst case.
      const usage = t.core.usage(Date.UTC(2026, 10, 10, 15), t.config.limits);
      expect(usage.scansToday).toBe(0);
      expect(usage.reservedMicros).toBe(0);
      if (code === 'ai_timeout') expect(usage.spentMicros).toBe(worstCaseMicros('claude-sonnet-5-5'));
    }
  });

  it('enforces the daily limit and the monthly budget before calling the AI', async () => {
    const t = setup({ env: { SCANS_PER_MINUTE_PER_CODE: '60' } });
    const { code } = await t.createCode();
    for (let i = 0; i < 20; i++) expect((await t.scan(code)).status).toBe(200);
    const res = await t.scan(code);
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error.code).toBe('code_daily_limit');
    expect(t.ai.calls).toHaveLength(20);

    const broke = setup({ env: { MONTHLY_BUDGET_USD: '0.01' } });
    const c2 = await broke.createCode();
    const denied = await broke.scan(c2.code);
    expect(denied.status).toBe(503);
    expect(((await denied.json()) as any).error.code).toBe('budget_exhausted');
    expect(broke.ai.calls).toHaveLength(0);
  });

  it('is off when misconfigured or switched off', async () => {
    for (const env of [{ ANTHROPIC_API_KEY: '' }, { SCANNER_ENABLED: 'false' }, { CODE_PEPPER: 'short' }]) {
      const t = setup({ env });
      const res = await t.scan('SP-AAAAA-AAAAA-AAAAA-AAAAA');
      expect(res.status).toBe(503);
      expect(((await res.json()) as any).error.code).toBe('scanner_unavailable');
      expect(t.ai.calls).toHaveLength(0);
    }
  });
});

describe('CORS and routing', () => {
  it('allows the preview site, its own origin and non-browser callers only', async () => {
    const t = setup();
    expect((await t.send('/health', { origin: 'https://evil.example' })).status).toBe(403);
    const pre = await t.send('/v1/scan', { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect((await t.send('/health', { origin: URL_BASE })).status).toBe(200);
    expect((await t.send('/health', { origin: null })).status).toBe(200);
    expect(await (await t.send('/health')).json()).toEqual({ ok: true, scanner: 'ready', model: 'claude-sonnet-5-5' });
  });

  it('serves the preview site for non-API paths when assets are attached', async () => {
    const t = setup({ assets: { fetch: async () => new Response('<html>app</html>') } });
    expect(await (await t.send('/', { origin: null })).text()).toContain('app');
    expect((await setup().send('/index.html', { origin: null })).status).toBe(404);
  });

  it('reports scans left for a valid code', async () => {
    const t = setup();
    const { code } = await t.createCode('Luis');
    const res = await t.send('/v1/status', { headers: { Authorization: `Bearer ${code.toLowerCase()}` } });
    expect(await res.json()).toMatchObject({ ok: true, label: 'Luis', scansLeftToday: 20, dailyLimit: 20 });
  });
});

describe('admin endpoints', () => {
  it('need the admin token, are invisible to browsers and unconfigured deployments', async () => {
    const t = setup();
    expect((await t.send('/admin/codes', { origin: null })).status).toBe(401);
    expect((await t.send('/admin/codes', { origin: null, headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await t.send('/admin/codes', { headers: { Authorization: `Bearer ${ADMIN}` } })).status).toBe(404);
    const noAdmin = setup({ env: { ADMIN_TOKEN: '' } });
    expect((await noAdmin.send('/admin/codes', { origin: null, headers: { Authorization: `Bearer ${ADMIN}` } })).status).toBe(404);
  });

  it('create, list and revoke codes; plain codes are shown once and never listed', async () => {
    const t = setup();
    const created = await t.createCode('Maria', { days: 14, dailyLimit: 10 });
    expect(created.code).toMatch(/^SP-/);
    expect(created).toMatchObject({ label: 'Maria', dailyLimit: 10 });
    const list = (await (await t.send('/admin/codes', { origin: null, headers: { Authorization: `Bearer ${ADMIN}` } })).json()) as any;
    expect(list.codes).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(created.code.slice(3, 15));
    const revoked = await t.send(`/admin/codes/${created.id}/revoke`, { method: 'POST', origin: null, headers: { Authorization: `Bearer ${ADMIN}` } });
    expect(revoked.status).toBe(200);
    const usage = (await (await t.send('/admin/usage', { origin: null, headers: { Authorization: `Bearer ${ADMIN}` } })).json()) as any;
    expect(usage).toMatchObject({ scansToday: 0, monthlyBudgetMicros: 10_000_000, scanner: { ready: true, model: 'claude-sonnet-5-5', problems: [] } });
    const missingLabel = await t.send('/admin/codes', { method: 'POST', origin: null, headers: { Authorization: `Bearer ${ADMIN}` }, body: '{}' });
    expect(missingLabel.status).toBe(400);
  });
});
