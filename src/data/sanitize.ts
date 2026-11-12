// Validates and normalises data coming from outside the app's own code paths: backup files,
// and records read back from storage (which could be from an older version or hand-edited).

import { DomainError } from '../domain/errors';
import { isValidISODate } from '../domain/dates';
import { newId } from '../domain/ids';
import {
  defaultSettings,
  emptyMarketplace,
  type Adjustment,
  type AdjustmentSource,
  type AppData,
  type BidAdjustment,
  emptySourcing,
  type RunningTimer,
  type Source,
  type SourceChange,
  type SourceType,
  type SourcingData,
  type SourcingSession,
  type TimeActivity,
  type TimeEntry,
  type TimeLink,
  type BidAssumptions,
  type BidItem,
  type BidLotKind,
  type BidPlan,
  type BidPlanStatus,
  type BidPurchase,
  type BidScenarioKey,
  type BidScenarioSnapshot,
  type BidSnapshot,
  type BidStatusChange,
  type CountDraft,
  type CountLine,
  type CountRecord,
  type Item,
  type Lot,
  type LotChange,
  type LotExtraCost,
  type LotLine,
  type LotLineChange,
  type MarketplaceData,
  type MarketplaceImport,
  type MarketplacePayout,
  type MarketplaceTxn,
  type MarketplaceTxnKind,
  type ReconciliationEvent,
  type ReconciliationReview,
  type Sale,
  type SaleMatch,
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
    // Items from before sourcing tracking have no source or trip.
    ...(typeof raw.sourceId === 'string' && raw.sourceId ? { sourceId: raw.sourceId } : {}),
    ...(typeof raw.sessionId === 'string' && raw.sessionId ? { sessionId: raw.sessionId } : {}),
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
    // Sales saved before order numbers existed have none.
    orderNumber: str(raw, 'orderNumber', where),
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

function quantityMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (isObj(raw)) {
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out[k] = v;
    }
  }
  return out;
}

function sanitizeDraft(raw: unknown): CountDraft | null {
  if (!isObj(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.startedAt !== 'string') return null;
  return {
    id: raw.id,
    startedAt: raw.startedAt,
    scope: sanitizeScope(raw.scope),
    counts: quantityMap(raw.counts),
    // Drafts saved before stock-change tracking have no snapshot; they just aren't flagged.
    recordedAtCount: quantityMap(raw.recordedAtCount),
  };
}

function sanitizeSnapshot(raw: unknown): ValueSnapshot | null {
  if (!isObj(raw)) return null;
  const { date: d, units, cost, value } = raw;
  if (typeof d !== 'string' || !isValidISODate(d)) return null;
  if (![units, cost, value].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return { date: d, units: units as number, cost: cost as number, value: value as number };
}

const isMethod = (v: unknown) => v === 'relative_value' || v === 'equal';

function sanitizeExtraCost(raw: unknown, where: string): LotExtraCost {
  if (!isObj(raw)) fail(where, 'has an invalid extra cost');
  return { id: str(raw, 'id', where) || newId(), label: str(raw, 'label', where), amount: num(raw, 'amount', where, { min: 0 }) };
}

function sanitizeLotLine(raw: unknown, where: string): LotLine {
  if (!isObj(raw)) fail(where, 'has an invalid item line');
  return {
    id: str(raw, 'id', where) || newId(),
    itemId: str(raw, 'itemId', where, true),
    itemName: str(raw, 'itemName', where),
    quantity: num(raw, 'quantity', where, { integer: true, min: 1 }),
    estimatedUnitValue: optNum(raw, 'estimatedUnitValue', where, { min: 0 }),
    estimateSource: 'user',
    allocatedCost: num(raw, 'allocatedCost', where),
  };
}

function sanitizeLotLineChange(raw: unknown): LotLineChange | null {
  if (!isObj(raw)) return null;
  const n = (k: string) => (typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k] as number) : 0);
  const optN = (k: string) => (typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k] as number) : null);
  const s = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '');
  return {
    lineId: s('lineId'),
    itemId: s('itemId'),
    itemName: s('itemName'),
    unitsAffected: n('unitsAffected'),
    previousUnitCost: n('previousUnitCost'),
    newUnitCost: n('newUnitCost'),
    previousRemainingCost: n('previousRemainingCost'),
    newRemainingCost: n('newRemainingCost'),
    previousEstimate: optN('previousEstimate'),
    newEstimate: optN('newEstimate'),
  };
}

/** History is informational: entries that can't be read are dropped rather than failing a restore. */
function sanitizeLotChange(raw: unknown): LotChange | null {
  if (!isObj(raw) || typeof raw.date !== 'string') return null;
  const kind = raw.kind === 'costs' || raw.kind === 'details' ? raw.kind : 'created';
  const n = (k: string) => (typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k] as number) : 0);
  return {
    id: typeof raw.id === 'string' ? raw.id : newId(),
    date: raw.date,
    kind,
    changedFields: Array.isArray(raw.changedFields) ? raw.changedFields.filter((f): f is string => typeof f === 'string') : [],
    note: typeof raw.note === 'string' ? raw.note : '',
    previousTotal: n('previousTotal'),
    newTotal: n('newTotal'),
    previousMethod: isMethod(raw.previousMethod) ? (raw.previousMethod as LotChange['previousMethod']) : 'relative_value',
    newMethod: isMethod(raw.newMethod) ? (raw.newMethod as LotChange['newMethod']) : 'relative_value',
    lockedCost: n('lockedCost'),
    lines: (Array.isArray(raw.lines) ? raw.lines : []).map(sanitizeLotLineChange).filter((l): l is LotLineChange => l !== null),
  };
}

function sanitizeLot(raw: unknown, n: number): Lot {
  const where = `Lot ${n}`;
  if (!isObj(raw)) fail(where, 'is not an object');
  const lines = arr(raw, 'lines', where).map((l) => sanitizeLotLine(l, where));
  if (lines.length === 0) fail(where, 'has no items');
  return {
    id: str(raw, 'id', where, true),
    name: str(raw, 'name', where, true),
    purchasePrice: num(raw, 'purchasePrice', where, { min: 0 }),
    extraCosts: arr(raw, 'extraCosts', where).map((c) => sanitizeExtraCost(c, where)),
    purchaseDate: optDate(raw, 'purchaseDate', where),
    source: str(raw, 'source', where),
    notes: str(raw, 'notes', where),
    method: raw.method === 'equal' ? 'equal' : 'relative_value',
    lines,
    history: arr(raw, 'history', where)
      .map(sanitizeLotChange)
      .filter((c): c is LotChange => c !== null),
    // Lots from before performance tracking have no closure: they're open.
    ...(isObj(raw.closure) && typeof raw.closure.at === 'string'
      ? {
          closure: {
            at: raw.closure.at,
            note: typeof raw.closure.note === 'string' ? raw.closure.note.slice(0, 500) : '',
            unitsOnHand: typeof raw.closure.unitsOnHand === 'number' && Number.isInteger(raw.closure.unitsOnHand) && raw.closure.unitsOnHand >= 0 ? raw.closure.unitsOnHand : 0,
            remainingCost: typeof raw.closure.remainingCost === 'number' && Number.isFinite(raw.closure.remainingCost) && raw.closure.remainingCost >= 0 ? raw.closure.remainingCost : 0,
          },
        }
      : {}),
    ...(typeof raw.sourceId === 'string' && raw.sourceId ? { sourceId: raw.sourceId } : {}),
    ...(typeof raw.sessionId === 'string' && raw.sessionId ? { sessionId: raw.sessionId } : {}),
    createdAt: str(raw, 'createdAt', where) || new Date().toISOString(),
    updatedAt: str(raw, 'updatedAt', where) || new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Max bid plans: planning data. A plan must have an id and a name; any assumption that can't be
// read loads as empty (to be re-entered) rather than failing the restore.
// ---------------------------------------------------------------------------

const BID_STATUSES: BidPlanStatus[] = ['draft', 'purchased', 'passed', 'lost'];
const BID_KINDS: BidLotKind[] = ['storage_unit', 'pallet', 'estate_sale', 'garage_sale', 'collectibles', 'retail_lot', 'other'];
const BID_SCENARIOS: BidScenarioKey[] = ['conservative', 'expected', 'optimistic'];
const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const signedOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const text = (v: unknown, max = 5000) => (typeof v === 'string' ? v.slice(0, max) : '');

function sanitizeBidItem(raw: unknown): BidItem | null {
  if (!isObj(raw) || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const q = raw.quantity;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    name: text(raw.name, 200),
    quantity: typeof q === 'number' && Number.isInteger(q) && q >= 1 ? q : 1,
    unitValue: finiteOrNull(raw.unitValue),
    category: text(raw.category, 80),
    condition: text(raw.condition, 80),
    notes: text(raw.notes, 2000),
    aiFields: strArr(raw.aiFields).filter((f) => ['name', 'category', 'condition', 'notes'].includes(f)),
  };
}

function sanitizeBidAssumptions(raw: unknown): BidAssumptions {
  const o = isObj(raw) ? raw : {};
  const sc = isObj(o.scenarios) ? o.scenarios : {};
  return {
    valueMode: o.valueMode === 'items' ? 'items' : 'total',
    totalResaleValue: finiteOrNull(o.totalResaleValue),
    itemCount: typeof o.itemCount === 'number' && Number.isInteger(o.itemCount) && o.itemCount >= 1 ? o.itemCount : null,
    items: (Array.isArray(o.items) ? o.items : []).map(sanitizeBidItem).filter((i): i is BidItem => i !== null),
    shippingMode: o.shippingMode === 'percent' ? 'percent' : 'per_item',
    shippingValue: finiteOrNull(o.shippingValue),
    fixedCosts: (Array.isArray(o.fixedCosts) ? o.fixedCosts : []).filter(isObj).map((c) => ({ id: typeof c.id === 'string' && c.id ? c.id : newId(), label: text(c.label, 80), amount: finiteOrNull(c.amount) })),
    buyerPremiumPct: finiteOrNull(o.buyerPremiumPct),
    salesTaxPct: finiteOrNull(o.salesTaxPct),
    taxOnPremium: o.taxOnPremium !== false,
    targetRoiPct: finiteOrNull(o.targetRoiPct),
    budget: finiteOrNull(o.budget),
    plannedBid: finiteOrNull(o.plannedBid),
    scenarios: Object.fromEntries(
      BID_SCENARIOS.map((k) => {
        const s = isObj(sc[k]) ? (sc[k] as Obj) : {};
        return [k, { resalePct: finiteOrNull(s.resalePct), unsoldPct: finiteOrNull(s.unsoldPct), sellingFeePct: finiteOrNull(s.sellingFeePct) }];
      }),
    ) as BidAssumptions['scenarios'],
  };
}

function sanitizeBidSnapshot(raw: unknown): BidSnapshot | null {
  if (!isObj(raw) || typeof raw.takenAt !== 'string') return null;
  const results = isObj(raw.results) ? raw.results : {};
  return {
    takenAt: raw.takenAt,
    assumptions: sanitizeBidAssumptions(raw.assumptions),
    results: Object.fromEntries(
      BID_SCENARIOS.map((k) => {
        const r = results[k];
        if (!isObj(r)) return [k, null];
        const n = (key: string) => signedOrNull(r[key]) ?? 0;
        const snap: BidScenarioSnapshot = {
          maxBid: finiteOrNull(r.maxBid),
          maxAllIn: n('maxAllIn'),
          expectedSales: n('expectedSales'),
          sellingFees: n('sellingFees'),
          shipping: n('shipping'),
          netProceeds: n('netProceeds'),
          allInAtMaxBid: finiteOrNull(r.allInAtMaxBid),
          profitAtMaxBid: signedOrNull(r.profitAtMaxBid),
          roiAtMaxBidPct: signedOrNull(r.roiAtMaxBidPct),
        };
        return [k, snap];
      }),
    ) as BidSnapshot['results'],
    recommendedBid: finiteOrNull(raw.recommendedBid),
  };
}

function sanitizeBidPurchase(raw: unknown): BidPurchase | null {
  if (!isObj(raw) || typeof raw.lotId !== 'string' || !raw.lotId) return null;
  return {
    lotId: raw.lotId,
    lotName: text(raw.lotName, 120),
    how: raw.how === 'linked' ? 'linked' : 'created',
    recordedAt: text(raw.recordedAt, 40),
    purchaseDate: typeof raw.purchaseDate === 'string' && isValidISODate(raw.purchaseDate) ? raw.purchaseDate : null,
    pricePaid: finiteOrNull(raw.pricePaid) ?? 0,
    additionalCosts: finiteOrNull(raw.additionalCosts) ?? 0,
    itemLinks: (Array.isArray(raw.itemLinks) ? raw.itemLinks : [])
      .filter(isObj)
      .filter((l) => typeof l.bidItemId === 'string' && typeof l.itemId === 'string')
      .map((l) => ({ bidItemId: l.bidItemId as string, itemId: l.itemId as string })),
  };
}

function sanitizeBidPlan(raw: unknown, n: number): BidPlan {
  const where = `Bid plan ${n}`;
  if (!isObj(raw)) fail(where, 'is not an object');
  const status = BID_STATUSES.includes(raw.status as BidPlanStatus) ? (raw.status as BidPlanStatus) : 'draft';
  const purchase = sanitizeBidPurchase(raw.purchase);
  return {
    id: str(raw, 'id', where, true),
    name: str(raw, 'name', where, true),
    description: text(raw.description, 2000),
    kind: BID_KINDS.includes(raw.kind as BidLotKind) ? (raw.kind as BidLotKind) : 'other',
    // "Purchased" always comes with its purchase record.
    status: status === 'purchased' && !purchase ? 'draft' : status,
    assumptions: sanitizeBidAssumptions(raw.assumptions),
    snapshot: sanitizeBidSnapshot(raw.snapshot),
    purchase,
    history: (Array.isArray(raw.history) ? raw.history : [])
      .filter(isObj)
      .filter((h) => typeof h.at === 'string' && BID_STATUSES.includes(h.from as BidPlanStatus) && BID_STATUSES.includes(h.to as BidPlanStatus))
      .map((h): BidStatusChange => ({ id: typeof h.id === 'string' ? h.id : newId(), at: h.at as string, from: h.from as BidPlanStatus, to: h.to as BidPlanStatus, note: text(h.note, 500) })),
    adjustments: (Array.isArray(raw.adjustments) ? raw.adjustments : [])
      .filter(isObj)
      .filter((a) => typeof a.at === 'string')
      .map((a): BidAdjustment => {
        const inputs = (v: unknown) => {
          const o = isObj(v) ? v : {};
          return { resalePct: finiteOrNull(o.resalePct), unsoldPct: finiteOrNull(o.unsoldPct), sellingFeePct: finiteOrNull(o.sellingFeePct) };
        };
        return {
          id: typeof a.id === 'string' && a.id ? a.id : newId(),
          at: a.at as string,
          basis: text(a.basis, 200),
          sampleSize: typeof a.sampleSize === 'number' && Number.isInteger(a.sampleSize) && a.sampleSize >= 0 ? a.sampleSize : 0,
          lotIds: strArr(a.lotIds),
          before: inputs(a.before),
          after: inputs(a.after),
        };
      }),
    duplicatedFromId: typeof raw.duplicatedFromId === 'string' ? raw.duplicatedFromId : null,
    createdAt: str(raw, 'createdAt', where) || new Date().toISOString(),
    updatedAt: str(raw, 'updatedAt', where) || new Date().toISOString(),
  };
}

const TXN_KINDS: MarketplaceTxnKind[] = ['sale', 'refund', 'shipping_label', 'fee', 'claim', 'dispute', 'hold', 'charge', 'adjustment', 'credit', 'payout', 'other'];
const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function sanitizeTxn(raw: unknown, n: number): MarketplaceTxn {
  const where = `Marketplace transaction ${n}`;
  if (!isObj(raw)) fail(where, 'is not an object');
  const kind = raw.kind as MarketplaceTxnKind;
  if (!TXN_KINDS.includes(kind)) fail(where, `has an unknown kind "${String(raw.kind)}"`);
  const fees = arr(raw, 'feeBreakdown', where)
    .filter(isObj)
    .filter((f) => typeof f.label === 'string' && typeof f.amount === 'number' && Number.isFinite(f.amount))
    .map((f) => ({ label: f.label as string, amount: f.amount as number }));
  return {
    id: str(raw, 'id', where, true),
    marketplace: 'ebay',
    key: str(raw, 'key', where, true),
    importIds: strArr(raw.importIds),
    sourceRow: typeof raw.sourceRow === 'number' ? raw.sourceRow : 0,
    kind,
    rawType: str(raw, 'rawType', where),
    date: date(raw, 'date', where),
    orderNumber: str(raw, 'orderNumber', where),
    legacyOrderId: str(raw, 'legacyOrderId', where),
    transactionRef: str(raw, 'transactionRef', where),
    referenceId: str(raw, 'referenceId', where),
    itemId: str(raw, 'itemId', where),
    title: str(raw, 'title', where),
    customLabel: str(raw, 'customLabel', where),
    quantity: optNum(raw, 'quantity', where, { integer: true }),
    description: str(raw, 'description', where),
    net: num(raw, 'net', where),
    gross: optNum(raw, 'gross', where),
    itemSubtotal: optNum(raw, 'itemSubtotal', where),
    shippingAndHandling: optNum(raw, 'shippingAndHandling', where),
    sellerCollectedTax: optNum(raw, 'sellerCollectedTax', where),
    marketplaceCollectedTax: optNum(raw, 'marketplaceCollectedTax', where),
    fees: optNum(raw, 'fees', where),
    feeBreakdown: fees,
    payoutId: str(raw, 'payoutId', where),
    payoutDate: optDate(raw, 'payoutDate', where),
    payoutStatus: str(raw, 'payoutStatus', where),
    holdReason: str(raw, 'holdReason', where),
    currency: str(raw, 'currency', where),
    transactionCurrency: str(raw, 'transactionCurrency', where),
  };
}

function sanitizePayout(raw: unknown, n: number): MarketplacePayout {
  const where = `Payout ${n}`;
  if (!isObj(raw)) fail(where, 'is not an object');
  return {
    id: str(raw, 'id', where, true),
    marketplace: 'ebay',
    key: str(raw, 'key', where, true),
    importIds: strArr(raw.importIds),
    payoutId: str(raw, 'payoutId', where, true),
    date: optDate(raw, 'date', where),
    amount: optNum(raw, 'amount', where),
    status: str(raw, 'status', where),
    method: str(raw, 'method', where),
    currency: str(raw, 'currency', where),
    payoutType: str(raw, 'payoutType', where),
    memo: str(raw, 'memo', where),
  };
}

function sanitizeImport(raw: unknown): MarketplaceImport | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || typeof raw.fingerprint !== 'string') return null;
  const n = (k: string) => (typeof raw[k] === 'number' && Number.isFinite(raw[k]) ? (raw[k] as number) : 0);
  const d = (k: string) => (typeof raw[k] === 'string' && isValidISODate(raw[k] as string) ? (raw[k] as string) : null);
  return {
    id: raw.id,
    marketplace: 'ebay',
    format: raw.format === 'ebay_payouts' ? 'ebay_payouts' : 'ebay_transactions',
    fileName: typeof raw.fileName === 'string' ? raw.fileName : '',
    fingerprint: raw.fingerprint,
    importedAt: typeof raw.importedAt === 'string' ? raw.importedAt : '',
    added: n('added'),
    updated: n('updated'),
    unchanged: n('unchanged'),
    periodStart: d('periodStart'),
    periodEnd: d('periodEnd'),
  };
}

function sanitizeMatch(raw: unknown): SaleMatch | null {
  if (!isObj(raw) || typeof raw.txnId !== 'string' || typeof raw.saleId !== 'string') return null;
  return { id: typeof raw.id === 'string' ? raw.id : newId(), txnId: raw.txnId, saleId: raw.saleId, createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '' };
}

function sanitizeReview(raw: unknown): ReconciliationReview | null {
  if (!isObj(raw) || typeof raw.target !== 'string' || typeof raw.reason !== 'string') return null;
  if (typeof raw.amount !== 'number' || !Number.isFinite(raw.amount)) return null;
  const decision = raw.decision === 'not_tracked' || raw.decision === 'reviewed' ? raw.decision : 'resolved';
  return {
    id: typeof raw.id === 'string' ? raw.id : newId(),
    target: raw.target,
    decision,
    reason: raw.reason,
    amount: raw.amount,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    undoneAt: typeof raw.undoneAt === 'string' ? raw.undoneAt : null,
  };
}

const EVENT_ACTIONS: ReconciliationEvent['action'][] = ['import', 'match', 'unmatch', 'review', 'undo_review'];

function sanitizeEvent(raw: unknown): ReconciliationEvent | null {
  if (!isObj(raw) || typeof raw.date !== 'string' || typeof raw.summary !== 'string') return null;
  if (!EVENT_ACTIONS.includes(raw.action as ReconciliationEvent['action'])) return null;
  return { id: typeof raw.id === 'string' ? raw.id : newId(), date: raw.date, action: raw.action as ReconciliationEvent['action'], summary: raw.summary, refs: strArr(raw.refs) };
}

/** Imported reports must be intact (they back financial figures); decisions and the log skip unreadable entries. */
function sanitizeMarketplace(raw: unknown): MarketplaceData {
  if (!isObj(raw)) return emptyMarketplace();
  const keep = <T,>(list: (T | null)[]) => list.filter((x): x is T => x !== null);
  return {
    imports: keep(arr(raw, 'imports', 'Marketplace').map(sanitizeImport)),
    transactions: arr(raw, 'transactions', 'Marketplace').map((r, i) => sanitizeTxn(r, i + 1)),
    payouts: arr(raw, 'payouts', 'Marketplace').map((r, i) => sanitizePayout(r, i + 1)),
    matches: keep(arr(raw, 'matches', 'Marketplace').map(sanitizeMatch)),
    reviews: keep(arr(raw, 'reviews', 'Marketplace').map(sanitizeReview)),
    log: keep(arr(raw, 'log', 'Marketplace').map(sanitizeEvent)),
  };
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
    // Data and backups from before bulk lots have no "lots": they load with none.
    lots: arr(raw, 'lots', 'Data').map((r, i) => sanitizeLot(r, i + 1)),
    // Data and backups from before payout reconciliation have no "marketplace": it loads empty.
    marketplace: sanitizeMarketplace(raw.marketplace),
    // Data and backups from before the Max Bid Calculator have no "bidPlans": they load with none.
    bidPlans: arr(raw, 'bidPlans', 'Data').map((r, i) => sanitizeBidPlan(r, i + 1)),
    // Data and backups from before sourcing tracking have no "sourcing": it loads empty.
    sourcing: sanitizeSourcing(raw.sourcing),
  };
}

// ---------------------------------------------------------------------------
// Sourcing: sources, trips, time. Entries that can't be read are dropped (they're records of
// effort, not money); a source needs an id and a name.
// ---------------------------------------------------------------------------

const SOURCE_TYPE_KEYS: SourceType[] = ['thrift', 'garage_sale', 'estate_sale', 'online_marketplace', 'liquidation', 'storage_auction', 'retail', 'wholesale', 'auction', 'other'];
const ACTIVITY_KEYS: TimeActivity[] = ['sourcing', 'listing', 'shipping', 'other'];
const LINK_KINDS: TimeLink['kind'][] = ['session', 'source', 'lot', 'item'];
const CHANGE_KINDS: SourceChange['kind'][] = ['created', 'renamed', 'edited', 'merged', 'assigned', 'deleted'];

function sanitizeLinks(v: unknown): TimeLink[] {
  return (Array.isArray(v) ? v : [])
    .filter(isObj)
    .filter((l) => LINK_KINDS.includes(l.kind as TimeLink['kind']) && typeof l.id === 'string' && l.id)
    .map((l) => ({ kind: l.kind as TimeLink['kind'], id: l.id as string, sharePct: finiteOrNull(l.sharePct) }));
}

function sanitizeSourcing(raw: unknown): SourcingData {
  if (!isObj(raw)) return emptySourcing();
  const list = (k: string) => (Array.isArray(raw[k]) ? (raw[k] as unknown[]) : []).filter(isObj);
  const sources: Source[] = list('sources').flatMap((s) => {
    if (typeof s.id !== 'string' || !s.id || typeof s.name !== 'string' || !s.name.trim()) return [];
    return [
      {
        id: s.id,
        name: s.name.slice(0, 120),
        type: SOURCE_TYPE_KEYS.includes(s.type as SourceType) ? (s.type as SourceType) : 'other',
        location: text(s.location, 200),
        notes: text(s.notes, 2000),
        aliases: strArr(s.aliases).map((x) => x.slice(0, 120)),
        createdAt: text(s.createdAt, 40) || new Date().toISOString(),
        updatedAt: text(s.updatedAt, 40) || new Date().toISOString(),
      },
    ];
  });
  const sessions: SourcingSession[] = list('sessions').flatMap((s) => {
    if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.date !== 'string' || !isValidISODate(s.date)) return [];
    return [
      {
        id: s.id,
        name: s.name.slice(0, 120),
        date: s.date,
        sourceIds: strArr(s.sourceIds),
        notes: text(s.notes, 2000),
        expenses: (Array.isArray(s.expenses) ? s.expenses : [])
          .filter(isObj)
          .filter((e) => typeof e.amount === 'number' && Number.isFinite(e.amount) && e.amount >= 0)
          .map((e) => ({ id: typeof e.id === 'string' && e.id ? e.id : newId(), label: text(e.label, 80) || 'Trip expense', amount: e.amount as number, kind: e.kind === 'acquisition' ? ('acquisition' as const) : ('operating' as const) })),
        split: s.split === 'equal' || s.split === 'by_cost' ? s.split : null,
        createdAt: text(s.createdAt, 40) || new Date().toISOString(),
        updatedAt: text(s.updatedAt, 40) || new Date().toISOString(),
      },
    ];
  });
  const timeEntries: TimeEntry[] = list('timeEntries').flatMap((e) => {
    if (typeof e.id !== 'string' || typeof e.date !== 'string' || !isValidISODate(e.date) || typeof e.minutes !== 'number' || !Number.isInteger(e.minutes) || e.minutes < 1) return [];
    return [
      {
        id: e.id,
        date: e.date,
        minutes: Math.min(e.minutes, 24 * 60),
        activity: ACTIVITY_KEYS.includes(e.activity as TimeActivity) ? (e.activity as TimeActivity) : 'other',
        note: text(e.note, 500),
        links: sanitizeLinks(e.links),
        split: e.split === 'custom' ? ('custom' as const) : ('equal' as const),
        createdAt: text(e.createdAt, 40) || new Date().toISOString(),
        updatedAt: text(e.updatedAt, 40) || new Date().toISOString(),
      },
    ];
  });
  const t = raw.timer;
  const timer: RunningTimer | null =
    isObj(t) && typeof t.startedAt === 'string' && typeof t.accumulatedMs === 'number' && Number.isFinite(t.accumulatedMs) && t.accumulatedMs >= 0
      ? {
          activity: ACTIVITY_KEYS.includes(t.activity as TimeActivity) ? (t.activity as TimeActivity) : 'other',
          note: text(t.note, 500),
          links: sanitizeLinks(t.links),
          startedAt: t.startedAt,
          runningSince: typeof t.runningSince === 'string' ? t.runningSince : null,
          accumulatedMs: t.accumulatedMs,
        }
      : null;
  const changes: SourceChange[] = list('changes')
    .filter((c) => typeof c.at === 'string' && CHANGE_KINDS.includes(c.kind as SourceChange['kind']))
    .map((c) => ({
      id: typeof c.id === 'string' ? c.id : newId(),
      at: c.at as string,
      kind: c.kind as SourceChange['kind'],
      sourceId: typeof c.sourceId === 'string' ? c.sourceId : null,
      detail: text(c.detail, 500),
      recordKind: c.recordKind === 'item' || c.recordKind === 'lot' ? c.recordKind : null,
      recordId: typeof c.recordId === 'string' ? c.recordId : null,
    }));
  return { sources, sessions, timeEntries, timer, changes };
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
