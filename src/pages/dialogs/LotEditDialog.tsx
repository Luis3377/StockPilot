// Edit a bulk lot. Changes that move costs show exactly what happens to unsold items and ask
// for confirmation first; completed sales always keep the cost they were recorded with.

import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, ShieldCheck, X } from 'lucide-react';
import { applyLotEdit, lotEditErrors, lotTotal, planLotEdit, type LotEditInput, type LotEditPlan } from '../../domain/lots';
import { toCents } from '../../domain/money';
import { plural } from '../../domain/format';
import { newId } from '../../domain/ids';
import { isDomainError } from '../../domain/errors';
import type { Lot, LotAllocationMethod } from '../../domain/types';
import { store, useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { Dialog } from '../../ui/Dialog';
import { Button, IconButton } from '../../ui/Button';
import { MoneyField, TextAreaField, TextField } from '../../ui/Fields';
import { useToast } from '../../ui/Toast';
import { EXTRA_COST_SUGGESTIONS, moneyInputText, readMoney, Row } from '../lots/LotParts';
import { MethodChoice } from './LotFormDialog';

interface EditDraft {
  name: string;
  purchasePrice: string;
  extraCosts: { key: string; label: string; amount: string }[];
  purchaseDate: string;
  source: string;
  notes: string;
  method: LotAllocationMethod;
  estimates: Record<string, string>;
}

const draftOf = (lot: Lot): EditDraft => ({
  name: lot.name,
  purchasePrice: moneyInputText(lot.purchasePrice),
  extraCosts: lot.extraCosts.map((c) => ({ key: c.id, label: c.label, amount: moneyInputText(c.amount) })),
  purchaseDate: lot.purchaseDate ?? '',
  source: lot.source,
  notes: lot.notes,
  method: lot.method,
  estimates: Object.fromEntries(lot.lines.map((l) => [l.id, moneyInputText(l.estimatedUnitValue)])),
});

function toEditInput(d: EditDraft): { input: LotEditInput; typing: Record<string, string> } {
  const typing: Record<string, string> = {};
  const money = (text: string, key: string) => {
    const r = readMoney(text);
    if (r.error) typing[key] = r.error;
    return r.value;
  };
  return {
    input: {
      name: d.name,
      purchasePrice: money(d.purchasePrice, 'purchasePrice'),
      extraCosts: d.extraCosts.map((c, i) => ({ label: c.label, amount: money(c.amount, `extra.${i}.amount`) })),
      purchaseDate: d.purchaseDate || null,
      source: d.source,
      notes: d.notes,
      method: d.method,
      estimates: Object.fromEntries(Object.entries(d.estimates).map(([id, text], i) => [id, money(text, `estimate:${id}:${i}`)])),
    },
    typing,
  };
}

export function LotEditDialog({ open, lotId, onClose }: { open: boolean; lotId: string | null; onClose: () => void }) {
  const data = useAppState((s) => s.data);
  const lot = lotId ? data.lots.find((l) => l.id === lotId) : undefined;
  const { money, currency } = useMoney();
  const toast = useToast();
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<LotEditPlan | null>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open && lot) {
      setDraft(draftOf(lot));
      setErrors({});
      setPlan(null);
      setReason('');
    } else if (!open) {
      // Forget the last edit, so reopening never shows (or saves) stale values.
      setDraft(null);
      setPlan(null);
    }
    // Reset when the dialog opens or closes, not on every data change.
  }, [open, lotId]);

  if (!open || !lot || !draft) return null;

  const lineIndex = new Map(lot.lines.map((l, i) => [l.id, i]));
  const set = <K extends keyof EditDraft>(key: K, value: EditDraft[K]) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
    setErrors({});
  };

  // Typing errors for estimates use the same keys the domain uses (line.<index>.estimate).
  const normalise = (typing: Record<string, string>) =>
    Object.fromEntries(Object.entries(typing).map(([k, v]) => (k.startsWith('estimate:') ? [`line.${lineIndex.get(k.split(':')[1])}.estimate`, v] : [k, v])));

  const review = () => {
    const { input, typing } = toEditInput(draft);
    const found = { ...lotEditErrors(data, lot.id, input), ...normalise(typing) };
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    const p = planLotEdit(data, lot.id, input);
    if (p.changedFields.length === 0) {
      toast.info('Nothing has changed.');
      onClose();
      return;
    }
    if (p.costChange) setPlan(p);
    else apply();
  };

  const apply = () => {
    const { input } = toEditInput(draft);
    try {
      const r = store.commit((d) => applyLotEdit(d, lot.id, input, reason));
      toast.success(r.plan.costChange ? `Updated the cost of ${plural(r.plan.lines.filter((l) => l.newUnitCost !== l.previousUnitCost).length, 'unsold item')}.` : 'Lot updated.');
      onClose();
    } catch (e) {
      if (!isDomainError(e)) throw e;
      setPlan(null);
      setErrors(Object.keys(e.fields).length ? e.fields : { form: e.message });
    }
  };

  if (plan) {
    return (
      <Dialog
        open
        onClose={onClose}
        title="Confirm cost change"
        description="Check what changes before anything is saved."
        size="lg"
        dismissOnBackdrop={false}
        testId="lot-confirm"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button icon={<ArrowLeft className="size-4" />} onClick={() => setPlan(null)}>
              Back to editing
            </Button>
            <Button variant="primary" onClick={apply} data-testid="lot-confirm-apply">
              Confirm and update costs
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-2xl bg-surface-2 p-3">
            <Row label="Lot total cost" value={`${money(plan.previousTotal)} → ${money(plan.newTotal)}`} strong testId="lot-confirm-total" />
            <Row label="Cost still in unsold items" value={`${money(plan.remainingBefore)} → ${money(plan.remainingAfter)}`} />
            <Row label="Cost already in completed sales or written off" value={`${money(plan.lockedCost)} (unchanged)`} testId="lot-confirm-locked" />
          </div>
          <p className="flex items-start gap-2 rounded-2xl bg-good-soft p-3 text-sm text-good-text">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            Completed sales keep the cost they were recorded with, so past profit doesn’t change.{' '}
            {plan.mode === 'redistribute'
              ? 'The cost still in stock is re-split across the unsold items using the new estimates and method.'
              : 'The change is shared across the unsold items in proportion to their estimated value.'}
          </p>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Unsold items</h3>
            <ul className="divide-y divide-line rounded-2xl border border-line" data-testid="lot-confirm-lines">
              {plan.lines.map((l) => (
                <li key={l.lineId} className="p-3 text-sm" data-testid="lot-confirm-line">
                  <div className="font-medium break-words text-ink">
                    {l.itemName} <span className="font-normal text-muted">· {plural(l.unitsAffected, 'unit')} in stock</span>
                  </div>
                  <div className="mt-1 grid grid-cols-1 gap-1 text-ink-2 sm:grid-cols-2">
                    <span>
                      Cost per item: <span className="tabular text-ink">{money(l.previousUnitCost)} → {money(l.newUnitCost)}</span>
                    </span>
                    <span>
                      Inventory cost: <span className="tabular text-ink">{money(l.previousRemainingCost)} → {money(l.newRemainingCost)}</span>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <TextField label="Reason (optional)" value={reason} onChange={setReason} placeholder="e.g. Invoice included freight" maxLength={500} hint="Saved in the lot’s history." />
        </div>
      </Dialog>
    );
  }

  const onHand = (lineId: string) => {
    const line = lot.lines.find((l) => l.id === lineId)!;
    return data.items.find((i) => i.id === line.itemId)?.quantity ?? 0;
  };
  const { input } = toEditInput(draft);
  const newTotal = toCents(input.purchasePrice ?? 0) + input.extraCosts.reduce((c, x) => c + toCents(x.amount ?? 0), 0);

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit lot"
      description={`${plural(lot.lines.length, 'item')} · ${money(lotTotal(lot))} total cost`}
      size="lg"
      dismissOnBackdrop={false}
      testId="lot-edit"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={review} data-testid="lot-edit-save">
            Review changes
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {errors.form && (
          <p className="rounded-xl bg-bad-soft p-3 text-sm text-bad-text" role="alert">
            {errors.form}
          </p>
        )}
        <TextField label="Lot name" required value={draft.name} onChange={(v) => set('name', v)} error={errors.name} maxLength={120} />
        <MoneyField label="Total purchase price" required currency={currency} value={draft.purchasePrice} onChange={(v) => set('purchasePrice', v)} error={errors.purchasePrice} />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">Additional costs</legend>
          {draft.extraCosts.map((c, i) => (
            <div key={c.key} className="flex items-start gap-2">
              <TextField
                label={<span className="sr-only">Cost {i + 1} name</span>}
                className="min-w-0 flex-1"
                value={c.label}
                suggestions={EXTRA_COST_SUGGESTIONS}
                onChange={(v) => set('extraCosts', draft.extraCosts.map((x, n) => (n === i ? { ...x, label: v } : x)))}
                error={errors[`extra.${i}.label`]}
              />
              <MoneyField
                label={<span className="sr-only">Cost {i + 1} amount</span>}
                className="w-32 shrink-0"
                currency={currency}
                value={c.amount}
                onChange={(v) => set('extraCosts', draft.extraCosts.map((x, n) => (n === i ? { ...x, amount: v } : x)))}
                error={errors[`extra.${i}.amount`]}
              />
              <IconButton label={`Remove cost ${i + 1}`} className="mt-0.5" onClick={() => set('extraCosts', draft.extraCosts.filter((_, n) => n !== i))}>
                <X className="size-4" />
              </IconButton>
            </div>
          ))}
          {draft.extraCosts.length < 10 && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => set('extraCosts', [...draft.extraCosts, { key: newId(), label: '', amount: '' }])}>
              Add a cost
            </Button>
          )}
          <p className="text-sm text-ink-2">
            New total cost: <strong className="tabular text-ink">{money(newTotal / 100)}</strong>
          </p>
        </fieldset>
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">How the cost is split</div>
          <MethodChoice value={draft.method} onChange={(m) => set('method', m)} />
          {errors.method && <p className="mt-1.5 text-xs font-medium text-bad-text">{errors.method}</p>}
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">Est. resale value per item</legend>
          <p className="text-xs text-muted">Changing an estimate re-splits only the cost still in unsold items.</p>
          {lot.lines.map((line, i) => (
            <MoneyField
              key={line.id}
              label={
                <span className="break-words">
                  {data.items.find((x) => x.id === line.itemId)?.name ?? line.itemName}{' '}
                  <span className="font-normal text-muted">· {plural(onHand(line.id), 'unit')} in stock</span>
                </span>
              }
              currency={currency}
              value={draft.estimates[line.id] ?? ''}
              onChange={(v) => set('estimates', { ...draft.estimates, [line.id]: v })}
              error={errors[`line.${i}.estimate`]}
            />
          ))}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Purchase date" type="date" value={draft.purchaseDate} onChange={(v) => set('purchaseDate', v)} error={errors.purchaseDate} />
          <TextField label="Where you bought it" value={draft.source} onChange={(v) => set('source', v)} error={errors.source} maxLength={120} />
        </div>
        <TextAreaField label="Notes" value={draft.notes} onChange={(v) => set('notes', v)} rows={2} error={errors.notes} />
      </div>
    </Dialog>
  );
}
