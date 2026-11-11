// One payout: how the expected amount is built, what was actually paid, and every finding that
// explains the difference, each traced to eBay report rows and recorded sales.

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileText, History, Landmark, Link2, Receipt, Undo2 } from 'lucide-react';
import { explainPayout, reviewTarget, TIMING_KINDS, type Finding, type PayoutRecon, type RowRecon } from '../../domain/reconcile';
import { addReview, confirmMatch, removeMatch, undoReview } from '../../domain/reconcileActions';
import { MARKETPLACE_LABELS } from '../../marketplace/reports';
import { formatDate, formatDateTime } from '../../domain/dates';
import { plural } from '../../domain/format';
import { fromCents, toCents } from '../../domain/money';
import type { ReconciliationReview } from '../../domain/types';
import { store, useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { useAction } from '../../lib/useAction';
import { Card, PageHeader, SectionHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { cn } from '../../ui/cn';
import { useDialogs } from '../dialogs/DialogHub';
import { Row } from '../lots/LotParts';
import { ReasonDialog, Signed, StatusBadge, useReconciliation } from './PayoutParts';

type Pending =
  | { kind: 'finding'; finding: Finding }
  | { kind: 'payout' }
  | { kind: 'adjustment'; row: RowRecon }
  | null;

export function PayoutDetailPage() {
  const { ref = '' } = useParams();
  const navigate = useNavigate();
  const data = useAppState((s) => s.data);
  const currency = useAppState((s) => s.settings.currency);
  const r = useReconciliation();
  const p = r.payouts.find((x) => x.ref === ref);
  const [pending, setPending] = useState<Pending>(null);
  const run = useAction();
  const { money } = useMoney();

  if (!p) {
    return (
      <EmptyState
        icon={<Landmark className="size-6" />}
        title="Payout not found"
        actions={
          <Button variant="primary" onClick={() => navigate('/sales/payouts')}>
            All payouts
          </Button>
        }
      >
        It may have come from a backup that was replaced.
      </EmptyState>
    );
  }

  const decide = (reason: string) => {
    if (!pending) return;
    const amount = pending.kind === 'finding' ? pending.finding.amount : pending.kind === 'payout' ? (p.difference ?? 0) : pending.row.txn.net;
    const target =
      pending.kind === 'finding' ? reviewTarget.finding(p.ref, pending.finding.key) : pending.kind === 'payout' ? reviewTarget.payout(p.ref) : reviewTarget.adjustment(pending.row.txn.key);
    const summary =
      pending.kind === 'finding'
        ? `Marked “${pending.finding.title}” (${money(pending.finding.amount)}) on payout ${p.ref} as resolved.`
        : pending.kind === 'payout'
          ? `Accepted a difference of ${money(p.difference ?? 0)} on payout ${p.ref}.`
          : `Reviewed ${pending.row.txn.rawType} ${pending.row.txn.orderNumber || pending.row.txn.referenceId} (${money(pending.row.txn.net)}) on payout ${p.ref}.`;
    const ok = run(() => store.commit((d) => addReview(d, { target, decision: pending.kind === 'adjustment' ? 'reviewed' : 'resolved', reason, amount, summary, refs: [p.ref] })), 'Decision saved.');
    if (ok) setPending(null);
  };
  const undo = (review: ReconciliationReview) => run(() => store.update((d) => undoReview(d, review.id)), 'Decision withdrawn.');

  const events = data.marketplace.log.filter((e) => e.refs.some((x) => x === p.ref || x.includes(`:${p.ref}`) || p.rows.some((row) => row.txn.key === x))).reverse();
  const outstanding = p.rows.filter((row) => row.source === 'report');

  return (
    <>
      <Link to="/sales/payouts" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> All payouts
      </Link>
      <PageHeader
        title={`${MARKETPLACE_LABELS[p.marketplace]} payout ${p.date ? formatDate(p.date) : ''}`.trim()}
        description={
          <span className="break-words">
            Ref {p.ref}
            {p.statusText && ` · eBay status: ${p.statusText}`}
            {p.payout?.method && ` · ${p.payout.method}`}
          </span>
        }
      />
      <div className={cn('mb-4 flex flex-wrap items-center gap-2 rounded-2xl p-3 text-sm', p.status === 'reconciled' ? 'bg-good-soft text-good-text' : p.status === 'unreconciled' ? 'bg-bad-soft text-bad-text' : 'bg-surface-2 text-ink-2')} data-testid="payout-status" role="status">
        <StatusBadge status={p.status} className="bg-surface" />
        <span>{p.statusReason}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5" data-testid="payout-calculation">
          <SectionHeader title="The calculation" description="Every line comes from your recorded sales or from eBay’s report." />
          <div className="mt-3">
            {p.expectedLines.map((l) => (
              <Row
                key={l.key}
                label={
                  <span>
                    {l.label} <Badge tone={l.source === 'records' ? 'accent' : 'neutral'}>{l.source === 'records' ? 'Your records' : 'eBay report'}</Badge>
                  </span>
                }
                value={<Signed amount={l.amount} tone={false} />}
                testId={`expected-${l.key}`}
              />
            ))}
            <Row label="Expected payout" value={<MoneyText n={p.expected} />} strong className="border-t border-line pt-2" testId="payout-expected" />
            <Row
              label={`Actual payout${p.actualSource === 'transaction_report' ? ' (from the transaction report)' : ''}`}
              value={p.actual === null ? 'Not known yet' : <MoneyText n={p.actual} />}
              strong
              testId="payout-actual"
            />
            <Row label="Difference (actual − expected)" value={<Signed amount={p.difference} tone={p.status === 'unreconciled'} />} strong className="border-t border-line pt-2" testId="payout-difference" />
            {p.difference !== null && toCents(p.difference) !== 0 && (
              <>
                <Row label="Explained by the findings below" value={<Signed amount={fromCents(toCents(p.difference) - toCents(p.unexplained ?? 0))} tone={false} />} />
                <Row label="Unexplained" value={<Signed amount={p.unexplained} />} testId="payout-unexplained" />
              </>
            )}
          </div>
          {p.marketplaceTax > 0 && (
            <p className="mt-3 text-xs text-muted">
              eBay also collected <MoneyText n={p.marketplaceTax} /> of sales tax on these orders and paid it to the tax authorities. It isn’t part of your payout or your revenue.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {p.difference !== null && toCents(p.difference) !== 0 && !p.acceptedDifference && (
              <Button size="sm" onClick={() => setPending({ kind: 'payout' })} data-testid="accept-difference">
                Accept the difference with a reason…
              </Button>
            )}
            {p.acceptedDifference && (
              <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                You accepted this difference on {formatDate(p.acceptedDifference.createdAt.slice(0, 10))}: “{p.acceptedDifference.reason}”
                <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => undo(p.acceptedDifference!)}>
                  Withdraw
                </Button>
              </p>
            )}
          </div>
        </Card>

        <Card className="p-4 sm:p-5" data-testid="payout-explanation">
          <SectionHeader title="In plain words" description="Built only from the figures on this page." />
          <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
            {explainPayout(p, currency).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <ProfitNote p={p} />
        </Card>
      </div>

      {p.findings.length > 0 && (
        <Card className="mt-4 p-4 sm:p-5" data-testid="payout-findings">
          <SectionHeader title="Why it doesn’t match" description="“Confirmed” means the data shows it. “Possible” is a likely cause the data can’t prove: check it." />
          <ul className="mt-3 space-y-3">
            {p.findings.map((f) => (
              <FindingCard key={f.key} p={p} f={f} onResolve={() => setPending({ kind: 'finding', finding: f })} onUndo={undo} />
            ))}
          </ul>
        </Card>
      )}

      {outstanding.length > 0 && (
        <Card className="mt-4 p-4 sm:p-5" data-testid="payout-adjustments">
          <SectionHeader
            title="Adjustments from eBay’s report"
            description="Items in this payout that aren’t sales. They’re counted as eBay reports them; check whether your records need updating (for example a refunded sale’s price)."
          />
          <ul className="mt-3 divide-y divide-line">
            {outstanding.map((row) => {
              const review = data.marketplace.reviews.filter((rv) => rv.target === reviewTarget.adjustment(row.txn.key) && rv.undoneAt === null).at(-1);
              return (
                <li key={row.txn.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5 text-sm" data-testid="payout-adjustment">
                  <div className="min-w-0">
                    <p className="font-medium break-words text-ink">
                      {row.txn.rawType} · {formatDate(row.txn.date)}
                      {row.txn.orderNumber && ` · order ${row.txn.orderNumber}`}
                    </p>
                    <p className="text-xs text-ink-2">{[row.txn.description, row.note].filter(Boolean).join(' · ')}</p>
                    {row.saleIds.map((id) => {
                      const sale = data.sales.find((s) => s.id === id);
                      return sale ? (
                        <Link key={id} to={`/inventory/${sale.itemId}`} className="text-xs text-accent-text hover:underline">
                          Sale: {sale.itemName} ({formatDate(sale.saleDate)})
                        </Link>
                      ) : null;
                    })}
                    {review && !row.outstanding && (
                      <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-good-text">
                        <CheckCircle2 className="size-3.5" aria-hidden /> Reviewed: “{review.reason}”
                        <Button size="sm" variant="ghost" onClick={() => undo(review)}>
                          Withdraw
                        </Button>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular text-ink">
                      <Signed amount={row.txn.net} tone={false} />
                    </span>
                    {row.outstanding && (
                      <Button size="sm" onClick={() => setPending({ kind: 'adjustment', row })}>
                        Mark reviewed…
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card className="mt-4 p-4 sm:p-5" data-testid="payout-transactions">
        <SectionHeader title={`Transactions in this payout (${p.rows.length})`} description="Exactly as eBay reported them, next to what your records say." />
        <ul className="mt-3 divide-y divide-line text-sm">
          {p.rows.map((row) => (
            <TxnRow key={row.txn.id} row={row} />
          ))}
        </ul>
      </Card>

      {events.length > 0 && (
        <Card className="mt-4 p-4 sm:p-5" data-testid="payout-history">
          <SectionHeader title="History" description="Imports and decisions about this payout." />
          <ol className="mt-3 space-y-2 text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-2">
                <History className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 break-words text-ink-2">
                  {e.summary}
                  <span className="block text-xs text-muted">{formatDateTime(e.date)}</span>
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <ReasonDialog
        open={pending !== null}
        title={pending?.kind === 'adjustment' ? 'Mark adjustment as reviewed' : pending?.kind === 'payout' ? 'Accept the remaining difference' : 'Mark finding as resolved'}
        description={
          pending?.kind === 'payout'
            ? 'The difference stays visible; your reason explains it. If the numbers change later, it opens again.'
            : pending?.kind === 'finding'
              ? `“${pending.finding.title}”. The amount isn’t changed or hidden.`
              : 'Note what you checked, e.g. that the sale was edited to reflect a refund.'
        }
        suggestions={
          pending?.kind === 'adjustment'
            ? ['Edited the sale to reflect it', 'Not related to a recorded sale', 'Checked: no change needed']
            : pending?.kind === 'finding' && pending.finding.kind === 'missing_sale'
              ? ['Not tracked in StockPilot', 'Personal item, not inventory']
              : ['Checked with eBay', 'Will correct next month']
        }
        onSave={decide}
        onClose={() => setPending(null)}
      />
    </>
  );
}

function MoneyText({ n }: { n: number }) {
  const { money } = useMoney();
  return <span className="tabular">{money(n)}</span>;
}

function ProfitNote({ p }: { p: PayoutRecon }) {
  const { money } = useMoney();
  if (!p.matchedCount) return null;
  return (
    <div className="mt-4 rounded-2xl bg-surface-2 p-3 text-sm" data-testid="payout-profit">
      <p className="font-medium text-ink">Profit on these sales (accounting, from your records)</p>
      <p className="mt-1 text-ink-2">
        {money(p.profit.revenue)} sales − {money(p.profit.costOfGoods)} what the items cost you − {money(p.profit.totalExpenses)} fees, shipping and other costs ={' '}
        <strong className="text-ink">{money(p.profit.netProfit)}</strong> realized profit.
      </p>
      <p className="mt-1 text-xs text-muted">A payout is money moved, not profit: item costs were paid when you bought the stock, so they aren’t deducted from the payout.</p>
    </div>
  );
}

function FindingCard({ p, f, onResolve, onUndo }: { p: PayoutRecon; f: Finding; onResolve: () => void; onUndo: (r: ReconciliationReview) => void }) {
  const data = useAppState((s) => s.data);
  const { money } = useMoney();
  const dialogs = useDialogs();
  const run = useAction();
  const txn = f.txnIds.length ? data.marketplace.transactions.find((t) => t.id === f.txnIds[0]) : undefined;
  const isMatchable = (f.kind === 'missing_sale' || f.kind === 'ambiguous_match') && txn;
  const match = isMatchable ? p.rows.find((row) => row.txn.id === txn!.id)?.match : null;
  const labels = txn ? data.marketplace.transactions.filter((t) => t.kind === 'shipping_label' && t.orderNumber && t.orderNumber === txn.orderNumber) : [];
  return (
    <li className="rounded-2xl border border-line p-3" data-testid="payout-finding" data-kind={f.kind}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={f.certainty === 'confirmed' ? 'accent' : 'warn'}>{f.certainty === 'confirmed' ? 'Confirmed' : 'Possible explanation'}</Badge>
            {TIMING_KINDS.includes(f.kind) && <Badge tone="neutral">Timing</Badge>}
            {f.review && <Badge tone="good">Resolved</Badge>}
          </div>
          <p className="mt-1 font-medium break-words text-ink">{f.title}</p>
        </div>
        {toCents(f.amount) !== 0 && <Signed amount={f.amount} tone={!f.review} className="text-base" />}
      </div>
      <p className="mt-1 text-sm text-ink-2">{f.explanation}</p>
      {f.evidence.length > 0 && (
        <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 rounded-xl bg-surface-2 p-2.5 text-xs sm:grid-cols-2">
          {f.evidence.map((e, i) => (
            <div key={i} className="flex justify-between gap-2">
              <dt className="text-muted">{e.label}</dt>
              <dd className="tabular text-right break-all text-ink">{e.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {isMatchable && match && match.candidates.length > 0 && (
        <div className="mt-2 space-y-1.5" data-testid="match-candidates">
          <p className="text-xs font-medium text-ink">{match.ambiguous ? 'Recorded sales with this order number:' : 'Recorded sales that might be this order:'}</p>
          {match.candidates.map((c) => {
            const sale = data.sales.find((s) => s.id === c.saleId);
            if (!sale) return null;
            return (
              <div key={c.saleId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-2 text-sm" data-testid="match-candidate">
                <span className="min-w-0 break-words">
                  <span className="font-medium text-ink">{sale.itemName}</span> · {formatDate(sale.saleDate)} · {money(sale.priceMode === 'per_unit' ? sale.salePrice * sale.quantity : sale.salePrice)}
                  <span className="block text-xs text-muted">{c.reasons.join(' · ')}</span>
                </span>
                <Button
                  size="sm"
                  icon={<Link2 className="size-3.5" />}
                  onClick={() => run(() => store.update((d) => confirmMatch(d, txn!.id, c.saleId)), `Matched to the sale of “${sale.itemName}”.`)}
                >
                  It’s this sale
                </Button>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {isMatchable && (
          <Button
            size="sm"
            icon={<Receipt className="size-3.5" />}
            onClick={() =>
              dialogs.recordSale(undefined, {
                quantity: txn!.quantity ?? 1,
                total: txn!.itemSubtotal !== null ? txn!.itemSubtotal + (txn!.shippingAndHandling ?? 0) : txn!.net,
                fees: txn!.fees ?? 0,
                shipping: fromCents(-labels.reduce((c, t) => c + toCents(t.net), 0)),
                saleDate: txn!.date,
                platform: 'eBay',
                orderNumber: txn!.orderNumber,
                notes: txn!.title,
              })
            }
          >
            Record this sale
          </Button>
        )}
        {f.review ? (
          <p className="flex flex-wrap items-center gap-1 text-sm text-good-text">
            <CheckCircle2 className="size-4" aria-hidden /> Resolved: “{f.review.reason}”
            <Button size="sm" variant="ghost" icon={<Undo2 className="size-3.5" />} onClick={() => onUndo(f.review!)}>
              Withdraw
            </Button>
          </p>
        ) : (
          toCents(f.amount) !== 0 && (
            <Button size="sm" variant="ghost" onClick={onResolve} data-testid="resolve-finding">
              Mark as resolved…
            </Button>
          )
        )}
      </div>
    </li>
  );
}

function TxnRow({ row }: { row: RowRecon }) {
  const data = useAppState((s) => s.data);
  const { money } = useMoney();
  const run = useAction();
  const t = row.txn;
  const sale = row.saleIds.length === 1 ? data.sales.find((s) => s.id === row.saleIds[0]) : undefined;
  return (
    <li className="py-2.5" data-testid="payout-txn">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 font-medium break-words text-ink">
          {t.rawType} · {formatDate(t.date)}
          {t.orderNumber && <span className="font-normal text-ink-2"> · {t.orderNumber}</span>}
        </span>
        <span className="tabular text-ink">
          eBay <Signed amount={t.net} tone={false} />
          {row.source !== 'report' && (
            <span className="text-ink-2">
              {' '}
              · your records {row.source === 'missing' ? '—' : money(fromCents(row.expected))}
            </span>
          )}
        </span>
      </div>
      <p className="text-xs text-ink-2">
        {[t.title, t.customLabel && `SKU ${t.customLabel}`, t.description, t.referenceId && `ref ${t.referenceId}`].filter(Boolean).join(' · ')}
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs">
        {row.source === 'missing' ? (
          <span className="text-bad-text">{row.note}</span>
        ) : sale ? (
          <>
            <Link to={`/inventory/${sale.itemId}`} className="text-accent-text hover:underline">
              <FileText className="mr-0.5 inline size-3" aria-hidden />
              {t.kind === 'sale' ? 'Matched' : 'Linked'} to the sale of {sale.itemName}
            </Link>
            {row.match?.method && <span className="text-muted">({row.match.method === 'user' ? 'confirmed by you' : 'same order number'})</span>}
            {row.match?.method === 'user' && (
              <Button size="sm" variant="ghost" onClick={() => run(() => store.update((d) => removeMatch(d, t.id)), 'Match removed.')}>
                Remove match
              </Button>
            )}
          </>
        ) : (
          <span className="text-muted">{row.note}</span>
        )}
      </p>
      {t.kind === 'sale' && t.feeBreakdown.length > 0 && (
        <p className="text-xs text-muted">
          {plural(t.feeBreakdown.length, 'fee')}: {t.feeBreakdown.map((x) => `${x.label} ${money(x.amount)}`).join(', ')}
          {t.itemSubtotal !== null && ` · item ${money(t.itemSubtotal)}${t.shippingAndHandling ? ` + shipping ${money(t.shippingAndHandling)}` : ''}`}
        </p>
      )}
    </li>
  );
}
