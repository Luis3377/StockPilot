import { DomainError } from '../domain/errors';
import type { AppData, DatasetId, PhotoRecord, Settings } from '../domain/types';
import { sanitizeAppData, sanitizeSettings } from './sanitize';

export const BACKUP_FORMAT = 'stockpilot-backup';
export const BACKUP_VERSION = 1;

export interface BackupPhoto {
  id: string;
  full: string;
  thumb: string;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  app: 'StockPilot';
  exportedAt: string;
  dataset: DatasetId;
  settings: Settings;
  data: AppData;
  photos: BackupPhoto[];
}

export function createBackup(dataset: DatasetId, settings: Settings, data: AppData, photos: PhotoRecord[]): BackupFile {
  const referenced = new Set(data.items.flatMap((i) => i.photoIds));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: 'StockPilot',
    exportedAt: new Date().toISOString(),
    dataset,
    settings,
    data,
    photos: photos.filter((p) => referenced.has(p.id)).map(({ id, full, thumb }) => ({ id, full, thumb })),
  };
}

export interface ParsedBackup {
  exportedAt: string;
  dataset: DatasetId;
  settings: Settings;
  data: AppData;
  photos: BackupPhoto[];
}

const isImageDataUrl = (v: unknown): v is string => typeof v === 'string' && /^data:image\/(jpeg|png|webp|gif);base64,/.test(v);

export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DomainError("This file isn't a StockPilot backup (it isn't valid JSON).");
  }
  if (typeof raw !== 'object' || raw === null || (raw as { format?: unknown }).format !== BACKUP_FORMAT) {
    throw new DomainError("This file isn't a StockPilot backup.");
  }
  const b = raw as Record<string, unknown>;
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new DomainError('This backup was made by a newer version of StockPilot. Update the app and try again.');
  }
  const data = sanitizeAppData(b.data);
  const photos = Array.isArray(b.photos)
    ? b.photos.filter(
        (p): p is BackupPhoto =>
          typeof p === 'object' && p !== null && typeof p.id === 'string' && isImageDataUrl(p.full) && isImageDataUrl(p.thumb),
      )
    : [];
  // Drop references to photos that aren't in the file so the UI never shows broken images.
  const photoIds = new Set(photos.map((p) => p.id));
  data.items = data.items.map((i) => ({ ...i, photoIds: i.photoIds.filter((id) => photoIds.has(id)) }));
  return {
    exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
    dataset: b.dataset === 'demo' ? 'demo' : 'real',
    settings: sanitizeSettings(b.settings),
    data,
    photos,
  };
}
