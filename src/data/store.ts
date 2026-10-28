// App-wide state: settings + the active dataset (real or demo). Every change goes through
// `commit`, which applies a pure domain action, records today's value snapshot, updates the
// UI immediately and persists in the background (in order). Other open tabs are told to
// reload so they never overwrite newer data with a stale copy.

import { useSyncExternalStore } from 'react';
import { upsertSnapshot } from '../domain/actions';
import { newId } from '../domain/ids';
import { emptyData, defaultSettings, type AppData, type DatasetId, type PhotoRecord, type Settings } from '../domain/types';
import { sanitizeAppData, sanitizeSettings } from './sanitize';
import { buildDemoData } from './demo';
import { openStorage, type StorageAdapter } from './storage';
import type { ParsedBackup } from './backup';

export interface AppState {
  status: 'loading' | 'ready' | 'error';
  loadError: string | null;
  settings: Settings;
  data: AppData;
  dataset: DatasetId;
  storageKind: 'indexeddb' | 'memory';
  persistGranted: boolean | null;
  saveError: string | null;
}

type Listener = () => void;

const TAB_ID = Math.random().toString(36).slice(2);

export class AppStore {
  private state: AppState = {
    status: 'loading',
    loadError: null,
    settings: defaultSettings(),
    data: emptyData(),
    dataset: 'real',
    storageKind: 'indexeddb',
    persistGranted: null,
    saveError: null,
  };
  private listeners = new Set<Listener>();
  private adapter: StorageAdapter | null = null;
  private saving: Promise<void> = Promise.resolve();
  private channel: BroadcastChannel | null = null;

  getState = (): AppState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  get storage(): StorageAdapter {
    if (!this.adapter) throw new Error('Storage not ready');
    return this.adapter;
  }

  async init(adapter?: StorageAdapter): Promise<void> {
    try {
      this.adapter = adapter ?? (await openStorage());
      const settings = sanitizeSettings(await this.adapter.getSettings());
      const dataset: DatasetId = settings.demoActive ? 'demo' : 'real';
      const data = await this.loadDataset(dataset);
      this.set({ status: 'ready', settings, dataset, data, storageKind: this.adapter.kind });
      this.listenToOtherTabs();
      void this.cleanOrphanPhotos(dataset);
      if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
        navigator.storage.persisted().then((p) => this.set({ persistGranted: p }), () => undefined);
      }
    } catch (e) {
      this.set({ status: 'error', loadError: e instanceof Error ? e.message : String(e) });
    }
  }

  private async loadDataset(dataset: DatasetId): Promise<AppData> {
    const raw = await this.storage.getData(dataset);
    if (raw === undefined || raw === null) {
      if (dataset === 'demo') {
        const demo = buildDemoData();
        await this.storage.putData('demo', demo);
        return demo;
      }
      return emptyData();
    }
    return sanitizeAppData(raw);
  }

  private listenToOtherTabs() {
    if (typeof BroadcastChannel === 'undefined') return;
    this.channel = new BroadcastChannel('stockpilot-sync');
    this.channel.onmessage = async (event: MessageEvent<{ from: string; kind: 'data' | 'settings' }>) => {
      if (event.data?.from === TAB_ID || !this.adapter) return;
      const settings = sanitizeSettings(await this.adapter.getSettings());
      const dataset: DatasetId = settings.demoActive ? 'demo' : 'real';
      const data = await this.loadDataset(dataset);
      this.set({ settings, dataset, data });
    };
  }

  private notifyOtherTabs(kind: 'data' | 'settings') {
    this.channel?.postMessage({ from: TAB_ID, kind });
  }

  /** Queues a write so saves always land in the order changes were made. */
  private persist(write: () => Promise<void>, kind: 'data' | 'settings'): Promise<void> {
    this.saving = this.saving
      .then(write)
      .then(() => {
        if (this.state.saveError) this.set({ saveError: null });
        this.notifyOtherTabs(kind);
      })
      .catch((e: unknown) => {
        this.set({ saveError: e instanceof Error ? e.message : 'Your latest change could not be saved.' });
      });
    return this.saving;
  }

  /** Waits until all queued writes have finished. */
  flush(): Promise<void> {
    return this.saving;
  }

  /** Applies a change to the active dataset. Throws (without saving) if the action throws. */
  commit<R>(action: (data: AppData) => { data: AppData } & R): R {
    const result = action(this.state.data);
    const data = upsertSnapshot(result.data);
    const dataset = this.state.dataset;
    this.set({ data });
    void this.persist(() => this.storage.putData(dataset, data), 'data');
    if (dataset === 'real' && this.state.persistGranted === false) void this.requestPersistence();
    return result;
  }

  /** Like commit, for actions that just return the new data. */
  update(action: (data: AppData) => AppData): void {
    this.commit((d) => ({ data: action(d) }));
  }

  updateSettings(patch: Partial<Settings>): void {
    const settings = { ...this.state.settings, ...patch };
    this.set({ settings });
    void this.persist(() => this.storage.putSettings(settings), 'settings');
  }

  async requestPersistence(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    try {
      const granted = await navigator.storage.persist();
      this.set({ persistGranted: granted });
      return granted;
    } catch {
      return false;
    }
  }

  async setDemoActive(active: boolean): Promise<void> {
    await this.flush();
    const dataset: DatasetId = active ? 'demo' : 'real';
    const data = await this.loadDataset(dataset);
    const settings = { ...this.state.settings, demoActive: active };
    this.set({ dataset, data, settings });
    await this.persist(() => this.storage.putSettings(settings), 'settings');
  }

  async resetDemo(): Promise<void> {
    await this.flush();
    await this.storage.clearDataset('demo');
    if (this.state.dataset === 'demo') {
      const data = await this.loadDataset('demo');
      this.set({ data });
    }
  }

  /** Permanently erases the real dataset and its photos. */
  async clearRealData(): Promise<void> {
    await this.flush();
    await this.storage.clearDataset('real');
    if (this.state.dataset === 'real') this.set({ data: emptyData() });
    this.notifyOtherTabs('data');
  }

  /**
   * Replaces the active dataset with a restored backup. New records are written before old
   * ones are removed, so a failure part-way (e.g. storage full) leaves the current data intact.
   * Photos get fresh ids so a backup restored into another dataset can't collide with it.
   */
  async restore(backup: ParsedBackup, restoreSettings: boolean): Promise<void> {
    await this.flush();
    const dataset = this.state.dataset;
    const now = new Date().toISOString();
    const idMap = new Map(backup.photos.map((p) => [p.id, newId()]));
    const photos: PhotoRecord[] = backup.photos.map((p) => ({ id: idMap.get(p.id)!, full: p.full, thumb: p.thumb, dataset, createdAt: now }));
    const data: AppData = {
      ...backup.data,
      items: backup.data.items.map((i) => ({ ...i, photoIds: i.photoIds.flatMap((id) => (idMap.has(id) ? [idMap.get(id)!] : [])) })),
    };
    const oldPhotoIds = (await this.storage.listPhotos(dataset)).map((p) => p.id);
    await this.storage.putPhotos(photos);
    await this.storage.putData(dataset, data);
    this.set({ data });
    await this.storage.deletePhotos(oldPhotoIds).catch(() => undefined);
    if (restoreSettings) {
      const { demoActive, onboarded, lastBackupAt } = this.state.settings;
      this.updateSettings({ ...backup.settings, demoActive, onboarded, lastBackupAt });
    }
    this.notifyOtherTabs('data');
  }

  async savePhotos(photos: Omit<PhotoRecord, 'dataset'>[]): Promise<void> {
    await this.storage.putPhotos(photos.map((p) => ({ ...p, dataset: this.state.dataset })));
  }

  async deletePhotos(ids: string[]): Promise<void> {
    await this.storage.deletePhotos(ids);
  }

  /** Removes stored photos no item refers to (e.g. from an abandoned "add item" form). */
  private async cleanOrphanPhotos(dataset: DatasetId): Promise<void> {
    try {
      const used = new Set(this.state.data.items.flatMap((i) => i.photoIds));
      const cutoff = Date.now() - 60 * 60 * 1000;
      const orphans = (await this.storage.listPhotos(dataset))
        .filter((p) => !used.has(p.id) && Date.parse(p.createdAt) < cutoff)
        .map((p) => p.id);
      if (orphans.length) await this.storage.deletePhotos(orphans);
    } catch {
      // Best effort; orphans are harmless.
    }
  }
}

export const store = new AppStore();

export function useAppState<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

export const useData = () => useAppState((s) => s.data);
export const useSettings = () => useAppState((s) => s.settings);
