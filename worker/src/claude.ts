// The one place that talks to the AI provider (Claude, via Anthropic's official SDK).
// Swapping or adding a provider later only touches this file.

import Anthropic from '@anthropic-ai/sdk';
import { parseScanResult, ScanResultError, SCAN_JSON_SCHEMA, SCAN_SYSTEM_PROMPT, SCAN_USER_PROMPT, type ScanResult } from '../../src/ai/scanSchema';
import { AssistantResultError } from '../../src/ai/explainSchema';
import { AI_TIMEOUT_MS, costMicros, MAX_OUTPUT_TOKENS, type Effort, type ScanModel } from './config';
import type { ImageMediaType } from './image';

export interface AiUsage {
  /** Uncached input plus cache reads (charged at the full input price). */
  inputTokens: number;
  outputTokens: number;
  /** Cache writes (charged at 2× the input price). The scanner doesn't use caching, so normally 0. */
  cacheWriteTokens: number;
}

export type AiOutcome =
  | { kind: 'ok'; result: ScanResult; usage: AiUsage; costMicros: number }
  | {
      kind: 'error';
      error: 'timeout' | 'busy' | 'upstream' | 'bad_response' | 'config';
      usage: AiUsage | null;
      costMicros: number;
      /**
       * True when the request may have been processed (and billed) even though no usable
       * answer came back: timeouts, dropped connections and server errors. The caller charges
       * these at the reserved worst case, since the real cost is unknown.
       */
      mayBeBilled: boolean;
      detail: string;
    };

/** The subset of the SDK client the scanner uses (lets tests pass a fake). */
export interface MessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming, options?: { signal?: AbortSignal; timeout?: number }): Promise<Anthropic.Message> };
}

export function createClient(apiKey: string, baseURL: string | null): MessagesClient {
  return new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), maxRetries: 0, timeout: AI_TIMEOUT_MS });
}

export function buildScanRequest(model: ScanModel, effort: Effort, mediaType: ImageMediaType, data: string): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SCAN_SYSTEM_PROMPT,
    // Adaptive thinking is on by default on these models; low effort keeps it brief.
    output_config: { effort, format: { type: 'json_schema', schema: SCAN_JSON_SCHEMA as unknown as Record<string, unknown> } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: SCAN_USER_PROMPT },
        ],
      },
    ],
  };
}

function usageOf(message: Anthropic.Message): AiUsage {
  const u = message.usage;
  return {
    inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/** Turns the model's message into a validated result; never trusts the content blindly. */
export function interpretMessage(message: Anthropic.Message, model: ScanModel): AiOutcome {
  const usage = usageOf(message);
  const cost = costMicros(model, usage.inputTokens, usage.outputTokens, usage.cacheWriteTokens);
  if (message.stop_reason === 'refusal') {
    // A declined photo is reported as "couldn't identify", never as an error the user must debug.
    return {
      kind: 'ok',
      result: parseScanResult({ status: 'unrecognized', condition: 'unknown', confidence: 'low', notes: 'The AI couldn’t analyze this photo. Try a different photo of just the item.' }),
      usage,
      costMicros: cost,
    };
  }
  if (message.stop_reason === 'max_tokens') {
    return { kind: 'error', error: 'bad_response', usage, costMicros: cost, mayBeBilled: false, detail: 'max_tokens' };
  }
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
  if (!text) return { kind: 'error', error: 'bad_response', usage, costMicros: cost, mayBeBilled: false, detail: 'no text block' };
  try {
    return { kind: 'ok', result: parseScanResult(JSON.parse(text)), usage, costMicros: cost };
  } catch (e) {
    const detail = e instanceof ScanResultError ? e.message : 'invalid JSON';
    return { kind: 'error', error: 'bad_response', usage, costMicros: cost, mayBeBilled: false, detail };
  }
}

type AiFailure = Extract<AiOutcome, { kind: 'error' }>;

/**
 * Maps an SDK error to an outcome. Requests rejected up front (4xx, 529 overloaded) are not
 * processed or billed; anything that may have reached the model without a reply is treated as
 * billed, and the caller charges the reserved worst case.
 */
export function classifyError(e: unknown): AiFailure {
  const fail = (error: AiFailure['error'], mayBeBilled: boolean, detail: string): AiFailure => ({ kind: 'error', error, usage: null, costMicros: 0, mayBeBilled, detail });
  if (e instanceof Anthropic.APIConnectionTimeoutError) return fail('timeout', true, 'timeout');
  if (e instanceof Anthropic.APIUserAbortError) return fail('timeout', true, 'aborted');
  if (e instanceof Anthropic.APIConnectionError) return fail('upstream', true, 'connection lost');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return fail('config', false, `auth ${e.status}`);
  if (e instanceof Anthropic.RateLimitError) return fail('busy', false, 'rate limited');
  if (e instanceof Anthropic.BadRequestError) return fail('upstream', false, `bad request: ${e.message.slice(0, 200)}`);
  if (e instanceof Anthropic.APIError) {
    const status = e.status;
    if (status === 529) return fail('busy', false, 'overloaded');
    if (typeof status === 'number' && status >= 400 && status < 500) return fail('upstream', false, `status ${status}`);
    return fail('upstream', true, `status ${status ?? 'none'}`);
  }
  return fail('upstream', true, e instanceof Error ? e.message.slice(0, 200) : 'unknown');
}

/**
 * Sends one image to Claude. Errors are mapped to a small set of outcomes. Answers that came
 * back (even unusable ones) carry their exact cost. Failures where the provider may still
 * have processed the request are marked `mayBeBilled`, and the caller charges the worst case.
 */
export async function analyzeImage(
  client: MessagesClient,
  args: { model: ScanModel; effort: Effort; mediaType: ImageMediaType; data: string; signal?: AbortSignal },
): Promise<AiOutcome> {
  try {
    const message = await client.messages.create(buildScanRequest(args.model, args.effort, args.mediaType, args.data), {
      signal: args.signal,
      timeout: AI_TIMEOUT_MS,
    });
    return interpretMessage(message, args.model);
  } catch (e) {
    return classifyError(e);
  }
}

// ---------------------------------------------------------------------------
// Assistant: structured text-only calls (interpret a question, explain a calculation)
// ---------------------------------------------------------------------------

export type TextOutcome<T> = { kind: 'ok'; value: T; usage: AiUsage; costMicros: number } | AiFailure;

export interface TextRequest {
  model: ScanModel;
  effort: Effort;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}

export function buildTextRequest(r: TextRequest): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: r.model,
    max_tokens: r.maxTokens,
    system: r.system,
    output_config: { effort: r.effort, format: { type: 'json_schema', schema: r.schema } },
    messages: [{ role: 'user', content: r.user }],
  };
}

/** One structured, text-only call; the answer is validated by `parse` before anything returns. */
export async function callStructured<T>(client: MessagesClient, r: TextRequest, parse: (raw: unknown) => T, signal?: AbortSignal): Promise<TextOutcome<T>> {
  let message: Anthropic.Message;
  try {
    message = await client.messages.create(buildTextRequest(r), { signal, timeout: AI_TIMEOUT_MS });
  } catch (e) {
    return classifyError(e);
  }
  const usage = usageOf(message);
  const cost = costMicros(r.model, usage.inputTokens, usage.outputTokens, usage.cacheWriteTokens);
  const bad = (detail: string): AiFailure => ({ kind: 'error', error: 'bad_response', usage, costMicros: cost, mayBeBilled: false, detail });
  if (message.stop_reason === 'refusal') return bad('refusal');
  if (message.stop_reason === 'max_tokens') return bad('max_tokens');
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
  if (!text) return bad('no text block');
  try {
    return { kind: 'ok', value: parse(JSON.parse(text)), usage, costMicros: cost };
  } catch (e) {
    return bad(e instanceof AssistantResultError ? e.message : 'invalid JSON');
  }
}
