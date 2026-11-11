// Talks to the assistant's AI layer on the StockPilot backend (the same Worker, invite code,
// limits and monthly budget as the scanner). The app never holds an API key, and nothing is
// sent unless the user asks for it.

import { SCAN_API_BASE, SCAN_TIMEOUT_MS } from './config';
import { parseExplainResult, parseInterpretResult, type ExplainFacts, type InterpretResult } from './explainSchema';

const DEVICE_MESSAGES: Record<string, string> = {
  network: 'Couldn’t reach StockPilot’s AI service. Check your connection and try again.',
  timeout: 'The AI took too long. Try again.',
  bad_response: 'The AI’s answer couldn’t be used. The verified calculation is unchanged.',
  unavailable: 'AI answers aren’t available in this version.',
};

export class AssistantError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? DEVICE_MESSAGES[code] ?? 'The AI request didn’t work. The verified calculation is unchanged.');
    this.name = 'AssistantError';
    this.code = code;
  }
  get needsCode(): boolean {
    return ['missing_code', 'invalid_code', 'code_revoked', 'code_expired'].includes(this.code);
  }
}

async function post(code: string, body: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (SCAN_API_BASE === null) throw new AssistantError('unavailable');
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), SCAN_TIMEOUT_MS);
  const onCancel = () => timeout.abort();
  signal?.addEventListener('abort', onCancel);
  let res: Response;
  try {
    res = await fetch(`${SCAN_API_BASE}/v1/assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${code}` },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
  } catch {
    throw new AssistantError(timeout.signal.aborted && !signal?.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }
  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new AssistantError(res.ok ? 'bad_response' : 'network');
  }
  if (!res.ok) {
    const err = (json.error ?? {}) as { code?: string; message?: string };
    throw new AssistantError(err.code ?? 'ai_error', typeof err.message === 'string' ? err.message : undefined);
  }
  return json;
}

export interface Interpretation extends InterpretResult {
  requestsLeftToday: number | null;
}

/** Sends only the question. Returns one of the supported intents (or "unsupported"). */
export async function interpretQuestion(code: string, question: string, signal?: AbortSignal): Promise<Interpretation> {
  const body = await post(code, { mode: 'interpret', question }, signal);
  try {
    return { ...parseInterpretResult({ intent: body.intent, period: body.period ?? 'none' }), requestsLeftToday: typeof body.requestsLeftToday === 'number' ? body.requestsLeftToday : null };
  } catch {
    throw new AssistantError('bad_response');
  }
}

export interface Explanation {
  /** null when the backend refused it (a number not in the figures). */
  text: string | null;
  unverified: string[];
  modelLabel: string;
  requestsLeftToday: number | null;
}

/** Sends the question and the calculation's facts (see buildExplainFacts). */
export async function explainAnswer(code: string, question: string, facts: ExplainFacts, signal?: AbortSignal): Promise<Explanation> {
  const body = await post(code, { mode: 'explain', question, facts }, signal);
  const model = body.model as { label?: unknown } | undefined;
  const unverified = Array.isArray(body.unverified) ? body.unverified.filter((x): x is string => typeof x === 'string') : [];
  let text: string | null = null;
  if (body.explanation !== null && body.explanation !== undefined) {
    try {
      text = parseExplainResult({ explanation: body.explanation }).explanation;
    } catch {
      throw new AssistantError('bad_response');
    }
  }
  return { text, unverified, modelLabel: typeof model?.label === 'string' ? model.label : 'Claude', requestsLeftToday: typeof body.requestsLeftToday === 'number' ? body.requestsLeftToday : null };
}
