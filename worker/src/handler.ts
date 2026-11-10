// HTTP routing for the scanner backend. Pure request → response logic with its dependencies
// passed in, so it can be tested without Cloudflare or the real AI provider.
//
//   GET  /health                   — is scanning configured (no secrets)
//   GET  /v1/status                — invite code check + scans left today
//   POST /v1/scan                  — analyze one photo
//   GET  /admin/codes              — list invite codes          (ADMIN_TOKEN)
//   POST /admin/codes              — create an invite code      (ADMIN_TOKEN)
//   POST /admin/codes/:id/revoke   — revoke an invite code      (ADMIN_TOKEN)
//   GET  /admin/usage              — today's scans, month spend (ADMIN_TOKEN)

import { toWire } from '../../src/ai/scanSchema';
import { analyzeImage, type MessagesClient } from './claude';
import { clientKey, generateCode, hashCode, newId, normalizeCode, secretsMatch } from './codes';
import { MAX_BODY_BYTES, MODELS, worstCaseMicros, type Config, type Limits } from './config';
import { checkImage } from './image';
import type { BeginResult, CodeSummary, StatusResult } from './ledgerCore';

export interface LedgerApi {
  beginScan(args: { codeHash: string | null; clientKey: string; reservationId: string; estimateMicros: number; limits: Limits; now: number }): Promise<BeginResult>;
  finishScan(args: { reservationId: string; actualMicros: number; refundScan: boolean }): Promise<void>;
  status(args: { codeHash: string | null; clientKey: string; now: number }): Promise<StatusResult>;
  throttledFor(clientKey: string, now: number): Promise<number>;
  recordFailure(clientKey: string, now: number): Promise<void>;
  createCode(args: { id: string; hash: string; label: string; dailyLimit: number; expiresAt: number; now: number }): Promise<CodeSummary>;
  listCodes(now: number): Promise<CodeSummary[]>;
  revokeCode(id: string, now: number): Promise<boolean>;
  usage(now: number, limits: Limits): Promise<Record<string, unknown>>;
}

export interface HandlerDeps {
  config: Config;
  ledger: LedgerApi;
  ai: MessagesClient | null;
  now: () => number;
  log: (event: Record<string, unknown>) => void;
  /** Static files for the private preview site, when the Worker also serves it. */
  assets?: { fetch(request: Request): Promise<Response> };
}

const MESSAGES: Record<string, string> = {
  missing_code: 'Enter your tester invite code to use the scanner.',
  invalid_code: 'That invite code isn’t valid. Check it and try again.',
  code_revoked: 'This invite code has been turned off.',
  code_expired: 'This invite code has expired. Ask for a new one.',
  too_many_attempts: 'Too many incorrect codes. Wait a few minutes and try again.',
  rate_limited: 'You’re scanning very quickly. Wait a minute and try again.',
  code_daily_limit: 'You’ve used all of today’s scans. They reset at midnight UTC.',
  global_daily_limit: 'The beta has reached today’s scan limit. Try again tomorrow.',
  budget_exhausted: 'AI scanning is paused for the rest of this month.',
  scanner_unavailable: 'AI scanning isn’t available right now.',
  origin_not_allowed: 'This site isn’t allowed to use the scanner.',
  ai_timeout: 'The AI took too long to respond. Try again.',
  ai_busy: 'The AI service is busy right now. Try again in a moment.',
  ai_error: 'The AI service had a problem. Try again, or enter the details yourself.',
  ai_bad_response: 'The AI’s answer couldn’t be used. Try again, or enter the details yourself.',
  not_found: 'Not found.',
  invalid_request: 'The request wasn’t valid.',
  image_too_large: 'That photo is too large. Try a smaller photo.',
};

const STATUS_FOR: Record<string, number> = {
  missing_code: 401,
  invalid_code: 401,
  code_revoked: 403,
  code_expired: 403,
  too_many_attempts: 429,
  rate_limited: 429,
  code_daily_limit: 429,
  global_daily_limit: 429,
  budget_exhausted: 503,
  scanner_unavailable: 503,
  origin_not_allowed: 403,
};

type Cors = Record<string, string>;

function json(status: number, body: unknown, headers: Cors = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

function errorResponse(code: string, cors: Cors, opts: { status?: number; message?: string; retryAfterSeconds?: number } = {}): Response {
  const headers: Cors = { ...cors };
  if (opts.retryAfterSeconds) headers['Retry-After'] = String(opts.retryAfterSeconds);
  return json(opts.status ?? STATUS_FOR[code] ?? 400, { error: { code, message: opts.message ?? MESSAGES[code] ?? 'Something went wrong.', retryAfterSeconds: opts.retryAfterSeconds } }, headers);
}

/** CORS headers for an allowed origin, {} for non-browser callers, null for a disallowed origin. */
function corsFor(request: Request, config: Config): Cors | null {
  const origin = request.headers.get('Origin');
  if (!origin) return {};
  const self = new URL(request.url).origin;
  if (origin !== self && !config.allowedOrigins.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function bearer(request: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') ?? '');
  return m ? m[1].trim() : null;
}

async function codeHashFrom(request: Request, pepper: string): Promise<string | null | undefined> {
  const raw = bearer(request);
  if (raw === null) return undefined;
  const normalized = normalizeCode(raw);
  return normalized ? hashCode(pepper, normalized) : null;
}

export async function handleRequest(request: Request, deps: HandlerDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const isApi = path === '/health' || path.startsWith('/v1/') || path.startsWith('/admin/');
  if (!isApi) {
    if (deps.assets) return deps.assets.fetch(request);
    return errorResponse('not_found', {}, { status: 404 });
  }

  const cors = corsFor(request, deps.config);
  if (cors === null) return errorResponse('origin_not_allowed', {});
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  try {
    if (path === '/health' && request.method === 'GET') {
      return json(200, { ok: true, scanner: deps.config.enabled ? 'ready' : 'unavailable', model: deps.config.model }, cors);
    }
    if (path === '/v1/status' && request.method === 'GET') return await status(request, deps, cors);
    if (path === '/v1/scan' && request.method === 'POST') return await scan(request, deps, cors);
    if (path.startsWith('/admin/')) return await admin(request, path, deps);
    return errorResponse('not_found', cors, { status: 404 });
  } catch (e) {
    deps.log({ evt: 'unhandled', path, error: e instanceof Error ? e.message : String(e) });
    return errorResponse('ai_error', cors, { status: 500, message: 'Something went wrong on our side. Try again.' });
  }
}

async function status(request: Request, deps: HandlerDeps, cors: Cors): Promise<Response> {
  const { config, ledger, now } = deps;
  if (!config.enabled || !config.codePepper) return errorResponse('scanner_unavailable', cors);
  const codeHash = await codeHashFrom(request, config.codePepper);
  if (codeHash === undefined) return errorResponse('missing_code', cors);
  const key = await clientKey(config.codePepper, request.headers.get('CF-Connecting-IP'));
  const r = await ledger.status({ codeHash, clientKey: key, now: now() });
  if (!r.ok) return errorResponse(r.error, cors, { retryAfterSeconds: r.retryAfterSeconds });
  return json(200, { ok: true, label: r.label, scansLeftToday: r.scansLeftToday, dailyLimit: r.dailyLimit, expiresAt: r.expiresAt }, cors);
}

async function scan(request: Request, deps: HandlerDeps, cors: Cors): Promise<Response> {
  const { config, ledger, now, log } = deps;
  if (!config.enabled || !config.codePepper || !deps.ai) return errorResponse('scanner_unavailable', cors);

  const length = Number(request.headers.get('Content-Length') ?? '0');
  if (length > MAX_BODY_BYTES) return errorResponse('image_too_large', cors, { status: 413 });

  // Authenticate and reserve before reading the body, so unauthenticated requests cost nothing.
  const codeHash = await codeHashFrom(request, config.codePepper);
  if (codeHash === undefined) return errorResponse('missing_code', cors);
  const key = await clientKey(config.codePepper, request.headers.get('CF-Connecting-IP'));
  const estimate = worstCaseMicros(config.model);
  const begin = await ledger.beginScan({ codeHash, clientKey: key, reservationId: newId('rsv'), estimateMicros: estimate, limits: config.limits, now: now() });
  if (!begin.ok) {
    log({ evt: 'scan_denied', reason: begin.error });
    return errorResponse(begin.error, cors, { retryAfterSeconds: begin.retryAfterSeconds });
  }

  const settle = (actualMicros: number, refundScan: boolean) => ledger.finishScan({ reservationId: begin.reservationId, actualMicros, refundScan });

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      await settle(0, true);
      return errorResponse('image_too_large', cors, { status: 413 });
    }
    body = JSON.parse(text);
  } catch {
    await settle(0, true);
    return errorResponse('invalid_request', cors, { status: 400, message: 'The photo couldn’t be read. Try again.' });
  }
  const image = checkImage(body);
  if (!image.ok) {
    await settle(0, true);
    return errorResponse(image.code, cors, { status: image.status, message: image.message });
  }

  const started = Date.now();
  const outcome = await analyzeImage(deps.ai, { model: config.model, effort: config.effort, mediaType: image.mediaType, data: image.data });
  const ms = Date.now() - started;

  if (outcome.kind === 'ok') {
    await settle(outcome.costMicros, false);
    log({ evt: 'scan', code: begin.codeId, model: config.model, status: outcome.result.status, inTok: outcome.usage.inputTokens, outTok: outcome.usage.outputTokens, micros: outcome.costMicros, ms });
    return json(
      200,
      { ok: true, result: toWire(outcome.result), model: { id: config.model, label: MODELS[config.model].label }, scansLeftToday: begin.scansLeftToday, codeExpiresAt: begin.expiresAt },
      cors,
    );
  }

  // Failed scans give the tester's scan back. A timeout is charged at the worst case because
  // the provider may still have billed it; other failures are charged what was reported.
  await settle(outcome.error === 'timeout' ? estimate : outcome.costMicros, true);
  log({ evt: 'scan_failed', code: begin.codeId, model: config.model, error: outcome.error, detail: outcome.detail, micros: outcome.costMicros, ms });
  const map = {
    timeout: ['ai_timeout', 504],
    busy: ['ai_busy', 503],
    upstream: ['ai_error', 502],
    bad_response: ['ai_bad_response', 502],
    config: ['scanner_unavailable', 503],
  } as const;
  const [code, statusCode] = map[outcome.error];
  return errorResponse(code, cors, { status: statusCode });
}

async function admin(request: Request, path: string, deps: HandlerDeps): Promise<Response> {
  const { config, ledger, now } = deps;
  // Admin endpoints are for the command-line tool only and don't exist unless configured.
  if (!config.adminToken || !config.codePepper || request.headers.get('Origin')) return errorResponse('not_found', {}, { status: 404 });
  const key = await clientKey(config.codePepper, request.headers.get('CF-Connecting-IP'));
  const wait = await ledger.throttledFor(key, now());
  if (wait > 0) return errorResponse('too_many_attempts', {}, { retryAfterSeconds: wait });
  const token = bearer(request);
  if (!token || !(await secretsMatch(config.codePepper, token, config.adminToken))) {
    await ledger.recordFailure(key, now());
    return errorResponse('invalid_code', {}, { status: 401, message: 'Admin token required.' });
  }

  if (path === '/admin/codes' && request.method === 'GET') return json(200, { codes: await ledger.listCodes(now()) });
  if (path === '/admin/usage' && request.method === 'GET') {
    // Configuration problems are listed by name only (never secret values) to help with setup.
    const scanner = { ready: config.enabled, model: config.model, effort: config.effort, problems: config.problems };
    return json(200, { ...(await ledger.usage(now(), config.limits)), scanner });
  }
  if (path === '/admin/codes' && request.method === 'POST') {
    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      // Defaults below.
    }
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 60) : '';
    if (!label) return errorResponse('invalid_request', {}, { status: 400, message: 'Give the code a label, e.g. the tester’s name.' });
    const days = Number.isInteger(body.days) ? Math.min(Math.max(body.days as number, 1), 90) : 30;
    const dailyLimit = Number.isInteger(body.dailyLimit) ? Math.min(Math.max(body.dailyLimit as number, 1), config.limits.dailyGlobal) : config.limits.dailyPerCode;
    const code = generateCode();
    const summary = await ledger.createCode({
      id: newId('code'),
      hash: await hashCode(config.codePepper, normalizeCode(code)!),
      label,
      dailyLimit,
      expiresAt: now() + days * 86_400_000,
      now: now(),
    });
    // The plain code is shown once and never stored.
    return json(201, { code, ...summary });
  }
  const revoke = /^\/admin\/codes\/([\w-]+)\/revoke$/.exec(path);
  if (revoke && request.method === 'POST') {
    const ok = await ledger.revokeCode(revoke[1], now());
    return ok ? json(200, { ok: true, id: revoke[1] }) : errorResponse('not_found', {}, { status: 404 });
  }
  return errorResponse('not_found', {}, { status: 404 });
}
