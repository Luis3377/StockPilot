// Predicted vs. actual for bulk lots: what the user expected when they bought a lot (the frozen
// Max Bid snapshot) against what their recorded sales, costs and stock show.
//
// Actual figures reuse the bulk lot accounting (lotSummary: exact lot shares, cost of goods sold,
// write-offs, stock on hand) and recorded sales (computeSale). Predicted figures are read from
// the plan's snapshot, never recalculated from current data. Everything is integer cents.
//
// Definitions (documented in docs/PREDICTED_VS_ACTUAL.md):
//   acquisition cost   = lot total: purchase price + buying costs recorded on the lot
//   net proceeds       = sales revenue − fees − shipping − other selling expenses
//   lot result         = net proceeds − acquisition cost   (whole lot; final only when the lot is)
//   lot ROI            = lot result ÷ acquisition cost
//   realized profit    = revenue − cost of goods sold − selling expenses, on the units sold
//   forecast error     = (actual − predicted) ÷ |predicted|; none when the prediction is 0
//   sell-through       = share of the lot's estimated value that sold (your item estimates)
//
// A partly sold lot is never compared with the whole-lot prediction as if it were final: its
// differences are against a projected final outcome (sales so far + an estimate for what's
// left), and the page says so.

import type { AppData, BidLotKind, BidPlan, BidScenarioInputs, BidScenarioKey, BidScenarioSnapshot, Lot, Sale, Settings } from '../domain/types';
import { bidPlanForLot, KIND_LABELS, SCENARIO_KEYS, SCENARIO_LABELS } from '../domain/bids';
import { sellingCostRate } from '../domain/calc';
import { formatDate, todayISO } from '../domain/dates';
import { lotSummary, lotTotal, type LotSummary } from '../domain/lots';
import { formatMoney, fromCents, toCents } from '../domain/money';
import { plural } from '../domain/format';
import { calcContext, saleWarnings } from './calculations';

export type LotStage = 'not_selling' | 'partial' | 'sold_out' | 'closed';

export const STAGE_LABELS: Record<LotStage, string> = {
  not_selling: 'Not selling yet',
  partial: 'Partially sold',
  sold_out: 'Fully sold',
  closed: 'Closed',
};

// ---------------------------------------------------------------------------
// Integer helpers
// ---------------------------------------------------------------------------

const bp = (pct: number) => Math.round(pct * 100);
/** round(a × b ÷ c), half up, for non-negative integers (BigInt so nothing overflows). */
function mulDiv(a: number, b: number, c: number): number {
  if (c === 0) return 0;
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  const neg = n < 0n !== d < 0n;
  const q = ((neg ? -n : n) * 2n + (d < 0n ? -d : d)) / (2n * (d < 0n ? -d : d));
  return Number(neg ? -q : q);
}
const pctOf = (cents: number, basisPoints: number) => mulDiv(cents, basisPoints, 10000);
/** (a − b) ÷ |b| as a percentage, 2 decimals; null when b is 0. */
export function errorPct(actual: number, predicted: number): number | null {
  const p = toCents(predicted);
  if (p === 0) return null;
  return Math.round(((toCents(actual) - p) / Math.abs(p)) * 10000) / 100;
}
const ratioPct = (num: number, den: number): number | null => (den === 0 ? null : Math.round((num / den) * 10000) / 100);

// ---------------------------------------------------------------------------
// Actual figures
// ---------------------------------------------------------------------------

export interface ActualFigures {
  acquisitionCost: number;
  revenue: number;
  fees: number;
  shipping: number;
  otherExpenses: number;
  sellingExpenses: number;
  netProceeds: number;
  costOfGoods: number;
  /** On the units sold: revenue − cost of goods sold − selling expenses. */
  realizedProfit: number;
  /** Net proceeds − acquisition cost, for the whole lot (so far, unless final). */
  lotResult: number;
  lotRoiPct: number | null;
  /** Acquisition cost not yet recovered through net proceeds (0 once recovered). */
  unrecovered: number;
  unitsBought: number;
  unitsSold: number;
  unitsOnHand: number;
  unitsWrittenOff: number;
  writtenOffCost: number;
  remainingCost: number;
  sellThroughUnitsPct: number | null;
  /** Share of the lot's estimated value that sold, by the lot's item estimates; null without them. */
  sellThroughValuePct: number | null;
}

interface ValueShare {
  /** Σ estimate × units sold, and × units bought, over the lot's lines (cents). Null without estimates. */
  soldEstimate: number;
  lotEstimate: number;
}

function valueShare(s: LotSummary): ValueShare | null {
  if (s.lines.some((l) => l.line.estimatedUnitValue === null)) return null;
  let sold = 0;
  let all = 0;
  for (const l of s.lines) {
    const est = toCents(l.line.estimatedUnitValue!);
    sold += est * Math.min(l.unitsSold, l.line.quantity);
    all += est * l.line.quantity;
  }
  return all > 0 ? { soldEstimate: sold, lotEstimate: all } : null;
}

function unitsWrittenOff(data: AppData, lot: Lot): number {
  const ids = new Set(lot.lines.map((l) => l.itemId));
  return -data.adjustments.filter((a) => ids.has(a.itemId) && a.source !== 'restock').reduce((n, a) => n + a.difference, 0);
}

function actualFigures(data: AppData, lot: Lot, s: LotSummary): ActualFigures {
  const t = s.sales;
  const cost = toCents(lotTotal(lot));
  const net = toCents(t.revenue) - toCents(t.totalExpenses);
  const share = valueShare(s);
  const unitsSold = s.lines.reduce((n, l) => n + Math.min(l.unitsSold, l.line.quantity), 0);
  return {
    acquisitionCost: fromCents(cost),
    revenue: t.revenue,
    fees: t.fees,
    shipping: t.shipping,
    otherExpenses: t.otherExpenses,
    sellingExpenses: t.totalExpenses,
    netProceeds: fromCents(net),
    costOfGoods: t.costOfGoods,
    realizedProfit: t.netProfit,
    lotResult: fromCents(net - cost),
    lotRoiPct: ratioPct(net - cost, cost),
    unrecovered: fromCents(Math.max(0, cost - net)),
    unitsBought: s.unitsBought,
    unitsSold,
    unitsOnHand: s.unitsOnHand,
    unitsWrittenOff: Math.max(0, unitsWrittenOff(data, lot)),
    writtenOffCost: s.writtenOff,
    remainingCost: s.remainingCost,
    sellThroughUnitsPct: ratioPct(unitsSold, s.unitsBought),
    sellThroughValuePct: share ? ratioPct(share.soldEstimate, share.lotEstimate) : null,
  };
}

export function lotStage(lot: Lot, a: Pick<ActualFigures, 'unitsSold' | 'unitsOnHand' | 'unitsWrittenOff'>): LotStage {
  if (lot.closure) return 'closed';
  if (a.unitsOnHand === 0) return a.unitsWrittenOff > 0 || a.unitsSold === 0 ? 'closed' : 'sold_out';
  return a.unitsSold > 0 ? 'partial' : 'not_selling';
}

// ---------------------------------------------------------------------------
// The prediction (from the frozen snapshot)
// ---------------------------------------------------------------------------

export interface Prediction {
  scenario: BidScenarioKey;
  inputs: Required<{ [K in keyof BidScenarioInputs]: number }>;
  /** Your resale estimate at 100% (snapshot). */
  estimate: number;
  /** The most you planned to pay in total (all-in at the max bid); null if no bid made sense. */
  acquisitionCost: number | null;
  revenue: number;
  fees: number;
  shipping: number;
  sellingExpenses: number;
  netProceeds: number;
  /** At the planned (max) cost. */
  profit: number | null;
  roiPct: number | null;
  sellThroughPct: number;
  targetRoiPct: number | null;
  maxBid: number | null;
  recommendedBid: number | null;
  takenAt: string;
}

function estimateOf(a: BidPlan['assumptions']): number {
  return a.valueMode === 'items' ? a.items.reduce((c, it) => c + toCents(it.unitValue ?? 0) * it.quantity, 0) : toCents(a.totalResaleValue ?? 0);
}

export function predictionOf(plan: BidPlan, scenario: BidScenarioKey): Prediction | null {
  const snap = plan.snapshot;
  const r: BidScenarioSnapshot | null | undefined = snap?.results[scenario];
  if (!snap || !r) return null;
  const s = snap.assumptions.scenarios[scenario];
  if (s.resalePct === null || s.unsoldPct === null || s.sellingFeePct === null) return null;
  return {
    scenario,
    inputs: { resalePct: s.resalePct, unsoldPct: s.unsoldPct, sellingFeePct: s.sellingFeePct },
    estimate: fromCents(estimateOf(snap.assumptions)),
    acquisitionCost: r.allInAtMaxBid,
    revenue: r.expectedSales,
    fees: r.sellingFees,
    shipping: r.shipping,
    sellingExpenses: fromCents(toCents(r.sellingFees) + toCents(r.shipping)),
    netProceeds: r.netProceeds,
    profit: r.profitAtMaxBid,
    roiPct: r.roiAtMaxBidPct,
    sellThroughPct: 100 - s.unsoldPct,
    targetRoiPct: snap.assumptions.targetRoiPct,
    maxBid: r.maxBid,
    recommendedBid: snap.recommendedBid,
    takenAt: snap.takenAt,
  };
}

// ---------------------------------------------------------------------------
// Projection for lots still selling
// ---------------------------------------------------------------------------

export interface Projection {
  basis: 'plan' | 'estimates';
  /** In words: which assumptions produced it. */
  assumptions: string;
  remainingUnits: number;
  /** Your estimates × units still on hand (100%). */
  remainingEstimate: number;
  remainingSales: number;
  remainingExpenses: number;
  remainingNet: number;
  /** Lines in stock with no estimate (not included). */
  unestimatedLines: number;
  finalRevenue: number;
  finalExpenses: number;
  finalNet: number;
  finalResult: number;
  finalRoiPct: number | null;
  finalSellThroughValuePct: number | null;
}

function projection(data: AppData, settings: Settings, s: LotSummary, a: ActualFigures, plan: BidPlan | null, scenario: BidScenarioKey): Projection {
  const snapA = plan?.snapshot?.assumptions ?? null;
  const sc = snapA?.scenarios[scenario];
  const usePlan = Boolean(snapA && sc && sc.resalePct !== null && sc.unsoldPct !== null && sc.sellingFeePct !== null);
  let remainingUnits = 0;
  let estimate = 0;
  let unestimated = 0;
  for (const l of s.lines) {
    if (!l.item || l.unitsOnHand <= 0) continue;
    const est = l.line.estimatedUnitValue ?? l.item.estimatedValue;
    if (est === null) {
      unestimated++;
      continue;
    }
    remainingUnits += l.unitsOnHand;
    estimate += toCents(est) * l.unitsOnHand;
  }
  let sales: number;
  let expenses: number;
  let assumptions: string;
  if (usePlan) {
    const sellBp = 10000 - bp(sc!.unsoldPct!);
    sales = pctOf(pctOf(estimate, bp(sc!.resalePct!)), sellBp);
    const fees = pctOf(sales, bp(sc!.sellingFeePct!));
    const ship =
      snapA!.shippingMode === 'percent'
        ? pctOf(sales, bp(snapA!.shippingValue ?? 0))
        : mulDiv(toCents(snapA!.shippingValue ?? 0) * remainingUnits, sellBp, 10000);
    expenses = fees + ship;
    assumptions = `your plan’s ${SCENARIO_LABELS[scenario].toLowerCase()} assumptions for what’s left: resale ${sc!.resalePct}% of your estimates, ${sc!.unsoldPct}% unsold, ${sc!.sellingFeePct}% fees${
      snapA!.shippingMode === 'percent' ? `, ${snapA!.shippingValue ?? 0}% shipping` : toCents(snapA!.shippingValue ?? 0) > 0 ? `, ${formatMoney(snapA!.shippingValue ?? 0, settings.currency)} shipping per item` : ''
    }`;
  } else {
    const rate = sellingCostRate(data.sales, settings);
    sales = estimate;
    expenses = mulDiv(sales, Math.round(rate.percent * 100), 10000);
    assumptions = `every remaining unit selling at your estimate, minus ${Math.round(rate.percent * 10) / 10}% selling costs (${rate.source === 'setting' ? 'your setting' : rate.source === 'history' ? 'learned from your sales' : 'no sales yet'}), with no allowance for unsold items`;
  }
  const net = sales - expenses;
  const cost = toCents(a.acquisitionCost);
  const finalNet = toCents(a.netProceeds) + net;
  const share = valueShare(s);
  // Projected value sell-through: what sold so far + what's expected to sell of the rest.
  const expectedSoldEstimate = usePlan ? pctOf(estimate, 10000 - bp(sc!.unsoldPct!)) : estimate;
  return {
    basis: usePlan ? 'plan' : 'estimates',
    assumptions,
    remainingUnits,
    remainingEstimate: fromCents(estimate),
    remainingSales: fromCents(sales),
    remainingExpenses: fromCents(expenses),
    remainingNet: fromCents(net),
    unestimatedLines: unestimated,
    finalRevenue: fromCents(toCents(a.revenue) + sales),
    finalExpenses: fromCents(toCents(a.sellingExpenses) + expenses),
    finalNet: fromCents(finalNet),
    finalResult: fromCents(finalNet - cost),
    finalRoiPct: ratioPct(finalNet - cost, cost),
    finalSellThroughValuePct: share ? ratioPct(Math.min(share.lotEstimate, share.soldEstimate + expectedSoldEstimate), share.lotEstimate) : null,
  };
}

// ---------------------------------------------------------------------------
// Comparison rows and attribution
// ---------------------------------------------------------------------------

export type RowKey = 'acquisition' | 'revenue' | 'expenses' | 'net' | 'profit' | 'roi' | 'sellThrough';

export interface PerfRow {
  key: RowKey;
  label: string;
  unit: 'money' | 'pct';
  /** Higher is better (revenue, profit…) or lower is better (costs). */
  better: 'higher' | 'lower';
  predicted: number | null;
  /** Recorded so far (final when the lot is). */
  actual: number | null;
  /** For lots still selling: the projected final outcome (an estimate). */
  projected: number | null;
  /** What the prediction is compared with: actual when final, projected otherwise. */
  compared: number | null;
  /** compared − predicted ($, or percentage points). */
  difference: number | null;
  /** Forecast error %, money rows only; null when the prediction is 0. */
  errorPct: number | null;
  formula: string;
}

export interface Factor {
  key: 'paid' | 'prices' | 'sellThrough' | 'pricesAndSellThrough' | 'fees' | 'shipping';
  label: string;
  /** Effect on profit vs the prediction (+ helped, − hurt). */
  amount: number;
  detail: string;
}

export interface Attribution {
  /** Where the explanation starts: predicted profit at the planned cost, or at the price paid. */
  startLabel: string;
  start: number;
  factors: Factor[];
  end: number;
  notes: string[];
}

export interface LotPerformance {
  lot: Lot;
  plan: BidPlan | null;
  stage: LotStage;
  final: boolean;
  summary: LotSummary;
  actual: ActualFigures;
  scenario: BidScenarioKey;
  prediction: Prediction | null;
  projection: Projection | null;
  rows: PerfRow[];
  /** Why the result differs from the prediction (final lots with a plan only). */
  attribution: Attribution | null;
  /** Sold units: what they brought vs what the plan's prices said (any stage). */
  soldPrices: { predicted: number; actual: number; differencePct: number | null } | null;
  warnings: string[];
  sales: Sale[];
}

function priceSplit(p: Prediction, s: LotSummary): { atActualShare: number } | null {
  const share = valueShare(s);
  if (!share) return null;
  const resale = pctOf(toCents(p.estimate), bp(p.inputs.resalePct));
  return { atActualShare: mulDiv(resale, share.soldEstimate, share.lotEstimate) };
}

function attribution(p: Prediction, a: ActualFigures, s: LotSummary, money: (n: number) => string): Attribution {
  const cost = toCents(a.acquisitionCost);
  const planned = p.acquisitionCost === null ? null : toCents(p.acquisitionCost);
  const predictedNet = toCents(p.netProceeds);
  const start = planned === null ? predictedNet - cost : predictedNet - planned;
  const factors: Factor[] = [];
  const notes: string[] = [];
  if (planned !== null) {
    const d = planned - cost;
    factors.push({
      key: 'paid',
      label: d === 0 ? 'Paid what you planned' : d > 0 ? 'Paid less than planned' : 'Paid more than planned',
      amount: fromCents(d),
      detail: `The lot cost ${money(fromCents(cost))} in total; the most you planned to pay was ${money(fromCents(planned))}.`,
    });
  } else {
    notes.push('The plan had no sensible maximum bid, so the explanation starts from the predicted result at the price you paid.');
  }
  const revenueDiff = toCents(a.revenue) - toCents(p.revenue);
  const split = priceSplit(p, s);
  if (split) {
    const price = toCents(a.revenue) - split.atActualShare;
    const volume = split.atActualShare - toCents(p.revenue);
    factors.push({
      key: 'prices',
      label: price === 0 ? 'Sold at the estimated prices' : price > 0 ? 'Sold for more than estimated' : 'Sold for less than estimated',
      amount: fromCents(price),
      detail: `What sold brought ${money(a.revenue)}; at the plan’s prices (${p.inputs.resalePct}% of your estimates) it would have brought ${money(fromCents(split.atActualShare))}.`,
    });
    factors.push({
      key: 'sellThrough',
      label: volume === 0 ? 'Sold as much of the lot as expected' : volume > 0 ? 'More of the lot sold than expected' : 'Less of the lot sold than expected',
      amount: fromCents(volume),
      detail: `${a.sellThroughValuePct ?? 0}% of the lot’s estimated value sold; the plan expected ${p.sellThroughPct}%.${a.unitsWrittenOff ? ` ${plural(a.unitsWrittenOff, 'unit')} written off count as unsold.` : ''}`,
    });
  } else {
    factors.push({
      key: 'pricesAndSellThrough',
      label: revenueDiff >= 0 ? 'Sales revenue higher than expected' : 'Sales revenue lower than expected',
      amount: fromCents(revenueDiff),
      detail: `Revenue ${money(a.revenue)} vs ${money(p.revenue)} expected. Not every item has a resale estimate, so lower prices and unsold items can’t be told apart.`,
    });
  }
  const predictedFees = toCents(p.fees);
  const actualFees = toCents(a.fees) + toCents(a.otherExpenses);
  factors.push({
    key: 'fees',
    label: actualFees === predictedFees ? 'Fees as expected' : actualFees < predictedFees ? 'Lower fees than expected' : 'Higher fees than expected',
    amount: fromCents(predictedFees - actualFees),
    detail: `Fees and other selling expenses ${money(fromCents(actualFees))} vs ${money(p.fees)} expected (${p.inputs.sellingFeePct}% of sales).`,
  });
  factors.push({
    key: 'shipping',
    label: toCents(a.shipping) === toCents(p.shipping) ? 'Shipping as expected' : toCents(a.shipping) < toCents(p.shipping) ? 'Lower shipping than expected' : 'Higher shipping than expected',
    amount: fromCents(toCents(p.shipping) - toCents(a.shipping)),
    detail: `Shipping you paid ${money(a.shipping)} vs ${money(p.shipping)} expected.`,
  });
  const end = toCents(a.lotResult);
  // Every factor is a difference of recorded amounts, so they add up exactly.
  const sumCents = start + factors.reduce((c, f) => c + toCents(f.amount), 0);
  if (sumCents !== end) notes.push('The factors don’t add up to the result exactly; please report this.');
  return { startLabel: planned === null ? 'Predicted result at the price you paid' : 'Predicted profit (at the most you planned to pay)', start: fromCents(start), factors, end: fromCents(end), notes };
}

export interface PerformanceOptions {
  scenario?: BidScenarioKey;
  /** Skip the record warnings (they read payout reconciliation; history doesn't show them). */
  skipWarnings?: boolean;
}

/** Everything about one lot's predicted vs actual performance. */
export function lotPerformance(data: AppData, settings: Settings, lot: Lot, opts: PerformanceOptions = {}): LotPerformance {
  const money = (n: number) => formatMoney(n, settings.currency);
  const scenario = opts.scenario ?? 'expected';
  const s = lotSummary(data, lot);
  const a = actualFigures(data, lot, s);
  const stage = lotStage(lot, a);
  const final = stage === 'sold_out' || stage === 'closed';
  const plan = bidPlanForLot(data, lot.id) ?? null;
  const p = plan ? predictionOf(plan, scenario) : null;
  const proj = final ? null : projection(data, settings, s, a, plan, scenario);
  const ids = new Set(lot.lines.map((l) => l.itemId));
  const sales = data.sales.filter((x) => ids.has(x.itemId)).sort((x, y) => x.saleDate.localeCompare(y.saleDate));

  const row = (key: RowKey, label: string, unit: 'money' | 'pct', better: 'higher' | 'lower', predicted: number | null, actual: number | null, projected: number | null, formula: string): PerfRow => {
    const compared = final || key === 'acquisition' ? actual : projected;
    const difference =
      predicted === null || compared === null ? null : unit === 'money' ? fromCents(toCents(compared) - toCents(predicted)) : Math.round((compared - predicted) * 100) / 100;
    return { key, label, unit, better, predicted, actual, projected: final || key === 'acquisition' ? null : projected, compared, difference, errorPct: unit === 'money' && predicted !== null && compared !== null ? errorPct(compared, predicted) : null, formula };
  };
  const rows: PerfRow[] = [
    row('acquisition', 'Acquisition cost', 'money', 'lower', p?.acquisitionCost ?? null, a.acquisitionCost, null, 'Purchase price + buying costs recorded on the lot. Predicted: the all-in cost at your maximum bid.'),
    row('revenue', 'Sales revenue', 'money', 'higher', p?.revenue ?? null, a.revenue, proj?.finalRevenue ?? null, 'Sale price × quantity of every recorded sale of the lot’s items.'),
    row('expenses', 'Selling expenses', 'money', 'lower', p?.sellingExpenses ?? null, a.sellingExpenses, proj?.finalExpenses ?? null, 'Marketplace fees + shipping you paid + other expenses on those sales.'),
    row('net', 'Net proceeds', 'money', 'higher', p?.netProceeds ?? null, a.netProceeds, proj?.finalNet ?? null, 'Sales revenue − selling expenses.'),
    row('profit', 'Profit (whole lot)', 'money', 'higher', p?.profit ?? null, a.lotResult, proj?.finalResult ?? null, 'Net proceeds − acquisition cost. Predicted: at the most you planned to pay.'),
    row('roi', 'ROI (whole lot)', 'pct', 'higher', p?.roiPct ?? null, a.lotRoiPct, proj?.finalRoiPct ?? null, 'Profit ÷ acquisition cost.'),
    row(
      'sellThrough',
      'Sell-through',
      'pct',
      'higher',
      p?.sellThroughPct ?? null,
      a.sellThroughValuePct ?? a.sellThroughUnitsPct,
      proj?.finalSellThroughValuePct ?? null,
      a.sellThroughValuePct !== null ? 'Share of the lot’s estimated value that sold (your item estimates). Predicted: 100% − the unsold allowance.' : 'Share of units sold (not every item has an estimate, so this is by units). Predicted: 100% − the unsold allowance.',
    ),
  ];

  // What sold, against the plan's prices for it.
  let soldPrices: LotPerformance['soldPrices'] = null;
  if (p && a.unitsSold > 0) {
    const split = priceSplit(p, s);
    if (split && split.atActualShare > 0) soldPrices = { predicted: fromCents(split.atActualShare), actual: a.revenue, differencePct: errorPct(a.revenue, fromCents(split.atActualShare)) };
  }

  const warnings: string[] = [];
  if (!plan) warnings.push('This lot wasn’t planned with the Max Bid Calculator, so there’s no prediction to compare with. The actual results below are from your records.');
  else if (!p) warnings.push(`The plan’s ${SCENARIO_LABELS[scenario].toLowerCase()} scenario couldn’t be calculated when you bought the lot, so there’s nothing to compare for it.`);
  if (s.addedLater > 0) warnings.push(`${money(s.addedLater)} of stock was added to this lot’s items later (restocking). Its sales are included, so the comparison mixes in stock bought separately.`);
  if (s.otherChanges !== 0) warnings.push(`${money(Math.abs(s.otherChanges))} of the lot’s cost isn’t accounted for by sales, write-offs or stock (an item’s cost was edited or an item was deleted). See the lot page.`);
  if (s.lines.some((l) => l.unitsSold > l.line.quantity)) warnings.push('Some items sold more units than the lot contained (restocked units). Only the lot’s own units count toward sell-through.');
  if (a.sellThroughValuePct === null && a.unitsSold > 0) warnings.push('Not every item has a resale estimate, so sell-through is by units and price and sell-through effects can’t be separated.');
  if (lot.closure && lot.closure.unitsOnHand > 0) {
    warnings.push(`Closed with ${plural(lot.closure.unitsOnHand, 'unit')} still in stock (${money(lot.closure.remainingCost)} at cost). They stay in your inventory and count as unsold here; they weren’t written off.`);
  }
  if (lot.closure && sales.some((x) => x.createdAt > lot.closure!.at)) warnings.push('A sale was recorded after you closed this lot. The result includes it.');
  if (proj && proj.unestimatedLines) warnings.push(`${plural(proj.unestimatedLines, 'item')} in stock ${proj.unestimatedLines === 1 ? 'has' : 'have'} no resale estimate, so ${proj.unestimatedLines === 1 ? 'it isn’t' : 'they aren’t'} in the projection.`);
  if (!opts.skipWarnings) warnings.push(...saleWarnings(calcContext(data, settings, todayISO()), sales));

  return {
    lot,
    plan,
    stage,
    final,
    summary: s,
    actual: a,
    scenario,
    prediction: p,
    projection: proj,
    rows,
    attribution: final && p ? attribution(p, a, s, money) : null,
    soldPrices,
    warnings,
    sales,
  };
}

// ---------------------------------------------------------------------------
// History across lots
// ---------------------------------------------------------------------------

export interface HistoryFilters {
  from?: string | null;
  to?: string | null;
  /** A lot type from its plan, or 'unplanned'. */
  kind?: BidLotKind | 'unplanned' | null;
  source?: string | null;
}

export interface HistoryRow {
  lot: Lot;
  plan: BidPlan | null;
  date: string;
  type: string;
  kindKey: BidLotKind | 'unplanned';
  stage: LotStage;
  final: boolean;
  cost: number;
  net: number;
  result: number;
  roiPct: number | null;
  predictedNet: number | null;
  netErrorPct: number | null;
  predictedProfit: number | null;
}

export interface GroupStats {
  key: string;
  label: string;
  lots: number;
  cost: number;
  result: number;
  /** Σ result ÷ Σ cost. */
  roiPct: number | null;
  /** Mean of per-lot net proceeds forecast errors (planned lots only). */
  meanNetErrorPct: number | null;
  plannedLots: number;
}

export interface CategoryAccuracy {
  category: string;
  unitsSold: number;
  lots: number;
  predicted: number;
  actual: number;
  differencePct: number | null;
}

export interface HistorySummary {
  rows: HistoryRow[];
  completed: HistoryRow[];
  investment: number;
  result: number;
  /** Σ result ÷ Σ cost over completed lots ("aggregate ROI"). */
  aggregateRoiPct: number | null;
  /** Simple mean of completed lots' ROI. */
  meanRoiPct: number | null;
  plannedCompleted: number;
  /** Mean of per-lot net proceeds forecast errors (completed, planned, prediction ≠ 0). */
  meanNetErrorPct: number | null;
  /** (Σ actual net − Σ predicted net) ÷ Σ predicted net. */
  aggregateNetErrorPct: number | null;
  best: HistoryRow[];
  worst: HistoryRow[];
  byType: GroupStats[];
  /** Sold units vs the plan's prices, by item category (planned lots with item estimates). */
  byCategory: CategoryAccuracy[];
  types: { key: BidLotKind | 'unplanned'; label: string }[];
  sources: string[];
}

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);

function historyRow(data: AppData, settings: Settings, lot: Lot): HistoryRow {
  const perf = lotPerformance(data, settings, lot, { skipWarnings: true });
  const plan = perf.plan;
  return {
    lot,
    plan,
    date: lot.purchaseDate ?? lot.createdAt.slice(0, 10),
    type: plan ? KIND_LABELS[plan.kind] : 'Not planned',
    kindKey: plan ? plan.kind : 'unplanned',
    stage: perf.stage,
    final: perf.final,
    cost: perf.actual.acquisitionCost,
    net: perf.actual.netProceeds,
    result: perf.actual.lotResult,
    roiPct: perf.actual.lotRoiPct,
    predictedNet: perf.prediction?.netProceeds ?? null,
    netErrorPct: perf.final && perf.prediction ? errorPct(perf.actual.netProceeds, perf.prediction.netProceeds) : null,
    predictedProfit: perf.prediction?.profit ?? null,
  };
}

function groupStats(key: string, label: string, rows: HistoryRow[]): GroupStats {
  const cost = rows.reduce((c, r) => c + toCents(r.cost), 0);
  const result = rows.reduce((c, r) => c + toCents(r.result), 0);
  const errors = rows.map((r) => r.netErrorPct).filter((e): e is number => e !== null);
  return { key, label, lots: rows.length, cost: fromCents(cost), result: fromCents(result), roiPct: ratioPct(result, cost), meanNetErrorPct: mean(errors), plannedLots: rows.filter((r) => r.plan?.snapshot).length };
}

export function lotHistory(data: AppData, settings: Settings, filters: HistoryFilters = {}): HistorySummary {
  const all = data.lots.map((lot) => historyRow(data, settings, lot)).sort((a, b) => b.date.localeCompare(a.date));
  const types = [...new Map(all.map((r) => [r.kindKey, { key: r.kindKey, label: r.type }])).values()].sort((a, b) => a.label.localeCompare(b.label));
  const sources = [...new Set(data.lots.map((l) => l.source.trim()).filter(Boolean))].sort();
  const rows = all.filter(
    (r) =>
      (!filters.from || r.date >= filters.from) &&
      (!filters.to || r.date <= filters.to) &&
      (!filters.kind || r.kindKey === filters.kind) &&
      (!filters.source || r.lot.source.trim() === filters.source),
  );
  const completed = rows.filter((r) => r.final);
  const investment = completed.reduce((c, r) => c + toCents(r.cost), 0);
  const result = completed.reduce((c, r) => c + toCents(r.result), 0);
  const planned = completed.filter((r) => r.predictedNet !== null);
  const errors = planned.map((r) => r.netErrorPct).filter((e): e is number => e !== null);
  const predictedNet = planned.reduce((c, r) => c + toCents(r.predictedNet!), 0);
  const actualNet = planned.reduce((c, r) => c + toCents(r.net), 0);
  const ranked = completed.filter((r) => r.roiPct !== null).sort((a, b) => b.roiPct! - a.roiPct! || b.result - a.result);
  const byType = [...new Set(completed.map((r) => r.kindKey))].map((k) => {
    const group = completed.filter((r) => r.kindKey === k);
    return groupStats(k, group[0].type, group);
  });

  // Price accuracy by category: sold units against the plan's prices for them.
  const cats = new Map<string, { label: string; units: number; lots: Set<string>; predicted: number; actual: number }>();
  for (const r of rows) {
    const p = r.plan ? predictionOf(r.plan, 'expected') : null;
    if (!p) continue;
    const s = lotSummary(data, r.lot);
    for (const l of s.lines) {
      const sold = Math.min(l.unitsSold, l.line.quantity);
      if (!sold || l.line.estimatedUnitValue === null || l.unitsSold > l.line.quantity) continue;
      const category = (l.item?.category || '').trim() || 'Uncategorized';
      const c = cats.get(category.toLowerCase()) ?? { label: category, units: 0, lots: new Set<string>(), predicted: 0, actual: 0 };
      c.units += sold;
      c.lots.add(r.lot.id);
      c.predicted += pctOf(toCents(l.line.estimatedUnitValue) * sold, bp(p.inputs.resalePct));
      c.actual += toCents(l.revenue);
      cats.set(category.toLowerCase(), c);
    }
  }
  const byCategory = [...cats.values()]
    .map((c) => ({ category: c.label, unitsSold: c.units, lots: c.lots.size, predicted: fromCents(c.predicted), actual: fromCents(c.actual), differencePct: errorPct(fromCents(c.actual), fromCents(c.predicted)) }))
    .sort((a, b) => b.unitsSold - a.unitsSold);

  return {
    rows,
    completed,
    investment: fromCents(investment),
    result: fromCents(result),
    aggregateRoiPct: ratioPct(result, investment),
    meanRoiPct: mean(completed.map((r) => r.roiPct).filter((x): x is number => x !== null)),
    plannedCompleted: planned.length,
    meanNetErrorPct: mean(errors),
    aggregateNetErrorPct: predictedNet === 0 ? null : ratioPct(actualNet - predictedNet, Math.abs(predictedNet)),
    best: ranked.slice(0, 3),
    // Never the same lot in both lists.
    worst: ranked.slice(Math.max(3, ranked.length - 3)).reverse(),
    byType,
    byCategory,
    types,
    sources,
  };
}

// ---------------------------------------------------------------------------
// Learning: suggested adjustments for a new plan
// ---------------------------------------------------------------------------

/** Completed, planned lots needed before suggesting anything. */
export const MIN_SAMPLE = 3;
/** Credibility weight n ÷ (n + K): history counts more as it grows. */
export const CREDIBILITY_K = 3;
/** Raising an estimate needs more evidence than lowering it. */
export const MIN_SAMPLE_TO_RAISE = 5;

export interface LearningLot {
  lotId: string;
  name: string;
  date: string;
  type: string;
  /** What sold brought ÷ the plan's prices for it (%). */
  priceRatioPct: number | null;
  sellThroughPct: number;
  predictedSellThroughPct: number;
  feeRatePct: number | null;
  netErrorPct: number | null;
}

export interface FieldSuggestion {
  field: keyof BidScenarioInputs;
  label: string;
  current: number;
  /** What your completed lots showed. */
  historical: number;
  suggested: number;
  explanation: string;
}

export type LearningResult =
  | { ok: false; sampleSize: number; needed: number; basis: string; reason: string }
  | {
      ok: true;
      basis: string;
      basisKind: BidLotKind | null;
      sampleSize: number;
      weight: number;
      consistent: boolean;
      lots: LearningLot[];
      /** Mean net proceeds forecast error across these lots. */
      meanNetErrorPct: number | null;
      fields: FieldSuggestion[];
      suggested: Required<{ [K in keyof BidScenarioInputs]: number }>;
      summary: string;
    };

interface Evidence {
  lot: Lot;
  plan: BidPlan;
  p: Prediction;
  a: ActualFigures;
  share: ValueShare;
  atActualShare: number;
}

function evidence(data: AppData, settings: Settings): Evidence[] {
  const out: Evidence[] = [];
  for (const lot of data.lots) {
    const perf = lotPerformance(data, settings, lot, { skipWarnings: true });
    if (!perf.final || !perf.plan || !perf.prediction) continue;
    const s = perf.summary;
    const share = valueShare(s);
    const split = priceSplit(perf.prediction, s);
    if (!share || !split) continue;
    out.push({ lot, plan: perf.plan, p: perf.prediction, a: perf.actual, share, atActualShare: split.atActualShare });
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Suggests a more realistic expected scenario from the user's completed lots, transparently:
 * value-weighted ratios over the lots, pulled toward the current value by a credibility weight
 * n ÷ (n + 3) (halved when lots disagree), capped, and only raised with 5+ lots. Never changes
 * anything by itself.
 */
export function suggestAdjustments(data: AppData, settings: Settings, kind: BidLotKind | null, current: BidScenarioInputs): LearningResult {
  const ev = evidence(data, settings);
  const sameKind = kind ? ev.filter((e) => e.plan.kind === kind) : [];
  const useKind = kind !== null && sameKind.length >= MIN_SAMPLE;
  const used = useKind ? sameKind : ev;
  const basis = useKind ? `${plural(used.length, 'completed lot')} of this type (${KIND_LABELS[kind!].toLowerCase()})` : `${plural(used.length, 'completed lot')} you planned`;
  if (used.length < MIN_SAMPLE) {
    return {
      ok: false,
      sampleSize: used.length,
      needed: MIN_SAMPLE,
      basis,
      reason: `Suggestions need at least ${MIN_SAMPLE} completed lots that you planned with the Max Bid Calculator and that have a resale estimate for every item. You have ${used.length}.`,
    };
  }
  if (current.resalePct === null || current.unsoldPct === null || current.sellingFeePct === null) {
    return { ok: false, sampleSize: used.length, needed: MIN_SAMPLE, basis, reason: 'Enter this plan’s expected resale %, unsold % and fees first.' };
  }
  const n = used.length;
  const revenue = used.reduce((c, e) => c + toCents(e.a.revenue), 0);
  const atPlanPrices = used.reduce((c, e) => c + e.atActualShare, 0);
  const soldEst = used.reduce((c, e) => c + e.share.soldEstimate, 0);
  const lotEst = used.reduce((c, e) => c + e.share.lotEstimate, 0);
  const feeCents = used.reduce((c, e) => c + toCents(e.a.fees) + toCents(e.a.otherExpenses), 0);
  const lots: LearningLot[] = used.map((e) => ({
    lotId: e.lot.id,
    name: e.lot.name,
    date: e.lot.purchaseDate ?? e.lot.createdAt.slice(0, 10),
    type: KIND_LABELS[e.plan.kind],
    priceRatioPct: ratioPct(toCents(e.a.revenue), e.atActualShare),
    sellThroughPct: ratioPct(e.share.soldEstimate, e.share.lotEstimate) ?? 0,
    predictedSellThroughPct: e.p.sellThroughPct,
    feeRatePct: toCents(e.a.revenue) ? ratioPct(toCents(e.a.fees) + toCents(e.a.otherExpenses), toCents(e.a.revenue)) : null,
    netErrorPct: errorPct(e.a.netProceeds, e.p.netProceeds),
  }));
  const ratios = lots.map((l) => l.priceRatioPct).filter((x): x is number => x !== null);
  const consistent = ratios.length < 2 || Math.max(...ratios) - Math.min(...ratios) <= 50;
  const weight = (n / (n + CREDIBILITY_K)) * (consistent ? 1 : 0.5);
  const canRaise = n >= MIN_SAMPLE_TO_RAISE && consistent;
  const w = Math.round(weight * 1000) / 1000;

  const priceRatio = atPlanPrices > 0 ? revenue / atPlanPrices : 1;
  const histUnsold = lotEst > 0 ? 100 * (1 - soldEst / lotEst) : current.unsoldPct;
  const histFee = revenue > 0 ? (100 * feeCents) / revenue : current.sellingFeePct;

  const fields: FieldSuggestion[] = [];
  {
    const cur = current.resalePct;
    let sug = cur * (1 + (priceRatio - 1) * weight);
    if (sug > cur && !canRaise) sug = cur;
    sug = round1(clamp(sug, Math.max(0, cur - 30), cur + 10));
    fields.push({
      field: 'resalePct',
      label: 'Resale value (% of your estimate)',
      current: cur,
      historical: round1(priceRatio * 100),
      suggested: sug,
      explanation: `What sold brought ${round1(priceRatio * 100)}% of the plans’ prices for it. ${cur}% × (1 + (${round1(priceRatio * 100)}% − 100%) × ${w}) = ${round1(cur * (1 + (priceRatio - 1) * weight))}%${sug !== round1(cur * (1 + (priceRatio - 1) * weight)) ? `, limited to ${sug}%` : ''}.`,
    });
  }
  {
    const cur = current.unsoldPct;
    let sug = cur + (histUnsold - cur) * weight;
    if (sug < cur && !canRaise) sug = cur;
    sug = round1(clamp(sug, Math.max(0, cur - 20), Math.min(95, cur + 20)));
    const raw = round1(cur + (histUnsold - cur) * weight);
    fields.push({
      field: 'unsoldPct',
      label: 'Unsold (% of resale value)',
      current: cur,
      historical: round1(histUnsold),
      suggested: sug,
      explanation: `${round1(histUnsold)}% of these lots’ estimated value didn’t sell. ${cur}% + (${round1(histUnsold)}% − ${cur}%) × ${w} = ${raw}%${sug !== raw ? `, limited to ${sug}%` : ''}.`,
    });
  }
  {
    const cur = current.sellingFeePct;
    let sug = cur + (histFee - cur) * weight;
    if (sug < cur && !canRaise) sug = cur;
    sug = round1(clamp(sug, Math.max(0, cur - 10), Math.min(100, cur + 10)));
    const raw = round1(cur + (histFee - cur) * weight);
    fields.push({
      field: 'sellingFeePct',
      label: 'Selling fees (% of sale price)',
      current: cur,
      historical: round1(histFee),
      suggested: sug,
      explanation: `Fees and other selling expenses were ${round1(histFee)}% of sales. ${cur}% + (${round1(histFee)}% − ${cur}%) × ${w} = ${raw}%${sug !== raw ? `, limited to ${sug}%` : ''}.`,
    });
  }
  const netErrors = lots.map((l) => l.netErrorPct).filter((x): x is number => x !== null);
  const meanNetErrorPct = mean(netErrors);
  const summary =
    meanNetErrorPct === null
      ? `Based on ${basis}.`
      : `Your ${basis} brought net proceeds averaging ${Math.abs(meanNetErrorPct)}% ${meanNetErrorPct < 0 ? 'below' : 'above'} your original predictions.`;
  return {
    ok: true,
    basis,
    basisKind: useKind ? kind : null,
    sampleSize: n,
    weight: w,
    consistent,
    lots,
    meanNetErrorPct,
    fields,
    suggested: { resalePct: fields[0].suggested, unsoldPct: fields[1].suggested, sellingFeePct: fields[2].suggested },
    summary,
  };
}

/** For the assistant and pages: a stage in words. */
export function stageText(perf: Pick<LotPerformance, 'stage' | 'actual' | 'lot'>): string {
  const a = perf.actual;
  switch (perf.stage) {
    case 'not_selling':
      return `Nothing sold yet: ${plural(a.unitsOnHand, 'unit')} in stock.`;
    case 'partial':
      return `${a.unitsSold} of ${plural(a.unitsBought, 'unit')} sold; ${a.unitsOnHand} still in stock.`;
    case 'sold_out':
      return `Fully sold: all ${plural(a.unitsBought, 'unit')}.`;
    case 'closed':
      return perf.lot.closure
        ? `Closed on ${formatDate(perf.lot.closure.at.slice(0, 10))}: ${a.unitsSold} of ${plural(a.unitsBought, 'unit')} sold${a.unitsWrittenOff ? `, ${a.unitsWrittenOff} written off` : ''}${perf.lot.closure.unitsOnHand ? `, ${perf.lot.closure.unitsOnHand} kept in stock (unsold)` : ''}.`
        : `Closed: ${a.unitsSold} of ${plural(a.unitsBought, 'unit')} sold, ${plural(a.unitsWrittenOff, 'unit')} written off.`;
  }
}

export { SCENARIO_KEYS };
