// Runtime configuration, read from Worker variables and secrets (see wrangler.toml and
// docs/AI_SCANNER.md). Everything has a safe default; a missing secret disables scanning.

import { SCAN_JSON_SCHEMA, SCAN_SYSTEM_PROMPT, SCAN_USER_PROMPT } from '../../src/ai/scanSchema';

export interface ModelInfo {
  label: string;
  /** USD per million tokens == micro-dollars per token. */
  inputMicrosPerToken: number;
  outputMicrosPerToken: number;
}

/**
 * The models the scanner may use. Prices are Anthropic's published rates
 * (https://platform.claude.com/docs/en/about-claude/pricing, checked Nov 2026); they're used
 * for the backend's own budget tracking, so update them if the published prices change.
 * They live in code (not in Worker settings) so a typo in the dashboard can't change them,
 * and test/budget.test.ts pins them: changing a price means changing that test too.
 * Haiku 5.5's rate applies to prompts up to 100K tokens; a scan is at most ~7K tokens.
 */
export const MODELS = {
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5', inputMicrosPerToken: 0.1, outputMicrosPerToken: 0.5 },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', inputMicrosPerToken: 2, outputMicrosPerToken: 10 },
  'claude-opus-5-5': { label: 'Claude Opus 5.5', inputMicrosPerToken: 4, outputMicrosPerToken: 20 },
} as const satisfies Record<string, ModelInfo>;

export type ScanModel = keyof typeof MODELS;
export type Effort = 'low' | 'medium' | 'high';

export const DEFAULT_MODEL: ScanModel = 'claude-sonnet-5-5';

/** Output cap per scan (thinking included). The API never returns more, so this bound is exact. */
export const MAX_OUTPUT_TOKENS = 2048;

// ---------------------------------------------------------------------------
// Worst-case input size, from Anthropic's vision limits and the scanner's own prompt
// (https://platform.claude.com/docs/en/build-with-claude/vision, checked Nov 2026).
// ---------------------------------------------------------------------------

/**
 * Claude 4.7 and later models (Haiku, Sonnet and Opus 5.5 included) downscale any larger image
 * to at most 2,576 px on the long edge and 4,784 visual tokens, so no image can cost more.
 */
export const MAX_IMAGE_TOKENS = 4784;
/** The API rejects images above 8000 × 8000 px; the Worker rejects them first. */
export const MAX_IMAGE_DIMENSION = 8000;
/** Characters of instructions sent with every scan: system prompt, user prompt and JSON schema. */
export const PROMPT_CHARACTERS = SCAN_SYSTEM_PROMPT.length + SCAN_USER_PROMPT.length + JSON.stringify(SCAN_JSON_SCHEMA).length;
/**
 * Upper bound for those instructions at 1 token per 2 characters. English text averages 3–4
 * characters per token (Haiku 5.5's tokenizer ~30% more tokens), so this has a wide margin.
 * It's computed from the prompt itself, so editing the prompt updates the reservation.
 */
export const PROMPT_TOKENS_BOUND = Math.ceil(PROMPT_CHARACTERS / 2);
/** Room for what the API adds around them: structured-output instructions, message and image framing. */
export const REQUEST_OVERHEAD_TOKENS = 1000;
/** Most input tokens one scan can use (7,135 today). A 1600 × 1200 photo from the app is 2,494 visual tokens. */
export const MAX_INPUT_TOKENS = MAX_IMAGE_TOKENS + PROMPT_TOKENS_BOUND + REQUEST_OVERHEAD_TOKENS;

/** How long to wait for Claude before giving up. */
export const AI_TIMEOUT_MS = 25_000;
/** Largest accepted image after base64 decoding. The app sends ~200–400 KB JPEGs. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Largest accepted request body (base64 inflates by 4/3, plus JSON overhead). */
export const MAX_BODY_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 16 * 1024;
/** Largest admin request body (a label and two numbers). */
export const MAX_ADMIN_BODY_BYTES = 16 * 1024;
/** A monthly budget above this needs a code change, so a typo ("1000") can't raise it. */
export const MAX_MONTHLY_BUDGET_USD = 100;

export interface Limits {
  /** Default daily scans for a new invite code. */
  dailyPerCode: number;
  dailyGlobal: number;
  perMinutePerCode: number;
  monthlyBudgetMicros: number;
}

export interface Config {
  enabled: boolean;
  /** Why scanning is off, for logs and the health check (never includes secret values). */
  problems: string[];
  model: ScanModel;
  effort: Effort;
  limits: Limits;
  allowedOrigins: string[];
  anthropicApiKey: string | null;
  anthropicBaseUrl: string | null;
  codePepper: string | null;
  adminToken: string | null;
}

export interface ConfigEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  CODE_PEPPER?: string;
  ADMIN_TOKEN?: string;
  SCAN_MODEL?: string;
  SCAN_EFFORT?: string;
  SCANNER_ENABLED?: string;
  ALLOWED_ORIGINS?: string;
  DAILY_SCANS_PER_CODE?: string;
  DAILY_SCANS_GLOBAL?: string;
  SCANS_PER_MINUTE_PER_CODE?: string;
  MONTHLY_BUDGET_USD?: string;
}

function positiveInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}

export function loadConfig(env: ConfigEnv): Config {
  const problems: string[] = [];
  const model = (env.SCAN_MODEL ?? DEFAULT_MODEL).trim() as ScanModel;
  if (!(model in MODELS)) problems.push(`SCAN_MODEL must be one of ${Object.keys(MODELS).join(', ')}`);
  const effortRaw = (env.SCAN_EFFORT ?? 'low').trim();
  const effort: Effort = effortRaw === 'medium' || effortRaw === 'high' ? effortRaw : 'low';

  const apiKey = env.ANTHROPIC_API_KEY?.trim() || null;
  if (!apiKey) problems.push('ANTHROPIC_API_KEY secret is not set');
  const pepper = env.CODE_PEPPER?.trim() || null;
  if (!pepper || pepper.length < 32) problems.push('CODE_PEPPER secret must be at least 32 characters');
  const adminToken = env.ADMIN_TOKEN?.trim() || null;

  const pricing = model in MODELS ? pricingProblem(model) : null;
  if (pricing) problems.push(pricing);

  const budgetRaw = (env.MONTHLY_BUDGET_USD ?? '10').trim();
  const budgetUsd = /^\d+(\.\d{1,2})?$/.test(budgetRaw) ? Number(budgetRaw) : NaN;
  const budgetValid = Number.isFinite(budgetUsd) && budgetUsd <= MAX_MONTHLY_BUDGET_USD;
  if (!budgetValid) problems.push(`MONTHLY_BUDGET_USD must be a dollar amount from 0 to ${MAX_MONTHLY_BUDGET_USD}`);
  const monthlyBudgetMicros = budgetValid ? Math.round(budgetUsd * 1_000_000) : 0;

  if (env.SCANNER_ENABLED?.trim().toLowerCase() === 'false') problems.push('SCANNER_ENABLED is false');

  return {
    enabled: problems.length === 0,
    problems,
    model: model in MODELS ? model : DEFAULT_MODEL,
    effort,
    limits: {
      dailyPerCode: positiveInt(env.DAILY_SCANS_PER_CODE, 20, 1000),
      dailyGlobal: positiveInt(env.DAILY_SCANS_GLOBAL, 200, 100_000),
      perMinutePerCode: positiveInt(env.SCANS_PER_MINUTE_PER_CODE, 6, 60),
      monthlyBudgetMicros,
    },
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    anthropicApiKey: apiKey,
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL?.trim() || null,
    codePepper: pepper && pepper.length >= 32 ? pepper : null,
    // Admin endpoints stay off unless a long random token is configured.
    adminToken: adminToken && adminToken.length >= 32 ? adminToken : null,
  };
}

/**
 * Why a model's configured price can't be trusted, or null if it looks sane. A missing, zero,
 * negative or non-numeric price would let the budget be silently ignored, so it switches the
 * scanner off instead.
 */
export function pricingProblem(model: string, table: Record<string, ModelInfo> = MODELS): string | null {
  const info = table[model];
  if (!info) return `no price is configured for ${model}`;
  const valid = (n: number) => typeof n === 'number' && Number.isFinite(n) && n > 0;
  if (!valid(info.inputMicrosPerToken) || !valid(info.outputMicrosPerToken) || info.outputMicrosPerToken < info.inputMicrosPerToken) {
    return `the price configured for ${model} is invalid`;
  }
  return null;
}

/**
 * Cost of a call in micro-dollars, rounded up. Cache writes are charged at 2× the input price
 * (the highest cache-write rate) and cache reads at the full input price, so caching, which
 * the scanner doesn't use, could only make the recorded cost too high, never too low.
 */
export function costMicros(model: ScanModel, inputTokens: number, outputTokens: number, cacheWriteTokens = 0): number {
  const info = MODELS[model];
  return Math.ceil((inputTokens + 2 * cacheWriteTokens) * info.inputMicrosPerToken + outputTokens * info.outputMicrosPerToken);
}

/** Worst-case cost of one scan, reserved against the budget before calling the model. */
export function worstCaseMicros(model: ScanModel): number {
  return costMicros(model, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS);
}

/** Visual tokens an image of this size can cost after the API's downscaling (an upper bound). */
export function imageTokenBound(width: number, height: number): number {
  return Math.min(Math.ceil(width / 28) * Math.ceil(height / 28), MAX_IMAGE_TOKENS);
}
