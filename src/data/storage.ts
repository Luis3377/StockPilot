// Persistence. The app talks to a StorageAdapter so the on-device IndexedDB implementation
// can later be swapped for (or synced with) a secure, per-user cloud backend without
// touching the UI or the calculation code.

import type { AppData, DatasetId, PhotoRecord, Settings } from '../domain/types';

export interface StorageAdapter {
  readonly kind: 'indexeddb' | 'memory';
  getSettings(): Promise<unknown>;
  putSettings(settings: Settings): Promise<void>;
  getData(dataset: DatasetId): Promise<unknown>;
  putData(dataset: DatasetId, data: AppData): Promise<void>;
  getPhoto(id: string): Promise<PhotoRecord | undefined>;
  putPhotos(photos: PhotoRecord[]): Promise<void>;
  deletePhotos(ids: string[]): Promise<void>;
  listPhotos(dataset: DatasetId): Promise<PhotoRecord[]>;
  clearDataset(dataset: DatasetId): Promise<void>;
}

const DB_NAME = 'stockpilot';
const DB_VERSION = 1;
const KV = 'kv';
const PHOTOS = 'photos';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      if (!db.objectStoreNames.contains(PHOTOS)) {
        db.createObjectStore(PHOTOS, { keyPath: 'id' }).createIndex('by_dataset', 'dataset');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('StockPilot is open in another tab that needs to be closed first.'));
  });
}

export class IndexedDbStorage implements StorageAdapter {
  readonly kind = 'indexeddb' as const;
  private constructor(private db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<IndexedDbStorage> {
    return new IndexedDbStorage(await openDb(factory));
  }

  private async kvGet(key: string): Promise<unknown> {
    return request(this.db.transaction(KV, 'readonly').objectStore(KV).get(key));
  }

  private async kvPut(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction(KV, 'readwrite');
    tx.objectStore(KV).put(value, key);
    await done(tx);
  }

  getSettings() {
    return this.kvGet('settings');
  }
  putSettings(settings: Settings) {
    return this.kvPut('settings', settings);
  }
  getData(dataset: DatasetId) {
    return this.kvGet(`data:${dataset}`);
  }
  putData(dataset: DatasetId, data: AppData) {
    return this.kvPut(`data:${dataset}`, data);
  }

  async getPhoto(id: string): Promise<PhotoRecord | undefined> {
    return request(this.db.transaction(PHOTOS, 'readonly').objectStore(PHOTOS).get(id));
  }

  async putPhotos(photos: PhotoRecord[]): Promise<void> {
    if (!photos.length) return;
    const tx = this.db.transaction(PHOTOS, 'readwrite');
    const store = tx.objectStore(PHOTOS);
    for (const p of photos) store.put(p);
    await done(tx);
  }

  async deletePhotos(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const tx = this.db.transaction(PHOTOS, 'readwrite');
    const store = tx.objectStore(PHOTOS);
    for (const id of ids) store.delete(id);
    await done(tx);
  }

  async listPhotos(dataset: DatasetId): Promise<PhotoRecord[]> {
    const index = this.db.transaction(PHOTOS, 'readonly').objectStore(PHOTOS).index('by_dataset');
    return request(index.getAll(dataset));
  }

  async clearDataset(dataset: DatasetId): Promise<void> {
    const ids = (await this.listPhotos(dataset)).map((p) => p.id);
    const tx = this.db.transaction([KV, PHOTOS], 'readwrite');
    tx.objectStore(KV).delete(`data:${dataset}`);
    const photos = tx.objectStore(PHOTOS);
    for (const id of ids) photos.delete(id);
    await done(tx);
  }
}

/** Fallback when the browser blocks storage. Data lasts only until the tab closes. */
export class MemoryStorage implements StorageAdapter {
  readonly kind = 'memory' as const;
  private kv = new Map<string, unknown>();
  private photos = new Map<string, PhotoRecord>();

  async getSettings() {
    return structuredClone(this.kv.get('settings'));
  }
  async putSettings(settings: Settings) {
    this.kv.set('settings', structuredClone(settings));
  }
  async getData(dataset: DatasetId) {
    return structuredClone(this.kv.get(`data:${dataset}`));
  }
  async putData(dataset: DatasetId, data: AppData) {
    this.kv.set(`data:${dataset}`, structuredClone(data));
  }
  async getPhoto(id: string) {
    return this.photos.get(id);
  }
  async putPhotos(photos: PhotoRecord[]) {
    for (const p of photos) this.photos.set(p.id, p);
  }
  async deletePhotos(ids: string[]) {
    for (const id of ids) this.photos.delete(id);
  }
  async listPhotos(dataset: DatasetId) {
    return [...this.photos.values()].filter((p) => p.dataset === dataset);
  }
  async clearDataset(dataset: DatasetId) {
    this.kv.delete(`data:${dataset}`);
    for (const [id, p] of this.photos) if (p.dataset === dataset) this.photos.delete(id);
  }
}

export async function openStorage(): Promise<StorageAdapter> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB unavailable');
    return await IndexedDbStorage.open();
  } catch {
    return new MemoryStorage();
  }
}
