import { describe, expect, it } from 'vitest';
import { createBackup, parseBackup } from './backup';
import { addItem, compareCount, recordSale, startCount, setCount, completeCount } from '../domain/actions';
import { defaultSettings, emptyData } from '../domain/types';
import { sanitizeAppData, sanitizeSettings } from './sanitize';
import { applyLotEdit, createLot, lotSummary } from '../domain/lots';

const IMG = 'data:image/jpeg;base64,AAAA';

describe('backup', () => {
  it('round-trips all data and referenced photos', () => {
    let { data, item } = addItem(emptyData(), { name: 'A', quantity: 3, unitCost: 2, photoIds: ['p1'], estimatedValue: 4 });
    data = recordSale(data, { itemId: item.id, quantity: 1, salePrice: 5, priceMode: 'per_unit', saleDate: '2026-10-01' }).data;
    data = startCount(data, { category: null, location: null });
    data = setCount(data, item.id, 1);
    data = completeCount(data, [{ itemId: item.id, apply: true, reason: 'Lost' }]).data;
    const photos = [
      { id: 'p1', dataset: 'real' as const, full: IMG, thumb: IMG, createdAt: '' },
      { id: 'orphan', dataset: 'real' as const, full: IMG, thumb: IMG, createdAt: '' },
    ];
    const backup = createBackup('real', { ...defaultSettings(), mode: 'collector' }, data, photos);
    expect(backup.photos.map((p) => p.id)).toEqual(['p1']);
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.data).toEqual(data);
    expect(parsed.settings.mode).toBe('collector');
    expect(parsed.photos).toHaveLength(1);
  });

  it('rejects files that are not backups, or are invalid', () => {
    expect(() => parseBackup('not json')).toThrow('valid JSON');
    expect(() => parseBackup('{"hello":1}')).toThrow("isn't a StockPilot backup");
    expect(() => parseBackup(JSON.stringify({ format: 'stockpilot-backup', version: 99 }))).toThrow('newer version');
    const bad = { format: 'stockpilot-backup', version: 1, data: { items: [{ id: 'x', name: 'A', quantity: -1, unitCost: 1 }] } };
    expect(() => parseBackup(JSON.stringify(bad))).toThrow('Item 1: "quantity" can\'t be below 0');
  });

  it('drops photo references that are missing from the file', () => {
    const { data } = addItem(emptyData(), { name: 'A', quantity: 1, unitCost: 1, photoIds: ['gone'] });
    const backup = { ...createBackup('real', defaultSettings(), data, []), photos: [] };
    expect(parseBackup(JSON.stringify(backup)).data.items[0].photoIds).toEqual([]);
  });

  it('restores an in-progress count saved before stock-change tracking', () => {
    const { data, item } = addItem(emptyData(), { name: 'Widget', quantity: 12, unitCost: 1 });
    // A draft in the old shape: counts only, no recordedAtCount.
    const oldDraft = { id: 'c1', startedAt: '2026-11-01T10:00:00.000Z', scope: { category: null, location: null }, counts: { [item.id]: 11 } };
    const file = { ...createBackup('real', defaultSettings(), data, []), data: { ...data, countDraft: oldDraft } };
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.data.countDraft).toEqual({ ...oldDraft, recordedAtCount: {} });
    const cmp = compareCount(parsed.data.items, parsed.data.countDraft!);
    expect(cmp.lines[0]).toMatchObject({ countedQuantity: 11, status: 'missing' });
    expect(cmp.changedSinceCounted).toEqual({});
  });

  it('sanitizes settings field by field', () => {
    const s = sanitizeSettings({ mode: 'business', theme: 'neon', slowMovingDays: -4, currency: 'EUR' });
    expect(s).toMatchObject({ mode: 'business', theme: 'system', slowMovingDays: 60, currency: 'EUR' });
  });
});

describe('backup with bulk lots', () => {
  const lotData = () => {
    let { data, lot, items } = createLot(emptyData(), {
      name: 'Auction lot 12',
      purchasePrice: 90,
      extraCosts: [{ label: "Buyer's premium", amount: 10 }],
      purchaseDate: '2026-10-01',
      source: 'Auction',
      notes: '',
      method: 'relative_value',
      lines: [
        { name: 'Sneakers', quantity: 1, estimatedUnitValue: 100 },
        { name: 'Mugs', quantity: 3, estimatedUnitValue: 20 },
        { name: 'Jacket', quantity: 1, estimatedUnitValue: 40 },
      ],
    });
    data = recordSale(data, { itemId: items[1].id, quantity: 1, salePrice: 25, priceMode: 'per_unit', saleDate: '2026-10-05' }).data;
    const edit = {
      name: lot.name,
      purchasePrice: 95,
      extraCosts: [{ label: "Buyer's premium", amount: 10 }],
      purchaseDate: lot.purchaseDate,
      source: lot.source,
      notes: lot.notes,
      method: lot.method,
      estimates: {},
    };
    ({ data, lot } = applyLotEdit(data, lot.id, edit, 'Invoice was higher'));
    return { data, lot };
  };

  it('round-trips lots, their history and the exact item costs', () => {
    const { data } = lotData();
    const parsed = parseBackup(JSON.stringify(createBackup('real', defaultSettings(), data, [])));
    expect(parsed.data).toEqual(data);
    expect(parsed.data.lots[0].history.map((h) => h.kind)).toEqual(['created', 'costs']);
    expect(lotSummary(parsed.data, parsed.data.lots[0]).reconciled).toBe(true);
  });

  it('restores backups made before lots existed (no "lots" in the file)', () => {
    const { data } = addItem(emptyData(), { name: 'A', quantity: 1, unitCost: 1 });
    const old = JSON.parse(JSON.stringify(createBackup('real', defaultSettings(), data, [])));
    delete old.data.lots;
    expect(parseBackup(JSON.stringify(old)).data.lots).toEqual([]);
    expect(sanitizeAppData({ items: [] }).lots).toEqual([]);
  });

  it('keeps items, costs and sales intact when an older app ignores the lots', () => {
    // An app version without lots reads the same items and sales and simply doesn't see "lots".
    const { data } = lotData();
    const { lots: _ignored, ...withoutLots } = JSON.parse(JSON.stringify(data));
    const restored = sanitizeAppData(withoutLots);
    expect(restored.items).toEqual(data.items);
    expect(restored.sales).toEqual(data.sales);
  });

  it('rejects a broken lot, but skips unreadable history entries', () => {
    const { data } = lotData();
    const broken = JSON.parse(JSON.stringify(data));
    broken.lots[0].lines[0].quantity = 0;
    expect(() => sanitizeAppData(broken)).toThrow('Lot 1: "quantity" can\'t be below 1');
    const noisy = JSON.parse(JSON.stringify(data));
    noisy.lots[0].history.push('junk', { kind: 'costs' });
    expect(sanitizeAppData(noisy).lots[0].history).toHaveLength(2);
    const unknownMethod = JSON.parse(JSON.stringify(data));
    unknownMethod.lots[0].method = 'something-new';
    expect(sanitizeAppData(unknownMethod).lots[0].method).toBe('relative_value');
  });
});
