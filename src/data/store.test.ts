import { describe, expect, it } from 'vitest';
import { AppStore } from './store';
import { MemoryStorage } from './storage';
import { addItem, recordSale } from '../domain/actions';
import { createBackup, parseBackup } from './backup';

describe('AppStore', () => {
  it('persists commits and keeps demo data separate from real data', async () => {
    const storage = new MemoryStorage();
    const s1 = new AppStore();
    await s1.init(storage);
    expect(s1.getState().status).toBe('ready');
    s1.updateSettings({ onboarded: true, mode: 'collector' });
    const { item } = s1.commit((d) => addItem(d, { name: 'Real thing', quantity: 2, unitCost: 3 }));
    s1.commit((d) => recordSale(d, { itemId: item.id, quantity: 1, salePrice: 9, priceMode: 'per_unit', saleDate: '2026-10-01' }));
    await s1.flush();

    // Reopen: data and settings survive.
    const s2 = new AppStore();
    await s2.init(storage);
    expect(s2.getState().settings).toMatchObject({ onboarded: true, mode: 'collector' });
    expect(s2.getState().data.items[0]).toMatchObject({ name: 'Real thing', quantity: 1 });
    expect(s2.getState().data.snapshots.length).toBe(1);

    // Demo mode loads sample data without touching the real dataset.
    await s2.setDemoActive(true);
    expect(s2.getState().dataset).toBe('demo');
    expect(s2.getState().data.items.length).toBeGreaterThan(20);
    s2.commit((d) => addItem(d, { name: 'Demo extra', quantity: 1, unitCost: 1 }));
    await s2.setDemoActive(false);
    expect(s2.getState().data.items.map((i) => i.name)).toEqual(['Real thing']);

    // Switching modes changes settings only.
    s2.updateSettings({ mode: 'business' });
    await s2.flush();
    expect(s2.getState().data.items).toHaveLength(1);

    await s2.resetDemo();
    await s2.setDemoActive(true);
    expect(s2.getState().data.items.some((i) => i.name === 'Demo extra')).toBe(false);
  });

  it('does not save when an action throws', async () => {
    const storage = new MemoryStorage();
    const s = new AppStore();
    await s.init(storage);
    expect(() => s.commit((d) => addItem(d, { name: '', quantity: 1, unitCost: 1 }))).toThrow();
    await s.flush();
    expect(await storage.getData('real')).toBeUndefined();
  });
});

describe('AppStore.restore', () => {
  it('replaces data, remaps photo ids and removes old photos', async () => {
    const IMG = 'data:image/jpeg;base64,AAAA';
    const storage = new MemoryStorage();
    const s = new AppStore();
    await s.init(storage);
    await s.savePhotos([{ id: 'p1', full: IMG, thumb: IMG, createdAt: '' }]);
    s.commit((d) => addItem(d, { name: 'With photo', quantity: 1, unitCost: 1, photoIds: ['p1'] }));
    await s.flush();
    const backup = parseBackup(JSON.stringify(createBackup('real', s.getState().settings, s.getState().data, await storage.listPhotos('real'))));

    s.commit((d) => addItem(d, { name: 'Added after backup', quantity: 1, unitCost: 1 }));
    await s.restore(backup, false);
    const items = s.getState().data.items;
    expect(items.map((i) => i.name)).toEqual(['With photo']);
    const [photoId] = items[0].photoIds;
    expect(photoId).not.toBe('p1');
    expect((await storage.listPhotos('real')).map((p) => p.id)).toEqual([photoId]);
  });
});
