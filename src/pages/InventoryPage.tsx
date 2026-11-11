import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Boxes, Download, FileUp, Layers, LayoutGrid, List, PackagePlus, Search, SearchX, Sparkles, X } from 'lucide-react';
import { acquiredDate, itemCostValue, knownCategories, knownLocations, stockStatus, uniqueSorted, daysWithoutSale } from '../domain/calc';
import { todayISO } from '../domain/dates';
import type { Item } from '../domain/types';
import { store, useAppState } from '../data/store';
import { inventoryCsv } from '../csv/exports';
import { downloadText, fileStamp } from '../lib/download';
import { useMoney } from '../lib/hooks';
import { PageHeader, Card } from '../ui/Card';
import { Button, IconButton, buttonClass } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { EmptyState } from '../ui/EmptyState';
import { ItemThumb } from '../ui/Photo';
import { inputClass } from '../ui/Fields';
import { cn } from '../ui/cn';
import { useDialogs } from './dialogs/DialogHub';
import { useToast } from '../ui/Toast';
import { DeviceNotice } from './DeviceNotice';
import { scannerEnabled } from '../ai/config';
import { plural, pluralWord } from '../domain/format';
import { TERMS } from '../domain/terms';
import { useRadioGroup } from '../ui/useRadioGroup';

const SORTS = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  name: 'Name (A–Z)',
  qty_desc: 'Quantity (high–low)',
  qty_asc: 'Quantity (low–high)',
  cost: 'Total cost (high–low)',
  value: 'Value (high–low)',
  price: 'Asking price (high–low)',
  age: 'Longest unsold',
} as const;
type SortKey = keyof typeof SORTS;

const STATUSES = { all: 'All items', in_stock: 'In stock', low: 'Low stock', out: 'Out of stock' } as const;
type StatusKey = keyof typeof STATUSES;

export function filterItems(
  items: Item[],
  f: { q: string; category: string; location: string; condition: string; status: StatusKey },
): Item[] {
  const q = f.q.trim().toLowerCase();
  return items.filter((i) => {
    if (q && ![i.name, i.sku, i.category, i.location, i.condition, i.notes].some((v) => v.toLowerCase().includes(q))) return false;
    if (f.category && i.category.toLowerCase() !== f.category.toLowerCase()) return false;
    if (f.location && i.location.toLowerCase() !== f.location.toLowerCase()) return false;
    if (f.condition && i.condition.toLowerCase() !== f.condition.toLowerCase()) return false;
    if (f.status === 'in_stock' && i.quantity === 0) return false;
    if (f.status === 'low' && !(i.lowStockThreshold !== null && i.quantity <= i.lowStockThreshold)) return false;
    if (f.status === 'out' && i.quantity !== 0) return false;
    return true;
  });
}

export function InventoryPage() {
  const data = useAppState((s) => s.data);
  const settings = useAppState((s) => s.settings);
  const dataset = useAppState((s) => s.dataset);
  const dialogs = useDialogs();
  const toast = useToast();
  const { money } = useMoney();
  const [params, setParams] = useSearchParams();

  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const location = params.get('location') ?? '';
  const condition = params.get('condition') ?? '';
  const status = (params.get('status') as StatusKey) in STATUSES ? (params.get('status') as StatusKey) : 'all';
  const sort = (params.get('sort') as SortKey) in SORTS ? (params.get('sort') as SortKey) : 'newest';
  const view = settings.inventoryView;
  const viewRadio = useRadioGroup(['grid', 'list'] as const, view, (v) => store.updateSettings({ inventoryView: v }));

  const setParam = (key: string, value: string) => {
    // Read the live URL rather than this render's params: two quick changes (clear search,
    // then pick a category) must not overwrite each other with stale values.
    const next = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    if (value && !(key === 'status' && value === 'all') && !(key === 'sort' && value === 'newest')) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const categories = useMemo(() => knownCategories({ ...data, sales: [] }), [data]);
  const locations = useMemo(() => knownLocations(data), [data]);
  const conditions = useMemo(() => uniqueSorted(data.items.map((i) => i.condition)), [data]);
  const today = todayISO();

  const results = useMemo(() => {
    const filtered = filterItems(data.items, { q, category, location, condition, status });
    const value = (i: Item) => (i.estimatedValue ?? i.askingPrice ?? i.unitCost) * i.quantity;
    const cmp: Record<SortKey, (a: Item, b: Item) => number> = {
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      oldest: (a, b) => acquiredDate(a).localeCompare(acquiredDate(b)),
      name: (a, b) => a.name.localeCompare(b.name),
      qty_desc: (a, b) => b.quantity - a.quantity,
      qty_asc: (a, b) => a.quantity - b.quantity,
      cost: (a, b) => itemCostValue(b) - itemCostValue(a),
      value: (a, b) => value(b) - value(a),
      price: (a, b) => (b.askingPrice ?? -1) - (a.askingPrice ?? -1),
      age: (a, b) => daysWithoutSale(b, data.sales, today) - daysWithoutSale(a, data.sales, today) || (b.quantity > 0 ? 1 : 0) - (a.quantity > 0 ? 1 : 0),
    };
    return [...filtered].sort(cmp[sort]);
  }, [data, q, category, location, condition, status, sort, today]);

  const activeFilters = [category, location, condition, status !== 'all' ? status : '', q].filter(Boolean).length;
  const title = settings.mode === 'collector' ? 'Collection' : 'Inventory';
  const totalUnits = results.reduce((n, i) => n + i.quantity, 0);

  const exportCsv = () => {
    downloadText(`stockpilot-${dataset === 'demo' ? 'demo-' : ''}inventory-${fileStamp()}.csv`, inventoryCsv(data.items));
    toast.success(`Exported ${plural(data.items.length, 'item')} to CSV.`);
  };

  if (data.items.length === 0) {
    return (
      <>
        <PageHeader title={title} />
        <DeviceNotice />
        <Card>
          <EmptyState
            icon={<Boxes className="size-6" />}
            title={settings.mode === 'collector' ? 'Your collection is empty' : 'No inventory yet'}
            actions={
              <>
                <Button variant="primary" icon={<PackagePlus className="size-4" />} onClick={dialogs.addItem}>
                  Add your first item
                </Button>
                {scannerEnabled && (
                  <Button icon={<Sparkles className="size-4" />} onClick={dialogs.scanItem}>
                    Scan with AI
                  </Button>
                )}
                <Button icon={<Layers className="size-4" />} onClick={dialogs.addLot}>
                  Add bulk lot
                </Button>
                <Button icon={<FileUp className="size-4" />} onClick={dialogs.importCsv}>
                  Import CSV
                </Button>
              </>
            }
          >
            Add items one at a time, a whole lot bought for one price, or import a spreadsheet you already have.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={title}
        description={`${plural(data.items.length, 'item')} · ${plural(data.items.reduce((n, i) => n + i.quantity, 0), 'unit')} on hand`}
        actions={
          <>
            <Button icon={<FileUp className="size-4" />} onClick={dialogs.importCsv} className="hidden sm:inline-flex">
              Import
            </Button>
            <Button icon={<Download className="size-4" />} onClick={exportCsv}>
              Export
            </Button>
            {data.lots.length > 0 && (
              <Link to="/inventory/lots" className={buttonClass('secondary', 'md')} data-testid="lots-link">
                <Layers className="size-4" /> Lots ({data.lots.length})
              </Link>
            )}
            {scannerEnabled && (
              <Button icon={<Sparkles className="size-4" />} onClick={dialogs.scanItem}>
                Scan with AI
              </Button>
            )}
            <Button icon={<Layers className="size-4" />} onClick={dialogs.addLot}>
              Add bulk lot
            </Button>
            <Button variant="primary" icon={<PackagePlus className="size-4" />} onClick={dialogs.addItem}>
              Add item
            </Button>
          </>
        }
      />
      <DeviceNotice />

      <div className="mb-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={q}
              onChange={(e) => setParam('q', e.target.value)}
              placeholder="Search name, SKU, category, location, notes…"
              aria-label="Search inventory"
              className={cn(inputClass, 'border-line-strong pl-9')}
            />
          </div>
          <div className="flex rounded-xl bg-surface-2 p-1" role="radiogroup" aria-label="View">
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                {...viewRadio(v)}
                aria-label={v === 'grid' ? 'Grid view' : 'List view'}
                onClick={() => store.updateSettings({ inventoryView: v })}
                className={cn('flex w-10 items-center justify-center rounded-lg', view === v ? 'bg-surface text-ink shadow-card' : 'text-ink-2')}
              >
                {v === 'grid' ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <FilterSelect label="Status" value={status} onChange={(v) => setParam('status', v)} options={Object.entries(STATUSES).map(([k, l]) => [k, l])} />
          <FilterSelect label="Category" value={category} onChange={(v) => setParam('category', v)} options={[['', 'All categories'], ...categories.map((c) => [c, c])]} />
          <FilterSelect label="Location" value={location} onChange={(v) => setParam('location', v)} options={[['', 'All locations'], ...locations.map((c) => [c, c])]} />
          {conditions.length > 0 && (
            <FilterSelect label="Condition" value={condition} onChange={(v) => setParam('condition', v)} options={[['', 'Any condition'], ...conditions.map((c) => [c, c])]} />
          )}
          <FilterSelect
            label="Sort"
            value={sort}
            onChange={(v) => setParam('sort', v)}
            options={Object.entries(SORTS).map(([k, l]) => [k, l])}
            className={conditions.length > 0 ? 'col-span-2' : undefined}
          />
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" className="col-span-2 h-9 shrink-0 justify-self-start" icon={<X className="size-4" />} onClick={() => {
                const current = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('sort');
                setParams(current ? { sort: current } : {}, { replace: true });
              }}>
              Clear filters
            </Button>
          )}
        </div>
        <p className="text-sm text-ink-2" data-testid="result-count" aria-live="polite">
          {results.length === data.items.length
            ? results.length === 1
              ? 'Showing 1 item'
              : `Showing all ${plural(results.length, 'item')}`
            : `${results.length} of ${plural(data.items.length, 'item')} ${pluralWord(results.length, 'matches', 'match')}`}{' '}
          · {plural(totalUnits, 'unit')}
        </p>
      </div>

      {results.length === 0 ? (
        <Card>
          <EmptyState icon={<SearchX className="size-6" />} title="No items match" actions={<Button onClick={() => setParams({}, { replace: true })}>Clear search & filters</Button>}>
            Try a different search or remove a filter.
          </EmptyState>
        </Card>
      ) : view === 'grid' ? (
        // Bottom padding lets the last cards scroll clear of the floating Add button on phones.
        <ul className="grid grid-cols-2 gap-3 pb-24 sm:grid-cols-3 lg:grid-cols-4 lg:pb-0" data-testid="inventory-grid">
          {results.map((item) => (
            <li key={item.id}>
              <Link to={`/inventory/${item.id}`} className="group block overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition-shadow hover:shadow-pop" data-testid="inventory-item">
                <div className="relative aspect-square overflow-hidden bg-surface-2">
                  <ItemThumb photoId={item.photoIds[0]} name={item.name} className="size-full transition-transform group-hover:scale-[1.02]" />
                  <div className="absolute top-2 left-2">
                    <StatusBadge item={item} onImage />
                  </div>
                </div>
                <div className="p-3">
                  {/* Long names show three lines here; the full name is on the item page (and in the tooltip). */}
                  <p className="line-clamp-3 min-h-[2.5em] text-sm leading-tight font-medium break-words text-ink" title={item.name} data-testid="inventory-item-name">
                    {item.name}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted">{[item.sku, item.category].filter(Boolean).join(' · ')}</p>
                  <div className="mt-2 flex items-end justify-between gap-2">
                    <span className="tabular text-sm font-semibold text-ink">{priceLabel(item, settings.mode, money)}</span>
                    <span className="tabular text-xs text-ink-2">Qty {item.quantity}</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card className="mb-24 overflow-hidden lg:mb-0" data-testid="inventory-list">
          <table className="w-full text-sm">
            <thead className="hidden bg-surface-2 text-left text-xs text-ink-2 md:table-header-group">
              <tr>
                <th className="px-4 py-2.5 font-medium">Item</th>
                <th className="px-3 py-2.5 font-medium">Category</th>
                <th className="px-3 py-2.5 font-medium">Location</th>
                <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                <th className="px-3 py-2.5 text-right font-medium">Cost / item</th>
                <th className="px-3 py-2.5 text-right font-medium">{settings.mode === 'collector' ? TERMS.marketValue.label : settings.mode === 'business' ? 'Selling price' : 'Asking price'}</th>
                <th className="px-4 py-2.5 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {results.map((item) => (
                <tr key={item.id} className="relative hover:bg-surface-2" data-testid="inventory-item">
                  <td className="px-4 py-2.5">
                    <Link to={`/inventory/${item.id}`} className="flex items-center gap-3 after:absolute after:inset-0">
                      <ItemThumb photoId={item.photoIds[0]} name={item.name} className="size-10 shrink-0 rounded-lg" />
                      <span className="min-w-0">
                        <span className="line-clamp-2 font-medium break-words text-ink" title={item.name}>
                          {item.name}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {item.sku}
                          <span className="md:hidden"> · Qty {item.quantity} · {priceLabel(item, settings.mode, money)}</span>
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="hidden px-3 py-2.5 text-ink-2 md:table-cell">{item.category || '—'}</td>
                  <td className="hidden px-3 py-2.5 text-ink-2 md:table-cell">{item.location || '—'}</td>
                  <td className="tabular hidden px-3 py-2.5 text-right text-ink md:table-cell">{item.quantity}</td>
                  <td className="tabular hidden px-3 py-2.5 text-right text-ink md:table-cell">{money(item.unitCost)}</td>
                  <td className="tabular hidden px-3 py-2.5 text-right text-ink md:table-cell">
                    {settings.mode === 'collector' ? (item.estimatedValue === null ? '—' : money(item.estimatedValue)) : item.askingPrice === null ? '—' : money(item.askingPrice)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <StatusBadge item={item} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div className="fixed right-4 bottom-[calc(84px+env(safe-area-inset-bottom))] z-20 lg:hidden" data-testid="fab-add-item">
        <IconButton label="Add item" onClick={dialogs.addItem} className="size-14 rounded-2xl bg-accent text-white shadow-pop hover:bg-accent-hover hover:text-white">
          <PackagePlus className="size-6" />
        </IconButton>
      </div>
    </>
  );
}

/** The per-item price shown on cards, always labeled so it can't be mistaken for another figure. */
function priceLabel(item: Item, mode: string, money: (n: number) => string): string {
  if (mode === 'collector') return item.estimatedValue !== null ? `Est. ${money(item.estimatedValue)}` : `Cost ${money(item.unitCost)}`;
  if (item.askingPrice !== null) return `${mode === 'business' ? 'Price' : 'Asking'} ${money(item.askingPrice)}`;
  return `Cost ${money(item.unitCost)}`;
}

/**
 * One label per stock status, used everywhere. Quantity 0 is always "Out of stock" (it can
 * come from sales or from a count correction, so "sold out" would not always be true). Items
 * with a low-stock alert show it in red, since you plan to restock them; others in grey.
 */
export function StatusBadge({ item, onImage }: { item: Item; onImage?: boolean }) {
  const s = stockStatus(item);
  if (s === 'out') {
    return (
      <Badge tone={item.lowStockThreshold !== null ? 'bad' : 'neutral'} onImage={onImage}>
        Out of stock
      </Badge>
    );
  }
  if (s === 'low') return <Badge tone="warn" onImage={onImage}>Low stock</Badge>;
  return <Badge tone="good" onImage={onImage}>In stock</Badge>;
}

function FilterSelect({ label, value, onChange, options, className }: { label: string; value: string; onChange: (v: string) => void; options: string[][]; className?: string }) {
  const active = value !== '' && value !== 'all' && value !== 'newest';
  return (
    <label className={cn('relative min-w-0 shrink-0', className)}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(
          'h-9 w-full appearance-none truncate rounded-xl border pr-8 pl-3 text-base font-medium outline-none focus:border-accent sm:w-auto sm:text-sm',
          active ? 'border-accent bg-accent-soft text-accent-text' : 'border-line-strong bg-surface text-ink',
        )}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {label === 'Sort' ? `Sort: ${l}` : l}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </label>
  );
}
