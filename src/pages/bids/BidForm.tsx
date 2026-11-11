// The Max Bid form: the lot, your resale estimates, selling costs, buying costs, your goal and the
// three scenarios. Every assumption is shown and editable; amounts say whether they're per item
// or for the whole lot, and percentages say what they're a percentage of.

import { useEffect, useRef } from 'react';
import { ChevronDown, Info, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { DEFAULT_SCENARIOS, KIND_LABELS, SCENARIO_KEYS, SCENARIO_LABELS } from '../../domain/bids';
import { fromCents, toCents } from '../../domain/money';
import { newId } from '../../domain/ids';
import type { BidLotKind, BidScenarioKey } from '../../domain/types';
import { useMoney } from '../../lib/hooks';
import { CONDITION_SUGGESTIONS } from '../../lib/modes';
import { scannerEnabled } from '../../ai/config';
import { suggestionToFields, type ScanFillableField } from '../../ai/applySuggestion';
import type { ScanResult } from '../../ai/scanSchema';
import { store } from '../../data/store';
import { Card, SectionHeader } from '../../ui/Card';
import { Button, IconButton } from '../../ui/Button';
import { MoneyField, PercentField, QuantityField, SelectField, TextAreaField, TextField } from '../../ui/Fields';
import { forgetPhotos } from '../../ui/Photo';
import { useRadioGroup } from '../../ui/useRadioGroup';
import { cn } from '../../ui/cn';
import { ScanPanel } from '../dialogs/ScanPanel';
import { readMoney, readWhole } from '../lots/LotParts';
import { newBidItem, scenarioDrafts, type BidDraft, type BidItemDraft, type ScenarioDraft } from './bidDraft';

interface Props {
  draft: BidDraft;
  onChange: (update: (d: BidDraft) => BidDraft, clear?: string[]) => void;
  errors: Record<string, string>;
  categories: string[];
  /** A recorded decision: the assumptions are shown but can't be edited. */
  locked: boolean;
}

export function BidForm({ draft, onChange, errors, categories, locked }: Props) {
  const { money, currency } = useMoney();
  const set = <K extends keyof BidDraft>(key: K, value: BidDraft[K], clear: string[] = [key]) => onChange((d) => ({ ...d, [key]: value }), clear);
  const setScenario = (k: BidScenarioKey, field: keyof ScenarioDraft, value: string) =>
    onChange((d) => ({ ...d, scenarios: { ...d.scenarios, [k]: { ...d.scenarios[k], [field]: value } } }), [`scenario.${k}.${field}`]);
  const setItem = (i: number, patch: Partial<BidItemDraft>, field?: string) =>
    onChange(
      (d) => ({
        ...d,
        items: d.items.map((it, n) => (n === i ? { ...it, ...patch, aiFields: field ? it.aiFields.filter((f) => f !== field) : it.aiFields } : it)),
      }),
      field ? [`item.${i}.${field}`, 'items'] : [],
    );

  // Scan photos only help identify an item: plans don't keep them.
  const scanPhotos = useRef<string[]>([]);
  const dropPhotos = (ids: string[]) => {
    if (!ids.length) return;
    void store.deletePhotos(ids);
    forgetPhotos(ids);
    scanPhotos.current = scanPhotos.current.filter((id) => !ids.includes(id));
  };
  useEffect(
    () => () => {
      if (scanPhotos.current.length) {
        void store.deletePhotos(scanPhotos.current);
        forgetPhotos(scanPhotos.current);
      }
    },
    [],
  );

  const handleScanResult = (i: number) => (result: ScanResult): ScanFillableField[] => {
    const it = draft.items[i];
    if (!it) return [];
    const fill = suggestionToFields(result, { name: it.name, category: it.category, condition: it.condition, notes: it.notes }, new Set(it.aiFields as ScanFillableField[]), categories);
    onChange(
      (d) => ({
        ...d,
        items: d.items.map((x, n) =>
          n === i
            ? {
                ...x,
                ...fill.values,
                aiFields: [...x.aiFields.filter((f) => !fill.cleared.includes(f as ScanFillableField) && !fill.filled.includes(f as ScanFillableField)), ...fill.filled],
                showMore: x.showMore || fill.filled.includes('condition') || fill.filled.includes('notes'),
              }
            : x,
        ),
      }),
      fill.filled.map((f) => `item.${i}.${f}`),
    );
    return fill.filled;
  };

  const itemsTotal = draft.items.reduce((c, it) => {
    const v = readMoney(it.unitValue).value;
    const q = readWhole(it.quantity).value;
    return v !== null && q !== null && Number.isInteger(q) && q > 0 ? c + toCents(v) * q : c;
  }, 0);

  return (
    <fieldset disabled={locked} className="min-w-0 space-y-4" data-testid="bid-form">
      <legend className="sr-only">Assumptions</legend>

      <Card className="p-4 sm:p-5">
        <SectionHeader title="The lot" />
        <div className="mt-3 space-y-3">
          <TextField label="Lot name" required value={draft.name} onChange={(v) => set('name', v)} error={errors.name} placeholder="e.g. Storage unit B-14" maxLength={120} />
          <SelectField label="Type of purchase" value={draft.kind} onChange={(v) => set('kind', v as BidLotKind)}>
            {(Object.keys(KIND_LABELS) as BidLotKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </SelectField>
          <TextAreaField label="Description (optional)" value={draft.description} onChange={(v) => set('description', v)} error={errors.description} rows={2} placeholder="What you saw, the auction link, the lot number…" />
        </div>
      </Card>

      <Card className="p-4 sm:p-5" data-testid="bid-resale">
        <SectionHeader title="Resale value: your estimates" description="What you think the contents would sell for. StockPilot doesn’t look up prices, and the AI scanner doesn’t price items." />
        <ModeChoice value={draft.valueMode} onChange={(m) => set('valueMode', m, ['totalResaleValue', 'items'])} />
        {draft.valueMode === 'total' ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <MoneyField
              label="Estimated resale value, whole lot"
              required
              currency={currency}
              value={draft.totalResaleValue}
              onChange={(v) => set('totalResaleValue', v)}
              error={errors.totalResaleValue}
              hint="Total for everything in the lot"
              data-testid="bid-total-value"
            />
            <QuantityField
              label="Number of items (optional)"
              min={1}
              value={draft.itemCount}
              onChange={(v) => set('itemCount', v)}
              error={errors.itemCount}
              hint="Needed when shipping is a cost per item"
            />
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {errors.items && (
              <p className="text-sm text-bad-text" role="alert">
                {errors.items}
              </p>
            )}
            {draft.items.map((it, i) => {
              const v = readMoney(it.unitValue).value;
              const q = readWhole(it.quantity).value;
              return (
                <fieldset key={it.id} className="rounded-2xl border border-line p-3" data-testid="bid-item">
                  <legend className="sr-only">Item {i + 1}</legend>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-ink">Item {i + 1}</span>
                    <div className="flex items-center gap-1">
                      {scannerEnabled && !locked && (
                        <Button
                          size="sm"
                          variant="soft"
                          icon={<Sparkles className="size-3.5" />}
                          onClick={() => {
                            if (it.scanOpen) dropPhotos(scanPhotos.current);
                            setItem(i, { scanOpen: !it.scanOpen });
                          }}
                          aria-expanded={it.scanOpen}
                        >
                          {it.scanOpen ? 'Hide scanner' : 'Identify with AI'}
                        </Button>
                      )}
                      <IconButton label={`Remove item ${i + 1}`} size="sm" onClick={() => onChange((d) => ({ ...d, items: d.items.filter((_, n) => n !== i) }), ['items'])}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                  </div>
                  {it.scanOpen && scannerEnabled && !locked && (
                    <div className="mt-3 space-y-2">
                      <ScanPanel
                        highlight
                        onPhoto={(id, replaced) => {
                          scanPhotos.current = [...scanPhotos.current, id];
                          if (replaced) dropPhotos([replaced]);
                        }}
                        onResult={handleScanResult(i)}
                      />
                      <p className="flex items-start gap-1.5 text-xs text-ink-2" data-testid="bid-scan-note">
                        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        Identifying an item doesn’t tell you what it will sell for. Enter your own resale estimate. The photo isn’t kept with the plan.
                      </p>
                    </div>
                  )}
                  <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_8rem]">
                    <TextField
                      label={
                        <>
                          Item name
                          {it.aiFields.includes('name') && (
                            <span className="ml-1.5 rounded-md bg-demo-soft px-1.5 py-px text-[10px] font-semibold text-demo" data-testid="ai-filled">
                              AI<span className="sr-only"> suggested, check it</span>
                            </span>
                          )}
                        </>
                      }
                      required
                      value={it.name}
                      onChange={(val) => setItem(i, { name: val }, 'name')}
                      error={errors[`item.${i}.name`]}
                      maxLength={200}
                    />
                    <QuantityField label="Quantity" min={1} value={it.quantity} onChange={(val) => setItem(i, { quantity: val }, 'quantity')} error={errors[`item.${i}.quantity`]} />
                  </div>
                  <div className="mt-3 grid items-end gap-3 sm:grid-cols-[1fr_auto]">
                    <MoneyField
                      label="Your resale estimate, per item"
                      required
                      currency={currency}
                      value={it.unitValue}
                      onChange={(val) => setItem(i, { unitValue: val }, 'unitValue')}
                      error={errors[`item.${i}.unitValue`]}
                      data-testid="bid-item-value"
                    />
                    <p className="pb-2.5 text-sm text-ink-2">
                      Line total: <span className="tabular font-medium text-ink">{v !== null && q !== null && q > 0 && Number.isInteger(q) ? money(fromCents(toCents(v) * q)) : '—'}</span>
                    </p>
                  </div>
                  <button type="button" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent-text" onClick={() => setItem(i, { showMore: !it.showMore })} aria-expanded={it.showMore}>
                    {it.showMore ? 'Fewer details' : 'Category, condition, notes'}
                    <ChevronDown className={cn('size-3.5 transition-transform', it.showMore && 'rotate-180')} />
                  </button>
                  {it.showMore && (
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <TextField label="Category" value={it.category} onChange={(val) => setItem(i, { category: val }, 'category')} suggestions={categories} error={errors[`item.${i}.category`]} />
                      <TextField label="Condition" value={it.condition} onChange={(val) => setItem(i, { condition: val }, 'condition')} suggestions={CONDITION_SUGGESTIONS} error={errors[`item.${i}.condition`]} />
                      <TextAreaField className="sm:col-span-2" label="Notes" value={it.notes} onChange={(val) => setItem(i, { notes: val }, 'notes')} rows={2} error={errors[`item.${i}.notes`]} />
                    </div>
                  )}
                </fieldset>
              );
            })}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {draft.items.length < 200 && (
                <Button icon={<Plus className="size-4" />} onClick={() => onChange((d) => ({ ...d, items: [...d.items, newBidItem()] }), ['items'])} data-testid="bid-add-item">
                  Add an item
                </Button>
              )}
              <p className="text-sm text-ink-2" data-testid="bid-items-total">
                Your estimates add up to <span className="tabular font-semibold text-ink">{money(fromCents(itemsTotal))}</span>
              </p>
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5" data-testid="bid-selling">
        <SectionHeader title="Selling costs (expected)" description="Paid only on what sells. The conservative and optimistic scenarios have their own fees and unsold share below." />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <PercentField
            label="Expected unsold or unsellable"
            value={draft.scenarios.expected.unsoldPct}
            onChange={(v) => setScenario('expected', 'unsoldPct', v)}
            error={errors['scenario.expected.unsoldPct']}
            hint="% of the resale value you don’t expect to sell"
            data-testid="bid-unsold"
          />
          <PercentField
            label="Selling fees"
            value={draft.scenarios.expected.sellingFeePct}
            onChange={(v) => setScenario('expected', 'sellingFeePct', v)}
            error={errors['scenario.expected.sellingFeePct']}
            hint="% of the sale price (marketplace and payment fees)"
            data-testid="bid-fees"
          />
        </div>
        <div className="mt-3">
          <ShippingChoice value={draft.shippingMode} onChange={(m) => set('shippingMode', m, ['shippingValue', 'itemCount'])} />
          {draft.shippingMode === 'per_item' ? (
            <MoneyField className="mt-2" label="Outbound shipping you pay, per item sold" currency={currency} value={draft.shippingValue} onChange={(v) => set('shippingValue', v)} error={errors.shippingValue} hint="Leave at 0 if buyers pay shipping" />
          ) : (
            <PercentField className="mt-2" label="Outbound shipping you pay" value={draft.shippingValue} onChange={(v) => set('shippingValue', v)} error={errors.shippingValue} hint="% of the sale price" />
          )}
        </div>
      </Card>

      <Card className="p-4 sm:p-5" data-testid="bid-buying">
        <SectionHeader title="Buying costs" description="Added to your bid. They count once, as part of what the lot costs you." />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <PercentField label="Buyer’s premium" value={draft.buyerPremiumPct} onChange={(v) => set('buyerPremiumPct', v)} error={errors.buyerPremiumPct} hint="% of your bid" data-testid="bid-premium" />
          <PercentField label="Sales tax on the purchase" value={draft.salesTaxPct} onChange={(v) => set('salesTaxPct', v)} error={errors.salesTaxPct} hint="% of your bid" data-testid="bid-tax" />
        </div>
        <label className="mt-2 flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" className="size-4 accent-accent" checked={draft.taxOnPremium} onChange={(e) => set('taxOnPremium', e.target.checked)} />
          Sales tax is also charged on the buyer’s premium
        </label>
        <fieldset className="mt-3 space-y-2">
          <legend className="text-sm font-medium text-ink">Fixed costs (optional)</legend>
          <p className="text-xs text-muted">Paid once, whatever you bid: truck rental, cleanout or entry fees, travel. Amounts are for the whole lot.</p>
          {draft.fixedCosts.map((c, i) => (
            <div key={c.id} className="flex items-start gap-2" data-testid="bid-fixed-cost">
              <TextField
                label={<span className="sr-only">Cost {i + 1} name</span>}
                className="min-w-0 flex-1"
                value={c.label}
                placeholder="e.g. Truck rental"
                onChange={(v) => set('fixedCosts', draft.fixedCosts.map((x, n) => (n === i ? { ...x, label: v } : x)), [`fixed.${i}.label`])}
                error={errors[`fixed.${i}.label`]}
              />
              <MoneyField
                label={<span className="sr-only">Cost {i + 1} amount</span>}
                className="w-32 shrink-0"
                currency={currency}
                value={c.amount}
                onChange={(v) => set('fixedCosts', draft.fixedCosts.map((x, n) => (n === i ? { ...x, amount: v } : x)), [`fixed.${i}.amount`])}
                error={errors[`fixed.${i}.amount`]}
              />
              <IconButton label={`Remove cost ${i + 1}`} className="mt-0.5" onClick={() => set('fixedCosts', draft.fixedCosts.filter((_, n) => n !== i), [])}>
                <X className="size-4" />
              </IconButton>
            </div>
          ))}
          {draft.fixedCosts.length < 10 && (
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => set('fixedCosts', [...draft.fixedCosts, { id: newId(), label: '', amount: '' }], [])} data-testid="bid-add-fixed">
              Add a fixed cost
            </Button>
          )}
        </fieldset>
      </Card>

      <Card className="p-4 sm:p-5" data-testid="bid-goal">
        <SectionHeader title="Your goal" />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <PercentField
            label="Target return (ROI)"
            required
            value={draft.targetRoiPct}
            onChange={(v) => set('targetRoiPct', v)}
            error={errors.targetRoiPct}
            hint="Profit ÷ everything you pay. 100% = double your money"
            data-testid="bid-roi"
          />
          <MoneyField label="Budget (optional)" currency={currency} value={draft.budget} onChange={(v) => set('budget', v)} error={errors.budget} hint="Most you can spend in total, costs included" data-testid="bid-budget" />
          <MoneyField label="Your planned bid (optional)" currency={currency} value={draft.plannedBid} onChange={(v) => set('plannedBid', v)} error={errors.plannedBid} hint="To check it against the maximum" data-testid="bid-planned-input" />
        </div>
      </Card>

      <Card className="p-4 sm:p-5" data-testid="bid-scenario-inputs">
        <SectionHeader
          title="Scenarios"
          description="How the maximum changes if prices, sell-through or fees turn out differently. Shipping and buying costs are the same in all three."
          action={
            !locked && (
              <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => onChange((d) => ({ ...d, scenarios: scenarioDrafts(DEFAULT_SCENARIOS) }), SCENARIO_KEYS.flatMap((k) => [`scenario.${k}.resalePct`, `scenario.${k}.unsoldPct`, `scenario.${k}.sellingFeePct`]))}>
                Defaults
              </Button>
            )
          }
        />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {SCENARIO_KEYS.map((k) => (
            <fieldset key={k} className={cn('space-y-2 rounded-2xl border p-3', k === 'expected' ? 'border-accent/50' : 'border-line')} data-testid={`bid-scenario-${k}`}>
              <legend className="px-1 text-sm font-semibold text-ink">{SCENARIO_LABELS[k]}</legend>
              <PercentField label="Resale value" value={draft.scenarios[k].resalePct} onChange={(v) => setScenario(k, 'resalePct', v)} error={errors[`scenario.${k}.resalePct`]} hint="% of your estimate" />
              <PercentField label="Unsold" value={draft.scenarios[k].unsoldPct} onChange={(v) => setScenario(k, 'unsoldPct', v)} error={errors[`scenario.${k}.unsoldPct`]} hint="% of resale value" />
              <PercentField label="Selling fees" value={draft.scenarios[k].sellingFeePct} onChange={(v) => setScenario(k, 'sellingFeePct', v)} error={errors[`scenario.${k}.sellingFeePct`]} hint="% of sale price" />
            </fieldset>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          Starting values: conservative {DEFAULT_SCENARIOS.conservative.resalePct}% / {DEFAULT_SCENARIOS.conservative.unsoldPct}% / {DEFAULT_SCENARIOS.conservative.sellingFeePct}%, expected{' '}
          {DEFAULT_SCENARIOS.expected.resalePct}% / {DEFAULT_SCENARIOS.expected.unsoldPct}% / {DEFAULT_SCENARIOS.expected.sellingFeePct}%, optimistic {DEFAULT_SCENARIOS.optimistic.resalePct}% /{' '}
          {DEFAULT_SCENARIOS.optimistic.unsoldPct}% / {DEFAULT_SCENARIOS.optimistic.sellingFeePct}% (resale / unsold / fees). They’re starting points, not market data: change them to fit what you buy and
          where you sell.
        </p>
      </Card>
    </fieldset>
  );
}

function ModeChoice({ value, onChange }: { value: 'total' | 'items'; onChange: (m: 'total' | 'items') => void }) {
  const values = ['total', 'items'] as const;
  const radio = useRadioGroup(values, value, onChange);
  const labels = { total: 'One total for the lot', items: 'Item by item' };
  return (
    <div role="radiogroup" aria-label="How to estimate resale value" className="mt-3 flex rounded-xl bg-surface-2 p-1 text-sm">
      {values.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          {...radio(m)}
          onClick={() => onChange(m)}
          className={cn('flex-1 rounded-lg px-3 py-2 font-medium', value === m ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink')}
        >
          {labels[m]}
        </button>
      ))}
    </div>
  );
}

function ShippingChoice({ value, onChange }: { value: 'per_item' | 'percent'; onChange: (m: 'per_item' | 'percent') => void }) {
  const values = ['per_item', 'percent'] as const;
  const radio = useRadioGroup(values, value, onChange);
  const labels = { per_item: '$ per item sold', percent: '% of sale price' };
  return (
    <div>
      <span className="text-sm font-medium text-ink" id="bid-shipping-label">
        Outbound shipping
      </span>
      <div role="radiogroup" aria-labelledby="bid-shipping-label" className="mt-1.5 flex rounded-xl bg-surface-2 p-1 text-sm">
        {values.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            {...radio(m)}
            onClick={() => onChange(m)}
            className={cn('flex-1 rounded-lg px-3 py-1.5 font-medium', value === m ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink')}
          >
            {labels[m]}
          </button>
        ))}
      </div>
    </div>
  );
}
