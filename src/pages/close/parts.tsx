// Shared pieces for Monthly Close: state badges, basis tags, the month picker and the dialogs
// for checklist decisions, finalizing and reopening a month.

import { useEffect, useState } from 'react';
import type { AppData, CloseStepKey } from '../../domain/types';
import { closeMonth, decideStep, reopenMonth } from '../../domain/close';
import { isDomainError } from '../../domain/errors';
import { localDate } from '../../domain/ledger';
import { todayISO } from '../../domain/dates';
import { currentClose, monthEnded, monthLabel, monthOf, shiftMonth } from '../../insights/monthly';
import type { Checklist, CloseStep, StepState } from '../../insights/closeChecklist';
import { store, useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { useToast } from '../../ui/Toast';
import { Badge, type Tone } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Checkbox, SelectField, TextAreaField } from '../../ui/Fields';

export const STATE_LABEL: Record<StepState, [string, Tone]> = {
  completed: ['Completed', 'good'],
  na: ['Not applicable', 'neutral'],
  attention: ['Needs attention', 'warn'],
  todo: ['To review', 'accent'],
};

export function StateBadge({ state }: { state: StepState }) {
  const [label, tone] = STATE_LABEL[state];
  return <Badge tone={tone}>{label}</Badge>;
}

/** Months with any record, newest first, up to the current month. */
export function monthOptions(data: AppData, today: string): string[] {
  const dates = [
    ...data.sales.map((s) => s.saleDate),
    ...data.items.map((i) => i.purchaseDate ?? localDate(i.createdAt)),
    ...data.adjustments.map((a) => localDate(a.date)),
    ...data.inventoryLedger.events.map((e) => e.date),
    ...data.monthlyClose.closes.map((c) => `${c.month}-01`),
  ].filter((d) => d <= today);
  const current = monthOf(today);
  const first = dates.length ? monthOf(dates.reduce((a, b) => (a < b ? a : b))) : current;
  const out: string[] = [];
  for (let m = current; m >= first && out.length < 120; m = shiftMonth(m, -1)) out.push(m);
  if (!out.includes(shiftMonth(current, -1)) && out.length < 2) out.push(shiftMonth(current, -1));
  return out;
}

/** The month to open by default: the latest one that has ended and isn't closed, else the current one. */
export function defaultMonth(data: AppData, today: string): string {
  return monthOptions(data, today).find((m) => monthEnded(m, today) && !currentClose(data, m)) ?? monthOf(today);
}

export function MonthPicker({ value, onChange, months }: { value: string; onChange: (m: string) => void; months: string[] }) {
  const data = useAppState((s) => s.data);
  const today = todayISO();
  return (
    <SelectField label="Month" value={value} onChange={onChange} className="sm:w-72" data-testid="close-month">
      {months.map((m) => {
        const c = currentClose(data, m);
        return (
          <option key={m} value={m}>
            {monthLabel(m)}
            {c ? ` · closed` : monthEnded(m, today) ? '' : ' · in progress'}
          </option>
        );
      })}
    </SelectField>
  );
}

/** "Not applicable" (with an explanation) or "Acknowledge" (with a note) for one step. */
export function DecisionDialog({ month, step, kind, onClose }: { month: string; step: CloseStep | null; kind: 'na' | 'acknowledged'; onClose: () => void }) {
  const settings = useAppState((s) => s.settings);
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setNote(step && kind === 'na' ? step.naExplanation : '');
    setError('');
  }, [step, kind]);
  if (!step) return null;
  const attention = step.issues.filter((i) => i.severity === 'attention');
  const save = () => {
    try {
      store.update((d) => decideStep(d, settings, month, step.step as CloseStepKey, kind, note, todayISO()));
      toast.success(kind === 'na' ? 'Marked not applicable.' : 'Issues acknowledged.');
      onClose();
    } catch (e) {
      if (!isDomainError(e)) throw e;
      setError(e.message);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={kind === 'na' ? `Not applicable: ${step.title}` : `Acknowledge open issues: ${step.title}`}
      description={kind === 'na' ? 'Say why this step doesn’t apply to the month. The explanation is kept with the close.' : 'These issues stay open and are recorded with the close. Say why they can wait (for example, what you’ll do next month).'}
      testId="decision-dialog"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} data-testid="decision-save">
            {kind === 'na' ? 'Mark not applicable' : 'Acknowledge'}
          </Button>
        </div>
      }
    >
      {kind === 'acknowledged' && (
        <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-ink-2">
          {attention.map((i) => (
            <li key={i.id}>{i.text}</li>
          ))}
        </ul>
      )}
      <TextAreaField label={kind === 'na' ? 'Explanation' : 'Note'} value={note} onChange={setNote} rows={3} error={error} maxLength={1000} data-testid="decision-note" />
    </Dialog>
  );
}

export function FinalizeDialog({ list, open, onClose }: { list: Checklist; open: boolean; onClose: () => void }) {
  const settings = useAppState((s) => s.settings);
  const { money } = useMoney();
  const toast = useToast();
  const [ack, setAck] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setAck(false);
      setNote('');
      setError('');
    }
  }, [open]);
  const t = list.figures.totals;
  const save = () => {
    try {
      store.commit((d) => closeMonth(d, settings, list.month, { acknowledged: ack, note }, todayISO()));
      toast.success(`${list.label} is closed. Its figures and report are kept as they are now.`);
      onClose();
    } catch (e) {
      if (!isDomainError(e)) throw e;
      setError(e.message);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Finalize ${list.label}`}
      description="Closing keeps this month’s figures, checklist, roll-forward and Controller’s Report exactly as they are now. Afterwards, any change that would alter the month’s figures is refused until you reopen it."
      testId="finalize-dialog"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={list.unresolved.length > 0 && !ack} data-testid="close-confirm">
            Finalize month
          </Button>
        </div>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-2">Revenue</dt>
        <dd className="tabular text-right">{money(t.revenue)}</dd>
        <dt className="text-ink-2">Realized profit</dt>
        <dd className="tabular text-right">{money(t.netProfit)}</dd>
        <dt className="text-ink-2">Ending inventory cost</dt>
        <dd className="tabular text-right">{list.figures.rollForward.recordsEnding === null ? 'Not available' : money(list.figures.rollForward.recordsEnding)}</dd>
      </dl>
      {list.unresolved.length > 0 && (
        <div className="mt-4 rounded-xl bg-warn-soft p-3" data-testid="finalize-unresolved">
          <p className="text-sm font-medium text-warn-text">{list.unresolved.length === 1 ? '1 issue is' : `${list.unresolved.length} issues are`} still open and will be recorded with the close:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-warn-text">
            {list.unresolved.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
          <div className="mt-3">
            <Checkbox checked={ack} onChange={setAck} label="I’ve reviewed these open issues and want to close the month with them on record." />
          </div>
        </div>
      )}
      <TextAreaField className="mt-3" label="Closing note (optional)" value={note} onChange={setNote} rows={2} maxLength={1000} />
      {error && (
        <p className="mt-2 text-sm text-bad-text" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export function ReopenDialog({ month, open, onClose }: { month: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setReason('');
      setError('');
    }
  }, [open]);
  const save = () => {
    try {
      store.update((d) => reopenMonth(d, month, reason));
      toast.success(`${monthLabel(month)} is open for corrections. Run the checklist again before closing it.`);
      onClose();
    } catch (e) {
      if (!isDomainError(e)) throw e;
      setError(e.message);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Reopen ${monthLabel(month)}`}
      description="The current close is kept and marked superseded, with your reason, in the month’s history. The month can then be corrected, and the checklist must be completed again before it’s closed."
      testId="reopen-dialog"
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} data-testid="reopen-confirm">
            Reopen month
          </Button>
        </div>
      }
    >
      <TextAreaField label="Why are you reopening it?" required value={reason} onChange={setReason} rows={3} error={error} maxLength={1000} data-testid="reopen-reason" />
    </Dialog>
  );
}
