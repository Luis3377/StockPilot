import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { addItem, itemInputErrors, updateItem, type ItemInput } from '../../domain/actions';
import { isDomainError } from '../../domain/errors';
import { checkPrice, knownCategories, knownLocations } from '../../domain/calc';
import { todayISO } from '../../domain/dates';
import { formatPercent, multiplyMoney, parseMoneyInput } from '../../domain/money';
import type { Item } from '../../domain/types';
import { store, useAppState } from '../../data/store';
import { CONDITION_SUGGESTIONS, salesEnabled } from '../../lib/modes';
import { useMoney } from '../../lib/hooks';
import { Dialog } from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import { Checkbox, MoneyField, QuantityField, TextAreaField, TextField } from '../../ui/Fields';
import { PhotoPicker, forgetPhotos } from '../../ui/Photo';
import { useToast } from '../../ui/Toast';
import { plural } from '../../domain/format';
import { scannerEnabled } from '../../ai/config';
import { suggestionToFields, type ScanFillableField } from '../../ai/applySuggestion';
import type { ScanResult } from '../../ai/scanSchema';
import { ScanPanel } from './ScanPanel';

interface Props {
  open: boolean;
  itemId: string | null;
  /** Opened from "Scan with AI": highlight the scanner. */
  scan?: boolean;
  onClose: () => void;
}

type FormState = {
  name: string;
  sku: string;
  category: string;
  quantity: string;
  unitCost: string;
  askingPrice: string;
  estimatedValue: string;
  purchaseDate: string;
  condition: string;
  location: string;
  lowStockThreshold: string;
  notes: string;
  photoIds: string[];
};

const MORE_DETAIL_FIELDS = ['sku', 'purchaseDate', 'lowStockThreshold', 'condition', 'location', 'notes', 'estimatedValue', 'askingPrice'];

const moneyText = (n: number | null) => (n === null ? '' : String(n));

function initialState(item: Item | undefined, defaultThreshold: number | null): FormState {
  if (item) {
    return {
      name: item.name,
      sku: item.sku,
      category: item.category,
      quantity: String(item.quantity),
      unitCost: moneyText(item.unitCost),
      askingPrice: moneyText(item.askingPrice),
      estimatedValue: moneyText(item.estimatedValue),
      purchaseDate: item.purchaseDate ?? '',
      condition: item.condition,
      location: item.location,
      lowStockThreshold: item.lowStockThreshold === null ? '' : String(item.lowStockThreshold),
      notes: item.notes,
      photoIds: item.photoIds,
    };
  }
  return {
    name: '',
    sku: '',
    category: '',
    quantity: '1',
    unitCost: '',
    askingPrice: '',
    estimatedValue: '',
    purchaseDate: todayISO(),
    condition: '',
    location: '',
    lowStockThreshold: defaultThreshold === null ? '' : String(defaultThreshold),
    notes: '',
    photoIds: [],
  };
}

/** Small marker on fields the AI scanner filled; it goes away once the user edits the field. */
function AiLabel({ text, on }: { text: string; on: boolean }) {
  return (
    <>
      {text}
      {on && (
        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-md bg-demo-soft px-1.5 py-px align-middle text-[10px] font-semibold text-demo" data-testid="ai-filled">
          <Sparkles className="size-2.5" aria-hidden />
          AI<span className="sr-only"> suggested, check before saving</span>
        </span>
      )}
    </>
  );
}

export function ItemFormDialog({ open, itemId, scan = false, onClose }: Props) {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const toast = useToast();
  const { money, currency } = useMoney();
  const item = itemId ? data.items.find((i) => i.id === itemId) : undefined;
  const [form, setForm] = useState<FormState>(() => initialState(item, settings.defaultLowStockThreshold));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [showMore, setShowMore] = useState(Boolean(item));
  const [applyCostToSales, setApplyCostToSales] = useState(true);
  const [aiFilled, setAiFilled] = useState<ReadonlySet<ScanFillableField>>(new Set());
  const createdPhotos = useRef<string[]>([]);
  const saved = useRef(false);
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    if (open) {
      setForm(initialState(item, settings.defaultLowStockThreshold));
      setErrors({});
      setShowMore(Boolean(item));
      setApplyCostToSales(true);
      setAiFilled(new Set());
      createdPhotos.current = [];
      saved.current = false;
    }
    // Reset only when the dialog opens or switches item, not on every data change.
  }, [open, itemId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
    // Once the user edits an AI-filled field it's theirs: drop the marker, never overwrite it.
    if (aiFilled.has(key as ScanFillableField)) {
      setAiFilled((prev) => {
        const next = new Set(prev);
        next.delete(key as ScanFillableField);
        return next;
      });
    }
  };

  /** A scan photo becomes the item's cover photo, replacing an earlier scan photo. */
  const handleScanPhoto = (photoId: string, replacedId: string | null) => {
    createdPhotos.current = [...createdPhotos.current, photoId];
    setForm((f) => ({ ...f, photoIds: [photoId, ...f.photoIds.filter((p) => p !== photoId && p !== replacedId)] }));
    if (replacedId && createdPhotos.current.includes(replacedId)) {
      void store.deletePhotos([replacedId]);
      forgetPhotos([replacedId]);
      createdPhotos.current = createdPhotos.current.filter((p) => p !== replacedId);
    }
  };

  /** Fills name/category/condition/notes from a scan (replacing an earlier scan's). Never touches cost, quantity or prices. */
  const handleScanResult = (result: ScanResult): ScanFillableField[] => {
    const current = formRef.current;
    const fill = suggestionToFields(
      result,
      { name: current.name, category: current.category, condition: current.condition, notes: current.notes },
      aiFilled,
      knownCategories(data),
    );
    if (!fill.filled.length && !fill.cleared.length) return [];
    setForm((f) => ({ ...f, ...fill.values }));
    setErrors((e) => ({ ...e, ...Object.fromEntries(fill.filled.map((k) => [k, undefined])) }));
    setAiFilled((prev) => {
      const next = new Set(prev);
      for (const k of fill.cleared) next.delete(k);
      for (const k of fill.filled) next.add(k);
      return next;
    });
    if (fill.filled.includes('condition') || fill.filled.includes('notes')) setShowMore(true);
    return fill.filled;
  };

  const categories = useMemo(() => knownCategories(data), [data]);
  const locations = useMemo(() => knownLocations(data), [data]);
  const salesCount = item ? data.sales.filter((s) => s.itemId === item.id).length : 0;

  const qty = Number(form.quantity);
  const cost = parseMoneyInput(form.unitCost);
  const asking = parseMoneyInput(form.askingPrice);
  const costChanged = item && cost !== null && !Number.isNaN(cost) && cost !== item.unitCost;

  const close = () => {
    if (!saved.current && createdPhotos.current.length) {
      // Photos added to a form that was then cancelled.
      void store.deletePhotos(createdPhotos.current);
      forgetPhotos(createdPhotos.current);
    }
    onClose();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fieldErrors: Partial<Record<keyof FormState, string>> = {};
    const money = (key: 'unitCost' | 'askingPrice' | 'estimatedValue') => {
      const v = parseMoneyInput(form[key]);
      if (v !== null && Number.isNaN(v)) fieldErrors[key] = 'Enter an amount like 12.50';
      return v === null || Number.isNaN(v) ? null : v;
    };
    const wholeOrNull = (key: 'quantity' | 'lowStockThreshold') => {
      if (form[key].trim() === '') return null;
      const n = Number(form[key]);
      if (!Number.isInteger(n)) fieldErrors[key] = 'Enter a whole number';
      return n;
    };
    const input: ItemInput = {
      name: form.name,
      sku: form.sku,
      category: form.category,
      quantity: wholeOrNull('quantity'),
      unitCost: money('unitCost'),
      askingPrice: money('askingPrice'),
      estimatedValue: money('estimatedValue'),
      purchaseDate: form.purchaseDate || null,
      condition: form.condition,
      location: form.location,
      lowStockThreshold: wholeOrNull('lowStockThreshold'),
      notes: form.notes,
      photoIds: form.photoIds,
    };
    if (!form.name.trim()) fieldErrors.name = 'Give the item a name';
    if (form.unitCost.trim() === '' && !fieldErrors.unitCost) fieldErrors.unitCost = 'Enter what you paid per item (0 if it was free)';
    if (form.quantity.trim() === '') fieldErrors.quantity = 'Enter how many you have';
    // Show every problem after one submit: this form's own messages, plus the inventory's
    // rules (negative amounts, duplicate SKUs…) for the other fields.
    const allErrors = { ...itemInputErrors(data, input, item?.id ?? null), ...fieldErrors };
    if (Object.keys(allErrors).length) {
      showErrors(allErrors);
      return;
    }
    try {
      const result = item
        ? store.commit((d) => updateItem(d, item.id, input, { applyCostToSales: Boolean(costChanged && applyCostToSales) }))
        : store.commit((d) => addItem(d, input));
      saved.current = true;
      // Delete photos that were removed from the item.
      const before = new Set([...(item?.photoIds ?? []), ...createdPhotos.current]);
      const removed = [...before].filter((id) => !form.photoIds.includes(id));
      if (removed.length) {
        void store.deletePhotos(removed);
        forgetPhotos(removed);
      }
      toast.success(item ? `Saved changes to "${result.item.name}"` : `Added "${result.item.name}" to your inventory`);
      onClose();
    } catch (err) {
      if (isDomainError(err) && Object.keys(err.fields).length) showErrors(err.fields);
      else toast.error(isDomainError(err) ? err.message : 'The item could not be saved.');
    }
  };

  const showErrors = (errs: Partial<Record<string, string>>) => {
    setErrors(errs as Partial<Record<keyof FormState, string>>);
    // Open "More details" when an error is on a field that may be tucked away there.
    if (Object.keys(errs).some((f) => MORE_DETAIL_FIELDS.includes(f))) setShowMore(true);
  };

  const mode = settings.mode;
  const selling = salesEnabled(settings);
  const priceCheck =
    asking !== null && !Number.isNaN(asking) && cost !== null && !Number.isNaN(cost) && cost >= 0
      ? checkPrice(asking, cost, settings.lowMarginPercent)
      : null;
  const priceField = (
    <MoneyField
      key="asking"
      label={mode === 'business' ? 'Selling price (per item)' : 'Asking price (per item)'}
      hint={
        !priceCheck
          ? 'What you plan to sell one for'
          : priceCheck.status === 'loss'
            ? `You'd lose ${money(-priceCheck.profit)} on each one before fees.`
            : priceCheck.status === 'low'
              ? `Only ${money(priceCheck.profit)} profit per item before fees — a ${formatPercent(priceCheck.margin, 0)} margin, under your ${settings.lowMarginPercent}% target.`
              : `${money(priceCheck.profit)} profit per item before selling fees`
      }
      hintTone={priceCheck?.status === 'loss' ? 'bad' : priceCheck?.status === 'low' ? 'warn' : undefined}
      currency={currency}
      value={form.askingPrice}
      onChange={(v) => set('askingPrice', v)}
      error={errors.askingPrice}
    />
  );
  const valueField = (
    <MoneyField
      key="value"
      label="Est. market value (per item)"
      hint="Optional. Your own estimate of what one is worth today. Kept separate from your asking price."
      currency={currency}
      value={form.estimatedValue}
      onChange={(v) => set('estimatedValue', v)}
      error={errors.estimatedValue}
    />
  );
  const thresholdField = (
    <QuantityField
      key="threshold"
      label="Low-stock alert at"
      hint="Get an alert when quantity drops to this number. Leave blank for no alert."
      value={form.lowStockThreshold}
      onChange={(v) => set('lowStockThreshold', v)}
      error={errors.lowStockThreshold}
    />
  );

  const primaryExtras = mode === 'collector' ? [valueField, ...(selling ? [priceField] : [])] : mode === 'business' ? [priceField, thresholdField] : [priceField];
  const moreExtras = mode === 'collector' ? [...(selling ? [] : [priceField]), thresholdField] : mode === 'business' ? [valueField] : [valueField, thresholdField];

  return (
    <Dialog
      open={open}
      onClose={close}
      title={item ? 'Edit item' : 'Add an item'}
      description={item ? item.sku : 'Only the name, quantity and cost are required.'}
      size="lg"
      dismissOnBackdrop={false}
      testId="item-form"
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="item-form-el">
            {item ? 'Save changes' : 'Add item'}
          </Button>
        </>
      }
    >
      <form id="item-form-el" onSubmit={submit} noValidate className="space-y-4">
        {!item && scannerEnabled && <ScanPanel highlight={scan} onPhoto={handleScanPhoto} onResult={handleScanResult} />}
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">Photos</div>
          <PhotoPicker
            photoIds={form.photoIds}
            onChange={(ids) => set('photoIds', ids)}
            onCreated={(ids) => (createdPhotos.current = [...createdPhotos.current, ...ids])}
            onError={(m) => toast.error(m)}
          />
        </div>
        <TextField
          label={<AiLabel text="Item name" on={aiFilled.has('name')} />}
          required
          placeholder={mode === 'business' ? 'e.g. Soy candle — Lavender 8oz' : mode === 'collector' ? 'e.g. 1999 Pokémon Charizard Holo' : 'e.g. Nike Dunk Low Panda, size 10'}
          value={form.name}
          onChange={(v) => set('name', v)}
          error={errors.name}
          autoComplete="off"
          data-autofocus
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <QuantityField label="Quantity" required value={form.quantity} onChange={(v) => set('quantity', v)} error={errors.quantity} />
          <MoneyField
            label="Cost per item"
            required
            hint={
              cost !== null && !Number.isNaN(cost) && Number.isInteger(qty) && qty > 1
                ? `${money(multiplyMoney(cost, qty))} total for ${qty}`
                : 'What you paid for one'
            }
            currency={currency}
            value={form.unitCost}
            onChange={(v) => set('unitCost', v)}
            error={errors.unitCost}
          />
          {primaryExtras}
          <TextField label={<AiLabel text="Category" on={aiFilled.has('category')} />} placeholder="e.g. Sneakers" value={form.category} onChange={(v) => set('category', v)} suggestions={categories} error={errors.category} />
        </div>
        {costChanged && salesCount > 0 && (
          <div className="rounded-xl bg-warn-soft p-3">
            <Checkbox
              checked={applyCostToSales}
              onChange={setApplyCostToSales}
              label={`Also use this cost for ${plural(salesCount, 'recorded sale')}`}
              description="Keep this on if you're correcting a mistake. Turn it off to keep past profit calculated with the old cost."
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5 text-sm font-medium text-ink"
          aria-expanded={showMore}
        >
          More details
          <span className="flex items-center gap-1 text-xs font-normal text-ink-2">
            Condition, location, SKU, date, notes
            <ChevronDown className={`size-4 transition-transform ${showMore ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {showMore && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label={<AiLabel text="Condition" on={aiFilled.has('condition')} />} placeholder="e.g. New with box" value={form.condition} onChange={(v) => set('condition', v)} suggestions={CONDITION_SUGGESTIONS} error={errors.condition} />
            <TextField label="Storage location" placeholder="e.g. Closet shelf A" value={form.location} onChange={(v) => set('location', v)} suggestions={locations} error={errors.location} />
            <TextField label="SKU / ID" placeholder="Leave blank to create one" value={form.sku} onChange={(v) => set('sku', v)} error={errors.sku} autoComplete="off" />
            <TextField label="Purchase date" type="date" value={form.purchaseDate} onChange={(v) => set('purchaseDate', v)} error={errors.purchaseDate} max={todayISO()} />
            {moreExtras}
            <TextAreaField className="sm:col-span-2" label={<AiLabel text="Notes" on={aiFilled.has('notes')} />} value={form.notes} onChange={(v) => set('notes', v)} placeholder="Anything worth remembering" />
          </div>
        )}
      </form>
    </Dialog>
  );
}
