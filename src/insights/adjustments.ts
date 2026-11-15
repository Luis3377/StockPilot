// Inventory losses and other documented quantity adjustments for a period, kept apart from
// realized sales profit (which only covers what sold). Uses the same classification as the
// inventory ledger and Monthly Close, so the figures agree with their write-off lines.
// Adjustments never involve a sale, so nothing here overlaps cost of goods sold.

import type { Adjustment, AppData } from '../domain/types';
import { fromCents, toCents } from '../domain/money';
import type { DateRange } from '../domain/dates';
import { localDate } from '../domain/ledger';
import { RETURN_REASON, WITHDRAWAL_REASON } from './monthly';

export type AdjustmentKind = 'loss' | 'found' | 'personal' | 'return';

export interface AdjustmentGroup {
  kind: AdjustmentKind;
  amount: number;
  units: number;
  records: Adjustment[];
}

export interface AdjustmentSummary {
  /** Damaged, lost, missing at a count and other documented decreases (negative). */
  losses: AdjustmentGroup;
  /** Units found later, at a count or otherwise (positive). */
  found: AdjustmentGroup;
  /** Taken for personal use: not a business loss, shown apart (negative). */
  personal: AdjustmentGroup;
  /** Customer returns put back in stock (positive); the refund belongs on the sale. */
  returns: AdjustmentGroup;
  /** losses + found: the net inventory loss documented in the period. */
  netLoss: number;
}

export function adjustmentKind(a: Adjustment): AdjustmentKind | null {
  if (a.source === 'restock' || a.valueDifference === 0) return null;
  if (a.valueDifference < 0) return WITHDRAWAL_REASON.test(a.reason) ? 'personal' : 'loss';
  return RETURN_REASON.test(a.reason) ? 'return' : 'found';
}

const inRange = (iso: string, r: DateRange) => {
  const d = localDate(iso);
  return (!r.start || d >= r.start) && (!r.end || d <= r.end);
};

export function adjustmentSummary(data: AppData, range: DateRange): AdjustmentSummary {
  const group = (kind: AdjustmentKind): AdjustmentGroup => {
    const records = data.adjustments.filter((a) => inRange(a.date, range) && adjustmentKind(a) === kind);
    return { kind, amount: fromCents(records.reduce((c, a) => c + toCents(a.valueDifference), 0)), units: records.reduce((n, a) => n + a.difference, 0), records };
  };
  const losses = group('loss');
  const found = group('found');
  return { losses, found, personal: group('personal'), returns: group('return'), netLoss: fromCents(toCents(losses.amount) + toCents(found.amount)) };
}
