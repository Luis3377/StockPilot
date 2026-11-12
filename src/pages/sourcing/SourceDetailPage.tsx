// One source: its figures, and every record behind them (purchases, sales, time), with links.

import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { sourcingReport, typeLabel, UNASSIGNED_KEY } from '../../insights/sourcing';
import { computeSale } from '../../domain/calc';
import { formatDate, periodRange } from '../../domain/dates';
import { fromCents, toCents } from '../../domain/money';
import { plural } from '../../domain/format';
import { useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { Card, PageHeader, SectionHeader } from '../../ui/Card';
import { EmptyState } from '../../ui/EmptyState';
import { timeShares } from '../../insights/sourcing';
import { ACTIVITY_LABELS } from '../../domain/sourcing';
import { Figures, hoursText, minutesText, pctText } from './parts';

export function SourceDetailPage() {
  const { key = '' } = useParams();
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const { money } = useMoney();
  const report = sourcingReport(data, settings, { range: periodRange('all') });
  const s = report.sources.find((x) => x.ref.key === key);
  if (!s) {
    return (
      <EmptyState title="Nothing recorded for this source" actions={<Link to="/insights/sourcing?tab=sources">Sources</Link>}>
        It may have been merged, renamed or have no records yet.
      </EmptyState>
    );
  }
  const source = s.ref.sourceId ? data.sourcing.sources.find((x) => x.id === s.ref.sourceId) : null;
  const shares = timeShares(data).filter((t) => t.sourceKey === key);
  return (
    <>
      <Link to="/insights/sourcing" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Sourcing Performance
      </Link>
      <PageHeader
        title={<span className="break-words">{s.ref.name}</span>}
        description={[typeLabel(s.ref.type), source?.location, key === UNASSIGNED_KEY ? 'Records with no source recorded' : !s.ref.registered ? 'A name typed on lots, not in your sources yet' : null].filter(Boolean).join(' · ')}
      />
      <Card className="p-4 sm:p-5" data-testid="source-figures">
        <SectionHeader title="All time" description="Realized figures from recorded sales; stock as of today." />
        <Figures
          className="mt-3"
          rows={[
            ['Realized profit', money(s.realizedProfit), s.realizedProfit < 0 ? 'text-bad-text' : undefined],
            ['Sales revenue', money(s.revenue)],
            ['Cost of goods sold', money(s.costOfGoods)],
            ['Fees', money(s.fees)],
            ['Shipping', money(s.shipping)],
            ['Other selling expenses', money(s.otherExpenses)],
            ['Margin', pctText(s.marginPct)],
            ['ROI on cost of goods sold', pctText(s.roiPct)],
            ['Bought', `${money(s.acquisitionCost)} · ${plural(s.unitsPurchased, 'unit')}`],
            ['Sold · in stock', `${s.unitsSold} · ${s.unitsRemaining}`],
            ['Tied up in stock', money(s.inventoryCost)],
            ['Avg. days to sell', s.avgDaysToSell === null ? '—' : String(s.avgDaysToSell)],
            ['Logged time', hoursText(s.hours)],
            ['Profit per logged hour', s.profitPerHour === null ? 'Not enough time data' : money(s.profitPerHour)],
            ['Trip expenses (not in item costs)', money(s.tripExpenses)],
          ]}
        />
      </Card>

      <Card className="mt-4 p-4 sm:p-5" data-testid="source-purchases">
        <SectionHeader title="Purchases" description="Items and bulk lots from this source (lots with their full cost, split across their items)." />
        <ul className="mt-2 divide-y divide-line text-sm">
          {s.purchaseRecords.map((p) => (
            <li key={`${p.kind}:${p.id}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
              <Link to={p.kind === 'lot' ? `/inventory/lots/${p.id}` : `/inventory/${p.id}`} className="min-w-0 break-words text-accent-text hover:underline">
                {p.kind === 'lot' ? `Lot: ${p.name}` : p.name}
              </Link>
              <span className="tabular text-ink-2">
                {formatDate(p.date)} · {plural(p.units, 'unit')} · {money(p.cost)}
              </span>
            </li>
          ))}
          {!s.purchaseRecords.length && <li className="py-1.5 text-ink-2">None recorded.</li>}
        </ul>
      </Card>

      <Card className="mt-4 p-4 sm:p-5" data-testid="source-sales">
        <SectionHeader title="Sales" description="Each sale’s revenue − cost of goods sold − selling expenses = realized profit." />
        <ul className="mt-2 divide-y divide-line text-sm">
          {[...s.sales]
            .sort((a, b) => b.saleDate.localeCompare(a.saleDate))
            .map((x) => {
              const f = computeSale(x);
              return (
                <li key={x.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5" data-testid="source-sale">
                  <span className="min-w-0">
                    <Link to={`/inventory/${x.itemId}`} className="text-accent-text hover:underline">
                      {x.itemName}
                    </Link>{' '}
                    <span className="text-ink-2">
                      × {x.quantity} · {formatDate(x.saleDate)}
                    </span>
                  </span>
                  <span className="tabular text-ink-2">
                    {money(f.revenue)} − {money(f.costOfGoods)} − {money(f.totalExpenses)} = <span className={f.netProfit < 0 ? 'text-bad-text' : 'text-ink'}>{money(f.netProfit)}</span>
                  </span>
                </li>
              );
            })}
          {!s.sales.length && <li className="py-1.5 text-ink-2">No sales yet.</li>}
        </ul>
      </Card>

      <Card className="mt-4 p-4 sm:p-5" data-testid="source-time">
        <SectionHeader title="Time" description="Logged time counted toward this source (its share, when an entry covers several things)." />
        <ul className="mt-2 divide-y divide-line text-sm">
          {shares.map((t, i) => (
            <li key={`${t.entry.id}:${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
              <span className="text-ink">
                {ACTIVITY_LABELS[t.entry.activity]} · {formatDate(t.entry.date)}
              </span>
              <span className="tabular text-ink-2">
                {minutesText(Math.round(t.seconds / 60))}
                {t.seconds !== t.entry.minutes * 60 && ` of ${minutesText(t.entry.minutes)}`}
              </span>
            </li>
          ))}
          {!shares.length && <li className="py-1.5 text-ink-2">No time logged for this source.</li>}
        </ul>
        {shares.length > 0 && <p className="mt-2 text-xs text-muted">Total {hoursText(fromCents(toCents(shares.reduce((c, t) => c + t.seconds, 0) / 3600)))}.</p>}
      </Card>
    </>
  );
}
