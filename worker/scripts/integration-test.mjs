// End-to-end check of the Worker in Cloudflare's local runtime (workerd via `wrangler dev`),
// with a fake Anthropic API so nothing is billed. Verifies the real Durable Object ledger,
// the bundled SDK, invite codes, limits under concurrent requests, and error handling.
//
//   npm run test:integration

import { execFileSync, spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
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

// A JPEG-shaped payload: start marker, JFIF segment and a frame header with the size.
const jpeg = (width = 1600, height = 1200) => {
  const buf = Buffer.alloc(4096, 0x22);
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, ...new Array(9).fill(0)];
  buf.set([0xff, 0xd8, ...app0, ...sof0]);
  return buf.toString('base64');
};

/**
 * Streams an upload in 64 KB chunks (chunked encoding unless a Content-Length is given) and
 * stops as soon as the Worker answers. Resolves with the status and how much was sent by then.
 */
const streamUpload = (code, { totalBytes, headers = {} }) =>
  new Promise((resolve) => {
    let sent = 0;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      req.destroy();
      resolve({ ...result, sent });
    };
    const req = httpRequest(`${base}/v1/scan`, { method: 'POST', headers: { Authorization: `Bearer ${code}`, 'Content-Type': 'application/json', ...headers } }, (res) => {
      let text = '';
      res.on('data', (d) => (text += d));
      res.on('end', () => finish({ status: res.statusCode, text }));
    });
    req.on('error', (e) => finish({ status: 0, text: String(e) }));
    const pump = () => {
      while (!done && sent < totalBytes) {
        sent += 64 * 1024;
        if (!req.write(Buffer.alloc(64 * 1024, 0x41))) return req.once('drain', pump);
      }
      if (!done && !headers['Content-Length']) req.end();
    };
    pump();
    setTimeout(() => finish({ status: -1, text: 'no answer within 10 s' }), 10_000);
  });

/** Sends raw HTTP (for headers fetch won't send) and returns the status code. */
const rawStatus = (text) =>
  new Promise((resolve) => {
    let data = '';
    const socket = connect(WORKER_PORT, '127.0.0.1', () => socket.write(text));
    const finish = () => {
      socket.destroy();
      resolve(Number(/^HTTP\/1\.1 (\d{3})/.exec(data)?.[1] ?? 0));
    };
    socket.on('data', (d) => {
      data += d;
      if (data.includes('\r\n')) finish();
    });
    socket.on('error', finish);
    setTimeout(finish, 5000);
  });
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

  // Upload size limits, in the real runtime. None of these may reach the AI or use a scan.
  const callsBefore = seen.length;
  // (`wrangler dev` puts a proxy in front of the Worker that buffers some of the body, so the
  // exact point where reading stops is checked in test/body.test.ts and test/handler.test.ts.)
  const logMark = output.length;
  const chunked = await streamUpload(created.code, { totalBytes: 100 * 1024 * 1024 });
  await new Promise((r) => setTimeout(r, 500));
  // The Worker answers 413 and closes the connection; the client may see the answer or, if it
  // was still sending, a reset. Either way the Worker's own log must show why it refused.
  const answered = (chunked.status === 413 && chunked.text.includes('image_too_large')) || /ECONNRESET|EPIPE/.test(chunked.text);
  check(
    'an oversized upload with no Content-Length is refused before it finishes',
    answered && chunked.sent < 100 * 1024 * 1024 && output.slice(logMark).includes('"evt":"upload_rejected","reason":"too_large"'),
    `${chunked.status} after ${chunked.sent} bytes: ${chunked.text.slice(0, 120)}`,
  );
  const declaredSize = 50 * 1024 * 1024;
  const declared = await streamUpload(created.code, { totalBytes: declaredSize, headers: { 'Content-Length': String(declaredSize) } });
  check('an oversized declared Content-Length is refused', declared.status === 413 && declared.text.includes('image_too_large'), `${declared.status}: ${declared.text.slice(0, 120)}`);
  const invalidLength = await rawStatus(`POST /v1/scan HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${created.code}\r\nContent-Length: lots\r\nConnection: close\r\n\r\n{}`);
  check('an invalid Content-Length is refused', invalidLength === 400, String(invalidLength));
  const huge = await scan(created.code, jpeg(9000, 9000));
  check('an image over 8000 px is refused without an AI call', huge.status === 422 && (await huge.json()).error.code === 'image_too_large');
  const afterLimits = await (await fetch(`${base}/v1/status`, { headers: { Authorization: `Bearer ${created.code}` } })).json();
  check('rejected uploads never reach the AI or use up scans', seen.length === callsBefore && afterLimits.scansLeftToday === DAILY - 1, `${seen.length - callsBefore} AI calls, ${afterLimits.scansLeftToday} left`);

  // AI failures, on a second code. They may have been billed, so they're charged and counted.
  const failing = await (await admin('/admin/codes', { method: 'POST', body: JSON.stringify({ label: 'Failures' }) })).json();
  mode = 'malformed';
  const malformed = await scan(failing.code);
  check('malformed AI answers become a clear error', malformed.status === 502 && (await malformed.json()).error.code === 'ai_bad_response');
  mode = 'error';
  const upstream = await scan(failing.code);
  check('provider outages become a clear error', upstream.status === 502 && (await upstream.json()).error.code === 'ai_error');
  mode = 'ok';
  const afterFailures = await (await fetch(`${base}/v1/status`, { headers: { Authorization: `Bearer ${failing.code}` } })).json();
  check('charged failures count against the tester’s daily scans', afterFailures.scansLeftToday === DAILY - 2, JSON.stringify(afterFailures));

  // Concurrency: 10 simultaneous scans against 2 remaining daily scans (1 used above; the
  // rejected uploads gave theirs back). Exactly 2 may succeed.
  const burst = await Promise.all(Array.from({ length: 10 }, () => scan(created.code)));
  const statuses = burst.map((r) => r.status);
  check('concurrent scans never exceed the daily limit', statuses.filter((s) => s === 200).length === DAILY - 1 && statuses.filter((s) => s === 429).length === 10 - (DAILY - 1), statuses.join(','));

  const usage = await (await admin('/admin/usage')).json();
  check('usage ledger matches the scans', usage.scansToday === DAILY + 2 && usage.reservedMicros === 0 && usage.spentMicros > 0, JSON.stringify(usage));
  // The 500 error may have been billed, so it was charged the full reservation.
  check(
    'a possibly-billed failure is charged the full reservation',
    usage.spentMicros >= usage.scanner.reservationPerScanMicros && usage.overruns.count === 0,
    JSON.stringify({ spent: usage.spentMicros, reservation: usage.scanner.reservationPerScanMicros }),
  );

  const cli = (...cmd) =>
    execFileSync('node', [join(here, 'admin.mjs'), ...cmd], { env: { ...process.env, SCANNER_URL: base, SCANNER_ADMIN_TOKEN: ADMIN }, encoding: 'utf8' });
  const cliCreated = cli('create', 'CLI tester', '--days', '7', '--daily', '5');
  check('admin CLI creates a code', /SP-[0-9A-Z]{5}-/.test(cliCreated) && cliCreated.includes('5 scans/day'), cliCreated);
  const cliList = cli('list');
  check('admin CLI lists codes without revealing them', cliList.includes('CLI tester') && cliList.includes('Integration') && !cliList.includes('SP-'), cliList);
  const usageOut = cli('usage');
  check('admin CLI reports usage', usageOut.includes('scans') && usageOut.includes('Scanner: ready'));

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
