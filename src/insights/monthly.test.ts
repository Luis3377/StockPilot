import { describe, expect, it } from 'vitest';
import { ledgerInfo, monthFigures, monthRange, rollForward, shiftMonth, monthEnded, type RollForward } from './monthly';
import { startLedger, recordsBalanceCents } from '../domain/ledger';
import { addItem, deleteSale, recordSale, updateItem, updateSale } from '../domain/actions';
import { toCents } from '../domain/money';
import { createBackup, parseBackup } from '../data/backup';
import { defaultSettings, emptyData, type AppData } from '../domain/types';
import { at, closeShop, input, sell, tracked } from './closeFixture';

const settings = defaultSettings();
const line = (rf: RollForward, key: string) => rf.lines.find((l) => l.key === key)!.amount;

describe('inventory ledger', () => {
  it('records every change made through the app, so the item records always equal opening + movements', () => {
    const { data } = closeShop();
    const info = ledgerInfo(data);
    expect(info.complete).toBe(true);
    const total = info.movements.reduce((c, m) => c + m.cents, info.openingCents);
    expect(total).toBe(recordsBalanceCents(data));
    // Each purchase is recorded once: the lot's items at their allocated cost (= the $380 total).
    const ev = data.inventoryLedger.events;
    expect(ev.filter((e) => e.kind === 'acquired' && e.lotId).reduce((c, e) => c + toCents(e.amount), 0)).toBe(38000);
    expect(ev.filter((e) => e.kind === 'acquired' && !e.lotId).map((e) => [e.itemName, e.amount, e.date])).toEqual([
      ['Vinyl records', 50, '2026-09-05'],
      ['Trading cards', 10, '2026-10-04'],
      ['Lamp', 8, '2026-10-05'],
    ]);
    // Restocks and sales are their own records: never repeated in the ledger.
    expect(ev.some((e) => e.kind === 'acquired' && e.date === '2026-10-03')).toBe(false);
    expect(ev.find((e) => e.kind === 'removed')).toMatchObject({ itemName: 'Lamp', amount: -8, date: '2026-10-15' });
    expect(ev.find((e) => e.kind === 'cost_correction')).toMatchObject({ itemName: 'Vinyl records', date: '2026-10-22' });
  });

  it('a sale edit or cancellation is accounted for without creating or losing a cent', () => {
    let { data } = closeShop();
    const sale = data.sales.find((s) => s.itemName === 'Hand tools')!;
    data = tracked(data, '2026-11-02', (d) => updateSale(d, sale.id, { itemId: sale.itemId, quantity: 6, salePrice: 180, priceMode: 'total', fees: 18, shipping: 10, saleDate: sale.saleDate, platform: 'eBay' }, at('2026-11-02'))).data;
    data = tracked(data, '2026-11-03', (d) => deleteSale(d, data.sales.find((s) => s.itemName === 'Trading cards')!.id, at('2026-11-03'))).data;
    const info = ledgerInfo(data);
    expect(info.movements.reduce((c, m) => c + m.cents, info.openingCents)).toBe(recordsBalanceCents(data));
  });
});

describe('inventory roll-forward', () => {
  it('September: beginning $0 + purchases − cost of goods sold − write-offs = the item records, to the cent', () => {
    const { data } = closeShop();
    const rf = rollForward(data, settings, '2026-09', '2026-11-12');
    expect(rf.beginning).toBe(0);
    expect(line(rf, 'items')).toBe(50);
    expect(line(rf, 'lots')).toBe(380); // purchase price + freight, once
    expect(line(rf, 'cogs')).toBe(-77); // 4 records ($20) + 5 tools at their lot share ($57), never the whole lot
    expect(line(rf, 'decreases')).toBe(-5);
    expect(rf.expectedEnding).toBe(348);
    // Today's records less October's movements: an independent figure that agrees.
    expect(rf.recordsEnding).toBe(348);
    expect(rf.difference).toBe(0);
    expect(rf.status).toBe('verified');
    expect(rf.lines.find((l) => l.key === 'cogs')!.records).toHaveLength(2);
  });

  it('October: restock, fractional costs, a deleted item, a partial lot sale and a cost correction', () => {
    const { data } = closeShop();
    const rf = rollForward(data, settings, '2026-10', '2026-11-12');
    expect(rf.beginning).toBe(348); // September's ending
    expect(line(rf, 'restocks')).toBe(18);
    expect(line(rf, 'items')).toBe(18); // cards $10 + lamp $8
    expect(line(rf, 'cogs')).toBe(-82.67); // cards $3.33 + $3.34 + 5 drills $76
    expect(line(rf, 'removed')).toBe(-8);
    // Records: 5 units at $5 + 3 at $6 = $43 → $5.375 each; edited to $6 → 8 × $6 = $48: +$5.
    expect(line(rf, 'corrections')).toBe(5);
    expect(rf.expectedEnding).toBe(298.33);
    expect(rf.recordsEnding).toBe(298.33);
    expect(rf.difference).toBe(0);
    expect(toCents(rf.recordsEnding!)).toBe(recordsBalanceCents(data)); // nothing dated after October
  });

  it('shows an unexplained difference to the cent, never a false zero', () => {
    const { data, cards } = closeShop();
    // A change that bypasses the app's recorded actions (e.g. an older copy restored over the items).
    const tampered: AppData = { ...data, items: data.items.map((i) => (i.id === cards.id ? { ...i, quantity: 2 } : i)) };
    const rf = rollForward(tampered, settings, '2026-10', '2026-11-12');
    expect(rf.difference).toBe(3.34); // 2 × $3.3333 = $6.67 on the records instead of $3.33: $3.34 with no record
    expect(rf.status).toBe('difference');
    expect(rf.notes.join(' ')).toContain('$3.34 of inventory cost on the item records isn’t explained');
  });

  it('before the ledger began: not available, then partly verified, then verified', () => {
    // Data from an older version: no ledger. It starts on October 15.
    let data = addItem(emptyData(), { name: 'Camera', quantity: 4, unitCost: 25, purchaseDate: '2026-09-02' }, at('2026-09-02')).data;
    const cam = data.items[0];
    data = recordSale(data, { itemId: cam.id, quantity: 1, salePrice: 60, priceMode: 'total', saleDate: '2026-09-15' }, at('2026-09-15')).data;
    data = recordSale(data, { itemId: cam.id, quantity: 1, salePrice: 60, priceMode: 'total', saleDate: '2026-10-02' }, at('2026-10-02')).data;
    data = startLedger(data, at('2026-10-15'));
    expect(data.inventoryLedger.events.map((e) => [e.kind, e.amount])).toEqual([['opening', 50]]);
    data = sell(data, cam.id, 1, 60, '2026-10-20').data;
    data = tracked(data, '2026-11-03', (d) => addItem(d, { name: 'Lens', quantity: 1, unitCost: 40, purchaseDate: '2026-11-03' }, at('2026-11-03'))).data;

    const sep = rollForward(data, settings, '2026-09', '2026-12-05');
    expect(sep.status).toBe('not_available');
    expect(sep.difference).toBeNull();
    expect(sep.beginning).toBeNull();
    expect(monthFigures(data, settings, '2026-09', '2026-12-05').purchases).toBeNull();

    const oct = rollForward(data, settings, '2026-10', '2026-12-05');
    expect(oct.status).toBe('partial');
    expect(oct.beginning).toBe(50); // the opening balance on Oct 15
    expect(line(oct, 'cogs')).toBe(-25); // only the Oct 20 sale; the Oct 2 sale predates the ledger
    expect(oct.notes.join(' ')).toContain('$25.00 of this month’s cost of goods sold (1 sale) was recorded before the ledger began');
    expect(oct.difference).toBe(0);

    const nov = rollForward(data, settings, '2026-11', '2026-12-05');
    expect(nov.status).toBe('verified');
    expect(nov.beginning).toBe(25);
    expect(nov.expectedEnding).toBe(65);
  });

  it('a purchase date edit moves the purchase to its new month', () => {
    let { data, cards } = closeShop();
    const c = data.items.find((i) => i.id === cards.id)!;
    data = tracked(data, '2026-11-02', (d) => updateItem(d, c.id, input(c, { purchaseDate: '2026-09-28' }), {}, at('2026-11-02'))).data;
    expect(line(rollForward(data, settings, '2026-09', '2026-11-12'), 'items')).toBe(60);
    expect(line(rollForward(data, settings, '2026-10', '2026-11-12'), 'items')).toBe(8);
    expect(rollForward(data, settings, '2026-10', '2026-11-12').difference).toBe(0);
  });
});

describe('month figures', () => {
  it('uses exact month boundaries and the same sale records as Sales & Profit', () => {
    let { data, records } = closeShop();
    data = sell(data, records.id, 1, 20, '2026-09-30', 2).data;
    data = sell(data, records.id, 1, 20, '2026-10-01', 2).data;
    const sep = monthFigures(data, settings, '2026-09', '2026-11-12');
    // The Sep 30 sale was recorded after the $6 cost correction, so its cost of goods sold is $6.
    expect(sep.totals).toMatchObject({ salesCount: 3, revenue: 270, costOfGoods: 83, fees: 29, shipping: 18, netProfit: 140 });
    expect(sep.grossProfit).toBe(187);
    expect(sep.grossMarginPct).toBe(69.26);
    expect(sep.marginPct).toBe(51.85);
    expect(sep.purchases).toBe(430);
    const oct = monthFigures(data, settings, '2026-10', '2026-11-12');
    expect(oct.totals.salesCount).toBe(4);
    expect(oct.sales[0].saleDate).toBe('2026-10-01');
  });

  it('month helpers', () => {
    expect(monthRange('2026-02')).toMatchObject({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthRange('2028-02').end).toBe('2028-02-29');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(monthEnded('2026-10', '2026-10-31')).toBe(false);
    expect(monthEnded('2026-10', '2026-11-01')).toBe(true);
  });

  it('the ledger survives a backup round trip; older backups load without one', () => {
    const { data } = closeShop();
    const back = parseBackup(JSON.stringify(createBackup('real', settings, data, [])));
    expect(back.data.inventoryLedger).toEqual(data.inventoryLedger);
    const old = JSON.parse(JSON.stringify(createBackup('real', settings, data, [])));
    delete old.data.inventoryLedger;
    delete old.data.monthlyClose;
    const loaded = parseBackup(JSON.stringify(old)).data;
    expect(loaded.inventoryLedger).toEqual({ startedAt: null, events: [] });
    expect(loaded.monthlyClose).toEqual({ closes: [], decisions: {}, audit: [] });
  });
});
