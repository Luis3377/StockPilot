// End-to-end check of the Worker in Cloudflare's local runtime (workerd via `wrangler dev`),
// with a fake Anthropic API so nothing is billed. Verifies the real Durable Object ledger,
// the bundled SDK, invite codes, limits under concurrent requests, and error handling.
//
//   npm run test:integration

import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workerDir = join(here, '..');
const WORKER_PORT = 8799;
const ADMIN = 'integration-admin-token-0123456789abcdef';
const DAILY = 3;

// --- Fake Anthropic Messages API -------------------------------------------------------
let mode = 'ok';
const seen = [];
const mock = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const params = JSON.parse(body || '{}');
    seen.push({ path: req.url, key: req.headers['x-api-key'] ?? req.headers['authorization'], headers: req.headers, params });
    const reply = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (mode === 'error') return reply(500, { type: 'error', error: { type: 'api_error', message: 'boom' } });
    const text = mode === 'malformed' ? 'Looks like shoes' : JSON.stringify({
      status: 'identified', name: 'Nike Air Force 1 Low White', brand: 'Nike', model: 'Air Force 1 Low', category: 'Sneakers',
      description: 'White leather low-top sneakers.', condition: 'good', condition_notes: null, confidence: 'high', notes: null, price: 99,
    });
    setTimeout(() => reply(200, {
      id: 'msg_mock', type: 'message', role: 'assistant', model: params.model,
      content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 3100, output_tokens: 350 },
    }), 150);
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;

// --- Start the Worker -----------------------------------------------------------------
const assetsDir = join(workerDir, '..', 'dist-scan-preview');
if (!existsSync(assetsDir)) {
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(assetsDir, 'index.html'), '<!doctype html><title>preview placeholder</title>');
}
const persist = mkdtempSync(join(tmpdir(), 'scanner-it-'));
const vars = {
  ANTHROPIC_API_KEY: 'sk-ant-integration-test',
  ANTHROPIC_BASE_URL: mockUrl,
  CODE_PEPPER: 'integration-pepper-0123456789abcdef0123',
  ADMIN_TOKEN: ADMIN,
  DAILY_SCANS_PER_CODE: String(DAILY),
  SCANS_PER_MINUTE_PER_CODE: '60',
};
const wrangler = spawn(
  'npx',
  ['wrangler', 'dev', '--port', String(WORKER_PORT), '--ip', '127.0.0.1', '--persist-to', persist, ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])],
  // Own process group, so the whole tree (npx → wrangler → workerd) can be stopped at the end.
  { cwd: workerDir, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
);
const stopWrangler = () => {
  try {
    process.kill(-wrangler.pid, 'SIGTERM');
  } catch {}
};
process.on('exit', stopWrangler);
let output = '';
wrangler.stdout.on('data', (d) => (output += d));
wrangler.stderr.on('data', (d) => (output += d));

const base = `http://127.0.0.1:${WORKER_PORT}`;
const failures = [];
const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` ${extra}`}`);
  if (!ok) failures.push(name);
};

async function waitForWorker() {
  try {
    await fetch(`${base}/health`);
    throw new Error(`Port ${WORKER_PORT} is already in use; stop the other wrangler dev first.`);
  } catch (e) {
    if (String(e).includes('already in use')) throw e;
  }
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Worker didn't start:\n${output}`);
}

const jpeg = () => {
  const buf = Buffer.alloc(4096, 0x22);
  buf.set([0xff, 0xd8, 0xff, 0xe0]);
  return buf.toString('base64');
};
const scan = (code, image = jpeg()) =>
  fetch(`${base}/v1/scan`, { method: 'POST', headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
const admin = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' } });

try {
  await waitForWorker();
  const health = await (await fetch(`${base}/health`)).json();
  check('health reports the scanner ready', health.scanner === 'ready', JSON.stringify(health));

  const created = await (await admin('/admin/codes', { method: 'POST', body: JSON.stringify({ label: 'Integration' }) })).json();
  check('admin can create an invite code', /^SP-/.test(created.code ?? ''), JSON.stringify(created));

  const status = await (await fetch(`${base}/v1/status`, { headers: { Authorization: `Bearer ${created.code}` } })).json();
  check('status shows the daily allowance', status.scansLeftToday === DAILY, JSON.stringify(status));

  const ok = await scan(created.code);
  const okBody = await ok.json();
  check('scan returns validated suggestions', ok.status === 200 && okBody.result?.brand === 'Nike' && !('price' in okBody.result), JSON.stringify(okBody));
  const call = seen.at(-1);
  check('the API key and image go to the provider, from the server only', String(call?.key ?? '').includes(vars.ANTHROPIC_API_KEY) && call.params.messages[0].content[0].type === 'image', JSON.stringify(call?.headers));
  check('structured output schema is requested', call?.params.output_config?.format?.type === 'json_schema');

  const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(3000)]).toString('base64');
  const before = seen.length;
  const bad = await scan(created.code, pdf);
  check('non-image uploads are rejected without an AI call', bad.status === 415 && seen.length === before);

  mode = 'malformed';
  const malformed = await scan(created.code);
  check('malformed AI answers become a clear error', malformed.status === 502 && (await malformed.json()).error.code === 'ai_bad_response');
  mode = 'error';
  const upstream = await scan(created.code);
  check('provider outages become a clear error', upstream.status === 502 && (await upstream.json()).error.code === 'ai_error');
  mode = 'ok';

  // Concurrency: 10 simultaneous scans against 2 remaining daily scans (1 used above; failed
  // scans were refunded). Exactly 2 may succeed.
  const burst = await Promise.all(Array.from({ length: 10 }, () => scan(created.code)));
  const statuses = burst.map((r) => r.status);
  check('concurrent scans never exceed the daily limit', statuses.filter((s) => s === 200).length === DAILY - 1 && statuses.filter((s) => s === 429).length === 10 - (DAILY - 1), statuses.join(','));

  const usage = await (await admin('/admin/usage')).json();
  check('usage ledger matches successful scans', usage.scansToday === DAILY && usage.reservedMicros === 0 && usage.spentMicros > 0, JSON.stringify(usage));

  const cli = (...cmd) =>
    execFileSync('node', [join(here, 'admin.mjs'), ...cmd], { env: { ...process.env, SCANNER_URL: base, SCANNER_ADMIN_TOKEN: ADMIN }, encoding: 'utf8' });
  const cliCreated = cli('create', 'CLI tester', '--days', '7', '--daily', '5');
  check('admin CLI creates a code', /SP-[0-9A-Z]{5}-/.test(cliCreated) && cliCreated.includes('5 scans/day'), cliCreated);
  const cliList = cli('list');
  check('admin CLI lists codes without revealing them', cliList.includes('CLI tester') && cliList.includes('Integration') && !cliList.includes('SP-'), cliList);
  check('admin CLI reports usage', cli('usage').includes('scans'));

  await admin(`/admin/codes/${created.id}/revoke`, { method: 'POST' });
  const revoked = await scan(created.code);
  check('revoked codes stop working immediately', revoked.status === 403);

  for (let i = 0; i < 10; i++) await scan('SP-AAAAA-AAAAA-AAAAA-AAAAA');
  const locked = await scan('SP-AAAAA-AAAAA-AAAAA-AAAAA');
  check('repeated wrong codes are locked out', locked.status === 429 && (await locked.json()).error.code === 'too_many_attempts');

  const evil = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
  check('unknown websites are refused', evil.status === 403);
} catch (e) {
  failures.push(String(e));
  console.error(e);
} finally {
  stopWrangler();
  mock.close();
  rmSync(persist, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`\n${failures.length} integration check(s) failed.\n--- wrangler output ---\n${output.slice(-4000)}`);
  process.exit(1);
}
console.log('\nAll integration checks passed.');
process.exit(0);
