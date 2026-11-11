// When to remind someone to download a backup. Records live only in this browser, so a backup
// file is the only copy that survives cleared website data, a lost phone or a new device.

import type { AppData } from '../domain/types';

/** Remind again when the newest backup is older than this and there are changes since. */
export const BACKUP_STALE_DAYS = 7;
/** "Remind me later" hides the reminder for this long. */
export const BACKUP_SNOOZE_DAYS = 3;

const DAY_MS = 86_400_000;

/** The most recent time anything was added or changed (null when there's nothing yet). */
export function latestChange(data: AppData): string | null {
  let latest: string | null = null;
  const consider = (t: string | null | undefined) => {
    if (t && (latest === null || t > latest)) latest = t;
  };
  for (const i of data.items) consider(i.updatedAt > i.createdAt ? i.updatedAt : i.createdAt);
  for (const s of data.sales) consider(s.updatedAt > s.createdAt ? s.updatedAt : s.createdAt);
  for (const a of data.adjustments) consider(a.date);
  for (const c of data.countHistory) consider(c.completedAt);
  return latest;
}

export interface BackupStatus {
  /** True when a reminder should be shown (before any snooze). */
  due: boolean;
  /** 'never': no backup yet; 'stale': last backup is old and things changed since. */
  reason: 'never' | 'stale' | null;
  /** Whole days since the last backup, or null if there's never been one. */
  daysSinceBackup: number | null;
  /** Something was added or changed after the last backup. */
  changedSinceBackup: boolean;
  /** Items and sales a backup would protect. */
  records: number;
}

/**
 * Decides whether to suggest a backup. There's nothing to protect until something is
 * recorded. After that: remind if there has never been a backup, or if the last one is more
 * than a week old and something changed since. (Deleting a record leaves no timestamp, so a
 * deletion alone doesn't count as a change.)
 */
export function backupStatus(data: AppData, lastBackupAt: string | null, now: number = Date.now()): BackupStatus {
  const records = data.items.length + data.sales.length;
  const changed = latestChange(data);
  const daysSinceBackup = lastBackupAt ? Math.max(0, Math.floor((now - Date.parse(lastBackupAt)) / DAY_MS)) : null;
  const changedSinceBackup = changed !== null && (lastBackupAt === null || changed > lastBackupAt);
  if (records === 0) return { due: false, reason: null, daysSinceBackup, changedSinceBackup, records };
  if (lastBackupAt === null) return { due: true, reason: 'never', daysSinceBackup, changedSinceBackup, records };
  const stale = daysSinceBackup !== null && daysSinceBackup >= BACKUP_STALE_DAYS && changedSinceBackup;
  return { due: stale, reason: stale ? 'stale' : null, daysSinceBackup, changedSinceBackup, records };
}

/** Plain-language age of the last backup, e.g. "never", "today", "3 days ago". */
export function backupAgeText(lastBackupAt: string | null, now: number = Date.now()): string {
  if (!lastBackupAt) return 'never';
  const days = Math.floor((now - Date.parse(lastBackupAt)) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}
