import { Link } from 'react-router-dom';
import { ArrowRight, Boxes, ClipboardCheck, DollarSign, Gem, Package, PackagePlus, Receipt, ShoppingBag, TrendingUp, Wallet } from 'lucide-react';
import { inventoryTotals, isLowStock, projectUnsold, salesByItem, salesInRange, totalSales } from '../../domain/calc';
import { formatDate, periodRange, PERIOD_OPTIONS, previousPeriodRange, todayISO, type PeriodKey } from '../../domain/dates';
import { formatNumber, formatPercent } from '../../domain/money';
import { useAppState } from '../../data/store';
import { modeInfo, salesEnabled } from '../../lib/modes';
import { useInsights, useMoney } from '../../lib/hooks';
import { usePersistentState } from '../../lib/usePersistentState';
import { PageHeader, Card, SectionHeader } from '../../ui/Card';
import { Button } from '../../ui/Button';
import { Delta, StatTile, REALIZED, PROJECTED, ESTIMATED } from '../../ui/Stat';
import { PeriodPicker } from '../../ui/PeriodPicker';
import { BarList, ChartCard, LineChart, StockMeter } from '../../ui/charts';
import { ItemThumb } from '../../ui/Photo';
import { Badge } from '../../ui/Badge';
import { useDialogs } from '../dialogs/DialogHub';
import { AlertStrip, CategoryProfit, GetStarted, MonthlyTrend, RecentSales, SlowMovers } from './widgets';

const PERIOD_KEYS = PERIOD_OPTIONS.map((p) => p.key);

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function OverviewPage() {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const dialogs = useDialogs();
  const [period, setPeriod] = usePersistentState<PeriodKey>('overview-period', 'this_month', PERIOD_KEYS);
  const canSell = salesEnabled(settings);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={<Badge tone="accent">{modeInfo(settings.mode).name} mode</Badge>}
        title={greeting()}
        description={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        actions={
          data.items.length > 0 && (
            <>
              <Button variant={canSell ? 'secondary' : 'primary'} icon={<PackagePlus className="size-4" />} onClick={dialogs.addItem}>
                Add item
              </Button>
              {canSell && (
                <Button variant="primary" icon={<Receipt className="size-4" />} onClick={() => dialogs.recordSale()}>
                  Record sale
                </Button>
              )}
            </>
          )
        }
      />
      {data.items.length === 0 && data.sales.length === 0 ? (
        <GetStarted />
      ) : settings.mode === 'collector' ? (
        <CollectorOverview />
      ) : settings.mode === 'business' ? (
        <BusinessOverview period={period} setPeriod={setPeriod} />
      ) : (
        <ResellerOverview period={period} setPeriod={setPeriod} />
      )}
    </div>
  );
}

interface PeriodProps {
  period: PeriodKey;
  setPeriod: (p: PeriodKey) => void;
}

// ---------------------------------------------------------------------------
// Reseller
// ---------------------------------------------------------------------------

function ResellerOverview({ period, setPeriod }: PeriodProps) {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const { money } = useMoney();
  const range = periodRange(period, todayISO());
  const sales = salesInRange(data.sales, range);
  const t = totalSales(sales);
  const prevRange = previousPeriodRange(period, todayISO());
  const prev = prevRange ? totalSales(salesInRange(data.sales, prevRange)) : null;
  const inv = inventoryTotals(data.items);
  const projection = projectUnsold(data.items, data.sales, settings);

  return (
    <>
      <AlertStrip />
      <PeriodPicker value={period} onChange={setPeriod} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1" data-testid="hero-profit">
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-2">Net profit {range.label}</span>
            <Badge tone="good">Realized</Badge>
          </div>
          <div className={`mt-2 text-5xl font-semibold tracking-tight ${t.netProfit < 0 ? 'text-bad-text' : 'text-ink'}`} data-testid="hero-profit-value">
            {money(t.netProfit)}
          </div>
          <p className="mt-2 text-sm text-ink-2">
            From {money(t.revenue)} in sales · {formatPercent(t.margin)} margin · {formatPercent(t.roi)} ROI
          </p>
          {prev && prevRange && (
            <p className="mt-2 text-sm">
              <Delta current={t.netProfit} previous={prev.netProfit} format={money} label={prevRange.label} />
            </p>
          )}
          <p className="mt-3 text-xs text-muted">After cost of goods, marketplace fees, shipping and other expenses.</p>
        </Card>
        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          <StatTile label={`Revenue ${range.label}`} value={money(t.revenue)} tag={REALIZED} icon={<DollarSign className="size-4" />} testId="stat-revenue" />
          <StatTile label={`Items sold ${range.label}`} value={formatNumber(t.unitsSold)} sub={`${t.salesCount} ${t.salesCount === 1 ? 'sale' : 'sales'}`} icon={<ShoppingBag className="size-4" />} testId="stat-sold" />
          <StatTile label="Inventory cost" value={money(inv.costValue)} sub="What you paid for unsold stock" icon={<Wallet className="size-4" />} testId="stat-inventory-cost" />
          <StatTile
            label="Est. selling value"
            value={money(inv.askingValue)}
            tag={PROJECTED}
            sub={inv.itemsMissingAsking ? `${inv.itemsMissingAsking} items have no asking price` : 'At your asking prices'}
            icon={<TrendingUp className="size-4" />}
            testId="stat-selling-value"
          />
          <StatTile
            label="Items in stock"
            value={formatNumber(inv.unitsInStock)}
            sub={`${inv.itemsInStock} ${inv.itemsInStock === 1 ? 'listing' : 'listings'}`}
            icon={<Boxes className="size-4" />}
            testId="stat-in-stock"
          />
          <StatTile
            label="Potential profit on unsold"
            value={money(projection.projectedProfit)}
            tag={PROJECTED}
            tone={projection.projectedProfit < 0 ? 'bad' : 'default'}
            sub={
              projection.rate.source === 'none'
                ? 'Before selling fees (no fee history yet)'
                : `After ~${formatPercent(projection.rate.percent, 0)} selling costs`
            }
            icon={<TrendingUp className="size-4" />}
            testId="stat-projected-profit"
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <MonthlyTrend sales={data.sales} />
        <CategoryProfit sales={sales} periodLabel={range.label} />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <SlowMovers data={data} />
        <RecentSales sales={data.sales} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

function CollectorOverview() {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const { money, compact } = useMoney();
  const inv = inventoryTotals(data.items);
  const gain = inv.estimatedValue - inv.estimatedCostBasis;
  const gainPct = inv.estimatedCostBasis > 0 ? (gain / inv.estimatedCostBasis) * 100 : null;
  const inStock = data.items.filter((i) => i.quantity > 0);
  const snapshots = data.snapshots.slice(-60);
  const valueByCategory = new Map<string, { value: number; count: number }>();
  for (const i of inStock) {
    const key = i.category || 'Uncategorized';
    const v = valueByCategory.get(key) ?? { value: 0, count: 0 };
    v.value += (i.estimatedValue ?? i.unitCost) * i.quantity;
    v.count += i.quantity;
    valueByCategory.set(key, v);
  }
  const categoryRows = [...valueByCategory.entries()].sort((a, b) => b[1].value - a[1].value);
  const topValued = [...inStock].sort((a, b) => (b.estimatedValue ?? b.unitCost) * b.quantity - (a.estimatedValue ?? a.unitCost) * a.quantity).slice(0, 5);
  const movers = inStock
    .filter((i) => i.estimatedValue !== null)
    .map((i) => ({ item: i, change: (i.estimatedValue! - i.unitCost) * i.quantity }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
    .slice(0, 5);
  const realized = totalSales(data.sales);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="p-5" data-testid="hero-collection-value">
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-2">Estimated collection value</span>
            <Badge tone="accent">Estimated</Badge>
          </div>
          <div className="mt-2 text-5xl font-semibold tracking-tight text-ink" data-testid="hero-collection-value-value">
            {money(inv.estimatedValue)}
          </div>
          <p className={`mt-2 text-sm ${gain < 0 ? 'text-bad-text' : 'text-good-text'}`}>
            {gain >= 0 ? '▲' : '▼'} {money(Math.abs(gain))} ({formatPercent(gainPct)}) vs. what you paid
          </p>
          <p className="mt-3 text-xs text-muted">
            {inv.itemsMissingEstimate > 0
              ? `Based on the ${inv.itemsWithEstimate} of ${inv.itemsInStock} items you’ve valued. Add estimated values for a fuller picture.`
              : 'Based on the estimated values you’ve entered.'}
          </p>
        </Card>
        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          <StatTile label="Items in collection" value={formatNumber(inv.unitsInStock)} sub={`${inv.itemsInStock} unique ${inv.itemsInStock === 1 ? 'item' : 'items'}`} icon={<Gem className="size-4" />} testId="stat-collection-size" />
          <StatTile label="Acquisition cost" value={money(inv.costValue)} sub="What you paid in total" icon={<Wallet className="size-4" />} testId="stat-acquisition-cost" />
          <StatTile
            label="Unrealized gain"
            value={money(gain)}
            tone={gain < 0 ? 'bad' : 'good'}
            tag={ESTIMATED}
            sub="Estimated value − cost, valued items only"
            icon={<TrendingUp className="size-4" />}
            testId="stat-unrealized"
          />
          {settings.collectorSalesEnabled ? (
            <StatTile label="Profit from sales" value={money(realized.netProfit)} tag={REALIZED} sub={`${realized.unitsSold} items sold`} icon={<DollarSign className="size-4" />} testId="stat-realized" />
          ) : (
            <StatTile label="Valued items" value={`${inv.itemsWithEstimate} / ${inv.itemsInStock}`} sub="Items with an estimated value" icon={<Package className="size-4" />} testId="stat-valued" />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Collection value over time"
          description="Items without an estimate are counted at cost"
          empty={snapshots.length < 2 ? 'Value history builds up as you use StockPilot — check back after a few days.' : undefined}
          table={{ columns: ['Date', 'Estimated value', 'Cost'], rows: snapshots.map((s) => [formatDate(s.date), money(s.value), money(s.cost)]) }}
        >
          <LineChart
            ariaLabel="Collection value and cost over time"
            labels={snapshots.map((s) => formatDate(s.date).replace(/, \d{4}$/, ''))}
            series={[
              { id: 'value', name: 'Estimated value', color: 'var(--series-1)', values: snapshots.map((s) => s.value) },
              { id: 'cost', name: 'Cost', color: 'var(--series-2)', values: snapshots.map((s) => s.cost) },
            ]}
            format={money}
            formatAxis={compact}
          />
        </ChartCard>
        <ChartCard
          title="Value by category"
          description="Estimated value (or cost when not valued)"
          empty={categoryRows.length === 0 ? 'Nothing in your collection yet.' : undefined}
          table={{ columns: ['Category', 'Value', 'Items'], rows: categoryRows.map(([k, v]) => [k, money(v.value), v.count]) }}
        >
          <BarList rows={categoryRows.slice(0, 6).map(([k, v]) => ({ key: k, label: k, value: v.value, sub: `${v.count} ${v.count === 1 ? 'item' : 'items'}` }))} format={money} />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <SectionHeader title="Most valuable" as="h3" action={<ViewAll to="/inventory?sort=value" />} />
          <ItemRows
            rows={topValued.map((i) => ({
              id: i.id,
              name: i.name,
              photoId: i.photoIds[0],
              sub: [i.condition, i.location].filter(Boolean).join(' · ') || i.category || '—',
              value: money((i.estimatedValue ?? i.unitCost) * i.quantity),
            }))}
          />
        </Card>
        <Card className="p-4 sm:p-5">
          <SectionHeader title="Biggest changes in value" description="Estimated value vs. what you paid" as="h3" />
          {movers.length === 0 ? (
            <p className="mt-4 text-sm text-ink-2">Add estimated values to items to see gains and losses.</p>
          ) : (
            <ItemRows
              rows={movers.map(({ item, change }) => ({
                id: item.id,
                name: item.name,
                photoId: item.photoIds[0],
                sub: `Paid ${money(item.unitCost)} · now ~${money(item.estimatedValue!)}`,
                value: `${change >= 0 ? '+' : '−'}${money(Math.abs(change))}`,
                tone: change < 0 ? 'bad' : 'good',
              }))}
            />
          )}
        </Card>
      </div>
      {settings.collectorSalesEnabled && <RecentSales sales={data.sales} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Small business
// ---------------------------------------------------------------------------

function BusinessOverview({ period, setPeriod }: PeriodProps) {
  const data = useAppState((s) => s.data);
  const { money } = useMoney();
  const report = useInsights();
  const range = periodRange(period, todayISO());
  const sales = salesInRange(data.sales, range);
  const t = totalSales(sales);
  const prevRange = previousPeriodRange(period, todayISO());
  const prev = prevRange ? totalSales(salesInRange(data.sales, prevRange)) : null;
  const inv = inventoryTotals(data.items);
  const lowItems = data.items.filter((i) => isLowStock(i)).sort((a, b) => a.quantity - b.quantity);
  const topProducts = salesByItem(sales).sort((a, b) => b.netProfit - a.netProfit).slice(0, 5);
  const shrink = report.discrepancies.findings.reduce((s, f) => s + f.adjustment.valueDifference, 0);
  const lastCount = data.countHistory[data.countHistory.length - 1];

  return (
    <>
      <AlertStrip />
      <PeriodPicker value={period} onChange={setPeriod} />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="p-5" data-testid="hero-inventory-value">
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-2">Inventory value at cost</span>
          </div>
          <div className="mt-2 text-5xl font-semibold tracking-tight text-ink" data-testid="hero-inventory-value-value">
            {money(inv.costValue)}
          </div>
          <p className="mt-2 text-sm text-ink-2">
            {formatNumber(inv.unitsInStock)} units across {inv.itemsInStock} products · {money(inv.askingValue)} at selling price
          </p>
        </Card>
        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          <StatTile
            label={`Sales ${range.label}`}
            value={money(t.revenue)}
            tag={REALIZED}
            sub={prev && prevRange ? <Delta current={t.revenue} previous={prev.revenue} format={money} label={prevRange.label} /> : `${t.unitsSold} units · ${t.salesCount} orders`}
            icon={<DollarSign className="size-4" />}
            testId="stat-revenue"
          />
          <StatTile label={`Net profit ${range.label}`} value={money(t.netProfit)} tone={t.netProfit < 0 ? 'bad' : 'default'} tag={REALIZED} sub={`${formatPercent(t.margin)} margin`} icon={<TrendingUp className="size-4" />} testId="stat-profit" />
          <StatTile
            label="Low-stock products"
            value={String(inv.lowStockCount + inv.outOfStockCount)}
            tone={inv.lowStockCount + inv.outOfStockCount > 0 ? 'warn' : 'default'}
            sub={inv.outOfStockCount ? `${inv.outOfStockCount} out of stock` : 'At or below alert level'}
            icon={<Package className="size-4" />}
            testId="stat-low-stock"
          />
          <StatTile
            label="Discrepancies (90 days)"
            value={money(shrink)}
            tone={shrink < 0 ? 'bad' : 'default'}
            sub={lastCount ? `Last count ${formatDate(lastCount.completedAt)}` : 'No physical count yet'}
            icon={<ClipboardCheck className="size-4" />}
            testId="stat-discrepancy"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <SectionHeader title="Stock levels to watch" description="Products at or below their alert level" as="h3" action={<ViewAll to="/inventory?status=low" />} />
          {lowItems.length === 0 ? (
            <p className="mt-4 text-sm text-ink-2">{report.lowStock.insufficient ?? 'Everything is above its alert level.'}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {lowItems.slice(0, 6).map((i) => (
                <li key={i.id}>
                  <Link to={`/inventory/${i.id}`} className="block hover:opacity-80">
                    <div className="mb-1 flex justify-between gap-3 text-sm">
                      <span className="truncate font-medium text-ink">{i.name}</span>
                      <span className={`tabular shrink-0 ${i.quantity === 0 ? 'text-bad-text' : 'text-warn-text'}`}>
                        {i.quantity} left · alert at {i.lowStockThreshold}
                      </span>
                    </div>
                    <StockMeter quantity={i.quantity} threshold={i.lowStockThreshold ?? 0} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4 sm:p-5">
          <SectionHeader title="Top products" description={`By net profit ${range.label}`} as="h3" />
          {topProducts.length === 0 ? (
            <p className="mt-4 text-sm text-ink-2">No sales {range.label}.</p>
          ) : (
            <BarList
              rows={topProducts.map((g) => ({ key: g.key, label: g.label, value: g.netProfit, sub: `${g.unitsSold} sold · ${money(g.revenue)} revenue` }))}
              format={money}
            />
          )}
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <MonthlyTrend sales={data.sales} />
        <RecentSales sales={data.sales} />
      </div>
    </>
  );
}

function ViewAll({ to }: { to: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline">
      View <ArrowRight className="size-4" />
    </Link>
  );
}

function ItemRows({ rows }: { rows: { id: string; name: string; photoId?: string; sub: string; value: string; tone?: 'good' | 'bad' }[] }) {
  if (!rows.length) return <p className="mt-4 text-sm text-ink-2">Nothing here yet.</p>;
  return (
    <ul className="mt-3 divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id}>
          <Link to={`/inventory/${r.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
            <ItemThumb photoId={r.photoId} name={r.name} className="size-10 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{r.name}</p>
              <p className="truncate text-xs text-ink-2">{r.sub}</p>
            </div>
            <span className={`tabular shrink-0 text-sm font-medium ${r.tone === 'bad' ? 'text-bad-text' : r.tone === 'good' ? 'text-good-text' : 'text-ink'}`}>{r.value}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}


