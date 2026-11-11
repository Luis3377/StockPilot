import { describe, expect, it } from 'vitest';
import FEB from '../marketplace/fixtures/ebay-transactions-2026-02.csv?raw';
import MAR from '../marketplace/fixtures/ebay-transactions-2026-03.csv?raw';
import PAYOUTS from '../marketplace/fixtures/ebay-payouts-2026-02.csv?raw';
import { applyImport, previewImport } from '../marketplace/reports';
import { addItem, deleteSale, recordSale, updateSale, type SaleInput } from './actions';
import { computeSale, totalSales } from './calc';
import { createLot } from './lots';
import { toCents } from './money';
import { explainPayout, matchSales, payoutFacts, reconcile, reviewTarget, type PayoutRecon } from './reconcile';
import { addReview, confirmMatch, removeMatch, undoReview } from './reconcileActions';
import { emptyData, type AppData } from './types';
import { clock } from './testUtils';
import { createBackup, parseBackup } from '../data/backup';
import { sanitizeAppData } from '../data/sanitize';
import { defaultSettings } from './types';
import { answerQuestion } from '../insights/assistant';

const importCsv = (data: AppData, text: string, name: string) => applyImport(data, previewImport(text, name, data), clock()).data;

interface RecordedSale {
  name: string;
  sku: string;
  cost: number;
  price: number;
  fees: number;
  shipping?: number;
  date: string;
  order?: string;
  platform?: string;
  quantity?: number;
  /** Units in stock before the sale (default: the quantity sold). */
  stock?: number;
}

function withSales(sales: RecordedSale[], data: AppData = emptyData()): AppData {
  for (const s of sales) {
    const added = addItem(data, { name: s.name, sku: s.sku, quantity: s.stock ?? s.quantity ?? 1, unitCost: s.cost }, clock());
    const input: SaleInput = {
      itemId: added.item.id,
      quantity: s.quantity ?? 1,
      salePrice: s.price,
      priceMode: 'total',
      platform: s.platform ?? 'eBay',
      fees: s.fees,
      shipping: s.shipping ?? 0,
      saleDate: s.date,
      orderNumber: s.order ?? '',
    };
    data = recordSale(added.data, input, clock()).data;
  }
  return data;
}

/** The StockPilot side of the fixture scenario: what the seller recorded. */
const RECORDED: RecordedSale[] = [
  { name: 'Nike Air Max 90 size 10', sku: 'SNK-001', cost: 40, price: 120, fees: 15.82, shipping: 9.45, date: '2026-01-28', order: '11-00001-00001' },
  { name: 'Sony WH-1000XM4 headphones', sku: 'EL-002', cost: 85, price: 180, fees: 24.25, date: '2026-01-30', order: '11-00002-00002' },
  // Recorded fees miss the $0.40 fixed fee and the $3.25 promoted listing fee; the label was $8.90, not $8.50.
  { name: 'Levi’s denim jacket', sku: 'CL-003', cost: 12, price: 73.5, fees: 9.74, shipping: 8.5, date: '2026-01-31', order: '11-00003-00003' },
  // The Pokémon card lot (order 11-00004-00004) was never recorded.
  { name: 'Coach wallet', sku: 'AC-005', cost: 9, price: 35, fees: 3.75, date: '2026-02-12', order: '11-00005-00005' },
  { name: 'Pyrex bowl', sku: 'HW-006', cost: 4, price: 37, fees: 5.3, date: '2026-02-14', order: '11-00006-00006' },
];

const scenario = () => importCsv(importCsv(withSales(RECORDED), FEB, 'feb.csv'), PAYOUTS, 'payouts.csv');
const payout = (data: AppData, ref: string) => reconcile(data).payouts.find((p) => p.ref === ref)!;
const cents = (n: number | null) => toCents(n ?? 0);

/** The checks every reconciliation must pass: lines add up, findings add up, nothing is lost. */
function expectTiesOut(p: PayoutRecon) {
  expect(p.expectedLines.reduce((c, l) => c + toCents(l.amount), 0)).toBe(toCents(p.expected));
  expect(p.rows.reduce((c, r) => c + r.expected, 0)).toBe(toCents(p.expected));
  expect(p.rows.reduce((c, r) => c + toCents(r.txn.net), 0)).toBe(toCents(p.reportedTotal));
  if (p.actual !== null) {
    expect(cents(p.actual) - cents(p.expected)).toBe(cents(p.difference));
    expect(p.findings.reduce((c, f) => c + toCents(f.amount), 0)).toBe(cents(p.difference));
  }
}

describe('payout reconciliation: the February scenario', () => {
  it('an exact payout reconciles to the cent', () => {
    const p = payout(scenario(), '5000000001');
    expectTiesOut(p);
    expect(p.expectedLines.map((l) => [l.key, l.amount, l.source])).toEqual([
      ['sales', 300, 'records'],
      ['fees', -40.07, 'records'],
      ['labels', -9.45, 'records'],
    ]);
    expect(p).toMatchObject({ expected: 250.48, actual: 250.48, actualSource: 'payout_report', difference: 0, status: 'reconciled', matchedCount: 2, unmatchedCount: 0, outstandingCount: 0 });
    expect(p.findings).toEqual([]);
    expect(p.marketplaceTax).toBe(24);
  });

  it('a payout that doesn’t match is explained item by item, with nothing left over', () => {
    const p = payout(scenario(), '5000000002');
    expectTiesOut(p);
    expect(p.expectedLines.map((l) => [l.key, l.amount])).toEqual([
      ['sales', 73.5],
      ['fees', -9.74],
      ['labels', -8.5],
      ['refunds', -15.5],
    ]);
    expect(p).toMatchObject({ expected: 39.76, actual: 77.82, difference: 38.06, unexplained: 0, status: 'unreconciled', matchedCount: 1, unmatchedCount: 1, outstandingCount: 1, outstandingAmount: -15.5 });
    expect(p.findings.map((f) => [f.kind, f.amount, f.certainty])).toEqual([
      ['missing_sale', 42.11, 'possible'],
      ['fee_difference', -3.65, 'confirmed'],
      ['label_difference', -0.4, 'confirmed'],
    ]);
    const fee = p.findings.find((f) => f.kind === 'fee_difference')!;
    expect(fee.explanation).toContain('eBay charged $13.39 in fees on this order ($10.14 on the sale + $3.25 in separate fee rows such as promoted listings), but $9.74 is recorded');
    expect(fee.evidence).toContainEqual({ label: 'Promoted Listings - General fee', value: '$3.25' });
    const missing = p.findings[0];
    expect(missing.evidence).toContainEqual({ label: 'Order', value: '11-00004-00004' });
    expect(p.statusReason).toBe('The payout is $38.06 more than your records lead to.');
  });

  it('a payout whose transactions aren’t imported yet needs review, not alarm', () => {
    const p = payout(scenario(), '5000000004');
    expect(p).toMatchObject({ status: 'needs_review', expected: 0, actual: 61.63, reportedTotal: 0 });
    expect(p.statusReason).toBe('eBay paid $61.63, but none of this payout’s transactions are imported yet. Import the transaction report covering the days before Mar 2, 2026.');
    expect(reconcile(scenario()).unreconciledTotal).toBe(38.06);
  });

  it('a payout eBay hasn’t finished is pending, and held funds are not missing money', () => {
    const r = reconcile(scenario());
    expect(r.payouts.find((p) => p.ref === '5000000003')!.status).toBe('pending');
    expect(r.notPaidOut).toMatchObject({ onHold: 31.7, waiting: 0, total: 31.7 });
    expect(r.notPaidOut.rows[0].source).toBe('records');
  });

  it('payouts crossing a reporting period: a later report fills the payout in, and shows a gap until all rows are imported', () => {
    const data = importCsv(scenario(), MAR, 'mar.csv');
    const r = reconcile(data);
    expect(r.notPaidOut.total).toBe(0);
    const p = r.payouts.find((x) => x.ref === '5000000004')!;
    expectTiesOut(p);
    // The held Pyrex sale (Feb 14) was paid on Mar 2; one transaction of this payout isn't imported.
    expect(p).toMatchObject({ actual: 61.63, reportedTotal: 54.13, matchedCount: 1, unmatchedCount: 1 });
    expect(p.findings.map((f) => [f.kind, f.amount])).toEqual([
      ['report_gap', 7.5],
      ['missing_sale', 22.43],
    ]);
    expect(p.findings[0].explanation).toMatch(/some of this payout’s transactions are in a report you haven’t imported/);
  });

  it('counts each recorded fee and shipping cost once, and never subtracts inventory cost', () => {
    const data = scenario();
    const r = reconcile(data);
    const all = r.payouts.flatMap((p) => p.rows).concat(r.notPaidOut.rows);
    const recordsCents = all.filter((x) => x.source === 'records').reduce((c, x) => c + x.expected, 0);
    const matchedSales = data.sales.filter((s) => r.matching.txnBySale.has(s.id));
    const recorded = matchedSales.reduce((c, s) => {
      const f = computeSale(s);
      return c + toCents(f.revenue) - toCents(f.fees) - toCents(s.shipping);
    }, 0);
    expect(recordsCents).toBe(recorded);
    // Profit is shown separately, using the recorded cost of goods sold.
    const p1 = payout(data, '5000000001');
    expect(p1.profit.costOfGoods).toBe(125);
    expect(p1.profit.netProfit).toBe(totalSales(matchedSales.slice(0, 2)).netProfit);
    expect(p1.expected).toBe(250.48);
  });

  it('a refund on a recorded sale is an outstanding adjustment until reviewed', () => {
    let data = scenario();
    const p = payout(data, '5000000002');
    const refund = p.rows.find((r) => r.txn.kind === 'refund')!;
    expect(refund).toMatchObject({ source: 'report', outstanding: true, note: 'Refund on a recorded sale: check the sale’s profit' });
    expect(refund.saleIds).toHaveLength(1);
    data = addReview(data, { target: reviewTarget.adjustment(refund.txn.key), decision: 'reviewed', reason: 'Edited the sale', amount: refund.txn.net, summary: 'Reviewed refund.', refs: [] }, clock()).data;
    expect(payout(data, '5000000002').outstandingCount).toBe(0);
  });

  it('import never changes sales, and reconciling never changes anything', () => {
    const before = withSales(RECORDED);
    const after = importCsv(importCsv(before, FEB, 'feb.csv'), PAYOUTS, 'payouts.csv');
    expect(after.sales).toEqual(before.sales);
    expect(after.items).toEqual(before.items);
    const snapshot = JSON.stringify(after);
    reconcile(after);
    expect(JSON.stringify(after)).toBe(snapshot);
  });

  it('explains a payout with exact recorded figures, for people and a future assistant', () => {
    const p = payout(scenario(), '5000000002');
    expect(explainPayout(p)).toEqual([
      'Payout 5000000002 on Feb 9, 2026: eBay paid $77.82; your records lead to an expected $39.76.',
      'Difference: +$38.06 (the payout is higher than expected).',
      'Possible: Sale not recorded in StockPilot: order 11-00004-00004 (+$42.11).',
      'Confirmed: Marketplace fees differ: order 11-00003-00003 (-$3.65).',
      'Confirmed: Shipping label cost differs: order 11-00003-00003 (-$0.40).',
    ]);
    const facts = payoutFacts(p);
    expect(facts).toMatchObject({ payout: '5000000002', expected: 39.76, actual: 77.82, difference: 38.06, unexplained: 0 });
    expect(facts.findings[0].records).toContain('eBay net amount: $42.11');
  });
});

describe('the assistant', () => {
  it('answers “why doesn’t my eBay payout match?” with the engine’s exact figures', () => {
    const answer = answerQuestion('Why doesn’t my eBay payout match?', { data: scenario(), settings: defaultSettings(), today: '2026-03-10' });
    expect(answer.intent).toBe('payouts');
    expect(answer.text).toBe('Payout 5000000002 on Feb 9, 2026: eBay paid $77.82; your records lead to an expected $39.76.');
    expect(answer.details).toContain('Possible: Sale not recorded in StockPilot: order 11-00004-00004 (+$42.11).');
    expect(answer.source).toBe('rules');
    const none = answerQuestion('why doesn’t my payout match', { data: withSales(RECORDED), settings: defaultSettings() });
    expect(none.text).toMatch(/haven’t imported any eBay payout/);
  });
});

describe('matching', () => {
  it('matches by order number automatically, and only suggests otherwise', () => {
    // Recorded without an order number: same SKU, day and amount, but still only a suggestion.
    const data = importCsv(withSales([{ name: 'Nike Air Max 90 size 10', sku: 'SNK-001', cost: 40, price: 120, fees: 15.82, shipping: 9.45, date: '2026-01-28' }]), FEB, 'feb.csv');
    const m = matchSales(data);
    const row = data.marketplace.transactions.find((t) => t.orderNumber === '11-00001-00001' && t.kind === 'sale')!;
    expect(m.byTxn.get(row.id)).toMatchObject({ saleId: null, ambiguous: false });
    expect(m.byTxn.get(row.id)!.candidates[0].reasons).toEqual(['Same SKU (SNK-001)', 'Same quantity (1)', 'Same sale amount', 'Same day', 'Similar title']);
    const p = payout(data, '5000000001');
    expect(p.findings[0]).toMatchObject({ kind: 'missing_sale', certainty: 'possible' });
    // Confirming it makes it a match; the label is then counted against the recorded shipping.
    const confirmed = confirmMatch(data, row.id, data.sales[0].id, clock());
    const after = payout(confirmed, '5000000001');
    expect(after.matchedCount).toBe(1);
    expect(after.rows.find((r) => r.txn.kind === 'shipping_label')!.expected).toBe(-945);
    expect(confirmed.marketplace.log.at(-1)!.summary).toMatch(/Matched eBay order 11-00001-00001/);
    expect(() => confirmMatch(confirmed, row.id, data.sales[0].id, clock())).toThrow('already matched');
    const undone = removeMatch(confirmed, row.id, clock());
    expect(matchSales(undone).byTxn.get(row.id)!.saleId).toBeNull();
    expect(undone.marketplace.log.at(-1)!.action).toBe('unmatch');
  });

  it('never picks between two sales with the same order number and SKU', () => {
    // The same sale entered twice.
    let base = withSales([{ name: 'Sony headphones', sku: 'EL-002', cost: 85, price: 180, fees: 24.25, date: '2026-01-30', order: '11-00002-00002', stock: 2 }]);
    const first = base.sales[0];
    base = recordSale(base, { itemId: first.itemId, quantity: 1, salePrice: 180, priceMode: 'total', platform: 'eBay', fees: 24.25, saleDate: '2026-01-30', orderNumber: '11-00002-00002' }, clock()).data;
    const data = importCsv(base, FEB, 'feb.csv');
    const row = data.marketplace.transactions.find((t) => t.orderNumber === '11-00002-00002' && t.kind === 'sale')!;
    const info = matchSales(data).byTxn.get(row.id)!;
    expect(info).toMatchObject({ saleId: null, ambiguous: true });
    expect(info.candidates).toHaveLength(2);
    const f = payout(data, '5000000001').findings.find((x) => x.kind === 'ambiguous_match')!;
    expect(f.title).toBe('Order 11-00002-00002: choose which recorded sale it is');
    const fixed = confirmMatch(data, row.id, data.sales[0].id, clock());
    expect(matchSales(fixed).byTxn.get(row.id)!.saleId).toBe(data.sales[0].id);
    // The other entry is now a recorded sale with no report row: a possible duplicate.
    expect(reconcile(fixed).unmatchedSales.map((u) => [u.sale.id, u.reason])).toEqual([[data.sales[1].id, expect.stringMatching(/^Possible duplicate: another recorded sale already matches eBay order 11-00002-00002/)]]);
  });

  it('uses the SKU to tell apart sales that share an order number', () => {
    const data = importCsv(
      withSales([
        { name: 'Sony headphones', sku: 'EL-002', cost: 85, price: 180, fees: 24.25, date: '2026-01-30', order: '11-00002-00002' },
        { name: 'Headphone stand', sku: 'EL-STAND', cost: 5, price: 20, fees: 2, date: '2026-01-30', order: '11-00002-00002' },
      ]),
      FEB,
      'feb.csv',
    );
    const row = data.marketplace.transactions.find((t) => t.orderNumber === '11-00002-00002' && t.kind === 'sale')!;
    expect(matchSales(data).byTxn.get(row.id)).toMatchObject({ saleId: data.sales[0].id, method: 'order_number' });
    expect(reconcile(data).unmatchedSales.map((u) => u.sale.itemName)).toEqual(['Headphone stand']);
  });

  it('pairs the lines of a multi-item order by SKU', () => {
    const header = 'Transaction creation date,Type,Order number,Net amount,Payout ID,Custom label,Item subtotal,Shipping and handling,Final Value Fee - fixed,Final Value Fee - variable';
    const csv = `${header}\n2026-03-01,Order,77-1,9.00,P9,MUG,10.00,0,0,-1.00\n2026-03-01,Order,77-1,18.00,P9,BOWL,20.00,0,0,-2.00`;
    const data = importCsv(
      withSales([
        { name: 'Bowl', sku: 'BOWL', cost: 1, price: 20, fees: 2, date: '2026-03-01', order: '77-1' },
        { name: 'Mug', sku: 'MUG', cost: 1, price: 10, fees: 1, date: '2026-03-01', order: '77-1' },
      ]),
      csv,
      'x.csv',
    );
    const p = payout(data, 'P9');
    expect(p).toMatchObject({ matchedCount: 2, expected: 27, reportedTotal: 27 });
    expect(p.findings).toEqual([]);
  });
});

describe('payout edge cases', () => {
  const header =
    'Transaction creation date,Type,Order number,Net amount,Payout ID,Payout date,Payout status,Custom label,Item subtotal,Shipping and handling,Seller collected tax,eBay collected tax,Final Value Fee - fixed,Final Value Fee - variable,Reference ID,Description';
  const payoutsCsv = (rows: string[]) => ['Payout date,Payout ID,Status,Amount', ...rows].join('\n');

  it('tax the seller collected is in the payout but isn’t revenue; tax eBay collected is neither', () => {
    const csv = `${header}\n2026-03-01,Order,T-1,108.00,PT,2026-03-03,Succeeded,TX,100.00,0,8.00,0,0,0,R1,`;
    let data = importCsv(withSales([{ name: 'Lamp', sku: 'TX', cost: 30, price: 100, fees: 0, date: '2026-03-01', order: 'T-1' }]), csv, 't.csv');
    data = importCsv(data, payoutsCsv(['2026-03-03,PT,Succeeded,108.00']), 'p.csv');
    const p = payout(data, 'PT');
    expectTiesOut(p);
    expect(p.expectedLines.map((l) => [l.key, l.amount, l.source])).toEqual([
      ['sales', 100, 'records'],
      ['fees', 0, 'records'],
      ['seller_tax', 8, 'report'],
    ]);
    expect(p.status).toBe('reconciled');
    expect(p.profit.revenue).toBe(100);

    const ebayTax = `${header}\n2026-03-01,Order,T-2,100.00,PU,2026-03-03,Succeeded,TY,100.00,0,0,8.00,0,0,R2,`;
    let d2 = importCsv(withSales([{ name: 'Lamp', sku: 'TY', cost: 30, price: 100, fees: 0, date: '2026-03-01', order: 'T-2' }]), ebayTax, 't.csv');
    d2 = importCsv(d2, payoutsCsv(['2026-03-03,PU,Succeeded,100.00']), 'p.csv');
    expect(payout(d2, 'PU')).toMatchObject({ expected: 100, difference: 0, marketplaceTax: 8, status: 'reconciled' });
  });

  it('a sale recorded without the buyer’s shipping is flagged with that possible cause', () => {
    const csv = `${header}\n2026-03-01,Order,S-1,95.00,PS,2026-03-03,Succeeded,SH,90.00,10.00,0,0,0,-5.00,R1,`;
    let data = importCsv(withSales([{ name: 'Boots', sku: 'SH', cost: 30, price: 90, fees: 5, date: '2026-03-01', order: 'S-1' }]), csv, 't.csv');
    data = importCsv(data, payoutsCsv(['2026-03-03,PS,Succeeded,95.00']), 'p.csv');
    const p = payout(data, 'PS');
    expectTiesOut(p);
    expect(p.findings.map((f) => [f.kind, f.amount])).toEqual([['sale_amount', 10]]);
    expect(p.findings[0].explanation).toMatch(/shipping the buyer paid \(\$10\.00\) wasn’t included in the recorded price/);
  });

  it('a fee charged in a later payout is a timing difference that evens out', () => {
    const csv = `${header}\n2026-03-01,Order,F-1,90.00,PA,2026-03-03,Succeeded,FE,100.00,0,0,0,0,-10.00,R1,\n2026-03-05,Other fee,F-1,-2.00,PB,2026-03-08,Succeeded,,,,,,,,R2,Ad fee`;
    let data = importCsv(withSales([{ name: 'Clock', sku: 'FE', cost: 30, price: 100, fees: 12, date: '2026-03-01', order: 'F-1' }]), csv, 't.csv');
    data = importCsv(data, payoutsCsv(['2026-03-03,PA,Succeeded,90.00', '2026-03-08,PB,Succeeded,-2.00']), 'p.csv');
    const a = payout(data, 'PA');
    const b = payout(data, 'PB');
    expectTiesOut(a);
    expectTiesOut(b);
    expect(a.findings.map((f) => [f.kind, f.amount])).toEqual([['fees_other_payout', 2]]);
    expect(b.findings.map((f) => [f.kind, f.amount])).toEqual([['fees_other_payout', -2]]);
    expect([a.status, b.status]).toEqual(['pending', 'pending']);
    expect(a.statusReason).toMatch(/Timing difference/);
    expect(cents(a.difference) + cents(b.difference)).toBe(0);
  });

  it('a label void credited later, and a recorded sale net of its refund', () => {
    const csv = [
      header,
      '2026-03-01,Order,L-1,80.00,PA,2026-03-03,Succeeded,LV,80.00,0,0,0,0,0,R1,',
      '2026-03-01,Shipping label,L-1,-12.00,PA,2026-03-03,Succeeded,,,,,,,,R2,Label',
      '2026-03-02,Shipping label,L-1,12.00,PB,2026-03-08,Succeeded,,,,,,,,R3,Label voided',
      '2026-03-02,Shipping label,L-1,-7.00,PB,2026-03-08,Succeeded,,,,,,,,R4,Label',
      '2026-03-04,Refund,L-1,-20.00,PB,2026-03-08,Succeeded,,,,,,,,R5,Partial refund',
    ].join('\n');
    // The seller recorded the sale at $60 (net of the refund) and $7 of shipping.
    let data = importCsv(withSales([{ name: 'Vase', sku: 'LV', cost: 10, price: 60, fees: 0, shipping: 7, date: '2026-03-01', order: 'L-1' }]), csv, 't.csv');
    data = importCsv(data, payoutsCsv(['2026-03-03,PA,Succeeded,68.00', '2026-03-08,PB,Succeeded,-15.00']), 'p.csv');
    const a = payout(data, 'PA');
    const b = payout(data, 'PB');
    expectTiesOut(a);
    expectTiesOut(b);
    expect(a.findings.map((f) => [f.kind, f.amount])).toEqual([
      ['sale_amount', 20],
      ['label_difference', 0 - 0],
      ['labels_other_payout', -5],
    ].filter(([, n]) => n !== 0));
    expect(a.findings[0].explanation).toMatch(/recorded the sale net of its \$20\.00 refund/);
    expect(b.findings.map((f) => [f.kind, f.amount])).toEqual([['labels_other_payout', 5]]);
    // Across both payouts the shipping cost is counted once: $12 − $12 + $7 = $7.
    expect(cents(a.difference) + cents(b.difference)).toBe(2000);
  });

  it('flags identical rows as a possible duplicate, without dropping either', () => {
    const csv = `${header}\n2026-03-01,Other fee,,-4.99,PD,2026-03-03,Succeeded,,,,,,,,R1,Store subscription\n2026-03-01,Other fee,,-4.99,PD,2026-03-03,Succeeded,,,,,,,,R2,Store subscription`;
    let data = importCsv(emptyData(), csv, 't.csv');
    data = importCsv(data, payoutsCsv(['2026-03-03,PD,Succeeded,-9.98']), 'p.csv');
    const p = payout(data, 'PD');
    expect(p).toMatchObject({ expected: -9.98, difference: 0, outstandingCount: 2 });
    expect(p.findings.map((f) => [f.kind, f.certainty])).toEqual([['possible_duplicate', 'possible']]);
    expect(p.status).toBe('needs_review');
  });

  it('a payout seen only in the transaction report needs its amount before it can reconcile', () => {
    const csv = `${header}\n2026-03-01,Order,N-1,10.00,PN,2026-03-03,Succeeded,NN,10.00,0,0,0,0,0,R1,`;
    const data = importCsv(withSales([{ name: 'Pin', sku: 'NN', cost: 1, price: 10, fees: 0, date: '2026-03-01', order: 'N-1' }]), csv, 't.csv');
    const p = payout(data, 'PN');
    expect(p).toMatchObject({ actual: null, difference: null, status: 'needs_review' });
    expect(explainPayout(p)[0]).toMatch(/isn’t known yet/);
  });

  it('a failed payout needs review', () => {
    let data = importCsv(emptyData(), `${header}\n2026-03-01,Other fee,,-1.00,PF,2026-03-03,Failed,,,,,,,,R1,x`, 't.csv');
    data = importCsv(data, payoutsCsv(['2026-03-03,PF,Failed,-1.00']), 'p.csv');
    expect(payout(data, 'PF')).toMatchObject({ status: 'needs_review', statusReason: 'eBay shows this payout as “Failed”.' });
  });

  it('never loses or creates a cent: random payouts tie out', () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % n;
    };
    const money = (max: number) => (rand(max * 100) / 100).toFixed(2);
    for (let round = 0; round < 40; round++) {
      const lines = [header];
      const sales: RecordedSale[] = [];
      const payoutTotals = new Map<string, number>();
      for (let o = 0; o < 1 + rand(6); o++) {
        const order = `O${round}-${o}`;
        const sub = money(300);
        const ship = money(20);
        const fixed = money(1);
        const variable = money(40);
        const pay = `P${round}-${rand(3)}`;
        const net = toCents(+sub) + toCents(+ship) - toCents(+fixed) - toCents(+variable);
        lines.push(`2026-03-01,Order,${order},${(net / 100).toFixed(2)},${pay},2026-03-05,Succeeded,SKU${o},${sub},${ship},0,0,-${fixed},-${variable},R${round}-${o},`);
        payoutTotals.set(pay, (payoutTotals.get(pay) ?? 0) + net);
        if (rand(4)) {
          const label = toCents(+money(15));
          const lp = `P${round}-${rand(3)}`;
          lines.push(`2026-03-01,Shipping label,${order},-${(label / 100).toFixed(2)},${lp},2026-03-05,Succeeded,,,,,,,,L${round}-${o},Label`);
          payoutTotals.set(lp, (payoutTotals.get(lp) ?? 0) - label);
        }
        if (rand(3) === 0) {
          const fee = toCents(+money(5));
          const fp = `P${round}-${rand(3)}`;
          lines.push(`2026-03-02,Other fee,${order},-${(fee / 100).toFixed(2)},${fp},2026-03-05,Succeeded,,,,,,,,F${round}-${o},Ad fee`);
          payoutTotals.set(fp, (payoutTotals.get(fp) ?? 0) - fee);
        }
        if (rand(4) === 0) {
          const refund = toCents(+money(30));
          const rp = `P${round}-${rand(3)}`;
          lines.push(`2026-03-03,Refund,${order},-${(refund / 100).toFixed(2)},${rp},2026-03-05,Succeeded,,,,,,,,X${round}-${o},Refund`);
          payoutTotals.set(rp, (payoutTotals.get(rp) ?? 0) - refund);
        }
        if (rand(5)) sales.push({ name: `Thing ${o}`, sku: `SKU${o}`, cost: 3, price: +sub + (rand(3) ? +ship : 0), fees: +fixed + +variable + (rand(2) ? 0.5 : 0), shipping: +money(15), date: '2026-03-01', order });
      }
      let data = importCsv(withSales(sales), lines.join('\n'), `r${round}.csv`);
      const gap = rand(3) === 0 ? 137 : 0;
      data = importCsv(data, payoutsCsv([...payoutTotals].map(([id, c], i) => `2026-03-05,${id},Succeeded,${((c + (i === 0 ? gap : 0)) / 100).toFixed(2)}`)), `p${round}.csv`);
      for (const p of reconcile(data).payouts) {
        expectTiesOut(p);
        expect(cents(p.unexplained)).toBe(0);
      }
    }
  });
});

describe('decisions and the audit trail', () => {
  it('a difference explained by the user stays visible; it reopens if the amount changes', () => {
    let data = scenario();
    const p = payout(data, '5000000002');
    const r = addReview(
      data,
      { target: reviewTarget.payout(p.ref), decision: 'resolved', reason: 'Card lot sold from my personal collection', amount: p.difference!, summary: `Accepted ${p.difference} on ${p.ref}.`, refs: [] },
      clock(),
    );
    data = r.data;
    const after = payout(data, '5000000002');
    expect(after.status).toBe('reconciled');
    expect(after.difference).toBe(38.06);
    expect(after.statusReason).toBe('Difference of +$38.06 explained by you: “Card lot sold from my personal collection”.');
    // Recording the missing sale changes the difference, so the old note no longer covers it.
    const changed = withSales([{ name: 'Card lot', sku: 'CC-004', cost: 10, price: 49, fees: 6.89, date: '2026-02-05', order: '11-00004-00004' }], data);
    expect(payout(changed, '5000000002')).toMatchObject({ status: 'unreconciled', difference: -3.65 + -0.4 + 0, acceptedDifference: null });
    // Undo keeps the history.
    data = undoReview(data, r.review.id, clock());
    expect(payout(data, '5000000002').status).toBe('unreconciled');
    expect(data.marketplace.reviews[0].undoneAt).not.toBeNull();
    expect(data.marketplace.log.map((e) => e.action)).toEqual(['import', 'import', 'review', 'undo_review']);
    expect(() => addReview(data, { target: 'x', decision: 'resolved', reason: '  ', amount: 1, summary: '', refs: [] })).toThrow('Say why');
  });

  it('resolving every finding reconciles the payout, without changing the numbers', () => {
    let data = scenario();
    for (const f of payout(data, '5000000002').findings) {
      data = addReview(data, { target: reviewTarget.finding('5000000002', f.key), decision: 'resolved', reason: `Checked: ${f.kind}`, amount: f.amount, summary: '', refs: [] }, clock()).data;
    }
    const p = payout(data, '5000000002');
    expect(p).toMatchObject({ status: 'reconciled', difference: 38.06, expected: 39.76 });
    expect(p.findings.every((f) => f.review)).toBe(true);
  });

  it('editing a matched sale updates the reconciliation (the report is never edited)', () => {
    let data = scenario();
    const jacket = data.sales.find((s) => s.orderNumber === '11-00003-00003')!;
    data = updateSale(
      data,
      jacket.id,
      { itemId: jacket.itemId, quantity: 1, salePrice: 73.5, priceMode: 'total', platform: 'eBay', fees: 13.39, shipping: 8.9, saleDate: jacket.saleDate, orderNumber: jacket.orderNumber },
      clock(),
    ).data;
    expect(payout(data, '5000000002').findings.map((f) => f.kind)).toEqual(['missing_sale']);
    // Cancelling a matched sale makes its order unmatched again.
    data = deleteSale(data, jacket.id, clock()).data;
    expect(payout(data, '5000000002').unmatchedCount).toBe(2);
  });
});

describe('integration with lots, profit and backups', () => {
  it('a bulk lot item sold on eBay: the payout ignores its cost; profit uses its exact lot share', () => {
    let { data, items } = createLot(
      emptyData(),
      { name: 'Box', purchasePrice: 10, extraCosts: [], purchaseDate: '2026-02-20', source: '', notes: '', method: 'equal', lines: [{ name: 'Mug', quantity: 3, estimatedUnitValue: null }] },
      clock(),
    );
    data = recordSale(data, { itemId: items[0].id, quantity: 1, salePrice: 15, priceMode: 'per_unit', platform: 'eBay', fees: 2, saleDate: '2026-03-01', orderNumber: 'LOT-1' }, clock()).data;
    const csv = 'Transaction creation date,Type,Order number,Net amount,Payout ID,Item subtotal,Shipping and handling,Final Value Fee - fixed,Final Value Fee - variable\n2026-03-01,Order,LOT-1,13.00,PL,15.00,0,0,-2.00';
    data = importCsv(data, csv, 'lot.csv');
    data = importCsv(data, 'Payout date,Payout ID,Status,Amount\n2026-03-03,PL,Succeeded,13.00', 'p.csv');
    const p = payout(data, 'PL');
    expect(p).toMatchObject({ expected: 13, difference: 0, status: 'reconciled' });
    expect(p.profit).toMatchObject({ costOfGoods: 3.33, netProfit: 9.67 });
  });

  it('backups keep imports, matches and decisions; older backups load with none', () => {
    let data = scenario();
    const row = data.marketplace.transactions[0];
    data = addReview(data, { target: reviewTarget.payout('5000000002'), decision: 'resolved', reason: 'ok', amount: 38.06, summary: '', refs: [] }, clock()).data;
    const parsed = parseBackup(JSON.stringify(createBackup('real', defaultSettings(), data, [])));
    expect(parsed.data).toEqual(data);
    expect(reconcile(parsed.data).payouts.map((p) => p.status)).toEqual(reconcile(data).payouts.map((p) => p.status));
    expect(parsed.data.marketplace.transactions[0].key).toBe(row.key);

    const old = JSON.parse(JSON.stringify(createBackup('real', defaultSettings(), withSales(RECORDED), [])));
    delete old.data.marketplace;
    for (const s of old.data.sales) delete s.orderNumber;
    const restored = parseBackup(JSON.stringify(old)).data;
    expect(restored.marketplace).toEqual({ imports: [], transactions: [], payouts: [], matches: [], reviews: [], log: [] });
    expect(restored.sales.every((s) => s.orderNumber === '')).toBe(true);

    const broken = JSON.parse(JSON.stringify(data));
    broken.marketplace.transactions[0].net = 'lots';
    expect(() => sanitizeAppData(broken)).toThrow('Marketplace transaction 1: "net" must be a number');
  });
});
