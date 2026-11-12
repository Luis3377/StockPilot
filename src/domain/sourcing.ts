// Sourcing records: where inventory comes from (sources), sourcing trips (sessions), and time
// spent on the business (time entries and a timer). These never change any money figure on
// their own: profit comes from recorded sales, and costs from items and lots.
//
// Sources are unique ignoring case, accents, spacing and punctuation, and near-duplicates are
// flagged before a new one is created. A rename keeps the old name as an alias, so lots whose
// text still says it stay attributed. Every rename, merge and assignment goes into an audit log.

import type {
  AppData,
  Item,
  Lot,
  RunningTimer,
  SessionExpense,
  SharedSplit,
  Source,
  SourceChange,
  SourceType,
  SourcingData,
  SourcingSession,
  TimeActivity,
  TimeEntry,
  TimeLink,
} from './types';
import { DomainError, FieldErrors } from './errors';
import { newId } from './ids';
import { nowParts, optionalDate, optionalMoney, optionalText, requireText, type Clock } from './actions';
import { lotForItem } from './lots';

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  thrift: 'Thrift store',
  garage_sale: 'Garage / yard sale',
  estate_sale: 'Estate sale',
  online_marketplace: 'Online marketplace (Facebook, Craigslist…)',
  liquidation: 'Liquidation supplier',
  storage_auction: 'Storage-unit auction',
  retail: 'Retail store',
  wholesale: 'Online wholesaler',
  auction: 'Auction',
  other: 'Other',
};

export const SOURCE_TYPES = Object.keys(SOURCE_TYPE_LABELS) as SourceType[];

export const ACTIVITY_LABELS: Record<TimeActivity, string> = {
  sourcing: 'Sourcing',
  listing: 'Listing & photos',
  shipping: 'Packing & shipping',
  other: 'Other inventory work',
};

export const ACTIVITIES = Object.keys(ACTIVITY_LABELS) as TimeActivity[];

export const SOURCING_LIMITS = { sources: 500, expenses: 20, links: 20, minutesPerEntry: 24 * 60, changes: 2000 } as const;

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** "Goodwill – West  Little Rock!" and "goodwill west little rock" are the same source. */
export function sourceKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const names = (s: Source) => [s.name, ...s.aliases];

function requireDate(value: string | null, field: string, label: string): string {
  const d = optionalDate(value, field, label);
  if (d === null) throw new DomainError(`${label} is required.`, field);
  return d;
}

/** The registered source with this name (or an earlier name), ignoring case and punctuation. */
export function findSourceByName(data: AppData, name: string): Source | undefined {
  const key = sourceKey(name);
  if (!key) return undefined;
  return data.sourcing.sources.find((s) => names(s).some((n) => sourceKey(n) === key));
}

/** Registered sources whose names are close to this one (likely the same place, spelled differently). */
export function similarSources(data: AppData, name: string): Source[] {
  const key = sourceKey(name);
  if (key.length < 4) return [];
  return data.sourcing.sources.filter((s) =>
    names(s).some((n) => {
      const k = sourceKey(n);
      if (k === key) return false;
      const limit = Math.max(1, Math.floor(Math.min(k.length, key.length) / 6));
      return editDistance(k, key) <= limit || (Math.min(k.length, key.length) >= 6 && (k.includes(key) || key.includes(k)));
    }),
  );
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export interface SourceInput {
  name: string;
  type: SourceType;
  location?: string;
  notes?: string;
}

const withSourcing = (data: AppData, sourcing: Partial<SourcingData>): AppData => ({ ...data, sourcing: { ...data.sourcing, ...sourcing } });

function logged(data: AppData, change: Omit<SourceChange, 'id'>): SourceChange[] {
  return [...data.sourcing.changes, { id: newId(), ...change }].slice(-SOURCING_LIMITS.changes);
}

function checkSource(input: SourceInput, v: FieldErrors) {
  return {
    name: v.check(() => requireText(input.name, 'name', 'Source name', 120)) ?? '',
    type: SOURCE_TYPES.includes(input.type) ? input.type : 'other',
    location: v.check(() => optionalText(input.location, 'location', 'Location or description', 200)) ?? '',
    notes: v.check(() => optionalText(input.notes, 'notes', 'Notes', 2000)) ?? '',
  };
}

export function createSource(data: AppData, input: SourceInput, clock?: Clock): { data: AppData; source: Source } {
  const { iso } = nowParts(clock);
  const v = new FieldErrors();
  const fields = checkSource(input, v);
  const existing = fields.name ? findSourceByName(data, fields.name) : undefined;
  if (existing) v.add('name', `You already have “${existing.name}”. Choose it instead of adding it again.`);
  if (data.sourcing.sources.length >= SOURCING_LIMITS.sources) v.add('name', `You can have up to ${SOURCING_LIMITS.sources} sources.`);
  v.throwIfAny();
  const source: Source = { id: newId(), ...fields, aliases: [], createdAt: iso, updatedAt: iso };
  const next = withSourcing(data, { sources: [...data.sourcing.sources, source] });
  return {
    data: withSourcing(next, { changes: logged(next, { at: iso, kind: 'created', sourceId: source.id, detail: `Added “${source.name}” (${SOURCE_TYPE_LABELS[source.type]}).`, recordKind: null, recordId: null }) }),
    source,
  };
}

function findSource(data: AppData, id: string): Source {
  const s = data.sourcing.sources.find((x) => x.id === id);
  if (!s) throw new DomainError('That source no longer exists.');
  return s;
}

/**
 * Edits a source. A new name keeps the old one as an alias, so records that say the old name
 * stay attributed to it; the change is logged.
 */
export function updateSource(data: AppData, id: string, input: SourceInput, clock?: Clock): { data: AppData; source: Source } {
  const { iso } = nowParts(clock);
  const current = findSource(data, id);
  const v = new FieldErrors();
  const fields = checkSource(input, v);
  const clash = fields.name ? findSourceByName(data, fields.name) : undefined;
  if (clash && clash.id !== id) v.add('name', `“${clash.name}” already has that name. To combine them, merge the sources.`);
  v.throwIfAny();
  const renamed = fields.name !== current.name;
  const aliases = renamed && !current.aliases.some((a) => sourceKey(a) === sourceKey(current.name)) ? [...current.aliases, current.name] : current.aliases;
  const source: Source = { ...current, ...fields, aliases: aliases.filter((a) => sourceKey(a) !== sourceKey(fields.name)), updatedAt: iso };
  let next = withSourcing(data, { sources: data.sourcing.sources.map((s) => (s.id === id ? source : s)) });
  if (renamed) next = withSourcing(next, { changes: logged(next, { at: iso, kind: 'renamed', sourceId: id, detail: `Renamed “${current.name}” to “${source.name}”. Records that say the old name stay with this source.`, recordKind: null, recordId: null }) });
  const edits = [current.type !== source.type && `type ${SOURCE_TYPE_LABELS[current.type]} → ${SOURCE_TYPE_LABELS[source.type]}`, current.location !== source.location && 'location', current.notes !== source.notes && 'notes'].filter(Boolean);
  if (edits.length) next = withSourcing(next, { changes: logged(next, { at: iso, kind: 'edited', sourceId: id, detail: `Edited “${source.name}”: ${edits.join(', ')}.`, recordKind: null, recordId: null }) });
  return { data: next, source };
}

/**
 * Combines two sources that are the same place: everything recorded with `fromId` moves to
 * `intoId`, whose aliases gain the other's names. Explicit and logged.
 */
export function mergeSources(data: AppData, fromId: string, intoId: string, clock?: Clock): { data: AppData; moved: number } {
  const { iso } = nowParts(clock);
  if (fromId === intoId) throw new DomainError('Choose two different sources to merge.');
  const from = findSource(data, fromId);
  const into = findSource(data, intoId);
  let moved = 0;
  const items = data.items.map((i) => (i.sourceId === fromId ? (moved++, { ...i, sourceId: intoId, updatedAt: iso }) : i));
  const lots = data.lots.map((l) => (l.sourceId === fromId ? (moved++, { ...l, sourceId: intoId, updatedAt: iso }) : l));
  const sessions = data.sourcing.sessions.map((s) => (s.sourceIds.includes(fromId) ? { ...s, sourceIds: [...new Set(s.sourceIds.map((x) => (x === fromId ? intoId : x)))] } : s));
  const timeEntries = data.sourcing.timeEntries.map((e) => ({ ...e, links: e.links.map((l) => (l.kind === 'source' && l.id === fromId ? { ...l, id: intoId } : l)) }));
  const timer = data.sourcing.timer && { ...data.sourcing.timer, links: data.sourcing.timer.links.map((l) => (l.kind === 'source' && l.id === fromId ? { ...l, id: intoId } : l)) };
  const merged: Source = { ...into, aliases: [...new Set([...into.aliases, from.name, ...from.aliases])].filter((a) => sourceKey(a) !== sourceKey(into.name)), updatedAt: iso };
  let next: AppData = { ...data, items, lots, sourcing: { ...data.sourcing, sources: data.sourcing.sources.filter((s) => s.id !== fromId).map((s) => (s.id === intoId ? merged : s)), sessions, timeEntries, timer } };
  next = withSourcing(next, { changes: logged(next, { at: iso, kind: 'merged', sourceId: intoId, detail: `Merged “${from.name}” into “${into.name}” (${moved} record${moved === 1 ? '' : 's'} moved).`, recordKind: null, recordId: null }) });
  return { data: next, moved };
}

/** Deletes a source nothing refers to. */
export function deleteSource(data: AppData, id: string, clock?: Clock): AppData {
  const { iso } = nowParts(clock);
  const s = findSource(data, id);
  const used =
    data.items.some((i) => i.sourceId === id) ||
    data.lots.some((l) => l.sourceId === id || (!l.sourceId && names(s).some((n) => sourceKey(n) === sourceKey(l.source)))) ||
    data.sourcing.sessions.some((x) => x.sourceIds.includes(id)) ||
    data.sourcing.timeEntries.some((e) => e.links.some((l) => l.kind === 'source' && l.id === id));
  if (used) throw new DomainError(`“${s.name}” is used by items, lots, trips or time entries. Merge it into another source instead.`);
  const next = withSourcing(data, { sources: data.sourcing.sources.filter((x) => x.id !== id) });
  return withSourcing(next, { changes: logged(next, { at: iso, kind: 'deleted', sourceId: id, detail: `Deleted “${s.name}”.`, recordKind: null, recordId: null }) });
}

/**
 * Records where an item (not in a lot) or a lot was bought, and on which trip. Logged when the
 * source changes. A lot's text is updated to the source's name.
 */
export function assignSource(data: AppData, kind: 'item' | 'lot', recordId: string, sourceId: string | null, clock?: Clock, opts: { newRecord?: boolean } = {}): AppData {
  const { iso } = nowParts(clock);
  const source = sourceId === null ? null : findSource(data, sourceId);
  if (kind === 'item') {
    const item = data.items.find((i) => i.id === recordId);
    if (!item) throw new DomainError('That item no longer exists.');
    if (lotForItem(data, item.id)) throw new DomainError('This item is part of a bulk lot, so it uses the lot’s source.');
    if ((item.sourceId ?? null) === sourceId) return data;
    const before = item.sourceId ? data.sourcing.sources.find((s) => s.id === item.sourceId)?.name ?? 'a deleted source' : 'Unassigned';
    const next = { ...data, items: data.items.map((i) => (i.id === recordId ? { ...i, sourceId, updatedAt: iso } : i)) };
    // Recording where a new item came from isn't a change to its history.
    if (opts.newRecord) return next;
    return withSourcing(next, { changes: logged(next, { at: iso, kind: 'assigned', sourceId, detail: `“${item.name}”: ${before} → ${source?.name ?? 'Unassigned'}.`, recordKind: 'item', recordId }) });
  }
  const lot = data.lots.find((l) => l.id === recordId);
  if (!lot) throw new DomainError('That lot no longer exists.');
  const before = lot.source.trim() || 'Unassigned';
  const unchanged = recordedSourceId(data, lot, 'lot') === sourceId;
  if ((lot.sourceId ?? null) === sourceId && (source ? lot.source === source.name : true)) return data;
  const next = { ...data, lots: data.lots.map((l) => (l.id === recordId ? { ...l, sourceId, source: source ? source.name : l.source, updatedAt: iso } : l)) };
  // Linking a lot to the source its text already names isn't a change of source: not logged.
  if (unchanged || opts.newRecord) return next;
  return withSourcing(next, { changes: logged(next, { at: iso, kind: 'assigned', sourceId, detail: `Lot “${lot.name}”: ${before} → ${source?.name ?? 'Unassigned'}.`, recordKind: 'lot', recordId }) });
}

/**
 * The source for a name typed in a form: the registered one with that name (ignoring case and
 * punctuation, or an earlier name), or a new one of the chosen type. Empty text = no source.
 */
export function resolveSource(data: AppData, text: string, type: SourceType, clock?: Clock): { data: AppData; sourceId: string | null; created: Source | null } {
  const name = text.trim();
  if (!name) return { data, sourceId: null, created: null };
  const found = findSourceByName(data, name);
  if (found) return { data, sourceId: found.id, created: null };
  const r = createSource(data, { name, type }, clock);
  return { data: r.data, sourceId: r.source.id, created: r.source };
}

/** A starting guess at a new source's type from its name (shown, and changeable, in the form). */
export function guessSourceType(name: string): SourceType {
  const n = name.toLowerCase();
  const rules: [RegExp, SourceType][] = [
    [/goodwill|salvation army|thrift|savers|value village|habitat restore|st\.? vincent/, 'thrift'],
    [/garage|yard sale|rummage/, 'garage_sale'],
    [/estate/, 'estate_sale'],
    [/facebook|marketplace|craigslist|offerup|mercari|nextdoor/, 'online_marketplace'],
    [/liquidat|pallet|bstock|b-stock|direct liquidation/, 'liquidation'],
    [/storage/, 'storage_auction'],
    [/wholesale|alibaba|faire/, 'wholesale'],
    [/auction|hibid|bidding/, 'auction'],
    [/walmart|target|store|outlet|mall|retail|clearance|tj ?maxx|marshalls|ross/, 'retail'],
  ];
  return rules.find(([re]) => re.test(n))?.[1] ?? 'other';
}

/** Puts an item (not in a lot) or a lot on a sourcing trip, or takes it off (null). No purchase is created. */
export function linkToSession(data: AppData, kind: 'item' | 'lot', recordId: string, sessionId: string | null): AppData {
  if (sessionId !== null && !data.sourcing.sessions.some((s) => s.id === sessionId)) throw new DomainError('That trip no longer exists.');
  if (kind === 'item') {
    const item = data.items.find((i) => i.id === recordId);
    if (!item) throw new DomainError('That item no longer exists.');
    if (lotForItem(data, item.id)) throw new DomainError('This item is part of a bulk lot, so it uses the lot’s trip.');
    return { ...data, items: data.items.map((i) => (i.id === recordId ? { ...i, sessionId } : i)) };
  }
  if (!data.lots.some((l) => l.id === recordId)) throw new DomainError('That lot no longer exists.');
  return { ...data, lots: data.lots.map((l) => (l.id === recordId ? { ...l, sessionId } : l)) };
}

/** Where an item or lot came from, as recorded (for forms). */
export function recordedSourceId(data: AppData, record: Item | Lot, kind: 'item' | 'lot'): string | null {
  if (kind === 'item') {
    const lot = lotForItem(data, record.id);
    return lot ? recordedSourceId(data, lot.lot, 'lot') : ((record as Item).sourceId ?? null);
  }
  const lot = record as Lot;
  if (lot.sourceId) {
    const s = data.sourcing.sources.find((x) => x.id === lot.sourceId);
    if (s && (!lot.source.trim() || names(s).some((n) => sourceKey(n) === sourceKey(lot.source)))) return s.id;
  }
  return lot.source.trim() ? (findSourceByName(data, lot.source)?.id ?? null) : null;
}

// ---------------------------------------------------------------------------
// Sourcing trips
// ---------------------------------------------------------------------------

export interface SessionInput {
  name: string;
  date: string | null;
  sourceIds: string[];
  notes?: string;
  expenses: { id?: string; label: string; amount: number | null; kind: SessionExpense['kind'] }[];
  split: SharedSplit | null;
}

function checkSession(data: AppData, input: SessionInput): Omit<SourcingSession, 'id' | 'createdAt' | 'updatedAt'> {
  const v = new FieldErrors();
  const name = v.check(() => requireText(input.name, 'name', 'Trip name', 120));
  const date = v.check(() => requireDate(input.date, 'date', 'Date'));
  const notes = v.check(() => optionalText(input.notes, 'notes', 'Notes', 2000));
  const sourceIds = [...new Set(input.sourceIds)];
  if (sourceIds.some((id) => !data.sourcing.sources.some((s) => s.id === id))) v.add('sourceIds', 'One of the sources no longer exists.');
  if (input.expenses.length > SOURCING_LIMITS.expenses) v.add('expenses', `A trip can have up to ${SOURCING_LIMITS.expenses} expenses.`);
  const expenses = input.expenses.flatMap((e, i) => {
    const label = v.check(() => optionalText(e.label, `expense.${i}.label`, 'Expense', 80)) ?? '';
    if (e.amount === null && !label) return [];
    const amount = v.check(() => optionalMoney(e.amount, `expense.${i}.amount`, 'Amount'));
    if (amount === null) v.add(`expense.${i}.amount`, 'Amount is required.');
    return amount === undefined || amount === null ? [] : [{ id: e.id || newId(), label: label || 'Trip expense', amount, kind: e.kind === 'acquisition' ? ('acquisition' as const) : ('operating' as const) }];
  });
  v.throwIfAny();
  return { name: name!, date: date!, sourceIds, notes: notes ?? '', expenses, split: sourceIds.length > 1 ? input.split : null };
}

export function createSession(data: AppData, input: SessionInput, clock?: Clock): { data: AppData; session: SourcingSession } {
  const { iso } = nowParts(clock);
  const session: SourcingSession = { id: newId(), ...checkSession(data, input), createdAt: iso, updatedAt: iso };
  return { data: withSourcing(data, { sessions: [session, ...data.sourcing.sessions] }), session };
}

export function updateSession(data: AppData, id: string, input: SessionInput, clock?: Clock): { data: AppData; session: SourcingSession } {
  const { iso } = nowParts(clock);
  const current = data.sourcing.sessions.find((s) => s.id === id);
  if (!current) throw new DomainError('That trip no longer exists.');
  const session: SourcingSession = { ...current, ...checkSession(data, input), updatedAt: iso };
  return { data: withSourcing(data, { sessions: data.sourcing.sessions.map((s) => (s.id === id ? session : s)) }), session };
}

/** Deletes a trip. Its items and lots stay (just no longer on a trip); time linked only to it becomes general. */
export function deleteSession(data: AppData, id: string): AppData {
  if (!data.sourcing.sessions.some((s) => s.id === id)) throw new DomainError('That trip no longer exists.');
  const unlink = (links: TimeLink[]) => links.filter((l) => !(l.kind === 'session' && l.id === id));
  return {
    ...data,
    items: data.items.map((i) => (i.sessionId === id ? { ...i, sessionId: null } : i)),
    lots: data.lots.map((l) => (l.sessionId === id ? { ...l, sessionId: null } : l)),
    sourcing: {
      ...data.sourcing,
      sessions: data.sourcing.sessions.filter((s) => s.id !== id),
      timeEntries: data.sourcing.timeEntries.map((e) => ({ ...e, links: unlink(e.links) })),
      timer: data.sourcing.timer && { ...data.sourcing.timer, links: unlink(data.sourcing.timer.links) },
    },
  };
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export interface TimeEntryInput {
  date: string | null;
  minutes: number | null;
  activity: TimeActivity;
  note?: string;
  links: TimeLink[];
  split: 'equal' | 'custom';
}

function linkExists(data: AppData, l: TimeLink): boolean {
  switch (l.kind) {
    case 'session':
      return data.sourcing.sessions.some((s) => s.id === l.id);
    case 'source':
      return data.sourcing.sources.some((s) => s.id === l.id);
    case 'lot':
      return data.lots.some((x) => x.id === l.id);
    case 'item':
      return data.items.some((x) => x.id === l.id);
  }
}

function checkLinks(data: AppData, links: TimeLink[], split: 'equal' | 'custom', v: FieldErrors): TimeLink[] {
  const seen = new Set<string>();
  const out = links.filter((l) => {
    const k = `${l.kind}:${l.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (out.length > SOURCING_LIMITS.links) v.add('links', `Link to at most ${SOURCING_LIMITS.links} things.`);
  if (out.some((l) => !linkExists(data, l))) v.add('links', 'Something this time is linked to no longer exists.');
  if (split === 'custom' && out.length > 1) {
    const shares = out.map((l) => l.sharePct ?? NaN);
    if (shares.some((x) => !Number.isFinite(x) || x <= 0 || Math.abs(x * 100 - Math.round(x * 100)) > 1e-6)) v.add('links', 'Give every link a share above 0% (up to 2 decimals).');
    else if (Math.round(shares.reduce((a, b) => a + b, 0) * 100) !== 10000) v.add('links', 'The shares must add up to 100%.');
  }
  return out.map((l) => ({ kind: l.kind, id: l.id, sharePct: split === 'custom' && out.length > 1 ? l.sharePct : null }));
}

function checkEntry(data: AppData, input: TimeEntryInput) {
  const v = new FieldErrors();
  const date = v.check(() => requireDate(input.date, 'date', 'Date'));
  const minutes = input.minutes;
  if (minutes === null || !Number.isFinite(minutes)) v.add('minutes', 'Enter how long you worked.');
  else if (!Number.isInteger(minutes) || minutes < 1) v.add('minutes', 'Time must be at least 1 minute, in whole minutes.');
  else if (minutes > SOURCING_LIMITS.minutesPerEntry) v.add('minutes', 'One entry can be at most 24 hours. Split longer work into several entries.');
  const note = v.check(() => optionalText(input.note, 'note', 'Note', 500));
  const split: 'equal' | 'custom' = input.split === 'custom' ? 'custom' : 'equal';
  const links = checkLinks(data, input.links, split, v);
  v.throwIfAny();
  return { date: date!, minutes: minutes!, activity: ACTIVITIES.includes(input.activity) ? input.activity : 'other', note: note ?? '', links, split: links.length > 1 ? split : ('equal' as 'equal' | 'custom') };
}

export function addTimeEntry(data: AppData, input: TimeEntryInput, clock?: Clock): { data: AppData; entry: TimeEntry } {
  const { iso } = nowParts(clock);
  const entry: TimeEntry = { id: newId(), ...checkEntry(data, input), createdAt: iso, updatedAt: iso };
  return { data: withSourcing(data, { timeEntries: [entry, ...data.sourcing.timeEntries] }), entry };
}

export function updateTimeEntry(data: AppData, id: string, input: TimeEntryInput, clock?: Clock): { data: AppData; entry: TimeEntry } {
  const { iso } = nowParts(clock);
  const current = data.sourcing.timeEntries.find((e) => e.id === id);
  if (!current) throw new DomainError('That time entry no longer exists.');
  const entry: TimeEntry = { ...current, ...checkEntry(data, input), updatedAt: iso };
  return { data: withSourcing(data, { timeEntries: data.sourcing.timeEntries.map((e) => (e.id === id ? entry : e)) }), entry };
}

export function deleteTimeEntry(data: AppData, id: string): AppData {
  if (!data.sourcing.timeEntries.some((e) => e.id === id)) throw new DomainError('That time entry no longer exists.');
  return withSourcing(data, { timeEntries: data.sourcing.timeEntries.filter((e) => e.id !== id) });
}

// --- Timer: saved with the data, so it keeps counting if the app is closed ---------------

export function timerElapsedMs(timer: RunningTimer, now: Date = new Date()): number {
  const running = timer.runningSince ? Math.max(0, now.getTime() - Date.parse(timer.runningSince)) : 0;
  return timer.accumulatedMs + running;
}

export function startTimer(data: AppData, input: { activity: TimeActivity; links: TimeLink[]; note?: string }, clock?: Clock): AppData {
  const { iso } = nowParts(clock);
  if (data.sourcing.timer) throw new DomainError('A timer is already running. Stop it first.');
  const v = new FieldErrors();
  const links = checkLinks(data, input.links, 'equal', v);
  v.throwIfAny();
  return withSourcing(data, { timer: { activity: ACTIVITIES.includes(input.activity) ? input.activity : 'other', note: (input.note ?? '').slice(0, 500), links, startedAt: iso, runningSince: iso, accumulatedMs: 0 } });
}

export function pauseTimer(data: AppData, clock?: Clock): AppData {
  const t = data.sourcing.timer;
  if (!t || !t.runningSince) return data;
  const now = clock?.now ?? new Date();
  return withSourcing(data, { timer: { ...t, accumulatedMs: timerElapsedMs(t, now), runningSince: null } });
}

export function resumeTimer(data: AppData, clock?: Clock): AppData {
  const t = data.sourcing.timer;
  if (!t || t.runningSince) return data;
  return withSourcing(data, { timer: { ...t, runningSince: nowParts(clock).iso } });
}

/** Stops the timer and saves its time as an entry (rounded to the nearest minute, at least 1). */
export function stopTimer(data: AppData, clock?: Clock): { data: AppData; entry: TimeEntry | null } {
  const t = data.sourcing.timer;
  if (!t) return { data, entry: null };
  const now = clock?.now ?? new Date();
  const minutes = Math.min(SOURCING_LIMITS.minutesPerEntry, Math.max(1, Math.round(timerElapsedMs(t, now) / 60000)));
  // Links that disappeared while it ran (a deleted lot…) are dropped rather than failing.
  const links = t.links.filter((l) => linkExists(data, l));
  const cleared = withSourcing(data, { timer: null });
  const r = addTimeEntry(cleared, { date: t.startedAt.slice(0, 10), minutes, activity: t.activity, note: t.note, links, split: 'equal' }, clock);
  return r;
}

export function discardTimer(data: AppData): AppData {
  return withSourcing(data, { timer: null });
}
