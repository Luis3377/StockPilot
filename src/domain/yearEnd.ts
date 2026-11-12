// Year-end review actions: checklist decisions, choosing the year-end count, finalizing a year
// (its figures, roll-forward, monthly coverage, count reference, decisions, open issues and
// summary are kept as they are), reopening it (reason required; the review is kept, superseded),
// and the guard that keeps a finalized year's figures from changing.
//
// Interaction with monthly closes: a finalized year refuses changes to any of its months unless
// that month has been explicitly reopened (Monthly Close) since the year was finalized. Reopening
// a month records a "flagged" event on the year, and the year shows as needing re-review; its
// finalized figures never change by themselves. Stored in the browser: a record, not a tamper-proof log.

import type { AppData, CloseDecisionKind, Settings, YearAuditEvent, YearReview, YearStepKey } from './types';
import { DomainError } from './errors';
import { newId } from './ids';
import { nowParts, type Clock } from './actions';
import { localDate } from './ledger';
import { formatDate } from './dates';
import { currentClose, ledgerInfo, monthFingerprint, monthLabel } from '../insights/monthly';
import { currentReview, periodMonths, YEAR_KEY, yearEndCountCandidates, yearPeriod } from '../insights/yearEnd';
import { yearChecklist, YEAR_STEP_TITLES } from '../insights/yearChecklist';
import { yearReport, yearReportSnapshot } from '../insights/yearReport';

const LIMITS = { note: 1000, audit: 5000 } as const;

function audit(data: AppData, ev: Omit<YearAuditEvent, 'id'>): YearAuditEvent[] {
  return [...data.yearEnd.audit, { id: newId(), ...ev }].slice(-LIMITS.audit);
}

function checkYear(key: string) {
  if (!YEAR_KEY.test(key)) throw new DomainError('Choose a year.');
}

function notFinalized(data: AppData, key: string) {
  const r = currentReview(data, key);
  if (r) throw new DomainError(`The ${key} year-end review is finalized (version ${r.version}). Reopen it to make changes.`);
}

export function decideYearStep(data: AppData, settings: Settings, key: string, step: YearStepKey, decision: CloseDecisionKind, note: string, today: string, clock?: Clock): AppData {
  checkYear(key);
  notFinalized(data, key);
  const { iso } = nowParts(clock);
  const s = yearChecklist(data, settings, key, today).steps.find((x) => x.step === step);
  if (!s) throw new DomainError('That step doesn’t exist.');
  const text = note.trim().slice(0, LIMITS.note);
  const attention = s.issues.filter((x) => x.severity === 'attention').length;
  if (decision === 'reviewed') {
    if (!s.canReview) throw new DomainError(`“${s.title}” wasn’t performed for ${key}, so it can’t be marked reviewed. Mark it not applicable, with the reason.`);
    if (attention) throw new DomainError(`“${s.title}” has ${attention === 1 ? 'an open issue' : `${attention} open issues`}. Resolve ${attention === 1 ? 'it' : 'them'}, or acknowledge ${attention === 1 ? 'it' : 'them'} with a note.`);
  }
  if (decision === 'na' && !s.canNA) throw new DomainError(`“${s.title}” has something to review, so it can’t be marked not applicable.`);
  if (decision === 'acknowledged') {
    if (!attention) throw new DomainError('There are no open issues to acknowledge: mark the step reviewed.');
    if (!text) throw new DomainError('Say why these issues can stay open (for example, what you’ll tell your accountant).');
  }
  const finalNote = decision === 'na' ? text || s.naExplanation : text;
  const decisions = [...(data.yearEnd.decisions[key] ?? []).filter((d) => d.step !== step), { step, decision, note: finalNote, at: iso, fingerprint: s.fingerprint }];
  const verb = decision === 'reviewed' ? 'Marked reviewed' : decision === 'na' ? 'Marked not applicable' : `Acknowledged ${attention === 1 ? '1 open issue' : `${attention} open issues`}`;
  return { ...data, yearEnd: { ...data.yearEnd, decisions: { ...data.yearEnd.decisions, [key]: decisions }, audit: audit(data, { at: iso, periodKey: key, kind: decision, detail: `${verb}: ${YEAR_STEP_TITLES[step]}${finalNote ? ` — ${finalNote}` : ''}`, version: null }) } };
}

export function undoYearDecision(data: AppData, key: string, step: YearStepKey, clock?: Clock): AppData {
  checkYear(key);
  notFinalized(data, key);
  const { iso } = nowParts(clock);
  const list = data.yearEnd.decisions[key] ?? [];
  if (!list.some((d) => d.step === step)) return data;
  return { ...data, yearEnd: { ...data.yearEnd, decisions: { ...data.yearEnd.decisions, [key]: list.filter((d) => d.step !== step) }, audit: audit(data, { at: iso, periodKey: key, kind: 'undone', detail: `Decision undone: ${YEAR_STEP_TITLES[step]}`, version: null }) } };
}

/** Chooses (or clears, with null) the Count Check record used as the year's physical count. */
export function designateYearCount(data: AppData, key: string, countId: string | null, clock?: Clock): AppData {
  checkYear(key);
  notFinalized(data, key);
  const { iso } = nowParts(clock);
  const period = yearPeriod(key);
  const counts = { ...data.yearEnd.counts };
  let detail: string;
  if (countId === null) {
    if (!counts[key]) return data;
    delete counts[key];
    detail = 'Year-end count cleared';
  } else {
    const c = yearEndCountCandidates(data, period).find((x) => x.id === countId);
    if (!c) throw new DomainError(`That count wasn’t completed within a month of ${formatDate(period.end)}, so it can’t be the ${key} year-end count.`);
    counts[key] = countId;
    detail = `Year-end count: the count completed ${formatDate(localDate(c.completedAt))} (${c.lines.length} items)`;
  }
  return { ...data, yearEnd: { ...data.yearEnd, counts, audit: audit(data, { at: iso, periodKey: key, kind: 'count', detail, version: null }) } };
}

export interface FinalizeYearInput {
  acknowledged: boolean;
  note: string;
}

export function finalizeYear(data: AppData, settings: Settings, key: string, input: FinalizeYearInput, today: string, clock?: Clock): { data: AppData; review: YearReview } {
  checkYear(key);
  const { iso } = nowParts(clock);
  const report = yearReport(data, settings, key, today, iso);
  const list = report.checklist;
  if (list.review) throw new DomainError(`The ${key} year-end review is already finalized.`);
  if (!list.ready) throw new DomainError(`${key} can’t be finalized yet: ${list.blockers[0]}`);
  if (list.unresolved.length && !input.acknowledged) throw new DomainError(`Confirm that you’ve reviewed the ${list.unresolved.length === 1 ? 'issue' : `${list.unresolved.length} issues`} still open.`);
  const y = list.figures;
  const rf = y.rf;
  const version = data.yearEnd.reviews.filter((r) => r.periodKey === key).length + 1;
  const review: YearReview = {
    id: newId(),
    periodKey: key,
    start: y.period.start,
    end: y.period.end,
    label: y.period.label,
    version,
    finalizedAt: iso,
    status: 'finalized',
    supersededAt: null,
    reopenReason: '',
    figures: {
      beginning: rf.beginning,
      beginningBasis: y.beginning.text,
      purchases: y.purchases,
      capitalizedCosts: y.capitalizedCosts,
      costOfGoodsSold: -y.line('cogs'),
      expectedEnding: rf.expectedEnding,
      recordsEnding: rf.recordsEnding,
      countedEnding: y.count ? y.count.countedEndingCents / 100 : null,
      independentEnding: y.independentEnding,
      independentBasis: y.independentBasis,
      difference: y.difference,
      revenue: y.totals.revenue,
      realizedProfit: y.totals.netProfit,
    },
    rollForward: { status: rf.status, statusText: rf.statusText, beginning: rf.beginning, beginningBasis: rf.beginningBasis, lines: rf.lines.map((l) => ({ key: l.key, label: l.label, amount: l.amount })), expectedEnding: rf.expectedEnding, recordsEnding: rf.recordsEnding, recordsBasis: rf.recordsBasis, difference: rf.difference, notes: rf.notes },
    coverage: y.coverage.months.map((m) => ({ month: m.month, status: m.status, statusText: m.statusText, closeVersion: m.close?.version ?? null })),
    count: y.count ? { countId: y.count.record.id, completedAt: y.count.record.completedAt, timing: y.count.timing, full: y.count.full, countedEnding: y.count.countedEndingCents / 100, differenceFromRecords: y.count.differenceCents / 100 } : null,
    checklist: list.steps.map((s) => ({ step: s.step, title: s.title, state: s.state, note: s.decision?.note ?? '', issues: s.issues.map((x) => x.text) })),
    unresolved: list.unresolved,
    acknowledgement: input.note.trim().slice(0, LIMITS.note),
    report: yearReportSnapshot(report),
  };
  const decisions = { ...data.yearEnd.decisions };
  delete decisions[key];
  return {
    data: { ...data, yearEnd: { ...data.yearEnd, reviews: [...data.yearEnd.reviews, review], decisions, audit: audit(data, { at: iso, periodKey: key, kind: 'finalized', detail: `Finalized the ${key} year-end review (version ${version})${list.unresolved.length ? ` with ${list.unresolved.length} acknowledged open issue${list.unresolved.length === 1 ? '' : 's'}` : ''}${review.acknowledgement ? ` — ${review.acknowledgement}` : ''}`, version }) } },
    review,
  };
}

export function reopenYear(data: AppData, key: string, reason: string, clock?: Clock): AppData {
  checkYear(key);
  const { iso } = nowParts(clock);
  const review = currentReview(data, key);
  if (!review) throw new DomainError(`The ${key} year-end review isn’t finalized.`);
  const why = reason.trim().slice(0, 1000);
  if (why.length < 5) throw new DomainError('Say why you’re reopening the year (at least a few words).');
  const decisions = { ...data.yearEnd.decisions };
  delete decisions[key];
  return {
    ...data,
    yearEnd: {
      ...data.yearEnd,
      reviews: data.yearEnd.reviews.map((r) => (r.id === review.id ? { ...r, status: 'superseded' as const, supersededAt: iso, reopenReason: why } : r)),
      decisions,
      audit: audit(data, { at: iso, periodKey: key, kind: 'reopened', detail: `Reopened the ${key} year-end review (version ${review.version} superseded) — ${why}`, version: review.version }),
    },
  };
}

/** Called when a month is reopened: a finalized year containing it is flagged for re-review (never changed). */
export function flagYearForMonth(data: AppData, month: string, reason: string, iso: string): AppData {
  const review = currentReview(data, month.slice(0, 4));
  if (!review || !periodMonths(yearPeriod(review.periodKey)).includes(month)) return data;
  return { ...data, yearEnd: { ...data.yearEnd, audit: audit(data, { at: iso, periodKey: review.periodKey, kind: 'flagged', detail: `${monthLabel(month)} was reopened (${reason}): the finalized ${review.periodKey} review (version ${review.version}) needs re-review`, version: review.version }) } };
}

/** The month was reopened (and not closed again) after the year was finalized: corrections are allowed there. */
function reopenedSince(data: AppData, month: string, since: string): boolean {
  return !currentClose(data, month) && data.monthlyClose.audit.some((a) => a.kind === 'reopened' && a.month === month && a.at > since);
}

/** Refuses a change that would alter a finalized year's months, unless that month was explicitly reopened. */
export function assertFinalizedYearsUnchanged(before: AppData, after: AppData): void {
  const reviews = after.yearEnd.reviews.filter((r) => r.status === 'finalized' && before.yearEnd.reviews.some((b) => b.id === r.id && b.status === 'finalized'));
  if (!reviews.length) return;
  if (before.sales === after.sales && before.inventoryLedger === after.inventoryLedger && before.adjustments === after.adjustments && before.sourcing.sessions === after.sourcing.sessions) return;
  const bi = ledgerInfo(before);
  const ai = ledgerInfo(after);
  for (const r of reviews) {
    for (const m of periodMonths(yearPeriod(r.periodKey))) {
      if (reopenedSince(after, m, r.finalizedAt)) continue;
      if (monthFingerprint(before, m, bi) !== monthFingerprint(after, m, ai)) {
        throw new DomainError(`That would change ${monthLabel(m)}, part of the finalized ${r.periodKey} year-end review. Reopen the ${r.periodKey} review first (Sales & Profit → Year-End Review; you’ll be asked why), or use a date in an open period.`);
      }
    }
  }
}

