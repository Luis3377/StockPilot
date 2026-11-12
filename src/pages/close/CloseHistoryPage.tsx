// Closed months: every close (current and superseded), its original figures beside today's
// recalculation, why it was reopened, and the full audit log.

import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { formatDateTime, todayISO } from '../../domain/dates';
import { monthFigures, monthLabel } from '../../insights/monthly';
import { useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { Card, PageHeader, SectionHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { EmptyState } from '../../ui/EmptyState';

export function CloseHistoryPage() {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const { money } = useMoney();
  const today = todayISO();
  const months = [...new Set(data.monthlyClose.closes.map((c) => c.month))].sort().reverse();
  return (
    <>
      <Link to="/sales/close" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Monthly Close
      </Link>
      <PageHeader title="Closed months" description="Each close keeps the figures and report as they were. Reopening keeps the earlier close, marked superseded." />
      {!months.length ? (
        <Card>
          <EmptyState title="No months closed yet">Finalize a month in Monthly Close to keep its figures and report here.</EmptyState>
        </Card>
      ) : (
        <div className="space-y-4" data-testid="close-history">
          {months.map((m) => {
            const versions = data.monthlyClose.closes.filter((c) => c.month === m).sort((a, b) => b.version - a.version);
            const now = monthFigures(data, settings, m, today);
            return (
              <Card key={m} className="p-4 sm:p-5" data-testid="history-month">
                <SectionHeader title={monthLabel(m)} action={<Link to={`/sales/close?month=${m}`} className="text-sm text-accent-text hover:underline">Open in Monthly Close</Link>} />
                <ul className="mt-2 divide-y divide-line">
                  {versions.map((c) => {
                    const differs = c.status === 'closed' && (c.figures.realizedProfit !== now.totals.netProfit || c.figures.revenue !== now.totals.revenue);
                    return (
                      <li key={c.id} className="py-2 text-sm" data-testid="history-version">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-medium text-ink">
                            Version {c.version} · closed {formatDateTime(c.closedAt)}
                          </span>
                          <Badge tone={c.status === 'closed' ? 'good' : 'neutral'}>{c.status === 'closed' ? 'Current' : 'Superseded'}</Badge>
                        </div>
                        <p className="tabular text-ink-2">
                          Revenue {money(c.figures.revenue)} · realized profit {money(c.figures.realizedProfit)} · ending inventory {c.figures.endingInventory === null ? 'not available' : money(c.figures.endingInventory)}
                        </p>
                        {c.status === 'superseded' && (
                          <p className="text-ink-2">
                            Reopened {formatDateTime(c.supersededAt ?? c.closedAt)}: {c.reopenReason}
                          </p>
                        )}
                        {differs && <p className="text-warn-text">Recalculated from today’s records: realized profit {money(now.totals.netProfit)}, revenue {money(now.totals.revenue)}. The closing figures are kept unchanged.</p>}
                        <Link to={`/sales/close/${m}/report?version=${c.version}`} className="text-accent-text hover:underline">
                          View the report as closed
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      {data.monthlyClose.audit.length > 0 && (
        <Card className="mt-4 p-4 sm:p-5" data-testid="history-audit">
          <SectionHeader title="Change history" description="Checklist decisions, closes and reopens, as recorded on this device (and in your backups). A record of what was done, not a tamper-proof log." />
          <ul className="mt-2 space-y-1 text-xs text-ink-2">
            {[...data.monthlyClose.audit].reverse().slice(0, 300).map((a) => (
              <li key={a.id}>
                {formatDateTime(a.at)} · {monthLabel(a.month)}: {a.detail}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
