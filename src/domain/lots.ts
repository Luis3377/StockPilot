// Bulk lots: several items bought together for one price, with that cost split across them.
//
// The split (relative sales value):
//   total allocable cost = purchase price + additional acquisition costs (freight, buyer's premium…)
//   a line's estimated value = estimated resale value per unit × quantity
//   allocated line cost = total allocable cost × (line's estimated value ÷ total estimated value)
// or, splitting equally, every unit gets the same share. The split is done in whole cents with
// the largest-remainder method, so the lines always add up to the total exactly and the same
// inputs always give the same result.
//
// Each line becomes an ordinary inventory item whose cost per item is its share ÷ quantity.
// Sales and losses then take cost out of inventory with costLeaving, so every cent of a lot
// ends up either in a completed sale, a write-off, or the stock you still have.
//
// Estimated resale values come from the user. AI identification never sets a price; a future
// market-price lookup would supply estimates through EstimateSource.

import type { AppData, Item, Lot, LotAllocationMethod, LotChange, LotExtraCost, LotLine, LotLineChange } from './types';
import { DomainError, FieldErrors, isDomainError } from './errors';
import { newId } from './ids';
import { exactPerUnit, fromCents, toCents } from './money';
import { itemCostValue, totalSales, type SalesTotals } from './calc';
import {
  addItem,
  nowParts,
  optionalDate,
  optionalMoney,
  optionalText,
  replaceItem,
  requireMoney,
  requireText,
  requireWholeNumber,
  withValuePoint,
  type Clock,
} from './actions';

export const LOT_LIMITS = { lines: 200, quantityPerLine: 100_000, extraCosts: 10 } as const;

export const METHOD_LABELS: Record<LotAllocationMethod, string> = {
  relative_value: 'By estimated resale value',
  equal: 'Equally per unit',
};

// ---------------------------------------------------------------------------
// Splitting cents
// ---------------------------------------------------------------------------

/**
 * Splits `totalCents` in proportion to `weights` with the largest-remainder method: every
 * share is first rounded down to a whole cent, then the cents left over go one each to the
 * shares that lost the most in rounding (the earlier line first on a tie). The shares always
 * add up to `totalCents` exactly. Integer (BigInt) math, so large amounts can't drift.
 */
export function splitCents(totalCents: number, weights: readonly (number | bigint)[]): number[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) throw new Error('total must be whole, non-negative cents');
  const w = weights.map((x) => BigInt(x));
  if (w.some((x) => x < 0n)) throw new Error('weights must not be negative');
  const sum = w.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error('weights add up to zero');
  const total = BigInt(totalCents);
  const shares = w.map((x) => (total * x) / sum);
  const remainders = w.map((x) => (total * x) % sum);
  let left = total - shares.reduce((a, b) => a + b, 0n);
  // Fewer cents are left than there are positive weights, so one pass is enough.
  const order = w
    .map((_, i) => i)
    .filter((i) => w[i] > 0n)
    .sort((a, b) => (remainders[b] > remainders[a] ? 1 : remainders[b] < remainders[a] ? -1 : a - b));
  for (const i of order) {
    if (left === 0n) break;
    shares[i] += 1n;
    left -= 1n;
  }
  return shares.map(Number);
}

// ---------------------------------------------------------------------------
// Allocation preview
// ---------------------------------------------------------------------------

export interface AllocationLine {
  quantity: number;
  estimatedUnitValue: number | null;
}

export interface LineAllocation {
  quantity: number;
  estimatedUnitValue: number | null;
  /** Estimate × quantity, or null without an estimate. */
  estimatedLineValue: number | null;
  /** This line's share of the total (0–1). */
  share: number;
  allocatedCost: number;
  /** allocatedCost ÷ quantity; can have more than 2 decimals (see unitCentSplit). */
  unitCost: number;
}

export interface Allocation {
  method: LotAllocationMethod;
  total: number;
  lines: LineAllocation[];
  /** Σ allocated line costs. Always equal to `total`. */
  allocatedTotal: number;
  /** Σ estimated line values, over lines with an estimate. */
  estimatedTotal: number;
  linesWithoutEstimate: number;
  linesWithZeroEstimate: number;
}

const lineKey = (i: number, field: string) => `line.${i}.${field}`;

function lineWeights(method: LotAllocationMethod, lines: AllocationLine[]): bigint[] {
  return lines.map((l) => (method === 'equal' ? BigInt(l.quantity) : BigInt(toCents(l.estimatedUnitValue ?? 0)) * BigInt(l.quantity)));
}

/** Throws a DomainError (with per-line fields) when the lines can't be split this way. */
function checkSplittable(method: LotAllocationMethod, lines: AllocationLine[], v: FieldErrors, keyOf: (i: number) => string = (i) => lineKey(i, 'estimate')) {
  if (method !== 'relative_value') return;
  lines.forEach((l, i) => {
    if (l.estimatedUnitValue === null) v.add(keyOf(i), 'Enter an estimated resale value, or split the cost equally.');
  });
  if (lines.every((l) => l.estimatedUnitValue !== null) && lines.every((l) => toCents(l.estimatedUnitValue!) === 0)) {
    v.add('method', 'Every estimate is 0, so there’s nothing to split by. Enter estimates or split the cost equally.');
  }
}

/** Splits `total` across the lines. Throws a DomainError when it can't be done. */
export function allocate(total: number, method: LotAllocationMethod, lines: AllocationLine[]): Allocation {
  if (lines.length === 0) throw new DomainError('Add at least one item to the lot.', 'lines');
  const v = new FieldErrors();
  checkSplittable(method, lines, v);
  v.throwIfAny();
  const totalCents = toCents(total);
  const weights = lineWeights(method, lines);
  const weightSum = weights.reduce((a, b) => a + b, 0n);
  const cents = splitCents(totalCents, weights);
  const estimated = lines.filter((l) => l.estimatedUnitValue !== null);
  return {
    method,
    total: fromCents(totalCents),
    lines: lines.map((l, i) => ({
      quantity: l.quantity,
      estimatedUnitValue: l.estimatedUnitValue,
      estimatedLineValue: l.estimatedUnitValue === null ? null : fromCents(toCents(l.estimatedUnitValue) * l.quantity),
      share: Number((weights[i] * 1_000_000n) / weightSum) / 1_000_000,
      allocatedCost: fromCents(cents[i]),
      unitCost: exactPerUnit(fromCents(cents[i]), l.quantity),
    })),
    allocatedTotal: fromCents(cents.reduce((a, b) => a + b, 0)),
    estimatedTotal: fromCents(estimated.reduce((c, l) => c + toCents(l.estimatedUnitValue!) * l.quantity, 0)),
    linesWithoutEstimate: lines.length - estimated.length,
    linesWithZeroEstimate: estimated.filter((l) => toCents(l.estimatedUnitValue!) === 0).length,
  };
}

// ---------------------------------------------------------------------------
// Creating a lot
// ---------------------------------------------------------------------------

export interface LotExtraCostInput {
  label: string;
  amount: number | null;
}

export interface LotLineInput {
  name: string;
  quantity: number | null;
  estimatedUnitValue: number | null;
  category?: string;
  condition?: string;
  location?: string;
  notes?: string;
  photoIds?: string[];
}

export interface LotInput {
  name: string;
  purchasePrice: number | null;
  extraCosts: LotExtraCostInput[];
  purchaseDate: string | null;
  source: string;
  notes: string;
  method: LotAllocationMethod;
  lines: LotLineInput[];
}

function checkExtraCosts(extraCosts: LotExtraCostInput[], v: FieldErrors): LotExtraCost[] {
  if (extraCosts.length > LOT_LIMITS.extraCosts) v.add('extraCosts', `A lot can have up to ${LOT_LIMITS.extraCosts} additional costs.`);
  return extraCosts.flatMap((c, i) => {
    const label = v.check(() => optionalText(c.label, `extra.${i}.label`, 'Cost name', 80));
    // A row left completely empty is ignored.
    if (c.amount === null && !label) return [];
    const amount = v.check(() => requireMoney(c.amount, `extra.${i}.amount`, 'Amount'));
    return amount === undefined || label === undefined ? [] : [{ id: newId(), label: label || 'Additional cost', amount }];
  });
}

const sumAmounts = (costs: { amount: number }[]) => costs.reduce((c, x) => c + toCents(x.amount), 0);

/** Purchase price + additional costs: the cost that gets split across the lot's items. */
export function lotTotal(lot: Pick<Lot, 'purchasePrice' | 'extraCosts'>): number {
  return fromCents(toCents(lot.purchasePrice) + sumAmounts(lot.extraCosts));
}

interface CheckedLot {
  name: string;
  purchasePrice: number;
  extraCosts: LotExtraCost[];
  purchaseDate: string | null;
  source: string;
  notes: string;
  lines: (Required<Omit<LotLineInput, 'quantity'>> & { quantity: number })[];
  allocation: Allocation;
}

function checkLot(input: LotInput): CheckedLot {
  const v = new FieldErrors();
  const name = v.check(() => requireText(input.name, 'name', 'Lot name', 120));
  const purchasePrice = v.check(() => requireMoney(input.purchasePrice, 'purchasePrice', 'Total purchase price'));
  const extraCosts = checkExtraCosts(input.extraCosts, v);
  const purchaseDate = v.check(() => optionalDate(input.purchaseDate, 'purchaseDate', 'Purchase date'));
  const source = v.check(() => optionalText(input.source, 'source', 'Where you bought it', 120));
  const notes = v.check(() => optionalText(input.notes, 'notes', 'Notes', 5000));
  if (input.lines.length === 0) v.add('lines', 'Add at least one item to the lot.');
  if (input.lines.length > LOT_LIMITS.lines) v.add('lines', `A lot can have up to ${LOT_LIMITS.lines} items.`);
  const lines = input.lines.map((l, i) => {
    const quantity = v.check(() => requireWholeNumber(l.quantity, lineKey(i, 'quantity'), 'Quantity', 1));
    if (quantity !== undefined && quantity > LOT_LIMITS.quantityPerLine) {
      v.add(lineKey(i, 'quantity'), `Quantity can be at most ${LOT_LIMITS.quantityPerLine.toLocaleString()}.`);
    }
    return {
      name: v.check(() => requireText(l.name, lineKey(i, 'name'), 'Item name')) ?? '',
      quantity: quantity ?? 1,
      estimatedUnitValue: v.check(() => optionalMoney(l.estimatedUnitValue, lineKey(i, 'estimate'), 'Estimated resale value')) ?? null,
      category: v.check(() => optionalText(l.category, lineKey(i, 'category'), 'Category', 80)) ?? '',
      condition: v.check(() => optionalText(l.condition, lineKey(i, 'condition'), 'Condition', 80)) ?? '',
      location: v.check(() => optionalText(l.location, lineKey(i, 'location'), 'Location', 120)) ?? '',
      notes: v.check(() => optionalText(l.notes, lineKey(i, 'notes'), 'Notes', 5000)) ?? '',
      photoIds: [...(l.photoIds ?? [])],
    };
  });
  if (lines.length) checkSplittable(input.method, lines, v);
  v.throwIfAny();
  const checked = { name: name!, purchasePrice: purchasePrice!, extraCosts, purchaseDate: purchaseDate ?? null, source: source!, notes: notes!, lines };
  return { ...checked, allocation: allocate(lotTotal(checked), input.method, lines) };
}

/** The split a lot would get, for the review step. Throws a DomainError if it can't be saved. */
export function previewLot(input: LotInput): Allocation {
  return checkLot(input).allocation;
}

/** Every problem with a lot's fields at once ({} when it would save). */
export function lotInputErrors(input: LotInput): Record<string, string> {
  try {
    checkLot(input);
    return {};
  } catch (e) {
    if (isDomainError(e)) return e.fields;
    throw e;
  }
}

/**
 * Saves a lot and one inventory item per line, each costing its share of the lot. Buying is
 * not a loss or an adjustment: the items simply start with their share as their cost.
 */
export function createLot(data: AppData, input: LotInput, clock?: Clock): { data: AppData; lot: Lot; items: Item[] } {
  const { iso } = nowParts(clock);
  const checked = checkLot(input);
  let next = data;
  const items: Item[] = [];
  const lines: LotLine[] = checked.lines.map((l, i) => {
    const share = checked.allocation.lines[i];
    const added = addItem(
      next,
      {
        name: l.name,
        category: l.category,
        quantity: l.quantity,
        unitCost: share.unitCost,
        estimatedValue: l.estimatedUnitValue,
        purchaseDate: checked.purchaseDate,
        condition: l.condition,
        location: l.location,
        notes: l.notes,
        photoIds: l.photoIds,
      },
      clock,
    );
    // addItem keeps 4 decimals; a share can need more to add up exactly.
    const item: Item = { ...added.item, unitCost: share.unitCost };
    next = { ...added.data, items: replaceItem(added.data.items, item) };
    items.push(item);
    return {
      id: newId(),
      itemId: item.id,
      itemName: item.name,
      quantity: l.quantity,
      estimatedUnitValue: l.estimatedUnitValue,
      estimateSource: 'user',
      allocatedCost: share.allocatedCost,
    };
  });
  const total = checked.allocation.total;
  const lot: Lot = {
    id: newId(),
    name: checked.name,
    purchasePrice: checked.purchasePrice,
    extraCosts: checked.extraCosts,
    purchaseDate: checked.purchaseDate,
    source: checked.source,
    notes: checked.notes,
    method: input.method,
    lines,
    history: [
      {
        id: newId(),
        date: iso,
        kind: 'created',
        changedFields: [],
        note: '',
        previousTotal: total,
        newTotal: total,
        previousMethod: input.method,
        newMethod: input.method,
        lockedCost: 0,
        lines: [],
      },
    ],
    createdAt: iso,
    updatedAt: iso,
  };
  return { data: { ...next, lots: [...next.lots, lot] }, lot, items };
}

// ---------------------------------------------------------------------------
// Editing a lot
// ---------------------------------------------------------------------------

export interface LotEditInput {
  name: string;
  purchasePrice: number | null;
  extraCosts: LotExtraCostInput[];
  purchaseDate: string | null;
  source: string;
  notes: string;
  method: LotAllocationMethod;
  /** Estimated resale value per unit, by line id. Lines not listed keep theirs. */
  estimates: Record<string, number | null>;
}

export interface LotEditPlan {
  /** Which fields change: name, purchaseDate, source, notes, purchasePrice, extraCosts, method, estimates. */
  changedFields: string[];
  /** True when the change moves any cost (needs confirmation). */
  costChange: boolean;
  /** 'redistribute': the cost still in stock is re-split by new estimates/method. 'delta': only a change in the total is shared out. */
  mode: 'none' | 'delta' | 'redistribute';
  previousTotal: number;
  newTotal: number;
  /** Cost already in completed sales, write-offs or changes outside the lot. Never changed. */
  lockedCost: number;
  remainingBefore: number;
  remainingAfter: number;
  /** One entry per line with units on hand. */
  lines: LotLineChange[];
  lot: Lot;
}

export function findLot(data: AppData, id: string): Lot {
  const lot = data.lots.find((l) => l.id === id);
  if (!lot) throw new DomainError('That lot no longer exists.');
  return lot;
}

const sameExtraCosts = (a: LotExtraCost[], b: LotExtraCost[]) =>
  a.length === b.length && a.every((c, i) => c.label === b[i].label && toCents(c.amount) === toCents(b[i].amount));

const sameEstimate = (a: number | null, b: number | null) => (a === null ? b === null : b !== null && toCents(a) === toCents(b));

/**
 * Works out what an edit would do, without changing anything. Completed sales are never
 * touched: cost that has already left inventory stays where it is, and any change is applied
 * to the units still on hand.
 */
export function planLotEdit(data: AppData, lotId: string, input: LotEditInput, clock?: Clock): LotEditPlan {
  const { iso } = nowParts(clock);
  const lot = findLot(data, lotId);
  const v = new FieldErrors();
  const name = v.check(() => requireText(input.name, 'name', 'Lot name', 120));
  const purchasePrice = v.check(() => requireMoney(input.purchasePrice, 'purchasePrice', 'Total purchase price'));
  const extraCosts = checkExtraCosts(input.extraCosts, v);
  const purchaseDate = v.check(() => optionalDate(input.purchaseDate, 'purchaseDate', 'Purchase date'));
  const source = v.check(() => optionalText(input.source, 'source', 'Where you bought it', 120));
  const notes = v.check(() => optionalText(input.notes, 'notes', 'Notes', 5000));
  const estimates = lot.lines.map((line, i) =>
    line.id in input.estimates
      ? (v.check(() => optionalMoney(input.estimates[line.id], lineKey(i, 'estimate'), 'Estimated resale value')) ?? null)
      : line.estimatedUnitValue,
  );
  v.throwIfAny();

  // Keep extra-cost ids stable when only amounts or labels change.
  const extras = extraCosts.map((c, i) => ({ ...c, id: lot.extraCosts[i]?.id ?? c.id }));
  const previousTotal = lotTotal(lot);
  const newTotal = lotTotal({ purchasePrice: purchasePrice!, extraCosts: extras });
  const changedFields: string[] = [];
  if (name !== lot.name) changedFields.push('name');
  if ((purchaseDate ?? null) !== lot.purchaseDate) changedFields.push('purchaseDate');
  if (source !== lot.source) changedFields.push('source');
  if (notes !== lot.notes) changedFields.push('notes');
  if (toCents(purchasePrice!) !== toCents(lot.purchasePrice)) changedFields.push('purchasePrice');
  if (!sameExtraCosts(extras, lot.extraCosts)) changedFields.push('extraCosts');
  if (input.method !== lot.method) changedFields.push('method');
  if (lot.lines.some((l, i) => !sameEstimate(l.estimatedUnitValue, estimates[i]))) changedFields.push('estimates');

  const state = lot.lines.map((line, i) => {
    const item = data.items.find((x) => x.id === line.itemId) ?? null;
    const onHand = item?.quantity ?? 0;
    return { line, item, onHand, remaining: item ? toCents(itemCostValue(item)) : 0, estimate: estimates[i] };
  });
  const remainingBefore = state.reduce((c, s) => c + s.remaining, 0);
  const lockedCents = toCents(previousTotal) - remainingBefore;
  const deltaCents = toCents(newTotal) - toCents(previousTotal);
  const active = state.filter((s) => s.onHand > 0);
  const reweighted = input.method !== lot.method || active.some((s) => !sameEstimate(s.line.estimatedUnitValue, s.estimate));
  const mode: LotEditPlan['mode'] = active.length === 0 ? 'none' : reweighted ? 'redistribute' : deltaCents !== 0 ? 'delta' : 'none';

  if (deltaCents !== 0 && active.length === 0) {
    throw new DomainError('Everything from this lot has been sold or written off, so its cost can’t change without rewriting completed sales.', 'purchasePrice');
  }
  const pool = remainingBefore + deltaCents;
  if (pool < 0) {
    throw new DomainError(
      `Only ${fromCents(remainingBefore).toFixed(2)} of this lot’s cost is still in unsold items, so the total can go down by at most that much. Cost already in completed sales can’t change.`,
      'purchasePrice',
    );
  }

  let newRemaining = state.map((s) => s.remaining);
  if (mode !== 'none') {
    const allocLines = active.map((s) => ({ quantity: s.onHand, estimatedUnitValue: s.estimate }));
    const keyOf = (j: number) => lineKey(state.indexOf(active[j]), 'estimate');
    const check = new FieldErrors();
    checkSplittable(input.method, allocLines, check, keyOf);
    check.throwIfAny();
    const weights = lineWeights(input.method, allocLines);
    if (mode === 'redistribute') {
      const cents = splitCents(pool, weights);
      active.forEach((s, j) => (newRemaining[state.indexOf(s)] = cents[j]));
    } else {
      const parts = splitCents(Math.abs(deltaCents), weights);
      active.forEach((s, j) => (newRemaining[state.indexOf(s)] = s.remaining + Math.sign(deltaCents) * parts[j]));
      if (newRemaining.some((c) => c < 0)) {
        throw new DomainError('That lowers some items’ cost below zero. Lower the total by less, or change the estimates.', 'purchasePrice');
      }
    }
  } else {
    newRemaining = state.map((s) => s.remaining);
  }

  const lines: LotLineChange[] = active.map((s) => {
    const i = state.indexOf(s);
    return {
      lineId: s.line.id,
      itemId: s.line.itemId,
      itemName: s.item?.name ?? s.line.itemName,
      unitsAffected: s.onHand,
      previousUnitCost: s.item!.unitCost,
      newUnitCost: newRemaining[i] === s.remaining ? s.item!.unitCost : exactPerUnit(fromCents(newRemaining[i]), s.onHand),
      previousRemainingCost: fromCents(s.remaining),
      newRemainingCost: fromCents(newRemaining[i]),
      previousEstimate: s.line.estimatedUnitValue,
      newEstimate: s.estimate,
    };
  });

  const nextLot: Lot = {
    ...lot,
    name: name!,
    purchasePrice: purchasePrice!,
    extraCosts: extras,
    purchaseDate: purchaseDate ?? null,
    source: source!,
    notes: notes!,
    method: input.method,
    lines: lot.lines.map((line, i) => ({
      ...line,
      estimatedUnitValue: estimates[i],
      allocatedCost: fromCents(toCents(line.allocatedCost) + newRemaining[i] - state[i].remaining),
    })),
    updatedAt: iso,
  };
  const costChange = deltaCents !== 0 || lines.some((l) => toCents(l.previousRemainingCost) !== toCents(l.newRemainingCost));
  return {
    changedFields,
    costChange,
    mode,
    previousTotal,
    newTotal,
    lockedCost: fromCents(lockedCents),
    remainingBefore: fromCents(remainingBefore),
    remainingAfter: fromCents(pool),
    lines,
    lot: nextLot,
  };
}

/**
 * Applies an edit planned by planLotEdit (recomputed here, so the result always matches the
 * current data). Unsold items get their new cost; sales keep the cost they were recorded at.
 * The change and the user's reason are added to the lot's history.
 */
export function applyLotEdit(data: AppData, lotId: string, input: LotEditInput, note: string, clock?: Clock): { data: AppData; lot: Lot; plan: LotEditPlan } {
  const { iso, today } = nowParts(clock);
  const plan = planLotEdit(data, lotId, input, clock);
  if (plan.changedFields.length === 0) throw new DomainError('Nothing has changed.');
  const reason = optionalText(note, 'note', 'Reason', 500);
  const previous = findLot(data, lotId);

  let items = data.items;
  for (const change of plan.lines) {
    const item = items.find((i) => i.id === change.itemId);
    if (!item) continue;
    let updated: Item = item;
    if (change.newUnitCost !== change.previousUnitCost) updated = { ...updated, unitCost: change.newUnitCost };
    if (!sameEstimate(change.previousEstimate, change.newEstimate)) {
      updated = { ...updated, estimatedValue: change.newEstimate, valueHistory: withValuePoint(updated.valueHistory, change.newEstimate, today) };
    }
    if (updated !== item) items = replaceItem(items, { ...updated, updatedAt: iso });
  }
  // A new lot date also moves items that still had the old one.
  if (plan.changedFields.includes('purchaseDate')) {
    const ids = new Set(previous.lines.map((l) => l.itemId));
    items = items.map((i) => (ids.has(i.id) && i.purchaseDate === previous.purchaseDate ? { ...i, purchaseDate: plan.lot.purchaseDate, updatedAt: iso } : i));
  }

  const entry: LotChange = {
    id: newId(),
    date: iso,
    kind: plan.costChange || plan.changedFields.some((f) => ['purchasePrice', 'extraCosts', 'method', 'estimates'].includes(f)) ? 'costs' : 'details',
    changedFields: plan.changedFields,
    note: reason,
    previousTotal: plan.previousTotal,
    newTotal: plan.newTotal,
    previousMethod: previous.method,
    newMethod: plan.lot.method,
    lockedCost: plan.lockedCost,
    lines: plan.lines.filter(
      (l) => toCents(l.previousRemainingCost) !== toCents(l.newRemainingCost) || !sameEstimate(l.previousEstimate, l.newEstimate),
    ),
  };
  const lot: Lot = { ...plan.lot, history: [...previous.history, entry] };
  return { data: { ...data, items, lots: data.lots.map((l) => (l.id === lotId ? lot : l)) }, lot, plan };
}

/** Every problem with a lot edit at once ({} when it would save). */
export function lotEditErrors(data: AppData, lotId: string, input: LotEditInput): Record<string, string> {
  try {
    planLotEdit(data, lotId, input);
    return {};
  } catch (e) {
    if (isDomainError(e)) return Object.keys(e.fields).length ? e.fields : { form: e.message };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Summary and reconciliation
// ---------------------------------------------------------------------------

export function lotForItem(data: AppData, itemId: string): { lot: Lot; line: LotLine } | null {
  for (const lot of data.lots) {
    const line = lot.lines.find((l) => l.itemId === itemId);
    if (line) return { lot, line };
  }
  return null;
}

export interface LotLineSummary {
  line: LotLine;
  item: Item | null;
  name: string;
  unitsBought: number;
  unitsOnHand: number;
  unitsSold: number;
  /** Cost of this line's units still in stock. */
  remainingCost: number;
  costOfGoodsSold: number;
  revenue: number;
  realizedProfit: number;
}

export interface LotSummary {
  purchasePrice: number;
  extraCostsTotal: number;
  /** Purchase price + additional costs. */
  total: number;
  /** Σ line allocations — equals `total` when the split balances (always, unless edited by hand). */
  allocatedTotal: number;
  balanced: boolean;
  itemCount: number;
  unitsBought: number;
  /** Σ estimate × quantity bought, over lines with an estimate (the estimates used for the split). */
  estimatedResaleTotal: number;
  linesWithoutEstimate: number;
  /** Estimated resale − total cost, before selling expenses. Null unless every line has an estimate. */
  potentialGrossProfit: number | null;

  // Realized: completed sales of the lot's items.
  sales: SalesTotals;

  // Still in stock (today).
  unitsOnHand: number;
  remainingCost: number;
  /** Current est. market value × quantity, over in-stock items with an estimate. */
  remainingEstimatedValue: number;
  /** Cost of the same in-stock items counted in remainingEstimatedValue. */
  remainingEstimatedCostBasis: number;
  inStockWithoutEstimate: number;
  /** Est. market value − cost of in-stock items with an estimate, before selling expenses. */
  projectedGrossProfit: number | null;

  // Where the cost went.
  /** Cost removed by counts, losses and quantity edits (net; negative if more was found). */
  writtenOff: number;
  /** Cost added later by restocking lot items. */
  addedLater: number;
  /** Anything not explained above: item cost edits, deleted items. 0 when fully reconciled. */
  otherChanges: number;
  reconciled: boolean;
  lines: LotLineSummary[];
}

export function lotSummary(data: AppData, lot: Lot): LotSummary {
  const ids = new Set(lot.lines.map((l) => l.itemId));
  const lotSales = data.sales.filter((s) => ids.has(s.itemId));
  const lotAdjustments = data.adjustments.filter((a) => ids.has(a.itemId));
  const sales = totalSales(lotSales);
  const totalCents = toCents(lotTotal(lot));
  const allocatedCents = lot.lines.reduce((c, l) => c + toCents(l.allocatedCost), 0);

  const lines: LotLineSummary[] = lot.lines.map((line) => {
    const item = data.items.find((i) => i.id === line.itemId) ?? null;
    const own = totalSales(lotSales.filter((s) => s.itemId === line.itemId));
    return {
      line,
      item,
      name: item?.name ?? line.itemName,
      unitsBought: line.quantity,
      unitsOnHand: item?.quantity ?? 0,
      unitsSold: own.unitsSold,
      remainingCost: item ? itemCostValue(item) : 0,
      costOfGoodsSold: own.costOfGoods,
      revenue: own.revenue,
      realizedProfit: own.netProfit,
    };
  });
  const inStock = lines.filter((l) => l.item && l.unitsOnHand > 0);
  const valued = inStock.filter((l) => l.item!.estimatedValue !== null);
  const remainingCents = lines.reduce((c, l) => c + toCents(l.remainingCost), 0);
  const valuedCents = valued.reduce((c, l) => c + toCents(l.item!.estimatedValue!) * l.unitsOnHand, 0);
  const valuedCostCents = valued.reduce((c, l) => c + toCents(l.remainingCost), 0);
  const addedCents = lotAdjustments.filter((a) => a.source === 'restock').reduce((c, a) => c + toCents(a.valueDifference), 0);
  const writtenOffCents = -lotAdjustments.filter((a) => a.source !== 'restock').reduce((c, a) => c + toCents(a.valueDifference), 0);
  const otherCents = totalCents + addedCents - writtenOffCents - toCents(sales.costOfGoods) - remainingCents;
  const estimatedCents = lot.lines.reduce((c, l) => c + (l.estimatedUnitValue === null ? 0 : toCents(l.estimatedUnitValue) * l.quantity), 0);
  const withoutEstimate = lot.lines.filter((l) => l.estimatedUnitValue === null).length;

  return {
    purchasePrice: lot.purchasePrice,
    extraCostsTotal: fromCents(sumAmounts(lot.extraCosts)),
    total: fromCents(totalCents),
    allocatedTotal: fromCents(allocatedCents),
    balanced: allocatedCents === totalCents,
    itemCount: lot.lines.length,
    unitsBought: lot.lines.reduce((n, l) => n + l.quantity, 0),
    estimatedResaleTotal: fromCents(estimatedCents),
    linesWithoutEstimate: withoutEstimate,
    potentialGrossProfit: withoutEstimate === 0 ? fromCents(estimatedCents - totalCents) : null,
    sales,
    unitsOnHand: lines.reduce((n, l) => n + l.unitsOnHand, 0),
    remainingCost: fromCents(remainingCents),
    remainingEstimatedValue: fromCents(valuedCents),
    remainingEstimatedCostBasis: fromCents(valuedCostCents),
    inStockWithoutEstimate: inStock.length - valued.length,
    projectedGrossProfit: valued.length ? fromCents(valuedCents - valuedCostCents) : null,
    writtenOff: fromCents(writtenOffCents),
    addedLater: fromCents(addedCents),
    otherChanges: fromCents(otherCents),
    reconciled: otherCents === 0 && allocatedCents === totalCents,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Closing a lot for performance tracking
// ---------------------------------------------------------------------------

/**
 * Marks a lot as done ("I've finished selling it"), so its performance result is final. Nothing
 * is written off: units still on hand stay in inventory at cost and count as unsold. The user
 * must acknowledge them (`keepRemaining`) when there are any.
 */
export function closeLot(data: AppData, lotId: string, note: string, keepRemaining: boolean, clock?: Clock): { data: AppData; lot: Lot } {
  const { iso } = nowParts(clock);
  const lot = data.lots.find((l) => l.id === lotId);
  if (!lot) throw new DomainError('That lot no longer exists.');
  if (lot.closure) throw new DomainError('This lot is already closed.');
  const s = lotSummary(data, lot);
  if (s.unitsOnHand > 0 && !keepRemaining) {
    throw new DomainError(
      `${s.unitsOnHand} unit${s.unitsOnHand === 1 ? ' is' : 's are'} still in stock. Sell or write them off first, or confirm they stay in your inventory at cost and count as unsold.`,
      'keepRemaining',
    );
  }
  const next: Lot = {
    ...lot,
    closure: { at: iso, note: optionalText(note, 'note', 'Note', 500), unitsOnHand: s.unitsOnHand, remainingCost: s.remainingCost },
    updatedAt: iso,
  };
  return { data: { ...data, lots: data.lots.map((l) => (l.id === lotId ? next : l)) }, lot: next };
}

/** Reopens a closed lot: its result is no longer final. */
export function reopenLot(data: AppData, lotId: string, clock?: Clock): { data: AppData; lot: Lot } {
  const { iso } = nowParts(clock);
  const lot = data.lots.find((l) => l.id === lotId);
  if (!lot) throw new DomainError('That lot no longer exists.');
  const next: Lot = { ...lot, closure: null, updatedAt: iso };
  return { data: { ...data, lots: data.lots.map((l) => (l.id === lotId ? next : l)) }, lot: next };
}

