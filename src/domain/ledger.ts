// The inventory ledger: a dated record of every change to inventory cost, kept from the moment
// StockPilot starts it (the first time this version loads the data). Each change made through
// the app is compared before and after: sales (cost of goods sold) and quantity adjustments
// already carry their own amounts, so the ledger records only what they don't explain:
// purchases, cost corrections, deleted items, edited or cancelled sales. Nothing is estimated:
// every amount is the exact change in Σ quantity × cost per item, in whole cents.
//
// Opening balance: when the ledger starts, each item's cost on hand is recorded as "opening".
// Earlier history isn't in the ledger, so months before it began can't be fully verified.

import type { AppData, Item, LedgerEvent, LedgerEventKind, Lot, Sale } from './types';
import { itemCostValue } from './calc';
import { fromCents, multiplyMoney, toCents } from './money';
import { toISODate } from './dates';
import { newId } from './ids';
import { nowParts, type Clock } from './actions';
import { plural } from './format';

/** The local calendar day of a timestamp (the day it happened on this device). */
export function localDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : toISODate(d);
}

const cogsCents = (s: Sale) => toCents(multiplyMoney(s.unitCost, s.quantity));
const valueCents = (i: Item | undefined) => (i ? toCents(itemCostValue(i)) : 0);

function lotOf(lots: Lot[], itemId: string): Lot | undefined {
  return lots.find((l) => l.lines.some((line) => line.itemId === itemId));
}

/** The day a purchase counts on: the item's purchase date, its lot's, or the day it was added. */
export function acquisitionDate(item: Item, lots: Lot[], fallback: string): string {
  return item.purchaseDate ?? lotOf(lots, item.id)?.purchaseDate ?? fallback;
}

function event(at: string, date: string, kind: LedgerEventKind, cents: number, item: { id: string; name: string }, extra: Partial<LedgerEvent> = {}): LedgerEvent {
  return { id: newId(), at, date, kind, amount: fromCents(cents), itemId: item.id, itemName: item.name, lotId: null, saleIds: [], note: '', ...extra };
}

/** Starts the ledger (once): each item's cost on hand becomes its opening balance. */
export function startLedger(data: AppData, clock?: Clock): AppData {
  if (data.inventoryLedger.startedAt) return data;
  const { iso, today } = nowParts(clock);
  const events = data.items
    .filter((i) => valueCents(i) !== 0)
    .map((i) => event(iso, today, 'opening', valueCents(i), i, { lotId: lotOf(data.lots, i.id)?.id ?? null, note: `Opening balance: ${plural(i.quantity, 'unit')} on hand` }));
  return { ...data, inventoryLedger: { startedAt: iso, events: [...data.inventoryLedger.events, ...events] } };
}

/**
 * Records, in the ledger of `after`, every change to inventory cost between `before` and
 * `after` that sales and adjustments don't account for. Pure; called for every saved change.
 */
export function trackChanges(before: AppData, after: AppData, clock?: Clock): AppData {
  const started = startLedger(before, clock);
  let next = started === before ? after : { ...after, inventoryLedger: started.inventoryLedger };
  if (before.items === after.items && before.sales === after.sales && before.adjustments === after.adjustments && before.lots === after.lots) return next;
  const { iso, today } = nowParts(clock);

  const bItems = new Map(before.items.map((i) => [i.id, i]));
  const aItems = new Map(after.items.map((i) => [i.id, i]));
  const ids = new Set([...bItems.keys(), ...aItems.keys()]);
  const inv = new Map<string, number>();
  const cogs = new Map<string, number>();
  const adj = new Map<string, number>();
  const touchedSales = new Map<string, Set<string>>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  const touch = (itemId: string, saleId: string) => touchedSales.set(itemId, (touchedSales.get(itemId) ?? new Set()).add(saleId));

  for (const id of ids) add(inv, id, valueCents(aItems.get(id)) - valueCents(bItems.get(id)));
  if (before.sales !== after.sales) {
    const bSales = new Map(before.sales.map((s) => [s.id, s]));
    const aSales = new Map(after.sales.map((s) => [s.id, s]));
    for (const id of new Set([...bSales.keys(), ...aSales.keys()])) {
      const b = bSales.get(id);
      const a = aSales.get(id);
      if (b) add(cogs, b.itemId, -cogsCents(b));
      if (a) add(cogs, a.itemId, cogsCents(a));
      if (!a || !b || a.itemId !== b.itemId || cogsCents(a) !== cogsCents(b)) {
        if (b) touch(b.itemId, id);
        if (a) touch(a.itemId, id);
      }
    }
  }
  if (before.adjustments !== after.adjustments) {
    const known = new Set(before.adjustments.map((a) => a.id));
    for (const a of after.adjustments) if (!known.has(a.id)) add(adj, a.itemId, toCents(a.valueDifference));
  }

  const events: LedgerEvent[] = [];
  for (const id of ids) {
    const b = bItems.get(id);
    const a = aItems.get(id);
    // Cost on hand changed by inv; sales took cogs of it; adjustments carry adj. The rest is ours.
    const rest = (inv.get(id) ?? 0) + (cogs.get(id) ?? 0) - (adj.get(id) ?? 0);
    const item = a ?? b!;
    const lot = lotOf(after.lots, id) ?? lotOf(before.lots, id);
    const saleIds = [...(touchedSales.get(id) ?? [])];
    if (rest !== 0) {
      if (!b) {
        events.push(event(iso, acquisitionDate(a!, after.lots, today), 'acquired', rest, item, { lotId: lot?.id ?? null, note: lot ? `Bought in bulk lot “${lot.name}”` : `Added with ${plural(a!.quantity, 'unit')}` }));
      } else if (!a) {
        events.push(event(iso, today, 'removed', rest, item, { lotId: lot?.id ?? null, saleIds, note: `Deleted with ${plural(b.quantity, 'unit')} in stock` }));
      } else if (a.unitCost !== b.unitCost && !saleIds.length) {
        const lotChanged = lot && before.lots !== after.lots && lotOf(before.lots, id)?.history.length !== lot.history.length;
        events.push(
          event(iso, today, 'cost_correction', rest, item, {
            lotId: lot?.id ?? null,
            note: lotChanged ? `Bulk lot “${lot!.name}” costs changed: cost per item ${b.unitCost} → ${a.unitCost}` : `Cost per item edited: ${b.unitCost} → ${a.unitCost}`,
          }),
        );
      } else {
        events.push(
          event(iso, today, a.unitCost !== b.unitCost ? 'cost_correction' : 'sale_correction', rest, item, {
            lotId: lot?.id ?? null,
            saleIds,
            note: a.unitCost !== b.unitCost ? `Cost per item edited (${b.unitCost} → ${a.unitCost}) and applied to ${plural(saleIds.length, 'recorded sale')}` : 'Sale edited or cancelled: stock came back at a different cost than the sale recorded',
          }),
        );
      }
    }
    // A purchase date edit moves the purchase to its new month.
    if (a && b) {
      const from = acquisitionDate(b, before.lots, '');
      const to = acquisitionDate(a, after.lots, '');
      if (from && to && from !== to) {
        const bought = next.inventoryLedger.events.filter((e) => e.itemId === id && (e.kind === 'acquired' || e.kind === 'purchase_date') && e.date === from).reduce((c, e) => c + toCents(e.amount), 0);
        if (bought !== 0) {
          events.push(event(iso, from, 'purchase_date', -bought, item, { lotId: lot?.id ?? null, note: `Purchase date changed to ${to}` }));
          events.push(event(iso, to, 'purchase_date', bought, item, { lotId: lot?.id ?? null, note: `Purchase date changed from ${from}` }));
        }
      }
    }
  }
  if (!events.length) return next;
  next = { ...next, inventoryLedger: { ...next.inventoryLedger, events: [...next.inventoryLedger.events, ...events] } };
  return next;
}

/** Σ quantity × cost per item over the item records, in cents. */
export function recordsBalanceCents(data: AppData): number {
  return data.items.reduce((c, i) => c + valueCents(i), 0);
}
