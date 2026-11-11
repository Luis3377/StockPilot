// What the Max Bid form holds while the user types (text, exactly as typed), and the
// conversion to and from a saved plan.

import { defaultAssumptions, SCENARIO_KEYS, type BidPlanInput } from '../../domain/bids';
import { newId } from '../../domain/ids';
import type { BidLotKind, BidPlan, BidScenarioKey, BidShippingMode } from '../../domain/types';
import { moneyInputText, readMoney, readWhole } from '../lots/LotParts';

export interface BidItemDraft {
  id: string;
  name: string;
  quantity: string;
  unitValue: string;
  category: string;
  condition: string;
  notes: string;
  aiFields: string[];
  showMore: boolean;
  scanOpen: boolean;
}

export interface ScenarioDraft {
  resalePct: string;
  unsoldPct: string;
  sellingFeePct: string;
}

export interface BidDraft {
  name: string;
  description: string;
  kind: BidLotKind;
  valueMode: 'total' | 'items';
  totalResaleValue: string;
  itemCount: string;
  items: BidItemDraft[];
  shippingMode: BidShippingMode;
  shippingValue: string;
  fixedCosts: { id: string; label: string; amount: string }[];
  buyerPremiumPct: string;
  salesTaxPct: string;
  taxOnPremium: boolean;
  targetRoiPct: string;
  budget: string;
  plannedBid: string;
  scenarios: Record<BidScenarioKey, ScenarioDraft>;
}

const num = (n: number | null) => (n === null ? '' : moneyInputText(n));

export const newBidItem = (): BidItemDraft => ({ id: newId(), name: '', quantity: '1', unitValue: '', category: '', condition: '', notes: '', aiFields: [], showMore: false, scanOpen: false });

export function scenarioDrafts(s: BidPlan['assumptions']['scenarios']): Record<BidScenarioKey, ScenarioDraft> {
  return Object.fromEntries(SCENARIO_KEYS.map((k) => [k, { resalePct: num(s[k].resalePct), unsoldPct: num(s[k].unsoldPct), sellingFeePct: num(s[k].sellingFeePct) }])) as Record<BidScenarioKey, ScenarioDraft>;
}

export function draftFromPlan(plan: Pick<BidPlan, 'name' | 'description' | 'kind' | 'assumptions'> | null): BidDraft {
  const a = plan?.assumptions ?? defaultAssumptions();
  return {
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    kind: plan?.kind ?? 'storage_unit',
    valueMode: a.valueMode,
    totalResaleValue: num(a.totalResaleValue),
    itemCount: a.itemCount === null ? '' : String(a.itemCount),
    items: a.items.map((it) => ({
      id: it.id,
      name: it.name,
      quantity: String(it.quantity),
      unitValue: num(it.unitValue),
      category: it.category,
      condition: it.condition,
      notes: it.notes,
      aiFields: it.aiFields,
      showMore: false,
      scanOpen: false,
    })),
    shippingMode: a.shippingMode,
    shippingValue: num(a.shippingValue),
    fixedCosts: a.fixedCosts.map((c) => ({ id: c.id, label: c.label, amount: num(c.amount) })),
    buyerPremiumPct: num(a.buyerPremiumPct),
    salesTaxPct: num(a.salesTaxPct),
    taxOnPremium: a.taxOnPremium,
    targetRoiPct: num(a.targetRoiPct),
    budget: num(a.budget),
    plannedBid: num(a.plannedBid),
    scenarios: scenarioDrafts(a.scenarios),
  };
}

/** Reads a typed percentage ("15", "15%", "13.25"). */
export function readPercent(text: string): { value: number | null; error?: string } {
  const t = text.trim().replace(/%$/, '').trim();
  if (t === '') return { value: null };
  if (!/^-?\d*\.?\d+$|^\d+\.$/.test(t)) return { value: null, error: 'Enter a percentage like 15' };
  return { value: Number(t) };
}

/** The draft as a plan input, plus "that isn't a number" problems found on the way. */
export function toBidInput(d: BidDraft): { input: BidPlanInput; typing: Record<string, string> } {
  const typing: Record<string, string> = {};
  const money = (text: string, key: string) => {
    const r = readMoney(text);
    if (r.error) typing[key] = r.error;
    return r.value;
  };
  const pct = (text: string, key: string) => {
    const r = readPercent(text);
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
      description: d.description,
      kind: d.kind,
      assumptions: {
        valueMode: d.valueMode,
        totalResaleValue: money(d.totalResaleValue, 'totalResaleValue'),
        itemCount: whole(d.itemCount, 'itemCount'),
        items: d.items.map((it, i) => ({
          id: it.id,
          name: it.name,
          quantity: whole(it.quantity, `item.${i}.quantity`) as number,
          unitValue: money(it.unitValue, `item.${i}.unitValue`),
          category: it.category,
          condition: it.condition,
          notes: it.notes,
          aiFields: it.aiFields,
        })),
        shippingMode: d.shippingMode,
        shippingValue: d.shippingMode === 'percent' ? pct(d.shippingValue, 'shippingValue') : money(d.shippingValue, 'shippingValue'),
        fixedCosts: d.fixedCosts.map((c, i) => ({ id: c.id, label: c.label, amount: money(c.amount, `fixed.${i}.amount`) })),
        buyerPremiumPct: pct(d.buyerPremiumPct, 'buyerPremiumPct'),
        salesTaxPct: pct(d.salesTaxPct, 'salesTaxPct'),
        taxOnPremium: d.taxOnPremium,
        targetRoiPct: pct(d.targetRoiPct, 'targetRoiPct'),
        budget: money(d.budget, 'budget'),
        plannedBid: money(d.plannedBid, 'plannedBid'),
        scenarios: Object.fromEntries(
          SCENARIO_KEYS.map((k) => [
            k,
            {
              resalePct: pct(d.scenarios[k].resalePct, `scenario.${k}.resalePct`),
              unsoldPct: pct(d.scenarios[k].unsoldPct, `scenario.${k}.unsoldPct`),
              sellingFeePct: pct(d.scenarios[k].sellingFeePct, `scenario.${k}.sellingFeePct`),
            },
          ]),
        ) as BidPlanInput['assumptions']['scenarios'],
      },
    },
    typing,
  };
}

/** True when the draft would save something different from the plan. */
export function isDirty(draft: BidDraft, plan: BidPlan | null): boolean {
  const strip = (d: BidDraft) => ({ ...d, items: d.items.map(({ showMore: _m, scanOpen: _s, ...rest }) => rest) });
  return JSON.stringify(strip(draft)) !== JSON.stringify(strip(draftFromPlan(plan)));
}
