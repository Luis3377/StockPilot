import { describe, expect, it } from 'vitest';
import FEB from '../marketplace/fixtures/ebay-transactions-2026-02.csv?raw';
import { errorPct, lotHistory, lotPerformance, MIN_SAMPLE, suggestAdjustments, type LotPerformance } from './performance';
import { createBidPlan, defaultAssumptions, lotPrefillFromPlan, recordBidPurchase, updateBidPlan } from '../domain/bids';
import { addItem, adjustQuantity, recordSale } from '../domain/actions';
import { closeLot, createLot, reopenLot } from '../domain/lots';
import { toCents } from '../domain/money';
import { applyImport, previewImport } from '../marketplace/reports';
import { createBackup, parseBackup } from '../data/backup';
import { defaultSettings, emptyData, type AppData, type BidItem, type BidLotKind, type Lot } from '../domain/types';
import { clock } from '../domain/testUtils';
import { answerQuestion } from './assistant';
import { verifyCalculation } from './calculations';

const settings = defaultSettings();
const item = (id: string, name: string, quantity: number, unitValue: number, category = ''): BidItem => ({ id, name, quantity, unitValue, category, condition: '', notes: '', aiFields: [] });

/**
 * A planned estate lot: A × 4 at $100, B × 2 at $200, C × 10 at $20 = $1,000 of estimates.
 * Expected scenario: 20% unsold, 15% fees, 100% target ROI → net proceeds $680, max bid $340.
 * Bought for $300 (no buying costs), split by value: A $30, B $60, C $6 per unit.
 */
function plannedLot(opts: { kind?: BidLotKind; paid?: number; name?: string; data?: AppData; categories?: [string, string, string] } = {}) {
  const cat = opts.categories ?? ['Kitchen', 'Electronics', 'Kitchen'];
  const name = opts.name ?? 'Estate lot';
  const a = { ...defaultAssumptions(), valueMode: 'items' as const, items: [item(`${name}-A`, 'Item A', 4, 100, cat[0]), item(`${name}-B`, 'Item B', 2, 200, cat[1]), item(`${name}-C`, 'Item C', 10, 20, cat[2])] };
  let r = createBidPlan(opts.data ?? emptyData(), { name, description: '', kind: opts.kind ?? 'estate_sale', assumptions: a }, clock());
  const { input, lineBidItemIds } = lotPrefillFromPlan(r.plan, opts.paid ?? 300, '2026-09-01');
  const bought = recordBidPurchase(r.data, r.plan.id, input, lineBidItemIds, clock('2026-09-01T10:00:00.000Z'));
  const [A, B, C] = bought.items;
  return { data: bought.data, lot: bought.lot, plan: bought.plan, A, B, C };
}

function sell(data: AppData, itemId: string, quantity: number, total: number, fees: number, shipping = 0, date = '2026-09-20') {
  return recordSale(data, { itemId, quantity, salePrice: total, priceMode: 'total', fees, shipping, saleDate: date, platform: 'eBay' }, clock(`${date}T12:00:00.000Z`)).data;
}

const perf = (data: AppData, lot: Lot, scenario?: 'conservative' | 'expected' | 'optimistic') => lotPerformance(data, settings, data.lots.find((l) => l.id === lot.id)!, { scenario });
const row = (p: LotPerformance, key: string) => p.rows.find((r) => r.key === key)!;

/** The spec's example: predicted net $680, actual final $595 (−$85, −12.5%). */
function completedExample() {
  let { data, lot, A, B, C } = plannedLot();
  data = sell(data, A.id, 4, 360, 54, 20); // $90 each
  data = sell(data, B.id, 2, 380, 57, 14); // $190 each
  data = adjustQuantity(data, C.id, 0, 'Water damaged, thrown away', clock('2026-10-01T09:00:00.000Z')).data;
  return { data, lot };
}

describe('a completed lot', () => {
  it('compares the frozen prediction with recorded results, to the cent', () => {
    const { data, lot } = completedExample();
    const p = perf(data, lot);
    expect(p.stage).toBe('closed'); // all sold or written off
    expect(p.final).toBe(true);
    expect(p.projection).toBeNull();
    expect(p.prediction).toMatchObject({ estimate: 1000, revenue: 800, fees: 120, shipping: 0, netProceeds: 680, acquisitionCost: 340, profit: 340, roiPct: 100, sellThroughPct: 80, maxBid: 340 });
    expect(p.actual).toMatchObject({ acquisitionCost: 300, revenue: 740, fees: 111, shipping: 34, sellingExpenses: 145, netProceeds: 595, costOfGoods: 240, realizedProfit: 355, lotResult: 295, unitsSold: 6, unitsWrittenOff: 10, writtenOffCost: 60, sellThroughValuePct: 80, sellThroughUnitsPct: 37.5 });
    expect(p.actual.lotRoiPct).toBe(98.33);
    expect(row(p, 'net')).toMatchObject({ predicted: 680, actual: 595, compared: 595, difference: -85, errorPct: -12.5 });
    expect(row(p, 'acquisition')).toMatchObject({ predicted: 340, actual: 300, difference: -40, errorPct: -11.76 });
    expect(row(p, 'revenue')).toMatchObject({ difference: -60, errorPct: -7.5 });
    expect(row(p, 'expenses')).toMatchObject({ predicted: 120, actual: 145, difference: 25 });
    expect(row(p, 'profit')).toMatchObject({ predicted: 340, actual: 295, difference: -45 });
    expect(row(p, 'roi')).toMatchObject({ predicted: 100, actual: 98.33, difference: -1.67, errorPct: null });
    expect(row(p, 'sellThrough')).toMatchObject({ predicted: 80, actual: 80, difference: 0 });
  });

  it('explains the difference with factors that add up exactly, and never invents one', () => {
    const { data, lot } = completedExample();
    const at = perf(data, lot).attribution!;
    expect(at.start).toBe(340);
    expect(at.factors.map((f) => [f.key, f.amount])).toEqual([
      ['paid', 40], // paid $300 vs planned $340
      ['prices', -60], // sold for $740, the plan's prices said $800
      ['sellThrough', 0], // 80% of the value sold, as expected
      ['fees', 9], // $111 vs $120
      ['shipping', -34], // $34 vs $0
    ]);
    expect(at.end).toBe(295);
    expect(toCents(at.start) + at.factors.reduce((c, f) => c + toCents(f.amount), 0)).toBe(toCents(at.end));
    expect(at.notes).toEqual([]);
    expect(at.factors.find((f) => f.key === 'sellThrough')!.detail).toContain('10 units written off count as unsold');
  });

  it('a fully sold lot is final; a lot losing money shows a negative result and ROI', () => {
    let { data, lot, A, B, C } = plannedLot({ paid: 700 });
    data = sell(data, A.id, 4, 300, 45);
    data = sell(data, B.id, 2, 300, 45);
    data = sell(data, C.id, 10, 100, 15);
    const p = perf(data, lot);
    expect(p.stage).toBe('sold_out');
    expect(p.actual).toMatchObject({ revenue: 700, netProceeds: 595, lotResult: -105, unrecovered: 105, sellThroughValuePct: 100 });
    expect(p.actual.lotRoiPct).toBe(-15);
    expect(row(p, 'acquisition').difference).toBe(360); // paid far more than the $340 plan
    expect(p.attribution!.factors[0]).toMatchObject({ key: 'paid', label: 'Paid more than planned', amount: -360 });
    expect(p.attribution!.factors.find((f) => f.key === 'sellThrough')!.amount).toBe(200); // all of it sold, not 80%
  });

  it('a zero-revenue lot: everything written off, without division errors', () => {
    let { data, lot, A, B, C } = plannedLot();
    for (const it of [A, B, C]) data = adjustQuantity(data, it.id, 0, 'Lost in a flood', clock()).data;
    const p = perf(data, lot);
    expect(p.stage).toBe('closed');
    expect(p.actual).toMatchObject({ revenue: 0, netProceeds: 0, lotResult: -300, lotRoiPct: -100, sellThroughValuePct: 0 });
    expect(row(p, 'net')).toMatchObject({ difference: -680, errorPct: -100 });
    expect(p.soldPrices).toBeNull();
    expect(errorPct(0, 0)).toBeNull();
    expect(errorPct(5, 0)).toBeNull();
  });
});

describe('a lot still selling', () => {
  it('partial: realized so far, unrecovered investment, and a projected final outcome', () => {
    let { data, lot, A } = plannedLot();
    data = sell(data, A.id, 4, 360, 54, 20);
    const p = perf(data, lot);
    expect(p.stage).toBe('partial');
    expect(p.final).toBe(false);
    expect(p.attribution).toBeNull();
    expect(p.actual).toMatchObject({ revenue: 360, costOfGoods: 120, realizedProfit: 166, netProceeds: 286, remainingCost: 180, unrecovered: 14, lotResult: -14, unitsSold: 4, unitsOnHand: 12, sellThroughValuePct: 40 });
    // What's left: $600 of estimates, with the plan's expected assumptions: × 80% sold, − 15% fees
    expect(p.projection).toMatchObject({ basis: 'plan', remainingUnits: 12, remainingEstimate: 600, remainingSales: 480, remainingExpenses: 72, remainingNet: 408, finalNet: 694, finalResult: 394, finalRoiPct: 131.33, finalSellThroughValuePct: 88 });
    // Differences are against the projection, never against the partial actuals.
    expect(row(p, 'net')).toMatchObject({ predicted: 680, actual: 286, projected: 694, compared: 694, difference: 14, errorPct: 2.06 });
    // The units that sold went for 10% under the plan's prices.
    expect(p.soldPrices).toEqual({ predicted: 400, actual: 360, differencePct: -10 });
  });

  it('not selling yet: the projection is the plan applied to the whole lot', () => {
    const { data, lot } = plannedLot();
    const p = perf(data, lot);
    expect(p.stage).toBe('not_selling');
    expect(p.projection).toMatchObject({ remainingEstimate: 1000, remainingNet: 680, finalNet: 680, finalResult: 380 });
    expect(row(p, 'profit')).toMatchObject({ predicted: 340, actual: -300, projected: 380, difference: 40 });
  });

  it('closing a lot makes it final without writing anything off; reopening undoes that', () => {
    let { data, lot, A } = plannedLot();
    data = sell(data, A.id, 4, 360, 54, 20);
    expect(() => closeLot(data, lot.id, '', false, clock())).toThrow('12 units are still in stock');
    data = closeLot(data, lot.id, 'Keeping the rest', true, clock('2026-10-15T09:00:00.000Z')).data;
    const p = perf(data, lot);
    expect(p.stage).toBe('closed');
    expect(p.final).toBe(true);
    expect(p.actual).toMatchObject({ unitsOnHand: 12, remainingCost: 180, unitsWrittenOff: 0, lotResult: -14 });
    expect(data.adjustments).toEqual([]); // nothing written off
    expect(data.items.reduce((n, i) => n + i.quantity, 0)).toBe(12);
    expect(p.warnings[0]).toContain('Closed with 12 units still in stock ($180.00 at cost). They stay in your inventory and count as unsold here');
    data = reopenLot(data, lot.id, clock()).data;
    expect(perf(data, lot).stage).toBe('partial');
  });

  it('a lot without a plan shows actuals and a projection from item estimates', () => {
    let data = createLot(emptyData(), { name: 'Garage bundle', purchasePrice: 50, extraCosts: [], purchaseDate: '2026-09-01', source: 'Garage sale', notes: '', method: 'relative_value', lines: [{ name: 'Lamp', quantity: 2, estimatedUnitValue: 40 }] }, clock()).data;
    data = sell(data, data.items[0].id, 1, 45, 5);
    const p = lotPerformance(data, settings, data.lots[0]);
    expect(p.plan).toBeNull();
    expect(p.prediction).toBeNull();
    expect(row(p, 'net')).toMatchObject({ predicted: null, actual: 40, difference: null });
    expect(p.projection!.basis).toBe('estimates');
    expect(p.warnings[0]).toMatch(/wasn’t planned with the Max Bid Calculator/);
  });
});

describe('the original prediction', () => {
  it('is read from the frozen snapshot, so later changes and sales never rewrite it', () => {
    let { data, lot, plan, A } = plannedLot();
    const before = perf(data, lot).prediction;
    data = sell(data, A.id, 4, 360, 54, 20);
    expect(() => updateBidPlan(data, plan.id, { name: 'x', description: '', kind: 'other', assumptions: defaultAssumptions() }, clock())).toThrow();
    expect(perf(data, lot).prediction).toEqual(before);
    expect(data.bidPlans[0].snapshot).toEqual(plan.snapshot);
  });

  it('every scenario can be compared', () => {
    const { data, lot } = completedExample();
    expect(row(perf(data, lot, 'conservative'), 'net').predicted).toBe(459.2);
    expect(row(perf(data, lot, 'optimistic'), 'net').predicted).toBe(841.5);
  });
});

describe('records and warnings', () => {
  it('restocks, edits and refunds in eBay’s report are flagged, not hidden', () => {
    let { data, lot, A } = plannedLot();
    data = recordSale(data, { itemId: A.id, quantity: 1, salePrice: 180, priceMode: 'total', fees: 24.25, saleDate: '2026-01-30', orderNumber: '11-00002-00002' }, clock()).data;
    data = applyImport(data, previewImport(FEB, 'feb.csv', data), clock()).data;
    const p = perf(data, lot);
    expect(p.warnings.join(' ')).toContain('eBay’s report shows a $15.50 refund on order 11-00002-00002');
    // Imported reports never change the lot's figures.
    expect(p.actual.revenue).toBe(180);
  });

  it('several items, partly sold, keep every cent of the lot accounted for', () => {
    let { data, lot, A, B } = plannedLot();
    data = sell(data, A.id, 2, 190, 28.5);
    data = sell(data, B.id, 1, 210, 31.5, 9);
    data = adjustQuantity(data, A.id, 1, 'Broken', clock()).data;
    const p = perf(data, lot);
    const a = p.actual;
    // Cost: sold + written off + still in stock = the lot's cost.
    expect(toCents(a.costOfGoods) + toCents(a.writtenOffCost) + toCents(a.remainingCost)).toBe(toCents(a.acquisitionCost));
    expect(a).toMatchObject({ unitsSold: 3, unitsWrittenOff: 1, unitsOnHand: 12, costOfGoods: 120, writtenOffCost: 30, remainingCost: 150 });
    expect(p.summary.reconciled).toBe(true);
  });
});

describe('history and learning', () => {
  /** Lots of one type where items sold for `price`% of the estimates and fees ran at `fee`%. */
  function shop(n: number, opts: { kind?: BidLotKind; price?: number[]; fee?: number } = {}) {
    let data = emptyData();
    for (let i = 0; i < n; i++) {
      const name = `Lot ${i + 1}`;
      const r = plannedLot({ kind: opts.kind ?? 'pallet', name, data });
      data = r.data;
      const factor = (opts.price?.[i] ?? 88) / 100;
      const fee = (opts.fee ?? 15) / 100;
      const sales: [string, number, number][] = [
        [r.A.id, 4, 400 * factor],
        [r.B.id, 2, 400 * factor],
      ];
      for (const [id, q, total] of sales) data = sell(data, id, q, Math.round(total * 100) / 100, Math.round(total * fee * 100) / 100);
      data = adjustQuantity(data, r.C.id, 0, 'Unsellable', clock()).data;
    }
    return data;
  }

  it('summarizes completed lots with defined aggregates, best and worst', () => {
    let data = shop(4, { price: [100, 90, 80, 120] });
    // One lot still selling isn't counted as completed.
    data = plannedLot({ name: 'Open lot', data }).data;
    const h = lotHistory(data, settings);
    expect(h.rows).toHaveLength(5);
    expect(h.completed).toHaveLength(4);
    expect(h.investment).toBe(1200);
    // Net proceeds per lot = 800 × price × 0.85; result = net − 300.
    expect(h.completed.map((r) => r.net).sort((a, b) => a - b)).toEqual([544, 612, 680, 816]);
    expect(h.result).toBe(fromNumbers([244, 312, 380, 516]));
    expect(h.aggregateRoiPct).toBe(121); // 1452 ÷ 1200
    expect(h.meanNetErrorPct).toBe(-2.5); // (0 − 10 − 20 + 20) ÷ 4
    expect(h.best[0].lot.name).toBe('Lot 4');
    expect(h.worst[0].lot.name).toBe('Lot 3');
    expect(h.byType).toEqual([expect.objectContaining({ key: 'pallet', lots: 4, cost: 1200 })]);
    expect(h.byCategory.map((c) => [c.category, c.unitsSold])).toEqual([
      ['Kitchen', 16],
      ['Electronics', 8],
    ]);
    expect(lotHistory(data, settings, { from: '2027-01-01' }).rows).toEqual([]);
    expect(lotHistory(data, settings, { kind: 'storage_unit' }).completed).toEqual([]);
  });

  it('suggests a more conservative expected scenario, transparently and with safeguards', () => {
    const data = shop(4, { price: [88, 88, 88, 88] });
    const r = suggestAdjustments(data, settings, 'pallet', { resalePct: 100, unsoldPct: 20, sellingFeePct: 15 });
    if (!r.ok) throw new Error(r.reason);
    expect(r.sampleSize).toBe(4);
    expect(r.basis).toBe('4 completed lots of this type (liquidation pallet)');
    expect(r.weight).toBe(0.571); // 4 ÷ (4 + 3)
    expect(r.lots.map((l) => l.priceRatioPct)).toEqual([88, 88, 88, 88]);
    expect(r.fields.map((f) => [f.field, f.current, f.historical, f.suggested])).toEqual([
      ['resalePct', 100, 88, 93.1], // 100 × (1 + (0.88 − 1) × 4/7)
      ['unsoldPct', 20, 20, 20],
      ['sellingFeePct', 15, 15, 15],
    ]);
    expect(r.summary).toBe('Your 4 completed lots of this type (liquidation pallet) brought net proceeds averaging 12% below your original predictions.');
    expect(r.fields[0].explanation).toBe('What sold brought 88% of the plans’ prices for it. 100% × (1 + (88% − 100%) × 0.571) = 93.1%.');
  });

  it('small or inconsistent samples: no suggestion below 3 lots, weaker with disagreement, no raising below 5', () => {
    const two = suggestAdjustments(shop(2), settings, 'pallet', { resalePct: 100, unsoldPct: 20, sellingFeePct: 15 });
    expect(two).toMatchObject({ ok: false, sampleSize: 2, needed: MIN_SAMPLE });

    const mixed = suggestAdjustments(shop(3, { price: [50, 100, 130] }), settings, 'pallet', { resalePct: 100, unsoldPct: 20, sellingFeePct: 15 });
    if (!mixed.ok) throw new Error('expected a suggestion');
    expect(mixed.consistent).toBe(false);
    expect(mixed.weight).toBe(0.25); // 3 ÷ 6, halved

    // Outperforming: with only 3 lots the estimate isn't raised.
    const better = suggestAdjustments(shop(3, { price: [120, 120, 120] }), settings, 'pallet', { resalePct: 100, unsoldPct: 20, sellingFeePct: 15 });
    if (!better.ok) throw new Error('expected a suggestion');
    expect(better.fields[0].suggested).toBe(100);
    // With 5 consistent lots it may be, capped at +10 points.
    const five = suggestAdjustments(shop(5, { price: [130, 130, 130, 130, 130] }), settings, 'pallet', { resalePct: 100, unsoldPct: 20, sellingFeePct: 15 });
    if (!five.ok) throw new Error('expected a suggestion');
    expect(five.fields[0].suggested).toBe(110);
  });

  it('falls back to all planned lots when there are too few of the type, and says so', () => {
    const data = shop(3, { kind: 'pallet' });
    const r = suggestAdjustments(data, settings, 'storage_unit', { resalePct: 100, unsoldPct: 20, sellingFeePct: 15 });
    expect(r.ok && r.basis).toBe('3 completed lots you planned');
  });

  it('the assistant answers from the same figures, with calculations that re-check', () => {
    const ask = (data: AppData, q: string) => {
      const a = answerQuestion(q, { data, settings, today: '2026-11-12' });
      if (a.calculation) expect(verifyCalculation(a.calculation), q).toEqual([]);
      return a;
    };
    const done = completedExample().data;
    const acc = ask(done, 'How accurate have my predictions been?');
    expect(acc.intent).toBe('prediction-accuracy');
    expect(acc.text).toBe('Across 1 completed lot you planned, net proceeds were $595.00 against $680.00 predicted: 12.5% below (−$85.00).');
    expect(acc.calculation!.value).toBe(-85);
    expect(ask(done, 'Am I overestimating resale prices?').details.join(' ')).toContain('brought $740.00, against $800.00 at your plans’ prices (−7.5%, so you’ve been overestimating resale prices)');
    expect(ask(done, 'Which lots made more than expected?').text).toBe('None of your 1 completed planned lot made more than predicted.');
    expect(ask(done, 'Which lots made less than expected?').text).toBe('1 of 1 completed planned lot made less than predicted: Estate lot (−12.5%).');

    // A losing lot: the biggest factor is named, and the lines add up to the result.
    let lose = plannedLot({ paid: 700 });
    let data = lose.data;
    data = sell(data, lose.A.id, 4, 300, 45);
    data = sell(data, lose.B.id, 2, 300, 45);
    data = sell(data, lose.C.id, 10, 100, 15);
    const why = ask(data, 'Why did my lot lose money?');
    expect(why.intent).toBe('lot-why');
    expect(why.text).toBe('“Estate lot” lost $105.00, against $340.00 predicted. The biggest difference: paid more than planned ($360.00).');
    expect(why.calculation!.value).toBe(-105);

    // Still selling: no verdict, just where it stands.
    lose = plannedLot({ name: 'Open box' });
    data = sell(lose.data, lose.A.id, 1, 80, 12);
    expect(ask(data, 'Why did Open box lose money?').text).toBe('“Open box” is still selling (1 of 16 units sold), so whether it loses money isn’t known yet.');

    const four = shop(4, { price: [88, 88, 88, 88] });
    const next = ask(four, 'How should my previous results affect my next pallet bid?');
    expect(next.intent).toBe('lot-learning');
    expect(next.text).toBe(
      'Your 4 completed lots of this type (liquidation pallet) brought net proceeds averaging 12% below your original predictions. For your next liquidation pallet, StockPilot would suggest an expected scenario of 93.1% resale, 20% unsold and 15% fees, instead of the default 100% / 20% / 15%.',
    );
    expect(ask(four, 'What kinds of lots consistently underperform?').text).toBe('Liquidation pallet lots have done worst against your predictions: net proceeds averaged 12% below (4 lots).');
    expect(ask(shop(2), 'How should my previous results affect my next bid?').text).toMatch(/at least 3 completed lots/);
    expect(ask(emptyData(), 'How accurate have my predictions been?').intent).toBe('no-data');
    const oneItem = addItem(emptyData(), { name: 'Lamp', quantity: 1, unitCost: 5 }, clock()).data;
    expect(ask(oneItem, 'How accurate have my predictions been?').text).toBe('You haven’t recorded any bulk lots yet, so there are no results to compare with predictions.');
  });

  it('history survives backup and restore, closure included', () => {
    let data = shop(1);
    const open = plannedLot({ name: 'Open lot', data });
    data = closeLot(open.data, open.lot.id, 'done', true, clock()).data;
    const back = parseBackup(JSON.stringify(createBackup('real', settings, data, []))).data;
    expect(back.lots.find((l) => l.name === 'Open lot')!.closure).toMatchObject({ note: 'done', unitsOnHand: 16 });
    expect(lotHistory(back, settings).completed.map((r) => r.lot.name).sort()).toEqual(['Lot 1', 'Open lot']);
    const older = JSON.parse(JSON.stringify(createBackup('real', settings, data, [])));
    for (const l of older.data.lots) delete l.closure;
    for (const p of older.data.bidPlans) delete p.adjustments;
    const restored = parseBackup(JSON.stringify(older)).data;
    expect(restored.lots.every((l) => l.closure === undefined)).toBe(true);
    expect(restored.bidPlans.every((p) => Array.isArray(p.adjustments) && p.adjustments.length === 0)).toBe(true);
  });
});

function fromNumbers(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0);
}
