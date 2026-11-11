import { describe, expect, it } from 'vitest';
import { declaredLength, precheckLength, readTextLimited } from '../src/body';
import { countingStream } from './helpers';

const LIMIT = 1000;
const req = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('https://scanner.example/v1/scan', { method: 'POST', body, headers, duplex: 'half' } as RequestInit);

describe('declaredLength', () => {
  it('accepts only a single plain number', () => {
    const h = (v?: string) => new Headers(v === undefined ? {} : { 'Content-Length': v });
    expect(declaredLength(h())).toEqual({ kind: 'none' });
    expect(declaredLength(h('1234'))).toEqual({ kind: 'valid', bytes: 1234 });
    expect(declaredLength(h(' 0 '))).toEqual({ kind: 'valid', bytes: 0 });
    for (const bad of ['abc', '-1', '1e6', '12.5', '', '12, 12', '0x10', '9'.repeat(16)]) {
      expect(declaredLength(h(bad)), bad).toEqual({ kind: 'invalid' });
    }
  });

  it('refuses an invalid or oversized declaration before reading', () => {
    const h = (v: string) => new Headers({ 'Content-Length': v });
    expect(precheckLength(h('abc'), LIMIT)).toEqual({ ok: false, reason: 'bad_length' });
    expect(precheckLength(h(String(LIMIT + 1)), LIMIT)).toEqual({ ok: false, reason: 'too_large' });
    expect(precheckLength(h(String(LIMIT)), LIMIT)).toBeNull();
    expect(precheckLength(new Headers(), LIMIT)).toBeNull();
  });
});

describe('readTextLimited', () => {
  it('reads a body within the limit, with or without Content-Length', async () => {
    expect(await readTextLimited(req('{"a":1}', { 'Content-Length': '7' }), LIMIT)).toEqual({ ok: true, text: '{"a":1}' });
    const { stream } = countingStream(4, 100);
    expect(await readTextLimited(req(stream), LIMIT)).toMatchObject({ ok: true });
    expect(await readTextLimited(req(null), LIMIT)).toEqual({ ok: true, text: '' });
  });

  it('stops reading as soon as a body without Content-Length passes the limit', async () => {
    // An endless upload: 1,000,000 chunks of 300 bytes. Reading must stop after the 4th.
    const { stream, state } = countingStream(1_000_000, 300);
    expect(await readTextLimited(req(stream), LIMIT)).toEqual({ ok: false, reason: 'too_large' });
    expect(state.pulled).toBeLessThanOrEqual(5);
    expect(state.cancelled).toBe(true);
  });

  it('refuses an oversized declaration without reading the body at all', async () => {
    const { stream, state } = countingStream(10, 300);
    expect(await readTextLimited(req(stream, { 'Content-Length': '5000' }), LIMIT)).toEqual({ ok: false, reason: 'too_large' });
    expect(state.pulled).toBeLessThanOrEqual(1); // at most the stream's own first buffered chunk
  });

  it('catches a Content-Length that understates the body, and stops reading', async () => {
    // Declares 100 bytes but keeps sending: rejected once byte 101 arrives, well before the limit.
    const { stream, state } = countingStream(1_000_000, 60);
    expect(await readTextLimited(req(stream, { 'Content-Length': '100' }), LIMIT)).toEqual({ ok: false, reason: 'bad_length' });
    expect(state.pulled).toBeLessThanOrEqual(3);
    expect(state.cancelled).toBe(true);
  });

  it('catches a Content-Length that overstates the body', async () => {
    const { stream } = countingStream(2, 100);
    expect(await readTextLimited(req(stream, { 'Content-Length': '900' }), LIMIT)).toEqual({ ok: false, reason: 'bad_length' });
  });

  it('rejects an invalid Content-Length and bodies that are not text', async () => {
    expect(await readTextLimited(req('{}', { 'Content-Length': 'lots' }), LIMIT)).toEqual({ ok: false, reason: 'bad_length' });
    const binary = new Uint8Array([0xff, 0xfe, 0xfd]);
    expect(await readTextLimited(req(binary), LIMIT)).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('reports a broken upload as unreadable', async () => {
    let sent = false;
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) return controller.error(new Error('connection reset'));
        sent = true;
        controller.enqueue(new Uint8Array(10));
      },
    });
    expect(await readTextLimited(req(failing), LIMIT)).toEqual({ ok: false, reason: 'unreadable' });
  });
});
