import { describe, expect, it } from 'vitest';
import FEB from '../marketplace/fixtures/ebay-transactions-2026-02.csv?raw';
import PAYOUTS from '../marketplace/fixtures/ebay-payouts-2026-02.csv?raw';
import { obligationOccurrences, occurrenceDates, periodKeyFor, periodOptions, planningPeriod, planningSummary, quarterPeriod, reserveCents, scenarioRows, shiftPeriod } from './planning';
import { monthFigures, monthFingerprint, ledgerInfo } from './monthly';
import { addCategory, addEntry, addObligation, archiveCategory, cancelObligation, setOccurrenceDone, setTaxPercent, updateCategory, voidEntry } from '../domain/planning';
import { assertClosedMonthsUnchanged } from '../domain/close';
import { addItem, recordSale } from '../domain/actions';
import { totalSales } from '../domain/calc';
import { applyImport, previewImport } from '../marketplace/reports';
import { createBackup, parseBackup } from '../data/backup';
import { defaultSettings, emptyData, type AppData } from '../domain/types';
import { clock } from '../domain/testUtils';
import { at, closeShop } from './closeFixture';
import { closeWholeMonth } from './yearFixture';

const settings = defaultSettings();
const TODAY = '2026-11-12';
const sum = (data: AppData, type: 'month' | 'quarter' | 'year', key: string, today = TODAY) => planningSummary(data, settings, type, key, today);
const withTax = (data: AppData, p = 25) => setTaxPercent(data, p, at('2026-11-01'));

describe('reserve arithmetic', () => {
  it('suggested reserve = recorded profit × your percentage, cent-exact, never negative', () => {
    expect(reserveCents(100000, 25)).toBe(25000); // $1,000 × 25% = $250
    expect(reserveCents(25933, 25)).toBe(6483); // $259.33 × 25% = $64.8325 → $64.83
    expect(reserveCents(25933, 22.5)).toBe(5835); // $58.34925 → $58.35
    expect(reserveCents(0, 25)).toBe(0);
    expect(reserveCents(-50000, 25)).toBe(0); // a loss doesn't create a negative reserve
    expect(reserveCents(12345, 0)).toBe(0);
    expect(reserveCents(12345, 100)).toBe(12345);
  });

  it('scenarios at example percentages, each explained', () => {
    const rows = scenarioRows(100000, [20, 25, 30], 'USD');
    expect(rows.map((r) => [r.percent, r.reserve, r.remaining])).toEqual([
      [20, 200, 800],
      [25, 250, 750],
      [30, 300, 700],
    ]);
    expect(rows[1].explanation).toBe('$1,000.00 × 25% = $250.00; $1,000.00 − $250.00 = $750.00');
    expect(scenarioRows(-1000, [25], 'USD')[0]).toMatchObject({ reserve: 0, remaining: -10, explanation: 'No profit recorded (-$10.00), so nothing is earmarked at any percentage' });
  });

  it('the percentage is the user’s own: validated, editable and logged; no default rate', () => {
    expect(emptyData().planning.categories).toEqual([]);
    expect(() => setTaxPercent(emptyData(), 101)).toThrow('Enter a percentage from 0 to 100.');
    expect(() => setTaxPercent(emptyData(), -1)).toThrow('Enter a percentage from 0 to 100.');
    expect(() => setTaxPercent(emptyData(), 12.345)).toThrow('Use at most two decimals');
    expect(() => setTaxPercent(emptyData(), null)).toThrow('Enter a percentage');
    let data = setTaxPercent(emptyData(), 25, at('2026-11-01'));
    data = setTaxPercent(data, 30, at('2026-11-02'));
    expect(data.planning.categories).toHaveLength(1);
    expect(data.planning.categories[0]).toMatchObject({ name: 'Taxes', kind: 'tax', mode: 'percent', percent: 30 });
    expect(data.planning.audit.map((a) => [a.kind, a.detail])).toEqual([
      ['category', 'Added reserve “Taxes” (25% of profit)'],
      ['percent', 'Reserve “Taxes”: percentage 25% → 30%'],
    ]);
  });
});

describe('the period’s plan', () => {
  it('uses the same recorded profit as Sales & Profit and Monthly Close, for months, quarters and years', () => {
    const data = withTax(closeShop().data);
    const oct = sum(data, 'month', '2026-10');
    expect(oct.profit.netProfit).toBe(259.33);
    expect(oct.profit.netProfit).toBe(totalSales(data.sales.filter((s) => s.saleDate.startsWith('2026-10'))).netProfit);
    expect(oct.profit.netProfit).toBe(monthFigures(data, settings, '2026-10', TODAY).totals.netProfit);
    expect(oct.tax).toMatchObject({ target: 64.83, calculation: '$259.33 × 25% = $64.83', setAsideInPeriod: 0, remaining: 64.83 });
    expect(oct.afterReserves).toBe(194.5);
    expect(sum(data, 'quarter', '2026-Q3').profit.netProfit).toBe(128);
    expect(sum(data, 'quarter', '2026-Q4')).toMatchObject({ profit: { netProfit: 259.33 }, periodStatus: expect.stringContaining('0 months of 3 closed') });
    const year = sum(data, 'year', '2026');
    expect(year.profit.netProfit).toBe(387.33);
    expect(year.tax!.target).toBe(96.83); // $387.33 × 25% = $96.8325
  });

  it('zero or negative profit: nothing suggested, and the loss is shown as it is', () => {
    let data = withTax(emptyData());
    const r = addItem(data, { name: 'Projector', quantity: 1, unitCost: 300, purchaseDate: '2026-08-01' }, at('2026-08-01'));
    data = recordSale(r.data, { itemId: r.item.id, quantity: 1, salePrice: 200, priceMode: 'total', fees: 20, saleDate: '2026-08-15' }, at('2026-08-15')).data;
    const aug = sum(data, 'month', '2026-08');
    expect(aug.profit.netProfit).toBe(-120);
    expect(aug.tax).toMatchObject({ target: 0, remaining: 0, calculation: 'No profit recorded for August 2026 (-$120.00), so nothing is suggested' });
    expect(aug.afterReserves).toBe(-120);
    expect(sum(data, 'month', '2026-07').warnings[0]).toBe('No sales are recorded for July 2026, so recorded realized profit is $0.00.');
  });

  it('suggested versus actually set aside, with several reserves', () => {
    let data = withTax(closeShop().data);
    data = addCategory(data, { name: 'Emergency reserve', kind: 'emergency', mode: 'percent', percent: 5 }, at('2026-11-01')).data;
    const eq = addCategory(data, { name: 'Equipment replacement', kind: 'equipment', mode: 'goal', goal: 500 }, at('2026-11-01'));
    data = eq.data;
    const tax = data.planning.categories.find((c) => c.kind === 'tax')!;
    data = addEntry(data, { categoryId: tax.id, date: '2026-10-31', kind: 'deposit', amount: 50, note: 'Moved to savings' }, {}, at('2026-11-01')).data;
    data = addEntry(data, { categoryId: eq.category.id, date: '2026-10-20', kind: 'deposit', amount: 100 }, {}, at('2026-11-01')).data;
    const oct = sum(data, 'month', '2026-10');
    const line = (name: string) => oct.lines.find((l) => l.category.name === name)!;
    expect(line('Taxes')).toMatchObject({ target: 64.83, setAsideInPeriod: 50, remaining: 14.83, ahead: 0 });
    expect(line('Emergency reserve')).toMatchObject({ target: 12.97, setAsideInPeriod: 0, remaining: 12.97 });
    expect(line('Equipment replacement')).toMatchObject({ target: 500, balance: 100, remaining: 400, calculation: 'Goal $500.00; $100.00 set aside so far' });
    expect(oct.suggestedTotal).toBe(77.8); // only percentage reserves are allocations of the period’s profit
    expect(oct.afterReserves).toBe(181.53);
    expect(oct.setAsideTotal).toBe(150);
    expect(oct.remainingTarget).toBe(427.8);
    // Money set aside never changes profit.
    expect(oct.profit.netProfit).toBe(259.33);
  });

  it('withdrawals, adjustments, voids and duplicate prevention', () => {
    let data = withTax(closeShop().data);
    const tax = data.planning.categories[0];
    data = addEntry(data, { categoryId: tax.id, date: '2026-10-31', kind: 'deposit', amount: 50 }, {}, at('2026-11-01')).data;
    expect(() => addEntry(data, { categoryId: tax.id, date: '2026-10-31', kind: 'deposit', amount: 50 }, {}, at('2026-11-01'))).toThrow('You already recorded a deposit of 50.00 to “Taxes” on Oct 31, 2026');
    data = addEntry(data, { categoryId: tax.id, date: '2026-10-31', kind: 'deposit', amount: 50 }, { allowDuplicate: true }, at('2026-11-01')).data;
    expect(() => addEntry(data, { categoryId: tax.id, date: '2026-11-02', kind: 'withdrawal', amount: 150 }, {}, at('2026-11-03'))).toThrow('below zero');
    expect(() => addEntry(data, { categoryId: tax.id, date: '2026-12-01', kind: 'deposit', amount: 5 }, {}, at('2026-11-03'))).toThrow('can’t be in the future');
    data = addEntry(data, { categoryId: tax.id, date: '2026-11-02', kind: 'withdrawal', amount: 30, note: 'Paid an estimate' }, {}, at('2026-11-03')).data;
    data = addEntry(data, { categoryId: tax.id, date: '2026-11-03', kind: 'adjustment', amount: -0.5, note: 'Bank fee' }, {}, at('2026-11-03')).data;
    const dupId = data.planning.entries[1].id;
    expect(() => voidEntry(data, dupId, '', at('2026-11-04'))).toThrow('Say why you’re voiding it');
    data = voidEntry(data, dupId, 'Entered twice', at('2026-11-04'));
    const nov = sum(data, 'month', '2026-11');
    expect(nov.tax).toMatchObject({ setAsideInPeriod: -30.5, balance: 19.5 });
    expect(data.planning.entries).toHaveLength(4); // the voided entry is kept
    expect(data.planning.audit.at(-1)!.detail).toBe('Voided the Oct 31, 2026 deposit of 50.00 (“Taxes”) — Entered twice');
    // Archiving keeps the history.
    data = archiveCategory(data, tax.id, at('2026-11-05'));
    expect(sum(data, 'month', '2026-11').tax).toBeNull();
    expect(data.planning.entries).toHaveLength(4);
  });

  it('reserve names are unique and there is one tax reserve', () => {
    let data = withTax(emptyData());
    expect(() => addCategory(data, { name: 'taxes', kind: 'other', mode: 'goal', goal: 10 })).toThrow('You already have a reserve called “Taxes”');
    expect(() => addCategory(data, { name: 'State taxes', kind: 'tax', mode: 'percent', percent: 5 })).toThrow('You already have a tax reserve');
    data = addCategory(data, { name: 'Inventory fund', kind: 'inventory_fund', mode: 'goal', goal: 1000 }).data;
    const fund = data.planning.categories[1];
    data = updateCategory(data, fund.id, { name: 'Inventory buying fund', kind: 'inventory_fund', mode: 'goal', goal: 1200 }, at('2026-11-05'));
    expect(data.planning.audit.at(-1)!.detail).toBe('Reserve “Inventory buying fund”: renamed “Inventory fund” → “Inventory buying fund”; goal 1,000.00 → 1,200.00');
    // A change of kind alone is saved and logged; amounts in history use the user's currency when given.
    data = updateCategory(data, fund.id, { name: 'Inventory buying fund', kind: 'upcoming', mode: 'goal', goal: 1200 }, { ...at('2026-11-06'), currency: 'EUR' });
    expect(data.planning.categories[1].kind).toBe('upcoming');
    expect(data.planning.audit.at(-1)!.detail).toBe('Reserve “Inventory buying fund”: kind Inventory purchasing fund → Upcoming business expenses');
    data = updateCategory(data, fund.id, { name: 'Inventory buying fund', kind: 'upcoming', mode: 'goal', goal: 1500 }, { ...at('2026-11-06'), currency: 'EUR' });
    expect(data.planning.audit.at(-1)!.detail).toBe('Reserve “Inventory buying fund”: goal €1,200.00 → €1,500.00');
  });
});

describe('upcoming obligations', () => {
  it('recurring dates, including month ends, with an optional end date', () => {
    const base = { id: 'o', description: 'x', category: 'other' as const, amount: 10, completed: [], cancelled: false, reserveCategoryId: null, note: '', createdAt: '', updatedAt: '', endDate: null };
    expect(occurrenceDates({ ...base, dueDate: '2026-01-31', recurrence: 'monthly' }, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    expect(occurrenceDates({ ...base, dueDate: '2026-01-15', recurrence: 'quarterly' }, '2026-03-01', '2027-01-31')).toEqual(['2026-04-15', '2026-07-15', '2026-10-15', '2027-01-15']);
    expect(occurrenceDates({ ...base, dueDate: '2024-02-29', recurrence: 'yearly', endDate: '2027-12-31' }, '2025-01-01', '2030-01-01')).toEqual(['2025-02-28', '2026-02-28', '2027-02-28']);
    expect(occurrenceDates({ ...base, dueDate: '2026-05-01', recurrence: 'none' }, '2026-01-01', '2026-12-31')).toEqual(['2026-05-01']);
  });

  it('planning records only: never expenses, never changing profit or closed months', () => {
    let data = closeShop().data;
    data = closeWholeMonth(data, '2026-10', TODAY);
    const before = data;
    const r = addObligation(data, { description: 'Quarterly estimated tax payment', category: 'tax_payment', dueDate: '2027-01-15', amount: 150, recurrence: 'quarterly' }, at(TODAY));
    data = r.data;
    data = addObligation(data, { description: 'Insurance renewal', category: 'insurance', dueDate: '2026-11-20', amount: 420, recurrence: 'none' }, at(TODAY)).data;
    data = addObligation(data, { description: 'Software', category: 'software', dueDate: '2026-10-01', amount: 12, recurrence: 'monthly' }, at(TODAY)).data;
    expect(() => addObligation(data, { description: 'insurance  renewal', category: 'insurance', dueDate: '2026-11-20', amount: 420, recurrence: 'none' })).toThrow('“Insurance renewal” is already planned for Nov 20, 2026 at 420.00');
    // Reserves recorded in a closed month are allowed: they aren't part of its figures.
    data = setTaxPercent(data, 25, at(TODAY));
    data = addEntry(data, { categoryId: data.planning.categories[0].id, date: '2026-10-15', kind: 'deposit', amount: 40 }, {}, at(TODAY)).data;
    expect(() => assertClosedMonthsUnchanged(before, data)).not.toThrow();
    expect(data.sales).toBe(before.sales);
    expect(data.inventoryLedger).toBe(before.inventoryLedger);
    expect(monthFingerprint(data, '2026-10', ledgerInfo(data))).toBe(monthFingerprint(before, '2026-10', ledgerInfo(before)));
    const s = sum(data, 'month', '2026-11');
    expect(s.profit.netProfit).toBe(0);
    expect(s.upcoming.map((o) => [o.obligation.description, o.date, o.dueSoon])).toEqual([
      ['Insurance renewal', '2026-11-20', true],
      ['Software', '2026-12-01', false],
      ['Quarterly estimated tax payment', '2027-01-15', false],
      ['Software', '2027-01-01', false],
      ['Software', '2027-02-01', false],
    ].sort((a, b) => String(a[1]).localeCompare(String(b[1]))));
    expect(s.upcomingTotal).toBe(606);
    expect(s.overdue.map((o) => o.date)).toEqual(['2026-10-01', '2026-11-01']);
    // Mark one done; cancel another.
    const sw = data.planning.obligations.find((o) => o.description === 'Software')!;
    data = setOccurrenceDone(data, sw.id, '2026-10-01', true, at(TODAY));
    expect(() => setOccurrenceDone(data, sw.id, '2026-10-02', true, at(TODAY))).toThrow('isn’t one of this obligation’s dates');
    data = cancelObligation(data, r.obligation.id, at(TODAY));
    const after = sum(data, 'month', '2026-11');
    expect(after.overdue.map((o) => o.date)).toEqual(['2026-11-01']);
    expect(after.upcoming.some((o) => o.obligation.description.startsWith('Quarterly'))).toBe(false);
    expect(obligationOccurrences(data, TODAY, '2026-10-01', '2026-10-31')[0]).toMatchObject({ done: true });
    expect(data.planning.obligations.find((o) => o.id === r.obligation.id)!.cancelled).toBe(true);
  });
});

describe('disclosures', () => {
  it('imported refunds that the sales don’t reflect are warnings; untracked expenses are listed', () => {
    let data = emptyData();
    for (const [name, cost, price, fees, date, order] of [
      ['Nike Air Max 90 size 10', 40, 120, 15.82, '2026-01-28', '11-00001-00001'],
      ['Sony WH-1000XM4 headphones', 85, 180, 24.25, '2026-01-30', '11-00002-00002'],
    ] as const) {
      const r = addItem(data, { name, quantity: 1, unitCost: cost }, clock());
      data = recordSale(r.data, { itemId: r.item.id, quantity: 1, salePrice: price, priceMode: 'total', fees, saleDate: date, orderNumber: order }, clock()).data;
    }
    for (const [text, name] of [[FEB, 'feb.csv'], [PAYOUTS, 'payouts.csv']] as const) data = applyImport(data, previewImport(text, name, data), clock()).data;
    const jan = sum(data, 'month', '2026-01', '2026-03-10');
    expect(jan.warnings.join(' ')).toContain('eBay’s report shows a $15.50 refund on order 11-00002-00002');
    expect(jan.profit.netProfit).toBe(totalSales(data.sales).netProfit); // payouts are never profit
    expect(jan.notIncluded[0]).toContain('Business expenses you haven’t entered on a sale');
  });

  it('periods: months, quarters and years', () => {
    expect(quarterPeriod('2026-Q4')).toEqual({ key: '2026-Q4', start: '2026-10-01', end: '2026-12-31', label: 'Q4 2026' });
    expect(planningPeriod('quarter', '2026-Q1').end).toBe('2026-03-31');
    expect(periodKeyFor('quarter', '2026-08-15')).toBe('2026-Q3');
    expect(shiftPeriod('quarter', '2026-Q1', -1)).toBe('2025-Q4');
    expect(shiftPeriod('year', '2026', -1)).toBe('2025');
    expect(periodOptions('quarter', closeShop().data, TODAY)).toEqual(['2026-Q4', '2026-Q3']);
  });

  it('planning data survives a backup round trip; older backups load without it', () => {
    let data = withTax(closeShop().data);
    data = addEntry(data, { categoryId: data.planning.categories[0].id, date: '2026-10-31', kind: 'deposit', amount: 50 }, {}, at(TODAY)).data;
    data = addObligation(data, { description: 'Insurance', category: 'insurance', dueDate: '2026-12-01', amount: 300, recurrence: 'yearly', endDate: '2030-12-31' }, at(TODAY)).data;
    const back = parseBackup(JSON.stringify(createBackup('real', settings, data, []))).data;
    expect(back.planning).toEqual(data.planning);
    const old = JSON.parse(JSON.stringify(createBackup('real', settings, data, [])));
    delete old.data.planning;
    expect(parseBackup(JSON.stringify(old)).data.planning).toEqual({ categories: [], entries: [], obligations: [], audit: [] });
  });
});
