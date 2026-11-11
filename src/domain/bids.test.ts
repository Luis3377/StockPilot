import { describe, expect, it } from 'vitest';
import {
  bidPlanErrors,
  bidPlanForLot,
  calculateBid,
  createBidPlan,
  defaultAssumptions,
  deleteBidPlan,
  duplicateBidPlan,
  linkBidToLot,
  lotPrefillFromPlan,
  missingForCalculation,
  recordBidPurchase,
  SCENARIO_KEYS,
  setBidPlanStatus,
  similarLots,
  updateBidPlan,
  type BidCalculation,
  type BidPlanInput,
} from './bids';
import { createLot } from './lots';
import { inventoryTotals, totalSales } from './calc';
import { DomainError } from './errors';
import { toCents } from './money';
import { emptyData, type AppData, type BidAssumptions, type BidItem } from './types';
import { clock } from './testUtils';
import { createBackup, parseBackup } from '../data/backup';
import { buildDemoData } from '../data/demo';
import { answerQuestion } from '../insights/assistant';
import { defaultSettings } from './types';

/** Assumptions with no buying or shipping costs, and the spec's expected scenario. */
function base(over: Partial<BidAssumptions> = {}): BidAssumptions {
  return { ...defaultAssumptions(), totalResaleValue: 1000, ...over };
}

function calc(a: BidAssumptions): BidCalculation {
  const r = calculateBid(a);
  if (!r.ok) throw new Error(`not calculable: ${JSON.stringify(r.missing)}`);
  return r;
}

const expected = (a: BidAssumptions) => calc(a).scenarios.expected;

const item = (name: string, quantity: number, unitValue: number | null, extra: Partial<BidItem> = {}): BidItem => ({
  id: `it-${name}`,
  name,
  quantity,
  unitValue,
  category: '',
  condition: '',
  notes: '',
  aiFields: [],
  ...extra,
});

const plan = (assumptions: BidAssumptions = base(), name = 'Storage unit #14'): BidPlanInput => ({ name, description: 'Unit B-14, mostly kitchenware', kind: 'storage_unit', assumptions });

describe('the max bid', () => {
  it('$1,000 resale, 20% unsold, 15% selling costs, 100% ROI → $340', () => {
    const e = expected(base());
    expect(e.expectedSales).toBe(800); // $1,000 × 0.80
    expect(e.sellingFees).toBe(120); // × 15%
    expect(e.netProceeds).toBe(680); // $1,000 × 0.80 × 0.85
    expect(e.maxAllIn).toBe(340); // $680 ÷ 2
    expect(e.maxBid).toBe(340);
    expect(e.atMaxBid).toEqual({ bid: 340, buyerPremium: 0, salesTax: 0, fixedCosts: 0, allIn: 340, profit: 340, roiPct: 100 });
    expect(e.noBidReason).toBeNull();
    expect(calc(base()).drivers).toEqual([
      'Your resale estimate: $1,000.00.',
      '20% expected not to sell ($200.00), leaving $800.00 of expected sales.',
      'Selling fees of 15% ($120.00) and outbound shipping of $0.00 leave $680.00 of net proceeds.',
      'A 100% target return means spending at most $680.00 ÷ 2 = $340.00 in total.',
      'With no other buying costs, that is the maximum bid: $340.00.',
    ]);
  });

  it('different target returns', () => {
    const at = (roi: number) => expected(base({ targetRoiPct: roi }));
    expect(at(0).maxBid).toBe(680);
    expect(at(25).maxBid).toBe(544);
    expect(at(50).maxBid).toBe(453.33); // 680 ÷ 1.5 = 453.333…, rounded down
    expect(at(50).atMaxBid!.roiPct).toBeGreaterThanOrEqual(50);
    expect(at(200).maxBid).toBe(226.66); // 680 ÷ 3 = 226.666…
    expect(at(33.33).maxBid).toBe(510.01); // 680 ÷ 1.3333
  });

  it('selling fees and outbound shipping, counted only on what sells', () => {
    // $5 per item × 20 items × 80% expected to sell = $80
    const perItem = expected(base({ itemCount: 20, shippingMode: 'per_item', shippingValue: 5 }));
    expect(perItem.shipping).toBe(80);
    expect(perItem.netProceeds).toBe(600);
    expect(perItem.maxBid).toBe(300);
    const percent = expected(base({ shippingMode: 'percent', shippingValue: 10 }));
    expect(percent.shipping).toBe(80); // 10% of $800
    expect(percent.sellingExpenses).toBe(200);
    expect(percent.maxBid).toBe(300);
    // Per-item shipping on a fraction of an item is an expected value, rounded to the cent.
    expect(expected(base({ itemCount: 7, shippingValue: 3.33, scenarios: { ...base().scenarios, expected: { resalePct: 100, unsoldPct: 15, sellingFeePct: 15 } } })).shipping).toBe(19.81);
  });

  it('unsellable inventory allowances', () => {
    const at = (unsold: number) => expected(base({ scenarios: { ...base().scenarios, expected: { resalePct: 100, unsoldPct: unsold, sellingFeePct: 15 } } }));
    expect(at(0).netProceeds).toBe(850);
    expect(at(0).maxBid).toBe(425);
    expect(at(50).unsoldValue).toBe(500);
    expect(at(50).maxBid).toBe(212.5);
    expect(at(100).maxBid).toBeNull();
    expect(at(100).noBidReason).toMatch(/nothing is expected to sell/);
  });

  it('fixed buying costs come off the bid, not the proceeds', () => {
    const e = expected(base({ fixedCosts: [{ id: 'f1', label: 'Truck rental', amount: 25 }, { id: 'f2', label: 'Cleanout fee', amount: 15 }] }));
    expect(e.maxAllIn).toBe(340);
    expect(e.fixedCosts).toBe(40);
    expect(e.maxBid).toBe(300);
    expect(e.atMaxBid).toMatchObject({ bid: 300, fixedCosts: 40, allIn: 340, profit: 340, roiPct: 100 });
  });

  it('buyer’s premium and sales tax: the all-in cost still meets the target', () => {
    const premium = expected(base({ buyerPremiumPct: 10 }));
    expect(premium.maxBid).toBe(309.09); // 340 ÷ 1.10
    expect(premium.atMaxBid).toMatchObject({ buyerPremium: 30.91, allIn: 340 });

    // (340 − 40) ÷ 1.10 = 272.727…; at $272.73 the premium rounds to $27.27, so it still fits.
    const both = expected(base({ buyerPremiumPct: 10, fixedCosts: [{ id: 'f', label: 'Transport', amount: 40 }] }));
    expect(both.maxBid).toBe(272.73);
    expect(both.atMaxBid).toMatchObject({ buyerPremium: 27.27, fixedCosts: 40, allIn: 340 });

    const taxed = expected(base({ buyerPremiumPct: 10, salesTaxPct: 8, taxOnPremium: true }));
    // 340 ÷ (1.10 × 1.08) = 286.195…, but at $286.20 the tax rounds up to an all-in of $340.01.
    expect(taxed.maxBid).toBe(286.19);
    expect(taxed.atMaxBid).toMatchObject({ buyerPremium: 28.62, salesTax: 25.18, allIn: 339.99 });
    const untaxedPremium = expected(base({ buyerPremiumPct: 10, salesTaxPct: 8, taxOnPremium: false }));
    expect(untaxedPremium.maxBid).toBe(288.14); // 340 ÷ 1.18 = 288.135…
    expect(untaxedPremium.atMaxBid!.salesTax).toBe(23.05); // 8% of the bid only
    for (const r of [premium, both, taxed, untaxedPremium]) expect(r.atMaxBid!.roiPct).toBeGreaterThanOrEqual(100);
  });

  it('explains instead of recommending when no positive bid makes sense', () => {
    const fees = expected(base({ scenarios: { ...base().scenarios, expected: { resalePct: 100, unsoldPct: 20, sellingFeePct: 100 } } }));
    expect(fees.maxBid).toBeNull();
    expect(fees.atMaxBid).toBeNull();
    expect(fees.recommendedBid).toBeNull();
    expect(fees.noBidReason).toBe('Selling costs ($800.00) would use up all of the expected sales ($800.00), so no price would earn a profit.');

    const shipping = expected(base({ itemCount: 100, shippingValue: 9 }));
    expect(shipping.netProceeds).toBe(-40); // $800 − $120 − $720
    expect(shipping.maxAllIn).toBe(0);
    expect(shipping.maxBid).toBeNull();

    const fixed = expected(base({ fixedCosts: [{ id: 'f', label: 'Transport', amount: 340 }] }));
    expect(fixed.maxBid).toBeNull();
    expect(fixed.noBidReason).toBe('Your fixed buying costs ($340.00) already use up the most you can spend in total ($340.00) and still reach a 100% return.');

    expect(expected(base({ totalResaleValue: 0.03 })).maxBid).toBe(0.01);
    expect(expected(base({ totalResaleValue: 0.01 })).maxBid).toBeNull();
  });

  it('a budget can lower the recommendation; a planned bid is checked against both', () => {
    const r = calc(base({ budget: 300, plannedBid: 400, buyerPremiumPct: 10 }));
    const e = r.scenarios.expected;
    expect(e.maxBid).toBe(309.09);
    expect(e.budgetBid).toBe(272.73); // $272.73 + $27.27 premium = $300.00
    expect(e.recommendedBid).toBe(272.73);
    expect(e.limitedBy).toBe('budget');
    expect(e.atRecommendedBid).toMatchObject({ allIn: 300, profit: 380 });
    expect(e.atPlannedBid).toMatchObject({ bid: 400, buyerPremium: 40, allIn: 440, profit: 240 });
    expect(e.atPlannedBid!.roiPct).toBe(54.55);
    expect(calc(base({ budget: 1000 })).scenarios.expected.limitedBy).toBe('target');
    const tooSmall = calc(base({ budget: 30, fixedCosts: [{ id: 'f', label: 'Transport', amount: 40 }] }));
    expect(tooSmall.scenarios.expected.recommendedBid).toBeNull();
    expect(tooSmall.warnings).toContain('Your budget doesn’t cover the fixed buying costs ($40.00), so it leaves nothing for a bid.');
  });

  it('items: per-item estimates add up, and per-item shipping counts every unit', () => {
    const a = base({
      valueMode: 'items',
      items: [item('Cast iron pan', 4, 30), item('Stand mixer', 1, 150), item('Mugs', 10, 3.5)],
      shippingValue: 2,
    });
    const e = expected(a);
    expect(e.estimatedResale).toBe(305); // 120 + 150 + 35
    expect(calc(a).itemCount).toBe(15);
    expect(e.shipping).toBe(24); // $2 × 15 × 80%
    expect(e.netProceeds).toBe(183.4); // 244 − 36.60 − 24
    expect(e.maxBid).toBe(91.7);
  });

  it('three scenarios show how resale, sell-through and fees move the bid', () => {
    const r = calc(base());
    expect(SCENARIO_KEYS.map((k) => r.scenarios[k].maxBid)).toEqual([229.6, 340, 420.75]);
    // Conservative: $1,000 × 80% = $800, 30% unsold → $560, 18% fees → $459.20, ÷ 2
    expect(r.scenarios.conservative).toMatchObject({ scenarioResale: 800, expectedSales: 560, sellingFees: 100.8, netProceeds: 459.2 });
    // Optimistic: $1,100, 10% unsold → $990, 15% fees → $841.50, ÷ 2
    expect(r.scenarios.optimistic).toMatchObject({ scenarioResale: 1100, expectedSales: 990, netProceeds: 841.5 });
    expect(r.warnings).toEqual([]);
    const inverted = calc(base({ scenarios: { ...base().scenarios, conservative: { resalePct: 120, unsoldPct: 5, sellingFeePct: 10 } } }));
    expect(inverted.warnings[0]).toMatch(/conservative scenario gives a higher maximum bid/);
  });

  it('rounding: always the largest whole-cent bid that keeps the all-in cost within the target', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 400; i++) {
      const a = base({
        totalResaleValue: (1 + rand(5_000_000)) / 100,
        itemCount: 1 + rand(300),
        shippingMode: rand(2) ? 'percent' : 'per_item',
        shippingValue: rand(2000) / 100,
        buyerPremiumPct: rand(2500) / 100,
        salesTaxPct: rand(1200) / 100,
        taxOnPremium: Boolean(rand(2)),
        targetRoiPct: rand(30000) / 100,
        fixedCosts: [{ id: 'f', label: 'x', amount: rand(5000) / 100 }],
        scenarios: { ...base().scenarios, expected: { resalePct: 50 + rand(100), unsoldPct: rand(9000) / 100, sellingFeePct: rand(3000) / 100 } },
      });
      const e = expected(a);
      const cents = (n: number) => toCents(n);
      expect(cents(e.expectedSales) + cents(e.unsoldValue)).toBe(cents(e.scenarioResale));
      expect(cents(e.expectedSales) - cents(e.sellingFees) - cents(e.shipping)).toBe(cents(e.netProceeds));
      if (e.netProceeds > 0) expect(cents(e.maxAllIn) * (1 + a.targetRoiPct! / 100)).toBeLessThanOrEqual(cents(e.netProceeds) + 1e-6);
      if (e.maxBid === null) continue;
      const at = e.atMaxBid!;
      expect(cents(at.bid) + cents(at.buyerPremium) + cents(at.salesTax) + cents(at.fixedCosts)).toBe(cents(at.allIn));
      expect(at.allIn).toBeLessThanOrEqual(e.maxAllIn);
      expect(cents(at.profit)).toBe(cents(e.netProceeds) - cents(at.allIn));
      expect(at.roiPct!).toBeGreaterThanOrEqual(a.targetRoiPct! - 0.005);
      // One cent more would go over.
      const more = calc({ ...a, plannedBid: e.maxBid + 0.01 }).scenarios.expected.atPlannedBid!;
      expect(more.allIn).toBeGreaterThan(e.maxAllIn);
    }
  });
});

describe('inputs', () => {
  it('says what’s missing before calculating', () => {
    expect(calculateBid(defaultAssumptions())).toEqual({ ok: false, missing: { totalResaleValue: 'Enter your estimated total resale value for the lot.' } });
    expect(missingForCalculation(base({ valueMode: 'items', items: [] }))).toEqual({ items: 'Add the items you expect in the lot, with your resale estimate for each.' });
    expect(missingForCalculation(base({ valueMode: 'items', items: [item('Lamp', 1, null)] }))).toEqual({ 'item.0.unitValue': 'Enter your resale estimate for one of these.' });
    expect(missingForCalculation(base({ shippingValue: 4 }))).toEqual({ itemCount: 'Enter roughly how many items are in the lot, so shipping per item can be counted.' });
    expect(missingForCalculation(base({ targetRoiPct: null }))).toHaveProperty('targetRoiPct');
    expect(missingForCalculation(base({ scenarios: { ...base().scenarios, optimistic: { resalePct: 110, unsoldPct: null, sellingFeePct: 15 } } }))).toHaveProperty('scenario.optimistic.unsoldPct');
    // Empty buying and shipping costs simply mean none.
    expect(expected(base({ shippingValue: null, buyerPremiumPct: null, salesTaxPct: null })).maxBid).toBe(340);
  });

  it('refuses invalid values with a message per field', () => {
    const errors = bidPlanErrors(
      plan(
        base({
          totalResaleValue: -5,
          buyerPremiumPct: 120,
          salesTaxPct: 8.125,
          targetRoiPct: 5000,
          budget: Number.NaN,
          itemCount: 2.5,
          shippingMode: 'percent',
          shippingValue: -1,
          scenarios: { ...base().scenarios, conservative: { resalePct: 400, unsoldPct: 101, sellingFeePct: -2 } },
          items: [item('', 0, -3)],
        }),
        '  ',
      ),
    );
    expect(errors).toEqual({
      name: 'Lot name is required.',
      totalResaleValue: "Estimated resale value can't be negative.",
      buyerPremiumPct: "Buyer's premium can be at most 100%.",
      salesTaxPct: 'Sales tax can have at most 2 decimals.',
      targetRoiPct: 'Target ROI can be at most 1000%.',
      budget: 'Budget must be a number.',
      itemCount: 'Number of items must be a whole number.',
      shippingValue: "Shipping can't be negative.",
      'scenario.conservative.resalePct': 'Resale value (conservative) can be at most 300%.',
      'scenario.conservative.unsoldPct': 'Unsold share (conservative) can be at most 100%.',
      'scenario.conservative.sellingFeePct': "Selling fees (conservative) can't be negative.",
      'item.0.name': 'Item name is required.',
      'item.0.quantity': 'Quantity must be at least 1.',
      'item.0.unitValue': "Resale estimate can't be negative.",
    });
    expect(calculateBid(base({ targetRoiPct: -10 })).ok).toBe(false);
    expect(bidPlanErrors(plan(defaultAssumptions()))).toEqual({}); // an empty draft can be saved
  });
});

describe('saved plans', () => {
  it('a draft is planning data: it creates no inventory, purchase, expense or sale', () => {
    let data: AppData = emptyData();
    const before = { inventory: inventoryTotals(data.items), sales: totalSales(data.sales) };
    const r = createBidPlan(data, plan(defaultAssumptions()), clock());
    data = r.data;
    expect(r.plan).toMatchObject({ status: 'draft', snapshot: null, purchase: null, duplicatedFromId: null, createdAt: '2026-10-28T12:00:00.000Z' });
    expect(data.bidPlans).toHaveLength(1);
    expect(data.items).toEqual([]);
    expect(data.lots).toEqual([]);
    expect(data.sales).toEqual([]);
    expect(data.adjustments).toEqual([]);
    expect({ inventory: inventoryTotals(data.items), sales: totalSales(data.sales) }).toEqual(before);
  });

  it('plans never change a money figure: the assistant and totals answer the same with or without them', () => {
    const demo = buildDemoData('2026-10-28');
    const withPlans = createBidPlan(demo, plan(base({ totalResaleValue: 50_000, budget: 20_000 })), clock()).data;
    for (const q of ['How much have I spent on inventory?', 'How much money do I have invested in unsold inventory?', 'How much profit have I made this month?', 'What’s my inventory worth?']) {
      const a = answerQuestion(q, { data: demo, settings: defaultSettings(), today: '2026-10-28' });
      const b = answerQuestion(q, { data: withPlans, settings: defaultSettings(), today: '2026-10-28' });
      expect(b.text, q).toBe(a.text);
      expect(b.calculation?.value, q).toBe(a.calculation?.value);
    }
    expect(inventoryTotals(withPlans.items)).toEqual(inventoryTotals(demo.items));
  });

  it('reopen, edit, duplicate, and mark passed or lost', () => {
    let data = createBidPlan(emptyData(), plan(), clock()).data;
    const id = data.bidPlans[0].id;
    data = updateBidPlan(data, id, plan(base({ totalResaleValue: 1200 })), clock('2026-10-29T09:00:00.000Z')).data;
    expect(data.bidPlans[0].assumptions.totalResaleValue).toBe(1200);
    expect(data.bidPlans[0].updatedAt).toBe('2026-10-29T09:00:00.000Z');

    const copy = duplicateBidPlan(data, id, clock());
    data = copy.data;
    expect(copy.plan).toMatchObject({ name: 'Storage unit #14 (copy)', status: 'draft', duplicatedFromId: id });
    expect(copy.plan.assumptions).toEqual(data.bidPlans.find((p) => p.id === id)!.assumptions);
    expect(copy.plan.id).not.toBe(id);

    data = setBidPlanStatus(data, id, 'lost', 'Went for $520', clock()).data;
    const lost = data.bidPlans.find((p) => p.id === id)!;
    expect(lost.status).toBe('lost');
    expect(lost.history).toEqual([expect.objectContaining({ from: 'draft', to: 'lost', note: 'Went for $520' })]);
    expect(() => updateBidPlan(data, id, plan(), clock())).toThrow('Reopen it to change its assumptions.');
    data = setBidPlanStatus(data, id, 'draft', '', clock()).data;
    expect(data.bidPlans.find((p) => p.id === id)!.status).toBe('draft');
    data = setBidPlanStatus(data, copy.plan.id, 'passed', '', clock()).data;
    expect(data.bidPlans.find((p) => p.id === copy.plan.id)!.status).toBe('passed');

    data = deleteBidPlan(data, copy.plan.id);
    expect(data.bidPlans.map((p) => p.id)).toEqual([id]);
  });
});

describe('buying the lot', () => {
  function plannedShop() {
    let data = emptyData();
    const a = base({
      valueMode: 'items',
      items: [item('Cast iron pan', 4, 30, { category: 'Kitchen', condition: 'Good', notes: 'Lodge #8' }), item('Stand mixer', 1, 150), item('Mugs', 10, 3.5)],
      buyerPremiumPct: 10,
      salesTaxPct: 8,
      fixedCosts: [{ id: 'f', label: 'Truck rental', amount: 25 }],
    });
    const r = createBidPlan(data, plan(a), clock());
    data = r.data;
    return { data, plan: r.plan };
  }

  it('turns the plan into a bulk lot with the actual price, through the ordinary lot workflow', () => {
    const { data, plan: p } = plannedShop();
    const before = calc(p.assumptions);
    const { input, lineBidItemIds } = lotPrefillFromPlan(p, 80, '2026-10-30');
    expect(input).toMatchObject({
      name: 'Storage unit #14',
      purchasePrice: 80,
      purchaseDate: '2026-10-30',
      source: 'Storage-unit auction',
      notes: 'Unit B-14, mostly kitchenware',
      method: 'relative_value',
      extraCosts: [
        { label: 'Buyer’s premium (10%)', amount: 8 },
        { label: 'Sales tax (8%)', amount: 7.04 },
        { label: 'Truck rental', amount: 25 },
      ],
    });
    expect(input.lines.map((l) => [l.name, l.quantity, l.estimatedUnitValue])).toEqual([
      ['Cast iron pan', 4, 30],
      ['Stand mixer', 1, 150],
      ['Mugs', 10, 3.5],
    ]);
    expect(input.lines[0]).toMatchObject({ category: 'Kitchen', condition: 'Good', notes: 'Lodge #8' });

    const r = recordBidPurchase(data, p.id, input, lineBidItemIds, clock('2026-10-30T18:00:00.000Z'));
    expect(r.items).toHaveLength(3);
    expect(r.data.items).toHaveLength(3);
    expect(r.lot.purchasePrice).toBe(80);
    const cost = r.data.items.reduce((c, i) => c + toCents(i.unitCost * i.quantity), 0);
    expect(cost).toBe(toCents(120.04)); // 80 + 8 + 7.04 + 25, split across the items
    expect(r.plan.status).toBe('purchased');
    expect(r.plan.purchase).toMatchObject({ lotId: r.lot.id, how: 'created', pricePaid: 80, additionalCosts: 40.04, purchaseDate: '2026-10-30' });
    expect(r.plan.purchase!.itemLinks).toEqual(p.assumptions.items.map((it, i) => ({ bidItemId: it.id, itemId: r.items[i].id })));
    // The original estimate is frozen with the purchase.
    expect(r.plan.snapshot!.assumptions).toEqual(p.assumptions);
    expect(r.plan.snapshot!.results.expected).toMatchObject({ maxBid: before.scenarios.expected.maxBid, netProceeds: before.scenarios.expected.netProceeds });
    expect(r.plan.snapshot!.recommendedBid).toBe(before.scenarios.expected.recommendedBid);
    expect(bidPlanForLot(r.data, r.lot.id)?.id).toBe(p.id);
  });

  it('can’t create the same purchase twice, or change the estimate afterwards', () => {
    const { data, plan: p } = plannedShop();
    const { input, lineBidItemIds } = lotPrefillFromPlan(p, 80, '2026-10-30');
    const once = recordBidPurchase(data, p.id, input, lineBidItemIds, clock()).data;
    expect(() => recordBidPurchase(once, p.id, input, lineBidItemIds, clock())).toThrow('This plan is already recorded as purchased: lot “Storage unit #14”. Nothing new was created.');
    expect(once.lots).toHaveLength(1);
    expect(once.items).toHaveLength(3);
    expect(() => updateBidPlan(once, p.id, plan(base()), clock())).toThrow(/original estimate is kept/);
    expect(() => setBidPlanStatus(once, p.id, 'draft', '', clock())).toThrow(DomainError);
    expect(() => linkBidToLot(once, p.id, once.lots[0].id, clock())).toThrow(/already recorded as purchased/);
    // A copy can test other assumptions; the original stays.
    const copy = duplicateBidPlan(once, p.id, clock());
    expect(copy.plan.status).toBe('draft');
    expect(copy.data.bidPlans.find((x) => x.id === p.id)!.snapshot).toEqual(once.bidPlans.find((x) => x.id === p.id)!.snapshot);
  });

  it('a lot that was already entered can be linked instead of creating a duplicate', () => {
    let { data, plan: p } = plannedShop();
    data = createLot(data, { name: 'storage unit #14', purchasePrice: 75, extraCosts: [{ label: 'Premium', amount: 7.5 }], purchaseDate: '2026-10-30', source: '', notes: '', method: 'equal', lines: [{ name: 'Box of kitchenware', quantity: 1, estimatedUnitValue: null }] }, clock()).data;
    expect(similarLots(data, p).map((l) => l.name)).toEqual(['storage unit #14']);
    const lotId = data.lots[0].id;
    const r = linkBidToLot(data, p.id, lotId, clock());
    expect(r.data.items).toHaveLength(1); // nothing new
    expect(r.plan.purchase).toMatchObject({ lotId, how: 'linked', pricePaid: 75, additionalCosts: 7.5 });
    expect(similarLots(r.data, p)).toEqual([]);
    const other = createBidPlan(r.data, plan(base(), 'Another unit'), clock());
    expect(() => linkBidToLot(other.data, other.plan.id, lotId, clock())).toThrow('Lot “storage unit #14” is already linked to the plan “Storage unit #14”.');
  });

  it('a lot form left with lines the plan didn’t have still links the ones it did', () => {
    const { data, plan: p } = plannedShop();
    const { input, lineBidItemIds } = lotPrefillFromPlan(p, 80, '2026-10-30');
    input.lines.push({ name: 'Surprise lamp', quantity: 1, estimatedUnitValue: 20 });
    const r = recordBidPurchase(data, p.id, input, [...lineBidItemIds, null], clock());
    expect(r.items).toHaveLength(4);
    expect(r.plan.purchase!.itemLinks).toHaveLength(3);
  });

  it('a total-value plan starts the lot with no lines and an equal split', () => {
    const p = createBidPlan(emptyData(), plan(base({ buyerPremiumPct: 15 })), clock()).plan;
    const { input, lineBidItemIds } = lotPrefillFromPlan(p, 200, '2026-10-30');
    expect(input.lines).toEqual([]);
    expect(input.method).toBe('equal');
    expect(input.extraCosts).toEqual([{ label: 'Buyer’s premium (15%)', amount: 30 }]);
    expect(lineBidItemIds).toEqual([]);
  });
});

describe('backup and restore', () => {
  it('plans, snapshots and purchases survive a round trip; older backups load with none', () => {
    const p = createBidPlan(emptyData(), plan(base({ valueMode: 'items', items: [item('Pan', 2, 20)] })), clock());
    const { input, lineBidItemIds } = lotPrefillFromPlan(p.plan, 10, '2026-10-30');
    let data = recordBidPurchase(p.data, p.plan.id, input, lineBidItemIds, clock()).data;
    data = createBidPlan(data, plan(defaultAssumptions(), 'Pallet draft'), clock()).data;
    const back = parseBackup(JSON.stringify(createBackup('real', defaultSettings(), data, []))).data;
    expect(back.bidPlans).toEqual(data.bidPlans);

    const older = JSON.parse(JSON.stringify(createBackup('real', defaultSettings(), emptyData(), [])));
    delete older.data.bidPlans;
    expect(parseBackup(JSON.stringify(older)).data.bidPlans).toEqual([]);
  });

  it('unreadable assumptions load empty instead of failing; a plan without an id or name fails clearly', () => {
    const file = JSON.parse(JSON.stringify(createBackup('real', defaultSettings(), emptyData(), [])));
    file.data.bidPlans = [{ id: 'p1', name: 'Odd plan', status: 'purchased', assumptions: { totalResaleValue: 'lots', targetRoiPct: -4, items: [{ name: 'Lamp', quantity: 0 }, { quantity: 2 }] } }];
    const p = parseBackup(JSON.stringify(file)).data.bidPlans[0];
    expect(p.status).toBe('draft'); // "purchased" needs its purchase record
    expect(p.assumptions).toMatchObject({ totalResaleValue: null, targetRoiPct: null, valueMode: 'total' });
    expect(p.assumptions.items.map((i) => [i.name, i.quantity])).toEqual([['Lamp', 1]]);
    file.data.bidPlans = [{ name: 'No id' }];
    expect(() => parseBackup(JSON.stringify(file))).toThrow('Bid plan 1: missing "id"');
  });
});
