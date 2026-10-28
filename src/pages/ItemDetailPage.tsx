import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, MapPin, MoreHorizontal, Package, PackageMinus, PackagePlus, Pencil, Receipt, Tag, Trash2 } from 'lucide-react';
import { deleteItem } from '../domain/actions';
import { computeSale, daysWithoutSale, itemCostValue, projectedUnitProfit, sellingCostRate, totalSales } from '../domain/calc';
import { formatDate, formatDateTime, todayISO } from '../domain/dates';
import { formatPercent } from '../domain/money';
import { store, useAppState } from '../data/store';
import { salesEnabled } from '../lib/modes';
import { useMoney } from '../lib/hooks';
import { useClickOutside } from '../lib/useClickOutside';
import { Card, SectionHeader } from '../ui/Card';
import { Button, IconButton } from '../ui/Button';
import { ItemThumb, forgetPhotos } from '../ui/Photo';
import { EmptyState } from '../ui/EmptyState';
import { ChartCard, LineChart } from '../ui/charts';
import { Dialog } from '../ui/Dialog';
import { useConfirm } from '../ui/Confirm';
import { useToast } from '../ui/Toast';
import { useDialogs } from './dialogs/DialogHub';
import { StatusBadge } from './InventoryPage';

const SOURCE_LABEL = { count_check: 'Count Check', manual: 'Adjustment', edit: 'Edited', restock: 'Restock', import: 'CSV import' } as const;

export function ItemDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const item = data.items.find((i) => i.id === id);
  const dialogs = useDialogs();
  const confirm = useConfirm();
  const toast = useToast();
  const { money, compact } = useMoney();
  const [photoIndex, setPhotoIndex] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useClickOutside(menuRef, menu, useCallback(() => setMenu(false), []));

  if (!item) {
    return (
      <EmptyState
        icon={<Package className="size-6" />}
        title="Item not found"
        actions={
          <Button variant="primary" onClick={() => navigate('/inventory')}>
            Back to inventory
          </Button>
        }
      >
        It may have been deleted.
      </EmptyState>
    );
  }

  const sales = data.sales.filter((s) => s.itemId === item.id).sort((a, b) => b.saleDate.localeCompare(a.saleDate));
  const adjustments = data.adjustments.filter((a) => a.itemId === item.id).sort((a, b) => b.date.localeCompare(a.date));
  const totals = totalSales(sales);
  const rate = sellingCostRate(data.sales, settings);
  const unitProfit = projectedUnitProfit(item, rate.percent);
  const canSell = salesEnabled(settings);
  const photo = item.photoIds[Math.min(photoIndex, item.photoIds.length - 1)];
  const days = daysWithoutSale(item, data.sales, todayISO());

  const remove = async () => {
    setMenu(false);
    const ok = await confirm({
      title: `Delete "${item.name}"?`,
      message: (
        <>
          <p>This permanently removes the item{item.photoIds.length ? ` and its ${item.photoIds.length} photo${item.photoIds.length === 1 ? '' : 's'}` : ''}.</p>
          {sales.length > 0 && <p className="mt-2">Its {sales.length} recorded {sales.length === 1 ? 'sale stays' : 'sales stay'} in your sales history so your profit totals don’t change.</p>}
        </>
      ),
      confirmLabel: 'Delete item',
    });
    if (!ok) return;
    const { removedPhotoIds } = store.commit((d) => deleteItem(d, item.id));
    void store.deletePhotos(removedPhotoIds);
    forgetPhotos(removedPhotoIds);
    toast.success(`Deleted "${item.name}".`);
    navigate('/inventory', { replace: true });
  };

  const facts: [string, React.ReactNode][] = [
    ['SKU', item.sku],
    ['Category', item.category || '—'],
    ['Condition', item.condition || '—'],
    ['Location', item.location || '—'],
    ['Purchase date', formatDate(item.purchaseDate)],
    ['Low-stock alert', item.lowStockThreshold === null ? 'Off' : `At ${item.lowStockThreshold} or fewer`],
    ['Days without a sale', item.quantity > 0 ? String(days) : '—'],
    ['Added', formatDateTime(item.createdAt)],
    ['Last updated', formatDateTime(item.updatedAt)],
  ];

  return (
    <div className="space-y-4">
      <Link to="/inventory" className="inline-flex items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" /> {settings.mode === 'collector' ? 'Collection' : 'Inventory'}
      </Link>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <div>
          <button type="button" onClick={() => photo && setZoom(true)} className="block w-full overflow-hidden rounded-3xl border border-line bg-surface-2" aria-label={photo ? 'Enlarge photo' : undefined}>
            <ItemThumb photoId={photo} name={item.name} variant="full" className="aspect-square w-full" />
          </button>
          {item.photoIds.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {item.photoIds.map((pid, i) => (
                <button key={pid} type="button" onClick={() => setPhotoIndex(i)} aria-label={`Photo ${i + 1}`} className={`size-16 shrink-0 overflow-hidden rounded-xl border-2 ${i === photoIndex ? 'border-accent' : 'border-transparent'}`}>
                  <ItemThumb photoId={pid} name={item.name} className="size-full" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge item={item} />
              {item.category && (
                <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                  <Tag className="size-3" /> {item.category}
                </span>
              )}
              {item.location && (
                <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                  <MapPin className="size-3" /> {item.location}
                </span>
              )}
              {item.purchaseDate && (
                <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                  <Calendar className="size-3" /> {formatDate(item.purchaseDate)}
                </span>
              )}
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink sm:text-3xl" data-testid="item-title">
              {item.name}
            </h1>
            <p className="mt-1 text-sm text-muted">{item.sku}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {canSell && (
              <Button variant="primary" icon={<Receipt className="size-4" />} onClick={() => dialogs.recordSale(item.id)} disabled={item.quantity === 0} title={item.quantity === 0 ? 'Nothing left to sell' : undefined}>
                Record sale
              </Button>
            )}
            <Button icon={<Pencil className="size-4" />} onClick={() => dialogs.editItem(item.id)}>
              Edit
            </Button>
            <Button icon={<PackagePlus className="size-4" />} onClick={() => dialogs.stock(item.id, 'restock')}>
              Add stock
            </Button>
            <div className="relative" ref={menuRef}>
              <IconButton label="More actions" onClick={() => setMenu((v) => !v)} aria-expanded={menu} className="border border-line-strong bg-surface">
                <MoreHorizontal className="size-5" />
              </IconButton>
              {menu && (
                <div className="animate-fade-in absolute right-0 z-20 mt-1 w-52 rounded-2xl border border-line bg-surface p-1.5 shadow-pop sm:left-0" role="menu">
                  <MenuItem
                    icon={<PackageMinus className="size-4" />}
                    onClick={() => {
                      setMenu(false);
                      dialogs.stock(item.id, 'adjust');
                    }}
                  >
                    Adjust quantity
                  </MenuItem>
                  <MenuItem icon={<Trash2 className="size-4" />} onClick={() => void remove()} danger>
                    Delete item
                  </MenuItem>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Fact label="On hand" value={String(item.quantity)} testId="item-quantity" />
            <Fact label="Cost per item" value={money(item.unitCost)} />
            <Fact label="Total cost" value={money(itemCostValue(item))} />
            <Fact label="Asking price" value={item.askingPrice === null ? 'Not set' : money(item.askingPrice)} />
            <Fact label="Estimated value" value={item.estimatedValue === null ? 'Not set' : money(item.estimatedValue)} />
            <Fact
              label="Projected profit / item"
              value={unitProfit === null ? '—' : money(unitProfit)}
              tone={unitProfit !== null && unitProfit < 0 ? 'bad' : undefined}
              hint={unitProfit === null ? 'Set an asking price' : rate.percent > 0 ? `After ~${formatPercent(rate.percent, 0)} selling costs` : 'Before selling fees'}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-4 sm:p-5">
          <SectionHeader title="Details" as="h2" />
          <dl className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-line py-2 text-sm">
                <dt className="text-ink-2">{k}</dt>
                <dd className="text-right text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          {item.notes && (
            <div className="mt-4">
              <h3 className="text-sm font-medium text-ink">Notes</h3>
              <p className="mt-1 text-sm whitespace-pre-wrap text-ink-2">{item.notes}</p>
            </div>
          )}
        </Card>

        {item.valueHistory.length >= 2 ? (
          <ChartCard
            title="Estimated value history"
            description="Per item, as you’ve updated it"
            table={{ columns: ['Date', 'Value'], rows: item.valueHistory.map((p) => [formatDate(p.date), money(p.value)]) }}
          >
            <LineChart
              ariaLabel="Estimated value per item over time"
              labels={item.valueHistory.map((p) => formatDate(p.date))}
              series={[{ id: 'v', name: 'Estimated value', color: 'var(--series-1)', values: item.valueHistory.map((p) => p.value) }]}
              format={money}
              formatAxis={compact}
              height={180}
            />
          </ChartCard>
        ) : (
          <Card className="p-4 sm:p-5">
            <SectionHeader title="Sales summary" as="h2" />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Fact label="Units sold" value={String(totals.unitsSold)} />
              <Fact label="Revenue" value={money(totals.revenue)} />
              <Fact label="Net profit" value={money(totals.netProfit)} tone={totals.netProfit < 0 ? 'bad' : undefined} />
              <Fact label="Margin" value={formatPercent(totals.margin)} />
            </div>
          </Card>
        )}
      </div>

      {(sales.length > 0 || canSell) && (
        <Card className="p-4 sm:p-5">
          <SectionHeader title="Sales" description={sales.length ? `${totals.unitsSold} sold · ${money(totals.netProfit)} net profit` : undefined} as="h2" />
          {sales.length === 0 ? (
            <p className="mt-3 text-sm text-ink-2">No sales recorded for this item.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="text-left text-xs text-ink-2">
                  <tr>
                    <th className="py-2 font-medium">Date</th>
                    <th className="py-2 font-medium">Platform</th>
                    <th className="py-2 text-right font-medium">Qty</th>
                    <th className="py-2 text-right font-medium">Revenue</th>
                    <th className="py-2 text-right font-medium">Net profit</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="tabular divide-y divide-line">
                  {sales.map((s) => {
                    const f = computeSale(s);
                    return (
                      <tr key={s.id}>
                        <td className="py-2 text-ink">{formatDate(s.saleDate)}</td>
                        <td className="py-2 text-ink-2">{s.platform || '—'}</td>
                        <td className="py-2 text-right text-ink">{s.quantity}</td>
                        <td className="py-2 text-right text-ink">{money(f.revenue)}</td>
                        <td className={`py-2 text-right ${f.netProfit < 0 ? 'text-bad-text' : 'text-good-text'}`}>{money(f.netProfit)}</td>
                        <td className="py-2 text-right">
                          <Button size="sm" variant="ghost" onClick={() => dialogs.editSale(s.id)}>
                            Edit
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {adjustments.length > 0 && (
        <Card className="p-4 sm:p-5">
          <SectionHeader title="Quantity history" description="Changes that didn’t come from sales" as="h2" />
          <ul className="mt-3 divide-y divide-line text-sm">
            {adjustments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-ink">
                    {SOURCE_LABEL[a.source]}: {a.previousQuantity} → {a.newQuantity}
                  </p>
                  <p className="truncate text-xs text-ink-2">
                    {formatDateTime(a.date)} · {a.reason || 'No reason given'}
                  </p>
                </div>
                <span className={`tabular shrink-0 font-medium ${a.difference < 0 ? 'text-bad-text' : 'text-good-text'}`}>
                  {a.difference > 0 ? '+' : ''}
                  {a.difference}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={zoom} onClose={() => setZoom(false)} title={item.name} size="xl">
        <ItemThumb photoId={photo} name={item.name} variant="full" className="mx-auto max-h-[70vh] w-auto rounded-xl object-contain" />
      </Dialog>
    </div>
  );
}

function Fact({ label, value, hint, tone, testId }: { label: string; value: string; hint?: string; tone?: 'bad'; testId?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-3 shadow-card">
      <div className="text-xs text-ink-2">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone === 'bad' ? 'text-bad-text' : 'text-ink'}`} data-testid={testId}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-surface-2 ${danger ? 'text-bad-text' : 'text-ink'}`}>
      {icon}
      {children}
    </button>
  );
}
