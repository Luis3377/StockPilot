// Financial planning actions: the tax reserve percentage, reserve categories, entries the user
// records (deposits, withdrawals, adjustments; voided rather than deleted), and upcoming
// obligations (planning records that never create expenses). Every change is in the planning log.

import type { AppData, Obligation, ObligationCategory, PlanningAuditEvent, ReserveCategory, ReserveEntry, ReserveKind } from './types';
import { DomainError, FieldErrors } from './errors';
import { newId } from './ids';
import { nowParts, optionalText, requireMoney, requireText, type Clock } from './actions';
import { formatDate, isValidISODate } from './dates';
import { formatMoney, fromCents, toCents } from './money';

/** Amounts in messages and the log, without a currency symbol (the currency is a display setting). */
/** The time, and the currency used in messages and history text (amounts are plain numbers without it). */
export type PlanningClock = Clock & { currency?: string };
const amt = (n: number, currency?: string) => (currency ? formatMoney(n, currency) : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
import { balanceCents, entryCents, occurrenceDates, percentText } from '../insights/planning';

const LIMITS = { categories: 30, entries: 20000, obligations: 500, audit: 5000 } as const;

export const RESERVE_KIND_LABELS: Record<ReserveKind, string> = {
  tax: 'Taxes',
  equipment: 'Equipment replacement',
  inventory_fund: 'Inventory purchasing fund',
  emergency: 'Emergency reserve',
  upcoming: 'Upcoming business expenses',
  other: 'Other',
};

export const OBLIGATION_LABELS: Record<ObligationCategory, string> = {
  tax_payment: 'Tax payment',
  equipment: 'Equipment purchase',
  insurance: 'Insurance',
  software: 'Software subscription',
  inventory_purchase: 'Large inventory purchase',
  rent: 'Rent or lease',
  other: 'Other',
};

function log(data: AppData, at: string, kind: PlanningAuditEvent['kind'], detail: string): PlanningAuditEvent[] {
  return [...data.planning.audit, { id: newId(), at, kind, detail }].slice(-LIMITS.audit);
}

const key = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function checkPercent(v: number | null | undefined, field = 'percent'): number {
  if (v === null || v === undefined || !Number.isFinite(v)) throw new DomainError('Enter a percentage from 0 to 100.', field);
  if (v < 0 || v > 100) throw new DomainError('Enter a percentage from 0 to 100.', field);
  if (Math.abs(Math.round(v * 100) - v * 100) > 1e-6) throw new DomainError('Use at most two decimals (for example 22.5).', field);
  return Math.round(v * 100) / 100;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export interface CategoryInput {
  name: string;
  kind: ReserveKind;
  mode: 'percent' | 'goal';
  percent?: number | null;
  goal?: number | null;
}

function validateCategory(data: AppData, input: CategoryInput, id: string | null): Omit<ReserveCategory, 'id' | 'createdAt' | 'updatedAt' | 'archived'> {
  const v = new FieldErrors();
  const name = v.check(() => requireText(input.name, 'name', 'Name', 80));
  const others = data.planning.categories.filter((c) => c.id !== id && !c.archived);
  if (name && others.some((c) => key(c.name) === key(name))) v.add('name', `You already have a reserve called “${others.find((c) => key(c.name) === key(name))!.name}”.`);
  if (input.kind === 'tax' && others.some((c) => c.kind === 'tax')) v.add('kind', 'You already have a tax reserve. Change its percentage instead.');
  if (input.kind === 'tax' && input.mode !== 'percent') v.add('mode', 'The tax reserve is a percentage of profit.');
  const percent = input.mode === 'percent' ? v.check(() => checkPercent(input.percent)) : null;
  const goal = input.mode === 'goal' ? v.check(() => requireMoney(input.goal, 'goal', 'Goal')) : null;
  if (input.mode === 'goal' && goal === 0) v.add('goal', 'Enter a goal above zero.');
  v.throwIfAny();
  return { name: name!, kind: input.kind, mode: input.mode, percent: percent ?? null, goal: goal ?? null };
}

export function addCategory(data: AppData, input: CategoryInput, clock?: PlanningClock): { data: AppData; category: ReserveCategory } {
  const { iso } = nowParts(clock);
  if (data.planning.categories.filter((c) => !c.archived).length >= LIMITS.categories) throw new DomainError(`You can have up to ${LIMITS.categories} reserves.`);
  const fields = validateCategory(data, input, null);
  const category: ReserveCategory = { id: newId(), ...fields, archived: false, createdAt: iso, updatedAt: iso };
  const what = category.mode === 'percent' ? `${percentText(category.percent!)} of profit` : `goal ${amt(category.goal!, clock?.currency)}`;
  return { data: { ...data, planning: { ...data.planning, categories: [...data.planning.categories, category], audit: log(data, iso, 'category', `Added reserve “${category.name}” (${what})`) } }, category };
}

export function updateCategory(data: AppData, id: string, input: CategoryInput, clock?: PlanningClock): AppData {
  const { iso } = nowParts(clock);
  const existing = data.planning.categories.find((c) => c.id === id);
  if (!existing) throw new DomainError('That reserve no longer exists.');
  const fields = validateCategory(data, { ...input, kind: existing.kind === 'tax' ? 'tax' : input.kind }, id);
  const changes: string[] = [];
  if (fields.name !== existing.name) changes.push(`renamed “${existing.name}” → “${fields.name}”`);
  if (fields.percent !== existing.percent) changes.push(`percentage ${existing.percent === null ? '—' : percentText(existing.percent)} → ${fields.percent === null ? '—' : percentText(fields.percent)}`);
  if (fields.kind !== existing.kind) changes.push(`kind ${RESERVE_KIND_LABELS[existing.kind]} → ${RESERVE_KIND_LABELS[fields.kind]}`);
  if (fields.goal !== existing.goal) changes.push(`goal ${existing.goal === null ? '—' : amt(existing.goal, clock?.currency)} → ${fields.goal === null ? '—' : amt(fields.goal, clock?.currency)}`);
  if (!changes.length) return data;
  const updated: ReserveCategory = { ...existing, ...fields, updatedAt: iso };
  return {
    ...data,
    planning: { ...data.planning, categories: data.planning.categories.map((c) => (c.id === id ? updated : c)), audit: log(data, iso, fields.percent !== existing.percent ? 'percent' : 'category', `Reserve “${updated.name}”: ${changes.join('; ')}`) },
  };
}

/** Sets the tax reserve percentage (creating the tax reserve the first time). The user chooses it; there is no default rate. */
export function setTaxPercent(data: AppData, percent: number | null, clock?: PlanningClock): AppData {
  const p = checkPercent(percent);
  const tax = data.planning.categories.find((c) => c.kind === 'tax' && !c.archived);
  if (!tax) return addCategory(data, { name: 'Taxes', kind: 'tax', mode: 'percent', percent: p }, clock).data;
  return updateCategory(data, tax.id, { name: tax.name, kind: 'tax', mode: 'percent', percent: p }, clock);
}

/** Hides a reserve from planning; its history stays. */
export function archiveCategory(data: AppData, id: string, clock?: PlanningClock): AppData {
  const { iso } = nowParts(clock);
  const c = data.planning.categories.find((x) => x.id === id);
  if (!c || c.archived) return data;
  return { ...data, planning: { ...data.planning, categories: data.planning.categories.map((x) => (x.id === id ? { ...x, archived: true, updatedAt: iso } : x)), audit: log(data, iso, 'category', `Archived reserve “${c.name}” (its history is kept)`) } };
}

// ---------------------------------------------------------------------------
// Entries: what the user says they set aside
// ---------------------------------------------------------------------------

export interface EntryInput {
  categoryId: string;
  date: string;
  kind: 'deposit' | 'withdrawal' | 'adjustment';
  amount: number | null;
  note?: string;
}

export function addEntry(data: AppData, input: EntryInput, opts: { allowDuplicate?: boolean } = {}, clock?: PlanningClock): { data: AppData; entry: ReserveEntry } {
  const { iso, today } = nowParts(clock);
  if (data.planning.entries.length >= LIMITS.entries) throw new DomainError(`You’ve reached ${LIMITS.entries.toLocaleString('en-US')} reserve entries, the most StockPilot keeps. Older entries are never removed automatically.`);
  const v = new FieldErrors();
  const c = data.planning.categories.find((x) => x.id === input.categoryId && !x.archived);
  if (!c) v.add('categoryId', 'Choose a reserve.');
  if (!input.date || !isValidISODate(input.date)) v.add('date', 'Enter a valid date.');
  else if (input.date > today) v.add('date', 'Record money once it’s set aside: the date can’t be in the future.');
  let amount: number | undefined;
  if (input.kind === 'adjustment') {
    if (input.amount === null || !Number.isFinite(input.amount) || input.amount === 0) v.add('amount', 'Enter the adjustment (negative to reduce).');
    else if (Math.abs(Math.round(input.amount * 100) - input.amount * 100) > 1e-6) v.add('amount', 'Use at most two decimals.');
    else amount = Math.round(input.amount * 100) / 100;
  } else {
    amount = v.check(() => requireMoney(input.amount, 'amount', 'Amount'));
    if (amount === 0) v.add('amount', 'Enter an amount above $0.');
  }
  const note = v.check(() => optionalText(input.note, 'note', 'Note', 500));
  v.throwIfAny();
  const entry: ReserveEntry = { id: newId(), categoryId: c!.id, date: input.date, kind: input.kind, amount: amount!, note: note ?? '', createdAt: iso, voidedAt: null, voidReason: '' };
  if (input.kind === 'withdrawal' || (input.kind === 'adjustment' && amount! < 0)) {
    const balance = balanceCents(data, c!.id, '9999-12-31');
    if (balance + entryCents(entry) < 0) throw new DomainError(`That would take “${c!.name}” below zero: you’ve recorded ${amt(fromCents(balance), clock?.currency)} set aside.`, 'amount');
  }
  if (!opts.allowDuplicate) {
    const dup = data.planning.entries.find((e) => e.voidedAt === null && e.categoryId === entry.categoryId && e.date === entry.date && e.kind === entry.kind && toCents(e.amount) === toCents(entry.amount));
    if (dup) throw new DomainError(`You already recorded a ${entry.kind} of ${amt(entry.amount, clock?.currency)} to “${c!.name}” on ${formatDate(entry.date)}. Record it again only if it’s a separate transfer.`, 'duplicate');
  }
  const verb = entry.kind === 'deposit' ? 'Set aside' : entry.kind === 'withdrawal' ? 'Took out' : 'Adjusted';
  return { data: { ...data, planning: { ...data.planning, entries: [...data.planning.entries, entry], audit: log(data, iso, 'entry', `${verb} ${amt(Math.abs(entry.amount), clock?.currency)} ${entry.kind === 'withdrawal' ? 'from' : 'for'} “${c!.name}” on ${formatDate(entry.date)}${entry.note ? ` — ${entry.note}` : ''}`) } }, entry };
}

/** Voids an entry (kept in the history, no longer counted). */
export function voidEntry(data: AppData, id: string, reason: string, clock?: PlanningClock): AppData {
  const { iso } = nowParts(clock);
  const e = data.planning.entries.find((x) => x.id === id);
  if (!e) throw new DomainError('That entry no longer exists.');
  if (e.voidedAt) return data;
  const why = reason.trim();
  if (!why) throw new DomainError('Say why you’re voiding it (for example, entered twice).', 'reason');
  if (e.kind === 'deposit' || (e.kind === 'adjustment' && e.amount > 0)) {
    const balance = balanceCents(data, e.categoryId, '9999-12-31');
    if (balance - entryCents(e) < 0) throw new DomainError('Voiding this would leave the reserve below zero; void the later withdrawal first.');
  }
  const c = data.planning.categories.find((x) => x.id === e.categoryId);
  return { ...data, planning: { ...data.planning, entries: data.planning.entries.map((x) => (x.id === id ? { ...x, voidedAt: iso, voidReason: why.slice(0, 500) } : x)), audit: log(data, iso, 'void', `Voided the ${formatDate(e.date)} ${e.kind} of ${amt(Math.abs(e.amount), clock?.currency)} (“${c?.name ?? 'reserve'}”) — ${why}`) } };
}

// ---------------------------------------------------------------------------
// Obligations: planning records, never expenses
// ---------------------------------------------------------------------------

export interface ObligationInput {
  description: string;
  category: ObligationCategory;
  dueDate: string;
  amount: number | null;
  recurrence: Obligation['recurrence'];
  endDate?: string | null;
  reserveCategoryId?: string | null;
  note?: string;
}

function validateObligation(data: AppData, input: ObligationInput, id: string | null, currency?: string) {
  const v = new FieldErrors();
  const description = v.check(() => requireText(input.description, 'description', 'Description', 200));
  if (!input.dueDate || !isValidISODate(input.dueDate)) v.add('dueDate', 'Enter the expected date.');
  const amount = v.check(() => requireMoney(input.amount, 'amount', 'Estimated amount'));
  const endDate = input.endDate || null;
  if (endDate && (!isValidISODate(endDate) || endDate < input.dueDate)) v.add('endDate', 'The end date must be on or after the first date.');
  const note = v.check(() => optionalText(input.note, 'note', 'Note', 500));
  if (input.reserveCategoryId && !data.planning.categories.some((c) => c.id === input.reserveCategoryId)) v.add('reserveCategoryId', 'That reserve no longer exists.');
  if (description && !('dueDate' in v.errors) && amount !== undefined) {
    const dup = data.planning.obligations.find((o) => o.id !== id && !o.cancelled && key(o.description) === key(description) && o.dueDate === input.dueDate && toCents(o.amount) === toCents(amount));
    if (dup) v.add('description', `“${dup.description}” is already planned for ${formatDate(dup.dueDate)} at ${amt(dup.amount, currency)}.`);
  }
  v.throwIfAny();
  return { description: description!, category: input.category, dueDate: input.dueDate, amount: amount!, recurrence: input.recurrence, endDate: input.recurrence === 'none' ? null : endDate, reserveCategoryId: input.reserveCategoryId || null, note: note ?? '' };
}

export function addObligation(data: AppData, input: ObligationInput, clock?: PlanningClock): { data: AppData; obligation: Obligation } {
  const { iso } = nowParts(clock);
  if (data.planning.obligations.length >= LIMITS.obligations) throw new DomainError(`You can plan up to ${LIMITS.obligations} obligations.`);
  const fields = validateObligation(data, input, null, clock?.currency);
  const obligation: Obligation = { id: newId(), ...fields, completed: [], cancelled: false, createdAt: iso, updatedAt: iso };
  return { data: { ...data, planning: { ...data.planning, obligations: [...data.planning.obligations, obligation], audit: log(data, iso, 'obligation', `Planned “${obligation.description}”: ${amt(obligation.amount, clock?.currency)} on ${formatDate(obligation.dueDate)}${obligation.recurrence === 'none' ? '' : `, repeating ${obligation.recurrence}`}`) } }, obligation };
}

export function updateObligation(data: AppData, id: string, input: ObligationInput, clock?: PlanningClock): AppData {
  const { iso } = nowParts(clock);
  const existing = data.planning.obligations.find((o) => o.id === id);
  if (!existing) throw new DomainError('That obligation no longer exists.');
  const fields = validateObligation(data, input, id, clock?.currency);
  return { ...data, planning: { ...data.planning, obligations: data.planning.obligations.map((o) => (o.id === id ? { ...o, ...fields, updatedAt: iso } : o)), audit: log(data, iso, 'obligation', `Edited “${fields.description}”: ${amt(fields.amount, clock?.currency)} on ${formatDate(fields.dueDate)}`) } };
}

/** Marks one occurrence of an obligation done (or not done). Records nothing as an expense. */
export function setOccurrenceDone(data: AppData, id: string, date: string, done: boolean, clock?: PlanningClock): AppData {
  const { iso } = nowParts(clock);
  const o = data.planning.obligations.find((x) => x.id === id);
  if (!o) throw new DomainError('That obligation no longer exists.');
  if (!occurrenceDates(o, date, date).length) throw new DomainError('That date isn’t one of this obligation’s dates.');
  const completed = done ? [...new Set([...o.completed, date])].sort() : o.completed.filter((d) => d !== date);
  if (completed.length === o.completed.length && completed.every((d, i) => d === o.completed[i])) return data;
  return { ...data, planning: { ...data.planning, obligations: data.planning.obligations.map((x) => (x.id === id ? { ...x, completed, updatedAt: iso } : x)), audit: log(data, iso, 'completed', `${done ? 'Marked done' : 'Marked not done'}: “${o.description}” on ${formatDate(date)}`) } };
}

export function cancelObligation(data: AppData, id: string, clock?: PlanningClock): AppData {
  const { iso } = nowParts(clock);
  const o = data.planning.obligations.find((x) => x.id === id);
  if (!o || o.cancelled) return data;
  return { ...data, planning: { ...data.planning, obligations: data.planning.obligations.map((x) => (x.id === id ? { ...x, cancelled: true, updatedAt: iso } : x)), audit: log(data, iso, 'obligation', `Cancelled “${o.description}” (kept in the history)`) } };
}
