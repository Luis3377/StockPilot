import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Boxes, Clock, FileUp, FlaskConical, PackagePlus, Receipt, TrendingDown } from 'lucide-react';
import { computeSale, daysWithoutSale, itemCostValue, salesByCategory, salesByMonth } from '../../domain/calc';
import { formatDate, formatMonth, todayISO } from '../../domain/dates';
import { formatPercent } from '../../domain/money';
import type { AppData, Sale } from '../../domain/types';
import { store } from '../../data/store';
import { useInsights, useMoney } from '../../lib/hooks';
import { BarList, ChartCard, ColumnChart } from '../../ui/charts';
import { Card, SectionHeader } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { ItemThumb } from '../../ui/Photo';
import { useDialogs } from '../dialogs/DialogHub';
import { useToast } from '../../ui/Toast';

export function MonthlyTrend({ sales, months = 6 }: { sales: Sale[]; months?: number }) {
  const { money, compact } = useMoney();
  const rows = salesByMonth(sales, months, todayISO());
  const labels = rows.map((r) => formatMonth(r.key));
  return (
    <ChartCard
      title="Revenue & net profit"
      description={`Monthly, last ${months} months · realized from recorded sales`}
      empty={sales.length === 0 ? 'Record a sale to see your monthly trend.' : undefined}
      table={{ columns: ['Month', 'Revenue', 'Net profit', 'Sales'], rows: rows.map((r, i) => [labels[i], money(r.revenue), money(r.netProfit), r.salesCount]) }}
    >
      <ColumnChart
        ariaLabel="Monthly revenue and net profit"
        labels={labels}
        series={[
          { id: 'rev', name: 'Revenue', color: 'var(--series-1)', values: rows.map((r) => r.revenue) },
          { id: 'profit', name: 'Net profit', color: 'var(--series-2)', values: rows.map((r) => r.netProfit) },
        ]}
        format={money}
        formatAxis={compact}
      />
    </ChartCard>
  );
}

export function CategoryProfit({ sales, periodLabel }: { sales: Sale[]; periodLabel: string }) {
  const { money } = useMoney();
  const groups = salesByCategory(sales).sort((a, b) => b.netProfit - a.netProfit);
  const shown = groups.slice(0, 6);
  return (
    <ChartCard
      title="Profit by category"
      description={`Net profit ${periodLabel}`}
      empty={groups.length === 0 ? `No sales ${periodLabel}.` : undefined}
      table={{ columns: ['Category', 'Revenue', 'Net profit', 'Margin'], rows: groups.map((g) => [g.label, money(g.revenue), money(g.netProfit), formatPercent(g.margin)]) }}
    >
      <BarList rows={shown.map((g) => ({ key: g.key, label: g.label, value: g.netProfit, sub: `${money(g.revenue)} revenue · ${formatPercent(g.margin)} margin` }))} format={money} />
      {groups.length > shown.length && <p className="mt-3 text-xs text-muted">+ {groups.length - shown.length} more in the table view</p>}
    </ChartCard>
  );
}

export function RecentSales({ sales, limit = 5 }: { sales: Sale[]; limit?: number }) {
  const { money } = useMoney();
  const recent = [...sales].sort((a, b) => b.saleDate.localeCompare(a.saleDate) || b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  return (
    <Card className="p-4 sm:p-5">
      <SectionHeader
        title="Recent sales"
        as="h3"
        action={
          <Link to="/sales" className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline">
            All sales <ArrowRight className="size-4" />
          </Link>
        }
      />
      {recent.length === 0 ? (
        <p className="mt-4 text-sm text-ink-2">No sales recorded yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {recent.map((s) => {
            const f = computeSale(s);
            return (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{s.itemName}</p>
                  <p className="text-xs text-ink-2">
                    {formatDate(s.saleDate)} · {s.platform || 'No platform'} · {s.quantity} sold
                  </p>
                </div>
                <div className="tabular shrink-0 text-right">
                  <p className="text-sm font-medium text-ink">{money(f.revenue)}</p>
                  <p className={`text-xs ${f.netProfit < 0 ? 'text-bad-text' : 'text-good-text'}`}>{money(f.netProfit)} profit</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function SlowMovers({ data, limit = 5 }: { data: AppData; limit?: number }) {
  const { money } = useMoney();
  const report = useInsights();
  const section = report.slowMoving;
  const today = todayISO();
  return (
    <Card className="p-4 sm:p-5">
      <SectionHeader
        title="Slow-moving inventory"
        description={section.rule.split(' (')[0]}
        as="h3"
        action={
          <Link to="/insights" className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline">
            Insights <ArrowRight className="size-4" />
          </Link>
        }
      />
      {section.findings.length === 0 ? (
        <p className="mt-4 text-sm text-ink-2">{section.insufficient ?? section.summary}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {section.findings.slice(0, limit).map(({ item }) => (
            <li key={item.id}>
              <Link to={`/inventory/${item.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                <ItemThumb photoId={item.photoIds[0]} name={item.name} className="size-10 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                  <p className="flex items-center gap-1 text-xs text-ink-2">
                    <Clock className="size-3" /> {daysWithoutSale(item, data.sales, today)} days without a sale
                  </p>
                </div>
                <span className="tabular shrink-0 text-sm text-ink">{money(itemCostValue(item))}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {section.findings.length > limit && <p className="mt-2 text-xs text-muted">+ {section.findings.length - limit} more</p>}
    </Card>
  );
}

export function AlertStrip() {
  const report = useInsights();
  const low = report.lowStock.findings.length;
  const pricing = report.pricingRisks.findings.length;
  const losses = report.lowMarginSales.findings.filter((f) => f.group.netProfit < 0).length;
  const alerts = [
    low > 0 && { icon: <AlertTriangle className="size-4" />, text: `${low} ${low === 1 ? 'item is' : 'items are'} low on stock`, tone: 'warn' },
    pricing > 0 && { icon: <TrendingDown className="size-4" />, text: `${pricing} asking ${pricing === 1 ? 'price' : 'prices'} may not be profitable`, tone: 'warn' },
    losses > 0 && { icon: <TrendingDown className="size-4" />, text: `${losses} ${losses === 1 ? 'item' : 'items'} sold at a loss`, tone: 'bad' },
  ].filter(Boolean) as { icon: React.ReactNode; text: string; tone: string }[];
  if (!alerts.length) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="alert-strip">
      {alerts.map((a) => (
        <Link
          key={a.text}
          to="/insights"
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${a.tone === 'bad' ? 'bg-bad-soft text-bad-text' : 'bg-warn-soft text-warn-text'}`}
        >
          {a.icon} {a.text} <ArrowRight className="size-3.5" />
        </Link>
      ))}
    </div>
  );
}

export function GetStarted() {
  const dialogs = useDialogs();
  const toast = useToast();
  return (
    <Card className="overflow-hidden" data-testid="get-started">
      <div className="grid grid-cols-1 gap-6 p-6 sm:p-8 md:grid-cols-[1.2fr_1fr] md:items-center">
        <div>
          <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
            <Boxes className="size-6" />
          </span>
          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink">Let’s add your first item</h2>
          <p className="mt-2 text-ink-2">All you need is a name, how many you have, and what you paid. Photos and details are optional.</p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button variant="primary" size="lg" icon={<PackagePlus className="size-5" />} onClick={dialogs.addItem}>
              Add your first item
            </Button>
            <Button size="lg" icon={<FileUp className="size-5" />} onClick={dialogs.importCsv}>
              Import a spreadsheet
            </Button>
          </div>
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-demo hover:underline"
            onClick={async () => {
              await store.setDemoActive(true);
              toast.info('Demo mode is on. Explore freely — your real data is kept separately.');
            }}
          >
            <FlaskConical className="size-4" /> Or explore with demo data
          </button>
        </div>
        <ol className="space-y-3 rounded-2xl bg-surface-2 p-5 text-sm">
          {[
            ['Add items', 'Name, quantity and cost — that’s it.', <PackagePlus key="a" className="size-4" />],
            ['Record sales', 'Stock updates and profit is calculated after fees and shipping.', <Receipt key="b" className="size-4" />],
            ['Get insights', 'See what’s selling, what’s sitting and what you’re really making.', <TrendingDown key="c" className="size-4 rotate-180" />],
          ].map(([title, body, icon], i) => (
            <li key={i} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-accent-text shadow-card">{icon}</span>
              <span>
                <span className="block font-medium text-ink">{title}</span>
                <span className="text-ink-2">{body}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}
