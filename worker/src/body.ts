// Reads a request body with a hard size limit. The limit is enforced on the bytes actually
// received while streaming, so a missing, wrong or misleading Content-Length can't make the
// Worker read (or hold in memory) more than the limit.

export type DeclaredLength = { kind: 'none' } | { kind: 'valid'; bytes: number } | { kind: 'invalid' };

export type BodyRead =
  | { ok: true; text: string }
  /** too_large → 413; bad_length (header invalid or not matching the body) and unreadable → 400. */
  | { ok: false; reason: 'too_large' | 'bad_length' | 'unreadable' };

/** Parses Content-Length strictly: digits only, one value. Anything else is invalid. */
export function declaredLength(headers: Headers): DeclaredLength {
  const raw = headers.get('Content-Length');
  if (raw === null) return { kind: 'none' };
  const value = raw.trim();
  if (!/^\d{1,15}$/.test(value)) return { kind: 'invalid' };
  return { kind: 'valid', bytes: Number(value) };
}

/**
 * Checks the declared size before reading anything. Returns the error to send, or null when
 * the body may be read (with readTextLimited, which enforces the limit again while reading).
 */
export function precheckLength(headers: Headers, maxBytes: number): Extract<BodyRead, { ok: false }> | null {
  const declared = declaredLength(headers);
  if (declared.kind === 'invalid') return { ok: false, reason: 'bad_length' };
  if (declared.kind === 'valid' && declared.bytes > maxBytes) return { ok: false, reason: 'too_large' };
  return null;
}

/**
 * Reads the body as UTF-8 text, stopping as soon as more than `maxBytes` arrive. When a
 * Content-Length is declared, the body must match it exactly.
 */
export async function readTextLimited(request: Request, maxBytes: number): Promise<BodyRead> {
  const early = precheckLength(request.headers, maxBytes);
  if (early) {
    await request.body?.cancel().catch(() => undefined);
    return early;
  }
  const declared = declaredLength(request.headers);
  const expected = declared.kind === 'valid' ? declared.bytes : null;
  if (!request.body) return expected ? { ok: false, reason: 'bad_length' } : { ok: true, text: '' };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stop = async (reason: 'too_large' | 'bad_length' | 'unreadable'): Promise<BodyRead> => {
    await reader.cancel().catch(() => undefined);
    return { ok: false, reason };
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return await stop('too_large');
      if (expected !== null && total > expected) return await stop('bad_length');
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (expected !== null && total !== expected) return { ok: false, reason: 'bad_length' };

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes) };
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
}
