import { Link } from 'react-router-dom';
import { HardDrive } from 'lucide-react';
import { useAppState } from '../data/store';
import { usePersistentState } from '../lib/usePersistentState';

/**
 * One-time reminder that records stay in this browser, so items added on a phone not
 * showing up on a computer isn't mistaken for a bug. Hidden in demo mode.
 */
export function DeviceNotice() {
  const demo = useAppState((s) => s.dataset === 'demo');
  const [state, setState] = usePersistentState<'show' | 'dismissed'>('device-notice', 'show', ['show', 'dismissed']);
  if (demo || state === 'dismissed') return null;
  return (
    <div role="note" data-testid="device-notice" className="mb-5 flex gap-3 rounded-2xl border border-line bg-surface p-4 text-sm shadow-card">
      <HardDrive className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-ink-2">
          <strong className="text-ink">Your data lives only in this browser.</strong> To move it to another device, use Download backup here and Restore on the other device.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
          <Link to="/settings#backup" className="font-medium text-accent-text hover:underline">
            Go to Backup & restore
          </Link>
          <button type="button" onClick={() => setState('dismissed')} className="font-medium text-ink-2 hover:text-ink">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
