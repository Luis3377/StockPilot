// User decisions in payout reconciliation. Each one is recorded with its reason in an
// append-only log. None of them changes a sale, a fee or any other financial record: to correct
// a sale, the user edits it like any other sale.

import { DomainError } from './errors';
import { newId } from './ids';
import { nowParts, optionalText, type Clock } from './actions';
import { matchSales } from './reconcile';
import type { AppData, ReconciliationEvent, ReconciliationReview } from './types';

function withEvent(data: AppData, event: Omit<ReconciliationEvent, 'id'>): AppData['marketplace'] {
  return { ...data.marketplace, log: [...data.marketplace.log, { id: newId(), ...event }] };
}

/** Links a marketplace sale row to a recorded sale, after the user has checked it's the same sale. */
export function confirmMatch(data: AppData, txnId: string, saleId: string, clock?: Clock): AppData {
  const { iso } = nowParts(clock);
  const txn = data.marketplace.transactions.find((t) => t.id === txnId);
  if (!txn || txn.kind !== 'sale') throw new DomainError('That marketplace sale is no longer in your imports.');
  const sale = data.sales.find((s) => s.id === saleId);
  if (!sale) throw new DomainError('That sale no longer exists.');
  const matching = matchSales(data);
  const current = matching.byTxn.get(txnId);
  if (current?.saleId) throw new DomainError('That order is already matched to a sale. Remove that match first.');
  const other = matching.txnBySale.get(saleId);
  if (other) throw new DomainError(`“${sale.itemName}” is already matched to another eBay order.`);
  const marketplace = withEvent(data, {
    date: iso,
    action: 'match',
    summary: `Matched eBay order ${txn.orderNumber || txn.referenceId} (${txn.title || txn.rawType}) to the sale of “${sale.itemName}” on ${sale.saleDate}.`,
    refs: [txn.key, sale.id],
  });
  return { ...data, marketplace: { ...marketplace, matches: [...marketplace.matches, { id: newId(), txnId, saleId, createdAt: iso }] } };
}

/** Removes a match the user confirmed earlier (order-number matches follow the sale's order number). */
export function removeMatch(data: AppData, txnId: string, clock?: Clock): AppData {
  const { iso } = nowParts(clock);
  const match = data.marketplace.matches.find((m) => m.txnId === txnId);
  if (!match) throw new DomainError('That match was made by order number. Change the order number on the sale to undo it.');
  const txn = data.marketplace.transactions.find((t) => t.id === txnId);
  const sale = data.sales.find((s) => s.id === match.saleId);
  const marketplace = withEvent(data, {
    date: iso,
    action: 'unmatch',
    summary: `Removed the match between eBay order ${txn?.orderNumber || txn?.referenceId || '?'} and the sale of “${sale?.itemName ?? 'a deleted sale'}”.`,
    refs: [txn?.key ?? txnId, match.saleId],
  });
  return { ...data, marketplace: { ...marketplace, matches: marketplace.matches.filter((m) => m.txnId !== txnId) } };
}

export interface ReviewInput {
  target: string;
  decision: ReconciliationReview['decision'];
  reason: string;
  /** The amount in question now; the decision stops applying if it later changes. */
  amount: number;
  /** What was decided, for the log ("Accepted a $7.32 difference on payout 123"). */
  summary: string;
  refs: string[];
}

/** Records a decision with the user's reason. The difference itself is never changed or hidden. */
export function addReview(data: AppData, input: ReviewInput, clock?: Clock): { data: AppData; review: ReconciliationReview } {
  const { iso } = nowParts(clock);
  const reason = optionalText(input.reason, 'reason', 'Reason', 500);
  if (!reason) throw new DomainError('Say why, so you (or your accountant) can follow it later.', 'reason');
  const review: ReconciliationReview = { id: newId(), target: input.target, decision: input.decision, reason, amount: input.amount, createdAt: iso, undoneAt: null };
  const marketplace = withEvent(data, { date: iso, action: 'review', summary: `${input.summary} Reason: “${reason}”.`, refs: [input.target, ...input.refs] });
  return { data: { ...data, marketplace: { ...marketplace, reviews: [...marketplace.reviews, review] } }, review };
}

/** Withdraws a decision. It stays in the history, marked as undone. */
export function undoReview(data: AppData, reviewId: string, clock?: Clock): AppData {
  const { iso } = nowParts(clock);
  const review = data.marketplace.reviews.find((r) => r.id === reviewId);
  if (!review || review.undoneAt) throw new DomainError('That decision was already withdrawn.');
  const marketplace = withEvent(data, { date: iso, action: 'undo_review', summary: `Withdrew the decision “${review.reason}”.`, refs: [review.target] });
  return { ...data, marketplace: { ...marketplace, reviews: marketplace.reviews.map((r) => (r.id === reviewId ? { ...r, undoneAt: iso } : r)) } };
}
