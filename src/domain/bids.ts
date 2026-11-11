// Max Bid Calculator: the most to bid for a lot (storage unit, pallet, estate-sale box…) so that,
// if the user's own estimates hold, the whole purchase still earns the target return.
//
// For each scenario (conservative / expected / optimistic):
//   resale value         = your estimate × resale %                         (scenario)
//   expected sales       = resale value × (100% − unsold %)                 (only what sells)
//   selling fees         = expected sales × selling fee %
//   outbound shipping    = $ per item × items expected to sell, or % of expected sales
//   net proceeds         = expected sales − selling fees − shipping
//   max all-in cost      = net proceeds ÷ (1 + target ROI)                  (rounded down)
//   all-in cost of a bid = bid + buyer's premium (% of bid) + sales tax (% of bid, and of the
//                          premium if it's taxed) + fixed buying costs
//   max bid              = the largest bid, in whole cents, whose all-in cost ≤ max all-in cost
//
// Each cost is counted once, where it happens: selling costs only on what sells, buying costs
// on the bid. Everything is integer cents (percentages as basis points), rounded half up for
// costs and DOWN for the maximums, so the recommendation never exceeds what the target allows.
//
// Resale estimates are always the user's. AI identification fills in names and details only.
// Bid plans are planning data: nothing here changes inventory, sales or money figures, except
// recordBidPurchase, which creates the lot through the ordinary bulk lot workflow.

import type {
  AppData,
  BidAssumptions,
  BidFixedCost,
  BidItem,
  BidLotKind,
  BidPlan,
  BidPlanStatus,
  BidScenarioInputs,
  BidScenarioKey,
  BidScenarioSnapshot,
  BidSnapshot,
  Item,
  Lot,
} from './types';
import { DomainError, FieldErrors, isDomainError } from './errors';
import { newId } from './ids';
import { fromCents, toCents } from './money';
import { nowParts, optionalMoney, optionalText, requireText, requireWholeNumber, type Clock } from './actions';
import { createLot, lotTotal, type LotInput } from './lots';

export const BID_LIMITS = { items: 200, quantityPerItem: 100_000, itemCount: 1_000_000, fixedCosts: 10, maxRoiPct: 1000, maxResalePct: 300 } as const;

export const SCENARIO_KEYS: readonly BidScenarioKey[] = ['conservative', 'expected', 'optimistic'];

export const SCENARIO_LABELS: Record<BidScenarioKey, string> = {
  conservative: 'Conservative',
  expected: 'Expected',
  optimistic: 'Optimistic',
};

export const KIND_LABELS: Record<BidLotKind, string> = {
  storage_unit: 'Storage-unit auction',
  pallet: 'Liquidation pallet',
  estate_sale: 'Estate-sale lot',
  garage_sale: 'Garage-sale bundle',
  collectibles: 'Bulk collectibles',
  retail_lot: 'Retail inventory lot',
  other: 'Other bulk purchase',
};

export const STATUS_LABELS: Record<BidPlanStatus, string> = {
  draft: 'Planning',
  purchased: 'Purchased',
  passed: 'Passed',
  lost: 'Lost',
};

/** Starting assumptions for a new plan. Shown in the form, and all editable. */
export const DEFAULT_SCENARIOS: Record<BidScenarioKey, Required<{ [K in keyof BidScenarioInputs]: number }>> = {
  conservative: { resalePct: 80, unsoldPct: 30, sellingFeePct: 18 },
  expected: { resalePct: 100, unsoldPct: 20, sellingFeePct: 15 },
  optimistic: { resalePct: 110, unsoldPct: 10, sellingFeePct: 15 },
};

export function defaultAssumptions(): BidAssumptions {
  return {
    valueMode: 'total',
    totalResaleValue: null,
    itemCount: null,
    items: [],
    shippingMode: 'per_item',
    shippingValue: 0,
    fixedCosts: [],
    buyerPremiumPct: 0,
    salesTaxPct: 0,
    taxOnPremium: true,
    targetRoiPct: 100,
    budget: null,
    plannedBid: null,
    scenarios: {
      conservative: { ...DEFAULT_SCENARIOS.conservative },
      expected: { ...DEFAULT_SCENARIOS.expected },
      optimistic: { ...DEFAULT_SCENARIOS.optimistic },
    },
  };
}

// ---------------------------------------------------------------------------
// Integer arithmetic
// ---------------------------------------------------------------------------

/** A percentage (up to 2 decimals) as basis points: 15 → 1500, 13.25 → 1325. */
const bp = (pct: number) => Math.round(pct * 100);

/** cents × percentage, rounded half up to a whole cent. Both non-negative. */
function pctOf(cents: number, basisPoints: number): number {
  return Number((BigInt(cents) * BigInt(basisPoints) + 5000n) / 10000n);
}

/** What a bid costs in total: the bid, buyer's premium, sales tax and fixed costs (all cents). */
function allInCents(bid: number, c: CostRates): { premium: number; tax: number; total: number } {
  const premium = pctOf(bid, c.premiumBp);
  const tax = pctOf(c.taxOnPremium ? bid + premium : bid, c.taxBp);
  return { premium, tax, total: bid + premium + tax + c.fixed };
}

interface CostRates {
  premiumBp: number;
  taxBp: number;
  taxOnPremium: boolean;
  fixed: number;
}

/**
 * The largest bid (whole cents) whose all-in cost is at most `capCents`, or null when no
 * positive bid fits. Starts from the exact algebraic answer, then corrects for cent rounding
 * of the premium and tax.
 */
function largestBid(capCents: number, c: CostRates): number | null {
  const room = capCents - c.fixed;
  if (room <= 0) return null;
  const p = BigInt(10000 + c.premiumBp);
  const t = BigInt(10000 + c.taxBp);
  let bid = c.taxOnPremium
    ? Number((BigInt(room) * 100_000_000n) / (p * t))
    : Number((BigInt(room) * 10_000n) / BigInt(10000 + c.premiumBp + c.taxBp));
  while (bid > 0 && allInCents(bid, c).total > capCents) bid--;
  while (allInCents(bid + 1, c).total <= capCents) bid++;
  return bid > 0 ? bid : null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface BidPlanInput {
  name: string;
  description: string;
  kind: BidLotKind;
  assumptions: BidAssumptions;
}

const AI_FIELDS = ['name', 'category', 'condition', 'notes'];

function checkPct(v: FieldErrors, value: number | null, field: string, label: string, max: number): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value)) {
    v.add(field, `${label} must be a number.`);
    return null;
  }
  if (value < 0) v.add(field, `${label} can't be negative.`);
  else if (value > max) v.add(field, `${label} can be at most ${max}%.`);
  else if (Math.abs(value * 100 - Math.round(value * 100)) > 1e-6) v.add(field, `${label} can have at most 2 decimals.`);
  else return value;
  return null;
}

function checkItems(items: BidItem[], v: FieldErrors): BidItem[] {
  if (items.length > BID_LIMITS.items) v.add('items', `A plan can have up to ${BID_LIMITS.items} items.`);
  return items.flatMap((it, i) => {
    const key = (f: string) => `item.${i}.${f}`;
    const name = v.check(() => requireText(it.name, key('name'), 'Item name')) ?? '';
    let quantity = v.check(() => requireWholeNumber(it.quantity, key('quantity'), 'Quantity', 1)) ?? 1;
    if (quantity > BID_LIMITS.quantityPerItem) {
      v.add(key('quantity'), `Quantity can be at most ${BID_LIMITS.quantityPerItem.toLocaleString()}.`);
      quantity = 1;
    }
    return [
      {
        id: it.id || newId(),
        name,
        quantity,
        unitValue: v.check(() => optionalMoney(it.unitValue, key('unitValue'), 'Resale estimate')) ?? null,
        category: v.check(() => optionalText(it.category, key('category'), 'Category', 80)) ?? '',
        condition: v.check(() => optionalText(it.condition, key('condition'), 'Condition', 80)) ?? '',
        notes: v.check(() => optionalText(it.notes, key('notes'), 'Notes', 2000)) ?? '',
        aiFields: (it.aiFields ?? []).filter((f) => AI_FIELDS.includes(f)),
      },
    ];
  });
}

function checkFixedCosts(costs: BidFixedCost[], v: FieldErrors): BidFixedCost[] {
  if (costs.length > BID_LIMITS.fixedCosts) v.add('fixedCosts', `A plan can have up to ${BID_LIMITS.fixedCosts} fixed costs.`);
  return costs.flatMap((c, i) => {
    const label = v.check(() => optionalText(c.label, `fixed.${i}.label`, 'Cost name', 80)) ?? '';
    // A row left completely empty is ignored.
    if (c.amount === null && !label) return [];
    const amount = v.check(() => optionalMoney(c.amount, `fixed.${i}.amount`, 'Amount')) ?? null;
    return [{ id: c.id || newId(), label, amount }];
  });
}

/** Checks the format and range of everything typed. Missing numbers are allowed (a draft). */
function checkAssumptions(a: BidAssumptions, v: FieldErrors): BidAssumptions {
  const itemCount = a.itemCount === null ? null : v.check(() => requireWholeNumber(a.itemCount, 'itemCount', 'Number of items', 1)) ?? null;
  if (itemCount !== null && itemCount > BID_LIMITS.itemCount) v.add('itemCount', `Number of items can be at most ${BID_LIMITS.itemCount.toLocaleString()}.`);
  const shippingValue =
    a.shippingMode === 'percent'
      ? checkPct(v, a.shippingValue, 'shippingValue', 'Shipping', 100)
      : (v.check(() => optionalMoney(a.shippingValue, 'shippingValue', 'Shipping per item')) ?? null);
  const scenarios = Object.fromEntries(
    SCENARIO_KEYS.map((k) => {
      const s = a.scenarios?.[k] ?? DEFAULT_SCENARIOS[k];
      const label = SCENARIO_LABELS[k].toLowerCase();
      return [
        k,
        {
          resalePct: checkPct(v, s.resalePct, `scenario.${k}.resalePct`, `Resale value (${label})`, BID_LIMITS.maxResalePct),
          unsoldPct: checkPct(v, s.unsoldPct, `scenario.${k}.unsoldPct`, `Unsold share (${label})`, 100),
          sellingFeePct: checkPct(v, s.sellingFeePct, `scenario.${k}.sellingFeePct`, `Selling fees (${label})`, 100),
        },
      ];
    }),
  ) as Record<BidScenarioKey, BidScenarioInputs>;
  return {
    valueMode: a.valueMode === 'items' ? 'items' : 'total',
    totalResaleValue: v.check(() => optionalMoney(a.totalResaleValue, 'totalResaleValue', 'Estimated resale value')) ?? null,
    itemCount,
    items: checkItems(a.items, v),
    shippingMode: a.shippingMode === 'percent' ? 'percent' : 'per_item',
    shippingValue,
    fixedCosts: checkFixedCosts(a.fixedCosts, v),
    buyerPremiumPct: checkPct(v, a.buyerPremiumPct, 'buyerPremiumPct', "Buyer's premium", 100),
    salesTaxPct: checkPct(v, a.salesTaxPct, 'salesTaxPct', 'Sales tax', 100),
    taxOnPremium: a.taxOnPremium !== false,
    targetRoiPct: checkPct(v, a.targetRoiPct, 'targetRoiPct', 'Target ROI', BID_LIMITS.maxRoiPct),
    budget: v.check(() => optionalMoney(a.budget, 'budget', 'Budget')) ?? null,
    plannedBid: v.check(() => optionalMoney(a.plannedBid, 'plannedBid', 'Your planned bid')) ?? null,
    scenarios,
  };
}

const KINDS = Object.keys(KIND_LABELS) as BidLotKind[];

function checkPlan(input: BidPlanInput): BidPlanInput {
  const v = new FieldErrors();
  const name = v.check(() => requireText(input.name, 'name', 'Lot name', 120));
  const description = v.check(() => optionalText(input.description, 'description', 'Description', 2000));
  const assumptions = checkAssumptions(input.assumptions, v);
  v.throwIfAny();
  return { name: name!, description: description!, kind: KINDS.includes(input.kind) ? input.kind : 'other', assumptions };
}

/** Every format/range problem at once ({} when the plan can be saved as a draft). */
export function bidPlanErrors(input: BidPlanInput): Record<string, string> {
  try {
    checkPlan(input);
    return {};
  } catch (e) {
    if (isDomainError(e)) return e.fields;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// The calculation
// ---------------------------------------------------------------------------

/** What a particular bid would cost in total, and what it would earn if the scenario holds. */
export interface BidCosts {
  bid: number;
  buyerPremium: number;
  salesTax: number;
  fixedCosts: number;
  allIn: number;
  profit: number;
  /** profit ÷ all-in cost × 100; null when the all-in cost is 0. */
  roiPct: number | null;
}

export interface ScenarioResult {
  key: BidScenarioKey;
  resalePct: number;
  unsoldPct: number;
  sellingFeePct: number;
  /** Your estimate (100%). */
  estimatedResale: number;
  /** Your estimate × resale %. */
  scenarioResale: number;
  /** The part of it expected not to sell. */
  unsoldValue: number;
  /** Expected sale proceeds: what's expected to sell, at the scenario's prices. */
  expectedSales: number;
  sellingFees: number;
  shipping: number;
  sellingExpenses: number;
  netProceeds: number;
  /** The most the whole purchase can cost and still reach the target ROI. */
  maxAllIn: number;
  fixedCosts: number;
  /** null when no positive bid makes sense; see noBidReason. */
  maxBid: number | null;
  atMaxBid: BidCosts | null;
  noBidReason: string | null;
  /** The largest bid the budget allows (null without a budget, or if it can't cover the fixed costs). */
  budgetBid: number | null;
  /** min(max bid, budget bid). */
  recommendedBid: number | null;
  limitedBy: 'target' | 'budget' | null;
  atRecommendedBid: BidCosts | null;
  /** The user's planned bid, if entered. */
  atPlannedBid: BidCosts | null;
}

export interface BidCalculation {
  ok: true;
  /** Number of items (for per-item shipping), when known. */
  itemCount: number | null;
  targetRoiPct: number;
  budget: number | null;
  plannedBid: number | null;
  scenarios: Record<BidScenarioKey, ScenarioResult>;
  /** Plain-language account of what drives the expected result. */
  drivers: string[];
  warnings: string[];
}

export type BidCalcResult = BidCalculation | { ok: false; missing: Record<string, string> };

const money = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pctText = (n: number) => `${Number(n.toFixed(2))}%`;

function costsAt(bid: number, rates: CostRates, netCents: number): BidCosts {
  const c = allInCents(bid, rates);
  const profit = netCents - c.total;
  return {
    bid: fromCents(bid),
    buyerPremium: fromCents(c.premium),
    salesTax: fromCents(c.tax),
    fixedCosts: fromCents(rates.fixed),
    allIn: fromCents(c.total),
    profit: fromCents(profit),
    roiPct: c.total > 0 ? Math.round((profit / c.total) * 10000) / 100 : null,
  };
}

/** What's missing before a max bid can be calculated ({} when nothing is). */
export function missingForCalculation(a: BidAssumptions): Record<string, string> {
  const m: Record<string, string> = {};
  if (a.valueMode === 'total') {
    if (a.totalResaleValue === null) m.totalResaleValue = 'Enter your estimated total resale value for the lot.';
    else if (toCents(a.totalResaleValue) <= 0) m.totalResaleValue = 'The estimated resale value must be more than 0.';
  } else {
    if (!a.items.length) m.items = 'Add the items you expect in the lot, with your resale estimate for each.';
    a.items.forEach((it, i) => {
      if (it.unitValue === null) m[`item.${i}.unitValue`] = 'Enter your resale estimate for one of these.';
    });
    if (a.items.length && a.items.every((it) => it.unitValue !== null) && a.items.every((it) => toCents(it.unitValue!) === 0)) {
      m.items = 'Your item estimates add up to 0, so there’s nothing to bid against.';
    }
  }
  if (a.targetRoiPct === null) m.targetRoiPct = 'Enter the return you want (e.g. 100%).';
  for (const k of SCENARIO_KEYS) {
    const s = a.scenarios[k];
    const label = SCENARIO_LABELS[k].toLowerCase();
    if (s.resalePct === null) m[`scenario.${k}.resalePct`] = `Enter the resale value % for the ${label} scenario.`;
    if (s.unsoldPct === null) m[`scenario.${k}.unsoldPct`] = `Enter the unsold % for the ${label} scenario.`;
    if (s.sellingFeePct === null) m[`scenario.${k}.sellingFeePct`] = `Enter the selling fee % for the ${label} scenario (0 if none).`;
  }
  const perItemShipping = a.shippingMode === 'per_item' && a.shippingValue !== null && toCents(a.shippingValue) > 0;
  if (perItemShipping && a.valueMode === 'total' && a.itemCount === null) {
    m.itemCount = 'Enter roughly how many items are in the lot, so shipping per item can be counted.';
  }
  return m;
}

function units(a: BidAssumptions): number | null {
  return a.valueMode === 'items' ? a.items.reduce((n, it) => n + it.quantity, 0) : a.itemCount;
}

function estimateCents(a: BidAssumptions): number {
  return a.valueMode === 'items' ? a.items.reduce((c, it) => c + toCents(it.unitValue ?? 0) * it.quantity, 0) : toCents(a.totalResaleValue ?? 0);
}

/**
 * Calculates every scenario. Assumes the inputs passed bidPlanErrors (format and range);
 * returns what's missing instead of a result when a required estimate isn't there yet.
 */
export function calculateBid(raw: BidAssumptions): BidCalcResult {
  const v = new FieldErrors();
  const a = checkAssumptions(raw, v);
  if (Object.keys(v.errors).length) return { ok: false, missing: { ...v.errors } };
  const missing = missingForCalculation(a);
  if (Object.keys(missing).length) return { ok: false, missing };

  const estimate = estimateCents(a);
  const itemCount = units(a);
  const roiBp = bp(a.targetRoiPct!);
  const rates: CostRates = {
    premiumBp: bp(a.buyerPremiumPct ?? 0),
    taxBp: bp(a.salesTaxPct ?? 0),
    taxOnPremium: a.taxOnPremium,
    fixed: a.fixedCosts.reduce((c, f) => c + toCents(f.amount ?? 0), 0),
  };
  const budget = a.budget === null ? null : toCents(a.budget);
  const planned = a.plannedBid === null ? null : toCents(a.plannedBid);

  const scenario = (key: BidScenarioKey): ScenarioResult => {
    const s = a.scenarios[key] as Required<{ [K in keyof BidScenarioInputs]: number }>;
    const resale = pctOf(estimate, bp(s.resalePct));
    const sellBp = 10000 - bp(s.unsoldPct);
    const sales = pctOf(resale, sellBp);
    const fees = pctOf(sales, bp(s.sellingFeePct));
    const shippingCents =
      a.shippingMode === 'percent'
        ? pctOf(sales, bp(a.shippingValue ?? 0))
        : // $ per item × items expected to sell (an expected value, so it can be fractional)
          Number((BigInt(toCents(a.shippingValue ?? 0)) * BigInt(itemCount ?? 0) * BigInt(sellBp) + 5000n) / 10000n);
    const net = sales - fees - shippingCents;
    // Rounded down: the target can't be missed by a rounding cent.
    const maxAllIn = net > 0 ? Number((BigInt(net) * 10000n) / BigInt(10000 + roiBp)) : 0;
    const maxBid = net > 0 ? largestBid(maxAllIn, rates) : null;
    let noBidReason: string | null = null;
    if (maxBid === null) {
      if (sales === 0) noBidReason = s.unsoldPct >= 100 ? 'With 100% expected not to sell, nothing is expected to sell, so there’s no price worth paying.' : 'The expected sales are $0.00, so there’s no price worth paying.';
      else if (net <= 0)
        noBidReason = `Selling costs (${money(fees + shippingCents)}) would use up all of the expected sales (${money(sales)}), so no price would earn a profit.`;
      else if (rates.fixed >= maxAllIn)
        noBidReason = `Your fixed buying costs (${money(rates.fixed)}) already use up the most you can spend in total (${money(maxAllIn)}) and still reach a ${pctText(a.targetRoiPct!)} return.`;
      else noBidReason = `After buying costs, no bid of at least $0.01 stays within ${money(maxAllIn)} in total.`;
    }
    const budgetBid = budget === null ? null : largestBid(budget, rates);
    const recommended = maxBid === null ? null : budget === null ? maxBid : budgetBid === null ? null : Math.min(maxBid, budgetBid);
    return {
      key,
      resalePct: s.resalePct,
      unsoldPct: s.unsoldPct,
      sellingFeePct: s.sellingFeePct,
      estimatedResale: fromCents(estimate),
      scenarioResale: fromCents(resale),
      unsoldValue: fromCents(resale - sales),
      expectedSales: fromCents(sales),
      sellingFees: fromCents(fees),
      shipping: fromCents(shippingCents),
      sellingExpenses: fromCents(fees + shippingCents),
      netProceeds: fromCents(net),
      maxAllIn: fromCents(maxAllIn),
      fixedCosts: fromCents(rates.fixed),
      maxBid: maxBid === null ? null : fromCents(maxBid),
      atMaxBid: maxBid === null ? null : costsAt(maxBid, rates, net),
      noBidReason,
      budgetBid: budgetBid === null ? null : fromCents(budgetBid),
      recommendedBid: recommended === null ? null : fromCents(recommended),
      limitedBy: recommended === null ? null : budgetBid !== null && budgetBid < maxBid! ? 'budget' : 'target',
      atRecommendedBid: recommended === null ? null : costsAt(recommended, rates, net),
      atPlannedBid: planned === null ? null : costsAt(planned, rates, net),
    };
  };

  const scenarios = Object.fromEntries(SCENARIO_KEYS.map((k) => [k, scenario(k)])) as Record<BidScenarioKey, ScenarioResult>;
  return {
    ok: true,
    itemCount,
    targetRoiPct: a.targetRoiPct!,
    budget: a.budget,
    plannedBid: a.plannedBid,
    scenarios,
    drivers: drivers(a, scenarios.expected, rates),
    warnings: warnings(a, scenarios, rates, budget),
  };
}

function drivers(a: BidAssumptions, e: ScenarioResult, rates: CostRates): string[] {
  const c = (n: number) => money(toCents(n));
  const out = [
    `Your resale estimate: ${c(e.estimatedResale)}${a.valueMode === 'items' ? ` for ${a.items.length} item ${a.items.length === 1 ? 'line' : 'lines'}` : ''}${e.resalePct !== 100 ? `, taken at ${pctText(e.resalePct)} in this scenario (${c(e.scenarioResale)})` : ''}.`,
    `${pctText(e.unsoldPct)} expected not to sell (${c(e.unsoldValue)}), leaving ${c(e.expectedSales)} of expected sales.`,
    `Selling fees of ${pctText(e.sellingFeePct)} (${c(e.sellingFees)}) and outbound shipping of ${c(e.shipping)}${
      a.shippingMode === 'percent' ? ` (${pctText(a.shippingValue ?? 0)} of sales)` : toCents(a.shippingValue ?? 0) > 0 ? ` (${c(a.shippingValue ?? 0)} per item sold)` : ''
    } leave ${c(e.netProceeds)} of net proceeds.`,
    `A ${pctText(a.targetRoiPct!)} target return means spending at most ${c(e.netProceeds)} ÷ ${Number((1 + a.targetRoiPct! / 100).toFixed(4))} = ${c(e.maxAllIn)} in total.`,
  ];
  const buying: string[] = [];
  if (rates.fixed > 0) buying.push(`${money(rates.fixed)} of fixed buying costs`);
  if (rates.premiumBp > 0) buying.push(`a ${pctText(rates.premiumBp / 100)} buyer’s premium`);
  if (rates.taxBp > 0) buying.push(`${pctText(rates.taxBp / 100)} sales tax${rates.premiumBp > 0 ? (a.taxOnPremium ? ' (on the bid and premium)' : ' (on the bid only)') : ''}`);
  if (e.maxBid !== null) {
    out.push(buying.length ? `After ${buying.join(', ')}, the highest bid that fits is ${c(e.maxBid)}.` : `With no other buying costs, that is the maximum bid: ${c(e.maxBid)}.`);
  }
  return out;
}

function warnings(a: BidAssumptions, s: Record<BidScenarioKey, ScenarioResult>, rates: CostRates, budget: number | null): string[] {
  const out: string[] = [];
  const bid = (k: BidScenarioKey) => s[k].maxBid ?? 0;
  if (bid('conservative') > bid('expected')) out.push('Your conservative scenario gives a higher maximum bid than the expected one. Check its assumptions.');
  if (bid('optimistic') < bid('expected')) out.push('Your optimistic scenario gives a lower maximum bid than the expected one. Check its assumptions.');
  if (a.targetRoiPct === 0) out.push('A 0% target return means breaking even at best, before your time, travel and risk.');
  if (budget !== null && rates.fixed >= budget) out.push(`Your budget doesn’t cover the fixed buying costs (${money(rates.fixed)}), so it leaves nothing for a bid.`);
  if (a.valueMode === 'items' && a.items.some((it) => it.aiFields.length)) {
    out.push('Some item details came from the AI scanner. It identifies items only: the resale estimates are yours.');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Snapshots (for a later predicted vs actual comparison)
// ---------------------------------------------------------------------------

export function takeSnapshot(a: BidAssumptions, iso: string): BidSnapshot {
  const calc = calculateBid(a);
  const results = Object.fromEntries(
    SCENARIO_KEYS.map((k) => {
      if (!calc.ok) return [k, null];
      const r = calc.scenarios[k];
      const snap: BidScenarioSnapshot = {
        maxBid: r.maxBid,
        maxAllIn: r.maxAllIn,
        expectedSales: r.expectedSales,
        sellingFees: r.sellingFees,
        shipping: r.shipping,
        netProceeds: r.netProceeds,
        allInAtMaxBid: r.atMaxBid?.allIn ?? null,
        profitAtMaxBid: r.atMaxBid?.profit ?? null,
        roiAtMaxBidPct: r.atMaxBid?.roiPct ?? null,
      };
      return [k, snap];
    }),
  ) as Record<BidScenarioKey, BidScenarioSnapshot | null>;
  return { takenAt: iso, assumptions: structuredClone(a), results, recommendedBid: calc.ok ? calc.scenarios.expected.recommendedBid : null };
}

// ---------------------------------------------------------------------------
// Saving plans
// ---------------------------------------------------------------------------

function findPlan(data: AppData, id: string): BidPlan {
  const plan = data.bidPlans.find((p) => p.id === id);
  if (!plan) throw new DomainError('That bid plan no longer exists.');
  return plan;
}

const replacePlan = (data: AppData, plan: BidPlan): AppData => ({ ...data, bidPlans: data.bidPlans.map((p) => (p.id === plan.id ? plan : p)) });

/** Saves a new plan as a draft. Creates no inventory, purchase, expense or sale. */
export function createBidPlan(data: AppData, input: BidPlanInput, clock?: Clock): { data: AppData; plan: BidPlan } {
  const { iso } = nowParts(clock);
  const checked = checkPlan(input);
  const plan: BidPlan = { id: newId(), ...checked, status: 'draft', snapshot: null, purchase: null, history: [], duplicatedFromId: null, createdAt: iso, updatedAt: iso };
  return { data: { ...data, bidPlans: [plan, ...data.bidPlans] }, plan };
}

/** Edits a plan that's still being planned. Recorded decisions keep their assumptions. */
export function updateBidPlan(data: AppData, id: string, input: BidPlanInput, clock?: Clock): { data: AppData; plan: BidPlan } {
  const { iso } = nowParts(clock);
  const plan = findPlan(data, id);
  if (plan.status !== 'draft') {
    throw new DomainError(
      plan.status === 'purchased'
        ? 'This plan is recorded as purchased, so its original estimate is kept as it was. Duplicate it to try other assumptions.'
        : `This plan is marked “${STATUS_LABELS[plan.status].toLowerCase()}”. Reopen it to change its assumptions.`,
    );
  }
  const checked = checkPlan(input);
  const next: BidPlan = { ...plan, ...checked, updatedAt: iso };
  return { data: replacePlan(data, next), plan: next };
}

/** A copy of a plan's assumptions as a new draft (to test another scenario). */
export function duplicateBidPlan(data: AppData, id: string, clock?: Clock): { data: AppData; plan: BidPlan } {
  const { iso } = nowParts(clock);
  const source = findPlan(data, id);
  const assumptions = structuredClone(source.assumptions);
  assumptions.items = assumptions.items.map((it) => ({ ...it, id: newId() }));
  assumptions.fixedCosts = assumptions.fixedCosts.map((c) => ({ ...c, id: newId() }));
  const base = `${source.name} (copy)`;
  const plan: BidPlan = {
    id: newId(),
    name: base.length > 120 ? `${source.name.slice(0, 113)} (copy)` : base,
    description: source.description,
    kind: source.kind,
    status: 'draft',
    assumptions,
    snapshot: null,
    purchase: null,
    history: [],
    duplicatedFromId: source.id,
    createdAt: iso,
    updatedAt: iso,
  };
  return { data: { ...data, bidPlans: [plan, ...data.bidPlans] }, plan };
}

/** Passed, lost, or back to planning. Purchases are recorded with recordBidPurchase. */
export function setBidPlanStatus(data: AppData, id: string, to: 'draft' | 'passed' | 'lost', note = '', clock?: Clock): { data: AppData; plan: BidPlan } {
  const { iso } = nowParts(clock);
  const plan = findPlan(data, id);
  if (plan.status === 'purchased') throw new DomainError('This plan is recorded as purchased. Its lot is in your inventory, so the plan can’t be reopened.');
  if (plan.status === to) return { data, plan };
  const cleanNote = optionalText(note, 'note', 'Note', 500);
  const next: BidPlan = { ...plan, status: to, history: [...plan.history, { id: newId(), at: iso, from: plan.status, to, note: cleanNote }], updatedAt: iso };
  return { data: replacePlan(data, next), plan: next };
}

/** Removes a plan. Never touches inventory: a lot made from it stays as it is. */
export function deleteBidPlan(data: AppData, id: string): AppData {
  findPlan(data, id);
  return { ...data, bidPlans: data.bidPlans.filter((p) => p.id !== id) };
}

/** The plan a lot was bought with, if any. */
export function bidPlanForLot(data: AppData, lotId: string): BidPlan | undefined {
  return data.bidPlans.find((p) => p.purchase?.lotId === lotId);
}

/** Lots that might already be this purchase (same name), to offer linking instead of a duplicate. */
export function similarLots(data: AppData, plan: Pick<BidPlan, 'name'>): Lot[] {
  const name = plan.name.trim().toLowerCase();
  return data.lots.filter((l) => l.name.trim().toLowerCase() === name && !bidPlanForLot(data, l.id));
}

function assertCanPurchase(data: AppData, plan: BidPlan) {
  if (plan.purchase) {
    const lot = data.lots.find((l) => l.id === plan.purchase!.lotId);
    throw new DomainError(
      lot ? `This plan is already recorded as purchased: lot “${lot.name}”. Nothing new was created.` : 'This plan is already recorded as purchased. Nothing new was created.',
    );
  }
}

function purchased(plan: BidPlan, lot: Lot, how: 'created' | 'linked', itemLinks: { bidItemId: string; itemId: string }[], iso: string): BidPlan {
  return {
    ...plan,
    status: 'purchased',
    snapshot: takeSnapshot(plan.assumptions, iso),
    purchase: {
      lotId: lot.id,
      lotName: lot.name,
      how,
      recordedAt: iso,
      purchaseDate: lot.purchaseDate,
      pricePaid: lot.purchasePrice,
      additionalCosts: fromCents(toCents(lotTotal(lot)) - toCents(lot.purchasePrice)),
      itemLinks,
    },
    history: [...plan.history, { id: newId(), at: iso, from: plan.status, to: 'purchased', note: how === 'linked' ? `Linked to lot “${lot.name}”.` : `Created lot “${lot.name}”.` }],
    updatedAt: iso,
  };
}

/**
 * Records that the lot was bought: creates the bulk lot (and its inventory items) through the
 * ordinary lot workflow, and marks the plan purchased with a frozen copy of its estimate.
 * Refuses if the plan was already recorded, so the same purchase can't be added twice.
 * `lineBidItemIds[i]` says which bid item lot line i came from (null for lines added later).
 */
export function recordBidPurchase(
  data: AppData,
  planId: string,
  lotInput: LotInput,
  lineBidItemIds: (string | null)[],
  clock?: Clock,
): { data: AppData; plan: BidPlan; lot: Lot; items: Item[] } {
  const { iso } = nowParts(clock);
  const plan = findPlan(data, planId);
  assertCanPurchase(data, plan);
  const created = createLot(data, lotInput, clock);
  const known = new Set(plan.assumptions.items.map((it) => it.id));
  const itemLinks = created.items.flatMap((item, i) => {
    const bidItemId = lineBidItemIds[i];
    return bidItemId && known.has(bidItemId) ? [{ bidItemId, itemId: item.id }] : [];
  });
  const next = purchased(plan, created.lot, 'created', itemLinks, iso);
  return { data: replacePlan(created.data, next), plan: next, lot: created.lot, items: created.items };
}

/** Records the purchase by attaching a lot that was already entered (no new inventory). */
export function linkBidToLot(data: AppData, planId: string, lotId: string, clock?: Clock): { data: AppData; plan: BidPlan } {
  const { iso } = nowParts(clock);
  const plan = findPlan(data, planId);
  assertCanPurchase(data, plan);
  const lot = data.lots.find((l) => l.id === lotId);
  if (!lot) throw new DomainError('That lot no longer exists.');
  const other = bidPlanForLot(data, lotId);
  if (other) throw new DomainError(`Lot “${lot.name}” is already linked to the plan “${other.name}”.`);
  const next = purchased(plan, lot, 'linked', [], iso);
  return { data: replacePlan(data, next), plan: next };
}

/**
 * The lot form's starting values for a purchase: the plan's name and items (with the user's
 * resale estimates), what was paid, and the buying costs at the actual price.
 */
export function lotPrefillFromPlan(plan: BidPlan, pricePaid: number, purchaseDate: string): { input: LotInput; lineBidItemIds: (string | null)[] } {
  const a = plan.assumptions;
  const paid = toCents(pricePaid);
  const rates: CostRates = { premiumBp: bp(a.buyerPremiumPct ?? 0), taxBp: bp(a.salesTaxPct ?? 0), taxOnPremium: a.taxOnPremium, fixed: 0 };
  const { premium, tax } = allInCents(paid, rates);
  const extraCosts = [
    ...(premium > 0 ? [{ label: `Buyer’s premium (${pctText(a.buyerPremiumPct ?? 0)})`, amount: fromCents(premium) }] : []),
    ...(tax > 0 ? [{ label: `Sales tax (${pctText(a.salesTaxPct ?? 0)})`, amount: fromCents(tax) }] : []),
    ...a.fixedCosts.filter((f) => f.amount !== null && toCents(f.amount) > 0).map((f) => ({ label: f.label || 'Buying cost', amount: f.amount })),
  ].slice(0, 10);
  const items = a.valueMode === 'items' ? a.items : [];
  return {
    input: {
      name: plan.name,
      purchasePrice: fromCents(paid),
      extraCosts,
      purchaseDate,
      source: KIND_LABELS[plan.kind],
      notes: plan.description,
      method: items.length && items.every((it) => it.unitValue !== null) && items.some((it) => toCents(it.unitValue!) > 0) ? 'relative_value' : 'equal',
      lines: items.map((it) => ({ name: it.name, quantity: it.quantity, estimatedUnitValue: it.unitValue, category: it.category, condition: it.condition, notes: it.notes })),
    },
    lineBidItemIds: items.map((it) => it.id),
  };
}
