import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { analyzeImage, buildScanRequest, interpretMessage } from '../src/claude';
import { costMicros, worstCaseMicros } from '../src/config';
import { fakeClient, fakeJpegBase64, fakeMessage, SNEAKERS } from './helpers';

const args = { model: 'claude-sonnet-5-5' as const, effort: 'low' as const, mediaType: 'image/jpeg' as const, data: fakeJpegBase64() };

describe('buildScanRequest', () => {
  it('sends one image with the structured-output schema and no sampling settings', () => {
    const req = buildScanRequest('claude-haiku-5-5', 'low', 'image/jpeg', 'AAAA');
    expect(req.model).toBe('claude-haiku-5-5');
    expect(req.max_tokens).toBe(2048);
    expect(req.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(req).not.toHaveProperty('temperature');
    const content = req.messages[0].content as Anthropic.ContentBlockParam[];
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
    expect(String(req.system)).toContain('Never estimate or mention prices');
  });
});

describe('interpretMessage', () => {
  it('validates a good answer and prices it from the reported usage', () => {
    const out = interpretMessage(fakeMessage({ ...SNEAKERS, price: 120 }), 'claude-sonnet-5-5');
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.result.name).toBe('Nike Air Force 1 Low White');
    expect(out.result).not.toHaveProperty('price');
    expect(out.costMicros).toBe(3000 * 2 + 400 * 10);
  });

  it('turns a refusal into "couldn’t identify" instead of an error', () => {
    const out = interpretMessage(fakeMessage('', { stop_reason: 'refusal', content: [] }), 'claude-sonnet-5-5');
    expect(out).toMatchObject({ kind: 'ok', result: { status: 'unrecognized', name: null } });
  });

  it('rejects truncated, empty, non-JSON and malformed answers', () => {
    expect(interpretMessage(fakeMessage(SNEAKERS, { stop_reason: 'max_tokens' }), 'claude-sonnet-5-5')).toMatchObject({ kind: 'error', error: 'bad_response' });
    expect(interpretMessage(fakeMessage('', { content: [] }), 'claude-sonnet-5-5')).toMatchObject({ kind: 'error', error: 'bad_response' });
    expect(interpretMessage(fakeMessage('Looks like Nike shoes'), 'claude-sonnet-5-5')).toMatchObject({ kind: 'error', error: 'bad_response' });
    expect(interpretMessage(fakeMessage({ name: 'Nike' }), 'claude-sonnet-5-5')).toMatchObject({ kind: 'error', error: 'bad_response', detail: expect.stringContaining('status') });
  });
});

describe('analyzeImage error mapping', () => {
  const failing = (error: unknown) => fakeClient(() => Promise.reject(error));
  const apiError = (status: number) => Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message: 'x' } }, 'x', new Headers());

  it('maps provider failures to a small set of outcomes', async () => {
    expect(await analyzeImage(failing(new Anthropic.APIConnectionTimeoutError()), args)).toMatchObject({ kind: 'error', error: 'timeout' });
    expect(await analyzeImage(failing(apiError(429)), args)).toMatchObject({ kind: 'error', error: 'busy' });
    expect(await analyzeImage(failing(apiError(529)), args)).toMatchObject({ kind: 'error', error: 'busy' });
    expect(await analyzeImage(failing(apiError(500)), args)).toMatchObject({ kind: 'error', error: 'upstream' });
    expect(await analyzeImage(failing(apiError(401)), args)).toMatchObject({ kind: 'error', error: 'config' });
    expect(await analyzeImage(failing(apiError(400)), args)).toMatchObject({ kind: 'error', error: 'upstream' });
    expect(await analyzeImage(failing(new Error('socket hang up')), args)).toMatchObject({ kind: 'error', error: 'upstream' });
  });

  it('returns the validated result on success', async () => {
    const client = fakeClient(async () => fakeMessage(SNEAKERS));
    expect(await analyzeImage(client, args)).toMatchObject({ kind: 'ok', result: { brand: 'Nike' } });
    expect(client.calls[0].model).toBe('claude-sonnet-5-5');
  });
});

describe('cost tracking', () => {
  it('uses each model’s published price', () => {
    expect(costMicros('claude-haiku-5-5', 3000, 400)).toBe(Math.ceil(3000 * 0.1 + 400 * 0.5));
    expect(costMicros('claude-opus-5-5', 3000, 400)).toBe(3000 * 4 + 400 * 20);
    // Worst case reserved per scan stays a few cents even on Opus.
    expect(worstCaseMicros('claude-opus-5-5')).toBeLessThan(100_000);
    expect(worstCaseMicros('claude-sonnet-5-5')).toBe(6500 * 2 + 2048 * 10);
  });
});
