import { useEffect, useState, type FormEvent } from 'react';
import { adjustQuantity, restockItem } from '../../domain/actions';
import { isDomainError } from '../../domain/errors';
import { fromCents, multiplyMoney, parseMoneyInput, toCents } from '../../domain/money';
import { store, useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { MoneyField, QuantityField, SelectField, TextField } from '../../ui/Fields';
import { useToast } from '../../ui/Toast';

export type StockMode = 'restock' | 'adjust';

const REASONS = ['Damaged', 'Lost', 'Stolen', 'Found extra', 'Returned to stock', 'Used personally', 'Correction', 'Other'];

interface Props {
  open: boolean;
  itemId: string | null;
  mode: StockMode;
  onClose: () => void;
}

/** Restock (adds units at a cost, averaging the unit cost) or adjust (sets quantity with a reason). */
export function StockDialog({ open, itemId, mode, onClose }: Props) {
  const item = useAppState((s) => s.data.items.find((i) => i.id === itemId));
  const toast = useToast();
  const { money, currency } = useMoney();
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && item) {
      setQty(mode === 'restock' ? '1' : String(item.quantity));
      setCost(String(item.unitCost));
      setReason(REASONS[0]);
      setNote('');
      setErrors({});
    }
  }, [open, itemId, mode]);

  if (!item) return null;

  const n = Number(qty);
  const c = parseMoneyInput(cost);
  const newAvg =
    mode === 'restock' && Number.isInteger(n) && n > 0 && c !== null && !Number.isNaN(c)
      ? fromCents(toCents(multiplyMoney(item.unitCost, item.quantity)) + toCents(multiplyMoney(c, n))) / (item.quantity + n)
      : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    try {
      if (mode === 'restock') {
        if (c !== null && Number.isNaN(c)) {
          setErrors({ restockCost: 'Enter an amount like 12.50' });
          return;
        }
        store.commit((d) => restockItem(d, item.id, qty.trim() === '' ? Number.NaN : n, c));
        toast.success(`Added ${n} to "${item.name}"`);
      } else {
        const why = reason === 'Other' ? note : note.trim() ? `${reason} — ${note.trim()}` : reason;
        store.commit((d) => adjustQuantity(d, item.id, qty.trim() === '' ? Number.NaN : n, why));
        toast.success(`Quantity of "${item.name}" set to ${n}`);
      }
      onClose();
    } catch (err) {
      if (isDomainError(err) && err.field) setErrors({ [err.field]: err.message });
      else toast.error(isDomainError(err) ? err.message : 'Could not update the quantity.');
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mode === 'restock' ? 'Add stock' : 'Adjust quantity'}
      description={item.name}
      size="sm"
      testId="stock-dialog"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="stock-form">
            {mode === 'restock' ? 'Add stock' : 'Save quantity'}
          </Button>
        </>
      }
    >
      <form id="stock-form" onSubmit={submit} noValidate className="space-y-4">
        {mode === 'restock' ? (
          <>
            <QuantityField label="How many are you adding?" min={1} value={qty} onChange={setQty} error={errors.restockQuantity} hint={`Currently ${item.quantity} on hand`} />
            <MoneyField label="Cost per item for this batch" currency={currency} value={cost} onChange={setCost} error={errors.restockCost} />
            {newAvg !== null && Math.abs(newAvg - item.unitCost) > 0.00005 && (
              <p className="rounded-xl bg-surface-2 p-3 text-sm text-ink-2">
                Your cost per item becomes the average of old and new stock: <strong className="text-ink">{money(newAvg)}</strong> (was {money(item.unitCost)}).
              </p>
            )}
          </>
        ) : (
          <>
            <QuantityField label="Quantity you actually have" value={qty} onChange={setQty} error={errors.newQuantity} hint={`Recorded: ${item.quantity}`} />
            <SelectField label="Reason" value={reason} onChange={setReason}>
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </SelectField>
            <TextField label={reason === 'Other' ? 'Describe the reason' : 'Note (optional)'} value={note} onChange={setNote} error={errors.reason} required={reason === 'Other'} />
            <p className="text-xs text-muted">Adjustments are kept in the item’s history and in Count Check reports. Use “Record a sale” for items you sold.</p>
          </>
        )}
      </form>
    </Dialog>
  );
}
