// "Add bulk lot": record several items bought together for one price, and split that price
// across them. Three steps: the purchase, the items, then a review of the split.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ChevronDown, Info, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { createLot, lotInputErrors, METHOD_LABELS, previewLot, type Allocation, type LotInput } from '../../domain/lots';
import { recordBidPurchase } from '../../domain/bids';
import { knownCategories } from '../../domain/calc';
import { todayISO } from '../../domain/dates';
import { formatPercent, fromCents, toCents } from '../../domain/money';
import { plural } from '../../domain/format';
import { newId } from '../../domain/ids';
import type { LotAllocationMethod } from '../../domain/types';
import { isDomainError } from '../../domain/errors';
import { store, useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { CONDITION_SUGGESTIONS } from '../../lib/modes';
import { scannerEnabled } from '../../ai/config';
import { suggestionToFields, type ScanFillableField } from '../../ai/applySuggestion';
import type { ScanResult } from '../../ai/scanSchema';
import { Dialog } from '../../ui/Dialog';
import { Button, IconButton } from '../../ui/Button';
import { MoneyField, QuantityField, TextAreaField, TextField } from '../../ui/Fields';
import { ItemThumb, forgetPhotos } from '../../ui/Photo';
import { useRadioGroup } from '../../ui/useRadioGroup';
import { useToast } from '../../ui/Toast';
import { cn } from '../../ui/cn';
import { ScanPanel } from './ScanPanel';
import { EXTRA_COST_SUGGESTIONS, moneyInputText, readMoney, readWhole, Row, SplitCheck, UnitCost } from '../lots/LotParts';

interface LineDraft {
  key: string;
  name: string;
  quantity: string;
  estimate: string;
  category: string;
  condition: string;
  notes: string;
  photoIds: string[];
  aiFilled: ScanFillableField[];
  showMore: boolean;
  scanOpen: boolean;
  /** The Max Bid plan item this line came from, if any. */
  bidItemId: string | null;
}

interface Draft {
  name: string;
  purchasePrice: string;
  extraCosts: { key: string; label: string; amount: string }[];
  purchaseDate: string;
  source: string;
  notes: string;
  method: LotAllocationMethod;
  lines: LineDraft[];
}

const newLine = (): LineDraft => ({
  key: newId(),
  name: '',
  quantity: '1',
  estimate: '',
  category: '',
  condition: '',
  notes: '',
  photoIds: [],
  aiFilled: [],
  showMore: false,
  scanOpen: false,
  bidItemId: null,
});

/** Starting a lot from a Max Bid plan: what was paid, the plan's items and estimates. */
export interface BidLotPrefill {
  planId: string;
  planName: string;
  input: LotInput;
  lineBidItemIds: (string | null)[];
}

function draftFromPrefill(p: BidLotPrefill): Draft {
  const { input } = p;
  return {
    name: input.name,
    purchasePrice: moneyInputText(input.purchasePrice),
    extraCosts: input.extraCosts.map((c) => ({ key: newId(), label: c.label, amount: moneyInputText(c.amount) })),
    purchaseDate: input.purchaseDate ?? todayISO(),
    source: input.source,
    notes: input.notes,
    method: input.method,
    lines: input.lines.length
      ? input.lines.map((l, i) => ({
          ...newLine(),
          name: l.name,
          quantity: l.quantity === null ? '' : String(l.quantity),
          estimate: moneyInputText(l.estimatedUnitValue),
          category: l.category ?? '',
          condition: l.condition ?? '',
          notes: l.notes ?? '',
          showMore: Boolean(l.category || l.condition || l.notes),
          bidItemId: p.lineBidItemIds[i] ?? null,
        }))
      : [newLine()],
  };
}

const emptyDraft = (): Draft => ({
  name: '',
  purchasePrice: '',
  extraCosts: [],
  purchaseDate: todayISO(),
  source: '',
  notes: '',
  method: 'relative_value',
  lines: [newLine()],
});

const STEPS = ['Purchase', 'Items', 'Review split'] as const;
const STEP1_FIELDS = /^(name|purchasePrice|purchaseDate|source|notes|extraCosts|extra\.)/;

/** Turns the typed draft into a LotInput, plus "that isn't a number" problems found on the way. */
function toInput(d: Draft): { input: LotInput; typing: Record<string, string> } {
  const typing: Record<string, string> = {};
  const money = (text: string, key: string) => {
    const r = readMoney(text);
    if (r.error) typing[key] = r.error;
    return r.value;
  };
  const whole = (text: string, key: string) => {
    const r = readWhole(text);
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
      lines: d.lines.map((l, i) => ({
        name: l.name,
        quantity: whole(l.quantity, `line.${i}.quantity`),
        estimatedUnitValue: money(l.estimate, `line.${i}.estimate`),
        category: l.category,
        condition: l.condition,
        notes: l.notes,
        photoIds: l.photoIds,
      })),
    },
    typing,
  };
}

export function LotFormDialog({ open, onClose, fromBid = null }: { open: boolean; onClose: () => void; fromBid?: BidLotPrefill | null }) {
  const data = useAppState((s) => s.data);
  const { money, currency } = useMoney();
  const toast = useToast();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const createdPhotos = useRef<string[]>([]);
  const saved = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const bodyTop = useRef<HTMLDivElement>(null);

  // Start fresh whenever the dialog opens or closes, so reopening never shows the last lot.
  // (Unsaved scan photos were already discarded by close().)
  useEffect(() => {
    setDraft(fromBid ? draftFromPrefill(fromBid) : emptyDraft());
    setStep(0);
    setErrors({});
    createdPhotos.current = [];
    saved.current = false;
  }, [open, fromBid]);

  const categories = useMemo(() => knownCategories(data), [data]);
  const sources = useMemo(() => [...new Set(data.lots.map((l) => l.source).filter(Boolean))].sort(), [data.lots]);

  const { input, typing } = toInput(draft);
  const totalCents = toCents(input.purchasePrice ?? 0) + input.extraCosts.reduce((c, x) => c + toCents(x.amount ?? 0), 0);
  // The review step re-splits live as estimates change, and shows why when it can't.
  let preview: Allocation | null = null;
  let live: Record<string, string> = {};
  if (step === 2) {
    try {
      if (Object.keys(typing).length) live = typing;
      else preview = previewLot(input);
    } catch (e) {
      if (!isDomainError(e)) throw e;
      live = Object.keys(e.fields).length ? e.fields : { form: e.message };
    }
  }
  const reviewError = (key: string) => errors[key] ?? live[key];
  const splitProblem = errors.method ?? live.method ?? (Object.keys(live).some((k) => k.startsWith('line.')) ? 'Some items need an estimated resale value before the cost can be split by value.' : null);

  const clearError = (...keys: string[]) => {
    if (keys.some((k) => errors[k])) setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !keys.includes(k))));
  };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    clearError(key);
  };
  const setLine = (i: number, patch: Partial<LineDraft>, field?: string) => {
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l, n) => {
        if (n !== i) return l;
        // Once the user edits an AI-filled field, it's theirs.
        const aiFilled = field ? l.aiFilled.filter((f) => f !== field) : l.aiFilled;
        return { ...l, ...patch, aiFilled };
      }),
    }));
    if (field) clearError(`line.${i}.${field === 'estimate' ? 'estimate' : field}`, 'lines', 'method');
  };

  const discardPhotos = (ids: string[]) => {
    const mine = ids.filter((id) => createdPhotos.current.includes(id));
    if (!mine.length) return;
    void store.deletePhotos(mine);
    forgetPhotos(mine);
    createdPhotos.current = createdPhotos.current.filter((id) => !mine.includes(id));
  };

  const close = () => {
    if (!saved.current) discardPhotos(createdPhotos.current);
    onClose();
  };

  const removeLine = (i: number) => {
    discardPhotos(draft.lines[i].photoIds);
    setDraft((d) => ({ ...d, lines: d.lines.filter((_, n) => n !== i) }));
    setErrors({});
  };

  const handleScanPhoto = (i: number) => (photoId: string, replacedId: string | null) => {
    createdPhotos.current = [...createdPhotos.current, photoId];
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l, n) => (n === i ? { ...l, photoIds: [photoId, ...l.photoIds.filter((p) => p !== photoId && p !== replacedId)] } : l)),
    }));
    if (replacedId) discardPhotos([replacedId]);
  };

  /** Fills name/category/condition/notes from a scan. Never quantity or any price. */
  const handleScanResult = (i: number) => (result: ScanResult): ScanFillableField[] => {
    const line = draftRef.current.lines[i];
    if (!line) return [];
    const fill = suggestionToFields(result, { name: line.name, category: line.category, condition: line.condition, notes: line.notes }, new Set(line.aiFilled), categories);
    if (!fill.filled.length && !fill.cleared.length) return [];
    setDraft((d) => ({
      ...d,
      lines: d.lines.map((l, n) =>
        n === i
          ? {
              ...l,
              ...fill.values,
              aiFilled: [...l.aiFilled.filter((f) => !fill.cleared.includes(f) && !fill.filled.includes(f)), ...fill.filled],
              showMore: l.showMore || fill.filled.includes('condition') || fill.filled.includes('notes'),
            }
          : l,
      ),
    }));
    clearError(...fill.filled.map((f) => `line.${i}.${f}`));
    return fill.filled;
  };

  const errorsFor = (which: number): Record<string, string> => {
    if (which === 0) {
      const all = { ...lotInputErrors(input), ...typing };
      return Object.fromEntries(Object.entries(all).filter(([k]) => STEP1_FIELDS.test(k)));
    }
    if (which === 1) {
      // Estimates are optional until the split method is chosen on the next step.
      const all = { ...lotInputErrors({ ...input, method: 'equal' }), ...typing };
      return Object.fromEntries(Object.entries(all).filter(([k]) => k === 'lines' || k.startsWith('line.')));
    }
    return { ...lotInputErrors(input), ...typing };
  };

  const goTo = (next: number) => {
    setStep(next);
    setErrors({});
    bodyTop.current?.scrollIntoView({ block: 'start' });
  };

  const next = () => {
    const found = errorsFor(step);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    goTo(step + 1);
  };

  const save = () => {
    const found = errorsFor(2);
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    try {
      // From a Max Bid plan, the lot and the plan's "purchased" record are saved together, and
      // a plan that was already recorded is refused, so the purchase can't be added twice.
      const r = fromBid
        ? store.commit((d) => recordBidPurchase(d, fromBid.planId, input, draft.lines.map((l) => l.bidItemId)))
        : store.commit((d) => createLot(d, input));
      saved.current = true;
      toast.success(`Saved “${r.lot.name}” and added ${plural(r.items.length, 'item')} to inventory.${fromBid ? ' The plan’s original estimate is kept for comparison.' : ''}`);
      onClose();
      navigate(`/inventory/lots/${r.lot.id}`);
    } catch (e) {
      if (!isDomainError(e)) throw e;
      setErrors(Object.keys(e.fields).length ? e.fields : { form: e.message });
    }
  };

  const footer = (
    <div className="flex w-full flex-wrap items-center justify-between gap-2">
      {step > 0 ? (
        <Button icon={<ArrowLeft className="size-4" />} onClick={() => goTo(step - 1)}>
          Back
        </Button>
      ) : (
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
      )}
      {step < 2 ? (
        <Button variant="primary" onClick={next} data-testid="lot-next">
          Next: {STEPS[step + 1]} <ArrowRight className="size-4" />
        </Button>
      ) : (
        <Button variant="primary" onClick={save} disabled={!preview} data-testid="lot-save">
          Save lot & add {plural(draft.lines.length, 'item')}
        </Button>
      )}
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={close}
      title={fromBid ? 'Record the purchase' : 'Add bulk lot'}
      description={fromBid ? 'Add the lot you bought to your inventory, with its cost split across the items.' : 'Bought several items for one price? Split what you paid across them.'}
      size="lg"
      footer={footer}
      dismissOnBackdrop={false}
      testId="lot-dialog"
    >
      <div ref={bodyTop} />
      {fromBid && (
        <p className="mb-3 flex items-start gap-1.5 rounded-xl bg-accent-soft/60 p-3 text-sm text-ink" data-testid="lot-from-bid">
          <Info className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
          <span>
            Started from your Max Bid plan “{fromBid.planName}”. Check what you actually paid, the costs and the items. Nothing is added to your inventory until you save, and the plan’s original
            estimate stays as it was.
          </span>
        </p>
      )}
      <ol className="mb-4 flex gap-1.5 text-xs" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className={cn('flex-1 rounded-full px-2 py-1 text-center font-medium', i === step ? 'bg-accent text-accent-ink' : i < step ? 'bg-accent-soft text-accent-text' : 'bg-surface-2 text-muted')}
          >
            <span className="sr-only">Step {i + 1} of 3: </span>
            {s}
          </li>
        ))}
      </ol>
      {errors.form && (
        <p className="mb-3 rounded-xl bg-bad-soft p-3 text-sm text-bad-text" role="alert">
          {errors.form}
        </p>
      )}

      {step === 0 && (
        <div className="space-y-4" data-testid="lot-step-purchase">
          <TextField label="Lot name" required value={draft.name} onChange={(v) => set('name', v)} error={errors.name} placeholder="e.g. Estate sale box" maxLength={120} data-autofocus />
          <MoneyField
            label="Total purchase price"
            required
            currency={currency}
            value={draft.purchasePrice}
            onChange={(v) => set('purchasePrice', v)}
            error={errors.purchasePrice}
            hint="What you paid for the whole lot"
          />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink">Additional costs (optional)</legend>
            <p className="text-xs text-muted">Shipping, buyer’s premium, fees: anything you paid to get this lot. They become part of its cost, not an expense.</p>
            {draft.extraCosts.map((c, i) => (
              <div key={c.key} className="flex items-start gap-2" data-testid="lot-extra-cost">
                <TextField
                  label={<span className="sr-only">Cost {i + 1} name</span>}
                  className="min-w-0 flex-1"
                  value={c.label}
                  placeholder="e.g. Shipping / freight"
                  suggestions={EXTRA_COST_SUGGESTIONS}
                  onChange={(v) => set('extraCosts', draft.extraCosts.map((x, n) => (n === i ? { ...x, label: v } : x)))}
                  error={errors[`extra.${i}.label`]}
                />
                <MoneyField
                  label={<span className="sr-only">Cost {i + 1} amount</span>}
                  className="w-32 shrink-0"
                  currency={currency}
                  value={c.amount}
                  onChange={(v) => {
                    set('extraCosts', draft.extraCosts.map((x, n) => (n === i ? { ...x, amount: v } : x)));
                    clearError(`extra.${i}.amount`);
                  }}
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
          </fieldset>
          <div className="rounded-2xl bg-surface-2 p-3" data-testid="lot-total">
            <Row label="Purchase price" value={money(input.purchasePrice ?? 0)} />
            {input.extraCosts.map((c, i) => (
              <Row key={draft.extraCosts[i].key} label={c.label.trim() || 'Additional cost'} value={`+ ${money(c.amount ?? 0)}`} />
            ))}
            <Row label="Total cost to split across the items" value={money(fromCents(totalCents))} strong className="border-t border-line pt-2" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Purchase date" type="date" value={draft.purchaseDate} onChange={(v) => set('purchaseDate', v)} error={errors.purchaseDate} />
            <TextField label="Where you bought it" value={draft.source} onChange={(v) => set('source', v)} error={errors.source} placeholder="Auction, estate sale…" suggestions={sources} maxLength={120} />
          </div>
          <TextAreaField label="Notes (optional)" value={draft.notes} onChange={(v) => set('notes', v)} error={errors.notes} rows={2} />
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3" data-testid="lot-step-items">
          <p className="text-sm text-ink-2">
            Add each kind of item in the lot. For each one, enter how many and what you think <strong className="text-ink">one</strong> would sell for. Estimates decide each item’s share of
            the {money(fromCents(totalCents))}; you can change them on the next step.
          </p>
          {errors.lines && (
            <p className="text-sm text-bad-text" role="alert">
              {errors.lines}
            </p>
          )}
          {draft.lines.map((line, i) => (
            <fieldset key={line.key} className="rounded-2xl border border-line p-3 sm:p-4" data-testid="lot-line">
              <legend className="sr-only">Item {i + 1}</legend>
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {line.photoIds[0] && <ItemThumb photoId={line.photoIds[0]} name={line.name || `Item ${i + 1}`} className="size-9 shrink-0 rounded-lg" />}
                  <span className="text-sm font-semibold text-ink">Item {i + 1}</span>
                </div>
                <div className="flex items-center gap-1">
                  {scannerEnabled && (
                    <Button size="sm" variant="soft" icon={<Sparkles className="size-3.5" />} onClick={() => setLine(i, { scanOpen: !line.scanOpen })} aria-expanded={line.scanOpen}>
                      {line.scanOpen ? 'Hide scanner' : 'Scan with AI'}
                    </Button>
                  )}
                  {draft.lines.length > 1 && (
                    <IconButton label={`Remove item ${i + 1}`} size="sm" onClick={() => removeLine(i)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  )}
                </div>
              </div>
              {line.scanOpen && scannerEnabled && (
                <div className="mt-3 space-y-2">
                  <ScanPanel highlight onPhoto={handleScanPhoto(i)} onResult={handleScanResult(i)} />
                  <p className="flex items-start gap-1.5 text-xs text-ink-2" data-testid="lot-scan-price-note">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    The scanner identifies the item. It doesn’t estimate prices: enter your own resale estimate below.
                  </p>
                </div>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_8rem]">
                <TextField
                  label={
                    <>
                      Item name
                      {line.aiFilled.includes('name') && (
                        <span className="ml-1.5 rounded-md bg-demo-soft px-1.5 py-px text-[10px] font-semibold text-demo" data-testid="ai-filled">
                          AI<span className="sr-only"> suggested, check before saving</span>
                        </span>
                      )}
                    </>
                  }
                  required
                  value={line.name}
                  onChange={(v) => setLine(i, { name: v }, 'name')}
                  error={errors[`line.${i}.name`]}
                  maxLength={200}
                />
                <QuantityField label="Quantity" min={1} value={line.quantity} onChange={(v) => setLine(i, { quantity: v }, 'quantity')} error={errors[`line.${i}.quantity`]} />
              </div>
              <MoneyField
                className="mt-3"
                label="Est. resale value, per item"
                currency={currency}
                value={line.estimate}
                onChange={(v) => setLine(i, { estimate: v }, 'estimate')}
                error={errors[`line.${i}.estimate`]}
                hint="Your own estimate of what one sells for. Leave empty to split the cost equally."
              />
              <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-text" onClick={() => setLine(i, { showMore: !line.showMore })} aria-expanded={line.showMore}>
                {line.showMore ? 'Fewer details' : 'Category, condition, notes'}
                <ChevronDown className={cn('size-3.5 transition-transform', line.showMore && 'rotate-180')} />
              </button>
              {line.showMore && (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  <TextField label="Category" value={line.category} onChange={(v) => setLine(i, { category: v }, 'category')} suggestions={categories} error={errors[`line.${i}.category`]} />
                  <TextField label="Condition" value={line.condition} onChange={(v) => setLine(i, { condition: v }, 'condition')} suggestions={CONDITION_SUGGESTIONS} error={errors[`line.${i}.condition`]} />
                  <TextAreaField className="sm:col-span-2" label="Notes" value={line.notes} onChange={(v) => setLine(i, { notes: v }, 'notes')} rows={2} error={errors[`line.${i}.notes`]} />
                </div>
              )}
            </fieldset>
          ))}
          {draft.lines.length < 200 && (
            <Button icon={<Plus className="size-4" />} onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, newLine()] }))} data-testid="lot-add-line">
              Add another item
            </Button>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4" data-testid="lot-step-review">
          <MethodChoice value={draft.method} onChange={(m) => set('method', m)} />
          {draft.method === 'relative_value' ? (
            <p className="text-sm text-ink-2">
              Each item’s share = total cost × (its estimated resale value ÷ all items’ estimated resale value). Items you expect to sell for more carry more of the cost.
            </p>
          ) : (
            <p className="text-sm text-ink-2">Every unit gets the same share of the cost, whatever it might sell for.</p>
          )}
          {splitProblem && (
            <div className="rounded-xl bg-bad-soft p-3 text-sm text-bad-text" role="alert" data-testid="lot-split-problem">
              <p>{splitProblem}</p>
              {draft.method === 'relative_value' && (
                <Button size="sm" className="mt-2" onClick={() => set('method', 'equal')}>
                  Split equally instead
                </Button>
              )}
            </div>
          )}
          <ul className="space-y-2" data-testid="lot-review-lines">
            {draft.lines.map((line, i) => {
              const share = preview?.lines[i];
              return (
                <li key={line.key} className="rounded-2xl border border-line p-3" data-testid="lot-review-line">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 font-medium break-words text-ink">
                      {line.name || `Item ${i + 1}`} <span className="text-sm font-normal text-muted">× {line.quantity}</span>
                    </span>
                    {share && (
                      <span className="tabular text-sm text-ink-2">
                        {formatPercent(share.share * 100)} of the cost
                      </span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-[10rem_1fr_1fr] sm:items-end">
                    <MoneyField
                      className="col-span-2 sm:col-span-1"
                      label="Est. resale / item"
                      currency={currency}
                      value={line.estimate}
                      onChange={(v) => setLine(i, { estimate: v }, 'estimate')}
                      error={reviewError(`line.${i}.estimate`)}
                      data-testid="lot-review-estimate"
                    />
                    <div className="text-sm">
                      <div className="text-xs text-muted">Allocated cost</div>
                      <div className="tabular font-semibold text-ink" data-testid="lot-line-cost">
                        {share ? money(share.allocatedCost) : '—'}
                      </div>
                    </div>
                    <div className="text-sm">
                      <div className="text-xs text-muted">Cost per item</div>
                      <div className="tabular text-ink" data-testid="lot-unit-cost">
                        {share ? <UnitCost total={share.allocatedCost} quantity={share.quantity} /> : '—'}
                      </div>
                    </div>
                  </div>
                  {share && draft.method === 'relative_value' && share.estimatedUnitValue === 0 && (
                    <p className="mt-2 text-xs text-warn-text">Estimated at 0, so it carries none of the cost. Enter an estimate if it’s worth something.</p>
                  )}
                </li>
              );
            })}
          </ul>
          {preview && (
            <>
              <SplitCheck allocated={preview.allocatedTotal} total={preview.total} />
              <div className="rounded-2xl bg-surface-2 p-3" data-testid="lot-review-totals">
                <Row label="Total cost (purchase + additional costs)" value={money(preview.total)} />
                <Row label="Estimated resale value (your estimates)" value={preview.linesWithoutEstimate ? `${money(preview.estimatedTotal)} (some items not estimated)` : money(preview.estimatedTotal)} />
                <Row
                  label="Potential gross profit, before selling expenses"
                  value={preview.linesWithoutEstimate ? 'Add every estimate to see this' : money(preview.estimatedTotal - preview.total)}
                  strong
                  testId="lot-potential-profit"
                />
                <p className="mt-1 text-xs text-muted">A projection from your own estimates, not money earned. Marketplace fees and shipping will come out of it.</p>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

function MethodChoice({ value, onChange }: { value: LotAllocationMethod; onChange: (m: LotAllocationMethod) => void }) {
  const values = ['relative_value', 'equal'] as const;
  const radio = useRadioGroup(values, value, onChange);
  const hints: Record<LotAllocationMethod, string> = {
    relative_value: 'Recommended. Uses your resale estimates.',
    equal: 'For when items are similar, or you can’t estimate them.',
  };
  return (
    <div role="radiogroup" aria-label="How to split the cost" className="grid gap-2 sm:grid-cols-2">
      {values.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          {...radio(m)}
          onClick={() => onChange(m)}
          className={cn('rounded-2xl border p-3 text-left', value === m ? 'border-accent bg-accent-soft/50' : 'border-line hover:bg-surface-2')}
        >
          <span className="block text-sm font-semibold text-ink">{METHOD_LABELS[m]}</span>
          <span className="mt-0.5 block text-xs text-ink-2">{hints[m]}</span>
        </button>
      ))}
    </div>
  );
}

export { MethodChoice };
