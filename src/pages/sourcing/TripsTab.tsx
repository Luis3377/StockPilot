// Sourcing trips: a Saturday of garage sales, a Goodwill run, a pallet pickup. A trip groups the
// items and lots bought on it (no new purchases are created), its expenses, and its time.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { sessionStats } from '../../insights/sourcing';
import { createSession, updateSession, type SessionInput } from '../../domain/sourcing';
import { formatDate, todayISO } from '../../domain/dates';
import { isDomainError } from '../../domain/errors';
import { newId } from '../../domain/ids';
import type { SharedSplit, SourcingSession } from '../../domain/types';
import { store, useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { Card, SectionHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button, IconButton } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { MoneyField, SelectField, TextAreaField, TextField } from '../../ui/Fields';
import { useToast } from '../../ui/Toast';
import { readMoney } from '../lots/LotParts';
import { Figures, hoursText, pctText } from './parts';

export function TripsTab() {
  const data = useAppState((s) => s.data);
  const { money } = useMoney();
  const [creating, setCreating] = useState(false);
  const stats = data.sourcing.sessions.map((s) => sessionStats(data, s)).sort((a, b) => b.session.date.localeCompare(a.session.date));
  const best = stats.filter((s) => s.completed && s.roiPct !== null).sort((a, b) => b.roiPct! - a.roiPct!);
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-2">Group what you bought on one outing to see what the trip earned. Linking items or lots to a trip never adds a purchase.</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)} data-testid="trip-new">
          New trip
        </Button>
      </div>
      {best.length > 0 && (
        <Card className="mb-4 p-4 sm:p-5" data-testid="trips-best">
          <SectionHeader title="Best completed trips" description="Everything bought on them has sold or been written off. By return: (net proceeds − cost − trip expenses) ÷ (cost + trip expenses)." />
          <ol className="mt-2 space-y-1 text-sm">
            {best.slice(0, 5).map((s) => (
              <li key={s.session.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <Link to={`/insights/sourcing/trips/${s.session.id}`} className="text-accent-text hover:underline">
                  {s.session.name}
                </Link>
                <span className="tabular text-ink-2">
                  {money(s.result)} · {pctText(s.roiPct)}
                  {s.unitsSold < 5 && ' · small sample'}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}
      {stats.length === 0 ? (
        <Card className="p-5 text-sm text-ink-2">No trips yet.</Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2" data-testid="trip-list">
          {stats.map((s) => (
            <li key={s.session.id}>
              <Card className="p-4" data-testid="trip-card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link to={`/insights/sourcing/trips/${s.session.id}`} className="font-semibold break-words text-accent-text hover:underline">
                      {s.session.name}
                    </Link>
                    <p className="text-xs text-muted">
                      {formatDate(s.session.date)} · {s.sources.map((r) => r.name).join(', ') || 'No source yet'}
                    </p>
                  </div>
                  <Badge tone={s.completed ? 'good' : s.purchases.length ? 'accent' : 'neutral'}>{s.completed ? 'Completed' : s.purchases.length ? 'Still selling' : 'Nothing linked'}</Badge>
                </div>
                <Figures
                  className="mt-3"
                  rows={[
                    ['Bought', `${money(s.acquisitionCost)} · ${s.unitsBought} units`],
                    ['Trip expenses', money(s.tripExpenses)],
                    ['Realized profit', money(s.realizedProfit), s.realizedProfit < 0 ? 'text-bad-text' : undefined],
                    [s.completed ? 'Result' : 'Result so far', money(s.result), s.result < 0 ? 'text-bad-text' : undefined],
                    ['Return', pctText(s.roiPct)],
                    ['Time', s.hours ? `${hoursText(s.hours)} · ${money(s.profitPerHour!)}/h` : 'Not enough time data'],
                  ]}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}
      <TripDialog session={null} open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

export function TripDialog({ session, open, onClose }: { session: SourcingSession | null; open: boolean; onClose: () => void }) {
  const data = useAppState((s) => s.data);
  const { currency } = useMoney();
  const toast = useToast();
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayISO());
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [expenses, setExpenses] = useState<{ id: string; label: string; amount: string; kind: 'acquisition' | 'operating' }[]>([]);
  const [split, setSplit] = useState<SharedSplit | ''>('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setName(session?.name ?? '');
    setDate(session?.date ?? todayISO());
    setSourceIds(session?.sourceIds ?? []);
    setNotes(session?.notes ?? '');
    setExpenses(session?.expenses.map((e) => ({ id: e.id, label: e.label, amount: String(e.amount), kind: e.kind })) ?? []);
    setSplit(session?.split ?? '');
    setErrors({});
  }, [open, session]);
  const save = () => {
    const typed: Record<string, string> = {};
    const input: SessionInput = {
      name,
      date,
      sourceIds,
      notes,
      split: split || null,
      expenses: expenses.map((e, i) => {
        const r = readMoney(e.amount);
        if (r.error) typed[`expense.${i}.amount`] = r.error;
        return { id: e.id, label: e.label, amount: r.value, kind: e.kind };
      }),
    };
    if (Object.keys(typed).length) return setErrors(typed);
    try {
      const r = store.commit((d) => (session ? updateSession(d, session.id, input) : createSession(d, input)));
      toast.success(session ? 'Trip saved.' : `Added the trip “${r.session.name}”.`);
      onClose();
    } catch (e) {
      if (!isDomainError(e)) throw e;
      setErrors(Object.keys(e.fields).length ? e.fields : { form: e.message });
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={session ? 'Edit trip' : 'New sourcing trip'}
      dismissOnBackdrop={false}
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} data-testid="trip-save">
            Save trip
          </Button>
        </div>
      }
      testId="trip-dialog"
    >
      <div className="space-y-3">
        {errors.form && (
          <p className="text-sm text-bad-text" role="alert">
            {errors.form}
          </p>
        )}
        <TextField label="Trip name" required value={name} onChange={setName} error={errors.name} placeholder="e.g. Saturday garage sales" maxLength={120} />
        <TextField label="Date" type="date" value={date} onChange={setDate} error={errors.date} />
        <fieldset>
          <legend className="text-sm font-medium text-ink">Sources visited</legend>
          {data.sourcing.sources.length === 0 ? (
            <p className="mt-1 text-xs text-muted">Add sources on the Sources tab (or when adding an item) to pick them here.</p>
          ) : (
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {data.sourcing.sources.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" className="size-4 accent-accent" checked={sourceIds.includes(s.id)} onChange={(e) => setSourceIds(e.target.checked ? [...sourceIds, s.id] : sourceIds.filter((x) => x !== s.id))} />
                  {s.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
        {sourceIds.length > 1 && (
          <SelectField
            label="Divide the trip’s time and expenses between its sources"
            value={split}
            onChange={(v) => setSplit(v as SharedSplit | '')}
            hint="Until you choose, they count in your totals but not toward any one source."
            data-testid="trip-split"
          >
            <option value="">Don’t divide</option>
            <option value="equal">Equally</option>
            <option value="by_cost">By what you spent at each</option>
          </SelectField>
        )}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">Trip expenses (optional)</legend>
          <p className="text-xs text-muted">
            Entry fees, fuel, parking: costs of the trip that aren’t part of any item’s price. They’re shown with the trip and aren’t added to item costs (put buying costs like a buyer’s premium
            on the lot instead).
          </p>
          {expenses.map((e, i) => (
            <div key={e.id} className="flex flex-wrap items-start gap-2" data-testid="trip-expense">
              <TextField className="min-w-0 flex-1" label={<span className="sr-only">Expense {i + 1}</span>} value={e.label} onChange={(v) => setExpenses(expenses.map((x, n) => (n === i ? { ...x, label: v } : x)))} placeholder="e.g. Fuel" />
              <MoneyField className="w-28" label={<span className="sr-only">Expense {i + 1} amount</span>} currency={currency} value={e.amount} onChange={(v) => setExpenses(expenses.map((x, n) => (n === i ? { ...x, amount: v } : x)))} error={errors[`expense.${i}.amount`]} />
              <SelectField className="w-40" label={<span className="sr-only">Expense {i + 1} kind</span>} value={e.kind} onChange={(v) => setExpenses(expenses.map((x, n) => (n === i ? { ...x, kind: v as 'acquisition' | 'operating' } : x)))}>
                <option value="operating">Running cost</option>
                <option value="acquisition">Buying cost</option>
              </SelectField>
              <IconButton label={`Remove expense ${i + 1}`} onClick={() => setExpenses(expenses.filter((_, n) => n !== i))}>
                <X className="size-4" />
              </IconButton>
            </div>
          ))}
          {expenses.length < 20 && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setExpenses([...expenses, { id: newId(), label: '', amount: '', kind: 'operating' }])} data-testid="trip-add-expense">
              Add an expense
            </Button>
          )}
        </fieldset>
        <TextAreaField label="Notes (optional)" value={notes} onChange={setNotes} rows={2} />
      </div>
    </Dialog>
  );
}
