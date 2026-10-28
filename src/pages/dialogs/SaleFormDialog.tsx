import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { recordSale, updateSale, type SaleInput } from '../../domain/actions';
import { computeSale, knownPlatforms, uniqueSorted } from '../../domain/calc';
import { isDomainError } from '../../domain/errors';
import { todayISO } from '../../domain/dates';
import { formatPercent, parseMoneyInput, roundMoney } from '../../domain/money';
import type { PriceMode, Sale } from '../../domain/types';
import { store, useAppState } from '../../data/store';
import { PLATFORM_SUGGESTIONS } from '../../lib/modes';
import { useMoney } from '../../lib/hooks';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { MoneyField, QuantityField, Segmented, SelectField, TextAreaField, TextField } from '../../ui/Fields';
import { EmptyState } from '../../ui/EmptyState';
import { useToast } from '../../ui/Toast';
import { cn } from '../../ui/cn';

interface Props {
  open: boolean;
  itemId: string | null;
  saleId: string | null;
  onClose: () => void;
  onAddItem: () => void;
}

interface FormState {
  itemId: string;
  quantity: string;
  salePrice: string;
  priceMode: PriceMode;
  platform: string;
  fees: string;
  feeMode: 'amount' | 'percent';
  shipping: string;
  otherExpenses: string;
  saleDate: string;
  notes: string;
}

const text = (n: number) => (n === 0 ? '' : String(n));

function initial(sale: Sale | undefined, itemId: string | null, askingPrice: number | null): FormState {
  if (sale) {
    return {
      itemId: sale.itemId,
      quantity: String(sale.quantity),
      salePrice: String(sale.salePrice),
      priceMode: sale.priceMode,
      platform: sale.platform,
      fees: text(sale.fees),
      feeMode: 'amount',
      shipping: text(sale.shipping),
      otherExpenses: text(sale.otherExpenses),
      saleDate: sale.saleDate,
      notes: sale.notes,
    };
  }
  return {
    itemId: itemId ?? '',
    quantity: '1',
    salePrice: askingPrice === null ? '' : String(askingPrice),
    priceMode: 'per_unit',
    platform: '',
    fees: '',
    feeMode: 'amount',
    shipping: '',
    otherExpenses: '',
    saleDate: todayISO(),
    notes: '',
  };
}

const num = (s: string) => {
  const v = parseMoneyInput(s);
  return v === null || Number.isNaN(v) ? 0 : v;
};

export function SaleFormDialog({ open, itemId, saleId, onClose, onAddItem }: Props) {
  const data = useAppState((s) => s.data);
  const toast = useToast();
  const { money, currency } = useMoney();
  const sale = saleId ? data.sales.find((s) => s.id === saleId) : undefined;
  const presetItem = itemId ? data.items.find((i) => i.id === itemId) : undefined;
  const [form, setForm] = useState<FormState>(() => initial(sale, itemId, presetItem?.askingPrice ?? null));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [priceTouched, setPriceTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initial(sale, itemId, presetItem?.askingPrice ?? null));
      setErrors({});
      setPriceTouched(Boolean(sale));
    }
  }, [open, saleId, itemId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const sellable = useMemo(
    () =>
      data.items
        .filter((i) => i.quantity > 0 || i.id === sale?.itemId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data.items, sale?.itemId],
  );
  const platforms = useMemo(() => uniqueSorted([...knownPlatforms(data), ...PLATFORM_SUGGESTIONS]), [data]);

  const item = data.items.find((i) => i.id === form.itemId);
  const itemDeleted = sale && !data.items.some((i) => i.id === sale.itemId) && form.itemId === sale.itemId;
  const available = (item?.quantity ?? 0) + (sale && sale.itemId === form.itemId ? sale.quantity : 0);
  const qty = Number(form.quantity) || 0;
  const unitCost = sale && sale.itemId === form.itemId ? sale.unitCost : (item?.unitCost ?? 0);
  const revenueForFees = form.priceMode === 'per_unit' ? num(form.salePrice) * qty : num(form.salePrice);
  const feeAmount = form.feeMode === 'percent' ? roundMoney((revenueForFees * num(form.fees)) / 100) : num(form.fees);
  const preview = computeSale({
    quantity: qty,
    salePrice: num(form.salePrice),
    priceMode: form.priceMode,
    unitCost,
    fees: feeAmount,
    shipping: num(form.shipping),
    otherExpenses: num(form.otherExpenses),
  });

  const chooseItem = (id: string) => {
    set('itemId', id);
    const next = data.items.find((i) => i.id === id);
    if (!priceTouched && next?.askingPrice != null) set('salePrice', String(next.askingPrice));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fieldErrors: Partial<Record<keyof FormState, string>> = {};
    const moneyOrNull = (key: 'salePrice' | 'fees' | 'shipping' | 'otherExpenses', required = false) => {
      const v = parseMoneyInput(form[key]);
      if (v === null) {
        if (required) fieldErrors[key] = 'Enter the sale price';
        return required ? null : 0;
      }
      if (Number.isNaN(v)) fieldErrors[key] = 'Enter an amount like 12.50';
      return Number.isNaN(v) ? null : v;
    };
    const salePrice = moneyOrNull('salePrice', true);
    const feesRaw = moneyOrNull('fees');
    if (form.feeMode === 'percent' && feesRaw !== null && feesRaw >= 100) fieldErrors.fees = 'Fees must be under 100%';
    if (!form.itemId) fieldErrors.itemId = 'Choose the item you sold';
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      return;
    }
    const input: SaleInput = {
      itemId: form.itemId,
      quantity: form.quantity.trim() === '' ? null : Number(form.quantity),
      salePrice,
      priceMode: form.priceMode,
      platform: form.platform,
      fees: feesRaw === null ? null : form.feeMode === 'percent' ? feeAmount : feesRaw,
      shipping: moneyOrNull('shipping'),
      otherExpenses: moneyOrNull('otherExpenses'),
      saleDate: form.saleDate,
      notes: form.notes,
    };
    try {
      const result = sale ? store.commit((d) => updateSale(d, sale.id, input)) : store.commit((d) => recordSale(d, input));
      const f = computeSale(result.sale);
      toast.success(
        sale
          ? `Sale updated · ${money(f.netProfit)} net profit`
          : `Sale recorded · ${money(f.netProfit)} net profit. ${result.sale.quantity} removed from stock.`,
      );
      onClose();
    } catch (err) {
      if (isDomainError(err) && err.field) setErrors({ [err.field]: err.message });
      else toast.error(isDomainError(err) ? err.message : 'The sale could not be saved.');
    }
  };

  const nothingToSell = !sale && sellable.length === 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={sale ? 'Edit sale' : 'Record a sale'}
      description={sale ? 'Stock and profit update automatically when you save.' : 'Stock goes down automatically when you save.'}
      size="lg"
      dismissOnBackdrop={false}
      testId="sale-form"
      footer={
        nothingToSell ? (
          <Button onClick={onClose}>Close</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="sale-form-el">
              {sale ? 'Save changes' : 'Record sale'}
            </Button>
          </>
        )
      }
    >
      {nothingToSell ? (
        <EmptyState
          title="Nothing in stock to sell"
          actions={
            <Button variant="primary" onClick={onAddItem}>
              Add an item
            </Button>
          }
        >
          A sale is recorded against an item in your inventory. Add the item first (or restock one that’s sold out).
        </EmptyState>
      ) : (
        <form id="sale-form-el" onSubmit={submit} noValidate className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_260px]">
          <div className="space-y-4">
            <SelectField label="Item sold" required value={form.itemId} onChange={chooseItem} error={errors.itemId}>
              <option value="">Choose an item…</option>
              {itemDeleted && sale && <option value={sale.itemId}>{sale.itemName} (deleted item)</option>}
              {sellable.map((i) => {
                const avail = i.quantity + (sale && sale.itemId === i.id ? sale.quantity : 0);
                return (
                  <option key={i.id} value={i.id}>
                    {i.name} — {avail} available
                  </option>
                );
              })}
            </SelectField>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <QuantityField
                label="Quantity sold"
                required
                min={1}
                max={itemDeleted ? undefined : Math.max(1, available)}
                value={form.quantity}
                onChange={(v) => set('quantity', v)}
                error={errors.quantity}
                hint={item ? `${available} available` : undefined}
              />
              <div>
                <MoneyField
                  label="Sale price"
                  required
                  currency={currency}
                  value={form.salePrice}
                  onChange={(v) => {
                    setPriceTouched(true);
                    set('salePrice', v);
                  }}
                  error={errors.salePrice}
                />
                {qty > 1 && (
                  <Segmented
                    className="mt-2 w-full"
                    size="sm"
                    label="Price is"
                    value={form.priceMode}
                    onChange={(v) => set('priceMode', v)}
                    options={[
                      { value: 'per_unit', label: 'Per item' },
                      { value: 'total', label: `Total for ${qty}` },
                    ]}
                  />
                )}
              </div>
            </div>
            <TextField label="Where did it sell?" placeholder="e.g. eBay" value={form.platform} onChange={(v) => set('platform', v)} suggestions={platforms} error={errors.platform} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                {form.feeMode === 'amount' ? (
                  <MoneyField label="Marketplace fees" hint="Total fees for this sale" currency={currency} value={form.fees} onChange={(v) => set('fees', v)} error={errors.fees} />
                ) : (
                  <TextField
                    label="Marketplace fees (%)"
                    inputMode="decimal"
                    hint={`= ${money(feeAmount)} of ${money(revenueForFees)}`}
                    value={form.fees}
                    onChange={(v) => set('fees', v)}
                    error={errors.fees}
                    placeholder="e.g. 13.25"
                  />
                )}
                <Segmented
                  className="mt-2 w-full"
                  size="sm"
                  label="Enter fees as"
                  value={form.feeMode}
                  onChange={(v) => {
                    set('feeMode', v);
                    set('fees', '');
                  }}
                  options={[
                    { value: 'amount', label: 'Amount' },
                    { value: 'percent', label: '% of sale' },
                  ]}
                />
              </div>
              <MoneyField label="Shipping you paid" hint="Leave blank if the buyer paid" currency={currency} value={form.shipping} onChange={(v) => set('shipping', v)} error={errors.shipping} />
              <MoneyField label="Other expenses" hint="Packaging, promotion, etc." currency={currency} value={form.otherExpenses} onChange={(v) => set('otherExpenses', v)} error={errors.otherExpenses} />
              <TextField label="Sale date" type="date" required value={form.saleDate} onChange={(v) => set('saleDate', v)} error={errors.saleDate} />
            </div>
            <TextAreaField label="Notes" value={form.notes} onChange={(v) => set('notes', v)} placeholder="Buyer, order number…" />
          </div>

          <aside className="h-fit rounded-2xl bg-surface-2 p-4 md:sticky md:top-0" aria-live="polite" data-testid="sale-preview">
            <div className="mb-3 text-sm font-semibold text-ink">Profit on this sale</div>
            <dl className="tabular space-y-1.5 text-sm">
              <Row label="Revenue" value={money(preview.revenue)} />
              <Row label="Cost of goods" value={`− ${money(preview.costOfGoods)}`} hint={`${qty} × ${money(unitCost)}`} />
              <Row label="Fees" value={`− ${money(preview.fees)}`} />
              <Row label="Shipping" value={`− ${money(preview.shipping)}`} />
              <Row label="Other" value={`− ${money(preview.otherExpenses)}`} />
            </dl>
            <div className="my-3 border-t border-line-strong" />
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-ink">Net profit</span>
              <span className={cn('text-xl font-semibold', preview.netProfit < 0 ? 'text-bad-text' : 'text-good-text')} data-testid="sale-preview-profit">
                {money(preview.netProfit)}
              </span>
            </div>
            <div className="mt-2 flex justify-between text-xs text-ink-2">
              <span>Margin {formatPercent(preview.margin)}</span>
              <span>ROI {formatPercent(preview.roi)}</span>
            </div>
            {preview.netProfit < 0 && preview.revenue > 0 && (
              <p className="mt-3 flex gap-1.5 text-xs text-bad-text">
                <AlertTriangle className="size-4 shrink-0" /> This sale loses money after costs.
              </p>
            )}
          </aside>
        </form>
      )}
    </Dialog>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-ink-2">
        {label}
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
