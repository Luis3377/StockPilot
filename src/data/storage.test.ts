import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { IndexedDbStorage } from './storage';
import { addItem } from '../domain/actions';
import { defaultSettings, emptyData } from '../domain/types';

const IMG = 'data:image/jpeg;base64,AAAA';

describe('IndexedDbStorage', () => {
  it('persists settings, data and photos per dataset across reopen', async () => {
    const db = await IndexedDbStorage.open();
    const { data } = addItem(emptyData(), { name: 'Saved', quantity: 1, unitCost: 1, photoIds: ['p1'] });
    await db.putSettings({ ...defaultSettings(), mode: 'business' });
    await db.putData('real', data);
    await db.putData('demo', emptyData());
    await db.putPhotos([
      { id: 'p1', dataset: 'real', full: IMG, thumb: IMG, createdAt: '' },
      { id: 'd1', dataset: 'demo', full: IMG, thumb: IMG, createdAt: '' },
    ]);

    const reopened = await IndexedDbStorage.open();
    expect(await reopened.getSettings()).toMatchObject({ mode: 'business' });
    expect(await reopened.getData('real')).toEqual(data);
    expect((await reopened.listPhotos('real')).map((p) => p.id)).toEqual(['p1']);

    await reopened.clearDataset('demo');
    expect(await reopened.getData('demo')).toBeUndefined();
    expect(await reopened.listPhotos('demo')).toEqual([]);
    // Clearing demo data never touches real data.
    expect(await reopened.getData('real')).toEqual(data);
    expect(await reopened.getPhoto('p1')).toBeDefined();
  });
});
