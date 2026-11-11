// HTTP routing for the scanner backend. Pure request → response logic with its dependencies
// passed in, so it can be tested without Cloudflare or the real AI provider.
//
//   GET  /health                   — is scanning configured (no secrets)
//   GET  /v1/status                — invite code check + scans left today
//   POST /v1/scan                  — analyze one photo
//   POST /v1/assistant             — interpret a question / explain a verified calculation
//   GET  /admin/codes              — list invite codes          (ADMIN_TOKEN)
//   POST /admin/codes              — create an invite code      (ADMIN_TOKEN)
//   POST /admin/codes/:id/revoke   — revoke an invite code      (ADMIN_TOKEN)
//   GET  /admin/usage              — today's scans, month spend (ADMIN_TOKEN)

import { toWire } from '../../src/ai/scanSchema';
import {
  EXPLAIN_JSON_SCHEMA,
  EXPLAIN_SYSTEM_PROMPT,
  explainUserMessage,
  INTERPRET_JSON_SCHEMA,
  INTERPRET_SYSTEM_PROMPT,
  interpretUserMessage,
  MAX_QUESTION_CHARS,
  parseExplainFacts,
  parseExplainResult,
  parseInterpretResult,
  unverifiedNumbers,
  type ExplainFacts,
} from '../../src/ai/explainSchema';
import { analyzeImage, callStructured, type MessagesClient } from './claude';
import { clientKey, generateCode, hashCode, newId, normalizeCode, secretsMatch } from './codes';
import { precheckLength, readTextLimited, type BodyRead } from './body';
import {
  ASSISTANT_OUTPUT_TOKENS,
  MAX_ADMIN_BODY_BYTES,
  MAX_ASSISTANT_BODY_BYTES,
  MAX_BODY_BYTES,
  MAX_INPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  MODELS,
  worstCaseAssistantMicros,
  worstCaseMicros,
  type AssistantMode,
  type Config,
  type Limits,
} from './config';
import { checkImage } from './image';
import type { BeginResult, CodeSummary, FinishResult, StatusResult } from './ledgerCore';

export interface LedgerApi {
  beginScan(args: { codeHash: string | null; clientKey: string; reservationId: string; estimateMicros: number; limits: Limits; now: number }): Promise<BeginResult>;
  finishScan(args: { reservationId: string; actualMicros: number; refundScan: boolean }): Promise<FinishResult>;
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
  bad_length: 'The upload was incomplete or its size didn’t match. Try again.',
};

/** Wording for the assistant, where "scans" would be confusing. Limits and budget are shared with the scanner. */
const ASSISTANT_MESSAGES: Record<string, string> = {
  scanner_unavailable: 'AI answers aren’t available right now. The verified calculation is unchanged.',
  rate_limited: 'You’re asking very quickly. Wait a minute and try again.',
  code_daily_limit: 'You’ve used all of today’s AI requests (scans and AI answers share one daily limit). They reset at midnight UTC.',
  global_daily_limit: 'The beta has reached today’s AI limit. Try again tomorrow.',
  budget_exhausted: 'AI features are paused for the rest of this month: the shared monthly AI budget is used up.',
  ai_bad_response: 'The AI’s answer couldn’t be used. The verified calculation is unchanged.',
  ai_error: 'The AI service had a problem. The verified calculation is unchanged.',
  invalid_request: 'The request wasn’t valid.',
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

/** The response for a body that couldn't be read within the limits. */
function bodyError(read: Extract<BodyRead, { ok: false }>, cors: Cors): Response {
  if (read.reason === 'too_large') return errorResponse('image_too_large', cors, { status: 413 });
  if (read.reason === 'bad_length') return errorResponse('invalid_request', cors, { status: 400, message: MESSAGES.bad_length });
  return errorResponse('invalid_request', cors, { status: 400, message: 'The photo couldn’t be read. Try again.' });
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
    if (path === '/v1/assistant' && request.method === 'POST') return await assistant(request, deps, cors);
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

  // A declared size that is invalid or over the limit is refused before any other work.
  const early = precheckLength(request.headers, MAX_BODY_BYTES);
  if (early) return bodyError(early, cors);

  // Authenticate and reserve before reading the body, so unauthenticated requests cost nothing.
  const codeHash = await codeHashFrom(request, config.codePepper);
  if (codeHash === undefined) return errorResponse('missing_code', cors);
  const key = await clientKey(config.codePepper, request.headers.get('CF-Connecting-IP'));
  const begin = await ledger.beginScan({
    codeHash,
    clientKey: key,
    reservationId: newId('rsv'),
    estimateMicros: worstCaseMicros(config.model),
    limits: config.limits,
    now: now(),
  });
  if (!begin.ok) {
    log({ evt: 'scan_denied', reason: begin.error });
    return errorResponse(begin.error, cors, { retryAfterSeconds: begin.retryAfterSeconds });
  }

  /**
   * Replaces the reservation with the real charge. A failed scan is given back to the tester
   * only if nothing was charged; a successful scan always counts.
   */
  const settle = async (chargeMicros: number, succeeded = false): Promise<FinishResult> => {
    const refundScan = !succeeded && chargeMicros === 0;
    const result = await ledger.finishScan({ reservationId: begin.reservationId, actualMicros: chargeMicros, refundScan });
    if (result.overrunMicros > 0) {
      // The worst-case estimate was too low (e.g. prices or limits changed). Charged in full;
      // later reservations are raised automatically. Shown by `node scripts/admin.mjs usage`.
      log({ evt: 'budget_overrun', code: begin.codeId, model: config.model, reservedMicros: begin.reservedMicros, chargedMicros: result.chargedMicros });
    }
    return result;
  };

  // The body is read with a hard limit on the bytes actually received, whatever the headers say.
  const read = await readTextLimited(request, MAX_BODY_BYTES);
  if (!read.ok) {
    await settle(0);
    log({ evt: 'upload_rejected', reason: read.reason });
    return bodyError(read, cors);
  }
  let body: unknown;
  try {
    body = JSON.parse(read.text);
  } catch {
    await settle(0);
    return errorResponse('invalid_request', cors, { status: 400, message: 'The photo couldn’t be read. Try again.' });
  }
  const image = checkImage(body);
  if (!image.ok) {
    await settle(0);
    log({ evt: 'upload_rejected', reason: image.code });
    return errorResponse(image.code, cors, { status: image.status, message: image.message });
  }

  const started = Date.now();
  const outcome = await analyzeImage(deps.ai, { model: config.model, effort: config.effort, mediaType: image.mediaType, data: image.data });
  const ms = Date.now() - started;

  if (outcome.kind === 'ok') {
    await settle(outcome.costMicros, true);
    log({
      evt: 'scan',
      code: begin.codeId,
      model: config.model,
      status: outcome.result.status,
      imgTok: image.imageTokens,
      inTok: outcome.usage.inputTokens,
      outTok: outcome.usage.outputTokens,
      micros: outcome.costMicros,
      ms,
    });
    return json(
      200,
      { ok: true, result: toWire(outcome.result), model: { id: config.model, label: MODELS[config.model].label }, scansLeftToday: begin.scansLeftToday, codeExpiresAt: begin.expiresAt },
      cors,
    );
  }

  // A failure that may still have been billed (timeout, dropped connection, server error) is
  // charged the full reservation, because its real cost is unknown. A failed answer that did
  // come back is charged its reported cost. The tester gets the scan back only if nothing was
  // charged, so repeated billable failures can't get around the daily limit.
  const charge = outcome.mayBeBilled ? begin.reservedMicros : outcome.costMicros;
  await settle(charge);
  log({ evt: 'scan_failed', code: begin.codeId, model: config.model, error: outcome.error, detail: outcome.detail, micros: charge, ms });
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

type AssistantBody = { mode: 'interpret'; question: string } | { mode: 'explain'; question: string; facts: ExplainFacts };

function readAssistantBody(raw: unknown): AssistantBody | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const question = typeof o.question === 'string' ? o.question.trim() : '';
  if (!question || question.length > MAX_QUESTION_CHARS) return null;
  if (o.mode === 'interpret') return { mode: 'interpret', question };
  if (o.mode === 'explain') {
    try {
      return { mode: 'explain', question, facts: parseExplainFacts(o.facts) };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The assistant's AI layer. It never sees the user's records: "interpret" gets only the
 * question; "explain" gets the question and the figures of a calculation the app has already
 * verified. Every number in an explanation is checked against those figures, and an
 * explanation with any other number is not returned. Same invite codes, limits and monthly
 * budget as scanning (one shared ledger).
 */
async function assistant(request: Request, deps: HandlerDeps, cors: Cors): Promise<Response> {
  const { config, ledger, now, log } = deps;
  const fail = (code: string, opts: { status?: number; retryAfterSeconds?: number } = {}) => errorResponse(code, cors, { ...opts, message: ASSISTANT_MESSAGES[code] ?? MESSAGES[code] });
  if (!config.enabled || !config.codePepper || !deps.ai) return fail('scanner_unavailable');
  const early = precheckLength(request.headers, MAX_ASSISTANT_BODY_BYTES);
  if (early) return fail('invalid_request', { status: early.reason === 'too_large' ? 413 : 400 });
  const codeHash = await codeHashFrom(request, config.codePepper);
  if (codeHash === undefined) return fail('missing_code');

  // The body is small and bounded, and its mode decides the reservation, so it's read first.
  const read = await readTextLimited(request, MAX_ASSISTANT_BODY_BYTES);
  if (!read.ok) return fail('invalid_request', { status: read.reason === 'too_large' ? 413 : 400 });
  let body: AssistantBody | null = null;
  try {
    body = readAssistantBody(JSON.parse(read.text));
  } catch {
    body = null;
  }
  if (!body) return fail('invalid_request', { status: 400 });
  const mode: AssistantMode = body.mode;

  const key = await clientKey(config.codePepper, request.headers.get('CF-Connecting-IP'));
  const begin = await ledger.beginScan({
    codeHash,
    clientKey: key,
    reservationId: newId('rsv'),
    estimateMicros: worstCaseAssistantMicros(config.model, mode),
    limits: config.limits,
    now: now(),
  });
  if (!begin.ok) {
    log({ evt: 'assistant_denied', mode, reason: begin.error });
    return fail(begin.error, { retryAfterSeconds: begin.retryAfterSeconds });
  }
  const settle = async (chargeMicros: number, succeeded: boolean) => {
    const result = await ledger.finishScan({ reservationId: begin.reservationId, actualMicros: chargeMicros, refundScan: !succeeded && chargeMicros === 0 });
    if (result.overrunMicros > 0) log({ evt: 'budget_overrun', kind: 'assistant', mode, code: begin.codeId, reservedMicros: begin.reservedMicros, chargedMicros: result.chargedMicros });
  };

  const started = Date.now();
  const outcome =
    body.mode === 'interpret'
      ? await callStructured(
          deps.ai,
          {
            model: config.model,
            effort: config.effort,
            system: INTERPRET_SYSTEM_PROMPT,
            user: interpretUserMessage(body.question),
            schema: INTERPRET_JSON_SCHEMA as unknown as Record<string, unknown>,
            maxTokens: ASSISTANT_OUTPUT_TOKENS.interpret,
          },
          parseInterpretResult,
        )
      : await callStructured(
          deps.ai,
          {
            model: config.model,
            effort: config.effort,
            system: EXPLAIN_SYSTEM_PROMPT,
            user: explainUserMessage(body.question, body.facts),
            schema: EXPLAIN_JSON_SCHEMA as unknown as Record<string, unknown>,
            maxTokens: ASSISTANT_OUTPUT_TOKENS.explain,
          },
          parseExplainResult,
        );
  const ms = Date.now() - started;
  const model = { id: config.model, label: MODELS[config.model].label };

  if (outcome.kind === 'error') {
    const charge = outcome.mayBeBilled ? begin.reservedMicros : outcome.costMicros;
    await settle(charge, false);
    log({ evt: 'assistant_failed', mode, code: begin.codeId, error: outcome.error, detail: outcome.detail, micros: charge, ms });
    const map = { timeout: ['ai_timeout', 504], busy: ['ai_busy', 503], upstream: ['ai_error', 502], bad_response: ['ai_bad_response', 502], config: ['scanner_unavailable', 503] } as const;
    const [code, status] = map[outcome.error];
    return fail(code, { status });
  }

  await settle(outcome.costMicros, true);
  if (body.mode === 'interpret') {
    const value = outcome.value as ReturnType<typeof parseInterpretResult>;
    log({ evt: 'assistant', mode, code: begin.codeId, intent: value.intent, inTok: outcome.usage.inputTokens, outTok: outcome.usage.outputTokens, micros: outcome.costMicros, ms });
    return json(200, { ok: true, mode, intent: value.intent, period: value.period, model, requestsLeftToday: begin.scansLeftToday }, cors);
  }
  const { explanation } = outcome.value as ReturnType<typeof parseExplainResult>;
  // Any number not in the verified figures means the explanation can't be trusted: drop it.
  const unverified = unverifiedNumbers(explanation, body.facts);
  log({ evt: 'assistant', mode, code: begin.codeId, verified: unverified.length === 0, inTok: outcome.usage.inputTokens, outTok: outcome.usage.outputTokens, micros: outcome.costMicros, ms });
  return json(
    200,
    { ok: true, mode, explanation: unverified.length ? null : explanation, verified: unverified.length === 0, unverified, model, requestsLeftToday: begin.scansLeftToday },
    cors,
  );
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
    const prices = MODELS[config.model];
    const scanner = {
      ready: config.enabled,
      model: config.model,
      effort: config.effort,
      problems: config.problems,
      // So the admin can compare them with Anthropic's pricing page.
      pricePerMillionTokens: { input: prices.inputMicrosPerToken, output: prices.outputMicrosPerToken },
      reservationPerScanMicros: worstCaseMicros(config.model),
      maxTokensPerScan: { input: MAX_INPUT_TOKENS, output: MAX_OUTPUT_TOKENS },
    };
    return json(200, { ...(await ledger.usage(now(), config.limits)), scanner });
  }
  if (path === '/admin/codes' && request.method === 'POST') {
    const read = await readTextLimited(request, MAX_ADMIN_BODY_BYTES);
    if (!read.ok) return bodyError(read, {});
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(read.text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
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
