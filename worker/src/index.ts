// Cloudflare Worker entry point: wires the real Durable Object ledger, the Anthropic client
// and Worker configuration into the request handler.

import { DurableObject } from 'cloudflare:workers';
import { createClient } from './claude';
import { loadConfig, type ConfigEnv, type Limits } from './config';
import { handleRequest, type LedgerApi } from './handler';
import { LedgerCore } from './ledgerCore';

export interface Env extends ConfigEnv {
  LEDGER: DurableObjectNamespace<UsageLedger>;
  ASSETS?: Fetcher;
}

/** One global ledger instance serializes all usage updates (see ledgerCore.ts). */
export class UsageLedger extends DurableObject<Env> {
  private core: LedgerCore;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new LedgerCore(ctx.storage.sql);
  }

  beginScan(args: Parameters<LedgerCore['beginScan']>[0]) {
    return this.core.beginScan(args);
  }
  finishScan(args: Parameters<LedgerCore['finishScan']>[0]) {
    this.core.finishScan(args);
  }
  status(args: Parameters<LedgerCore['status']>[0]) {
    return this.core.status(args);
  }
  throttledFor(clientKey: string, now: number) {
    return this.core.throttledFor(clientKey, now);
  }
  recordFailure(clientKey: string, now: number) {
    this.core.recordFailure(clientKey, now);
  }
  createCode(args: Parameters<LedgerCore['createCode']>[0]) {
    return this.core.createCode(args);
  }
  listCodes(now: number) {
    return this.core.listCodes(now);
  }
  revokeCode(id: string, now: number) {
    return this.core.revokeCode(id, now);
  }
  usage(now: number, limits: Limits) {
    return this.core.usage(now, limits);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = loadConfig(env);
    const stub = env.LEDGER.get(env.LEDGER.idFromName('global'));
    return handleRequest(request, {
      config,
      ledger: stub as unknown as LedgerApi,
      ai: config.anthropicApiKey ? createClient(config.anthropicApiKey, config.anthropicBaseUrl) : null,
      now: () => Date.now(),
      // Structured, image-free logs (visible with `wrangler tail`).
      log: (event) => console.log(JSON.stringify(event)),
      assets: env.ASSETS,
    });
  },
} satisfies ExportedHandler<Env>;
