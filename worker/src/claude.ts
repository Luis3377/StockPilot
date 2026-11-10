// The one place that talks to the AI provider (Claude, via Anthropic's official SDK).
// Swapping or adding a provider later only touches this file.

import Anthropic from '@anthropic-ai/sdk';
import { parseScanResult, ScanResultError, SCAN_JSON_SCHEMA, SCAN_SYSTEM_PROMPT, SCAN_USER_PROMPT, type ScanResult } from '../../src/ai/scanSchema';
import { AI_TIMEOUT_MS, costMicros, MAX_OUTPUT_TOKENS, type Effort, type ScanModel } from './config';
import type { ImageMediaType } from './image';

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export type AiOutcome =
  | { kind: 'ok'; result: ScanResult; usage: AiUsage; costMicros: number }
  | { kind: 'error'; error: 'timeout' | 'busy' | 'upstream' | 'bad_response' | 'config'; usage: AiUsage | null; costMicros: number; detail: string };

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
    inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    outputTokens: u.output_tokens ?? 0,
  };
}

/** Turns the model's message into a validated result; never trusts the content blindly. */
export function interpretMessage(message: Anthropic.Message, model: ScanModel): AiOutcome {
  const usage = usageOf(message);
  const cost = costMicros(model, usage.inputTokens, usage.outputTokens);
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
    return { kind: 'error', error: 'bad_response', usage, costMicros: cost, detail: 'max_tokens' };
  }
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
  if (!text) return { kind: 'error', error: 'bad_response', usage, costMicros: cost, detail: 'no text block' };
  try {
    return { kind: 'ok', result: parseScanResult(JSON.parse(text)), usage, costMicros: cost };
  } catch (e) {
    const detail = e instanceof ScanResultError ? e.message : 'invalid JSON';
    return { kind: 'error', error: 'bad_response', usage, costMicros: cost, detail };
  }
}

/**
 * Sends one image to Claude. Errors are mapped to a small set of outcomes. A timeout is
 * charged at the worst case by the caller, since the provider may have billed the attempt.
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
    const fail = (error: Extract<AiOutcome, { kind: 'error' }>['error'], detail: string): AiOutcome => ({ kind: 'error', error, usage: null, costMicros: 0, detail });
    // Most specific first.
    if (e instanceof Anthropic.APIConnectionTimeoutError) return fail('timeout', 'timeout');
    if (e instanceof Anthropic.APIUserAbortError) return fail('timeout', 'aborted');
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return fail('config', `auth ${e.status}`);
    if (e instanceof Anthropic.RateLimitError) return fail('busy', 'rate limited');
    if (e instanceof Anthropic.BadRequestError) return fail('upstream', `bad request: ${e.message.slice(0, 200)}`);
    if (e instanceof Anthropic.APIError) {
      return fail(e.status === 529 ? 'busy' : 'upstream', `status ${e.status ?? 'none'}`);
    }
    return fail('upstream', e instanceof Error ? e.message.slice(0, 200) : 'unknown');
  }
}
