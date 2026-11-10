import { useState } from 'react';
import { KeyRound, Sparkles } from 'lucide-react';
import { remoteScanProvider, ScanError } from '../ai/scanClient';
import { setTesterCode, useTesterCode } from '../ai/testerCode';
import { formatDate } from '../domain/dates';
import { plural } from '../domain/format';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useToast } from '../ui/Toast';
import { InviteCodeForm, ScanPrivacyDetails } from './dialogs/ScanPanel';

/** Settings → AI scanner (private beta). Only rendered when the scanner is enabled in this build. */
export function ScannerSettings() {
  const code = useTesterCode();
  const toast = useToast();
  const [status, setStatus] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = async () => {
    if (!code) return;
    setChecking(true);
    try {
      const s = await remoteScanProvider.status(code);
      setStatus(`${plural(s.scansLeftToday, 'scan')} left today (of ${s.dailyLimit}) · code expires ${formatDate(new Date(s.expiresAt).toISOString())}`);
    } catch (e) {
      const err = e instanceof ScanError ? e : null;
      setStatus(err?.message ?? 'The code couldn’t be checked.');
      if (err?.needsCode && err.code !== 'missing_code') setTesterCode(null);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card id="ai-scanner" className="scroll-mt-24 p-5 sm:p-6" data-testid="scanner-settings">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
        <Sparkles className="size-4 text-demo" /> AI scanner <Badge tone="demo">Private beta</Badge>
      </h2>
      <p className="mt-0.5 text-sm text-ink-2">Photograph an item and AI suggests its name, category, condition and a description. Invite code required during the beta.</p>
      <div className="mt-4 space-y-3">
        {code ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-surface-2 p-3 text-sm">
            <KeyRound className="size-4 text-muted" />
            <span className="flex-1 text-ink">Invite code saved on this device</span>
            <Button size="sm" onClick={() => void check()} loading={checking}>
              Check code
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setTesterCode(null);
                setStatus(null);
                toast.info('Invite code removed from this device.');
              }}
            >
              Remove code
            </Button>
          </div>
        ) : (
          <InviteCodeForm onSaved={() => toast.success('Invite code saved on this device.')} />
        )}
        {status && (
          <p className="text-sm text-ink-2" role="status" data-testid="scanner-status">
            {status}
          </p>
        )}
        <div className="text-sm text-ink-2">
          <p className="mb-1 font-medium text-ink">How scanned photos are handled</p>
          <ScanPrivacyDetails />
        </div>
        <p className="text-xs text-muted">Invite codes only unlock the beta scanner; they aren’t an account. Each code has a daily scan limit and an expiry date.</p>
      </div>
    </Card>
  );
}
