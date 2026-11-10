// Runtime configuration, read from Worker variables and secrets (see wrangler.toml and
// docs/AI_SCANNER.md). Everything has a safe default; a missing secret disables scanning.

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
 * Haiku 5.5's rate applies to prompts up to 100K tokens; a scan is ~3–6K tokens.
 */
export const MODELS = {
  'claude-haiku-5-5': { label: 'Claude Haiku 5.5', inputMicrosPerToken: 0.1, outputMicrosPerToken: 0.5 },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', inputMicrosPerToken: 2, outputMicrosPerToken: 10 },
  'claude-opus-5-5': { label: 'Claude Opus 5.5', inputMicrosPerToken: 4, outputMicrosPerToken: 20 },
} as const satisfies Record<string, ModelInfo>;

export type ScanModel = keyof typeof MODELS;
export type Effort = 'low' | 'medium' | 'high';

export const DEFAULT_MODEL: ScanModel = 'claude-sonnet-5-5';

/** Output cap per scan. Bounds the worst-case cost of a single request. */
export const MAX_OUTPUT_TOKENS = 2048;
/** Worst-case input: a full-resolution image (≤ 4,784 visual tokens) plus the prompt and schema. */
export const MAX_INPUT_TOKENS_ESTIMATE = 6500;
/** How long to wait for Claude before giving up. */
export const AI_TIMEOUT_MS = 25_000;
/** Largest accepted image after base64 decoding. The app sends ~200–400 KB JPEGs. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Largest accepted request body (base64 inflates by 4/3, plus JSON overhead). */
export const MAX_BODY_BYTES = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 16 * 1024;

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

  const budgetUsd = Number(env.MONTHLY_BUDGET_USD ?? '10');
  const monthlyBudgetMicros = Number.isFinite(budgetUsd) && budgetUsd >= 0 ? Math.round(budgetUsd * 1_000_000) : 10_000_000;

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

/** Cost of a call in micro-dollars, rounded up. */
export function costMicros(model: ScanModel, inputTokens: number, outputTokens: number): number {
  const info = MODELS[model];
  return Math.ceil(inputTokens * info.inputMicrosPerToken + outputTokens * info.outputMicrosPerToken);
}

/** Worst-case cost of one scan, reserved against the budget before calling the model. */
export function worstCaseMicros(model: ScanModel): number {
  return costMicros(model, MAX_INPUT_TOKENS_ESTIMATE, MAX_OUTPUT_TOKENS);
}
