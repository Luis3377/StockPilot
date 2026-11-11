import { DatabaseSync } from 'node:sqlite';
import type Anthropic from '@anthropic-ai/sdk';
import { LedgerCore, type SqlLike } from '../src/ledgerCore';
import type { LedgerApi } from '../src/handler';
import type { MessagesClient } from '../src/claude';

/** node:sqlite stand-in for a Durable Object's SqlStorage (same SQL, same semantics). */
export function memorySql(): SqlLike {
  const db = new DatabaseSync(':memory:');
  return {
    exec(query, ...bindings) {
      const stmt = db.prepare(query);
      if (/^\s*(SELECT|WITH)\b|\bRETURNING\b/i.test(query)) {
        const rows = stmt.all(...bindings).map((r) => ({ ...(r as Record<string, unknown>) }));
        return { toArray: () => rows };
      }
      stmt.run(...bindings);
      return { toArray: () => [] };
    },
  };
}

/**
 * Wraps the core like the Durable Object RPC stub: every call is async, but calls run one at
 * a time (a Durable Object processes one request at a time and these methods never await).
 */
export function asyncLedger(core: LedgerCore): LedgerApi {
  let queue: Promise<unknown> = Promise.resolve();
  const call = <T>(fn: () => T): Promise<T> => {
    const next = queue.then(fn);
    queue = next.catch(() => undefined);
    return next;
  };
  return {
    beginScan: (a) => call(() => core.beginScan(a)),
    finishScan: (a) => call(() => core.finishScan(a)),
    status: (a) => call(() => core.status(a)),
    throttledFor: (k, n) => call(() => core.throttledFor(k, n)),
    recordFailure: (k, n) => call(() => core.recordFailure(k, n)),
    createCode: (a) => call(() => core.createCode(a)),
    listCodes: (n) => call(() => core.listCodes(n)),
    revokeCode: (id, n) => call(() => core.revokeCode(id, n)),
    usage: (n, l) => call(() => core.usage(n, l)),
  };
}

/** JPEG header bytes: start marker, a JFIF segment and a frame header with the given size. */
export function jpegHeader(width = 1600, height = 1200): number[] {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, ...new Array(9).fill(0)];
  return [0xff, 0xd8, ...app0, ...sof0];
}

/** A small valid-looking JPEG payload (header + padding) as base64. */
export function fakeJpegBase64(bytes = 2048, width = 1600, height = 1200): string {
  const buf = Buffer.alloc(bytes, 0x11);
  buf.set(jpegHeader(width, height).slice(0, bytes));
  return buf.toString('base64');
}

/** A request body as a stream of `chunks` chunks of `size` bytes, counting how many were pulled. */
export function countingStream(chunks: number, size: number, fill = 0x41) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= chunks) return controller.close();
      state.pulled++;
      controller.enqueue(new Uint8Array(size).fill(fill));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

export function fakeMessage(json: unknown, overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json), citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 3000,
      output_tokens: 400,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: 'standard',
      speed: 'standard',
    },
    ...overrides,
  } as unknown as Anthropic.Message;
}

export const SNEAKERS = {
  status: 'identified',
  name: 'Nike Air Force 1 Low White',
  brand: 'Nike',
  model: 'Air Force 1 Low',
  category: 'Sneakers',
  description: 'White leather low-top sneakers.',
  condition: 'good',
  condition_notes: 'Light creasing on the toe box.',
  confidence: 'high',
  notes: null,
};

export function fakeClient(respond: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>): MessagesClient & { calls: Anthropic.MessageCreateParamsNonStreaming[] } {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  return {
    calls,
    messages: {
      create: (params) => {
        calls.push(params);
        return respond(params);
      },
    },
  };
}
