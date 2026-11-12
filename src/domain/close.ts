// Monthly close actions: checklist decisions, closing a month (its figures, roll-forward,
// checklist, acknowledged issues and Controller's Report are kept as they were), reopening it
// (a reason is required; the close is marked superseded, never deleted), and the guard that
// refuses changes to a closed month's figures. Every step is written to the close audit log.
//
// This is a record kept in the browser with the rest of the data, not a tamper-proof ledger.

import type { AppData, CloseAuditEvent, CloseDecisionKind, CloseStepKey, MonthClose, Settings } from './types';
import { DomainError } from './errors';
import { newId } from './ids';
import { nowParts, type Clock } from './actions';
import { closeChecklist, STEP_TITLES } from '../insights/closeChecklist';
import { controllerReport, reportSnapshot } from '../insights/controllerReport';
import { currentClose, ledgerInfo, MONTH_KEY, monthFingerprint, monthLabel } from '../insights/monthly';
import { flagYearForMonth } from './yearEnd';

export const CLOSE_LIMITS = { note: 1000, reason: 1000, audit: 5000 } as const;

function audit(data: AppData, ev: Omit<CloseAuditEvent, 'id'>): CloseAuditEvent[] {
  return [...data.monthlyClose.audit, { id: newId(), ...ev }].slice(-CLOSE_LIMITS.audit);
}

function checkMonth(month: string) {
  if (!MONTH_KEY.test(month)) throw new DomainError('Choose a month.');
}

/** Records a checklist decision for one step of an open month. */
export function decideStep(data: AppData, settings: Settings, month: string, step: CloseStepKey, decision: CloseDecisionKind, note: string, today: string, clock?: Clock): AppData {
  checkMonth(month);
  const { iso } = nowParts(clock);
  if (currentClose(data, month)) throw new DomainError(`${monthLabel(month)} is closed. Reopen it to change its checklist.`);
  const list = closeChecklist(data, settings, month, today);
  const s = list.steps.find((x) => x.step === step);
  if (!s) throw new DomainError('That checklist step doesn’t exist.');
  const text = note.trim().slice(0, CLOSE_LIMITS.note);
  const attention = s.issues.filter((x) => x.severity === 'attention').length;
  if (decision === 'reviewed') {
    if (!s.canReview) throw new DomainError(`“${s.title}” couldn’t be performed for ${monthLabel(month)}, so it can’t be marked reviewed. Mark it not applicable, with the reason.`);
    if (attention) throw new DomainError(`“${s.title}” has ${attention === 1 ? 'an open issue' : `${attention} open issues`}. Resolve ${attention === 1 ? 'it' : 'them'}, or acknowledge ${attention === 1 ? 'it' : 'them'} with a note.`);
  }
  if (decision === 'na' && !s.canNA) throw new DomainError(`“${s.title}” has records to review, so it can’t be marked not applicable.`);
  if (decision === 'acknowledged') {
    if (!attention) throw new DomainError('There are no open issues to acknowledge: mark the step reviewed.');
    if (!text) throw new DomainError('Say why these issues can stay open (for example, what you’ll do next month).');
  }
  const finalNote = decision === 'na' ? text || s.naExplanation : text;
  const decisions = [...(data.monthlyClose.decisions[month] ?? []).filter((d) => d.step !== step), { step, decision, note: finalNote, at: iso, fingerprint: s.fingerprint }];
  const verb = decision === 'reviewed' ? 'Marked reviewed' : decision === 'na' ? 'Marked not applicable' : `Acknowledged ${attention === 1 ? '1 open issue' : `${attention} open issues`}`;
  return {
    ...data,
    monthlyClose: {
      ...data.monthlyClose,
      decisions: { ...data.monthlyClose.decisions, [month]: decisions },
      audit: audit(data, { at: iso, month, kind: decision, step, detail: `${verb}: ${STEP_TITLES[step]}${finalNote ? ` — ${finalNote}` : ''}`, version: null }),
    },
  };
}

export function undoDecision(data: AppData, month: string, step: CloseStepKey, clock?: Clock): AppData {
  checkMonth(month);
  const { iso } = nowParts(clock);
  if (currentClose(data, month)) throw new DomainError(`${monthLabel(month)} is closed. Reopen it to change its checklist.`);
  const list = data.monthlyClose.decisions[month] ?? [];
  if (!list.some((d) => d.step === step)) return data;
  return {
    ...data,
    monthlyClose: {
      ...data.monthlyClose,
      decisions: { ...data.monthlyClose.decisions, [month]: list.filter((d) => d.step !== step) },
      audit: audit(data, { at: iso, month, kind: 'undone', step, detail: `Decision undone: ${STEP_TITLES[step]}`, version: null }),
    },
  };
}

export interface CloseInput {
  /** The user confirmed the issues still open (required when there are any). */
  acknowledged: boolean;
  note: string;
}

/** Closes (finalizes) a month: keeps its figures, roll-forward, checklist and report as they are now. */
export function closeMonth(data: AppData, settings: Settings, month: string, input: CloseInput, today: string, clock?: Clock): { data: AppData; close: MonthClose } {
  checkMonth(month);
  const { iso } = nowParts(clock);
  const report = controllerReport(data, settings, month, today, iso);
  const list = report.checklist;
  if (list.closed) throw new DomainError(`${monthLabel(month)} is already closed.`);
  if (!list.ready) throw new DomainError(`${monthLabel(month)} can’t be closed yet: ${list.blockers[0]}`);
  if (list.unresolved.length && !input.acknowledged) throw new DomainError(`Confirm that you’ve reviewed the ${list.unresolved.length === 1 ? 'issue' : `${list.unresolved.length} issues`} still open.`);
  const f = list.figures;
  const rf = f.rollForward;
  const version = data.monthlyClose.closes.filter((c) => c.month === month).length + 1;
  const close: MonthClose = {
    id: newId(),
    month,
    version,
    closedAt: iso,
    status: 'closed',
    supersededAt: null,
    reopenReason: '',
    figures: {
      revenue: f.totals.revenue,
      costOfGoods: f.totals.costOfGoods,
      grossProfit: f.grossProfit,
      fees: f.totals.fees,
      shipping: f.totals.shipping,
      otherExpenses: f.totals.otherExpenses,
      realizedProfit: f.totals.netProfit,
      salesCount: f.totals.salesCount,
      unitsSold: f.totals.unitsSold,
      purchases: f.purchases ?? 0,
      tripExpenses: f.tripExpenses,
      beginningInventory: rf.beginning,
      endingInventory: rf.recordsEnding,
    },
    rollForward: {
      status: rf.status,
      statusText: rf.statusText,
      beginning: rf.beginning,
      beginningBasis: rf.beginningBasis,
      lines: rf.lines.map((l) => ({ key: l.key, label: l.label, amount: l.amount })),
      expectedEnding: rf.expectedEnding,
      recordsEnding: rf.recordsEnding,
      recordsBasis: rf.recordsBasis,
      difference: rf.difference,
      notes: rf.notes,
    },
    checklist: list.steps.map((s) => ({ step: s.step, title: s.title, state: s.state, note: s.decision?.note ?? '', issues: s.issues.map((x) => x.text) })),
    unresolved: list.unresolved,
    acknowledgement: input.note.trim().slice(0, CLOSE_LIMITS.note),
    report: reportSnapshot(report),
  };
  const decisions = { ...data.monthlyClose.decisions };
  delete decisions[month];
  return {
    data: {
      ...data,
      monthlyClose: {
        closes: [...data.monthlyClose.closes, close],
        decisions,
        audit: audit(data, { at: iso, month, kind: 'closed', step: null, detail: `Closed ${monthLabel(month)} (version ${version})${list.unresolved.length ? ` with ${list.unresolved.length} acknowledged open issue${list.unresolved.length === 1 ? '' : 's'}` : ''}${close.acknowledgement ? ` — ${close.acknowledgement}` : ''}`, version }),
      },
    },
    close,
  };
}

/** Reopens a closed month for corrections. Its close is kept, marked superseded; the checks must be run again. */
export function reopenMonth(data: AppData, month: string, reason: string, clock?: Clock): AppData {
  checkMonth(month);
  const { iso } = nowParts(clock);
  const close = currentClose(data, month);
  if (!close) throw new DomainError(`${monthLabel(month)} isn’t closed.`);
  const why = reason.trim().slice(0, CLOSE_LIMITS.reason);
  if (why.length < 5) throw new DomainError('Say why you’re reopening the month (at least a few words).');
  const decisions = { ...data.monthlyClose.decisions };
  delete decisions[month];
  // A finalized year containing this month is flagged for re-review (its figures aren't changed).
  return flagYearForMonth({
    ...data,
    monthlyClose: {
      closes: data.monthlyClose.closes.map((c) => (c.id === close.id ? { ...c, status: 'superseded' as const, supersededAt: iso, reopenReason: why } : c)),
      decisions,
      audit: audit(data, { at: iso, month, kind: 'reopened', step: null, detail: `Reopened ${monthLabel(month)} (version ${close.version} superseded) — ${why}`, version: close.version }),
    },
  }, month, why, iso);
}

/**
 * Refuses a change that would alter the figures of a closed month (its sales, purchases,
 * adjustments or other inventory movements). Called for every saved change.
 */
export function assertClosedMonthsUnchanged(before: AppData, after: AppData): void {
  const closed = after.monthlyClose.closes.filter((c) => c.status === 'closed' && before.monthlyClose.closes.some((b) => b.id === c.id && b.status === 'closed'));
  if (!closed.length) return;
  if (before.sales === after.sales && before.inventoryLedger === after.inventoryLedger && before.adjustments === after.adjustments && before.sourcing.sessions === after.sourcing.sessions) return;
  const bi = ledgerInfo(before);
  const ai = ledgerInfo(after);
  for (const c of closed) {
    if (monthFingerprint(before, c.month, bi) !== monthFingerprint(after, c.month, ai)) {
      throw new DomainError(`That would change ${monthLabel(c.month)}, which is closed. Reopen ${monthLabel(c.month)} first (Sales & Profit → Monthly Close; you’ll be asked why), or use a date in an open month.`);
    }
  }
}
