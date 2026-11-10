// Usage, limit and budget tracking for the scanner.
//
// This logic runs inside a single Durable Object ("global" ledger) on its SQLite storage.
// Every method is synchronous: a Durable Object handles one call at a time and these methods
// never await, so each check-and-update below is atomic. Two simultaneous scans can't both
// slip past the same limit, and reservations stop parallel calls from overspending the budget.

import type { Limits } from './config';

/** The subset of Cloudflare's SqlStorage used here (an adapter backs it with node:sqlite in tests). */
export interface SqlLike {
  exec(query: string, ...bindings: (string | number | null)[]): { toArray(): Record<string, unknown>[] };
}

export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_WINDOW = 10;
/** A reservation not settled within this time (e.g. the Worker was killed) is charged in full. */
export const RESERVATION_TTL_MS = 10 * 60 * 1000;

const DAY_MS = 86_400_000;

export type BeginError =
  | 'too_many_attempts'
  | 'invalid_code'
  | 'code_revoked'
  | 'code_expired'
  | 'rate_limited'
  | 'code_daily_limit'
  | 'global_daily_limit'
  | 'budget_exhausted';

export type BeginResult =
  | { ok: true; reservationId: string; codeId: string; label: string; scansLeftToday: number; expiresAt: number }
  | { ok: false; error: BeginError; retryAfterSeconds?: number };

export type StatusResult =
  | { ok: true; codeId: string; label: string; scansLeftToday: number; dailyLimit: number; expiresAt: number }
  | { ok: false; error: Extract<BeginError, 'too_many_attempts' | 'invalid_code' | 'code_revoked' | 'code_expired'>; retryAfterSeconds?: number };

export interface CodeSummary {
  id: string;
  label: string;
  dailyLimit: number;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  scansToday: number;
}

interface CodeRow extends Record<string, unknown> {
  id: string;
  hash: string;
  label: string;
  daily_limit: number;
  created_at: number;
  expires_at: number;
  revoked_at: number | null;
}

export const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
export const monthKey = (now: number) => new Date(now).toISOString().slice(0, 7);
const secondsUntilNextUtcDay = (now: number) => Math.ceil((DAY_MS - (now % DAY_MS)) / 1000);

export class LedgerCore {
  private rows<T>(query: string, ...bindings: (string | number | null)[]): T[] {
    return this.sql.exec(query, ...bindings).toArray() as unknown as T[];
  }

  constructor(private sql: SqlLike) {
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS codes (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
        daily_limit INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER)`,
      `CREATE TABLE IF NOT EXISTS daily_usage (day TEXT NOT NULL, code_id TEXT NOT NULL, scans INTEGER NOT NULL,
        PRIMARY KEY (day, code_id))`,
      `CREATE TABLE IF NOT EXISTS minute_usage (code_id TEXT NOT NULL, minute INTEGER NOT NULL, scans INTEGER NOT NULL,
        PRIMARY KEY (code_id, minute))`,
      `CREATE TABLE IF NOT EXISTS monthly_spend (month TEXT PRIMARY KEY, spent_micros INTEGER NOT NULL, reserved_micros INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, code_id TEXT NOT NULL, day TEXT NOT NULL, month TEXT NOT NULL,
        estimate_micros INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS auth_failures (client_key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, failures INTEGER NOT NULL)`,
    ]) {
      this.sql.exec(statement);
    }
  }

  // -------------------------------------------------------------------------
  // Invitation codes (admin)
  // -------------------------------------------------------------------------

  createCode(args: { id: string; hash: string; label: string; dailyLimit: number; expiresAt: number; now: number }): CodeSummary {
    this.sql.exec(
      'INSERT INTO codes (id, hash, label, daily_limit, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)',
      args.id,
      args.hash,
      args.label,
      args.dailyLimit,
      args.now,
      args.expiresAt,
    );
    return { id: args.id, label: args.label, dailyLimit: args.dailyLimit, createdAt: args.now, expiresAt: args.expiresAt, revokedAt: null, scansToday: 0 };
  }

  listCodes(now: number): CodeSummary[] {
    const today = dayKey(now);
    return this.rows<CodeRow & { scans_today: number | null }>(
        `SELECT c.*, u.scans AS scans_today FROM codes c
         LEFT JOIN daily_usage u ON u.code_id = c.id AND u.day = ? ORDER BY c.created_at`,
        today,
      )
      .map((r: CodeRow & { scans_today: number | null }) => ({
        id: r.id,
        label: r.label,
        dailyLimit: r.daily_limit,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        revokedAt: r.revoked_at,
        scansToday: r.scans_today ?? 0,
      }));
  }

  /** Revokes a code immediately. Returns false if it doesn't exist. */
  revokeCode(id: string, now: number): boolean {
    const rows = this.rows<{ id: string }>('UPDATE codes SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? RETURNING id', now, id);
    return rows.length > 0;
  }

  // -------------------------------------------------------------------------
  // Failed-attempt throttling (brute-force protection)
  // -------------------------------------------------------------------------

  /** Seconds the client must wait, or 0 if it may try again. */
  throttledFor(clientKey: string, now: number): number {
    const row = this.rows<{ window_start: number; failures: number }>('SELECT window_start, failures FROM auth_failures WHERE client_key = ?', clientKey)[0];
    if (!row || now - row.window_start >= FAILURE_WINDOW_MS) return 0;
    return row.failures >= MAX_FAILURES_PER_WINDOW ? Math.ceil((row.window_start + FAILURE_WINDOW_MS - now) / 1000) : 0;
  }

  recordFailure(clientKey: string, now: number): void {
    const row = this.rows<{ window_start: number }>('SELECT window_start FROM auth_failures WHERE client_key = ?', clientKey)[0];
    if (!row || now - row.window_start >= FAILURE_WINDOW_MS) {
      this.sql.exec('INSERT OR REPLACE INTO auth_failures (client_key, window_start, failures) VALUES (?, ?, 1)', clientKey, now);
    } else {
      this.sql.exec('UPDATE auth_failures SET failures = failures + 1 WHERE client_key = ?', clientKey);
    }
  }

  private authenticate(codeHash: string | null, clientKey: string, now: number) {
    const wait = this.throttledFor(clientKey, now);
    if (wait > 0) return { ok: false as const, error: 'too_many_attempts' as const, retryAfterSeconds: wait };
    const code = codeHash ? this.rows<CodeRow>('SELECT * FROM codes WHERE hash = ?', codeHash)[0] : undefined;
    const error: 'invalid_code' | 'code_revoked' | 'code_expired' | null = !code
      ? 'invalid_code'
      : code.revoked_at !== null
        ? 'code_revoked'
        : code.expires_at <= now
          ? 'code_expired'
          : null;
    if (error) {
      this.recordFailure(clientKey, now);
      return { ok: false as const, error };
    }
    return { ok: true as const, code: code! };
  }

  // -------------------------------------------------------------------------
  // Scans
  // -------------------------------------------------------------------------

  private scansOn(day: string, codeId: string): number {
    return this.rows<{ scans: number }>('SELECT scans FROM daily_usage WHERE day = ? AND code_id = ?', day, codeId)[0]?.scans ?? 0;
  }

  private addScans(day: string, codeId: string, delta: number): void {
    this.sql.exec(
      `INSERT INTO daily_usage (day, code_id, scans) VALUES (?, ?, MAX(?, 0))
       ON CONFLICT (day, code_id) DO UPDATE SET scans = MAX(scans + ?, 0)`,
      day,
      codeId,
      delta,
      delta,
    );
  }

  private spend(month: string): { spent: number; reserved: number } {
    const row = this.rows<{ spent_micros: number; reserved_micros: number }>('SELECT spent_micros, reserved_micros FROM monthly_spend WHERE month = ?', month)[0];
    return { spent: row?.spent_micros ?? 0, reserved: row?.reserved_micros ?? 0 };
  }

  private adjustSpend(month: string, spentDelta: number, reservedDelta: number): void {
    this.sql.exec(
      `INSERT INTO monthly_spend (month, spent_micros, reserved_micros) VALUES (?, MAX(?, 0), MAX(?, 0))
       ON CONFLICT (month) DO UPDATE SET spent_micros = MAX(spent_micros + ?, 0), reserved_micros = MAX(reserved_micros + ?, 0)`,
      month,
      spentDelta,
      reservedDelta,
      spentDelta,
      reservedDelta,
    );
  }

  /** Charges abandoned reservations in full and drops old bookkeeping rows. */
  private housekeeping(now: number): void {
    const stale = this.rows<{ id: string; month: string; estimate_micros: number }>('SELECT id, month, estimate_micros FROM reservations WHERE created_at <= ?', now - RESERVATION_TTL_MS);
    for (const r of stale) {
      this.adjustSpend(r.month, r.estimate_micros, -r.estimate_micros);
      this.sql.exec('DELETE FROM reservations WHERE id = ?', r.id);
    }
    this.sql.exec('DELETE FROM minute_usage WHERE minute < ?', Math.floor(now / 60_000) - 5);
    this.sql.exec('DELETE FROM daily_usage WHERE day < ?', dayKey(now - 60 * DAY_MS));
    this.sql.exec('DELETE FROM auth_failures WHERE window_start < ?', now - FAILURE_WINDOW_MS);
  }

  /**
   * Authenticates the code and, if every limit allows it, counts the scan and reserves its
   * worst-case cost against this month's budget. Call finishScan when the AI call ends.
   */
  beginScan(args: { codeHash: string | null; clientKey: string; reservationId: string; estimateMicros: number; limits: Limits; now: number }): BeginResult {
    const { now, limits } = args;
    this.housekeeping(now);
    const auth = this.authenticate(args.codeHash, args.clientKey, now);
    if (!auth.ok) return auth;
    const code = auth.code;
    const day = dayKey(now);
    const month = monthKey(now);
    const minute = Math.floor(now / 60_000);

    const minuteScans =
      this.rows<{ scans: number }>('SELECT scans FROM minute_usage WHERE code_id = ? AND minute = ?', code.id, minute)[0]?.scans ?? 0;
    if (minuteScans >= limits.perMinutePerCode) {
      return { ok: false, error: 'rate_limited', retryAfterSeconds: 60 - Math.floor((now % 60_000) / 1000) };
    }
    const codeScans = this.scansOn(day, code.id);
    if (codeScans >= code.daily_limit) return { ok: false, error: 'code_daily_limit', retryAfterSeconds: secondsUntilNextUtcDay(now) };
    if (this.scansOn(day, '*') >= limits.dailyGlobal) return { ok: false, error: 'global_daily_limit', retryAfterSeconds: secondsUntilNextUtcDay(now) };
    const { spent, reserved } = this.spend(month);
    if (spent + reserved + args.estimateMicros > limits.monthlyBudgetMicros) return { ok: false, error: 'budget_exhausted' };

    this.addScans(day, code.id, 1);
    this.addScans(day, '*', 1);
    this.sql.exec(
      `INSERT INTO minute_usage (code_id, minute, scans) VALUES (?, ?, 1)
       ON CONFLICT (code_id, minute) DO UPDATE SET scans = scans + 1`,
      code.id,
      minute,
    );
    this.adjustSpend(month, 0, args.estimateMicros);
    this.sql.exec(
      'INSERT INTO reservations (id, code_id, day, month, estimate_micros, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      args.reservationId,
      code.id,
      day,
      month,
      args.estimateMicros,
      now,
    );
    return {
      ok: true,
      reservationId: args.reservationId,
      codeId: code.id,
      label: code.label,
      scansLeftToday: Math.max(0, code.daily_limit - codeScans - 1),
      expiresAt: code.expires_at,
    };
  }

  /**
   * Replaces a reservation with the actual cost. `refundScan` gives the scan back to the
   * tester's daily allowance (used when the AI call failed without producing anything).
   */
  finishScan(args: { reservationId: string; actualMicros: number; refundScan: boolean }): void {
    const r = this.rows<{ code_id: string; day: string; month: string; estimate_micros: number }>(
        'SELECT code_id, day, month, estimate_micros FROM reservations WHERE id = ?',
        args.reservationId,
      )[0];
    if (!r) return; // Already settled (or charged in full by housekeeping).
    this.adjustSpend(r.month, Math.max(0, Math.ceil(args.actualMicros)), -r.estimate_micros);
    if (args.refundScan) {
      this.addScans(r.day, r.code_id, -1);
      this.addScans(r.day, '*', -1);
    }
    this.sql.exec('DELETE FROM reservations WHERE id = ?', args.reservationId);
  }

  status(args: { codeHash: string | null; clientKey: string; now: number }): StatusResult {
    const auth = this.authenticate(args.codeHash, args.clientKey, args.now);
    if (!auth.ok) return auth;
    const used = this.scansOn(dayKey(args.now), auth.code.id);
    return {
      ok: true,
      codeId: auth.code.id,
      label: auth.code.label,
      dailyLimit: auth.code.daily_limit,
      scansLeftToday: Math.max(0, auth.code.daily_limit - used),
      expiresAt: auth.code.expires_at,
    };
  }

  usage(now: number, limits: Limits) {
    const { spent, reserved } = this.spend(monthKey(now));
    return {
      day: dayKey(now),
      scansToday: this.scansOn(dayKey(now), '*'),
      dailyGlobalLimit: limits.dailyGlobal,
      month: monthKey(now),
      spentMicros: spent,
      reservedMicros: reserved,
      monthlyBudgetMicros: limits.monthlyBudgetMicros,
    };
  }
}
