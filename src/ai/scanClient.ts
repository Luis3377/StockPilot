// Talks to the scanner backend. The app never holds an AI API key: it sends the photo and the
// tester's invite code to the StockPilot backend, which calls the AI provider.

import { SCAN_API_BASE, SCAN_TIMEOUT_MS } from './config';
import { parseScanResult, type ScanResult } from './scanSchema';

/** Error codes the backend returns, plus failures that happen on the device. */
export type ScanErrorCode =
  | 'missing_code'
  | 'invalid_code'
  | 'code_revoked'
  | 'code_expired'
  | 'too_many_attempts'
  | 'rate_limited'
  | 'code_daily_limit'
  | 'global_daily_limit'
  | 'budget_exhausted'
  | 'scanner_unavailable'
  | 'origin_not_allowed'
  | 'ai_timeout'
  | 'ai_busy'
  | 'ai_error'
  | 'ai_bad_response'
  | 'image_too_large'
  | 'unsupported_image'
  | 'invalid_image'
  | 'invalid_request'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'bad_response';

const CODE_ERRORS: ScanErrorCode[] = ['missing_code', 'invalid_code', 'code_revoked', 'code_expired'];
const RETRYABLE: ScanErrorCode[] = ['ai_timeout', 'ai_busy', 'ai_error', 'ai_bad_response', 'network', 'timeout', 'bad_response', 'rate_limited'];

const DEVICE_MESSAGES: Partial<Record<ScanErrorCode, string>> = {
  network: 'Couldn’t reach the scanner. Check your connection and try again.',
  timeout: 'The scan took too long. Try again.',
  cancelled: 'Scan cancelled.',
  bad_response: 'The scanner’s answer couldn’t be used. Try again, or enter the details yourself.',
};

export class ScanError extends Error {
  readonly code: ScanErrorCode;
  constructor(code: ScanErrorCode, message?: string) {
    super(message ?? DEVICE_MESSAGES[code] ?? 'The scan didn’t work. Try again, or enter the details yourself.');
    this.name = 'ScanError';
    this.code = code;
  }
  /** The invite code is the problem: ask for it again. */
  get needsCode(): boolean {
    return CODE_ERRORS.includes(this.code);
  }
  get retryable(): boolean {
    return RETRYABLE.includes(this.code);
  }
}

export interface ScanSuccess {
  result: ScanResult;
  modelLabel: string;
  scansLeftToday: number | null;
}

export interface CodeStatus {
  label: string;
  scansLeftToday: number;
  dailyLimit: number;
  expiresAt: number;
}

/** Implemented by the remote scanner today; a different provider can implement the same shape. */
export interface ItemScanProvider {
  scan(imageDataUrl: string, opts: { code: string; signal?: AbortSignal }): Promise<ScanSuccess>;
  status(code: string): Promise<CodeStatus>;
}

async function request(path: string, init: RequestInit, code: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (SCAN_API_BASE === null) throw new ScanError('scanner_unavailable', 'AI scanning isn’t available in this version.');
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), SCAN_TIMEOUT_MS);
  const onCancel = () => timeout.abort();
  signal?.addEventListener('abort', onCancel);
  let res: Response;
  try {
    res = await fetch(`${SCAN_API_BASE}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${code}` },
      signal: timeout.signal,
    });
  } catch {
    throw new ScanError(signal?.aborted ? 'cancelled' : timeout.signal.aborted ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCancel);
  }
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new ScanError(res.ok ? 'bad_response' : 'network');
  }
  if (!res.ok) {
    const err = (body.error ?? {}) as { code?: string; message?: string };
    throw new ScanError((err.code as ScanErrorCode) ?? 'ai_error', typeof err.message === 'string' ? err.message : undefined);
  }
  return body;
}

export const remoteScanProvider: ItemScanProvider = {
  async scan(imageDataUrl, { code, signal }) {
    const body = await request(
      '/v1/scan',
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: imageDataUrl }) },
      code,
      signal,
    );
    let result: ScanResult;
    try {
      // Validate again here: never trust a response just because it came from our backend.
      result = parseScanResult(body.result);
    } catch {
      throw new ScanError('bad_response');
    }
    const model = body.model as { label?: unknown } | undefined;
    return {
      result,
      modelLabel: typeof model?.label === 'string' ? model.label : 'Claude',
      scansLeftToday: typeof body.scansLeftToday === 'number' ? body.scansLeftToday : null,
    };
  },

  async status(code) {
    const body = await request('/v1/status', { method: 'GET' }, code);
    return {
      label: String(body.label ?? ''),
      scansLeftToday: Number(body.scansLeftToday ?? 0),
      dailyLimit: Number(body.dailyLimit ?? 0),
      expiresAt: Number(body.expiresAt ?? 0),
    };
  },
};
