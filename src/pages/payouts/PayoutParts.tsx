// Pieces shared by the Payout Reconciliation pages.

import { useEffect, useMemo, useState } from 'react';
import { reconcile, STATUS_LABELS, type ReconStatus } from '../../domain/reconcile';
import { useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { Badge, type Tone } from '../../ui/Badge';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { TextAreaField } from '../../ui/Fields';
import { cn } from '../../ui/cn';

/** The reconciliation of everything imported, recomputed whenever data changes (it's pure and fast). */
export function useReconciliation() {
  const data = useAppState((s) => s.data);
  const currency = useAppState((s) => s.settings.currency);
  return useMemo(() => reconcile(data, currency), [data, currency]);
}

const STATUS_TONES: Record<ReconStatus, Tone> = { reconciled: 'good', unreconciled: 'bad', pending: 'neutral', needs_review: 'warn' };

export function StatusBadge({ status, className }: { status: ReconStatus; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status]} className={className}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/** "+$7.32" / "-$7.32" / "$0.00", coloured only when it's a difference that matters. */
export function Signed({ amount, className, tone = true }: { amount: number | null; className?: string; tone?: boolean }) {
  const { money } = useMoney();
  if (amount === null) return <span className={cn('text-muted', className)}>—</span>;
  const cents = Math.round(amount * 100);
  const text = `${cents > 0 ? '+' : ''}${money(amount)}`;
  return <span className={cn('tabular', tone && cents !== 0 && 'font-medium text-bad-text', className)}>{text}</span>;
}

/** Asks for the reason behind a decision. Nothing is recorded without one. */
export function ReasonDialog({
  open,
  title,
  description,
  suggestions = [],
  confirmLabel = 'Save decision',
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  suggestions?: string[];
  confirmLabel?: string;
  onSave: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setReason('');
    setError(null);
  }, [open]);
  const save = () => {
    if (!reason.trim()) {
      setError('Say why, so you (or your accountant) can follow it later.');
      return;
    }
    onSave(reason.trim());
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      testId="reason-dialog"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} data-testid="reason-save">
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <Button
                key={s}
                size="sm"
                variant="soft"
                onClick={() => {
                  setReason(s);
                  setError(null);
                }}
              >
                {s}
              </Button>
            ))}
          </div>
        )}
        <TextAreaField
          label="Reason"
          value={reason}
          onChange={(v) => {
            setReason(v);
            setError(null);
          }}
          rows={3}
          maxLength={500}
          error={error}
          data-autofocus
        />
        <p className="text-xs text-muted">Saved with the date in the reconciliation history. You can withdraw it later. No sale or amount is changed.</p>
      </div>
    </Dialog>
  );
}
