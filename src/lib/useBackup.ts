import { useState } from 'react';
import { PRACTICE_DATA_LOCK, PracticeLockError, store, useAppState } from '../data/store';
import { downloadText, fileStamp } from './download';
import { plural } from '../domain/format';
import { useToast } from '../ui/Toast';

/** Downloads a full backup (items, photos, sales, counts and settings) of the active data. */
export function useBackup() {
  // Re-render when the open records change, so callers see `practicing` update.
  const practicing = useAppState((s) => s.dataset === 'practice');
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const backup = async (): Promise<boolean> => {
    // A backup of practice records would look like one of your real records: refused (the store enforces it too).
    if (store.practicing) {
      toast.error(PRACTICE_DATA_LOCK);
      return false;
    }
    setBusy(true);
    try {
      const { file, dataset } = await store.createBackupFile();
      const demo = dataset === 'demo';
      downloadText(`stockpilot-${demo ? 'demo-' : ''}backup-${fileStamp()}.json`, JSON.stringify(file), 'application/json');
      if (!demo) store.updateSettings({ lastBackupAt: new Date().toISOString() });
      toast.success(`Backup downloaded: ${plural(file.data.items.length, 'item')}, ${plural(file.data.sales.length, 'sale')}, ${plural(file.photos.length, 'photo')}. Keep the file somewhere safe.`);
      return true;
    } catch (e) {
      toast.error(e instanceof PracticeLockError ? PRACTICE_DATA_LOCK : 'The backup could not be created.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { backup, busy, practicing };
}
