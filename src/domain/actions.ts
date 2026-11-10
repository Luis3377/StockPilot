// Pure state transitions. Each function takes the current AppData and returns a new AppData
// (never mutating the input) or throws a DomainError with a message safe to show the user.
// Keeping these pure makes inventory math easy to test and reuse with a future server sync.

import type {
  Adjustment,
  AdjustmentSource,
  AppData,
  CountDraft,
  CountLine,
  CountRecord,
  CountScope,
  Item,
  PriceMode,
  Sale,
  ValuePoint,
} from './types';
import { DomainError, FieldErrors, isDomainError } from './errors';
import { newId } from './ids';
import { isValidISODate, todayISO } from './dates';
import { fromCents, multiplyMoney, roundMoney, toCents } from './money';
import { itemCostValue, mostCommon, nameKey } from './calc';
import { plural, pluralWord } from './format';

export interface Clock {
  now: Date;
}

function nowParts(clock?: Clock): { iso: string; today: string } {
  const now = clock?.now ?? new Date();
  return { iso: now.toISOString(), today: todayISO(now) };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function requireText(value: string, field: string, label: string, max = 200): string {
  const t = value.trim();
  if (!t) throw new DomainError(`${label} is required.`, field);
  if (t.length > max) throw new DomainError(`${label} must be ${max} characters or fewer.`, field);
  return t;
}

function optionalText(value: string | undefined, field: string, label: string, max = 200): string {
  const t = (value ?? '').trim();
  if (t.length > max) throw new DomainError(`${label} must be ${max} characters or fewer.`, field);
  return t;
}

function requireMoney(value: number | null | undefined, field: string, label: string, decimals = 2): number {
  if (value === null || value === undefined) throw new DomainError(`${label} is required.`, field);
  if (!Number.isFinite(value)) throw new DomainError(`${label} must be a number.`, field);
  if (value < 0) throw new DomainError(`${label} can't be negative.`, field);
  if (value > 1_000_000_000) throw new DomainError(`${label} is too large.`, field);
  return decimals === 2 ? roundMoney(value) : roundUnitCost(value);
}

/** Unit costs keep 4 decimals so averaged costs (e.g. 3 for $10 = $3.3333) stay exact enough. */
function roundUnitCost(value: number): number {
  return Math.round(Number((value * 10_000).toPrecision(14))) / 10_000;
}

function optionalMoney(value: number | null | undefined, field: string, label: string): number | null {
  if (value === null || value === undefined) return null;
  return requireMoney(value, field, label);
}

function requireWholeNumber(value: number | null | undefined, field: string, label: string, min = 0): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    throw new DomainError(`${label} is required.`, field);
  }
  if (!Number.isInteger(value)) throw new DomainError(`${label} must be a whole number.`, field);
  if (value < min) {
    throw new DomainError(min === 0 ? `${label} can't be negative.` : `${label} must be at least ${min}.`, field);
  }
  if (value > 10_000_000) throw new DomainError(`${label} is too large.`, field);
  return value;
}

function optionalDate(value: string | null | undefined, field: string, label: string): string | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  if (!isValidISODate(value.trim())) throw new DomainError(`${label} must be a valid date.`, field);
  return value.trim();
}

/**
 * Reuses the spelling already in use when `value` matches it apart from capitalization and
 * spacing, so "ebay" typed today joins the existing "eBay" instead of starting a new group.
 */
export function existingSpelling(value: string, existing: Iterable<string>): string {
  const key = nameKey(value);
  if (!key) return value.trim();
  const matches = [...existing].map((e) => e.trim()).filter((e) => nameKey(e) === key);
  return matches.length ? mostCommon(matches) : value.trim();
}

function findItem(data: AppData, id: string): Item {
  const item = data.items.find((i) => i.id === id);
  if (!item) throw new DomainError('That item no longer exists.');
  return item;
}

function replaceItem(items: Item[], updated: Item): Item[] {
  return items.map((i) => (i.id === updated.id ? updated : i));
}

function makeAdjustment(
  item: Item,
  newQuantity: number,
  reason: string,
  source: AdjustmentSource,
  iso: string,
  countId: string | null = null,
): Adjustment {
  const difference = newQuantity - item.quantity;
  return {
    id: newId(),
    itemId: item.id,
    itemName: item.name,
    itemSku: item.sku,
    previousQuantity: item.quantity,
    newQuantity,
    difference,
    unitCost: item.unitCost,
    valueDifference: multiplyMoney(item.unitCost, difference),
    reason,
    source,
    countId,
    date: iso,
  };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export interface ItemInput {
  name: string;
  sku?: string;
  category?: string;
  quantity: number | null;
  unitCost: number | null;
  askingPrice?: number | null;
  estimatedValue?: number | null;
  purchaseDate?: string | null;
  condition?: string;
  location?: string;
  lowStockThreshold?: number | null;
  photoIds?: string[];
  notes?: string;
}

/** Next free "SP-0001" style SKU. */
export function nextSku(items: Item[]): string {
  let max = 0;
  for (const i of items) {
    const m = /^SP-(\d+)$/i.exec(i.sku);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const taken = new Set(items.map((i) => i.sku.toLowerCase()));
  let n = max + 1;
  while (taken.has(`sp-${String(n).padStart(4, '0')}`)) n++;
  return `SP-${String(n).padStart(4, '0')}`;
}

function normalizeItemInput(data: AppData, input: ItemInput, existingId: string | null) {
  const v = new FieldErrors();
  const name = v.check(() => requireText(input.name, 'name', 'Item name'));
  let sku = v.check(() => optionalText(input.sku, 'sku', 'SKU', 64));
  if (sku) {
    const clash = data.items.find((i) => i.id !== existingId && i.sku.toLowerCase() === sku!.toLowerCase());
    if (clash) v.add('sku', `SKU "${sku}" is already used by "${clash.name}".`);
  } else if (sku === '') {
    sku = nextSku(data.items.filter((i) => i.id !== existingId));
  }
  const category = v.check(() => optionalText(input.category, 'category', 'Category', 80));
  const quantity = v.check(() => requireWholeNumber(input.quantity, 'quantity', 'Quantity'));
  const unitCost = v.check(() => requireMoney(input.unitCost, 'unitCost', 'Cost per item', 4));
  const askingPrice = v.check(() => optionalMoney(input.askingPrice, 'askingPrice', 'Asking price'));
  const estimatedValue = v.check(() => optionalMoney(input.estimatedValue, 'estimatedValue', 'Estimated value'));
  const purchaseDate = v.check(() => optionalDate(input.purchaseDate, 'purchaseDate', 'Purchase date'));
  const condition = v.check(() => optionalText(input.condition, 'condition', 'Condition', 80));
  const location = v.check(() => optionalText(input.location, 'location', 'Location', 120));
  const lowStockThreshold =
    input.lowStockThreshold === null || input.lowStockThreshold === undefined
      ? null
      : v.check(() => requireWholeNumber(input.lowStockThreshold, 'lowStockThreshold', 'Low-stock alert level'));
  const notes = v.check(() => optionalText(input.notes, 'notes', 'Notes', 5000));
  v.throwIfAny();
  // Every check passed, so none of the values above is undefined.
  return {
    name: name!,
    sku: sku!,
    category: existingSpelling(category!, [
      ...data.items.filter((i) => i.id !== existingId).map((i) => i.category),
      ...data.sales.filter((s) => s.itemId !== existingId).map((s) => s.itemCategory),
    ]),
    quantity: quantity!,
    unitCost: unitCost!,
    askingPrice: askingPrice as number | null,
    estimatedValue: estimatedValue as number | null,
    purchaseDate: purchaseDate as string | null,
    condition: condition!,
    location: location!,
    lowStockThreshold: lowStockThreshold as number | null,
    photoIds: [...(input.photoIds ?? [])],
    notes: notes!,
  };
}

/** Every problem with an item's fields at once ({} when it would save). */
export function itemInputErrors(data: AppData, input: ItemInput, existingId: string | null): Record<string, string> {
  try {
    normalizeItemInput(data, input, existingId);
    return {};
  } catch (e) {
    if (isDomainError(e)) return e.fields;
    throw e;
  }
}

function withValuePoint(history: ValuePoint[], value: number | null, today: string): ValuePoint[] {
  if (value === null) return history;
  const last = history[history.length - 1];
  if (last && last.value === value) return history;
  const rest = history.filter((p) => p.date !== today);
  return [...rest, { date: today, value }];
}

export function addItem(data: AppData, input: ItemInput, clock?: Clock): { data: AppData; item: Item } {
  const { iso, today } = nowParts(clock);
  const fields = normalizeItemInput(data, input, null);
  const item: Item = {
    id: newId(),
    ...fields,
    valueHistory: withValuePoint([], fields.estimatedValue, today),
    createdAt: iso,
    updatedAt: iso,
  };
  return { data: { ...data, items: [...data.items, item] }, item };
}

export interface UpdateItemOptions {
  /** Also rewrite the cost snapshot on this item's recorded sales (for correcting a typo). */
  applyCostToSales?: boolean;
  /** How a quantity change is labelled in the adjustment log. */
  adjustmentReason?: string;
  adjustmentSource?: AdjustmentSource;
}

export function updateItem(
  data: AppData,
  id: string,
  input: ItemInput,
  options: UpdateItemOptions = {},
  clock?: Clock,
): { data: AppData; item: Item } {
  const { iso, today } = nowParts(clock);
  const existing = findItem(data, id);
  const fields = normalizeItemInput(data, input, id);
  const item: Item = {
    ...existing,
    ...fields,
    valueHistory: withValuePoint(existing.valueHistory, fields.estimatedValue, today),
    updatedAt: iso,
  };
  let adjustments = data.adjustments;
  if (item.quantity !== existing.quantity) {
    adjustments = [
      ...adjustments,
      makeAdjustment(
        { ...existing, unitCost: item.unitCost },
        item.quantity,
        options.adjustmentReason ?? 'Quantity edited',
        options.adjustmentSource ?? 'edit',
        iso,
      ),
    ];
  }
  let sales = data.sales.map((s) =>
    s.itemId === id ? { ...s, itemName: item.name, itemSku: item.sku, itemCategory: item.category } : s,
  );
  if (options.applyCostToSales && item.unitCost !== existing.unitCost) {
    sales = sales.map((s) => (s.itemId === id ? { ...s, unitCost: item.unitCost, updatedAt: iso } : s));
  }
  return { data: { ...data, items: replaceItem(data.items, item), sales, adjustments }, item };
}

/** Removes an item. Its sales stay in history (with their snapshots) so profit records remain accurate. */
export function deleteItem(data: AppData, id: string): { data: AppData; removedPhotoIds: string[] } {
  const item = findItem(data, id);
  let countDraft = data.countDraft;
  if (countDraft && id in countDraft.counts) {
    const counts = { ...countDraft.counts };
    delete counts[id];
    countDraft = { ...countDraft, counts };
  }
  return {
    data: { ...data, items: data.items.filter((i) => i.id !== id), countDraft },
    removedPhotoIds: item.photoIds,
  };
}

/**
 * Adds stock bought at `unitCost`. The item's unit cost becomes the weighted average of
 * what's on hand and what was added, so cost of goods sold stays accurate.
 */
export function restockItem(
  data: AppData,
  id: string,
  addQuantity: number,
  unitCost: number | null,
  clock?: Clock,
): { data: AppData; item: Item } {
  const { iso } = nowParts(clock);
  const item = findItem(data, id);
  const v = new FieldErrors();
  const checkedQty = v.check(() => requireWholeNumber(addQuantity, 'restockQuantity', 'Quantity to add', 1));
  const checkedCost = unitCost === null ? item.unitCost : v.check(() => requireMoney(unitCost, 'restockCost', 'Cost per item', 4));
  v.throwIfAny();
  const qty = checkedQty!;
  const cost = checkedCost!;
  const newQuantity = item.quantity + qty;
  const totalCents = toCents(itemCostValue(item)) + toCents(multiplyMoney(cost, qty));
  const averaged = roundUnitCost(fromCents(totalCents) / newQuantity);
  const updated: Item = { ...item, quantity: newQuantity, unitCost: averaged, updatedAt: iso };
  const adjustment = makeAdjustment({ ...item, unitCost: cost }, newQuantity, `Restocked ${plural(qty, 'unit')}`, 'restock', iso);
  return {
    data: { ...data, items: replaceItem(data.items, updated), adjustments: [...data.adjustments, adjustment] },
    item: updated,
  };
}

/** Sets an item's quantity outside a sale (damaged, lost, found…) and logs the reason. */
export function adjustQuantity(
  data: AppData,
  id: string,
  newQuantity: number,
  reason: string,
  clock?: Clock,
): { data: AppData; adjustment: Adjustment } {
  const { iso } = nowParts(clock);
  const item = findItem(data, id);
  const v = new FieldErrors();
  const checkedQty = v.check(() => requireWholeNumber(newQuantity, 'newQuantity', 'New quantity'));
  const checkedReason = v.check(() => requireText(reason, 'reason', 'Reason', 300));
  if (checkedQty === item.quantity) v.add('newQuantity', 'The quantity is unchanged.');
  v.throwIfAny();
  const qty = checkedQty!;
  const why = checkedReason!;
  const adjustment = makeAdjustment(item, qty, why, 'manual', iso);
  const updated: Item = { ...item, quantity: qty, updatedAt: iso };
  return {
    data: { ...data, items: replaceItem(data.items, updated), adjustments: [...data.adjustments, adjustment] },
    adjustment,
  };
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export interface SaleInput {
  itemId: string;
  quantity: number | null;
  salePrice: number | null;
  priceMode: PriceMode;
  platform?: string;
  fees?: number | null;
  shipping?: number | null;
  otherExpenses?: number | null;
  saleDate: string;
  notes?: string;
}

interface SaleFields {
  quantity: number;
  salePrice: number;
  priceMode: PriceMode;
  platform: string;
  fees: number;
  shipping: number;
  otherExpenses: number;
  saleDate: string;
  notes: string;
}

/** Checks a sale's own fields, recording every problem in `v`. */
function validateSaleFields(input: SaleInput, otherSales: Sale[], v: FieldErrors): Partial<SaleFields> {
  if (!input.itemId) v.add('itemId', 'Choose the item you sold.');
  const quantity = v.check(() => requireWholeNumber(input.quantity, 'quantity', 'Quantity sold', 1));
  const salePrice = v.check(() => requireMoney(input.salePrice, 'salePrice', 'Sale price'));
  if (input.priceMode !== 'per_unit' && input.priceMode !== 'total') {
    v.add('priceMode', 'Choose whether the price is per item or the total.');
  }
  const platform = v.check(() => optionalText(input.platform, 'platform', 'Platform', 80));
  const fees = v.check(() => requireMoney(input.fees ?? 0, 'fees', 'Marketplace fees'));
  const shipping = v.check(() => requireMoney(input.shipping ?? 0, 'shipping', 'Shipping'));
  const otherExpenses = v.check(() => requireMoney(input.otherExpenses ?? 0, 'otherExpenses', 'Other expenses'));
  const saleDate = input.saleDate?.trim();
  if (!saleDate || !isValidISODate(saleDate)) v.add('saleDate', 'Enter a valid sale date.');
  const notes = v.check(() => optionalText(input.notes, 'notes', 'Notes', 2000));
  return {
    quantity,
    salePrice,
    priceMode: input.priceMode,
    platform: platform === undefined ? undefined : existingSpelling(platform, otherSales.map((s) => s.platform)),
    fees,
    shipping,
    otherExpenses,
    saleDate,
    notes,
  };
}

function overSellMessage(item: Item, available: number, requested: number): string {
  return available === 0
    ? `"${item.name}" has no units left to sell.`
    : `Only ${available} of "${item.name}" ${pluralWord(available, 'is', 'are')} available — you entered ${requested}.`;
}

export function recordSale(data: AppData, input: SaleInput, clock?: Clock): { data: AppData; sale: Sale } {
  const { iso } = nowParts(clock);
  const v = new FieldErrors();
  const checked = validateSaleFields(input, data.sales, v);
  const item = input.itemId ? data.items.find((i) => i.id === input.itemId) : undefined;
  if (input.itemId && !item) v.add('itemId', 'That item no longer exists.');
  if (item && checked.quantity !== undefined && checked.quantity > item.quantity) {
    v.add('quantity', overSellMessage(item, item.quantity, checked.quantity));
  }
  v.throwIfAny();
  const fields = checked as SaleFields;
  const sale: Sale = {
    id: newId(),
    itemId: item!.id,
    itemName: item!.name,
    itemSku: item!.sku,
    itemCategory: item!.category,
    unitCost: item!.unitCost,
    ...fields,
    createdAt: iso,
    updatedAt: iso,
  };
  const updatedItem: Item = { ...item!, quantity: item!.quantity - fields.quantity, updatedAt: iso };
  return {
    data: { ...data, items: replaceItem(data.items, updatedItem), sales: [...data.sales, sale] },
    sale,
  };
}

/**
 * Edits a sale. Stock is first returned to the original item, then taken from the (possibly
 * different) item, so quantities are never double-counted.
 */
export function updateSale(data: AppData, id: string, input: SaleInput, clock?: Clock): { data: AppData; sale: Sale } {
  const { iso } = nowParts(clock);
  const existing = data.sales.find((s) => s.id === id);
  if (!existing) throw new DomainError('That sale no longer exists.');
  const v = new FieldErrors();
  const checked = validateSaleFields(
    input,
    data.sales.filter((s) => s.id !== id),
    v,
  );

  let items = data.items;
  const originalItem = items.find((i) => i.id === existing.itemId);
  if (originalItem) {
    items = replaceItem(items, { ...originalItem, quantity: originalItem.quantity + existing.quantity, updatedAt: iso });
  } else if (input.itemId === existing.itemId && checked.quantity !== undefined && checked.quantity !== existing.quantity) {
    // The item was deleted: keep the sale editable, but stock can't be moved.
    v.add('quantity', `"${existing.itemName}" was deleted, so the quantity on this sale can't change.`);
  }

  let target: Item | undefined = input.itemId ? items.find((i) => i.id === input.itemId) : undefined;
  if (input.itemId && !target && input.itemId !== existing.itemId) v.add('itemId', 'That item no longer exists.');
  if (target && checked.quantity !== undefined && checked.quantity > target.quantity) {
    v.add('quantity', overSellMessage(target, target.quantity, checked.quantity));
  }
  v.throwIfAny();
  const fields = checked as SaleFields;
  if (target) {
    target = { ...target, quantity: target.quantity - fields.quantity, updatedAt: iso };
    items = replaceItem(items, target);
  }

  const switchedItem = input.itemId !== existing.itemId && target;
  const sale: Sale = {
    ...existing,
    ...fields,
    itemId: input.itemId,
    itemName: switchedItem ? target!.name : existing.itemName,
    itemSku: switchedItem ? target!.sku : existing.itemSku,
    itemCategory: switchedItem ? target!.category : existing.itemCategory,
    unitCost: switchedItem ? target!.unitCost : existing.unitCost,
    updatedAt: iso,
  };
  return { data: { ...data, items, sales: data.sales.map((s) => (s.id === id ? sale : s)) }, sale };
}

/** Every problem with a sale's fields at once ({} when it would save). */
export function saleInputErrors(data: AppData, input: SaleInput, saleId: string | null): Record<string, string> {
  try {
    if (saleId) updateSale(data, saleId, input);
    else recordSale(data, input);
    return {};
  } catch (e) {
    if (isDomainError(e)) return e.fields;
    throw e;
  }
}

/** Cancels a sale and returns its units to stock (when the item still exists). */
export function deleteSale(data: AppData, id: string, clock?: Clock): { data: AppData; restored: boolean } {
  const { iso } = nowParts(clock);
  const sale = data.sales.find((s) => s.id === id);
  if (!sale) throw new DomainError('That sale no longer exists.');
  const item = data.items.find((i) => i.id === sale.itemId);
  const items = item
    ? replaceItem(data.items, { ...item, quantity: item.quantity + sale.quantity, updatedAt: iso })
    : data.items;
  return { data: { ...data, items, sales: data.sales.filter((s) => s.id !== id) }, restored: Boolean(item) };
}

// ---------------------------------------------------------------------------
// Count Check (physical inventory reconciliation)
// ---------------------------------------------------------------------------

export function itemsInScope(items: Item[], scope: CountScope): Item[] {
  return items.filter(
    (i) =>
      (scope.category === null || i.category.toLowerCase() === scope.category.toLowerCase()) &&
      (scope.location === null || i.location.toLowerCase() === scope.location.toLowerCase()),
  );
}

export function startCount(data: AppData, scope: CountScope, clock?: Clock): AppData {
  const { iso } = nowParts(clock);
  if (data.countDraft) throw new DomainError('A count is already in progress. Finish or discard it first.');
  if (itemsInScope(data.items, scope).length === 0) throw new DomainError('There are no items to count in that selection.');
  return { ...data, countDraft: { id: newId(), startedAt: iso, scope, counts: {} } };
}

export function setCount(data: AppData, itemId: string, counted: number | null): AppData {
  if (!data.countDraft) throw new DomainError('Start a count first.');
  const counts = { ...data.countDraft.counts };
  if (counted === null) delete counts[itemId];
  else counts[itemId] = requireWholeNumber(counted, `count-${itemId}`, 'Counted quantity');
  return { ...data, countDraft: { ...data.countDraft, counts } };
}

export function discardCount(data: AppData): AppData {
  return { ...data, countDraft: null };
}

export interface CountComparison {
  lines: CountLine[];
  uncounted: Item[];
  totalInScope: number;
  matching: number;
  missingUnits: number;
  excessUnits: number;
  missingValue: number;
  excessValue: number;
  netValueDifference: number;
}

/** Compares counted quantities against current recorded quantities. */
export function compareCount(items: Item[], draft: CountDraft): CountComparison {
  const scoped = itemsInScope(items, draft.scope);
  const lines: CountLine[] = [];
  const uncounted: Item[] = [];
  for (const item of scoped) {
    const counted = draft.counts[item.id];
    if (counted === undefined) {
      uncounted.push(item);
      continue;
    }
    const difference = counted - item.quantity;
    lines.push({
      itemId: item.id,
      itemName: item.name,
      itemSku: item.sku,
      recordedQuantity: item.quantity,
      countedQuantity: counted,
      difference,
      unitCost: item.unitCost,
      valueDifference: multiplyMoney(item.unitCost, difference),
      status: difference === 0 ? 'match' : difference < 0 ? 'missing' : 'excess',
      applied: false,
      reason: '',
    });
  }
  const missing = lines.filter((l) => l.status === 'missing');
  const excess = lines.filter((l) => l.status === 'excess');
  const missingValue = fromCents(missing.reduce((c, l) => c + toCents(l.valueDifference), 0));
  const excessValue = fromCents(excess.reduce((c, l) => c + toCents(l.valueDifference), 0));
  return {
    lines,
    uncounted,
    totalInScope: scoped.length,
    matching: lines.length - missing.length - excess.length,
    missingUnits: missing.reduce((n, l) => n - l.difference, 0),
    excessUnits: excess.reduce((n, l) => n + l.difference, 0),
    missingValue,
    excessValue,
    netValueDifference: fromCents(toCents(missingValue) + toCents(excessValue)),
  };
}

export interface CountDecision {
  itemId: string;
  apply: boolean;
  reason: string;
}

/**
 * Finishes the count: approved discrepancies set the item quantity to the counted number and
 * are logged as adjustments with their reason. The full comparison is kept in count history.
 */
export function completeCount(
  data: AppData,
  decisions: CountDecision[],
  clock?: Clock,
): { data: AppData; record: CountRecord; appliedCount: number } {
  const { iso } = nowParts(clock);
  const draft = data.countDraft;
  if (!draft) throw new DomainError('There is no count in progress.');
  const comparison = compareCount(data.items, draft);
  if (comparison.lines.length === 0) throw new DomainError('Enter at least one counted quantity before finishing.');
  const byItem = new Map(decisions.map((d) => [d.itemId, d]));

  let items = data.items;
  const adjustments: Adjustment[] = [];
  const lines = comparison.lines.map((line) => {
    const decision = byItem.get(line.itemId);
    if (line.status === 'match' || !decision?.apply) return { ...line, reason: decision?.reason.trim() ?? '' };
    const reason = decision.reason.trim() || (line.status === 'missing' ? 'Missing at count' : 'Extra found at count');
    const item = items.find((i) => i.id === line.itemId)!;
    adjustments.push(makeAdjustment(item, line.countedQuantity, reason, 'count_check', iso, draft.id));
    items = replaceItem(items, { ...item, quantity: line.countedQuantity, updatedAt: iso });
    return { ...line, applied: true, reason };
  });

  const record: CountRecord = { id: draft.id, startedAt: draft.startedAt, completedAt: iso, scope: draft.scope, lines };
  return {
    data: {
      ...data,
      items,
      adjustments: [...data.adjustments, ...adjustments],
      countDraft: null,
      countHistory: [...data.countHistory, record],
    },
    record,
    appliedCount: adjustments.length,
  };
}

// ---------------------------------------------------------------------------
// Value snapshots
// ---------------------------------------------------------------------------

/** Records today's inventory totals (one point per day) for value-over-time charts. */
export function upsertSnapshot(data: AppData, today: string = todayISO()): AppData {
  const inStock = data.items.filter((i) => i.quantity > 0);
  const cost = fromCents(inStock.reduce((c, i) => c + toCents(itemCostValue(i)), 0));
  const value = fromCents(
    inStock.reduce((c, i) => c + toCents(multiplyMoney(i.estimatedValue ?? i.unitCost, i.quantity)), 0),
  );
  const units = inStock.reduce((n, i) => n + i.quantity, 0);
  const last = data.snapshots[data.snapshots.length - 1];
  if (last && last.date === today && last.cost === cost && last.value === value && last.units === units) return data;
  const snapshots = data.snapshots.filter((s) => s.date !== today);
  snapshots.push({ date: today, units, cost, value });
  snapshots.sort((a, b) => a.date.localeCompare(b.date));
  // Keep a bounded history (~3 years of daily points).
  return { ...data, snapshots: snapshots.slice(-1100) };
}
