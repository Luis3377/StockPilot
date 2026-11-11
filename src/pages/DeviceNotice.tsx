import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, DatabaseBackup, HardDrive } from 'lucide-react';
import { useAppState } from '../data/store';
import { BACKUP_SNOOZE_DAYS, backupAgeText, backupStatus } from '../data/backupStatus';
import { usePersistentState } from '../lib/usePersistentState';
import { useBackup } from '../lib/useBackup';
import { installContext } from '../lib/platform';
import { plural } from '../domain/format';
import { Button } from '../ui/Button';

const SNOOZE_KEY = 'stockpilot-ui:backup-reminder-until';

function readSnooze(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY)) || 0;
  } catch {
    return 0;
  }
}

/**
 * One calm notice about keeping inventory safe, shown on Overview and Inventory (never in demo
 * mode). In order of importance:
 *   1. the browser isn't saving anything (private browsing / blocked storage);
 *   2. a backup reminder, when there's never been a backup or the last one is old and things
 *      changed since ("Remind me later" hides it for a few days);
 *   3. a one-time explanation of where data lives, until dismissed.
 */
export function DeviceNotice() {
  const demo = useAppState((s) => s.dataset === 'demo');
  const storageKind = useAppState((s) => s.storageKind);
  const data = useAppState((s) => s.data);
  const lastBackupAt = useAppState((s) => s.settings.lastBackupAt);
  const [intro, setIntro] = usePersistentState<'show' | 'dismissed'>('device-notice', 'show', ['show', 'dismissed']);
  const [snoozedUntil, setSnoozedUntil] = useState(readSnooze);
  const { backup, busy } = useBackup();
  if (demo) return null;

  if (storageKind === 'memory') {
    return (
      <div role="alert" data-testid="storage-warning" className="mb-5 flex gap-3 rounded-2xl bg-bad-soft p-4 text-sm text-bad-text">
        <AlertTriangle className="mt-0.5 size-5 shrink-0" />
        <p>
          <strong>This browser isn’t saving your inventory</strong> (private browsing, or website data is blocked). Anything you add will be lost when you close it. Open StockPilot in a
          normal window, or allow website data, before adding inventory.
        </p>
      </div>
    );
  }

  const status = backupStatus(data, lastBackupAt);
  if (status.due && Date.now() >= snoozedUntil) {
    const snooze = () => {
      const until = Date.now() + BACKUP_SNOOZE_DAYS * 86_400_000;
      try {
        localStorage.setItem(SNOOZE_KEY, String(until));
      } catch {
        // Storage blocked: the reminder is hidden for this visit only.
      }
      setSnoozedUntil(until);
    };
    return (
      <section aria-label="Backup reminder" data-testid="backup-reminder" className="mb-5 flex gap-3 rounded-2xl border border-warn/40 bg-warn-soft/60 p-4 text-sm shadow-card">
        <DatabaseBackup className="mt-0.5 size-5 shrink-0 text-warn-text" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{status.reason === 'never' ? 'Back up your inventory' : `Your last backup was ${backupAgeText(lastBackupAt)}`}</p>
          <p className="mt-0.5 text-ink-2">
            {status.reason === 'never'
              ? `Your ${plural(status.records, 'record')} ${status.records === 1 ? 'is' : 'are'} saved only in this browser on this device. Download a backup file and keep it somewhere safe (Files, iCloud Drive, Google Drive or email) so you can restore it if website data is cleared or you change devices.`
              : 'You’ve added or changed things since then. Download a fresh backup so the newest records are protected too.'}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button size="sm" variant="primary" loading={busy} onClick={() => void backup()}>
              Back up now
            </Button>
            <button type="button" onClick={snooze} className="font-medium text-ink-2 hover:text-ink">
              Remind me later
            </button>
            <Link to="/settings#data" className="font-medium text-accent-text hover:underline">
              How backups work
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (intro === 'dismissed') return null;
  const ios = installContext();
  return (
    <div role="note" data-testid="device-notice" className="mb-5 flex gap-3 rounded-2xl border border-line bg-surface p-4 text-sm shadow-card">
      <HardDrive className="mt-0.5 size-5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="text-ink-2">
          <strong className="text-ink">Your data lives only in this browser on this device.</strong> Clearing website data, switching browsers or changing devices means you won’t see it. Download a
          backup regularly and restore it wherever you need it.
          {ios === 'ios-browser' && ' On iPhone, adding StockPilot to your Home Screen lowers the risk of losing data — see Settings.'}
          {ios === 'ios-home-screen' && ' This Home Screen app keeps its data separate from Safari.'}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
          <Link to="/settings#data" className="font-medium text-accent-text hover:underline">
            Protect your data
          </Link>
          <button type="button" onClick={() => setIntro('dismissed')} className="font-medium text-ink-2 hover:text-ink">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
