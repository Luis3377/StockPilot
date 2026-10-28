// Validates and normalises data coming from outside the app's own code paths: backup files,
// and records read back from storage (which could be from an older version or hand-edited).

import { DomainError } from '../domain/errors';
import { isValidISODate } from '../domain/dates';
import {
  defaultSettings,
  type Adjustment,
  type AdjustmentSource,
  type AppData,
  type CountDraft,
  type CountLine,
  type CountRecord,
  type Item,
  type Sale,
  type Settings,
  type ValueSnapshot,
} from '../domain/types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function fail(where: string, problem: string): never {
  throw new DomainError(`${where}: ${problem}`);
}

function str(o: Obj, key: string, where: string, required = false): string {
  const v = o[key];
  if (v === undefined || v === null) {
    if (required) fail(where, `missing "${key}"`);
    return '';
  }
  if (typeof v !== 'string') fail(where, `"${key}" must be text`);
  return v;
}

function num(o: Obj, key: string, where: string, opts: { integer?: boolean; min?: number } = {}): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(where, `"${key}" must be a number`);
  if (opts.integer && !Number.isInteger(v)) fail(where, `"${key}" must be a whole number`);
  if (opts.min !== undefined && v < opts.min) fail(where, `"${key}" can't be below ${opts.min}`);
  return v;
}

function optNum(o: Obj, key: string, where: string, opts: { integer?: boolean; min?: number } = {}): number | null {
  return o[key] === null || o[key] === undefined ? null : num(o, key, where, opts);
}

function date(o: Obj, key: string, where: string): string {
  const v = str(o, key, where, true);
  if (!isValidISODate(v)) fail(where, `"${key}" must be a YYYY-MM-DD date`);
  return v;
}

function optDate(o: Obj, key: string, where: string): string | null {
  return o[key] === null || o[key] === undefined || o[key] === '' ? null : date(o, key, where);
}

function arr(o: Obj, key: string, where: string): unknown[] {
  const v = o[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) fail(where, `"${key}" must be a list`);
  return v;
}

function sanitizeItem(raw: unknown, n: number): Item {
  const where = `Item ${n}`;
  if (!isObj(raw)) fail(where, 'is not an object');
  const valueHistory = arr(raw, 'valueHistory', where)
    .filter(isObj)
    .filter((p) => typeof p.date === 'string' && isValidISODate(p.date) && typeof p.value === 'number' && Number.isFinite(p.value))
    .map((p) => ({ date: p.date as string, value: p.value as number }));
  return {
    id: str(raw, 'id', where, true),
    name: str(raw, 'name', where, true),
    sku: str(raw, 'sku', where),
    category: str(raw, 'category', where),
    quantity: num(raw, 'quantity', where, { integer: true, min: 0 }),
    unitCost: num(raw, 'unitCost', where, { min: 0 }),
    askingPrice: optNum(raw, 'askingPrice', where, { min: 0 }),
    estimatedValue: optNum(raw, 'estimatedValue', where, { min: 0 }),
    purchaseDate: optDate(raw, 'purchaseDate', where),
    condition: str(raw, 'condition', where),
    location: str(raw, 'location', where),
    lowStockThreshold: optNum(raw, 'lowStockThreshold', where, { integer: true, min: 0 }),
    photoIds: arr(raw, 'photoIds', where).filter((p): p is string => typeof p === 'string'),
    notes: str(raw, 'notes', where),
    valueHistory,
    createdAt: str(raw, 'createdAt', where) || new Date().toISOString(),
    updatedAt: str(raw, 'updatedAt', where) || new Date().toISOString(),
  };
}

function sanitizeSale(raw: unknown, n: number): Sale {
  const where = `Sale ${n}`;
  if (!isObj(raw)) fail(where, 'is not an object');
  const priceMode = raw.priceMode === 'total' ? 'total' : 'per_unit';
  return {
    id: str(raw, 'id', where, true),
    itemId: str(raw, 'itemId', where, true),
    itemName: str(raw, 'itemName', where, true),
    itemSku: str(raw, 'itemSku', where),
    itemCategory: str(raw, 'itemCategory', where),
    quantity: num(raw, 'quantity', where, { integer: true, min: 1 }),
    salePrice: num(raw, 'salePrice', where, { min: 0 }),
    priceMode,
    unitCost: num(raw, 'unitCost', where, { min: 0 }),
    platform: str(raw, 'platform', where),
    fees: num(raw, 'fees', where, { min: 0 }),
    shipping: num(raw, 'shipping', where, { min: 0 }),
    otherExpenses: num(raw, 'otherExpenses', where, { min: 0 }),
    saleDate: date(raw, 'saleDate', where),
    notes: str(raw, 'notes', where),
    createdAt: str(raw, 'createdAt', where) || new Date().toISOString(),
    updatedAt: str(raw, 'updatedAt', where) || new Date().toISOString(),
  };
}

const SOURCES: AdjustmentSource[] = ['count_check', 'manual', 'edit', 'restock', 'import'];

function sanitizeAdjustment(raw: unknown, n: number): Adjustment {
  const where = `Adjustment ${n}`;
  if (!isObj(raw)) fail(where, 'is not an object');
  const source = SOURCES.includes(raw.source as AdjustmentSource) ? (raw.source as AdjustmentSource) : 'manual';
  return {
    id: str(raw, 'id', where, true),
    itemId: str(raw, 'itemId', where),
    itemName: str(raw, 'itemName', where),
    itemSku: str(raw, 'itemSku', where),
    previousQuantity: num(raw, 'previousQuantity', where, { integer: true }),
    newQuantity: num(raw, 'newQuantity', where, { integer: true }),
    difference: num(raw, 'difference', where, { integer: true }),
    unitCost: num(raw, 'unitCost', where),
    valueDifference: num(raw, 'valueDifference', where),
    reason: str(raw, 'reason', where),
    source,
    countId: typeof raw.countId === 'string' ? raw.countId : null,
    date: str(raw, 'date', where, true),
  };
}

function sanitizeScope(raw: unknown) {
  const o = isObj(raw) ? raw : {};
  return {
    category: typeof o.category === 'string' ? o.category : null,
    location: typeof o.location === 'string' ? o.location : null,
  };
}

function sanitizeCountLine(raw: unknown, where: string): CountLine {
  if (!isObj(raw)) fail(where, 'has an invalid line');
  const status = raw.status === 'missing' || raw.status === 'excess' ? raw.status : 'match';
  return {
    itemId: str(raw, 'itemId', where),
    itemName: str(raw, 'itemName', where),
    itemSku: str(raw, 'itemSku', where),
    recordedQuantity: num(raw, 'recordedQuantity', where, { integer: true }),
    countedQuantity: num(raw, 'countedQuantity', where, { integer: true }),
    difference: num(raw, 'difference', where, { integer: true }),
    unitCost: num(raw, 'unitCost', where),
    valueDifference: num(raw, 'valueDifference', where),
    status,
    applied: raw.applied === true,
    reason: str(raw, 'reason', where),
  };
}

function sanitizeCountRecord(raw: unknown, n: number): CountRecord {
  const where = `Count ${n}`;
  if (!isObj(raw)) fail(where, 'is not an object');
  return {
    id: str(raw, 'id', where, true),
    startedAt: str(raw, 'startedAt', where, true),
    completedAt: str(raw, 'completedAt', where, true),
    scope: sanitizeScope(raw.scope),
    lines: arr(raw, 'lines', where).map((l) => sanitizeCountLine(l, where)),
  };
}

function sanitizeDraft(raw: unknown): CountDraft | null {
  if (!isObj(raw)) return null;
  const counts: Record<string, number> = {};
  if (isObj(raw.counts)) {
    for (const [k, v] of Object.entries(raw.counts)) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0) counts[k] = v;
    }
  }
  if (typeof raw.id !== 'string' || typeof raw.startedAt !== 'string') return null;
  return { id: raw.id, startedAt: raw.startedAt, scope: sanitizeScope(raw.scope), counts };
}

function sanitizeSnapshot(raw: unknown): ValueSnapshot | null {
  if (!isObj(raw)) return null;
  const { date: d, units, cost, value } = raw;
  if (typeof d !== 'string' || !isValidISODate(d)) return null;
  if (![units, cost, value].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return { date: d, units: units as number, cost: cost as number, value: value as number };
}

export function sanitizeAppData(raw: unknown): AppData {
  if (!isObj(raw)) throw new DomainError('The data is not in the expected format.');
  const items = arr(raw, 'items', 'Data').map((r, i) => sanitizeItem(r, i + 1));
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new DomainError(`Item "${item.name}" appears twice.`);
    ids.add(item.id);
  }
  return {
    schemaVersion: 1,
    items,
    sales: arr(raw, 'sales', 'Data').map((r, i) => sanitizeSale(r, i + 1)),
    adjustments: arr(raw, 'adjustments', 'Data').map((r, i) => sanitizeAdjustment(r, i + 1)),
    countDraft: sanitizeDraft(raw.countDraft),
    countHistory: arr(raw, 'countHistory', 'Data').map((r, i) => sanitizeCountRecord(r, i + 1)),
    snapshots: arr(raw, 'snapshots', 'Data')
      .map(sanitizeSnapshot)
      .filter((s): s is ValueSnapshot => s !== null),
  };
}

/** Merges stored settings over defaults, ignoring unknown or mistyped values. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = defaultSettings();
  if (!isObj(raw)) return d;
  const pick = <K extends keyof Settings>(key: K, ok: (v: unknown) => boolean): Settings[K] =>
    ok(raw[key]) ? (raw[key] as Settings[K]) : d[key];
  const nonNegNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  return {
    onboarded: pick('onboarded', (v) => typeof v === 'boolean'),
    mode: pick('mode', (v) => v === 'reseller' || v === 'collector' || v === 'business'),
    theme: pick('theme', (v) => v === 'system' || v === 'light' || v === 'dark'),
    currency: pick('currency', (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v)),
    defaultLowStockThreshold: pick('defaultLowStockThreshold', (v) => v === null || (nonNegNum(v) && Number.isInteger(v))),
    slowMovingDays: pick('slowMovingDays', (v) => nonNegNum(v) && Number.isInteger(v) && (v as number) >= 1),
    lowMarginPercent: pick('lowMarginPercent', (v) => typeof v === 'number' && Number.isFinite(v)),
    sellingCostPercent: pick('sellingCostPercent', (v) => v === null || (nonNegNum(v) && (v as number) < 100)),
    collectorSalesEnabled: pick('collectorSalesEnabled', (v) => typeof v === 'boolean'),
    demoActive: pick('demoActive', (v) => typeof v === 'boolean'),
    lastBackupAt: pick('lastBackupAt', (v) => v === null || typeof v === 'string'),
    inventoryView: pick('inventoryView', (v) => v === 'grid' || v === 'list'),
  };
}
