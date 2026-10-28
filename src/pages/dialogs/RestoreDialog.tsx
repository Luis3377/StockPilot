import { useEffect, useRef, useState } from 'react';
import { FileUp } from 'lucide-react';
import { parseBackup, type ParsedBackup } from '../../data/backup';
import { store, useAppState } from '../../data/store';
import { isDomainError } from '../../domain/errors';
import { formatDateTime } from '../../domain/dates';
import { readFileText } from '../../lib/download';
import { forgetPhotos } from '../../ui/Photo';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Checkbox } from '../../ui/Fields';
import { useToast } from '../../ui/Toast';

export function RestoreDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const current = useAppState((s) => s.data);
  const dataset = useAppState((s) => s.dataset);
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [backup, setBackup] = useState<ParsedBackup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [withSettings, setWithSettings] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setBackup(null);
      setError(null);
      setWithSettings(true);
    }
  }, [open]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setBackup(null);
    try {
      setBackup(parseBackup(await readFileText(file)));
    } catch (e) {
      setError(isDomainError(e) ? e.message : 'The file could not be read.');
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  const restore = async () => {
    if (!backup) return;
    setBusy(true);
    try {
      forgetPhotos(current.items.flatMap((i) => i.photoIds));
      await store.restore(backup, withSettings);
      toast.success(`Restored ${backup.data.items.length} items and ${backup.data.sales.length} sales.`);
      onClose();
    } catch {
      toast.error('Restore failed. Your existing data was not changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Restore from backup"
      description={dataset === 'demo' ? 'This replaces the demo data.' : 'This replaces all the data on this device.'}
      testId="restore-dialog"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => void restore()} disabled={!backup} loading={busy}>
            Replace my data
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-dashed border-line-strong bg-surface-2 p-5 text-center">
          <FileUp className="mx-auto mb-2 size-6 text-ink-2" />
          <p className="text-sm text-ink-2">Choose a StockPilot backup file (.json).</p>
          <Button className="mt-3" variant="primary" onClick={() => inputRef.current?.click()}>
            Choose backup file
          </Button>
          <input ref={inputRef} type="file" accept=".json,application/json" className="sr-only" aria-label="Backup file" data-testid="restore-file" onChange={(e) => void choose(e.target.files?.[0])} />
        </div>
        {error && (
          <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad-text" role="alert">
            {error}
          </p>
        )}
        {backup && (
          <div className="space-y-3 rounded-xl border border-line p-4 text-sm">
            <p className="text-ink">
              Backup from <strong>{backup.exportedAt ? formatDateTime(backup.exportedAt) : 'an unknown date'}</strong>
              {backup.dataset === 'demo' && ' (demo data)'}
            </p>
            <ul className="grid grid-cols-2 gap-2 text-ink-2">
              <li>{backup.data.items.length} items</li>
              <li>{backup.data.sales.length} sales</li>
              <li>{backup.photos.length} photos</li>
              <li>{backup.data.countHistory.length} counts</li>
            </ul>
            <p className="rounded-lg bg-warn-soft p-2 text-warn-text">
              Your current {current.items.length} items and {current.sales.length} sales will be replaced. Consider downloading a backup of them first.
            </p>
            <Checkbox checked={withSettings} onChange={setWithSettings} label="Also restore settings" description="Mode, theme, currency and alert thresholds." />
          </div>
        )}
      </div>
    </Dialog>
  );
}
