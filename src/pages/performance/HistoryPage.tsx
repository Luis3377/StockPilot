// Inventory → Lots → Performance: how completed lots did, against what was predicted, so the next
// purchase can be planned better. Every figure comes from recorded sales, costs and stock.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronDown, TrendingUp } from 'lucide-react';
import { lotHistory, MIN_SAMPLE, type HistoryFilters, type HistoryRow } from '../../insights/performance';
import { formatDate } from '../../domain/dates';
import { plural } from '../../domain/format';
import type { BidLotKind } from '../../domain/types';
import { useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { Card, PageHeader, SectionHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { EmptyState } from '../../ui/EmptyState';
import { SelectField, TextField } from '../../ui/Fields';
import { StatTile } from '../../ui/Stat';
import { cn } from '../../ui/cn';
import { pctText, signedPct, STAGE_LABELS, STAGE_TONES } from './parts';

export function HistoryPage() {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const { money } = useMoney();
  const [filters, setFilters] = useState<HistoryFilters>({});
  const [showDefs, setShowDefs] = useState(false);
  const h = lotHistory(data, settings, filters);
  const set = (patch: Partial<HistoryFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const inProgress = h.rows.filter((r) => !r.final);

  return (
    <>
      <Link to="/inventory/lots" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> All lots
      </Link>
      <PageHeader title="Lot performance" description="How your completed lots did, and how close your predictions were. From your recorded sales, costs and stock." />

      {data.lots.length === 0 ? (
        <Card>
          <EmptyState icon={<TrendingUp className="size-6" />} title="No lots yet">
            Add a bulk lot (or plan one with the Max Bid Calculator and record the purchase). Once it sells, its results show here.
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card className="mb-4 p-4" data-testid="history-filters">
            <div className="grid gap-3 sm:grid-cols-4">
              <TextField label="Bought from" type="date" value={filters.from ?? ''} onChange={(v) => set({ from: v || null })} />
              <TextField label="Bought to" type="date" value={filters.to ?? ''} onChange={(v) => set({ to: v || null })} />
              <SelectField label="Lot type" value={filters.kind ?? ''} onChange={(v) => set({ kind: (v || null) as BidLotKind | 'unplanned' | null })}>
                <option value="">All types</option>
                {h.types.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </SelectField>
              <SelectField label="Where bought" value={filters.source ?? ''} onChange={(v) => set({ source: v || null })}>
                <option value="">Anywhere</option>
                {h.sources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </SelectField>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" data-testid="history-stats">
            <StatTile label="Completed lots" value={String(h.completed.length)} sub={inProgress.length ? `${inProgress.length} still selling (not counted)` : 'All lots finished'} testId="history-completed" />
            <StatTile label="Invested" value={money(h.investment)} sub="Acquisition cost of completed lots" />
            <StatTile label="Result" value={money(h.result)} tone={h.result < 0 ? 'bad' : 'default'} sub="Net proceeds − acquisition cost" testId="history-result" />
            <StatTile label="ROI, all completed lots" value={pctText(h.aggregateRoiPct)} sub={`Total result ÷ total invested · average per lot ${pctText(h.meanRoiPct)}`} testId="history-roi" />
            <StatTile
              label="Average forecast error"
              value={h.meanNetErrorPct === null ? '—' : signedPct(h.meanNetErrorPct)}
              sub={h.plannedCompleted ? `Net proceeds vs prediction, ${plural(h.plannedCompleted, 'planned lot')}` : 'No completed lot was planned with Max Bid'}
              testId="history-error"
            />
          </div>

          <button type="button" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-text" onClick={() => setShowDefs((v) => !v)} aria-expanded={showDefs}>
            How these are calculated
            <ChevronDown className={cn('size-4 transition-transform', showDefs && 'rotate-180')} aria-hidden />
          </button>
          {showDefs && (
            <ul className="mt-2 list-disc space-y-1 rounded-2xl bg-surface-2 p-3 pl-7 text-sm text-ink-2" data-testid="history-definitions">
              <li>A lot is <strong className="text-ink">completed</strong> when every unit is sold or written off, or you closed it. Lots still selling aren’t in these totals.</li>
              <li>
                <strong className="text-ink">Result</strong> = net proceeds (sales − fees, shipping and other selling expenses) − acquisition cost (purchase price + buying costs).
              </li>
              <li>
                <strong className="text-ink">ROI, all completed lots</strong> = total result ÷ total invested. The average per lot is the simple mean of each lot’s ROI.
              </li>
              <li>
                <strong className="text-ink">Forecast error</strong> = (actual net proceeds − predicted) ÷ predicted, for lots planned with the Max Bid Calculator (expected scenario), averaged per lot.
                {h.aggregateNetErrorPct !== null && ` All planned lots together: ${signedPct(h.aggregateNetErrorPct)}.`}
              </li>
            </ul>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <RankCard title="Best-performing lots" rows={h.best} testId="history-best" />
            <RankCard title="Worst-performing lots" rows={h.worst} testId="history-worst" empty="Shown once you have more than 3 completed lots (the best 3 aren’t repeated here)." />
          </div>

          {h.byType.length > 0 && (
            <Card className="mt-4 p-4 sm:p-5" data-testid="history-by-type">
              <SectionHeader title="By lot type" description="Completed lots, grouped by the type set in their Max Bid plan." />
              <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Results by lot type">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th scope="col" className="py-1.5 pr-2 font-medium">Type</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Lots</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Invested</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">Result</th>
                      <th scope="col" className="px-2 py-1.5 text-right font-medium">ROI</th>
                      <th scope="col" className="py-1.5 pl-2 text-right font-medium">Forecast error</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {h.byType.map((g) => (
                      <tr key={g.key} className="border-t border-line">
                        <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink">
                          {g.label}
                          {g.lots < MIN_SAMPLE && <span className="block text-[11px] text-muted">Small sample</span>}
                        </th>
                        <td className="px-2 py-1.5 text-right">{g.lots}</td>
                        <td className="px-2 py-1.5 text-right">{money(g.cost)}</td>
                        <td className={cn('px-2 py-1.5 text-right', g.result < 0 && 'text-bad-text')}>{money(g.result)}</td>
                        <td className="px-2 py-1.5 text-right">{pctText(g.roiPct)}</td>
                        <td className="py-1.5 pl-2 text-right">{g.meanNetErrorPct === null ? '—' : signedPct(g.meanNetErrorPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {h.byCategory.length > 0 && (
            <Card className="mt-4 p-4 sm:p-5" data-testid="history-by-category">
              <SectionHeader title="Selling prices by category" description="Units sold from planned lots, against the plan’s prices for them (your estimate × the expected resale %). Includes lots still selling." />
              <ul className="mt-2 divide-y divide-line text-sm">
                {h.byCategory.map((c) => (
                  <li key={c.category} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                    <span className="min-w-0 text-ink">
                      {c.category} <span className="text-ink-2">· {plural(c.unitsSold, 'unit')} from {plural(c.lots, 'lot')}</span>
                      {c.unitsSold < MIN_SAMPLE && <span className="ml-1 text-xs text-muted">(small sample)</span>}
                    </span>
                    <span className="tabular text-ink-2">
                      {money(c.actual)} vs {money(c.predicted)} <span className={cn('font-medium', (c.differencePct ?? 0) < 0 ? 'text-bad-text' : 'text-good-text')}>{signedPct(c.differencePct)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="mt-4 p-4 sm:p-5" data-testid="history-lots">
            <SectionHeader title="All lots" description={`${plural(h.rows.length, 'lot')} match. Open one to see its predicted vs. actual.`} />
            <ul className="mt-2 divide-y divide-line">
              {h.rows.map((r) => (
                <li key={r.lot.id} className="py-2" data-testid="history-lot">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <Link to={`/inventory/lots/${r.lot.id}/performance`} className="min-w-0 font-medium break-words text-accent-text hover:underline">
                      {r.lot.name}
                    </Link>
                    <Badge tone={STAGE_TONES[r.stage]}>{STAGE_LABELS[r.stage]}</Badge>
                  </div>
                  <p className="text-xs text-muted">
                    {r.type} · {formatDate(r.date)}
                    {r.lot.source && r.lot.source !== r.type ? ` · ${r.lot.source}` : ''}
                  </p>
                  <dl className="mt-1 grid grid-cols-2 gap-x-3 text-sm sm:grid-cols-4">
                    <Pair label="Cost" value={money(r.cost)} />
                    <Pair label={r.final ? 'Result' : 'Result so far'} value={money(r.result)} bad={r.result < 0} />
                    <Pair label={r.final ? 'ROI' : 'ROI so far'} value={pctText(r.roiPct)} />
                    <Pair label="Forecast error" value={r.netErrorPct === null ? (r.predictedNet === null ? 'Not planned' : r.final ? '—' : 'Not final') : signedPct(r.netErrorPct)} />
                  </dl>
                </li>
              ))}
            </ul>
            {h.rows.length === 0 && <p className="mt-2 text-sm text-ink-2">No lots match these filters.</p>}
          </Card>
        </>
      )}
    </>
  );
}

function Pair({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="flex justify-between gap-2 sm:block">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn('tabular', bad ? 'text-bad-text' : 'text-ink')}>{value}</dd>
    </div>
  );
}

function RankCard({ title, rows, testId, empty = 'No completed lots yet.' }: { title: string; rows: HistoryRow[]; testId: string; empty?: string }) {
  const { money } = useMoney();
  return (
    <Card className="p-4 sm:p-5" data-testid={testId}>
      <SectionHeader title={title} description="Completed lots, by ROI." />
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">{empty}</p>
      ) : (
        <ol className="mt-2 space-y-1.5 text-sm">
          {rows.map((r) => (
            <li key={r.lot.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
              <Link to={`/inventory/lots/${r.lot.id}/performance`} className="min-w-0 font-medium break-words text-accent-text hover:underline">
                {r.lot.name}
              </Link>
              <span className={cn('tabular', r.result < 0 ? 'text-bad-text' : 'text-ink-2')}>
                {money(r.result)} · {pctText(r.roiPct)} ROI
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
