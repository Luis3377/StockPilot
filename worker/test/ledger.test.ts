import { describe, expect, it } from 'vitest';
import { FAILURE_WINDOW_MS, LedgerCore, MAX_FAILURES_PER_WINDOW, RESERVATION_TTL_MS } from '../src/ledgerCore';
import type { Limits } from '../src/config';
import { asyncLedger, memorySql } from './helpers';

const T0 = Date.UTC(2026, 10, 10, 15, 0, 0);
const limits: Limits = { dailyPerCode: 20, dailyGlobal: 200, perMinutePerCode: 6, monthlyBudgetMicros: 10_000_000 };
const EST = 33_480; // Sonnet worst case

function setup(codeCount = 1, dailyLimit = 20) {
  const core = new LedgerCore(memorySql());
  for (let i = 0; i < codeCount; i++) {
    core.createCode({ id: `c${i}`, hash: `h${i}`, label: `Tester ${i}`, dailyLimit, expiresAt: T0 + 30 * 86_400_000, now: T0 });
  }
  let n = 0;
  const begin = (hash: string | null, now: number, l: Limits = limits, client = 'client-a') =>
    core.beginScan({ codeHash: hash, clientKey: client, reservationId: `r${n++}`, estimateMicros: EST, limits: l, now });
  return { core, begin };
}

/** Spaces scans out so the per-minute limit doesn't interfere. */
const minute = (i: number) => T0 + i * 61_000;

describe('ledger limits', () => {
  it('allows 20 scans per tester per day, then resets the next UTC day', () => {
    const { core, begin } = setup();
    for (let i = 0; i < 20; i++) {
      const r = begin('h0', minute(i));
      expect(r.ok).toBe(true);
      if (r.ok) core.finishScan({ reservationId: r.reservationId, actualMicros: 5000, refundScan: false });
    }
    expect(begin('h0', minute(21))).toMatchObject({ ok: false, error: 'code_daily_limit' });
    expect(core.status({ codeHash: 'h0', clientKey: 'x', now: minute(21) })).toMatchObject({ ok: true, scansLeftToday: 0 });
    expect(begin('h0', T0 + 86_400_000).ok).toBe(true);
  });

  it('allows 200 scans per day across all testers', () => {
    const { begin } = setup(15);
    let allowed = 0;
    for (let i = 0; i < 15 * 20; i++) {
      const r = begin(`h${i % 15}`, minute(Math.floor(i / 15)));
      if (r.ok) allowed++;
      else expect(r.error).toBe('global_daily_limit');
    }
    expect(allowed).toBe(200);
  });

  it('limits bursts to 6 scans a minute per tester', () => {
    const { begin } = setup();
    for (let i = 0; i < 6; i++) expect(begin('h0', T0 + i * 1000).ok).toBe(true);
    expect(begin('h0', T0 + 7000)).toMatchObject({ ok: false, error: 'rate_limited', retryAfterSeconds: expect.any(Number) });
    expect(begin('h0', T0 + 61_000).ok).toBe(true);
  });

  it('never lets reserved + spent exceed the monthly budget, even with calls in flight', async () => {
    const { core } = setup(50, 1000);
    const ledger = asyncLedger(core);
    const big: Limits = { ...limits, dailyGlobal: 10_000, perMinutePerCode: 1000 };
    // 400 scans arrive "at once" before any finishes; each reserves the worst case.
    const results = await Promise.all(
      Array.from({ length: 400 }, (_, i) =>
        ledger.beginScan({ codeHash: `h${i % 50}`, clientKey: 'k', reservationId: `p${i}`, estimateMicros: EST, limits: big, now: T0 }),
      ),
    );
    const ok = results.filter((r) => r.ok);
    expect(ok).toHaveLength(Math.floor(10_000_000 / EST)); // 298
    expect(results.find((r) => !r.ok)).toMatchObject({ error: 'budget_exhausted' });
    const usage = core.usage(T0, big);
    expect(usage.spentMicros + usage.reservedMicros).toBeLessThanOrEqual(10_000_000);

    // Settling at the real (lower) cost frees budget for more scans.
    for (const r of ok) if (r.ok) core.finishScan({ reservationId: r.reservationId, actualMicros: 8000, refundScan: false });
    expect(core.usage(T0, big)).toMatchObject({ spentMicros: ok.length * 8000, reservedMicros: 0 });
    expect(core.beginScan({ codeHash: 'h0', clientKey: 'k', reservationId: 'after', estimateMicros: EST, limits: big, now: T0 }).ok).toBe(true);
  });

  it('refunds failed scans to the daily allowance and settles only once', () => {
    const { core, begin } = setup();
    const r = begin('h0', T0);
    if (!r.ok) throw new Error('expected ok');
    expect(r.scansLeftToday).toBe(19);
    core.finishScan({ reservationId: r.reservationId, actualMicros: EST, refundScan: true });
    core.finishScan({ reservationId: r.reservationId, actualMicros: EST, refundScan: true });
    expect(core.status({ codeHash: 'h0', clientKey: 'x', now: T0 })).toMatchObject({ scansLeftToday: 20 });
    expect(core.usage(T0, limits)).toMatchObject({ spentMicros: EST, reservedMicros: 0, scansToday: 0 });
  });

  it('charges an abandoned reservation in full after it expires', () => {
    const { core, begin } = setup();
    expect(begin('h0', T0).ok).toBe(true);
    expect(core.usage(T0, limits)).toMatchObject({ reservedMicros: EST, spentMicros: 0 });
    begin('h0', T0 + RESERVATION_TTL_MS + 1000);
    expect(core.usage(T0 + RESERVATION_TTL_MS + 1000, limits)).toMatchObject({ spentMicros: EST, reservedMicros: EST });
  });

  it('starts each month with a fresh budget', () => {
    const { begin } = setup(1, 1000);
    const tiny: Limits = { ...limits, monthlyBudgetMicros: EST, perMinutePerCode: 100 };
    expect(begin('h0', T0, tiny).ok).toBe(true);
    expect(begin('h0', T0 + 1000, tiny)).toMatchObject({ ok: false, error: 'budget_exhausted' });
    expect(begin('h0', Date.UTC(2026, 11, 1, 1), tiny).ok).toBe(true);
  });
});

describe('ledger invite codes', () => {
  it('rejects unknown, revoked and expired codes', () => {
    const { core, begin } = setup();
    expect(begin('nope', T0)).toMatchObject({ ok: false, error: 'invalid_code' });
    expect(begin(null, T0)).toMatchObject({ ok: false, error: 'invalid_code' });
    expect(begin('h0', T0 + 31 * 86_400_000)).toMatchObject({ ok: false, error: 'code_expired' });
    expect(core.revokeCode('c0', T0)).toBe(true);
    expect(core.revokeCode('missing', T0)).toBe(false);
    expect(begin('h0', T0, limits, 'client-b')).toMatchObject({ ok: false, error: 'code_revoked' });
    expect(core.listCodes(T0)[0]).toMatchObject({ id: 'c0', revokedAt: T0 });
    // Hashes are never part of the listing.
    expect(JSON.stringify(core.listCodes(T0))).not.toContain('h0');
  });

  it('locks out a client after 10 wrong codes for 15 minutes, even with a valid code', () => {
    const { begin } = setup();
    for (let i = 0; i < MAX_FAILURES_PER_WINDOW; i++) expect(begin(`guess${i}`, T0 + i)).toMatchObject({ error: 'invalid_code' });
    expect(begin('h0', T0 + 100)).toMatchObject({ ok: false, error: 'too_many_attempts', retryAfterSeconds: expect.any(Number) });
    // Other clients are unaffected; the lockout ends with the window.
    expect(begin('h0', T0 + 100, limits, 'client-b').ok).toBe(true);
    expect(begin('h0', T0 + FAILURE_WINDOW_MS + 1).ok).toBe(true);
  });
});
