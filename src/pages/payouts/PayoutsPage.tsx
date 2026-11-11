// Payout Reconciliation: every marketplace payout, what your records say it should have been,
// what was actually paid, and whether the difference is explained.

import { Link } from 'react-router-dom';
import { ArrowLeft, Clock, FileUp, Landmark } from 'lucide-react';
import { STATUS_LABELS, type ReconStatus } from '../../domain/reconcile';
import { MARKETPLACE_LABELS } from '../../marketplace/reports';
import { formatDate, formatDateTime } from '../../domain/dates';
import { plural } from '../../domain/format';
import { fromCents, toCents } from '../../domain/money';
import { useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { usePersistentState } from '../../lib/usePersistentState';
import { Card, PageHeader, SectionHeader } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Segmented } from '../../ui/Fields';
import { StatTile } from '../../ui/Stat';
import { useDialogs } from '../dialogs/DialogHub';
import { KIND_LABELS } from '../dialogs/PayoutImportDialog';
import { Disclosure } from '../DataSafety';
import { Signed, StatusBadge, useReconciliation } from './PayoutParts';

type Filter = 'all' | ReconStatus;
const FILTERS: Filter[] = ['all', 'unreconciled', 'needs_review', 'pending', 'reconciled'];

export function PayoutsPage() {
  const data = useAppState((s) => s.data);
  const dialogs = useDialogs();
  const { money } = useMoney();
  const r = useReconciliation();
  const [filter, setFilter] = usePersistentState<Filter>('payout-filter', 'all', FILTERS);
  const imports = [...data.marketplace.imports].reverse();

  const header = (
    <>
      <Link to="/sales" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Sales &amp; Profit
      </Link>
      <PageHeader
        title="Payout Reconciliation"
        description="Check that what eBay paid you matches the sales, fees and refunds you recorded."
        actions={
          <Button variant="primary" icon={<FileUp className="size-4" />} onClick={dialogs.importPayouts}>
            Import eBay report
          </Button>
        }
      />
    </>
  );

  if (imports.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={<Landmark className="size-6" />}
            title="No marketplace reports imported yet"
            actions={
              <Button variant="primary" icon={<FileUp className="size-4" />} onClick={dialogs.importPayouts}>
                Import eBay report
              </Button>
            }
          >
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-left">
              <li>In eBay Seller Hub, open Payments → Reports and download the Transaction report and the Payout report for the same dates (CSV).</li>
              <li>Import both here. Nothing is uploaded, and your sales aren’t changed.</li>
              <li>Add eBay order numbers to your sales (or confirm the matches StockPilot suggests), and see which payouts tie out.</li>
            </ol>
          </EmptyState>
        </Card>
      </>
    );
  }

  const shown = r.payouts.filter((p) => filter === 'all' || p.status === filter);
  const paidCents = r.payouts.reduce((c, p) => c + toCents(p.actual ?? 0), 0);
  const outstanding = r.payouts.reduce((n, p) => n + p.outstandingCount, 0);

  return (
    <>
      {header}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="payout-summary">
        <StatTile label="Payouts" value={String(r.payouts.length)} sub={`${r.counts.reconciled} reconciled · ${r.counts.unreconciled} unreconciled`} testId="payout-count" />
        <StatTile label="Paid out" value={money(fromCents(paidCents))} sub="Money eBay sent to your bank" />
        <StatTile
          label="Unreconciled difference"
          value={<Signed amount={r.unreconciledTotal} tone={false} />}
          tone={toCents(r.unreconciledTotal) !== 0 ? 'bad' : 'default'}
          sub={r.counts.unreconciled ? `Across ${plural(r.counts.unreconciled, 'payout')}` : 'Nothing unexplained'}
          testId="payout-unreconciled"
        />
        <StatTile label="Not paid out yet" value={money(r.notPaidOut.total)} sub={r.notPaidOut.onHold ? `${money(r.notPaidOut.onHold)} on hold by eBay` : 'Waiting for the next payout'} testId="payout-not-paid" />
      </div>
      {outstanding > 0 && (
        <p className="mt-3 text-sm text-ink-2">
          {plural(outstanding, 'adjustment')} from eBay (refunds, fees or holds) {outstanding === 1 ? 'needs' : 'need'} a look. Open a payout marked “Needs review” to see {outstanding === 1 ? 'it' : 'them'}.
        </p>
      )}

      <Card className="mt-4 p-4 sm:p-5">
        <SectionHeader title="Payouts" description="Expected = from your recorded sales, plus refunds and other items in eBay’s report. Actual = what eBay paid." />
        <Segmented
          className="mt-3 max-w-full overflow-x-auto"
          size="sm"
          label="Show payouts"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({ value: f, label: f === 'all' ? `All (${r.payouts.length})` : `${STATUS_LABELS[f].split(' /')[0]} (${r.counts[f]})` }))}
        />
        {shown.length === 0 ? (
          <p className="mt-4 text-sm text-ink-2">No payouts with this status.</p>
        ) : (
          <>
            <div className="mt-3 hidden overflow-x-auto lg:block">
              <table className="w-full text-sm" data-testid="payout-table">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Payout</th>
                    <th className="py-2 pr-3 text-right font-medium">Expected</th>
                    <th className="py-2 pr-3 text-right font-medium">Actual</th>
                    <th className="py-2 pr-3 text-right font-medium">Difference</th>
                    <th className="py-2 pr-3 text-right font-medium">Matched</th>
                    <th className="py-2 pr-3 text-right font-medium">Unmatched</th>
                    <th className="py-2 pr-3 text-right font-medium">Adjustments to review</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((p) => (
                    <tr key={p.ref} className="border-b border-line last:border-0" data-testid="payout-row">
                      <td className="py-2.5 pr-3">
                        <Link to={`/sales/payouts/${encodeURIComponent(p.ref)}`} className="font-medium text-accent-text hover:underline">
                          {MARKETPLACE_LABELS[p.marketplace]} · {p.date ? formatDate(p.date) : 'Date unknown'}
                        </Link>
                        <div className="text-xs text-muted">Ref {p.ref}</div>
                      </td>
                      <td className="tabular py-2.5 pr-3 text-right">{money(p.expected)}</td>
                      <td className="tabular py-2.5 pr-3 text-right">{p.actual === null ? '—' : money(p.actual)}</td>
                      <td className="py-2.5 pr-3 text-right">
                        <Signed amount={p.difference} tone={p.status === 'unreconciled'} />
                      </td>
                      <td className="tabular py-2.5 pr-3 text-right">{p.matchedCount}</td>
                      <td className="tabular py-2.5 pr-3 text-right">{p.unmatchedCount}</td>
                      <td className="tabular py-2.5 pr-3 text-right">{p.outstandingCount}</td>
                      <td className="py-2.5">
                        <StatusBadge status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-3 space-y-2 lg:hidden" data-testid="payout-cards">
              {shown.map((p) => (
                <li key={p.ref}>
                  <Link to={`/sales/payouts/${encodeURIComponent(p.ref)}`} className="block rounded-2xl border border-line p-3 hover:bg-surface-2" data-testid="payout-card">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-ink">
                          {MARKETPLACE_LABELS[p.marketplace]} · {p.date ? formatDate(p.date) : 'Date unknown'}
                        </div>
                        <div className="text-xs break-all text-muted">Ref {p.ref}</div>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                    <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <dt className="text-xs text-muted">Expected</dt>
                        <dd className="tabular text-ink">{money(p.expected)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Actual</dt>
                        <dd className="tabular text-ink">{p.actual === null ? '—' : money(p.actual)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted">Difference</dt>
                        <dd>
                          <Signed amount={p.difference} tone={p.status === 'unreconciled'} />
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-1 text-xs text-muted">
                      {p.matchedCount} matched · {p.unmatchedCount} unmatched · {p.outstandingCount} to review
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {r.notPaidOut.rows.length > 0 && (
        <Card className="mt-4 p-4 sm:p-5" data-testid="not-paid-out">
          <SectionHeader
            title="Not paid out yet"
            description="eBay has recorded these but hasn’t paid them out. That’s timing, not missing money. They’ll appear in a payout once you import a later report."
          />
          <ul className="mt-3 divide-y divide-line text-sm">
            {r.notPaidOut.rows.map(({ txn }) => (
              <li key={txn.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                <span className="min-w-0 break-words text-ink">
                  <Clock className="mr-1 inline size-3.5 text-muted" aria-hidden />
                  {KIND_LABELS[txn.kind]} · {formatDate(txn.date)} · {txn.title || txn.description || txn.orderNumber}
                  {(txn.holdReason || txn.payoutStatus) && <span className="block text-xs text-muted">{[txn.payoutStatus, txn.holdReason].filter(Boolean).join(': ')}</span>}
                </span>
                <span className="tabular text-ink">{money(txn.net)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {r.unmatchedSales.length > 0 && (
        <Card className="mt-4 p-4 sm:p-5" data-testid="unmatched-sales">
          <SectionHeader title="Recorded eBay sales not found in your reports" description={`Between ${formatDate(r.coverage.start)} and ${formatDate(r.coverage.end)}, the dates your imported reports cover.`} />
          <ul className="mt-3 divide-y divide-line text-sm">
            {r.unmatchedSales.map(({ sale, reason }) => (
              <li key={sale.id} className="py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <Link to={`/inventory/${sale.itemId}`} className="min-w-0 font-medium break-words text-accent-text hover:underline">
                    {sale.itemName}
                  </Link>
                  <span className="text-ink-2">
                    {formatDate(sale.saleDate)}
                    {sale.orderNumber && ` · ${sale.orderNumber}`}
                  </span>
                </div>
                <p className="text-xs text-ink-2">{reason}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-4 space-y-2">
        <Disclosure title={`Imported reports (${imports.length})`} testId="payout-imports">
          <ul className="space-y-2">
            {imports.map((i) => (
              <li key={i.id}>
                <span className="font-medium text-ink">{i.fileName}</span> · {i.format === 'ebay_transactions' ? 'Transaction report' : 'Payout report'}
                {i.periodStart && ` · ${formatDate(i.periodStart)} – ${formatDate(i.periodEnd)}`}
                <span className="block text-xs text-muted">
                  Imported {formatDateTime(i.importedAt)} · {i.added} new, {i.updated} updated, {i.unchanged} already imported
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
        <Disclosure title="How the numbers work">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong className="text-ink">Expected payout</strong> = the sales you recorded for the payout’s eBay orders − the fees you recorded − shipping labels you recorded (only for orders where eBay
              charged a label) + items in eBay’s report that aren’t sales: tax you collected, refunds, claims, holds and account fees.
            </li>
            <li>
              <strong className="text-ink">Difference</strong> = actual payout − expected payout. StockPilot splits it into findings you can check, each linked to the report rows and sales
              behind it. Anything it can’t explain is shown as unexplained, never hidden.
            </li>
            <li>A payout is money moved, not profit. What the items cost you isn’t part of it; profit is still calculated from your sales.</li>
            <li>Sales are matched by eBay order number (and SKU for multi-item orders). Anything less certain is only suggested, for you to confirm.</li>
          </ul>
        </Disclosure>
      </div>
    </>
  );
}
