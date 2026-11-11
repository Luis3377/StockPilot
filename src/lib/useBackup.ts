import { useState } from 'react';
import { createBackup } from '../data/backup';
import { store, useAppState } from '../data/store';
import { downloadText, fileStamp } from './download';
import { plural } from '../domain/format';
import { useToast } from '../ui/Toast';

/** Downloads a full backup (items, photos, sales, counts and settings) of the active data. */
export function useBackup() {
  const dataset = useAppState((s) => s.dataset);
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const backup = async (): Promise<boolean> => {
    setBusy(true);
    try {
      await store.flush();
      const { settings, data } = store.getState();
      const photos = await store.storage.listPhotos(dataset);
      const file = createBackup(dataset, settings, data, photos);
      const demo = dataset === 'demo';
      downloadText(`stockpilot-${demo ? 'demo-' : ''}backup-${fileStamp()}.json`, JSON.stringify(file), 'application/json');
      if (!demo) store.updateSettings({ lastBackupAt: new Date().toISOString() });
      toast.success(`Backup downloaded: ${plural(data.items.length, 'item')}, ${plural(data.sales.length, 'sale')}, ${plural(file.photos.length, 'photo')}. Keep the file somewhere safe.`);
      return true;
    } catch {
      toast.error('The backup could not be created.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { backup, busy };
}
