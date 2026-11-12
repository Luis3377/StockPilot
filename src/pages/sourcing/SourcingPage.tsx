// Insights → Sourcing Performance: where the money and the time go. Tabs: overview (profit by
// source, type and category), profit per hour, sourcing trips, time log, and sources.

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, ChevronDown, Info } from 'lucide-react';
import { sessionStats, smallSample, sourcingReport, typeLabel, UNASSIGNED_KEY, type GroupStats, type SourceStats } from '../../insights/sourcing';
import { ACTIVITIES, ACTIVITY_LABELS, SOURCE_TYPE_LABELS, SOURCE_TYPES } from '../../domain/sourcing';
import { inRange, periodRange, PERIOD_OPTIONS, type PeriodKey } from '../../domain/dates';
import { plural } from '../../domain/format';
import type { SourceType, TimeActivity } from '../../domain/types';
import { useAppState } from '../../data/store';
import { useMoney } from '../../lib/hooks';
import { Card, PageHeader, SectionHeader } from '../../ui/Card';
import { Badge } from '../../ui/Badge';
import { SelectField } from '../../ui/Fields';
import { PeriodPicker } from '../../ui/PeriodPicker';
import { StatTile } from '../../ui/Stat';
import { BarList } from '../../ui/charts';
import { useRadioGroup } from '../../ui/useRadioGroup';
import { cn } from '../../ui/cn';
import { Figures, hoursText, pctText, ScrollTable, sourceHref } from './parts';
import { TimeTab } from './TimeTab';
import { TripsTab } from './TripsTab';
import { SourcesTab } from './SourcesTab';

const TABS = ['overview', 'hours', 'trips', 'time', 'sources'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = { overview: 'Overview', hours: 'Profit per hour', trips: 'Trips', time: 'Time log', sources: 'Sources' };

export function SourcingPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview';
  const radio = useRadioGroup(TABS, tab, (t) => setParams({ tab: t }, { replace: true }));
  return (
    <>
      <Link to="/insights" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> Insights
      </Link>
      <PageHeader title="Sourcing Performance" description="Where your inventory comes from, what it actually makes once sold, and what your time earns. From your recorded purchases, sales and time." />
      <div role="tablist" aria-label="Sourcing Performance sections" className="mb-4 flex flex-wrap gap-1.5" data-testid="sourcing-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            {...radio(t)}
            onClick={() => setParams({ tab: t }, { replace: true })}
            className={cn('rounded-full border px-3 py-1.5 text-sm font-medium', tab === t ? 'border-accent bg-accent-soft text-accent-text' : 'border-line-strong bg-surface text-ink-2 hover:text-ink')}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div role="tabpanel" aria-label={TAB_LABELS[tab]}>
        {tab === 'overview' && <Overview />}
        {tab === 'hours' && <PerHour />}
        {tab === 'trips' && <TripsTab />}
        {tab === 'time' && <TimeTab />}
        {tab === 'sources' && <SourcesTab />}
      </div>
    </>
  );
}

function useFilters() {
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [category, setCategory] = useState('');
  const [type, setType] = useState<SourceType | 'none' | ''>('');
  return { period, setPeriod, category, setCategory, type, setType };
}

function Filters({ f, categories, withType = true }: { f: ReturnType<typeof useFilters>; categories: string[]; withType?: boolean }) {
  return (
    <Card className="mb-4 space-y-3 p-4" data-testid="sourcing-filters">
      <PeriodPicker value={f.period} onChange={f.setPeriod} />
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Category" value={f.category} onChange={f.setCategory}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </SelectField>
        {withType && (
          <SelectField label="Source type" value={f.type} onChange={(v) => f.setType(v as SourceType | 'none' | '')}>
            <option value="">All types</option>
            {SOURCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SOURCE_TYPE_LABELS[t]}
              </option>
            ))}
            <option value="none">Type not set</option>
          </SelectField>
        )}
      </div>
    </Card>
  );
}

function useReport(f: ReturnType<typeof useFilters>) {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const range = periodRange(f.period);
  const report = sourcingReport(data, settings, { range, category: f.category || null });
  const categories = [...new Set([...data.sales.map((s) => s.itemCategory.trim() || 'Uncategorized'), ...data.items.map((i) => i.category.trim() || 'Uncategorized')])].sort();
  const sources = report.sources.filter((s) => !f.type || (s.ref.type ?? 'none') === f.type);
  return { data, report, sources, categories, rangeLabel: PERIOD_OPTIONS.find((o) => o.key === f.period)!.label.toLowerCase() };
}

function Overview() {
  const f = useFilters();
  const { money } = useMoney();
  const { report, sources, categories, rangeLabel } = useReport(f);
  const [defs, setDefs] = useState(false);
  const t = report.totals;
  if (!report.sources.length) {
    return (
      <>
        <Filters f={f} categories={categories} />
        <Card className="p-5 text-sm text-ink-2" data-testid="sourcing-empty">
          Nothing to show yet. Record where you buy things (“Where you bought it” when adding an item or lot), then sell some, and this shows what each source actually makes.
        </Card>
      </>
    );
  }
  const tied = [...sources].filter((s) => s.inventoryCost > 0).sort((a, b) => b.inventoryCost - a.inventoryCost);
  return (
    <>
      <Filters f={f} categories={categories} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="sourcing-totals">
        <StatTile label="Realized profit" value={money(t.netProfit)} tone={t.netProfit < 0 ? 'bad' : 'default'} sub={`From sales ${rangeLabel === 'all time' ? 'of all time' : rangeLabel}`} testId="sourcing-profit" />
        <StatTile label="Sales revenue" value={money(t.revenue)} sub={`${plural(t.unitsSold, 'unit')} sold`} />
        <StatTile label="Cash tied up in unsold stock" value={money(t.inventoryCost)} sub="Inventory cost today" testId="sourcing-tied" />
        <StatTile label="Realized profit per logged hour" value={t.profitPerHour === null ? 'Not enough time data' : money(t.profitPerHour)} sub={report.hasTime ? `${hoursText(t.hours)} logged` : 'Log time to see this'} testId="sourcing-pph" />
      </div>
      <Notes report={report} />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5" data-testid="chart-profit">
          <SectionHeader title="Realized profit by source" description="Completed sales only. Unsold stock and estimates aren’t profit." />
          <div className="mt-3">
            <BarList rows={sources.filter((s) => s.sales.length).map((s) => ({ key: s.ref.key, label: s.ref.name, value: s.realizedProfit, sub: `${plural(s.unitsSold, 'unit')} sold${smallSample(s.unitsSold) ? ' · small sample' : ''}` }))} format={money} />
            {!sources.some((s) => s.sales.length) && <p className="text-sm text-ink-2">No sales in this period.</p>}
          </div>
        </Card>
        <Card className="p-4 sm:p-5" data-testid="chart-tied">
          <SectionHeader title="Cash tied up in unsold stock" description="What the items still in stock cost you, by source. Today." />
          <div className="mt-3">
            <BarList rows={tied.map((s) => ({ key: s.ref.key, label: s.ref.name, value: s.inventoryCost, sub: `${plural(s.unitsRemaining, 'unit')}${s.avgDaysInStock !== null ? ` · ${s.avgDaysInStock} days in stock on average` : ''}` }))} format={money} color="var(--series-2)" />
            {!tied.length && <p className="text-sm text-ink-2">Nothing in stock.</p>}
          </div>
        </Card>
      </div>

      <section className="mt-4" aria-labelledby="by-source">
        <h2 id="by-source" className="mb-2 text-base font-semibold text-ink">
          By source
        </h2>
        <ul className="grid gap-3 md:grid-cols-2" data-testid="source-cards">
          {sources.map((s) => (
            <li key={s.ref.key}>
              <SourceCard s={s} />
            </li>
          ))}
        </ul>
      </section>

      <GroupTable title="By source type" rows={report.types} testId="by-type" first="Type" />
      <GroupTable title="By product category" rows={report.categories} testId="by-category" first="Category" />

      <button type="button" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent-text" onClick={() => setDefs((v) => !v)} aria-expanded={defs}>
        What these figures mean
        <ChevronDown className={cn('size-4 transition-transform', defs && 'rotate-180')} aria-hidden />
      </button>
      {defs && <Definitions />}
    </>
  );
}

export function Notes({ report }: { report: ReturnType<typeof sourcingReport> }) {
  const { money } = useMoney();
  const notes = [
    report.missingActivities.length > 0 && `Incomplete time: no ${report.missingActivities.map((a) => ACTIVITY_LABELS[a as TimeActivity].toLowerCase()).join(', ')} time logged in this period, so profit per hour is overstated.`,
    report.tripNotSplitHours > 0 && `${hoursText(report.tripNotSplitHours)} from trips with several sources isn’t divided between them yet. Open the trip and choose how to split it.`,
    report.unallocatedTripExpenses > 0 && `${money(report.unallocatedTripExpenses)} of trip expenses isn’t divided between sources yet (choose a split on the trip).`,
  ].filter(Boolean) as string[];
  if (!notes.length) return null;
  return (
    <ul className="mt-3 space-y-1.5" data-testid="sourcing-notes">
      {notes.map((n) => (
        <li key={n} className="flex items-start gap-1.5 rounded-xl bg-warn-soft p-2.5 text-sm text-warn-text">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0">{n}</span>
        </li>
      ))}
    </ul>
  );
}

function SourceCard({ s }: { s: SourceStats }) {
  const { money } = useMoney();
  return (
    <Card className="p-4" data-testid="source-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={sourceHref(s.ref.key)} className="font-semibold break-words text-accent-text hover:underline">
            {s.ref.name}
          </Link>
          <p className="text-xs text-muted">
            {typeLabel(s.ref.type)}
            {!s.ref.registered && s.ref.key !== UNASSIGNED_KEY && ' · name from a lot, not in your sources yet'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {s.stillSelling && <Badge tone="accent">Still selling</Badge>}
          {s.sales.length > 0 && smallSample(s.unitsSold) && <Badge tone="warn">Small sample</Badge>}
        </div>
      </div>
      <Figures
        className="mt-3"
        rows={[
          ['Realized profit', money(s.realizedProfit), s.realizedProfit < 0 ? 'text-bad-text' : undefined],
          ['Sales revenue', money(s.revenue)],
          ['Margin', pctText(s.marginPct)],
          ['ROI on cost of goods sold', pctText(s.roiPct)],
          ['Cost of goods sold', money(s.costOfGoods)],
          ['Fees · shipping', `${money(s.fees + s.otherExpenses)} · ${money(s.shipping)}`],
          ['Bought (cost · units)', `${money(s.acquisitionCost)} · ${s.unitsPurchased}`],
          ['Sold · in stock', `${s.unitsSold} · ${s.unitsRemaining}`],
          ['Tied up in stock', money(s.inventoryCost)],
          ['Avg. days to sell', s.avgDaysToSell === null ? '—' : String(s.avgDaysToSell)],
          ['Profit per logged hour', s.profitPerHour === null ? (s.sales.length ? 'Not enough time data' : '—') : money(s.profitPerHour)],
          ['Trip expenses (not in item costs)', money(s.tripExpenses)],
        ]}
      />
    </Card>
  );
}

function GroupTable({ title, rows, testId, first }: { title: string; rows: GroupStats[]; testId: string; first: string }) {
  const { money } = useMoney();
  if (!rows.length) return null;
  return (
    <Card className="mt-4 p-4 sm:p-5" data-testid={testId}>
      <SectionHeader title={title} />
      <ScrollTable label={title}>
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th scope="col" className="py-1.5 pr-2 font-medium">
                {first}
              </th>
              {['Revenue', 'Cost of goods sold', 'Realized profit', 'Margin', 'ROI', 'Units sold', 'Tied up'].map((h) => (
                <th key={h} scope="col" className="px-2 py-1.5 text-right font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular">
            {rows.map((g) => (
              <tr key={g.key} className="border-t border-line">
                <th scope="row" className="py-1.5 pr-2 text-left font-normal text-ink">
                  {g.label}
                  {g.unitsSold > 0 && smallSample(g.unitsSold) && <span className="block text-[11px] text-muted">Small sample</span>}
                </th>
                <td className="px-2 py-1.5 text-right">{money(g.revenue)}</td>
                <td className="px-2 py-1.5 text-right">{money(g.costOfGoods)}</td>
                <td className={cn('px-2 py-1.5 text-right', g.realizedProfit < 0 && 'text-bad-text')}>{money(g.realizedProfit)}</td>
                <td className="px-2 py-1.5 text-right">{pctText(g.marginPct)}</td>
                <td className="px-2 py-1.5 text-right">{pctText(g.roiPct)}</td>
                <td className="px-2 py-1.5 text-right">{g.unitsSold}</td>
                <td className="px-2 py-1.5 text-right">{money(g.inventoryCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
    </Card>
  );
}

function Definitions() {
  return (
    <ul className="mt-2 list-disc space-y-1 rounded-2xl bg-surface-2 p-3 pl-7 text-sm text-ink-2" data-testid="sourcing-definitions">
      <li>
        <strong className="text-ink">Source</strong>: where you bought it. Items in a bulk lot count toward the lot’s source. Records with no source show as “Unassigned source”; nothing is guessed.
      </li>
      <li>
        <strong className="text-ink">Realized profit</strong> = sales revenue − cost of goods sold − fees, shipping and other selling expenses, for sales dated in the period. Unsold stock is never counted as
        profit, and payouts aren’t sales.
      </li>
      <li>
        <strong className="text-ink">Cost of goods sold</strong>: what the units sold cost you. For a bulk lot, each item’s exact share of the lot, so a partly sold lot never counts its whole cost.
      </li>
      <li>
        <strong className="text-ink">Margin</strong> = realized profit ÷ sales revenue. <strong className="text-ink">ROI</strong> = realized profit ÷ cost of goods sold (the cost of the units that sold).
      </li>
      <li>
        <strong className="text-ink">Bought</strong>: purchases dated in the period (cost and units, restocks included). <strong className="text-ink">Tied up in stock</strong>: inventory cost of what’s
        still on hand, today.
      </li>
      <li>
        <strong className="text-ink">Trip expenses</strong> (entry fees, fuel…) aren’t part of any item’s cost. They show per source only when a trip had one source, or you chose how to split them.
      </li>
      <li>
        <strong className="text-ink">Small sample</strong>: fewer than 5 units sold. Past results from a few sales may not represent what a source will do next.
      </li>
    </ul>
  );
}

function PerHour() {
  const f = useFilters();
  const { money } = useMoney();
  const { data, report, categories, rangeLabel } = useReport(f);
  const settings = useAppState((s) => s.settings);
  void settings;
  const t = report.totals;
  const range = periodRange(f.period);
  const minutesBy = ACTIVITIES.map((a) => [a, data.sourcing.timeEntries.filter((e) => e.activity === a && inRange(e.date, range)).reduce((c, e) => c + e.minutes, 0)] as const);
  const withTime = report.sources.filter((s) => s.hours > 0);
  const trips = data.sourcing.sessions.map((s) => sessionStats(data, s)).filter((s) => s.hours > 0);
  return (
    <>
      <Filters f={f} categories={categories} withType={false} />
      <Card className="p-4 sm:p-5" data-testid="pph-summary">
        <SectionHeader title="Realized profit per logged hour" description="Realized profit ÷ hours you logged. Not an hourly wage: your time isn’t subtracted from profit, and unsold stock isn’t counted." />
        {report.hasTime ? (
          <p className="mt-3 text-sm text-ink" data-testid="pph-formula">
            {money(t.netProfit)} realized profit ÷ {hoursText(t.hours)} logged ({rangeLabel}) ={' '}
            <span className={cn('text-lg font-semibold', (t.profitPerHour ?? 0) < 0 && 'text-bad-text')}>{money(t.profitPerHour!)} per logged hour</span>
          </p>
        ) : (
          <p className="mt-3 text-sm text-ink-2" data-testid="pph-none">
            Not enough time data. Log time on the Time log tab (manually or with the timer) to see this.
          </p>
        )}
        <p className="mt-2 text-xs text-muted">
          Included: {minutesBy.map(([a, m]) => `${ACTIVITY_LABELS[a].toLowerCase()} ${hoursText(Math.round((m / 60) * 100) / 100)}`).join(' · ')}.
        </p>
        <Notes report={report} />
        {report.unallocatedHours - report.tripNotSplitHours > 0 && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-2">
            <Info className="mt-px size-3.5 shrink-0" aria-hidden />
            {hoursText(Math.round((report.unallocatedHours - report.tripNotSplitHours) * 100) / 100)} of general work (not linked to a source) is in the total but not in any source below.
          </p>
        )}
      </Card>

      <Card className="mt-4 p-4 sm:p-5" data-testid="pph-sources">
        <SectionHeader title="By source" description="Realized profit ÷ hours linked to the source (directly, through its trips, lots or items)." />
        {withTime.length ? (
          <div className="mt-3">
            <BarList
              rows={withTime.map((s) => ({
                key: s.ref.key,
                label: s.ref.name,
                value: s.profitPerHour ?? 0,
                sub: `${money(s.realizedProfit)} ÷ ${hoursText(s.hours)}${s.stillSelling ? ' · still selling: more profit may come' : ''}${smallSample(s.unitsSold) ? ' · small sample' : ''}`,
              }))}
              format={(v) => `${money(v)}/h`}
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink-2">Not enough time data: no time is linked to a source yet.</p>
        )}
        {report.sources.some((s) => s.sales.length && s.hours === 0) && (
          <p className="mt-3 text-xs text-ink-2">
            Not enough time data for: {report.sources.filter((s) => s.sales.length && s.hours === 0).map((s) => s.ref.name).join(', ')}.
          </p>
        )}
      </Card>

      <Card className="mt-4 p-4 sm:p-5" data-testid="pph-categories">
        <SectionHeader title="By category" description="Time counts toward a category only when it’s linked to items or lots (a lot’s time is split by each item’s cost)." />
        <ul className="mt-2 divide-y divide-line text-sm">
          {report.categories.map((c) => (
            <li key={c.key} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
              <span className="text-ink">{c.label}</span>
              <span className="tabular text-ink-2">
                {c.profitPerHour === null ? 'Not enough time data' : `${money(c.realizedProfit)} ÷ ${hoursText(c.hours)} = ${money(c.profitPerHour)}/h`}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {trips.length > 0 && (
        <Card className="mt-4 p-4 sm:p-5" data-testid="pph-trips">
          <SectionHeader title="By trip" description="Realized profit from what each trip bought ÷ time logged for the trip, its lots and items. All time." />
          <ul className="mt-2 divide-y divide-line text-sm">
            {trips.map((s) => (
              <li key={s.session.id} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                <Link to={`/insights/sourcing/trips/${s.session.id}`} className="text-accent-text hover:underline">
                  {s.session.name}
                </Link>
                <span className="tabular text-ink-2">
                  {money(s.realizedProfit)} ÷ {hoursText(s.hours)} = {money(s.profitPerHour!)}/h{s.completed ? '' : ' · still selling'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
