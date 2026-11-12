import { describe, expect, it } from 'vitest';
import { inventoryAt, taxWorksheet, yearFigures, yearPeriod } from './yearEnd';
import { yearChecklist } from './yearChecklist';
import { movementsCsv, yearInventoryCsv, yearReport, yearReportSnapshot, yearSalesCsv } from './yearReport';
import { reportHtml } from './controllerReport';
import { parseCsv } from '../csv/csv';
import { ledgerInfo } from './monthly';
import { assertClosedMonthsUnchanged, reopenMonth } from '../domain/close';
import { assertFinalizedYearsUnchanged, decideYearStep, designateYearCount, finalizeYear, reopenYear } from '../domain/yearEnd';
import { startLedger, trackChanges } from '../domain/ledger';
import { addItem, recordSale, updateSale } from '../domain/actions';
import { toCents } from '../domain/money';
import { createBackup, parseBackup } from '../data/backup';
import { defaultSettings, emptyData, type AppData, type YearStepKey } from '../domain/types';
import { at, sell } from './closeFixture';
import { closeWholeMonth, countOn, yearShop } from './yearFixture';

const settings = defaultSettings();
const AFTER = '2027-02-10';
const fig = (data: AppData, key: string, today = AFTER) => yearFigures(data, settings, key, today);

/** Decides every year step (acknowledging issues, N/A where nothing was performed). */
function decideAll(data: AppData, key: string, today = AFTER): AppData {
  let d = data;
  for (const s of yearChecklist(d, settings, key, today).steps) {
    const attention = s.issues.some((i) => i.severity === 'attention');
    d = decideYearStep(d, settings, key, s.step as YearStepKey, attention ? 'acknowledged' : s.canReview ? 'reviewed' : 'na', attention ? 'Discussed with the accountant.' : '', today, at(today));
  }
  return d;
}

/** As the store applies a change: ledger, then both guards. */
function attempt(before: AppData, date: string, fn: (d: AppData) => { data: AppData }) {
  const after = trackChanges(before, fn(before).data, at(date));
  assertClosedMonthsUnchanged(before, after);
  assertFinalizedYearsUnchanged(before, after);
  return after;
}

describe('annual inventory reconciliation', () => {
  it('2025: purchases with bulk-lot buying costs, fractional plate costs and a Dec 31 sale', () => {
    const { data } = yearShop();
    const y = fig(data, '2025');
    expect(y.rf.beginning).toBe(0);
    expect(y.purchases).toBe(150); // lamps $50 + estate box $90 + $10 freight, once
    expect(y.capitalizedCosts).toBe(10);
    expect(y.line('cogs')).toBe(-29.17); // lamp $12.50 + 2 plates $16.67 (exact share of $50 / 6)
    expect(y.rf.expectedEnding).toBe(120.83);
    expect(y.rf.recordsEnding).toBe(120.83); // today's records less 2026–27 movements: independent
    expect(y.independentEnding).toBe(120.83);
    expect(y.difference).toBe(0);
    expect(y.beginning.status).toBe('verified');
  });

  it('2026: every kind of movement, and the December/January boundary', () => {
    const { data } = yearShop();
    const y = fig(data, '2026');
    expect(y.rf.beginning).toBe(120.83); // = 2025's ending: the Dec 31 sale is in 2025, the Jan 2 sale in 2026
    expect(y.line('cogs')).toBe(-35.33); // plate $8.33 + 2 lamps $27.00
    expect(y.line('restocks')).toBe(28);
    expect(y.line('items')).toBe(80);
    expect(y.purchases).toBe(108);
    expect(y.line('decreases')).toBe(-13.1); // damaged lamp at the averaged $13.10
    expect(y.line('withdrawals')).toBe(-50); // vase used personally
    expect(y.line('returns')).toBe(8.33);
    expect(y.line('removed')).toBe(-80);
    expect(y.line('corrections')).toBe(1.6); // 4 lamps $13.10 → $13.50
    expect(y.rf.expectedEnding).toBe(60.33);
    expect(y.independentEnding).toBe(60.33);
    expect(y.difference).toBe(0);
    expect(y.rf.lines.find((l) => l.key === 'removed')!.records[0]).toMatchObject({ label: 'Wool rug', date: '2026-06-01' });
  });

  it('inventory on hand at year-end, item by item, adds up to the ending balance', () => {
    const { data, lamp, vase, plates } = yearShop();
    const info = ledgerInfo(data);
    const at25 = inventoryAt(data, info, '2025-12-31');
    expect(at25.map((i) => [i.itemId, i.units, i.cost])).toEqual(
      expect.arrayContaining([
        [lamp.id, 3, 37.5],
        [vase.id, 1, 50],
        [plates.id, 4, 33.33],
      ]),
    );
    expect(at25.reduce((c, i) => c + toCents(i.cost), 0)).toBe(12083);
    // The deleted rug was on hand in May 2026 but not at year-end.
    expect(inventoryAt(data, info, '2026-05-20').find((i) => i.name === 'Wool rug')).toMatchObject({ units: 1, cost: 80, exists: false });
    expect(inventoryAt(data, info, '2026-12-31').reduce((c, i) => c + toCents(i.cost), 0)).toBe(6033);
  });

  it('never invents a zero difference: missing opening balances and pre-ledger years', () => {
    // Older data: activity from 2025, ledger starting March 15, 2026.
    let data = addItem(emptyData(), { name: 'Bookshelf', quantity: 3, unitCost: 40, purchaseDate: '2025-06-01' }, at('2025-06-01')).data;
    data = recordSale(data, { itemId: data.items[0].id, quantity: 1, salePrice: 90, priceMode: 'total', saleDate: '2025-08-01' }, at('2025-08-01')).data;
    data = startLedger(data, at('2026-03-15'));
    const y25 = fig(data, '2025', '2026-04-01');
    expect(y25.rf.status).toBe('not_available');
    expect(y25.difference).toBeNull();
    expect(y25.independentEnding).toBeNull();
    expect(y25.beginning).toMatchObject({ status: 'missing', text: expect.stringContaining('Cannot fully verify') });
    expect(y25.totals.revenue).toBe(90); // sales still come from the sale records
    const y26 = fig(data, '2026', '2027-01-10');
    expect(y26.rf.status).toBe('partial');
    expect(y26.beginning.status).toBe('partial');
    expect(y26.beginning.missing[0]).toContain('Inventory cost on Jan 1, 2026');
    expect(y26.coverage.months.filter((m) => m.status === 'not_verifiable').map((m) => m.month)).toEqual(['2026-01', '2026-02']);
    const ws = taxWorksheet(y26, settings);
    expect(ws.lines.find((l) => l.line === '35')).toMatchObject({ status: 'needs_review' });
    expect(taxWorksheet(y25, settings).lines.find((l) => l.line === '36')).toMatchObject({ amount: null, status: 'needs_review' });
  });

  it('an unexplained change shows as a difference, to the cent', () => {
    const { data, plates } = yearShop();
    const tampered = { ...data, items: data.items.map((i) => (i.id === plates.id ? { ...i, quantity: 5 } : i)) };
    const y = fig(tampered, '2026');
    expect(y.difference).toBe(8.34); // 5 × $8.3333 = $41.67 instead of $33.33
    expect(yearChecklist(tampered, settings, '2026', AFTER).steps.find((s) => s.step === 'reconciliation')!.issues[0].text).toContain('Unexplained difference of +$8.34');
  });
});

describe('year-end count', () => {
  it('a count after the year-end is rolled back, and unapplied differences need a recount', () => {
    let { data, lamp, plates } = yearShop();
    data = sell(data, lamp.id, 1, 30, '2027-01-03').data; // between Dec 31 and the count
    data = countOn(data, '2027-01-05', { [lamp.id]: 1, [plates.id]: 3 }, false).data;
    data = designateYearCount(data, '2026', data.countHistory.at(-1)!.id, at('2027-01-06'));
    const y = fig(data, '2026');
    expect(y.count).toMatchObject({ timing: 'after', full: true, between: { count: 1, cents: -1350 } });
    expect(y.count!.lines.find((l) => l.itemId === plates.id)).toMatchObject({ status: 'needs_recount', valueDifference: -8.33 });
    expect(y.rf.recordsEnding).toBe(60.33);
    expect(y.independentEnding).toBe(52); // records $60.33 − the plate the count didn’t find
    expect(y.difference).toBe(-8.33);
    expect(y.countDifference).toBe(-8.33);
    expect(y.bookDifference).toBe(0);
    expect(y.independentBasis).toContain('Physical count on Jan 5, 2027, after the year-end: the 1 recorded movement between Dec 31, 2026 and the count');
    const step = yearChecklist(data, settings, '2026', AFTER).steps.find((s) => s.step === 'count')!;
    expect(step.issues[0].text).toBe('Recount Dinner plates: counted 3, records say 4 (difference not applied, −$8.33 at cost).');
  });

  it('a count on Dec 31 that is applied is recorded once, as a dated write-off', () => {
    let { data, plates } = yearShop();
    data = countOn(data, '2026-12-31', { [plates.id]: 3 }, true).data;
    data = designateYearCount(data, '2026', data.countHistory.at(-1)!.id, at('2027-01-02'));
    const y = fig(data, '2026');
    expect(y.count!.timing).toBe('on');
    expect(y.line('decreases')).toBe(-21.43); // damaged lamp $13.10 + missing plate $8.33
    expect(y.rf.recordsEnding).toBe(52);
    expect(y.independentEnding).toBe(52);
    expect(y.difference).toBe(0);
    expect(() => designateYearCount(data, '2026', 'nope', at('2027-01-02'))).toThrow('wasn’t completed within a month of Dec 31, 2026');
  });
});

describe('monthly coverage', () => {
  it('shows closed, exception, missing and future months, and the closes add up to the year', () => {
    let { data } = yearShop();
    data = closeWholeMonth(data, '2026-01', '2026-11-20');
    data = closeWholeMonth(data, '2026-06', '2026-11-20'); // the deleted rug: closed with an acknowledged issue
    const y = fig(data, '2026', '2026-11-20');
    const status = Object.fromEntries(y.coverage.months.map((m) => [m.month, m.status]));
    expect(status).toMatchObject({ '2026-01': 'verified', '2026-02': 'missing', '2026-06': 'exceptions', '2026-11': 'future', '2026-12': 'future' });
    expect(y.coverage.complete).toBe(false);
    expect(y.coverage.sums).toBeNull();
    // All twelve months closed: the closes add up to the year exactly.
    let all = yearShop().data;
    for (let m = 1; m <= 12; m++) all = closeWholeMonth(all, `2026-${String(m).padStart(2, '0')}`, AFTER);
    const full = fig(all, '2026');
    expect(full.coverage.complete).toBe(true);
    expect(full.coverage.inconsistencies).toEqual([]);
    expect(full.coverage.sums!.map((s) => [s.label, s.closes, s.year])).toEqual([
      ['Sales revenue', 80, 80],
      ['Cost of goods sold', 35.33, 35.33],
      ['Realized profit', 36.67, 36.67],
      ['Inventory purchases', 108, 108],
    ]);
  });

  it('a month reopened after closing shows as open', () => {
    let { data } = yearShop();
    data = closeWholeMonth(data, '2026-03', AFTER);
    data = reopenMonth(data, '2026-03', 'Vase was a gift, not personal use.', at(AFTER));
    expect(fig(data, '2026').coverage.months.find((m) => m.month === '2026-03')).toMatchObject({ status: 'open', statusText: expect.stringContaining('Reopened') });
  });
});

describe('finalizing and reopening a year', () => {
  it('finalizing keeps the figures, coverage, count and report; next year starts from it', () => {
    const { data } = yearShop();
    expect(() => finalizeYear(data, settings, '2026', { acknowledged: true, note: '' }, '2026-12-15', at('2026-12-15'))).toThrow('2026 can’t be finalized yet');
    const ready = decideAll(data, '2026');
    const r = finalizeYear(ready, settings, '2026', { acknowledged: true, note: 'Sent to the accountant.' }, AFTER, at(AFTER));
    expect(r.review).toMatchObject({ periodKey: '2026', version: 1, status: 'finalized', count: null });
    expect(r.review.figures).toMatchObject({ beginning: 120.83, purchases: 108, costOfGoodsSold: 35.33, expectedEnding: 60.33, independentEnding: 60.33, difference: 0 });
    expect(r.review.coverage).toHaveLength(12);
    expect(r.review.report.title).toBe('Year-End Inventory Summary: 2026');
    expect(r.data.yearEnd.audit.at(-1)!.detail).toContain('Finalized the 2026 year-end review (version 1)');
    // 2027 begins from the finalized 2026 review.
    const y27 = fig(r.data, '2027', '2028-01-15');
    expect(y27.rf.beginning).toBe(60.33);
    expect(y27.rf.beginningBasis).toContain('2026 year-end review');
  });

  it('a finalized year refuses changes; reopening a month allows corrections there and flags the year', () => {
    const { data, lamp } = yearShop();
    let d = closeWholeMonth(data, '2026-09', AFTER);
    d = finalizeYear(decideAll(d, '2026'), settings, '2026', { acknowledged: true, note: '' }, AFTER, at(AFTER)).data;
    // A month never closed, inside the finalized year: refused by the year.
    expect(() => attempt(d, AFTER, (x) => recordSale(x, { itemId: lamp.id, quantity: 1, salePrice: 30, priceMode: 'total', saleDate: '2026-04-02' }, at(AFTER)))).toThrow('part of the finalized 2026 year-end review. Reopen the 2026 review first');
    // A closed month: the monthly lock answers first.
    const sep = d.sales.find((s) => s.saleDate === '2026-09-15')!;
    const edit = (x: AppData) => updateSale(x, sep.id, { itemId: sep.itemId, quantity: 2, salePrice: 64, priceMode: 'total', fees: 6, saleDate: sep.saleDate }, at(AFTER));
    expect(() => attempt(d, AFTER, edit)).toThrow('That would change September 2026, which is closed');
    // Today's work is unaffected.
    attempt(d, AFTER, (x) => recordSale(x, { itemId: lamp.id, quantity: 1, salePrice: 30, priceMode: 'total', saleDate: AFTER }, at(AFTER)));
    // Reopening September flags the year; the correction then goes through, and the review stays as it was.
    d = reopenMonth(d, '2026-09', 'Lamp sale price was $64.', at('2027-02-11'));
    expect(d.yearEnd.audit.at(-1)).toMatchObject({ kind: 'flagged', detail: expect.stringContaining('September 2026 was reopened (Lamp sale price was $64.): the finalized 2026 review (version 1) needs re-review') });
    d = attempt(d, '2027-02-11', edit);
    const list = yearChecklist(d, settings, '2026', '2027-02-11');
    expect(list.review!.figures.realizedProfit).toBe(36.67); // unchanged
    expect(list.flags.join(' ')).toContain('Reopened September 2026');
    // Reopening the year needs a reason, keeps version 1, and version 2 reflects the correction.
    expect(() => reopenYear(d, '2026', '', at('2027-02-12'))).toThrow('Say why you’re reopening the year');
    d = reopenYear(d, '2026', 'September lamp sale corrected.', at('2027-02-12'));
    d = closeWholeMonth(d, '2026-09', '2027-02-12');
    const v2 = finalizeYear(decideAll(d, '2026', '2027-02-12'), settings, '2026', { acknowledged: true, note: '' }, '2027-02-12', at('2027-02-12'));
    expect(v2.review.version).toBe(2);
    expect(v2.review.figures.realizedProfit).toBe(40.67);
    expect(v2.data.yearEnd.reviews.find((r) => r.version === 1)).toMatchObject({ status: 'superseded', reopenReason: 'September lamp sale corrected.', figures: { realizedProfit: 36.67 } });
  });

  it('year-end data survives a backup round trip', () => {
    let { data, plates } = yearShop();
    data = countOn(data, '2026-12-31', { [plates.id]: 4 }, false).data;
    data = designateYearCount(data, '2026', data.countHistory.at(-1)!.id, at(AFTER));
    data = finalizeYear(decideAll(data, '2026'), settings, '2026', { acknowledged: true, note: 'ok' }, AFTER, at(AFTER)).data;
    const back = parseBackup(JSON.stringify(createBackup('real', settings, data, []))).data;
    expect(back.yearEnd).toEqual(data.yearEnd);
    expect(back.inventoryLedger).toEqual(data.inventoryLedger);
  });
});

describe('accountant summary, worksheet and downloads', () => {
  it('the summary states each figure from the records', () => {
    const { data } = yearShop();
    const r = yearReport(data, settings, '2026', AFTER, '2027-02-10T12:00:00.000Z');
    const text = r.sections.find((s) => s.key === 'summary')!.lines.map((l) => l.text);
    expect(text).toEqual([
      'On Jan 1, 2026 your inventory cost $120.83 (what you paid for the goods on hand).',
      'During 2026 you bought $108.00 of inventory.',
      'The goods you sold had cost you $35.33 (cost of goods sold, from 2 recorded sales bringing in $80.00).',
      '$13.10 was written off as damaged, lost or otherwise removed; $50.00 was taken for personal use; $80.00 left with items deleted from the records; $8.33 came back as returns or units found; cost corrections changed inventory by $1.60.',
      'That leaves $60.33 of inventory expected at Dec 31, 2026. The item records show $60.33: they agree to the cent.',
      'The records support these balances: beginning inventory is documented, every movement is dated and linked to a record, and the ending balance agrees.',
    ]);
    const snap = yearReportSnapshot(r);
    expect(snap.sections[0].lines[0]).toContain('not an audited financial statement or a tax return');
    expect(snap.sections.find((s) => s.title === 'Inventory movement for the year')!.lines).toContain('Withdrawn for personal use: −$50.00');
    const html = reportHtml(snap, { status: 'Draft' });
    expect(html).toContain('<li>Expected inventory at Dec 31, 2026: $60.33</li>');
  });

  it('the worksheet keeps recorded figures apart from items needing review, and line 42 adds up', () => {
    const { data } = yearShop();
    const ws = taxWorksheet(fig(data, '2026'), settings);
    const by = (n: string) => ws.lines.find((l) => l.line === n)!;
    expect(by('35')).toMatchObject({ amount: 120.83, status: 'recorded' });
    expect(by('36')).toMatchObject({ amount: 58, status: 'recorded' }); // $108 purchases − $50 personal use
    expect(by('37')).toMatchObject({ amount: null, status: 'not_tracked' });
    expect(by('38')).toMatchObject({ amount: null, status: 'not_tracked' });
    expect(by('39')).toMatchObject({ amount: null, status: 'needs_review' });
    expect(by('33').status).toBe('needs_review');
    expect(by('41')).toMatchObject({ amount: 60.33, status: 'recorded' });
    expect(by('42')).toMatchObject({ amount: 118.5, status: 'needs_review' });
    expect(ws.bridge.map((b) => [b.label, b.amount])).toEqual([
      ['Cost of goods sold from recorded sales', 35.33],
      ['Write-offs and other documented decreases', 13.1],
      ['Items deleted with stock', 80],
      ['Units found and returns added back', -8.33],
      ['Cost corrections', -1.6],
    ]);
    expect(ws.bridge.reduce((c, b) => c + toCents(b.amount), 0)).toBe(toCents(by('42').amount!));
    expect(ws.disclaimer).toContain('not tax advice');
  });

  it('CSV downloads carry exactly the reconciled figures', () => {
    const { data } = yearShop();
    const y = fig(data, '2026');
    const rows = (csv: string) => parseCsv(csv).slice(1).filter((r) => r.length > 1);
    const mv = rows(movementsCsv(y));
    expect(mv).toHaveLength(9);
    const byType = (label: string) => mv.filter((r) => r[1] === label).reduce((c, r) => c + toCents(Number(r[4])), 0);
    expect(byType('Cost of goods sold')).toBe(-3533);
    expect(byType('Withdrawn for personal use')).toBe(-5000);
    const inv = rows(yearInventoryCsv(data, y));
    expect(inv.reduce((c, r) => c + toCents(Number(r[4])), 0)).toBe(6033);
    const sales = rows(yearSalesCsv(data, y));
    expect(sales.map((r) => [r[0], r[6]])).toEqual([['2026-01-02', '8.33'], ['2026-09-15', '27']]);
  });

  it('periods are calendar years with a structure that allows fiscal years later', () => {
    expect(yearPeriod(2026)).toEqual({ key: '2026', start: '2026-01-01', end: '2026-12-31', label: '2026' });
  });
});
