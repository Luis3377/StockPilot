// Importing marketplace reports, independent of any one marketplace. Each marketplace provides
// a ReportAdapter that turns CSV rows into normalised transactions and payouts; this module
// previews an import (nothing is saved), recognises files and rows seen before, and saves only
// what the user confirms. Imports never create, change or replace StockPilot sales.

import { parseCsvLines } from '../csv/csv';
import { DomainError } from '../domain/errors';
import { newId } from '../domain/ids';
import { toCents } from '../domain/money';
import { nowParts, type Clock } from '../domain/actions';
import type {
  AppData,
  MarketplaceId,
  MarketplaceImport,
  MarketplacePayout,
  MarketplaceReportFormat,
  MarketplaceTxn,
} from '../domain/types';
import { ebayAdapter } from './ebay';

export type ParsedTxn = Omit<MarketplaceTxn, 'id' | 'importIds'>;
export type ParsedPayout = Omit<MarketplacePayout, 'id' | 'importIds'>;

export interface RowIssue {
  /** Line number in the file (1-based, counting any title lines). */
  rowNumber: number;
  messages: string[];
}

export interface ParsedReport {
  marketplace: MarketplaceId;
  format: MarketplaceReportFormat;
  formatLabel: string;
  transactions: ParsedTxn[];
  payouts: ParsedPayout[];
  periodStart: string | null;
  periodEnd: string | null;
  warnings: string[];
  rowErrors: RowIssue[];
  columnsFound: string[];
}

export type ParseOutcome =
  | { ok: true; report: ParsedReport }
  | { ok: false; formatLabel: string; problem: string; missing: string[]; found: string[] };

export interface ReportFormatInfo {
  id: MarketplaceReportFormat;
  label: string;
  /** Where to download it. */
  where: string;
}

/** One marketplace's report reader. Adding a marketplace means adding an adapter here. */
export interface ReportAdapter {
  marketplace: MarketplaceId;
  label: string;
  formats: ReportFormatInfo[];
  /** null when the file isn't one of this marketplace's reports. `lines[i]` is the file line of `rows[i]`. */
  parse(rows: string[][], lines: number[]): ParseOutcome | null;
}

export const REPORT_ADAPTERS: ReportAdapter[] = [ebayAdapter];

export const MARKETPLACE_LABELS: Record<MarketplaceId, string> = { ebay: 'eBay' };

/** A fingerprint of the file's text (two 32-bit FNV-1a hashes), to spot the same file imported twice. */
export function fingerprint(text: string): string {
  const t = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ t.length;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export interface TxnUpdate {
  existing: MarketplaceTxn;
  next: ParsedTxn;
  /** e.g. "payout ID", "payout status". */
  changes: string[];
}

export interface PayoutUpdate {
  existing: MarketplacePayout;
  next: ParsedPayout;
  changes: string[];
}

export interface ImportPreview {
  fileName: string;
  fingerprint: string;
  /** Problems that stop the import (unsupported file, missing columns, unreadable rows). */
  error: { problem: string; missing: string[]; found: string[]; supported: string[] } | null;
  report: ParsedReport | null;
  /** This exact file was imported before. */
  duplicateOf: MarketplaceImport | null;
  newTxns: ParsedTxn[];
  updatedTxns: TxnUpdate[];
  unchangedTxns: number;
  /** Rows already imported whose amounts now differ: the first-imported amounts are kept. */
  conflictingTxns: number;
  newPayouts: ParsedPayout[];
  updatedPayouts: PayoutUpdate[];
  unchangedPayouts: number;
}

export const SUPPORTED_REPORTS = REPORT_ADAPTERS.flatMap((a) => a.formats.map((f) => `${a.label} ${f.label.toLowerCase()} (${f.where})`));

function txnChanges(existing: MarketplaceTxn, next: ParsedTxn): string[] {
  const changes: string[] = [];
  if (next.payoutId && next.payoutId !== existing.payoutId) changes.push('payout ID');
  if (next.payoutDate && next.payoutDate !== existing.payoutDate) changes.push('payout date');
  if (next.payoutStatus && next.payoutStatus !== existing.payoutStatus) changes.push('payout status');
  if (next.holdReason !== existing.holdReason && (next.holdReason || existing.holdReason)) changes.push('hold reason');
  return changes;
}

function payoutChanges(existing: MarketplacePayout, next: ParsedPayout): string[] {
  const changes: string[] = [];
  if (next.amount !== null && (existing.amount === null || toCents(existing.amount) !== toCents(next.amount))) changes.push('amount');
  if (next.status && next.status !== existing.status) changes.push('status');
  if (next.date && next.date !== existing.date) changes.push('date');
  return changes;
}

/** Reads a report and works out what importing it would do. Saves nothing. */
export function previewImport(text: string, fileName: string, data: AppData): ImportPreview {
  const base: ImportPreview = {
    fileName,
    fingerprint: fingerprint(text),
    error: null,
    report: null,
    duplicateOf: null,
    newTxns: [],
    updatedTxns: [],
    unchangedTxns: 0,
    conflictingTxns: 0,
    newPayouts: [],
    updatedPayouts: [],
    unchangedPayouts: 0,
  };
  const parsed = parseCsvLines(text);
  const rows = parsed.map((r) => r.cells);
  const lines = parsed.map((r) => r.line);
  if (rows.length === 0) return { ...base, error: { problem: 'The file is empty.', missing: [], found: [], supported: SUPPORTED_REPORTS } };
  let outcome: ParseOutcome | null = null;
  for (const adapter of REPORT_ADAPTERS) {
    outcome = adapter.parse(rows, lines);
    if (outcome) break;
  }
  if (!outcome) {
    return {
      ...base,
      error: {
        problem: 'StockPilot doesn’t recognise this file. It needs an eBay transaction report or payout report, downloaded as CSV from Seller Hub.',
        missing: [],
        found: rows[0].map((c) => c.trim()).filter(Boolean).slice(0, 12),
        supported: SUPPORTED_REPORTS,
      },
    };
  }
  if (!outcome.ok) return { ...base, error: { problem: outcome.problem, missing: outcome.missing, found: outcome.found, supported: SUPPORTED_REPORTS } };
  const report = outcome.report;
  const preview: ImportPreview = { ...base, report, duplicateOf: data.marketplace.imports.find((i) => i.fingerprint === base.fingerprint) ?? null };
  if (report.rowErrors.length) {
    const n = report.rowErrors.length;
    preview.error = {
      problem: `${n} row${n === 1 ? '' : 's'} couldn’t be read, so nothing will be imported (a partial report would make payouts look wrong).`,
      missing: [],
      found: [],
      supported: SUPPORTED_REPORTS,
    };
  }
  const txnByKey = new Map(data.marketplace.transactions.map((t) => [t.key, t]));
  for (const t of report.transactions) {
    const existing = txnByKey.get(t.key);
    if (!existing) preview.newTxns.push(t);
    else {
      if (toCents(existing.net) !== toCents(t.net)) preview.conflictingTxns++;
      const changes = txnChanges(existing, t);
      if (changes.length) preview.updatedTxns.push({ existing, next: t, changes });
      else preview.unchangedTxns++;
    }
  }
  const payoutByKey = new Map(data.marketplace.payouts.map((p) => [p.key, p]));
  for (const p of report.payouts) {
    const existing = payoutByKey.get(p.key);
    if (!existing) preview.newPayouts.push(p);
    else {
      const changes = payoutChanges(existing, p);
      if (changes.length) preview.updatedPayouts.push({ existing, next: p, changes });
      else preview.unchangedPayouts++;
    }
  }
  return preview;
}

export function importableCount(p: ImportPreview): number {
  return p.newTxns.length + p.updatedTxns.length + p.newPayouts.length + p.updatedPayouts.length;
}

/**
 * Saves a previewed import. New rows are added; rows seen before only get their payout details
 * filled in (amounts and original references are never overwritten). Sales are not touched.
 */
export function applyImport(data: AppData, preview: ImportPreview, clock?: Clock): { data: AppData; record: MarketplaceImport } {
  const { iso } = nowParts(clock);
  if (preview.error || !preview.report) throw new DomainError(preview.error?.problem ?? 'Nothing to import.');
  if (preview.duplicateOf) throw new DomainError(`This file was already imported on ${preview.duplicateOf.importedAt.slice(0, 10)}.`);
  if (importableCount(preview) === 0) throw new DomainError('Everything in this file is already imported.');
  const report = preview.report;
  const id = newId();
  const updatedTxns = new Map(preview.updatedTxns.map((u) => [u.existing.id, u.next]));
  const transactions = data.marketplace.transactions.map((t) => {
    const next = updatedTxns.get(t.id);
    if (!next) return t;
    return {
      ...t,
      payoutId: next.payoutId || t.payoutId,
      payoutDate: next.payoutDate ?? t.payoutDate,
      payoutStatus: next.payoutStatus || t.payoutStatus,
      holdReason: next.holdReason,
      importIds: [...t.importIds, id],
    };
  });
  const updatedPayouts = new Map(preview.updatedPayouts.map((u) => [u.existing.id, u.next]));
  const payouts = data.marketplace.payouts.map((p) => {
    const next = updatedPayouts.get(p.id);
    if (!next) return p;
    return { ...p, amount: next.amount ?? p.amount, status: next.status || p.status, date: next.date ?? p.date, importIds: [...p.importIds, id] };
  });
  const record: MarketplaceImport = {
    id,
    marketplace: report.marketplace,
    format: report.format,
    fileName: preview.fileName,
    fingerprint: preview.fingerprint,
    importedAt: iso,
    added: preview.newTxns.length + preview.newPayouts.length,
    updated: preview.updatedTxns.length + preview.updatedPayouts.length,
    unchanged: preview.unchangedTxns + preview.unchangedPayouts,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
  };
  const marketplace = {
    ...data.marketplace,
    imports: [...data.marketplace.imports, record],
    transactions: [...transactions, ...preview.newTxns.map((t) => ({ ...t, id: newId(), importIds: [id] }))],
    payouts: [...payouts, ...preview.newPayouts.map((p) => ({ ...p, id: newId(), importIds: [id] }))],
    log: [
      ...data.marketplace.log,
      {
        id: newId(),
        date: iso,
        action: 'import' as const,
        summary: `Imported ${report.formatLabel} “${preview.fileName}”: ${record.added} new, ${record.updated} updated, ${record.unchanged} already imported.`,
        refs: [id],
      },
    ],
  };
  return { data: { ...data, marketplace }, record };
}
