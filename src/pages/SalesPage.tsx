import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, CalendarCheck, CalendarRange, PiggyBank, Landmark, Pencil, Receipt, Search, Trash2, Undo2 } from 'lucide-react';
import { deleteSale } from '../domain/actions';
import { computeSale, inventoryTotals, nameKey, platformLabel, projectUnsold, salesByPlatform, salesInRange, totalSales } from '../domain/calc';
import { formatDate, periodRange, PERIOD_OPTIONS, todayISO, type DateRange, type PeriodKey } from '../domain/dates';
import { formatPercent, fromCents, toCents } from '../domain/money';
import { adjustmentSummary } from '../insights/adjustments';
import { store, useAppState } from '../data/store';
import { profitSummaryCsv, salesCsv } from '../csv/exports';
import { downloadText, fileStamp } from '../lib/download';
import { useMoney } from '../lib/hooks';
import { usePersistentState } from '../lib/usePersistentState';
import { PageHeader, Card, SectionHeader } from '../ui/Card';
import { Button, IconButton, buttonClass } from '../ui/Button';
import { StatTile, REALIZED, PROJECTED } from '../ui/Stat';
import { PeriodPicker } from '../ui/PeriodPicker';
import { EmptyState } from '../ui/EmptyState';
import { BarList, ChartCard } from '../ui/charts';
import { Badge } from '../ui/Badge';
import { inputClass } from '../ui/Fields';
import { useConfirm } from '../ui/Confirm';
import { useToast } from '../ui/Toast';
import { cn } from '../ui/cn';
import { useDialogs } from './dialogs/DialogHub';
import { MonthlyTrend } from './overview/widgets';
import { plural, pluralWord } from '../domain/format';

const PERIOD_KEYS = PERIOD_OPTIONS.map((p) => p.key);

export function SalesPage() {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const dataset = useAppState((s) => s.dataset);
  const dialogs = useDialogs();
  const confirm = useConfirm();
  const toast = useToast();
  const { money } = useMoney();
  const [period, setPeriod] = usePersistentState<PeriodKey>('sales-period', 'this_month', PERIOD_KEYS);
  const [platform, setPlatform] = useState('');
  const [q, setQ] = useState('');

  const range = periodRange(period, todayISO());
  const platforms = useMemo(() => salesByPlatform(data.sales).map((g) => g.label).sort((a, b) => a.localeCompare(b)), [data.sales]);
  const inPeriod = salesInRange(data.sales, range);
  const filtered = inPeriod
    .filter((s) => !platform || nameKey(platformLabel(s.platform)) === nameKey(platform))
    .filter((s) => !q.trim() || `${s.itemName} ${s.itemSku} ${s.platform} ${s.notes}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b.saleDate.localeCompare(a.saleDate) || b.createdAt.localeCompare(a.createdAt));
  const t = totalSales(filtered);
  const projection = projectUnsold(data.items, data.sales, settings);
  const inv = inventoryTotals(data.items);
  const byPlatform = salesByPlatform(inPeriod).sort((a, b) => b.netProfit - a.netProfit);
  const prefix = `stockpilot-${dataset === 'demo' ? 'demo-' : ''}`;

  const cancelSale = async (id: string) => {
    const sale = data.sales.find((s) => s.id === id);
    if (!sale) return;
    const itemExists = data.items.some((i) => i.id === sale.itemId);
    const ok = await confirm({
      title: 'Cancel this sale?',
      message: (
        <>
          <p>
            {sale.quantity} × {sale.itemName} sold on {formatDate(sale.saleDate)} will be removed from your sales, revenue and profit.
          </p>
          <p className="mt-2">{itemExists ? `The ${plural(sale.quantity, 'unit')} ${pluralWord(sale.quantity, 'goes', 'go')} back into stock.` : 'The item was deleted, so no stock is returned.'}</p>
        </>
      ),
      confirmLabel: 'Cancel sale',
      cancelLabel: 'Keep sale',
    });
    if (!ok) return;
    const r = store.commit((d) => deleteSale(d, id));
    toast.success(r.restored ? `Sale cancelled. ${sale.quantity} returned to stock.` : 'Sale cancelled.');
  };

  if (data.sales.length === 0) {
    return (
      <>
        <PageHeader
          title="Sales & Profit"
          actions={
            <>
              <Link to="/sales/close" className={buttonClass('secondary', 'md')} data-testid="close-link">
                <CalendarCheck className="size-4" aria-hidden /> Monthly Close
              </Link>
              <Link to="/sales/year-end" className={buttonClass('secondary', 'md')} data-testid="yearend-link">
                <CalendarRange className="size-4" aria-hidden /> Year-End Review
              </Link>
              <Link to="/sales/planning" className={buttonClass('secondary', 'md')} data-testid="planning-link">
                <PiggyBank className="size-4" aria-hidden /> Financial Planning
              </Link>
              <Link to="/sales/payouts" className={buttonClass('secondary', 'md')} data-testid="payouts-link">
                <Landmark className="size-4" aria-hidden /> Payout reconciliation
              </Link>
            </>
          }
        />
        <Card>
          <EmptyState
            icon={<Receipt className="size-6" />}
            title="No sales recorded yet"
            actions={
              <Button variant="primary" icon={<Receipt className="size-4" />} onClick={() => dialogs.recordSale()}>
                Record your first sale
              </Button>
            }
          >
            When you sell something, record it here. StockPilot reduces your stock and works out your profit after fees, shipping and other costs.
          </EmptyState>
        </Card>
        {inv.itemsInStock > 0 && <ProjectedCard projection={projection} money={money} />}
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Sales & Profit"
        description="Realized profit from recorded sales, after every cost you entered."
        actions={
          <>
            <Button icon={<Download className="size-4" />} onClick={() => downloadText(`${prefix}sales-${fileStamp()}.csv`, salesCsv(data.sales))}>
              Sales CSV
            </Button>
            <Button icon={<Download className="size-4" />} onClick={() => downloadText(`${prefix}profit-summary-${fileStamp()}.csv`, profitSummaryCsv(data.sales, todayISO()))} className="hidden sm:inline-flex">
              Profit summary
            </Button>
            <Link to="/sales/close" className={buttonClass('secondary', 'md')} data-testid="close-link">
              <CalendarCheck className="size-4" aria-hidden /> Monthly Close
            </Link>
            <Link to="/sales/year-end" className={buttonClass('secondary', 'md')} data-testid="yearend-link">
              <CalendarRange className="size-4" aria-hidden /> Year-End Review
            </Link>
            <Link to="/sales/planning" className={buttonClass('secondary', 'md')} data-testid="planning-link">
              <PiggyBank className="size-4" aria-hidden /> Financial Planning
            </Link>
            <Link to="/sales/payouts" className={buttonClass('secondary', 'md')} data-testid="payouts-link">
              <Landmark className="size-4" aria-hidden /> Payouts
            </Link>
            <Button variant="primary" icon={<Receipt className="size-4" />} onClick={() => dialogs.recordSale()}>
              Record sale
            </Button>
          </>
        }
      />

      <div className="space-y-5">
        <PeriodPicker value={period} onChange={setPeriod} />
        <section aria-labelledby="realized-heading">
          <div className="mb-2 flex items-center gap-2">
            <h2 id="realized-heading" className="text-sm font-semibold text-ink">
              Realized {range.label}
              {platform && ` · ${platform}`}
            </h2>
            <Badge tone="good">Money actually earned</Badge>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Revenue" value={money(t.revenue)} sub={`${plural(t.salesCount, 'sale')} · ${plural(t.unitsSold, 'unit')}`} testId="sales-revenue" help="revenue" />
            <StatTile label="Cost of goods" value={money(t.costOfGoods)} sub="What the sold items cost you" testId="sales-cogs" help="cogs" />
            <StatTile label="Selling expenses" value={money(t.totalExpenses)} sub={`Fees ${money(t.fees)} · Ship ${money(t.shipping)} · Other ${money(t.otherExpenses)}`} testId="sales-expenses" />
            <StatTile label="Net profit" value={money(t.netProfit)} tone={t.netProfit < 0 ? 'bad' : 'good'} tag={REALIZED} testId="sales-net" help="realized-profit" />
            <StatTile label="Profit margin" value={formatPercent(t.margin)} sub="Net profit ÷ revenue" testId="sales-margin" help="margin" />
            <StatTile label="ROI" value={formatPercent(t.roi)} sub="Net profit ÷ cost of goods" testId="sales-roi" help="roi" />
          </div>
        </section>

        <InventoryLossCard range={range} netProfit={t.netProfit} money={money} />

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <MonthlyTrend sales={data.sales} months={12} />
          <ChartCard
            title="Profit by platform"
            description={`Net profit ${range.label}`}
            empty={byPlatform.length === 0 ? `No sales ${range.label}.` : undefined}
            table={{ columns: ['Platform', 'Sales', 'Revenue', 'Net profit', 'Margin'], rows: byPlatform.map((g) => [g.label, g.salesCount, money(g.revenue), money(g.netProfit), formatPercent(g.margin)]) }}
          >
            <BarList rows={byPlatform.slice(0, 6).map((g) => ({ key: g.key, label: g.label, value: g.netProfit, sub: `${plural(g.salesCount, 'sale')} · ${formatPercent(g.margin)} margin` }))} format={money} />
          </ChartCard>
        </div>

        <ProjectedCard projection={projection} money={money} />

        <Card className="overflow-hidden">
          <div className="space-y-3 p-4 sm:p-5">
            <SectionHeader title="Sales" description={`${plural(filtered.length, 'sale')} ${range.label}`} as="h2" />
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sales…" aria-label="Search sales" className={cn(inputClass, 'border-line-strong pl-9')} />
              </div>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform" className={cn(inputClass, 'border-line-strong sm:w-56')}>
                <option value="">All platforms</option>
                {platforms.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>
          {filtered.length === 0 ? (
            <p className="border-t border-line px-5 py-8 text-center text-sm text-ink-2">No sales match {range.label}. Try a longer time period.</p>
          ) : (
            <ul className="divide-y divide-line border-t border-line" data-testid="sales-list">
              {filtered.map((s) => {
                const f = computeSale(s);
                return (
                  <li key={s.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5" data-testid="sale-row">
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium break-words text-ink" title={s.itemName}>
                        {s.itemName}
                      </p>
                      <p className="text-xs text-ink-2">
                        {formatDate(s.saleDate)} · {s.platform || 'No platform'} · {s.quantity} × {money(s.priceMode === 'per_unit' ? s.salePrice : f.revenue / s.quantity)}
                      </p>
                    </div>
                    <div className="tabular grid grid-cols-3 gap-3 text-right text-sm sm:w-[340px]">
                      <span>
                        <span className="block text-[11px] text-muted">Revenue</span>
                        <span className="text-ink">{money(f.revenue)}</span>
                      </span>
                      <span>
                        <span className="block text-[11px] text-muted">Costs</span>
                        <span className="text-ink">{money(f.costOfGoods + f.totalExpenses)}</span>
                      </span>
                      <span>
                        <span className="block text-[11px] text-muted">Profit · {formatPercent(f.margin, 0)}</span>
                        <span className={f.netProfit < 0 ? 'font-medium text-bad-text' : 'font-medium text-good-text'}>{money(f.netProfit)}</span>
                      </span>
                    </div>
                    <div className="flex shrink-0 justify-end gap-1">
                      <IconButton label={`Edit sale of ${s.itemName}`} size="sm" onClick={() => dialogs.editSale(s.id)}>
                        <Pencil className="size-4" />
                      </IconButton>
                      <IconButton label={`Cancel sale of ${s.itemName}`} size="sm" onClick={() => void cancelSale(s.id)}>
                        <Trash2 className="size-4" />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

/** Documented inventory losses next to realized sales profit: shown apart, never as net income. */
function InventoryLossCard({ range, netProfit, money }: { range: DateRange; netProfit: number; money: (n: number) => string }) {
  const data = useAppState((s) => s.data);
  const a = adjustmentSummary(data, range);
  if (!a.losses.records.length && !a.found.records.length && !a.personal.records.length && !a.returns.records.length) return null;
  const after = fromCents(toCents(netProfit) + toCents(a.netLoss));
  const row = (label: string, g: { amount: number; records: unknown[] }, testId: string) =>
    g.records.length ? (
      <div className="flex flex-wrap justify-between gap-x-3 py-1" data-testid={testId}>
        <dt className="text-ink-2">
          {label} <span className="text-xs text-muted">({plural(g.records.length, 'adjustment')})</span>
        </dt>
        <dd className="tabular text-ink">{money(g.amount)}</dd>
      </div>
    ) : null;
  return (
    <Card className="p-4 sm:p-5" data-testid="inventory-losses">
      <SectionHeader
        title={`Inventory losses and adjustments ${range.label}`}
        description="Quantity changes you documented outside of sales (counts, damage, items found). They change inventory cost, not realized sales profit above, so nothing is counted twice."
      />
      <dl className="mt-2 divide-y divide-line text-sm">
        {row('Lost, damaged or missing', a.losses, 'loss-losses')}
        {row('Units found', a.found, 'loss-found')}
        <div className="flex flex-wrap justify-between gap-x-3 py-1 font-medium" data-testid="loss-net">
          <dt className="text-ink">Net documented inventory loss</dt>
          <dd className="tabular text-ink">{money(a.netLoss)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-3 py-1" data-testid="loss-after">
          <dt className="text-ink-2">Realized sales profit after documented inventory losses</dt>
          <dd className={cn('tabular font-medium', after < 0 ? 'text-bad-text' : 'text-ink')}>{money(after)}</dd>
        </div>
        {row('Taken for personal use (not a business loss; shown apart)', a.personal, 'loss-personal')}
        {row('Returns put back in stock (refunds belong on the sale)', a.returns, 'loss-returns')}
      </dl>
      <p className="mt-2 text-xs text-muted">Not net income: rent, insurance and other operating expenses aren’t recorded in StockPilot.</p>
    </Card>
  );
}

function ProjectedCard({ projection, money }: { projection: ReturnType<typeof projectUnsold>; money: (n: number) => string }) {
  const rateText =
    projection.rate.source === 'history'
      ? `Selling costs estimated at ${formatPercent(projection.rate.percent, 2)} of price — your average across ${plural(projection.rate.basedOnSales, 'recorded sale')}. It’s recalculated after every sale, so projected amounts can change by a few cents even when an item’s cost and price don’t.`
      : projection.rate.source === 'setting'
        ? `Selling costs estimated at ${formatPercent(projection.rate.percent, 2)} (from Settings).`
        : 'No selling costs assumed yet — record sales with fees, or set an estimate in Settings.';
  return (
    <Card className="border-dashed p-4 sm:p-5" data-testid="projected-card">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-ink">If your unsold inventory sells at asking price</h2>
        <Badge tone="warn" icon={<Undo2 className="size-3 rotate-180" />}>
          Projected — not earned yet
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Projected revenue" value={money(projection.projectedRevenue)} tag={PROJECTED} />
        <StatTile label="Est. selling costs" value={money(projection.projectedSellingCosts)} />
        <StatTile label="Cost of those items" value={money(projection.costBasis)} />
        <StatTile label="Projected profit" value={money(projection.projectedProfit)} tone={projection.projectedProfit < 0 ? 'bad' : 'default'} tag={PROJECTED} testId="projected-profit" />
      </div>
      <p className="mt-3 text-xs text-ink-2">
        {rateText} {projection.itemsExcluded > 0 && `${plural(projection.itemsExcluded, 'in-stock item')} ${pluralWord(projection.itemsExcluded, 'has', 'have')} no asking price and ${pluralWord(projection.itemsExcluded, 'is', 'are')} not included.`}
      </p>
    </Card>
  );
}
