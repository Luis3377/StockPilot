// Profit by source and profit per hour. Every figure is attributed from existing records:
// recorded sales (computeSale: revenue, cost of goods sold, fees, shipping, other), item and lot
// costs (bulk lot shares via lotSummary), stock on hand, and logged time. Nothing is estimated.
//
// Attribution:
//   an item in a bulk lot → the lot's source; any other item → its own source
//   a lot's source → its registered source while the lot's text still names it (or an earlier
//   name), otherwise the registered source with that name, otherwise the text itself
//   (an unregistered source), otherwise "Unassigned source"
//   a sale → its item's source (a sale of a deleted item keeps its lot's source if it had one)
// Realized figures use sales dated in the period; acquisitions use the purchase date; stock is
// as of today. Time is counted once: each entry is split across what it's linked to, in whole
// seconds that add up exactly, and time that can't be attributed is kept as "not allocated".

import type { AppData, BidLotKind, Item, Lot, Sale, Settings, SourceType, SourcingSession, TimeEntry, TimeLink } from '../domain/types';
import { computeSale, itemCostValue, totalSales, type SalesTotals } from '../domain/calc';
import { daysBetween, inRange, todayISO, type DateRange } from '../domain/dates';
import { lotForItem, lotSummary, lotTotal } from '../domain/lots';
import { fromCents, toCents } from '../domain/money';
import { bidPlanForLot } from '../domain/bids';
import { sourceKey, SOURCE_TYPE_LABELS } from '../domain/sourcing';
import { splitCents } from '../domain/lots';

export const UNASSIGNED_KEY = 'unassigned';

export interface SourceRef {
  /** Stable grouping key: the source id, "text:<name>" for an unregistered name, or "unassigned". */
  key: string;
  sourceId: string | null;
  name: string;
  type: SourceType | null;
  registered: boolean;
}

const UNASSIGNED: SourceRef = { key: UNASSIGNED_KEY, sourceId: null, name: 'Unassigned source', type: null, registered: false };

const PLAN_KIND_TYPE: Record<BidLotKind, SourceType> = {
  storage_unit: 'storage_auction',
  pallet: 'liquidation',
  estate_sale: 'estate_sale',
  garage_sale: 'garage_sale',
  collectibles: 'other',
  retail_lot: 'retail',
  other: 'other',
};

export function typeLabel(type: SourceType | null): string {
  return type ? SOURCE_TYPE_LABELS[type] : 'Type not set';
}

function registered(data: AppData, id: string): SourceRef | null {
  const s = data.sourcing.sources.find((x) => x.id === id);
  return s ? { key: s.id, sourceId: s.id, name: s.name, type: s.type, registered: true } : null;
}

function byName(data: AppData, text: string): SourceRef | null {
  const key = sourceKey(text);
  if (!key) return null;
  const s = data.sourcing.sources.find((x) => [x.name, ...x.aliases].some((n) => sourceKey(n) === key));
  return s ? { key: s.id, sourceId: s.id, name: s.name, type: s.type, registered: true } : null;
}

export function lotSource(data: AppData, lot: Lot): SourceRef {
  const text = lot.source.trim();
  if (lot.sourceId) {
    const s = data.sourcing.sources.find((x) => x.id === lot.sourceId);
    // The id holds while the lot's text still names the source (renames keep old names).
    if (s && (!text || [s.name, ...s.aliases].some((n) => sourceKey(n) === sourceKey(text)))) return registered(data, s.id)!;
  }
  if (!text) return UNASSIGNED;
  const named = byName(data, text);
  if (named) return named;
  const plan = bidPlanForLot(data, lot.id);
  return { key: `text:${sourceKey(text)}`, sourceId: null, name: text, type: plan ? PLAN_KIND_TYPE[plan.kind] : null, registered: false };
}

export function itemSource(data: AppData, item: Item): SourceRef {
  const lot = lotForItem(data, item.id);
  if (lot) return lotSource(data, lot.lot);
  return (item.sourceId && registered(data, item.sourceId)) || UNASSIGNED;
}

export function saleSource(data: AppData, sale: Sale): SourceRef {
  const item = data.items.find((i) => i.id === sale.itemId);
  if (item) return itemSource(data, item);
  const lot = lotForItem(data, sale.itemId);
  return lot ? lotSource(data, lot.lot) : UNASSIGNED;
}

/** The date an item (or its lot) was bought: purchase date, else when it was added. */
function acquiredOn(data: AppData, itemId: string): string | null {
  const lot = lotForItem(data, itemId);
  if (lot) return lot.lot.purchaseDate ?? lot.lot.createdAt.slice(0, 10);
  const item = data.items.find((i) => i.id === itemId);
  return item ? (item.purchaseDate ?? item.createdAt.slice(0, 10)) : null;
}

// ---------------------------------------------------------------------------
// What was bought (all units ever bought, including restocks; exact lot shares)
// ---------------------------------------------------------------------------

export interface Purchase {
  kind: 'item' | 'lot';
  id: string;
  name: string;
  ref: SourceRef;
  date: string;
  cost: number;
  units: number;
  itemIds: string[];
  sessionId: string | null;
}

function purchases(data: AppData): Purchase[] {
  const out: Purchase[] = [];
  for (const lot of data.lots) {
    const s = lotSummary(data, lot);
    const ids = new Set(lot.lines.map((l) => l.itemId));
    const restocked = data.adjustments.filter((a) => ids.has(a.itemId) && a.source === 'restock').reduce((n, a) => n + a.difference, 0);
    out.push({
      kind: 'lot',
      id: lot.id,
      name: lot.name,
      ref: lotSource(data, lot),
      date: lot.purchaseDate ?? lot.createdAt.slice(0, 10),
      cost: fromCents(toCents(lotTotal(lot)) + toCents(s.addedLater)),
      units: s.unitsBought + restocked,
      itemIds: [...ids],
      sessionId: lot.sessionId ?? null,
    });
  }
  for (const item of data.items) {
    if (lotForItem(data, item.id)) continue;
    const own = data.sales.filter((x) => x.itemId === item.id);
    const other = data.adjustments.filter((a) => a.itemId === item.id && a.source !== 'restock');
    const t = totalSales(own);
    // Bought = in stock now + sold + written off (net of units found again).
    const cost = toCents(itemCostValue(item)) + toCents(t.costOfGoods) - other.reduce((c, a) => c + toCents(a.valueDifference), 0);
    out.push({
      kind: 'item',
      id: item.id,
      name: item.name,
      ref: itemSource(data, item),
      date: item.purchaseDate ?? item.createdAt.slice(0, 10),
      cost: fromCents(Math.max(0, cost)),
      units: item.quantity + t.unitsSold - other.reduce((n, a) => n + a.difference, 0),
      itemIds: [item.id],
      sessionId: item.sessionId ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Time: each entry split once across its links, then each link to sources or categories
// ---------------------------------------------------------------------------

export interface TimeShare {
  entry: TimeEntry;
  seconds: number;
  /** Source key, or null when it can't be attributed to a source. */
  sourceKey: string | null;
  /** Why it's not attributed, when sourceKey is null. */
  reason: 'general' | 'trip_not_split' | null;
}

/** Splits `total` across weights exactly (largest remainder); equal when all weights are 0. */
function splitWhole(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const w = weights.some((x) => x > 0) ? weights.map((x) => Math.max(0, Math.round(x))) : weights.map(() => 1);
  return splitCents(total, w);
}

function linkSeconds(entry: TimeEntry): { link: TimeLink | null; seconds: number }[] {
  const total = entry.minutes * 60;
  if (!entry.links.length) return [{ link: null, seconds: total }];
  const weights = entry.split === 'custom' && entry.links.length > 1 ? entry.links.map((l) => Math.round((l.sharePct ?? 0) * 100)) : entry.links.map(() => 1);
  return splitWhole(total, weights).map((seconds, i) => ({ link: entry.links[i], seconds }));
}

/** The sources a trip covers: those chosen for it plus those of its items and lots. */
export function sessionSources(data: AppData, session: SourcingSession, buys: Purchase[] = purchases(data)): SourceRef[] {
  const refs = new Map<string, SourceRef>();
  for (const id of session.sourceIds) {
    const r = registered(data, id);
    if (r) refs.set(r.key, r);
  }
  for (const p of buys) if (p.sessionId === session.id) refs.set(p.ref.key, p.ref);
  return [...refs.values()];
}

export function timeShares(data: AppData, entries: TimeEntry[] = data.sourcing.timeEntries): TimeShare[] {
  const buys = purchases(data);
  const out: TimeShare[] = [];
  for (const entry of entries) {
    for (const { link, seconds } of linkSeconds(entry)) {
      if (!link) {
        out.push({ entry, seconds, sourceKey: null, reason: 'general' });
        continue;
      }
      if (link.kind === 'source') {
        out.push({ entry, seconds, sourceKey: registered(data, link.id)?.key ?? null, reason: registered(data, link.id) ? null : 'general' });
      } else if (link.kind === 'lot') {
        const lot = data.lots.find((l) => l.id === link.id);
        out.push({ entry, seconds, sourceKey: lot ? lotSource(data, lot).key : null, reason: lot ? null : 'general' });
      } else if (link.kind === 'item') {
        const item = data.items.find((i) => i.id === link.id);
        out.push({ entry, seconds, sourceKey: item ? itemSource(data, item).key : null, reason: item ? null : 'general' });
      } else {
        const session = data.sourcing.sessions.find((s) => s.id === link.id);
        if (!session) {
          out.push({ entry, seconds, sourceKey: null, reason: 'general' });
          continue;
        }
        const refs = sessionSources(data, session, buys);
        if (refs.length === 1) out.push({ entry, seconds, sourceKey: refs[0].key, reason: null });
        else if (!refs.length || !session.split) out.push({ entry, seconds, sourceKey: null, reason: refs.length ? 'trip_not_split' : 'general' });
        else {
          const weights = session.split === 'equal' ? refs.map(() => 1) : refs.map((r) => buys.filter((p) => p.sessionId === session.id && p.ref.key === r.key).reduce((c, p) => c + toCents(p.cost), 0));
          splitWhole(seconds, weights).forEach((sec, i) => out.push({ entry, seconds: sec, sourceKey: refs[i].key, reason: null }));
        }
      }
    }
  }
  return out;
}

/** Category of each linked item or lot (lots split by each line's cost); other links have none. */
function categoryShares(data: AppData, entries: TimeEntry[]): { category: string | null; seconds: number }[] {
  const out: { category: string | null; seconds: number }[] = [];
  for (const entry of entries) {
    for (const { link, seconds } of linkSeconds(entry)) {
      if (link?.kind === 'item') {
        const item = data.items.find((i) => i.id === link.id);
        out.push({ category: item ? item.category.trim() || 'Uncategorized' : null, seconds });
      } else if (link?.kind === 'lot') {
        const lot = data.lots.find((l) => l.id === link.id);
        if (!lot) {
          out.push({ category: null, seconds });
          continue;
        }
        const cats = lot.lines.map((l) => data.items.find((i) => i.id === l.itemId)?.category.trim() || 'Uncategorized');
        splitWhole(seconds, lot.lines.map((l) => toCents(l.allocatedCost))).forEach((sec, i) => out.push({ category: cats[i], seconds: sec }));
      } else out.push({ category: null, seconds });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface PerformanceFigures {
  revenue: number;
  costOfGoods: number;
  fees: number;
  shipping: number;
  otherExpenses: number;
  sellingExpenses: number;
  realizedProfit: number;
  /** realized profit ÷ revenue. */
  marginPct: number | null;
  /** realized profit ÷ cost of goods sold (the cost of the units sold). */
  roiPct: number | null;
  unitsSold: number;
  /** Average days from purchase to sale, weighted by units (sales with a known purchase date). */
  avgDaysToSell: number | null;
  hours: number;
  /** realized profit ÷ logged hours; null without logged time. */
  profitPerHour: number | null;
}

export interface SourceStats extends PerformanceFigures {
  ref: SourceRef;
  /** Bought in the period (purchase date): cost, items (or lots) and units. */
  acquisitionCost: number;
  purchases: number;
  unitsPurchased: number;
  /** Today. */
  unitsRemaining: number;
  inventoryCost: number;
  /** Average days unsold units have been in stock, weighted by units. */
  avgDaysInStock: number | null;
  /** Trip expenses attributed to this source (one-source trips, or trips split by the user). */
  tripExpenses: number;
  sales: Sale[];
  purchaseRecords: Purchase[];
  /** Still has stock, so its results aren't final. */
  stillSelling: boolean;
}

export interface GroupStats extends PerformanceFigures {
  key: string;
  label: string;
  inventoryCost: number;
  unitsRemaining: number;
  sources: number;
}

export interface SourcingReport {
  range: DateRange;
  sources: SourceStats[];
  types: GroupStats[];
  categories: GroupStats[];
  totals: SalesTotals & { hours: number; profitPerHour: number | null; inventoryCost: number };
  /** Hours that couldn't be put on a source (general work, or a multi-source trip not divided). */
  unallocatedHours: number;
  tripNotSplitHours: number;
  /** Activities with no time logged in the period (results marked incomplete). */
  missingActivities: string[];
  /** Trip expenses not attributed to a source (several sources, no split chosen). */
  unallocatedTripExpenses: number;
  hasTime: boolean;
}

const pct = (num: number, den: number): number | null => (den === 0 ? null : Math.round((num / den) * 10000) / 100);
const hoursOf = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;
const perHour = (profit: number, seconds: number): number | null => (seconds === 0 ? null : fromCents(Math.round((toCents(profit) * 3600) / seconds)));

function weightedDays(rows: { days: number; units: number }[]): number | null {
  const units = rows.reduce((n, r) => n + r.units, 0);
  return units ? Math.round((rows.reduce((c, r) => c + r.days * r.units, 0) / units) * 10) / 10 : null;
}

function figures(data: AppData, sales: Sale[], seconds: number): PerformanceFigures {
  const t = totalSales(sales);
  const days = sales.flatMap((x) => {
    const from = acquiredOn(data, x.itemId);
    return from && from <= x.saleDate ? [{ days: daysBetween(from, x.saleDate), units: x.quantity }] : [];
  });
  return {
    revenue: t.revenue,
    costOfGoods: t.costOfGoods,
    fees: t.fees,
    shipping: t.shipping,
    otherExpenses: t.otherExpenses,
    sellingExpenses: t.totalExpenses,
    realizedProfit: t.netProfit,
    marginPct: pct(toCents(t.netProfit), toCents(t.revenue)),
    roiPct: pct(toCents(t.netProfit), toCents(t.costOfGoods)),
    unitsSold: t.unitsSold,
    avgDaysToSell: weightedDays(days),
    hours: hoursOf(seconds),
    profitPerHour: perHour(t.netProfit, seconds),
  };
}

export interface ReportOptions {
  range: DateRange;
  today?: string;
  /** Only this category (sales by the item's category at sale time; stock by current category). */
  category?: string | null;
}

export function sourcingReport(data: AppData, settings: Settings, opts: ReportOptions): SourcingReport {
  void settings;
  const today = opts.today ?? todayISO();
  const range = opts.range;
  const catKey = opts.category ? opts.category.trim().toLowerCase() : null;
  const inCat = (c: string) => !catKey || (c.trim() || 'Uncategorized').toLowerCase() === catKey;
  const sales = data.sales.filter((x) => inRange(x.saleDate, range) && inCat(x.itemCategory));
  const buys = purchases(data);
  const entries = data.sourcing.timeEntries.filter((e) => inRange(e.date, range));
  const shares = catKey ? [] : timeShares(data, entries);

  // Every source that has a purchase, a sale or time in view.
  const refs = new Map<string, SourceRef>();
  for (const p of buys) refs.set(p.ref.key, p.ref);
  for (const x of sales) {
    const r = saleSource(data, x);
    refs.set(r.key, r);
  }
  for (const s of data.sourcing.sources) refs.set(s.id, { key: s.id, sourceId: s.id, name: s.name, type: s.type, registered: true });

  // Trip expenses go to a source only when it's unambiguous or the user chose a split.
  const tripExpense = new Map<string, number>();
  let unallocatedTrip = 0;
  for (const session of data.sourcing.sessions) {
    if (!inRange(session.date, range)) continue;
    const total = session.expenses.reduce((c, e) => c + toCents(e.amount), 0);
    if (!total) continue;
    const srcs = sessionSources(data, session, buys);
    if (srcs.length === 1) tripExpense.set(srcs[0].key, (tripExpense.get(srcs[0].key) ?? 0) + total);
    else if (!srcs.length || !session.split) unallocatedTrip += total;
    else {
      const weights = session.split === 'equal' ? srcs.map(() => 1) : srcs.map((r) => buys.filter((p) => p.sessionId === session.id && p.ref.key === r.key).reduce((c, p) => c + toCents(p.cost), 0));
      splitWhole(total, weights).forEach((c, i) => tripExpense.set(srcs[i].key, (tripExpense.get(srcs[i].key) ?? 0) + c));
    }
  }

  const stockOf = (items: Item[]) => items.filter((i) => i.quantity > 0 && inCat(i.category));
  const sources: SourceStats[] = [...refs.values()].map((ref) => {
    const ownSales = sales.filter((x) => saleSource(data, x).key === ref.key);
    const seconds = shares.filter((s) => s.sourceKey === ref.key).reduce((c, s) => c + s.seconds, 0);
    const ownBuys = buys.filter((p) => p.ref.key === ref.key);
    const bought = ownBuys.filter((p) => inRange(p.date, range));
    const stock = stockOf(data.items.filter((i) => itemSource(data, i).key === ref.key));
    return {
      ref,
      ...figures(data, ownSales, seconds),
      acquisitionCost: fromCents(bought.reduce((c, p) => c + toCents(p.cost), 0)),
      purchases: bought.length,
      unitsPurchased: bought.reduce((n, p) => n + p.units, 0),
      unitsRemaining: stock.reduce((n, i) => n + i.quantity, 0),
      inventoryCost: fromCents(stock.reduce((c, i) => c + toCents(itemCostValue(i)), 0)),
      avgDaysInStock: weightedDays(stock.flatMap((i) => {
        const from = acquiredOn(data, i.id);
        return from ? [{ days: Math.max(0, daysBetween(from, today)), units: i.quantity }] : [];
      })),
      tripExpenses: fromCents(tripExpense.get(ref.key) ?? 0),
      sales: ownSales,
      purchaseRecords: ownBuys,
      stillSelling: stock.length > 0,
    };
  });
  const visible = sources
    .filter((s) => (catKey ? s.sales.length || s.unitsRemaining : s.sales.length || s.purchases || s.unitsRemaining || s.hours || s.purchaseRecords.length))
    .sort((a, b) => b.realizedProfit - a.realizedProfit || b.inventoryCost - a.inventoryCost || a.ref.name.localeCompare(b.ref.name));

  const group = (key: string, label: string, members: SourceStats[]): GroupStats => {
    const keys = new Set(members.map((m) => m.ref.key));
    // From the exact shares, not the rounded hours shown per source.
    const seconds = shares.filter((s) => s.sourceKey !== null && keys.has(s.sourceKey)).reduce((c, s) => c + s.seconds, 0);
    return {
      key,
      label,
      ...figures(data, members.flatMap((m) => m.sales), seconds),
      inventoryCost: fromCents(members.reduce((c, m) => c + toCents(m.inventoryCost), 0)),
      unitsRemaining: members.reduce((n, m) => n + m.unitsRemaining, 0),
      sources: members.length,
    };
  };
  const typeKeys = [...new Set(visible.map((s) => s.ref.type ?? 'none'))];
  const types = typeKeys
    .map((k) => group(k, k === 'none' ? 'Type not set' : SOURCE_TYPE_LABELS[k as SourceType], visible.filter((s) => (s.ref.type ?? 'none') === k)))
    .sort((a, b) => b.realizedProfit - a.realizedProfit);

  // Categories: sales by the item's category when sold; time only from item/lot links.
  const catSeconds = new Map<string, number>();
  if (!catKey) for (const c of categoryShares(data, entries)) if (c.category) catSeconds.set(c.category.toLowerCase(), (catSeconds.get(c.category.toLowerCase()) ?? 0) + c.seconds);
  const catLabels = new Map<string, string>();
  for (const x of sales) catLabels.set((x.itemCategory.trim() || 'Uncategorized').toLowerCase(), x.itemCategory.trim() || 'Uncategorized');
  for (const i of stockOf(data.items)) catLabels.set((i.category.trim() || 'Uncategorized').toLowerCase(), i.category.trim() || 'Uncategorized');
  const categories = [...catLabels.entries()]
    .map(([k, label]): GroupStats => {
      const catSales = sales.filter((x) => (x.itemCategory.trim() || 'Uncategorized').toLowerCase() === k);
      const stock = stockOf(data.items).filter((i) => (i.category.trim() || 'Uncategorized').toLowerCase() === k);
      return {
        key: k,
        label,
        ...figures(data, catSales, catSeconds.get(k) ?? 0),
        inventoryCost: fromCents(stock.reduce((c, i) => c + toCents(itemCostValue(i)), 0)),
        unitsRemaining: stock.reduce((n, i) => n + i.quantity, 0),
        sources: new Set(catSales.map((x) => saleSource(data, x).key)).size,
      };
    })
    .sort((a, b) => b.realizedProfit - a.realizedProfit);

  const totalSeconds = entries.reduce((c, e) => c + e.minutes * 60, 0);
  const t = totalSales(sales);
  const minutesBy = (a: string) => entries.filter((e) => e.activity === a).reduce((c, e) => c + e.minutes, 0);
  const missingActivities = sales.length ? (['sourcing', 'listing', 'shipping'] as const).filter((a) => minutesBy(a) === 0) : [];
  return {
    range,
    sources: visible,
    types,
    categories,
    totals: { ...t, hours: hoursOf(totalSeconds), profitPerHour: perHour(t.netProfit, totalSeconds), inventoryCost: fromCents(visible.reduce((c, s) => c + toCents(s.inventoryCost), 0)) },
    unallocatedHours: hoursOf(shares.filter((s) => s.sourceKey === null).reduce((c, s) => c + s.seconds, 0)),
    tripNotSplitHours: hoursOf(shares.filter((s) => s.reason === 'trip_not_split').reduce((c, s) => c + s.seconds, 0)),
    missingActivities,
    unallocatedTripExpenses: fromCents(unallocatedTrip),
    hasTime: totalSeconds > 0,
  };
}

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

export interface SessionStats {
  session: SourcingSession;
  sources: SourceRef[];
  purchases: Purchase[];
  acquisitionCost: number;
  acquisitionExpenses: number;
  operatingExpenses: number;
  tripExpenses: number;
  unitsBought: number;
  unitsSold: number;
  unitsRemaining: number;
  inventoryCost: number;
  revenue: number;
  sellingExpenses: number;
  netProceeds: number;
  realizedProfit: number;
  /** Net proceeds − acquisition cost − trip expenses (whole trip; final only when completed). */
  result: number;
  /** result ÷ (acquisition cost + trip expenses). */
  roiPct: number | null;
  hours: number;
  /** Realized profit ÷ hours logged for the trip, its sources' share of it, its items and lots. */
  profitPerHour: number | null;
  /** Everything bought on the trip is sold or written off. */
  completed: boolean;
  sales: Sale[];
}

export function sessionStats(data: AppData, session: SourcingSession): SessionStats {
  const buys = purchases(data).filter((p) => p.sessionId === session.id);
  const ids = new Set(buys.flatMap((p) => p.itemIds));
  const sales = data.sales.filter((x) => ids.has(x.itemId));
  const t = totalSales(sales);
  const stock = data.items.filter((i) => ids.has(i.id) && i.quantity > 0);
  const acq = session.expenses.filter((e) => e.kind === 'acquisition').reduce((c, e) => c + toCents(e.amount), 0);
  const op = session.expenses.filter((e) => e.kind === 'operating').reduce((c, e) => c + toCents(e.amount), 0);
  const cost = buys.reduce((c, p) => c + toCents(p.cost), 0);
  const net = toCents(t.revenue) - toCents(t.totalExpenses);
  // Time for the trip: entries linked to it, or to its items and lots (each entry counted once).
  const lotIds = new Set(buys.filter((p) => p.kind === 'lot').map((p) => p.id));
  let seconds = 0;
  for (const entry of data.sourcing.timeEntries) {
    for (const { link, seconds: s } of linkSeconds(entry)) {
      if (!link) continue;
      if ((link.kind === 'session' && link.id === session.id) || (link.kind === 'item' && ids.has(link.id)) || (link.kind === 'lot' && lotIds.has(link.id))) seconds += s;
    }
  }
  return {
    session,
    sources: sessionSources(data, session),
    purchases: buys,
    acquisitionCost: fromCents(cost),
    acquisitionExpenses: fromCents(acq),
    operatingExpenses: fromCents(op),
    tripExpenses: fromCents(acq + op),
    unitsBought: buys.reduce((n, p) => n + p.units, 0),
    unitsSold: t.unitsSold,
    unitsRemaining: stock.reduce((n, i) => n + i.quantity, 0),
    inventoryCost: fromCents(stock.reduce((c, i) => c + toCents(itemCostValue(i)), 0)),
    revenue: t.revenue,
    sellingExpenses: t.totalExpenses,
    netProceeds: fromCents(net),
    realizedProfit: t.netProfit,
    result: fromCents(net - cost - acq - op),
    roiPct: pct(net - cost - acq - op, cost + acq + op),
    hours: hoursOf(seconds),
    profitPerHour: perHour(t.netProfit, seconds),
    completed: buys.length > 0 && stock.length === 0,
    sales,
  };
}

/** For pages and the assistant: whether a figure rests on few records. */
export function smallSample(unitsSold: number): boolean {
  return unitsSold < 5;
}

export { purchases as sourcingPurchases, computeSale };
