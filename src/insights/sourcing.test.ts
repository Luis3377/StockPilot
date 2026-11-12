import { describe, expect, it } from 'vitest';
import { lotSource, saleSource, sessionStats, sourcingReport, timeShares, UNASSIGNED_KEY, type SourceStats } from './sourcing';
import {
  addTimeEntry,
  assignSource,
  createSession,
  createSource,
  deleteSource,
  deleteTimeEntry,
  findSourceByName,
  linkToSession,
  mergeSources,
  pauseTimer,
  resumeTimer,
  similarSources,
  sourceKey,
  startTimer,
  stopTimer,
  timerElapsedMs,
  updateSource,
  updateTimeEntry,
} from '../domain/sourcing';
import { addItem } from '../domain/actions';
import { createLot } from '../domain/lots';
import { totalSales } from '../domain/calc';
import { inRange, periodRange } from '../domain/dates';
import { toCents } from '../domain/money';
import { createBackup, parseBackup } from '../data/backup';
import { defaultSettings, emptyData, type AppData } from '../domain/types';
import { clock } from '../domain/testUtils';
import { sell, shop } from './sourcingFixture';

const settings = defaultSettings();
const TODAY = '2026-11-12';
const ALL = periodRange('all', TODAY);
const report = (data: AppData, range = ALL, category?: string) => sourcingReport(data, settings, { range, today: TODAY, category });
const bySource = (data: AppData, name: string): SourceStats => report(data).sources.find((s) => s.ref.name === name)!;

describe('profit by source', () => {
  it('attributes individual items and bulk lots, with exact lot shares for partial sales', () => {
    const { data } = shop();
    const g = bySource(data, 'Saturday garage sales');
    expect(g).toMatchObject({ revenue: 280, costOfGoods: 50, fees: 30, shipping: 20, realizedProfit: 180, unitsSold: 10, acquisitionCost: 50, unitsPurchased: 10, unitsRemaining: 0, inventoryCost: 0, stillSelling: false });
    expect(g.marginPct).toBe(64.29); // 180 ÷ 280
    expect(g.roiPct).toBe(360); // 180 ÷ 50 cost of goods sold
    expect(g.avgDaysToSell).toBe(20); // Sep 5 → Sep 25
    const p = bySource(data, 'Midwest Liquidation');
    // Only the units sold count as cost of goods sold: 20 × $11.40 + 5 × $15.20.
    expect(p).toMatchObject({ revenue: 1100, costOfGoods: 304, fees: 110, shipping: 66, realizedProfit: 620, unitsSold: 25, acquisitionCost: 380, unitsPurchased: 30, unitsRemaining: 5, inventoryCost: 76, stillSelling: true, tripExpenses: 24 });
    expect(toCents(p.costOfGoods) + toCents(p.inventoryCost)).toBe(toCents(p.acquisitionCost));
    const u = report(data).sources.find((s) => s.ref.key === UNASSIGNED_KEY)!;
    expect(u).toMatchObject({ revenue: 25, realizedProfit: 12, ref: { name: 'Unassigned source' } });
  });

  it('source totals reconcile with the recorded sales, to the cent', () => {
    const { data } = shop();
    for (const range of [ALL, periodRange('this_year', TODAY), { start: '2026-10-01', end: '2026-10-31', label: 'in October' }]) {
      const r = report(data, range);
      const t = totalSales(data.sales.filter((x) => inRange(x.saleDate, range)));
      for (const key of ['revenue', 'costOfGoods', 'fees', 'shipping', 'otherExpenses', 'realizedProfit'] as const) {
        const sum = r.sources.reduce((c, s) => c + toCents(s[key]), 0);
        expect(sum, key).toBe(toCents(key === 'realizedProfit' ? t.netProfit : t[key]));
      }
      expect(r.totals.netProfit).toBe(t.netProfit);
    }
    // October only: the garage sale (September) drops out of the realized figures.
    expect(report(data, { start: '2026-10-01', end: '2026-10-31', label: 'in October' }).sources.find((s) => s.ref.name === 'Saturday garage sales')?.revenue ?? 0).toBe(0);
  });

  it('profit per hour: realized profit ÷ logged hours, each entry counted once', () => {
    const { data } = shop();
    expect(bySource(data, 'Saturday garage sales')).toMatchObject({ hours: 20, profitPerHour: 9 });
    expect(bySource(data, 'Midwest Liquidation')).toMatchObject({ hours: 20, profitPerHour: 31 });
    const r = report(data);
    expect(r.totals.hours).toBe(40);
    expect(r.totals.netProfit).toBe(812);
    expect(r.totals.profitPerHour).toBe(20.3);
    // Every second of logged time is somewhere, once.
    const shares = timeShares(data);
    expect(shares.reduce((c, s) => c + s.seconds, 0)).toBe(40 * 3600);
    expect(r.missingActivities).toEqual([]);
    // The unsourced lamp has profit but no time: no figure, not a made-up one.
    expect(r.sources.find((s) => s.ref.key === UNASSIGNED_KEY)!.profitPerHour).toBeNull();
  });

  it('shared time is split transparently; a multi-source trip waits for the user’s choice', () => {
    let { data, garage, pallets, records, lot } = shop();
    data = addTimeEntry(data, { date: '2026-10-02', minutes: 100, activity: 'shipping', links: [{ kind: 'item', id: records.id, sharePct: 70 }, { kind: 'lot', id: lot.id, sharePct: 30 }], split: 'custom' }, clock()).data;
    expect(bySource(data, 'Saturday garage sales').hours).toBe(21.17); // 20h + 70 min
    expect(bySource(data, 'Midwest Liquidation').hours).toBe(20.5); // 20h + 30 min
    expect(() => addTimeEntry(data, { date: '2026-10-02', minutes: 60, activity: 'other', links: [{ kind: 'item', id: records.id, sharePct: 70 }, { kind: 'lot', id: lot.id, sharePct: 20 }], split: 'custom' }, clock())).toThrow('The shares must add up to 100%.');

    const two = createSession(data, { name: 'Saturday loop', date: '2026-10-03', sourceIds: [garage.id, pallets.id], expenses: [{ label: 'Entry fee', amount: 10, kind: 'acquisition' }], split: null }, clock());
    data = addTimeEntry(two.data, { date: '2026-10-03', minutes: 120, activity: 'sourcing', links: [{ kind: 'session', id: two.session.id, sharePct: null }], split: 'equal' }, clock()).data;
    let r = report(data);
    expect(r.tripNotSplitHours).toBe(2);
    expect(r.unallocatedHours).toBe(2);
    expect(r.unallocatedTripExpenses).toBe(10);
    expect(r.totals.hours).toBe(43.67); // still counted in the total
    // The user chooses to split it equally.
    data = { ...data, sourcing: { ...data.sourcing, sessions: data.sourcing.sessions.map((s) => (s.id === two.session.id ? { ...s, split: 'equal' as const } : s)) } };
    r = report(data);
    expect(r.tripNotSplitHours).toBe(0);
    expect(bySource(data, 'Saturday garage sales').hours).toBe(22.17);
    expect(bySource(data, 'Saturday garage sales').tripExpenses).toBe(5);
  });

  it('no time, missing activities and negative results are reported honestly', () => {
    let { data, records } = shop();
    data = { ...data, sourcing: { ...data.sourcing, timeEntries: [] } };
    let r = report(data);
    expect(r.hasTime).toBe(false);
    expect(r.totals.profitPerHour).toBeNull();
    expect(r.missingActivities).toEqual(['sourcing', 'listing', 'shipping']);
    // A losing source: negative profit per hour.
    const s = createSource(data, { name: 'Mall kiosk', type: 'retail' }, clock());
    const it = addItem(s.data, { name: 'Phone case', category: 'Accessories', quantity: 2, unitCost: 20 }, clock());
    data = assignSource(it.data, 'item', it.item.id, s.source.id, clock());
    data = sell(data, it.item.id, 2, 30, 6);
    data = addTimeEntry(data, { date: '2026-10-11', minutes: 120, activity: 'listing', links: [{ kind: 'source', id: s.source.id, sharePct: null }], split: 'equal' }, clock()).data;
    r = report(data);
    expect(r.sources.find((x) => x.ref.name === 'Mall kiosk')).toMatchObject({ realizedProfit: -16, hours: 2, profitPerHour: -8 });
    expect(r.missingActivities).toEqual(['sourcing', 'shipping']);
    void records;
  });

  it('by type and by category, from the same records', () => {
    const { data } = shop();
    const r = report(data);
    expect(r.types.map((t) => [t.label, t.realizedProfit])).toEqual([
      ['Liquidation supplier', 620],
      ['Garage / yard sale', 180],
      ['Type not set', 12],
    ]);
    expect(r.categories.map((c) => [c.label, c.realizedProfit, c.inventoryCost])).toEqual([
      ['Tools', 620, 76],
      ['Music', 180, 0],
      ['Home', 12, 0],
    ]);
    // Category time comes only from item and lot links: the lot's 15 hours go to Tools.
    expect(r.categories[0].hours).toBe(15);
    expect(r.categories[1].hours).toBe(0);
    expect(r.categories[1].profitPerHour).toBeNull();
    const tools = report(data, ALL, 'tools');
    expect(tools.sources.map((s) => [s.ref.name, s.realizedProfit])).toEqual([['Midwest Liquidation', 620]]);
  });
});

describe('sources', () => {
  it('no duplicates by capitalization or punctuation; near-misses are flagged', () => {
    let data = createSource(emptyData(), { name: 'Goodwill — West Little Rock', type: 'thrift' }, clock()).data;
    expect(sourceKey('Goodwill – West  Little Rock!')).toBe('goodwill west little rock');
    expect(() => createSource(data, { name: 'goodwill west little rock', type: 'thrift' }, clock())).toThrow('You already have “Goodwill — West Little Rock”.');
    expect(similarSources(data, 'Goodwil West Little Rock').map((s) => s.name)).toEqual(['Goodwill — West Little Rock']);
    expect(similarSources(data, 'Salvation Army')).toEqual([]);
    data = createSource(data, { name: 'Salvation Army', type: 'thrift' }, clock()).data;
    expect(findSourceByName(data, 'SALVATION army')?.name).toBe('Salvation Army');
  });

  it('renaming keeps history attributed and is logged; merging moves records explicitly', () => {
    let { data, pallets, lot } = shop();
    // The lot was entered as text before the source existed: matched by name.
    expect(lotSource(data, lot).sourceId).toBe(pallets.id);
    data = updateSource(data, pallets.id, { name: 'Midwest Liquidators LLC', type: 'liquidation', location: 'Springfield warehouse' }, clock('2026-11-01T09:00:00.000Z')).data;
    expect(data.lots[0].source).toBe('Midwest Liquidation'); // the record isn't rewritten
    expect(lotSource(data, data.lots[0])).toMatchObject({ sourceId: pallets.id, name: 'Midwest Liquidators LLC' });
    expect(bySource(data, 'Midwest Liquidators LLC').realizedProfit).toBe(620);
    expect(data.sourcing.changes.at(-1)).toMatchObject({ kind: 'renamed', detail: 'Renamed “Midwest Liquidation” to “Midwest Liquidators LLC”. Records that say the old name stay with this source.' });
    // A duplicate created by mistake, then merged.
    const dup = createSource(data, { name: 'MW Liquidators', type: 'liquidation' }, clock());
    const extra = addItem(dup.data, { name: 'Saw', quantity: 1, unitCost: 10 }, clock());
    data = assignSource(extra.data, 'item', extra.item.id, dup.source.id, clock());
    const merged = mergeSources(data, dup.source.id, pallets.id, clock());
    expect(merged.moved).toBe(1);
    expect(merged.data.items.find((i) => i.id === extra.item.id)!.sourceId).toBe(pallets.id);
    expect(merged.data.sourcing.sources.find((s) => s.id === pallets.id)!.aliases).toEqual(['Midwest Liquidation', 'MW Liquidators']);
    expect(merged.data.sourcing.changes.at(-1)!.detail).toBe('Merged “MW Liquidators” into “Midwest Liquidators LLC” (1 record moved).');
    expect(() => deleteSource(merged.data, pallets.id, clock())).toThrow(/Merge it into another source instead/);
  });

  it('assigning a source to an existing record is explicit and logged; lot items use the lot’s', () => {
    let { data, garage, lamp, tools } = shop();
    data = assignSource(data, 'item', lamp.id, garage.id, clock());
    expect(data.sourcing.changes.at(-1)).toMatchObject({ kind: 'assigned', recordKind: 'item', recordId: lamp.id, detail: '“Old lamp”: Unassigned → Saturday garage sales.' });
    expect(report(data).sources.some((s) => s.ref.key === UNASSIGNED_KEY && s.revenue)).toBe(false);
    expect(() => assignSource(data, 'item', tools.id, garage.id, clock())).toThrow('This item is part of a bulk lot, so it uses the lot’s source.');
  });

  it('an unregistered lot source shows under its own name, never as invented data', () => {
    let data = createLot(emptyData(), { name: 'Box', purchasePrice: 20, extraCosts: [], purchaseDate: '2026-09-01', source: 'Church rummage sale', notes: '', method: 'equal', lines: [{ name: 'Mugs', quantity: 4, estimatedUnitValue: null }] }, clock()).data;
    data = sell(data, data.items[0].id, 2, 16, 2);
    const s = report(data).sources[0];
    expect(s.ref).toMatchObject({ key: 'text:church rummage sale', name: 'Church rummage sale', registered: false, type: null });
    expect(s.realizedProfit).toBe(4); // 16 − 2 × $5 − 2
    expect(saleSource(data, data.sales[0]).name).toBe('Church rummage sale');
  });
});

describe('sourcing trips', () => {
  it('a trip groups what was bought without creating purchases; expenses stay out of item costs', () => {
    const { data, trip } = shop();
    const before = { items: data.items.length, lots: data.lots.length };
    const st = sessionStats(data, trip);
    expect(st).toMatchObject({ acquisitionCost: 380, operatingExpenses: 24, tripExpenses: 24, revenue: 1100, sellingExpenses: 176, netProceeds: 924, realizedProfit: 620, unitsBought: 30, unitsRemaining: 5, inventoryCost: 76, completed: false, hours: 20 });
    expect(st.result).toBe(520); // 924 − 380 − 24
    expect(st.roiPct).toBe(128.71); // 520 ÷ 404
    expect(st.profitPerHour).toBe(31);
    expect({ items: data.items.length, lots: data.lots.length }).toEqual(before);
    // The trip's fuel isn't added to any item's cost.
    expect(data.items.find((i) => i.name === 'Drills')!.unitCost).toBe(15.2);
  });

  it('multiple trips; a completed trip is one where everything bought has sold or been written off', () => {
    let { data, garage, records } = shop();
    const t = createSession(data, { name: 'Garage loop', date: '2026-09-05', sourceIds: [garage.id], expenses: [], split: null }, clock());
    data = linkToSession(t.data, 'item', records.id, t.session.id);
    const st = sessionStats(data, data.sourcing.sessions.find((s) => s.name === 'Garage loop')!);
    expect(st).toMatchObject({ completed: true, realizedProfit: 180, result: 180, roiPct: 360, hours: 0, profitPerHour: null });
    expect(data.sourcing.sessions).toHaveLength(2);
  });
});

describe('time entries and the timer', () => {
  it('entries can be edited and deleted', () => {
    let { data } = shop();
    const id = data.sourcing.timeEntries[0].id;
    data = updateTimeEntry(data, id, { date: '2026-10-01', minutes: 30, activity: 'other', links: [], split: 'equal' }, clock()).data;
    expect(data.sourcing.timeEntries.find((e) => e.id === id)).toMatchObject({ minutes: 30, activity: 'other', links: [] });
    data = deleteTimeEntry(data, id);
    expect(data.sourcing.timeEntries.some((e) => e.id === id)).toBe(false);
    expect(() => addTimeEntry(data, { date: '2026-10-01', minutes: 0, activity: 'other', links: [], split: 'equal' }, clock())).toThrow('Time must be at least 1 minute');
  });

  it('the timer is saved with the data, so closing the app doesn’t lose time', () => {
    let { data, garage } = shop();
    data = startTimer(data, { activity: 'sourcing', links: [{ kind: 'source', id: garage.id, sharePct: null }] }, clock('2026-11-12T09:00:00.000Z'));
    expect(() => startTimer(data, { activity: 'sourcing', links: [] }, clock())).toThrow('A timer is already running.');
    data = pauseTimer(data, clock('2026-11-12T09:30:00.000Z'));
    // "Close the app": the data goes through storage (here, a backup) and comes back.
    data = parseBackup(JSON.stringify(createBackup('real', settings, data, []))).data;
    expect(timerElapsedMs(data.sourcing.timer!, new Date('2026-11-12T12:00:00.000Z'))).toBe(30 * 60000); // paused: not counting
    data = resumeTimer(data, clock('2026-11-12T10:00:00.000Z'));
    data = parseBackup(JSON.stringify(createBackup('real', settings, data, []))).data;
    expect(timerElapsedMs(data.sourcing.timer!, new Date('2026-11-12T10:45:00.000Z'))).toBe(75 * 60000);
    const r = stopTimer(data, clock('2026-11-12T10:45:00.000Z'));
    expect(r.entry).toMatchObject({ minutes: 75, activity: 'sourcing', date: '2026-11-12', links: [{ kind: 'source', id: garage.id, sharePct: null }] });
    expect(r.data.sourcing.timer).toBeNull();
  });
});

describe('backup and compatibility', () => {
  it('sources, trips, time and the audit log survive a round trip; older data loads empty', () => {
    const { data } = shop();
    const back = parseBackup(JSON.stringify(createBackup('real', settings, data, []))).data;
    expect(back.sourcing).toEqual(data.sourcing);
    expect(back.items.find((i) => i.name === 'Vinyl records')!.sourceId).toBe(data.items.find((i) => i.name === 'Vinyl records')!.sourceId);
    expect(report(back).sources.map((s) => [s.ref.name, s.realizedProfit])).toEqual(report(data).sources.map((s) => [s.ref.name, s.realizedProfit]));
    const older = JSON.parse(JSON.stringify(createBackup('real', settings, data, [])));
    delete older.data.sourcing;
    for (const i of older.data.items) delete i.sourceId;
    const restored = parseBackup(JSON.stringify(older)).data;
    expect(restored.sourcing).toEqual({ sources: [], sessions: [], timeEntries: [], timer: null, changes: [] });
    // Lots keep their text, so they still show their source; items without one are Unassigned.
    expect(report(restored).sources.map((s) => s.ref.name).sort()).toEqual(['Midwest Liquidation', 'Unassigned source']);
  });
});
